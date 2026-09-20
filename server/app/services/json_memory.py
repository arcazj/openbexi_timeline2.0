"""Conservative bounded heap estimates for acyclic JSON values."""
import sys

from .preparation_control import checkpoint


def json_heap_size(value, maximum):
    total = 0
    stack = [iter((value,))]
    work = 0
    while stack:
        work += 1
        if work % 64 == 0:
            checkpoint()
        item = next(stack[-1], stack)
        if item is stack:
            stack.pop()
            continue
        total += sys.getsizeof(item)
        if total > maximum:
            return total
        if isinstance(item, dict):
            for key in item:
                work += 1
                if work % 64 == 0:
                    checkpoint()
                total += sys.getsizeof(key)
                if total > maximum:
                    return total
            stack.append(iter(item.values()))
        elif isinstance(item, list):
            stack.append(iter(item))
    return total
