import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRandom } from '../random.js';
import { createDescriptor, formatDate, ICONS } from '../model.js';
import { generateLegacyFull, generateLegacySimple } from '../legacy.js';

const configuration = { namespace: 'SOURCE1', referenceDate: '2026-10-15T00:00:00.000Z', eventCount: 286 };

test('seed controls dates, descriptors, colors, titles and valid version-4 UUIDs', () => {
  const first = generateLegacySimple(configuration, createRandom('fixture'));
  assert.deepEqual(first, generateLegacySimple(configuration, createRandom('fixture')));
  assert.notDeepEqual(first, generateLegacySimple(configuration, createRandom('different')));
  const entries = first.timeline.events.flatMap(event => [event, ...event.activities]);
  assert.equal(new Set(entries.map(event => event.id)).size, entries.length);
  for (const event of entries) {
    assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.deepEqual(first, JSON.parse(JSON.stringify(first)));
});

test('hardcoded dates and activities match the repository Java output fixture', async () => {
  // Compact expectation vectors were extracted from the real SOURCE1 archive;
  // source path and SHA-256 are retained in this portable fixture.
  const fixture = JSON.parse(await readFile(new URL('./fixtures/source1-legacy-layout.json', import.meta.url), 'utf8'));
  const actual = generateLegacySimple({
    ...configuration, referenceDate: fixture.referenceDate, eventCount: fixture.eventCount,
  }, createRandom('fixture')).timeline;
  assert.equal(actual.dateTimeFormat, fixture.dateTimeFormat);
  assert.equal(actual.events.length, fixture.eventCount);
  for (const expected of fixture.expected) {
    const index = expected.index;
    for (const field of ['namespace', 'original_start', 'start', 'original_end', 'end']) {
      assert.equal(actual.events[index][field], expected.fields[field], `event ${index}: ${field}`);
    }
    assert.equal(actual.events[index].activities.length, expected.activityCount);
    assert.equal(actual.events[index].data.tolerance ?? null, expected.tolerance);
    assert.equal(actual.events[index].data.type, 'type1');
    assert.equal(actual.events[index].data.system, 'system1');
  }
});

test('special sparse-event offsets after index 50 preserve Java millisecond units', () => {
  const events = generateLegacySimple(configuration, createRandom('later-offsets')).timeline.events;
  for (const [first, last, offset] of [[51, 59, 600000], [61, 71, 5200000]]) {
    for (let index = first; index <= last; index += 1) {
      assert.equal(events[index].start, formatDate(Date.parse(configuration.referenceDate) + offset));
      assert.equal(events[index].end, '');
      assert.equal(events[index].activities.length, 1);
    }
  }
});

test('simple activities mirror dates and metadata while descriptors restore type', () => {
  const result = generateLegacySimple(configuration, createRandom(123));
  const entries = [];
  for (const event of result.timeline.events) {
    entries.push(event, ...event.activities);
    assert.ok(event.activities.length >= 1);
    for (const activity of event.activities) {
      for (const field of ['namespace', 'start', 'end', 'original_start', 'original_end']) {
        assert.equal(activity[field], event[field]);
      }
      for (const field of ['status', 'priority', 'tolerance']) {
        assert.equal(activity.data[field], event.data[field]);
      }
      assert.equal(activity.render.color, event.render.color);
      assert.equal(activity.data.type, undefined);
      assert.equal(activity.data.system, undefined);
    }
  }
  const references = entries.filter(event => event.data.title.endsWith('_read_descriptor'));
  assert.equal(result.descriptors.length, references.length);
  assert.ok(references.length > entries.length * 0.4 && references.length < entries.length * 0.6);
  for (const { event, document } of result.descriptors) {
    assert.equal(event.data.description, '');
    assert.equal(document.dateTimeFormat, 'iso8601');
    assert.equal(document.event_descriptor.length, 1);
    const descriptor = document.event_descriptor[0];
    assert.equal(descriptor.id, event.id);
    assert.equal(descriptor.namespace, undefined);
    assert.equal(descriptor.data.title + '_read_descriptor', event.data.title);
    assert.equal(descriptor.data.type, 'type1');
    assert.ok(descriptor.data.description.endsWith('_read_descriptor_in_file'));
    assert.equal('original_start' in descriptor, event.original_start !== '');
    assert.equal('original_end' in descriptor, event.original_end !== '');
  }
});

test('descriptor zero tolerance and Java UTC format are preserved', () => {
  assert.equal(formatDate(Date.parse('2026-01-02T03:04:05.999Z')), 'Fri Jan 02 03:04:05 UTC 2026');
  const event = {
    id: 'sample', namespace: 'SOURCE1', start: 'start', end: '', original_start: '', original_end: '',
    data: { title: 'event_read_descriptor', status: 'FINISHED', priority: '0' },
  };
  assert.deepEqual(createDescriptor(event, { title: 'event', type: 'type1', tolerance: '0', description: 'text' }), {
    dateTimeFormat: 'iso8601', event_descriptor: [{
      id: 'sample', start: 'start', end: '', data: {
        namespace: 'SOURCE1', title: 'event', type: 'type1', priority: '0',
        status: 'FINISHED', tolerance: '0', description: 'text',
      },
    }],
  });
});

test('full legacy mode preserves 650 groups, alternating sessions and omission rules', () => {
  const result = generateLegacyFull(configuration, createRandom('full'));
  assert.equal(result.timeline.events.length, 5200);
  assert.deepEqual(result.descriptors, []);
  assert.ok(result.timeline.events.some(event => event.activities?.length));
  for (let index = 0; index < result.timeline.events.length; index += 1) {
    const event = result.timeline.events[index];
    const slot = index % 8;
    assert.equal(event.end === '', slot % 2 === 1);
    assert.equal('tolerance' in event.data, slot === 2);
    assert.equal('image' in event.render, slot === 0 || slot % 2 === 1);
    if (event.render.image) assert.ok(ICONS.includes(event.render.image));
    assert.equal(event.data.title, `title${Math.floor(index / 8)}_${slot}`);
    assert.ok(['SCHEDULE', 'STARTED', 'COMPLETED'].includes(event.data.status));
    if (slot !== 2) {
      assert.equal(event.original_start, undefined);
      assert.equal(event.original_end, undefined);
    }
    if (event.activities) {
      assert.ok(event.end !== '');
      assert.ok(event.activities.length >= 1 && event.activities.length <= 4);
      for (const activity of event.activities) {
        assert.equal(activity.namespace, event.namespace);
        assert.equal(activity.data.type, undefined);
        assert.equal(activity.data.system, undefined);
        assert.equal(activity.original_start, event.original_start);
        assert.equal(activity.original_end, event.original_end);
      }
    }
  }
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
});

test('empty legacy output and invalid random parameters have explicit behavior', () => {
  assert.deepEqual(generateLegacySimple({ ...configuration, eventCount: 0 }, createRandom(0)), {
    timeline: { dateTimeFormat: 'iso8601', events: [] }, descriptors: [],
  });
  assert.throws(() => generateLegacySimple({ ...configuration, eventCount: -1 }), /eventCount/);
  assert.throws(() => generateLegacySimple({ ...configuration, referenceDate: 'bad' }), /referenceDate/);
  const random = createRandom(0);
  assert.throws(() => random.int(1, 1), /bounds/);
  assert.throws(() => random.pickWeighted([{ weight: 0 }]), /positive/);
  assert.throws(() => random.pickWeighted([{ weight: -1 }]), /nonnegative/);
  const selected = { value: 'chosen', weight: 1 };
  for (let index = 0; index < 100; index += 1) {
    assert.equal(random.pickWeighted([{ weight: 0 }, selected]), selected);
  }
});
