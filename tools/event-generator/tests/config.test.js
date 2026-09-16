import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG, CONFIG_FIELDS, ConfigError, normalizeConfig} from '../config.js';

const rejects = (input, pattern) => {
  assert.throws(() => normalizeConfig(input), error => error instanceof ConfigError && error.errors.some(message => pattern.test(message)));
};

test('defaults are complete, deeply independent and immutable', () => {
  const first = normalizeConfig({duration: {mode: 'fixed'}});
  assert.equal(first.duration.fixedMinutes, 60);
  first.duration.weights[0].minutes = 900;
  assert.equal(normalizeConfig().duration.weights[0].minutes, 15);
  assert.equal(DEFAULT_CONFIG.duration.weights[0].minutes, 15);
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.duration.weights[0]));
  for (const field of CONFIG_FIELDS) {
    assert.notEqual(field.path.split('.').reduce((object, key) => object[key], DEFAULT_CONFIG), undefined);
    assert.ok(field.description.length > 20, field.path);
  }
});

test('reports independent errors together and rejects unknown nested parameters', () => {
  assert.throws(() => normalizeConfig({pastCount: -1, futureCount: 1.5, typo: true, duration: {minimum: 2}}), error => {
    assert.ok(error instanceof ConfigError);
    for (const path of ['pastCount', 'futureCount', 'typo', 'duration.minimum']) assert.ok(error.errors.some(message => message.startsWith(`${path}:`)));
    return true;
  });
});

test('requires unambiguous valid dates and normalizes offsets to UTC', () => {
  assert.equal(normalizeConfig({referenceDate: '2026-01-15T04:00:00+04:00'}).referenceDate, '2026-01-15T00:00:00.000Z');
  for (const referenceDate of ['2026-01-15', '2026-01-15T00:00:00', '2026-02-30T00:00:00Z', '0001-01-15T00:00:00Z', '2026-01-15T25:00:00Z']) rejects({referenceDate}, /referenceDate:/);
  rejects({rangeStart: '2026-03-01T00:00:00Z'}, /rangeEnd:/);
  rejects({rangeEnd: '2050-01-01T00:00:00Z'}, /3660/);
  rejects({boundaryStart: '2026-03-01T00:00:00Z', boundaryEnd: '2026-04-01T00:00:00Z'}, /intersect/);
  rejects({referenceDate: '2025-01-01T00:00:00Z'}, /no past interval/);
  assert.equal(normalizeConfig({referenceDate: '2025-01-01T00:00:00Z', pastCount: 0}).pastCount, 0);
});

test('validates distributions, resource names, probabilities and calendar choices', () => {
  rejects({categories: []}, /categories:/);
  rejects({categories: [{value: 'a', weight: 0}]}, /total weight/);
  rejects({categories: [{value: 'a', weight: -1}]}, /weight:/);
  rejects({priorities: [{value: 1, weight: 1}]}, /value:/);
  rejects({duration: {weights: [{minutes: 0, weight: 1}]}}, /minutes:/);
  rejects({duration: {minMinutes: 20, maxMinutes: 5}}, /minMinutes:/);
  rejects({resources: {values: []}}, /resources.values:/);
  assert.deepEqual(normalizeConfig({resources: {mode: 'none', values: []}}).resources.values, []);
  rejects({businessHours: {start: '17:00', end: '09:00'}}, /businessHours.end:/);
  rejects({businessHours: {start: '9:00'}}, /HH:mm/);
  rejects({holidays: ['2026-02-30']}, /holidays:/);
  assert.deepEqual(normalizeConfig({holidays: ['2028-02-29']}).holidays, ['2028-02-29']);
  for (const probability of [-0.1, 1.1]) rejects({overlapProbability: probability}, /overlapProbability:/);
  rejects({includeWeekends: 'false'}, /includeWeekends:/);
});

test('seed preserves value type and rejects non-JSON or cyclic configuration', () => {
  for (const seed of [null, 0, 100, '', '100']) assert.equal(normalizeConfig({seed}).seed, seed);
  for (const seed of [true, {}, [], NaN, Infinity, undefined, 1n]) rejects({seed}, /seed:/);
  rejects({duration: new Date()}, /plain JSON object/);
  const input = {};
  input.circular = input;
  rejects(input, /circular references/);
});

test('bounds generation size and protects relative output paths', () => {
  rejects({pastCount: 30000, futureCount: 1}, /total must not exceed/);
  rejects({mode: 'legacy-simple', legacy: {eventCount: 10000, days: 4}}, /eventCount × days/);
  rejects({mode: 'legacy-full', legacy: {days: 6}}, /at most five days/);
  for (const dataModel of ['../data', 'data/../secret', '/data', 'C:\\data', '\\server\\share', 'data//yyyy', 'data/./yyyy', 'data/*']) rejects({dataModel}, /dataModel:/);
  assert.equal(normalizeConfig({dataModel: 'data\\yyyy\\mm\\dd'}).dataModel, 'data\\yyyy\\mm\\dd');
});

test('registered plugin strategies are validated alongside built-ins', () => {
  rejects({clustering: 'custom'}, /clustering:/);
  assert.equal(normalizeConfig({clustering: 'custom'}, {strategies: ['custom']}).clustering, 'custom');
});

test('calendar selection defaults to all days and canonicalizes duplicates without mutating input', () => {
  assert.deepEqual(normalizeConfig().selectedDays, []);
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.selectedDays));
  const input = {selectedDays: ['2026-01-22', '2026-01-02', '2026-01-22']};
  assert.deepEqual(normalizeConfig(input).selectedDays, ['2026-01-02', '2026-01-22']);
  assert.deepEqual(input.selectedDays, ['2026-01-22', '2026-01-02', '2026-01-22']);
  assert.deepEqual(normalizeConfig({selectedDays: ['1000-01-01', '9999-12-31', '2028-02-29']}).selectedDays,
    ['1000-01-01', '2028-02-29', '9999-12-31']);
});

test('calendar selection rejects malformed dates, unsupported years and oversized lists', () => {
  for (const selectedDays of [null, '2026-01-01', ['2026-01-01T00:00:00Z'], ['2026-02-29'],
    ['2026-13-01'], ['0999-12-31'], ['10000-01-01'], [20260101], Array(3661).fill('2026-01-01')]) {
    rejects({selectedDays}, /selectedDays:/);
  }
});
