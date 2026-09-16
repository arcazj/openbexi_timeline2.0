import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTimeline, GenerationError, outputDirectory } from '../engine.js';
import { ConfigError } from '../config.js';

const DAY = 86400000;
const base = {
  seed: 'engine-invariants', referenceDate: '2026-01-15T00:00:00.000Z',
  rangeStart: '2026-01-01T00:00:00.000Z', rangeEnd: '2026-02-01T00:00:00.000Z',
  pastCount: 20, futureCount: 20, density: 'sparse', overlapProbability: 0,
  pointEventProbability: 0, duration: { mode: 'fixed', fixedMinutes: 30 },
};
const start = event => Date.parse(event.start);
const end = event => event.end ? Date.parse(event.end) : start(event) + 1000;
const allEntries = result => result.timeline.events.flatMap(event => [event, ...event.activities]);
const earliest = { name: 'earliest', sample: () => 0 };
const chronological = events => [...events].sort((left, right) => start(left) - start(right));

test('calendar day selection applies density to eligible time without erasing isolated dates', () => {
  for (const density of ['normal', 'dense', 'very-dense']) {
    const result = generateTimeline({
      ...base, pastCount: 2, futureCount: 3, density,
      rangeStart: '2026-01-10T00:00:00Z', rangeEnd: '2026-01-21T00:00:00Z',
      selectedDays: ['2026-01-10', '2026-01-20'],
    });
    const days = result.timeline.events.map(event => new Date(start(event)).toISOString().slice(0, 10));
    assert.deepEqual(days, ['2026-01-10', '2026-01-10', '2026-01-20', '2026-01-20', '2026-01-20']);
  }
});

