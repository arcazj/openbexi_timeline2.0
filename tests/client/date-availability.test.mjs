import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDateAvailability } from '../../client/src/data/date-availability.js';
import { LocalProvider } from '../../client/src/data/local-provider.js';

const snapshot = JSON.parse(await readFile(new URL('../../shared/fixtures/initial-snapshot.json', import.meta.url)));
const at = day => `2024-01-${String(day).padStart(2, '0')}T12:00:00.000Z`;
function fixture() {
  const data = structuredClone(snapshot), sourceIds = ['operations', 'verification'];
  data.records = [
    { id: 'one', sourceId: sourceIds[0], kind: 'event', start: at(1), end: null, deletedAt: null },
    { id: 'later', sourceId: sourceIds[0], kind: 'event', start: at(20), end: null, deletedAt: null },
    { id: 'other', sourceId: sourceIds[1], kind: 'session', start: at(12), end: at(14), deletedAt: null },
    { id: 'deleted', sourceId: sourceIds[0], kind: 'event', start: at(10), end: null, deletedAt: at(11) },
  ];
  return data;
}

test('source dates cross empty intervals without advertising deleted records or other sources', () => {
  const read = createDateAvailability(fixture()), range = { from: at(10), to: at(11) };
  const all = read({ range });
  assert.equal(all.previous, at(1)); assert.equal(all.next, at(12));
  const selected = read({ range, filters: { sourceId: 'operations', kind: 'session' } });
  assert.equal(selected.next, at(20)); assert.equal(selected.previous, at(1));
  assert.equal(selected.scope, 'selected-sources'); assert.equal(selected.sources.length, 1);
  assert.equal(selected.sources[0].last, at(20));
  assert.deepEqual(read({ range, filters: { sourceIds: [] } }).sources, []);
  assert.equal(read({ range, filters: { sourceId: 'verification', sourceIds: ['operations'] } }).next, null);
});

test('session bounds are half-open and ongoing dates are explicit', () => {
  const data = fixture(); data.records.push({ id: 'open', sourceId: 'operations', kind: 'session', start: at(25), end: null, deletedAt: null });
  const read = createDateAvailability(data);
  const bounded = read({ range: { from: at(14), to: at(15) }, filters: { sourceId: 'verification' } });
  assert.equal(bounded.previous, '2024-01-14T11:59:59.999Z'); assert.equal(bounded.next, null);
  const ongoing = read({ range: { from: at(26), to: at(27) }, filters: { sourceId: 'operations' } });
  assert.equal(ongoing.next, at(27)); assert.equal(ongoing.sources[0].ongoing, true); assert.equal(ongoing.sources[0].last, null);
});

test('saved filter source scope intersects transient selection without applying content predicates', () => {
  const data = fixture();
  data.filters = [{ id: 'saved', visibility: 'workspace', ownerId: 'local', versions: [{ version: 1, definition: {
    sourceIds: ['verification'], kinds: ['event'], schemaRefs: [], expression: null,
    search: { text: 'no matching title', mode: 'any', caseSensitive: false, fields: ['/title'] },
  } }] }];
  const read = createDateAvailability(data), range = { from: at(10), to: at(11) };
  const selected = read({ range, filters: { filterId: 'saved', filterVersion: 1 } });
  assert.equal(selected.next, at(12)); assert.deepEqual(selected.sources.map(source => source.sourceId), ['verification']);
  assert.equal(read({ range, filters: { filterId: 'saved', filterVersion: 1, sourceId: 'operations' } }).next, null);
});

test('negative Gregorian years use chronological rather than lexicographic ordering', () => {
  const data = fixture(); data.records = data.records.slice(0, 2);
  Object.assign(data.records[0], { start: '-000500-01-01T00:00:00.000Z', sourceId: 'verification' });
  data.records[1].start = '-000200-01-01T00:00:00.000Z';
  const read = createDateAvailability(data);
  assert.equal(read({ range: { from: '0001-01-01T00:00:00Z', to: '0002-01-01T00:00:00Z' } }).previous, data.records[1].start);
});

test('an event at the final supported millisecond is finite', () => {
  const data = fixture(); data.records = [{ ...data.records[0], start: '9999-12-31T23:59:59.999Z' }];
  const result = createDateAvailability(data)({ range: { from: at(1), to: at(2) } });
  assert.equal(result.sources[0].ongoing, false); assert.equal(result.sources[0].last, data.records[0].start);
});

test('date request validation does not accept numeric timestamps or unexpected fields', () => {
  const read = createDateAvailability(fixture());
  for (const range of [{ from: 0, to: 1 }, { from: 'bad', to: at(2) }]) assert.throws(() => read({ range }), { code: 'invalid_datetime', status: 422 });
  for (const request of [null, {}, { range: { from: at(2), to: at(1) } }, { range: { from: at(1), to: at(2), extra: 1 } }]) assert.throws(() => read(request), { code: 'invalid_date_availability' });
});

test('Local provider offers source hints with generation and revision through a stable cache', async () => {
  const provider = new LocalProvider(snapshot); await provider.initialize();
  try {
    const request = { range: { from: '2020-01-01T00:00:00Z', to: '2020-01-02T00:00:00Z' }, filters: { sourceId: 'operations' } };
    const value = await provider.getDateAvailability(request), cached = provider.dateAvailability;
    assert.equal(value.generation, provider.generation); assert.equal(value.revision, provider.revision);
    assert.equal(value.sources.length, 1); assert.ok(value.next);
    assert.deepEqual(await provider.getDateAvailability(request), value); assert.equal(provider.dateAvailability, cached);
    await provider.executeCommand({ type: 'create', generation: provider.generation, clientCommandId: 'date-cache-record',
      payload: { kind: 'event', title: 'Earlier dated record', sourceId: 'operations', start: at(1) } });
    assert.equal((await provider.getDateAvailability(request)).next, at(1));
    assert.notEqual(provider.dateAvailability, cached); assert.equal(provider.dateAvailabilityRevision, provider.revision);
  } finally { provider.dispose(); }
});
