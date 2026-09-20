"""Portable file environments, compiled into the existing immutable catalogs.

Authored source IDs are aliases. Record identity remains tied to the legacy
identity path, so changing a friendly name cannot change records or descriptors.
"""
from __future__ import annotations

import copy
import hashlib
import re
from pathlib import Path
from functools import lru_cache

import portalocker

from ..models.domain import DomainError, instant_ms, iso_from_ms, json_bytes, parse_json, now_iso, read_json, _compile_schema
from ..models.configuration_catalog import normalize_configuration, _new_resource
from .legacy_reader import safe_read, SCHEMA_ID
from .legacy_sources import _guard_path, _logical_path, _zone, load_legacy_sources
from .legacy_json import parse_legacy_json

_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_ACTOR = {"id": "launch-environment", "capabilities": ["*"]}
_BYTES = 16 * 1024 * 1024


@lru_cache(maxsize=2)
def _file_validator(kind):
    return _compile_schema(read_json(Path(__file__).resolve().parents[3] / "shared/schemas" / f"launch-{kind}.schema.json"), [])


def _validate_file(kind, document):
    errors = list(_file_validator(kind).iter_errors(document))
    if errors:
        raise DomainError("invalid_launch_configuration", f"Invalid {kind}: {errors[0].message}")


def _shape(value, allowed, required, label):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise ValueError(f"{label} requires {', '.join(required)}; allowed keys: {', '.join(sorted(allowed))}")
    return value