test('identical seed and config reproduce every document byte, path and metadata', () => {
  const input = { ...base, complexity: 'complex', dependencies: { probability: 0.7 }, recurrence: { probability: 0.5, intervalDays: 1 } };
  const original = structuredClone(input);
  const first = generateTimeline(input);
  const second = generateTimeline(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(input, original, 'normalization/generation must not mutate caller input');
  assert.notDeepEqual(first.timeline, generateTimeline({ ...input, seed: 'another' }).timeline);
  for (const file of first.files) assert.deepEqual(file.document, JSON.parse(JSON.stringify(file.document)));
});

test('fresh randomness records a usable seed, and replay reproduces all artifacts', () => {
  const generated = generateTimeline({ ...base, seed: null });
  assert.equal(typeof generated.config.seed, 'string');
  assert.ok(generated.config.seed.length > 0);
  assert.deepEqual(generateTimeline(generated.config), generated);
  const second = generateTimeline({ ...base, seed: null });
  assert.notEqual(second.config.seed, generated.config.seed);
});

test('exact past/future counts, timeline boundaries and fixed duration hold together', () => {
  const result = generateTimeline({
    ...base, pastCount: 13, futureCount: 17,
    boundaryStart: '2026-01-10T12:00:00.250Z', boundaryEnd: '2026-01-20T15:00:00.750Z',
  });
  const events = result.timeline.events;
  const reference = Date.parse(base.referenceDate);
  assert.equal(events.length, 30);
  assert.equal(events.filter(event => start(event) < reference).length, 13);
  assert.equal(events.filter(event => start(event) >= reference).length, 17);
  for (const event of events) {
    assert.ok(start(event) >= Date.parse(result.config.boundaryStart));
    assert.ok(end(event) <= Date.parse(result.config.boundaryEnd));
    assert.equal(end(event) - start(event), 30 * 60000);
    if (start(event) < reference) assert.ok(end(event) <= reference);
  }
  assert.equal(result.stats.events, 30);
  assert.equal(result.stats.activities, events.reduce((sum, event) => sum + event.activities.length, 0));
});

test('point events preserve empty end and never cross the exclusive boundary', () => {
  const result = generateTimeline({ ...base, pointEventProbability: 1 });
  assert.ok(result.timeline.events.every(event => event.end === ''));
  for (const event of result.timeline.events) {
    assert.ok(start(event) < Date.parse(result.config.rangeEnd));
    assert.ok(event.render.image.startsWith('icon/'));
    assert.ok(event.activities.every(activity => activity.end === ''));
  }
});

test('random duration stays in range and weighted zero entries are never selected', () => {
  const random = generateTimeline({ ...base, duration: { mode: 'random', minMinutes: 2, maxMinutes: 19 } });
  const durations = random.timeline.events.map(event => (end(event) - start(event)) / 60000);
  assert.ok(durations.every(duration => duration >= 2 && duration <= 19));
  assert.ok(new Set(durations).size > 10);
  const weighted = generateTimeline({
    ...base, duration: { mode: 'weighted', weights: [{ minutes: 9000, weight: 0 }, { minutes: 17, weight: 2 }, { minutes: 41, weight: 1 }] },
  });
  const selected = new Set(weighted.timeline.events.map(event => (end(event) - start(event)) / 60000));
  assert.deepEqual(selected, new Set([17, 41]));
});

test('every session respects business hours, weekend and explicit holiday exclusion', () => {
  const result = generateTimeline({
    ...base, pastCount: 15, futureCount: 15, businessHours: { enabled: true, start: '09:30', end: '16:45' },
    includeWeekends: false, includeHolidays: false, holidays: ['2026-01-01', '2026-01-19'],
  });
  for (const event of result.timeline.events) {
    const begin = new Date(start(event));
    const finish = new Date(end(event));
    assert.equal(begin.toISOString().slice(0, 10), finish.toISOString().slice(0, 10));
    assert.ok(![0, 6].includes(begin.getUTCDay()));
    assert.ok(!result.config.holidays.includes(begin.toISOString().slice(0, 10)));
    assert.ok(begin.getUTCHours() * 60 + begin.getUTCMinutes() >= 570);
    assert.ok(finish.getUTCHours() * 60 + finish.getUTCMinutes() <= 1005);
  }
});

test('calendar inclusion flags permit weekends and holidays when explicitly requested', () => {
  const input = {
    ...base, pastCount: 0, futureCount: 1, referenceDate: '2026-01-17T00:00:00.000Z',
    rangeStart: '2026-01-17T00:00:00.000Z', rangeEnd: '2026-01-18T00:00:00.000Z',
    holidays: ['2026-01-17'], clustering: 'earliest',
  };
  const result = generateTimeline(input, { plugins: [earliest] });
  assert.equal(new Date(start(result.timeline.events[0])).getUTCDay(), 6);
  assert.throws(() => generateTimeline({ ...input, includeWeekends: false }, { plugins: [earliest] }), GenerationError);
  assert.throws(() => generateTimeline({ ...input, includeHolidays: false }, { plugins: [earliest] }), GenerationError);
});

test('zero overlap prevents root-event collisions; overlap one produces actual intersections', () => {
  const disjoint = chronological(generateTimeline({ ...base, pointEventProbability: 0.3 }).timeline.events);
  for (let index = 1; index < disjoint.length; index += 1) {
    assert.ok(end(disjoint[index - 1]) <= start(disjoint[index]), `collision at ${index}`);
  }
  const result = generateTimeline({ ...base, pastCount: 0, futureCount: 15, overlapProbability: 1 });
  const events = result.timeline.events;
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events.slice(0, index).some(previous =>
      start(previous) < end(events[index]) && end(previous) > start(events[index])), `event ${index} must intersect a predecessor`);
  }
});

test('zero-weight categories and priorities are excluded; string payloads remain intact', () => {
  const result = generateTimeline({
    ...base, categories: [{ value: 'unused', weight: 0 }, { value: 'maintenance', weight: 1 }],
    priorities: [{ value: '0', weight: 0 }, { value: 'critical', weight: 1 }],
  });
  assert.ok(result.timeline.events.every(event => event.data.type === 'maintenance' && event.data.priority === 'critical'));
  assert.ok(allEntries(result).every(event => event.data.priority === 'critical'));
});

test('resource none, fixed, round-robin and random assignment use legacy system field', () => {
  const values = ['compute', 'network', 'storage'];
  const generate = mode => generateTimeline({ ...base, resources: { mode, values } }).timeline.events;
  assert.ok(generate('none').every(event => !Object.hasOwn(event.data, 'system')));
  assert.ok(generate('fixed').every(event => event.data.system === 'compute'));
  generate('round-robin').forEach((event, index) => assert.equal(event.data.system, values[index % values.length]));
  const random = generate('random').map(event => event.data.system);
  assert.ok(random.every(value => values.includes(value)));
  assert.equal(new Set(random).size, 3);
});

