"""Bounded metadata inventory of an admitted query, independent of filter authorization."""
from ..models.domain import DomainError
from .preparation_control import checkpoint, checked

GROUPING_LIMITS = {"records": 100000, "fields": 256, "nodes": 1000000, "depth": 8}
EXCLUDED = {"title", "description", "text", "analyze", "sortByValue", "__proto__", "prototype", "constructor"}


def scalar_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string" if isinstance(value, str) else None


def discover_grouping_fields(records, *, complete=True, limits=None):
    limits = limits or GROUPING_LIMITS
    fields, scanned, nodes, truncated, exhausted = {}, 0, 0, False, False
    for record in checked(sorted(records, key=encounter_key())):
        if scanned >= limits["records"]:
            truncated = True
            break
        stack = [(record.get("data", {}), "/data", 0)]
        while stack and not exhausted:
            data, base, depth = stack.pop()
            if not isinstance(data, dict):
                continue
            for key in sorted(data, reverse=True):
                nodes += 1
                if nodes > limits["nodes"]:
                    truncated = exhausted = True
                    break
                if nodes % 64 == 0:
                    checkpoint()
                if not key or key in EXCLUDED:
                    continue
                value = data[key]
                path = base + "/" + key.replace("~", "~0").replace("/", "~1")
                if len(path) > 256:
                    truncated = True
                    continue
                if base == "/data/legacy" and key in record["data"] and scalar_type(record["data"][key]):
                    continue
                kind = scalar_type(value)
                if path not in fields:
                    if len(fields) >= limits["fields"]:
                        truncated = True
                        continue
                    parts = path.split("/")[3 if path.startswith("/data/legacy/") else 2:]
                    fields[path] = {"path": path, "label": " / ".join(part.replace("~1", "/").replace("~0", "~") for part in parts),
                                    "types": set(), "count": 0, "structured": False}
                field = fields[path]
                if kind:
                    field["types"].add(kind)
                    field["count"] += 1
                elif isinstance(value, (dict, list)):
                    field["structured"] = True
                    if isinstance(value, dict):
                        if depth + 1 < limits["depth"]:
                            stack.append((value, path, depth + 1))
                        else:
                            truncated = True

        if exhausted:
            break
        scanned += 1
    return {"fields": [{"path": field["path"], "label": field["label"], "types": sorted(field["types"]), "count": field["count"]}
                       for path, field in sorted(fields.items()) if field["types"] and not field["structured"]],
            "complete": complete and not truncated, "truncated": truncated, "scannedRecords": scanned,
            "totalRecords": len(records), "scope": "query-domain", "limits": dict(limits)}


def encounter_key(source_ids=()):
    sources = {identity: index for index, identity in enumerate(source_ids)}
    return lambda record: (sources.get(record["sourceId"], len(sources)), record["sourceId"],
                           record.get("extensions", {}).get("legacy", {}).get("file", ""),
                           record.get("order", 0), record["id"])


def family_roots(records):
    by_id, roots = {record["id"]: record for record in records}, {}
    for record in checked(records):
        path, seen, current = [], set(), record
        while current and current["id"] not in roots:
            if current["id"] in seen or len(path) > 8:
                raise DomainError("invalid_parent", "Parent nesting is cyclic or too deep.")
            seen.add(current["id"])
            path.append(current["id"])
            parent = by_id.get(current.get("parentSessionId"))
            if parent is None:
                break
            current = parent
        root = roots.get(current["id"], current)
        for identity in path:
            roots[identity] = root
    return roots