def load_environment(document, path, state_root, resolve):
    """Resolve v2 paths without the working directory or legacy checkout defaults."""
    _validate_file("profile", document)
    model = resolve(document.get("model"), "model")
    filter_path = resolve(document.get("filter"), "filter")
    # Validate both input files before starting a server or creating state.
    model_document, _ = parse_legacy_json(safe_read(model, model.parent, 1024 * 1024), "strict")
    if not isinstance(model_document, dict):
        raise ValueError("model must contain a legacy params/bands object")
    selected_filter = parse_json(safe_read(filter_path, filter_path.parent, 65536))
    _validate_file("filter", selected_filter)
    _shape(selected_filter, {"version", "name", "source_ids", "group_by", "expression", "search", "initial_range"},
           {"version", "name", "source_ids"}, "filter")
    if type(selected_filter["version"]) is not int or selected_filter["version"] != 1:
        raise ValueError("Filter file version must be 1")
    if not isinstance(selected_filter["name"], str) or not 1 <= len(selected_filter["name"].strip()) <= 100:
        raise ValueError("filter.name must contain 1 to 100 characters")
    initial = selected_filter.get("initial_range", "current_time")
    if initial != "current_time":
        _shape(initial, {"from", "to"}, {"from", "to"}, "filter.initial_range")
        low, high = instant_ms(initial["from"]), instant_ms(initial["to"])
        if low >= high:
            raise ValueError("filter.initial_range.to must follow from")
        initial = {"from": iso_from_ms(low), "to": iso_from_ms(high)}
    entries = document.get("data_sources")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ValueError("data_sources requires 1 to 100 source definitions")
    normalized, roots, aliases = [], [], set()
    for entry in entries:
        _shape(entry, {"id", "namespace", "type", "enable", "data_path", "data_model", "timezone", "dialect", "render", "identity_path"},
               {"id", "namespace", "type", "enable", "data_path", "data_model"}, "data_sources entry")
        alias = entry["id"]
        if not isinstance(alias, str) or not _ID.fullmatch(alias) or alias in aliases:
            raise ValueError("Source IDs must be unique 1 to 128 character identifiers")
        aliases.add(alias)
        if type(entry["enable"]) is not bool or entry["type"] != "json_file":
            raise ValueError("Version 2 supports only explicit boolean enable and type json_file")
        root = resolve(entry["data_path"], "data_sources.data_path")
        template = entry["data_model"]
        if template not in ("yyyy", "yyyy/mm", "yyyy/mm/dd"):
            raise ValueError("Version 2 data_model must be yyyy, yyyy/mm, or yyyy/mm/dd beneath data_path")
        _zone(entry.get("timezone", "UTC"))
        if entry.get("dialect", "strict") not in ("strict", "legacy-json"):
            raise ValueError("Source dialect must be strict or legacy-json")
        identity_path = _logical_path(entry.get("identity_path", root.as_posix() + "/" + template))
        if not identity_path.endswith("/" + template):
            raise ValueError("identity_path must preserve the complete legacy logical data_model path")
        normalized.append({"namespace": entry["namespace"], "type": "json_file", "enable": entry["enable"],
                           "data_path": root.as_posix(), "data_model": root.as_posix() + "/" + template,
                           "identity_path": identity_path, "source_alias": alias,
                           "timezone": entry.get("timezone", "UTC"), "dialect": entry.get("dialect", "strict"),
                           **({"render": entry["render"]} if "render" in entry else {})})
        roots.append(str(root))
    protected = [Path(root) for root in roots] + [model.parent, filter_path.parent]
    if any(state_root == root or state_root.is_relative_to(root) or root.is_relative_to(state_root) for root in protected):
        raise DomainError("legacy_state_path", "Server state must remain disjoint from data, model and filter roots.", 403)
    source_document = {"data_sources": normalized}
    sources = load_legacy_sources(path, legacy_root=path.parent, allow_roots=roots, document=source_document)
    if any(item["severity"] == "error" for item in sources.diagnostics):
        raise ValueError("Enabled source is unavailable or unsupported")
    selected = selected_filter["source_ids"]
    if (not isinstance(selected, list) or not 1 <= len(selected) <= 100 or any(not isinstance(value, str) for value in selected)
            or len(set(selected)) != len(selected) or any(value not in sources.aliases for value in selected)):
        raise ValueError("filter.source_ids must select unique enabled YAML source IDs")
    grouping = selected_filter.get("group_by", "none")
    if not isinstance(grouping, str):
        raise ValueError("filter.group_by must be none or a safe metadata path")
    if grouping not in ("none", "NONE"):
        if grouping.startswith("/data/"):
            if not re.fullmatch(r"/data/(?:[^~/\x00-\x1f]|~[01])+(?:/(?:[^~/\x00-\x1f]|~[01])+){0,7}", grouping) or len(grouping) > 256:
                raise ValueError("filter.group_by must be a bounded JSON pointer into data")
        elif re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,7}", grouping, re.ASCII):
            prefix = "/data/" if grouping in ("namespace", "status", "description", "text", "system", "type", "priority") else "/data/legacy/"
            grouping = prefix + grouping.replace(".", "/")
        else:
            raise ValueError("filter.group_by must be none or a safe metadata path")
    search = selected_filter.get("search", {})
    _shape(search, {"text", "mode", "caseSensitive", "fields", "flags", "matchMode", "dialect"}, set(), "filter.search")
    search = {"text": "", "mode": "any", "fields": ["/title"], **search}
    if search["mode"] != "regex":
        search.setdefault("caseSensitive", False)
    definition = {"definitionVersion": 2, "relationshipMode": "family",
                  "sourceIds": [sources.aliases[value] for value in selected], "kinds": ["event", "session"],
                  "schemaRefs": [{"id": SCHEMA_ID, "version": 1}],
                  "expression": selected_filter.get("expression"), "search": search}
    # Compile filters using the same registry and validator as catalog publications.
    from ..models.configuration_catalog import REGISTRY_BASE
    from .filters import compile_expression, compile_search
    registry = {**REGISTRY_BASE, "/data/namespace": "string"}
    compile_expression(definition["expression"], field_types=registry)
    compile_search({"search": search["text"], "searchMode": search["mode"], "searchFields": search["fields"],
                    **({"searchFlags": search.get("flags", []), "searchMatchMode": search.get("matchMode", "search"),
                        "searchDialect": search.get("dialect", "re2-common-v1")} if search["mode"] == "regex"
                       else {"searchCaseSensitive": search["caseSensitive"]})}, field_types=registry)
    launch = {"version": 2, "profile": str(path), "model": str(model), "filter": str(filter_path),
              "sourceAliases": sources.aliases, "initialRange": initial, "groupBy": grouping,
              "filterName": selected_filter["name"], "filterDefinition": definition}
    return {"source_document": source_document, "legacy_root": path.parent, "allow_root": roots,
            "path_map": [], "model": model, "model_root": model.parent, "launch": launch,
            "namespace_grouping": False, "timezone": "UTC", "dialect": "strict"}