test('higher density retains counts and moves the occupied span toward the reference', () => {
  let previousFarthest = Infinity;
  for (const density of ['sparse', 'normal', 'dense', 'very-dense']) {
    const result = generateTimeline({ ...base, pastCount: 0, futureCount: 15, density });
    const farthest = Math.max(...result.timeline.events.map(end)) - Date.parse(base.referenceDate);
    assert.equal(result.timeline.events.length, 15);
    assert.ok(farthest < previousFarthest, `${density} should occupy a tighter time span`);
    previousFarthest = farthest;
  }
});

test('all clustering strategies remain deterministic and enforce calendar/count invariants', () => {
  const starts = [];
  for (const clustering of ['uniform', 'bursty', 'seasonal', 'realistic']) {
    const config = { ...base, clustering, businessHours: { enabled: true }, includeWeekends: false };
    const result = generateTimeline(config);
    assert.deepEqual(result, generateTimeline(config));
    assert.equal(result.timeline.events.length, 40);
    assert.ok(result.timeline.events.every(event => ![0, 6].includes(new Date(start(event)).getUTCDay())));
    starts.push(result.timeline.events.map(event => event.start).join('|'));
  }
  assert.equal(new Set(starts).size, 4);
});

test('strategy plugins select eligible fractions and cannot mutate the normalized configuration', () => {
  const custom = {
    name: 'quarter',
    sample(context) {
      assert.equal(context.side, 'future');
      assert.equal(context.index, 0);
      assert.equal(context.count, 1);
      context.config.namespace = 'unwanted';
      context.windows[0][0] = 0;
      return 0.25;
    },
  };
  const result = generateTimeline({ ...base, pastCount: 0, futureCount: 1, clustering: 'quarter' }, { plugins: [custom] });
  const event = result.timeline.events[0];
  const first = Date.parse(base.referenceDate);
  const last = Date.parse(base.rangeEnd) - 30 * 60000;
  assert.ok(Math.abs(start(event) - (first + (last - first) * 0.25)) <= 1000);
  assert.equal(event.namespace, result.config.namespace);
  assert.notEqual(result.config.namespace, 'unwanted');
  for (const invalid of [-0.01, 1, Infinity, NaN, '0.5']) {
    assert.throws(() => generateTimeline({ ...base, clustering: 'bad' }, {
      plugins: [{ name: 'bad', sample: () => invalid }],
    }), /finite number in \[0, 1\)/);
  }
  assert.throws(() => generateTimeline(base, { plugins: [{ name: 'uniform', sample: () => 0 }] }), /Duplicate strategy/);
  assert.throws(() => generateTimeline(base, { plugins: [{ name: 'Invalid', sample: () => 0 }] }), /lowercase name/);
});

test('recurring events keep their interval and payload; dependencies form a valid DAG', () => {
  const result = generateTimeline({
    ...base, pastCount: 0, futureCount: 12, clustering: 'earliest', overlapProbability: 0,
    recurrence: { probability: 1, intervalDays: 1 }, dependencies: { probability: 1, maxParents: 3 },
  }, { plugins: [earliest] });
  const events = result.timeline.events;
  const lookup = new Map(events.map((event, index) => [event.id, { event, index }]));
  assert.ok(events.some(event => event.data.recurrence));
  assert.ok(events.some(event => event.data.dependencies?.length));
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.data.recurrence) {
      const { previousId, seriesId, intervalDays } = event.data.recurrence;
      assert.ok(lookup.has(previousId));
      assert.ok(lookup.has(seriesId));
      const previous = lookup.get(previousId);
      assert.ok(previous.index < index);
      assert.equal(start(event) - start(previous.event), intervalDays * DAY);
      assert.equal(end(event) - start(event), end(previous.event) - start(previous.event));
      for (const property of ['type', 'priority', 'system']) assert.equal(event.data[property], previous.event.data[property]);
    }
    const dependencies = event.data.dependencies ?? [];
    assert.ok(dependencies.length <= 3);
    assert.equal(new Set(dependencies).size, dependencies.length);
    for (const id of dependencies) {
      assert.ok(lookup.has(id));
      assert.ok(lookup.get(id).index < index, 'all edges point to previously generated nodes, precluding cycles');
      assert.ok(end(lookup.get(id).event) <= start(event));
    }
  }
});

test('unplaceable recurrence falls back explicitly without dropping requested events', () => {
  const result = generateTimeline({
    ...base, pastCount: 0, futureCount: 4, clustering: 'earliest', recurrence: { probability: 1, intervalDays: 100 },
  }, { plugins: [earliest] });
  assert.equal(result.timeline.events.length, 4);
  assert.ok(result.warnings.some(warning => /3 recurrence requests/.test(warning)));
  assert.ok(result.timeline.events.every(event => !event.data.recurrence));
});

