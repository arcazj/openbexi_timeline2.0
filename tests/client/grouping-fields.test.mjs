import test from 'node:test';
import assert from 'node:assert/strict';
import initial from '../../shared/fixtures/initial-snapshot.json' with { type: 'json' };
import { discoverGroupingFieldsSteps, GROUPING_LIMITS } from '../../client/src/data/grouping-fields.js';
import { drainQuerySteps } from '../../client/src/data/query-work.js';
import { createQueryData } from '../../client/src/data/query-core.js';
import { buildLayout } from '../../client/src/timeline/layout.js';

const domain = { from: '2026-09-12T10:00:00.000Z', to: '2026-09-12T12:00:00.000Z' };
const make = (id, data, extra = {}) => ({ ...structuredClone(initial.records[0]), id, order: Number(id.replace(/\D/g, '')) || 0,
  sourceId: 'SOURCE1', kind: 'session', start: domain.from, end: domain.to, parentSessionId: null, render: {}, data, ...extra });
const inventory = (records, options) => drainQuerySteps(discoverGroupingFieldsSteps(records, options));

test('inventory unions later JSON keys, typed scalars and escaped paths without authorizing filters', () => {
  const records = [make('one', { status: '1', title: 'hidden', description: 'hidden', legacy: { status: '1', magType: 'mw' }, mixed: 1, shape: 'x' }),
    make('two', { status: 1, later: true, mixed: null, nested: { 'a/b': false, '~': 'value' }, shape: { child: 'yes' } })];
  const found = inventory(records);
  assert.equal(found.complete, true); assert.equal(found.scannedRecords, 2);
  assert.deepEqual(found.fields.find(field => field.path === '/data/status').types, ['number', 'string']);
  assert.deepEqual(found.fields.find(field => field.path === '/data/mixed').types, ['null', 'number']);
  assert.equal(found.fields.find(field => field.path === '/data/legacy/magType').label, 'magType');
  assert.ok(found.fields.some(field => field.path === '/data/nested/a~1b'));
  assert.ok(found.fields.some(field => field.path === '/data/nested/~0'));
  for (const path of ['/data/title', '/data/description', '/data/legacy/status', '/data/shape']) assert.equal(found.fields.some(field => field.path === path), false);
  assert.deepEqual(inventory([...records].reverse()), found);
});

test('inventory caps records, fields and nodes and exposes provisional coverage', () => {
  const records = [make('r1', { a: 1, b: 2 }), make('r2', { c: 3 })];
  for (const limits of [{ ...GROUPING_LIMITS, records: 1 }, { ...GROUPING_LIMITS, fields: 1 }, { ...GROUPING_LIMITS, nodes: 1 }]) {
    const found = inventory(records, { limits }); assert.equal(found.complete, false); assert.equal(found.truncated, true);
    assert.ok(found.fields.length <= limits.fields); assert.ok(found.scannedRecords <= limits.records);
  }
  assert.equal(inventory(records, { complete: false }).complete, false);
});

test('query inventory excludes other time windows and disabled sources and is independent of row pagination', () => {
  const snapshot = structuredClone(initial);
  snapshot.records = [make('r1', { status: 'ok' }), make('r2', { later: 'yes' }),
    make('r3', { futureOnly: true }, { start: '2027-01-01T00:00:00.000Z', end: '2027-01-02T00:00:00.000Z' }),
    make('r4', { otherSourceOnly: true }, { sourceId: 'SOURCE2' })];
  const query = createQueryData(snapshot, { domain, filters: { sourceIds: ['SOURCE1'] } });
  assert.deepEqual(query.groupingFields.fields.map(field => field.path), ['/data/later', '/data/status']);
  assert.equal(query.fieldTypes['/data/later'], undefined);
});

test('legacy parent families preserve typed first encounter groups across reordering and page sizes', () => {
  const parent = make('p1', { status: 'Z' }, { order: 0, extensions: { legacy: { file: 'a.json' } } });
  const child = make('c1', { status: 'A' }, { order: 1, parentSessionId: parent.id, extensions: parent.extensions });
  const records = [child, make('p2', { status: 1 }, { order: 2 }), make('p3', { status: '1' }, { order: 3 }), parent];
  const map = { knots: [{ timeMs: Date.parse(domain.from), u: '0' }, { timeMs: Date.parse(domain.to), u: '1' }] };
  const input = { ...domain, from: Date.parse(domain.from), to: Date.parse(domain.to), width: 800, rowHeight: 32, fontSize: 13,
    definitionVersion: 2, presentation: { version: 1, grouping: { field: '/data/status', direction: 'asc', order: 'encounter', recordPolicy: 'parent-family' }, nesting: { enabled: true } } };
  const result = buildLayout(records, map, { ...input, availableHeight: 480 });
  // Records without legacy provenance sort before a.json; within each source/file, numeric order wins.
  assert.deepEqual(result.rows.filter(row => row.type === 'group').map(row => row.key), ['number:1', 'string:1', 'string:Z']);
  assert.equal(result.items.find(item => item.record.id === child.id).depth, 1);
  for (const height of [128, 480]) {
    const reordered = buildLayout([...records].reverse(), map, { ...input, availableHeight: height });
    assert.deepEqual([...new Set(reordered.rows.filter(row => row.type === 'group').map(row => row.key))], ['number:1', 'string:1', 'string:Z']);
  }
  const canonical = buildLayout(records, map, { ...input, availableHeight: 480, presentation: { version: 1, grouping: { field: '/data/status' }, nesting: { enabled: true } } });
  assert.ok(canonical.rows.some(row => row.key === 'string:A'));
  assert.equal(canonical.items.find(item => item.record.id === child.id).depth, 0);
});
