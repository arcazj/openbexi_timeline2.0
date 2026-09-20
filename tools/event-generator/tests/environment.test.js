import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTimeline, generateLegacyStartup } from '../engine.js';
import { createEnvironment } from '../environment.js';
import { writeEnvironment } from '../cli.js';
import { createZip } from '../archive.js';

const generate = seed => generateTimeline({ seed, pastCount: 2, futureCount: 2, descriptorProbability: 1 });

test('complete environment has reproducible linked YAML, model, filter, records and descriptors', async () => {
  const result = generate('environment');
  const environment = await createEnvironment(result, { initialRange: 'generated' });
  assert.deepEqual(await createEnvironment(result, { initialRange: 'generated' }), environment);
  assert.deepEqual(createZip(environment.files), createZip((await createEnvironment(result, { initialRange: 'generated' })).files));
  assert.equal(environment.activation.document.version, 2);
  const model = environment.files.find(file => file.path === environment.activation.document.model.slice(3));
  const filter = environment.files.find(file => file.path === environment.activation.document.filter.slice(3));
  assert.equal(model.document.bands[0].color, '#000000');
  assert.equal(model.document.params[0].overviewVisible, false);
  assert.deepEqual(filter.document.source_ids, ['source1']);
  const low = Date.parse(filter.document.initial_range.from), high = Date.parse(filter.document.initial_range.to);
  assert.ok(result.timeline.events.every(event => Date.parse(event.start) >= low && Date.parse(event.start) < high));
  assert.equal(environment.files.filter(file => file.document.event_descriptor).length, result.stats.descriptors);
  assert.ok(environment.files.filter(file => file.document.events).every(file => file.path.startsWith(`data/${environment.version}/source1/`)));
  assert.equal((await createEnvironment(result)).files.find(file => file.path.startsWith('filters/')).document.initial_range, 'current_time');
  await assert.rejects(createEnvironment(result, { initialRange: { from: '2026-02-30T00:00:00Z', to: '2026-03-04T00:00:00Z' } }), /bounds/);
  const fixed = await createEnvironment(result, { initialRange: { from: '2024-02-29T00:00:00Z', to: '2024-03-01T00:00:00Z' }, theme: 'light', camera: 'Perspective', groupBy: 'status', search: 'started' });
  const fixedFilter = fixed.files.find(file => file.path.startsWith('filters/')).document;
  assert.equal(fixedFilter.initial_range.from, '2024-02-29T00:00:00.000Z');
  assert.equal(fixedFilter.group_by, 'status');
  assert.equal(fixed.files.find(file => file.path.startsWith('models/')).document.params[0].camera, 'Perspective');
});

test('atomic activation preserves previous environment on failure and never overwrites published artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ob-environment-'));
  try {
    const first = await createEnvironment(generate('first'));
    await writeEnvironment(first, root);
    const saved = await Promise.all(first.files.map(async file => [file.path, await readFile(join(root, file.path), 'utf8')]));
    const next = await createEnvironment(generate('next'));
    await assert.rejects(writeEnvironment(next, root), /already exists/);
    await assert.rejects(writeEnvironment(next, root, true, { beforeActivate() { throw new Error('injected activation failure'); } }), /injected/);
    for (const [path, contents] of saved) assert.equal(await readFile(join(root, path), 'utf8'), contents);
    assert.ok((await readdir(join(root, 'yaml'))).every(name => !name.includes('.pending')));
    await writeEnvironment(next, root, true);
    assert.deepEqual(JSON.parse(await readFile(join(root, next.activation.path), 'utf8')), next.activation.document);
    for (const [path, contents] of saved.filter(([path]) => !path.startsWith('yaml/'))) assert.equal(await readFile(join(root, path), 'utf8'), contents);
    await writeEnvironment(next, root, true); // unchanged immutable imports are reused
    const forged = structuredClone(next);
    forged.activation = forged.files.at(-1);
    forged.files[0].document = {};
    await assert.rejects(writeEnvironment(forged, root, true), /different contents/);
    assert.deepEqual(JSON.parse(await readFile(join(root, next.activation.path), 'utf8')), next.activation.document);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failure while staging a later immutable file retains earlier activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ob-environment-'));
  try {
    const first = await createEnvironment(generate('first'));
    await writeEnvironment(first, root);
    const next = await createEnvironment(generate('next'));
    next.files.splice(1, 0, { path: '../escape.json', document: {} });
    await assert.rejects(writeEnvironment(next, root, true), /escapes/);
    assert.deepEqual(JSON.parse(await readFile(join(root, first.activation.path), 'utf8')), first.activation.document);
    await assert.rejects(readFile(join(root, next.files[0].path)), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source identity paths survive reordered inputs and descriptor files follow their record owner', async () => {
  const data_sources = [{ namespace: 'SOURCE1', data_model: 'data/first/yyyy/mm/dd' }, { namespace: 'SOURCE2', data_model: 'data/second/yyyy/mm/dd' }];
  const build = values => createEnvironment(generateLegacyStartup({ data_sources: values }, { days: 1, seed: 'sources' }));
  const first = await build(data_sources), reversed = await build([...data_sources].reverse());
  const identities = environment => Object.fromEntries(environment.activation.document.data_sources.map(source => [source.namespace, source.identity_path]));
  assert.deepEqual(identities(first), identities(reversed));
  for (const environment of [first, reversed]) {
    const configured = environment.activation.document.data_sources;
    for (const file of environment.files.filter(file => file.document.event_descriptor)) {
      const source = configured.find(source => source.namespace === file.document.event_descriptor[0].data.namespace);
      assert.ok(file.path.startsWith(`data/${environment.version}/${source.id}/`));
    }
  }
});
