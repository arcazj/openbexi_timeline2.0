// Observed presentation metadata is separate from the typed predicate registry.
// Work stays inside the admitted query; no source reads or archive scan occur here.
export const GROUPING_LIMITS = Object.freeze({ records: 100000, fields: 256, nodes: 1000000, depth: 8 });
const excluded = new Set(['title', 'description', 'text', 'analyze', 'sortByValue', '__proto__', 'prototype', 'constructor']);
const escape = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
const label = path => path.replace(/^\/data\/(?:legacy\/)?/, '').split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).join(' / ');
const scalarType = value => value === null ? 'null' : ['string', 'number', 'boolean'].includes(typeof value) ? typeof value : null;
const compareText = (left, right) => {
  if (left === right) return 0;
  const a = [...left], b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const delta = a[i].codePointAt(0) - b[i].codePointAt(0); if (delta) return delta; }
  return a.length - b.length;
};

export function* discoverGroupingFieldsSteps(records, { complete = true, limits = GROUPING_LIMITS } = {}) {
  const fields = new Map(); let scannedRecords = 0, nodes = 0, truncated = false;
  outer: for (const record of [...records].sort(encounterComparator())) {
    if (scannedRecords >= limits.records) { truncated = true; break; }
    const stack = [{ value: record.data, path: '/data', depth: 0 }];
    while (stack.length) {
      const entry = stack.pop();
      if (!entry.value || Array.isArray(entry.value) || typeof entry.value !== 'object') continue;
      // JSON object insertion order is not a contract. Code-point order is stable in both providers.
      const keys = Object.keys(entry.value).sort(compareText).reverse();
      for (const key of keys) {
        if (++nodes > limits.nodes) { truncated = true; break outer; }
        if (nodes % 64 === 0) yield;
        if (!key || excluded.has(key)) continue;
        const value = entry.value[key], path = `${entry.path}/${escape(key)}`, depth = entry.depth + 1;
        if ([...path].length > 256) { truncated = true; continue; }
        // Governed scalar copies keep their canonical pointer; discover other raw legacy fields.
        if (entry.path === '/data/legacy' && Object.hasOwn(record.data, key) && scalarType(record.data[key])) continue;
        const type = scalarType(value);
        if (type) {
          if (!fields.has(path)) {
            if (fields.size >= limits.fields) { truncated = true; continue; }
            fields.set(path, { path, label: label(path), types: new Set(), count: 0, structured: false });
          }
          const field = fields.get(path); field.types.add(type); field.count++;
        } else if (value && typeof value === 'object') {
          // A path that is sometimes structured cannot be selected as a scalar group.
          if (fields.has(path)) fields.get(path).structured = true;
          else if (fields.size < limits.fields) fields.set(path, { path, label: label(path), types: new Set(), count: 0, structured: true });
          else { truncated = true; continue; }
          if (!Array.isArray(value)) {
            if (depth < limits.depth) stack.push({ value, path, depth });
            else truncated = true;
          }
        }
      }
    }
    scannedRecords++;
  }
  return { fields: [...fields.values()].filter(field => field.types.size && !field.structured)
    .map(({ path, label, types, count }) => ({ path, label, types: [...types].sort(), count }))
    .sort((a, b) => compareText(a.path, b.path)),
  complete: complete && !truncated, truncated, scannedRecords, totalRecords: records.length, scope: 'query-domain', limits: { ...limits } };
}

// Stable provenance, never response completion or hashed canonical-ID encounter order.
export function encounterComparator(sourceIds = []) {
  const sources = new Map(sourceIds.map((id, index) => [id, index]));
  const text = compareText;
  return (a, b) => (sources.get(a.sourceId) ?? sources.size) - (sources.get(b.sourceId) ?? sources.size)
    || text(a.sourceId, b.sourceId) || text(a.extensions?.legacy?.file ?? '', b.extensions?.legacy?.file ?? '')
    || (a.order ?? 0) - (b.order ?? 0) || text(a.id, b.id);
}

export function familyRoots(records) {
  const byId = new Map(records.map(record => [record.id, record])), roots = new Map();
  for (const record of records) {
    const path = [], seen = new Set(); let current = record;
    while (current && !roots.has(current.id)) {
      if (seen.has(current.id) || path.length > 8) throw Object.assign(new Error('Parent nesting is cyclic or too deep'), { code: 'invalid_parent', status: 422 });
      seen.add(current.id); path.push(current.id);
      const parent = byId.get(current.parentSessionId);
      if (!parent) break;
      current = parent;
    }
    const root = roots.get(current.id) ?? current;
    for (const id of path) roots.set(id, root);
  }
  return roots;
}