test('complexity changes activity richness and scheduling details while preserving the wire model', () => {
  const simple = generateTimeline({ ...base, complexity: 'simple' });
  assert.ok(simple.timeline.events.every(event => event.activities.length === 1 && !('tolerance' in event.data)));
  const complex = generateTimeline({ ...base, complexity: 'complex' });
  assert.ok(complex.timeline.events.some(event => event.activities.length > 3));
  for (const event of complex.timeline.events) {
    assert.equal(event.original_start, event.start);
    assert.ok(Date.parse(event.original_end) > start(event) && Date.parse(event.original_end) < end(event));
    assert.ok(event.activities.length >= 1 && event.activities.length <= 6);
    for (const activity of event.activities) {
      assert.equal(activity.start, event.start);
      assert.equal(activity.end, event.end);
      assert.equal(activity.data.type, undefined);
      assert.equal(activity.data.system, undefined);
    }
  }
});

test('descriptor links and daily output routing cover each generated event exactly once', () => {
  const result = generateTimeline({ ...base, descriptorProbability: 1, namespace: 'linked', dataModel: 'output/yyyy/mm/dd' });
  const entries = allEntries(result);
  const descriptorFiles = result.files.filter(file => file.document.event_descriptor);
  const partitions = result.files.filter(file => file.document.events);
  assert.equal(descriptorFiles.length, entries.length);
  assert.equal(result.stats.descriptors, entries.length);
  assert.equal(result.stats.files, result.files.length);
  assert.equal(new Set(result.files.map(file => file.path)).size, result.files.length);
  const serializedIds = partitions.flatMap(file => {
    for (const event of file.document.events) {
      const day = new Date(start(event)).toISOString().slice(0, 10).replaceAll('-', '/');
      assert.equal(file.path, `output/${day}/events.json`);
    }
    return file.document.events.map(event => event.id);
  });
  assert.deepEqual(new Set(serializedIds), new Set(result.timeline.events.map(event => event.id)));
  for (const event of entries) {
    const day = new Date(start(event)).toISOString().slice(0, 10).replaceAll('-', '/');
    const file = descriptorFiles.find(item => item.path === `output/${day}/descriptors/${event.id}.json`);
    assert.ok(file, `missing descriptor for ${event.id}`);
    const descriptor = file.document.event_descriptor[0];
    assert.equal(descriptor.id, event.id);
    assert.equal(event.data.title, descriptor.data.title + '_read_descriptor');
    assert.equal(event.data.description, '');
    assert.equal(descriptor.data.namespace, 'linked');
  }
  const noDescriptors = generateTimeline({ ...base, descriptorProbability: 0 });
  assert.equal(noDescriptors.stats.descriptors, 0);
  assert.ok(allEntries(noDescriptors).every(event => event.data.description !== ''));
  assert.equal(outputDirectory('data\\yyyy\\mm\\dd.json', Date.parse(base.referenceDate), true), 'data/2026/01/15');
});

test('empty timelines remain usable, while infeasible calendars and invalid bounds fail clearly', () => {
  const empty = generateTimeline({ ...base, pastCount: 0, futureCount: 0 });
  assert.deepEqual(empty.timeline, { dateTimeFormat: 'iso8601', events: [] });
  assert.equal(empty.files.length, 1);
  assert.equal(empty.files[0].path, 'data/2026/01/15/events.json');
  assert.throws(() => generateTimeline({
    ...base, businessHours: { enabled: true }, duration: { mode: 'fixed', fixedMinutes: 600 },
  }), /Cannot place past event/);
  assert.throws(() => generateTimeline({
    ...base, pastCount: 0, futureCount: 10,
    rangeStart: base.referenceDate, rangeEnd: '2026-01-15T00:31:00.000Z',
  }), /no space/);
  assert.throws(() => generateTimeline({ ...base, boundaryStart: '2026-03-01T00:00:00.000Z' }), ConfigError);
  assert.throws(() => generateTimeline({ ...base, pastCount: 0, referenceDate: base.rangeEnd }), /no future interval/);
});

