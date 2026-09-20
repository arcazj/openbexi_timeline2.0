"""Create a separate version-2 launch environment from a version-1 profile."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml

from server.app.models.domain import DomainError
from server.app.services.launch_configuration import load_launch_configuration
from server.app.services.legacy_json import parse_legacy_json
from server.app.services.legacy_reader import safe_read
from server.app.services.legacy_sources import _guard_path, load_legacy_sources


def migrate_profile(filename, output, *, initial_range=None):
    settings = load_launch_configuration(filename)
    if settings.get("launch") or settings.get("snapshot_file"):
        raise ValueError("Migration requires a version-1 partitioned legacy profile")
    destination = _guard_path(Path(output).absolute())
    if destination.exists():
        raise FileExistsError("Choose a new output directory; migration never replaces an existing environment")
    maps = dict(value.split("=", 1) for value in settings["path_map"])
    sources = load_legacy_sources(settings["source_yaml"], legacy_root=settings["legacy_root"], allow_roots=settings["allow_root"],
                                  path_maps=maps, timezone=settings["timezone"], dialect=settings["dialect"], document=settings["source_document"])
    if any(item["severity"] == "error" for item in sources.diagnostics) or sources.approved_predicates:
        raise ValueError("Unsupported sources or approved source predicates need explicit migration; no configuration was written")
    protected = [Path(source.root) for source in sources.sources]
    if any(destination == root or destination.is_relative_to(root) or root.is_relative_to(destination) for root in protected):
        raise DomainError("legacy_state_path", "Migration output must be disjoint from source authorities.", 403)
    if settings["model"] is None:
        model = {"params": [{"title": "Migrated timeline", "date": "current_time", "timeZone": settings["timezone"]}],
                 "bands": [{"name": "primary", "height": "75%", "intervalPixels": 200, "intervalUnit": "HOUR"},
                           {"name": "overview", "height": "25%", "intervalPixels": 200, "intervalUnit": "DAY"}]}
    else:
        model, _ = parse_legacy_json(safe_read(settings["model"], settings["legacy_root"], 1024 * 1024), "strict")
    entries = [entry for entry in settings["source_document"]["data_sources"] if entry["enable"]]
    selected = []
    for index, (source, entry) in enumerate(zip(sources.sources, entries)):
        selected.append({"id": f"source{index + 1}", "namespace": source.namespace, "type": "json_file", "enable": True,
                         "data_path": str(source.root), "data_model": source.data_model,
                         "identity_path": entry.get("identity_path", entry["data_model"]),
                         "timezone": source.timezone, "dialect": source.dialect,
                         **({"render": entry["render"]} if "render" in entry else {})})
    if not selected:
        raise ValueError("Migration requires at least one enabled source")
    grouping = ("namespace" if settings["namespace_grouping"] is True else "none" if settings["namespace_grouping"] is False
                else model["bands"][0].get("model", [{}])[0].get("sortBy", "none"))
    selected_filter = {"version": 1, "name": "Migrated filter", "source_ids": [entry["id"] for entry in selected], "group_by": grouping,
                       "expression": None, "search": {"text": "", "mode": "any"},
                       "initial_range": initial_range if initial_range is not None else settings["loading"].get("initialRange", "current_time")}
    profile = {"version": 2, "server": {"host": settings["host"], "port": settings["port"], "local_browser": settings["local_browser"],
               "state_root": "../var", "startup_mode": "background" if settings["background_startup"] else "foreground",
               "data_loading": "lazy" if settings["lazy"] else "eager"},
               "model": "../models/timeline.json", "filter": "../filters/timeline.json", "data_sources": selected,
               "loading": {"buffer_ratio": settings["loading"]["bufferRatio"], "cache_mib": settings["loading"]["cacheMiB"],
                           "index_refresh_seconds": settings["loading"]["indexRefreshSeconds"]}}
    report = {"version": 1, "originalProfile": str(settings["source_yaml"]), "sourceIds": {entry["id"]: source.id for entry, source in zip(selected, sources.sources)},
              "originalStateRoot": str(settings["state_root"]), "statePolicy": "Fresh state; original history and preferences remain untouched at originalStateRoot",
              "initialRange": selected_filter["initial_range"], "modelDatePolicy": "Preserved as migration metadata; only filter.initial_range controls opening time"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".openbexi-migrate-", dir=destination.parent) as temporary:
        staging = _guard_path(temporary)
        for name in ("yaml", "models", "filters"):
            (staging / name).mkdir()
        (staging / "models/timeline.json").write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
        (staging / "filters/timeline.json").write_text(json.dumps(selected_filter, indent=2) + "\n", encoding="utf-8")
        (staging / "migration-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        # Activate inside staging only after every referenced definition exists.
        (staging / "yaml/timeline.yml").write_text(yaml.safe_dump(profile, sort_keys=False), encoding="utf-8")
        validated = load_launch_configuration(staging / "yaml/timeline.yml")
        if validated["launch"]["sourceAliases"] != report["sourceIds"]:
            raise ValueError("Migration would change canonical source identity")
        if destination.exists():
            raise FileExistsError("Migration destination appeared while preparing files")
        os.rename(staging, destination)
    return destination / "yaml/timeline.yml"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yaml", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--initial-from")
    parser.add_argument("--initial-to")
    args = parser.parse_args()
    if bool(args.initial_from) != bool(args.initial_to):
        parser.error("--initial-from and --initial-to must be supplied together")
    try:
        path = migrate_profile(args.yaml, args.output, initial_range={"from": args.initial_from, "to": args.initial_to} if args.initial_from else None)
    except (DomainError, ValueError, OSError) as error:
        parser.error(str(error))
    print(path)


if __name__ == "__main__":
    main()