def apply_environment(snapshot, launch, state_root, *, persist=False):
    """Publish content-addressed inputs, retaining earlier immutable file imports."""
    result = snapshot
    stamp = result["manifest"]["snapshotAt"]
    definition = launch["filterDefinition"]
    digest = hashlib.sha256(json_bytes({"name": launch["filterName"], "definition": definition,
                                      "groupBy": launch["groupBy"], "initialRange": launch["initialRange"]})).hexdigest()
    filter_id = "launch-filter-" + digest[:32]
    resource = _new_resource(filter_id, launch["filterName"], definition, "filters", _ACTOR["id"], stamp, "workspace")
    resource.update(draft=None, versions=[{"version": 1, "publishedAt": stamp, "publishedBy": _ACTOR["id"], "definition": copy.deepcopy(definition)}])
    if not any(item["id"] == filter_id for item in result["filters"]):
        result["filters"].append(resource)
    settings = result["settings"]
    settings.update(filterId=filter_id, filterVersion=1, viewId=None, viewVersion=None, definitionVersion=2,
                    relationshipMode=definition["relationshipMode"], search=copy.deepcopy(definition["search"]))
    presentation = settings.setdefault("presentation", {"version": 1})
    presentation.pop("grouping", None)
    if launch["groupBy"] not in ("none", "NONE"):
        presentation["grouping"] = {"field": launch["groupBy"], "direction": "asc", "recordPolicy": "parent-family", "order": "encounter"}
    now = launch.setdefault("referenceTime", now_iso())
    bounds = launch["initialRange"]
    if bounds == "current_time":
        center = instant_ms(now)
        bounds = {"from": iso_from_ms(center - 1800000), "to": iso_from_ms(center + 1800000)}
    reference = now if launch["initialRange"] == "current_time" else iso_from_ms((instant_ms(bounds["from"]) + instant_ms(bounds["to"])) // 2)
    settings.update(range=copy.deepcopy(bounds), overview=copy.deepcopy(bounds), referenceTime=reference)
    public = {key: copy.deepcopy(value) for key, value in launch.items() if key not in ("filterDefinition", "filterName", "groupBy")}
    public["settings"] = copy.deepcopy(settings)
    legacy = result["manifest"].setdefault("legacy", {})
    legacy["launch"] = public
    legacy["loading"] = {**legacy.get("loading", {}), **({"initialRange": copy.deepcopy(bounds)} if launch["initialRange"] != "current_time" else {})}
    if "viewHints" in legacy:
        legacy["viewHints"]["focus"] = {"mode": "fixed", "timestamp": reference}
    if persist:
        _retain_publications(result, state_root)
    # Validate only metadata; the reader has already validated and bounded records.
    records = result["records"]
    metadata = {**result, "records": [], "manifest": {**result["manifest"], "recordCount": 0}}
    normalized = normalize_configuration(metadata, _ACTOR)
    normalized["records"] = records
    normalized["manifest"]["recordCount"] = len(records)
    normalized["manifest"].pop("contentSha256", None)
    return normalized


def _retain_publications(snapshot, state_root):
    """One locked atomic state file retains old pins without changing input files."""
    from ..repositories.json_repository import atomic_json
    root = _guard_path(state_root)
    root.mkdir(parents=True, exist_ok=True)
    path = _guard_path(root / "launch-catalog.json")
    authority = hashlib.sha256(json_bytes(sorted(snapshot["manifest"]["scope"]["sourceIds"]))).hexdigest()
    with portalocker.Lock(str(_guard_path(root / "launch-catalog.lock")), mode="a+b", timeout=2):
        document = {"version": 1, "authority": authority, "models": [], "filters": []}
        if path.exists():
            document = parse_json(safe_read(path, root, _BYTES))
            checksum = document.pop("sha256", None)
            if (set(document) != {"version", "authority", "models", "filters"} or document["version"] != 1
                    or document["authority"] != authority or checksum != hashlib.sha256(json_bytes(document)).hexdigest()):
                raise DomainError("launch_catalog_integrity", "Launch publication history belongs to different sources or is damaged.", 409)
        changed = not path.exists()
        for family, prefix in (("models", "legacy-presentation-"), ("filters", "launch-filter-")):
            current = {item["id"]: item for item in snapshot[family]}
            history = {item["id"]: item for item in document[family]}
            for identity, item in current.items():
                if identity.startswith(prefix) and identity not in history:
                    history[identity] = copy.deepcopy(item)
                    changed = True
            if len(history) > 90:
                raise DomainError("launch_catalog_capacity", "Launch history has reached 90 publications; archive unused environments explicitly.", 413)
            document[family] = list(history.values())
            current.update(history)
            snapshot[family] = list(current.values())
        # Validate before persistence, including historical references.
        normalize_configuration({**snapshot, "records": [], "manifest": {**snapshot["manifest"], "recordCount": 0}}, _ACTOR)
        if changed:
            if len(json_bytes(document)) > _BYTES:
                raise DomainError("launch_catalog_capacity", "Launch publication history exceeds 16 MiB.", 413)
            atomic_json(path, {**document, "sha256": hashlib.sha256(json_bytes(document)).hexdigest()})