test('noncontiguous calendar selection restricts complete events and preserves exact side counts', () => {
  const selectedDays = ['2026-01-05', '2026-01-10', '2026-01-20', '2026-01-25'];
  const result = generateTimeline({ ...base, selectedDays });
  assert.equal(result.timeline.events.length, 40);
  assert.equal(result.timeline.events.filter(event => start(event) < Date.parse(base.referenceDate)).length, 20);
  const occupiedDays = new Set();
  for (const event of result.timeline.events) {
    // Check every occupied calendar day, including sessions spanning midnight.
    for (let time = Math.floor(start(event) / DAY) * DAY; time < end(event); time += DAY) {
      const day = new Date(time).toISOString().slice(0, 10);
      assert.ok(selectedDays.includes(day), `event occupies unselected day ${day}`);
      occupiedDays.add(day);
    }
  }
  assert.deepEqual(occupiedDays, new Set(selectedDays));
  assert.deepEqual(generateTimeline({ ...base, selectedDays: [...selectedDays].reverse().concat(selectedDays[0]) }), result);
});

test('omitted calendar days cannot be bridged by long sessions', () => {
  const input = {
    ...base, pastCount: 0, futureCount: 1, rangeStart: base.referenceDate,
    rangeEnd: '2026-01-18T00:00:00.000Z', selectedDays: ['2026-01-15', '2026-01-17'],
    duration: { mode: 'fixed', fixedMinutes: 26 * 60 },
  };
  assert.throws(() => generateTimeline(input), /Cannot place future event/);
  const adjacent = generateTimeline({ ...input, selectedDays: ['2026-01-15', '2026-01-16'] });
  assert.equal(end(adjacent.timeline.events[0]) - start(adjacent.timeline.events[0]), 26 * 60 * 60000);
  assert.ok(end(adjacent.timeline.events[0]) <= Date.parse('2026-01-17T00:00:00.000Z'));
});

test('selected days intersect business hours, weekends, holidays and timeline boundaries', () => {
  const result = generateTimeline({
    ...base, pastCount: 0, futureCount: 8, selectedDays: ['2026-01-16', '2026-01-17', '2026-01-19', '2026-01-20'],
    includeWeekends: false, includeHolidays: false, holidays: ['2026-01-19'],
    businessHours: { enabled: true, start: '09:00', end: '17:00' },
    boundaryStart: '2026-01-16T12:00:00.000Z', boundaryEnd: '2026-01-20T13:00:00.000Z',
  });
  const allowed = new Set(['2026-01-16', '2026-01-20']);
  for (const event of result.timeline.events) {
    const begin = new Date(start(event));
    const finish = new Date(end(event));
    assert.ok(allowed.has(begin.toISOString().slice(0, 10)));
    assert.ok(begin.getUTCHours() >= 9);
    assert.ok(finish.getUTCHours() <= 17);
    assert.ok(start(event) >= Date.parse(result.config.boundaryStart));
    assert.ok(end(event) <= Date.parse(result.config.boundaryEnd));
  }
  assert.throws(() => generateTimeline({ ...base, selectedDays: ['2026-03-01'] }), /Cannot place past event/);
});

test('empty selection preserves existing generation and selected days do not alter legacy artifacts', () => {
  assert.deepEqual(generateTimeline(base), generateTimeline({ ...base, selectedDays: [] }));
  const input = { ...base, mode: 'legacy-simple', legacy: { eventCount: 12 } };
  const original = generateTimeline(input);
  const selected = generateTimeline({ ...input, selectedDays: ['2028-02-29'] });
  assert.deepEqual(selected.timeline, original.timeline);
  assert.deepEqual(selected.files, original.files);
  assert.deepEqual(selected.stats, original.stats);
});

test('a fully booked hour uses deterministic packing when random starts fragment capacity', () => {
  const input = {
    seed: 'capacity', pastCount: 0, futureCount: 2,
    referenceDate: '2026-01-15T09:00:00Z', rangeStart: '2026-01-15T09:00:00Z', rangeEnd: '2026-01-15T10:00:00Z',
    density: 'sparse', duration: { mode: 'fixed', fixedMinutes: 30 }, pointEventProbability: 0, overlapProbability: 0,
  };
  const result = generateTimeline(input);
  assert.deepEqual(result, generateTimeline(input));
  const events = chronological(result.timeline.events);
  assert.equal(events.length, 2);
  assert.equal(start(events[0]), Date.parse(input.rangeStart));
  assert.equal(end(events[0]), start(events[1]));
  assert.equal(end(events[1]), Date.parse(input.rangeEnd));
  assert.ok(result.warnings.some(warning => warning.includes('deterministically packed')));
});
