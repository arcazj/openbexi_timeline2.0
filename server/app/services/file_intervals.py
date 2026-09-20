"""Immutable per-source overlap lookup for disposable legacy file indexes."""
from bisect import bisect_left, bisect_right

from ..models.domain import instant_ms
from .preparation_control import checked


class FileIntervals:
    def __init__(self, entries):
        grouped = {}
        for entry in checked(entries):
            if entry["from"] is not None:
                grouped.setdefault(entry["sourceId"], []).append(
                    (instant_ms(entry["from"]), instant_ms(entry["to"]), entry["file"]))
        self.sources = {}
        for source, values in grouped.items():
            values.sort()
            starts, ends, prefix = [], [], []
            maximum = None
            for low, high, _ in values:
                starts.append(low)
                ends.append(high)
                maximum = high if maximum is None else max(maximum, high)
                prefix.append(maximum)
            self.sources[source] = (values, starts, ends, prefix)

    def overlapping(self, source, low, high):
        values, starts, ends, prefix = self.sources.get(source, ((), (), (), ()))
        left, right = bisect_right(prefix, low), bisect_left(starts, high)
        for index in checked(range(left, right)):
            if ends[index] > low:
                yield values[index][2]
