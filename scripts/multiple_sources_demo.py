"""Build the bounded, reproducible two-source browser preview from copied archives."""

import copy
import hashlib
import json
import uuid
from collections import Counter

from server.app.models.domain import validate_snapshot
from server.app.services.launch_configuration import load_launch_configuration
from server.app.services.launch_environment import apply_environment
from server.app.services.legacy_presentation import adapt_legacy_presentation, apply_legacy_presentation
from server.app.services.legacy_reader import LegacyReader
from server.app.services.legacy_sources import load_legacy_sources

STAMP = "2026-09-20T00:00:00.000Z"


def convert_multiple_sources(root, profile, *, check=False):
    config = load_launch_configuration(root / profile["serverYaml"])
    sources = load_legacy_sources(config["source_yaml"], legacy_root=config["legacy_root"],
                                  allow_roots=config["allow_root"], document=config["source_document"])
    selected = {}
    inputs = {}
    for name in [*profile["originals"], profile["serverYaml"], profile["model"], profile["filter"]]:
        inputs[name] = hashlib.sha256((root / name).read_bytes()).hexdigest()
    for source in sources.sources:
        selected[source.id] = [root / name for name in profile["originals"]
                               if (root / name).is_relative_to(source.root)]
        if len(selected[source.id]) != 1:
            raise ValueError("Each preview source must explicitly select one event file")
    reader = LegacyReader(sources.sources, allow_roots=config["allow_root"], source_name="SOURCE1 / SOURCE2 preview")
    reader._created_at = STAMP
    reader.generation = str(uuid.uuid5(uuid.NAMESPACE_URL, "openbexi:multiple_sources_test:v1"))
    bounds = config["loading"]["initialRange"]
    result = reader.scan(time_range=bounds, file_selection=selected)
    if result.report["status"] != "current":
        raise ValueError(f"Preview source conversion is incomplete: {result.report['diagnostics']}")
    snapshot = result.snapshot
    snapshot["manifest"]["snapshotAt"] = STAMP
    descriptors = Counter()
    for record in snapshot["records"]:
        record["createdAt"] = record["updatedAt"] = STAMP
        if str(record["data"].get("description", "")).strip():
            continue
        descriptor = reader.descriptor(record)
        descriptors[descriptor["status"]] += 1
        if descriptor["status"] == "current":
            source = next(source for source in sources.sources if source.id == record["sourceId"])
            path = (source.root / descriptor["file"]).relative_to(root).as_posix()
            inputs[path] = descriptor["sha256"]
            record["extensions"]["legacy"]["descriptor"] = descriptor
            description = descriptor["descriptor"].get("data", {}).get("description")
            if isinstance(description, str):
                record["data"]["description"] = description
    model = json.loads((root / profile["model"]).read_text(encoding="utf-8"))
    adapted = adapt_legacy_presentation(model, source_bindings=sources.render_sources, focus="current_time")
    snapshot = apply_legacy_presentation(snapshot, adapted)
    launch = {**copy.deepcopy(config["launch"]), "profile": profile["serverYaml"],
              "model": profile["model"], "filter": profile["filter"], "referenceTime": STAMP}
    snapshot = apply_environment(snapshot, launch, config["state_root"])
    snapshot["manifest"]["testDataset"] = {"id": profile["id"], "reference": None, "referenceStatus": "unapproved-baseline"}
    digest = hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    snapshot["manifest"].update(bundleId=str(uuid.uuid5(uuid.NAMESPACE_URL, digest)),
                                generation=str(uuid.uuid5(uuid.NAMESPACE_URL, "multiple_sources_test:" + digest)))
    snapshot["manifest"]["legacy"].update(preview=True, fullArchiveProfile=profile["serverYaml"])
    validate_snapshot(snapshot)
    records = snapshot["records"]
    report = {"id": profile["id"], "inputFormat": "partitioned-legacy-json", "inputSha256": digest,
              "inputs": inputs, "inputRecords": result.report["allRecordCount"], "outputRecords": len(records),
              "droppedRecords": result.report["allRecordCount"] - len(records), "uncertainRecords": 0,
              "referenceStatus": "unapproved-baseline", "domain": result.report["domain"],
              "declaredRange": bounds, "sourceCounts": dict(sorted(Counter(record["data"]["namespace"] for record in records).items())),
              "descriptors": dict(descriptors), "diagnostics": result.report["diagnostics"],
              "scope": "Complete records from the two named event files; the full copied year is available through serverYaml.",
              "serverYaml": profile["serverYaml"], "unbundledOriginalAssets": [], "dateReview": [], "generatedTitles": []}
    for name, value in ((profile["file"], snapshot), (profile["report"], report)):
        target = root / name
        encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
        if check:
            if not target.is_file() or target.read_text(encoding="utf-8") != encoded:
                raise ValueError(f"Generated fixture is out of date: {target}")
        else:
            target.write_text(encoded, encoding="utf-8")
    print(f"{profile['id']}: {len(records)} preview records; namespaces {report['sourceCounts']}")
