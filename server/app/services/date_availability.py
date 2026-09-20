"""Source-only date hints; record/search predicates do not imply archive coverage."""

from bisect import bisect_left, bisect_right

from ..models.domain import DomainError, instant_ms, iso_from_ms, MAX_INSTANT_MS
from .preparation_control import checked

MAX_TIME = MAX_INSTANT_MS


def record_intervals(records):
    values = []
    for record in checked(records):
        if record["deletedAt"] is not None:
            continue
        start = instant_ms(record["start"])
        end = instant_ms(record["end"]) if record["end"] is not None else MAX_TIME + 2
        values.append((start, start + 1 if record["kind"] == "event" or end == start else end))
    return merge_intervals(values)


def merge_intervals(values):
    merged = []
    for low, high in checked(sorted(values)):
        if merged and low <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], high)
        else:
            merged.append([low, high])
    return merged


def request_range(request):
    if not isinstance(request, dict) or set(request) - {"range", "filters", "definitionVersion"}:
        raise DomainError("invalid_date_availability", "Date availability requires a range and source selection.")
    bounds = request.get("range")
    if not isinstance(bounds, dict) or set(bounds) != {"from", "to"}:
        raise DomainError("invalid_date_availability", "A finite range is required.")
    low, high = instant_ms(bounds["from"]), instant_ms(bounds["to"])
    if low >= high:
        raise DomainError("invalid_date_availability", "Range end must follow its start.")
    return low, high


class DateAvailability:
    def __init__(self, sources):
        self.sources = {}
        for source, values in sources.items():
            ranges = merge_intervals(values)
            self.sources[source] = (ranges, [low for low, _ in ranges], [high for _, high in ranges])

    def read(self, source_ids, request, *, complete=True, index_version=None):
        low, high = request_range(request)
        items = []
        for source in sorted(source_ids):
            ranges, starts, ends = self.sources.get(source, ([], [], []))
            left, right = bisect_left(starts, low) - 1, bisect_right(ends, high)
            previous = min(ranges[left][1] - 1, low - 1) if left >= 0 else None
            following = max(ranges[right][0], high) if right < len(ranges) else None
            ongoing = bool(ends and ends[-1] > MAX_TIME + 1)
            items.append({"sourceId": source, "first": iso_from_ms(starts[0]) if starts else None,
                          "last": iso_from_ms(ends[-1] - 1) if ends and not ongoing else None,
                          "ongoing": ongoing, "previous": iso_from_ms(previous) if previous is not None else None,
                          "next": iso_from_ms(following) if following is not None and following <= MAX_TIME else None})
        previous = [item["previous"] for item in items if item["previous"] is not None]
        following = [item["next"] for item in items if item["next"] is not None]
        result = {"range": dict(request["range"]), "scope": "selected-sources", "complete": complete,
                  "sources": items, "previous": max(previous, key=instant_ms, default=None),
                  "next": min(following, key=instant_ms, default=None)}
        if index_version is not None:
            result["indexVersion"] = index_version
        return result
