import { ProviderError } from './data-provider.js';
import { resolveQueryConfiguration } from './query-configuration.js';
import { toMs, toIso, MAX_TIME } from '../timeline/time-scale.js';

const merge = ranges => {
  const merged = [];
  for (const pair of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && pair[0] <= last[1]) last[1] = Math.max(last[1], pair[1]);
    else merged.push([...pair]);
  }
  return merged;
};
function bisect(values, value, offset, right) {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2), found = values[middle][offset];
    if (found < value || right && found === value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function createDateAvailability({ records, ...snapshot }) {
  const bySource = new Map(), predicate = resolveQueryConfiguration(snapshot, {}).predicate;
  for (const record of records) {
    if (!predicate(record)) continue;
    const start = toMs(record.start), end = record.end === null ? MAX_TIME + 2 : toMs(record.end);
    if (!bySource.has(record.sourceId)) bySource.set(record.sourceId, []);
    bySource.get(record.sourceId).push([start, record.kind === 'event' || end === start ? start + 1 : end]);
  }
  for (const [source, values] of bySource) bySource.set(source, merge(values));
  return request => {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['range', 'filters', 'definitionVersion'].includes(key))) throw new ProviderError('invalid_date_availability', 'Date availability requires a range and source selection', 422);
    if (!request.range || typeof request.range !== 'object' || Array.isArray(request.range) || Object.keys(request.range).sort().join(',') !== 'from,to') throw new ProviderError('invalid_date_availability', 'A finite range is required', 422);
    let low, high;
    try {
      if (typeof request.range.from !== 'string' || typeof request.range.to !== 'string') throw new Error('ISO strings required');
      low = toMs(request.range.from); high = toMs(request.range.to);
    } catch { throw new ProviderError('invalid_datetime', 'Dates require bounded timezone-qualified ISO instants', 422); }
    if (low >= high) throw new ProviderError('invalid_date_availability', 'Range end must follow its start', 422);
    const resolved = resolveQueryConfiguration(snapshot, request);
    const sources = snapshot.manifest.scope.sourceIds.filter(source => resolved.sourceSelected(source)).sort().map(sourceId => {
      const values = bySource.get(sourceId) || [], left = bisect(values, low, 0, false) - 1, right = bisect(values, high, 1, true);
      const previous = left >= 0 ? Math.min(values[left][1] - 1, low - 1) : null;
      const next = right < values.length ? Math.max(values[right][0], high) : null;
      const ongoing = !!values.length && values.at(-1)[1] > MAX_TIME + 1;
      return { sourceId, first: values.length ? toIso(values[0][0]) : null, last: values.length && !ongoing ? toIso(values.at(-1)[1] - 1) : null,
        ongoing, previous: previous === null ? null : toIso(previous), next: next === null || next > MAX_TIME ? null : toIso(next) };
    });
    const chronological = (a, b) => toMs(a) - toMs(b);
    const previous = sources.map(source => source.previous).filter(Boolean).sort(chronological), next = sources.map(source => source.next).filter(Boolean).sort(chronological);
    return { range: { ...request.range }, scope: 'selected-sources', complete: true, sources, previous: previous.at(-1) || null, next: next[0] || null };
  };
}
