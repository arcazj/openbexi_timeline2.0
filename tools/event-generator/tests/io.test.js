import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateTimeline, generateLegacyStartup, outputDirectory } from '../engine.js';
import { createZip, serialize } from '../archive.js';
import { parseStartup } from '../startup.js';
import { writeArtifacts } from '../cli.js';
import { startServer } from '../serve.js';

test('startup YAML/JSON preserves disabled sources, random daily counts and source date carryover', async () => {
  const yaml = await readFile(new URL('../../../yaml/sources_default_test.yml', import.meta.url), 'utf8');
  const startup = parseStartup(yaml);
  assert.equal(startup.data_sources.length, 2);
  assert.equal(startup.data_sources[1].namespace, 'SOURCE2');
  const options = { seed: 'startup-test', referenceDate: '2026-01-15T14:30:00Z', days: 2 };
  const result = generateLegacyStartup(startup, options);
  assert.deepEqual(result, generateLegacyStartup(parseStartup(JSON.stringify(startup)), options));
  const batches = result.files.filter(file => file.document.events);
  assert.equal(batches.length, 4);
  assert.ok(batches.every(file => file.document.events.length >= 50 && file.document.events.length < 600));
  assert.ok(batches[0].path.endsWith('/2026/01/15/events.json'));
  assert.ok(batches[2].path.endsWith('/2026/01/16/events.json'));
  assert.ok(batches[3].path.endsWith('/2026/01/17/events.json'));
  assert.throws(() => parseStartup('data_sources: []'), /block-style/);
  assert.throws(() => parseStartup('data_sources:\n  - namespace: test\n    data_model: &anchor data'), /Unsupported YAML scalar/);
});

test('archive is byte reproducible with valid directory offsets, checksums and JSON content', () => {
  const files = generateTimeline({ pastCount: 2, futureCount: 2 }).files;
  const zip = createZip(files);
  assert.deepEqual(zip, createZip(files));
  const view = new DataView(zip.buffer);
  let offset = 0;
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const dataStart = offset + 30 + nameSize;
    const content = zip.subarray(dataStart, dataStart + size);
    assert.equal(new TextDecoder().decode(zip.subarray(offset + 30, dataStart)), file.path);
    assert.equal(new TextDecoder().decode(content), serialize(file.document));
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal(view.getUint32(offset + 14, true), (crc ^ 0xffffffff) >>> 0);
    offset = dataStart + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint32(zip.length - 6, true), offset);
  assert.throws(() => createZip([{ path: '../outside.json', document: {} }]), /Unsafe/);
});

test('legacy path substitutions and repeated namespace descriptor selection match Java', () => {
  const date = Date.parse('2026-01-15T00:00:00Z');
  assert.equal(outputDirectory('yyyy/mm/dd.json', date), '2026/01/15.json');
  assert.equal(outputDirectory('yyyy/mm/dd.json', date, true), 'yyyy/01/15');
  assert.throws(() => outputDirectory('data/yyyy/mm/dd', Date.parse('+010000-01-01T00:00:00Z')), /years/);
  const result = generateLegacyStartup({data_sources: [
    {namespace: 'same', data_model: 'first/yyyy/mm/dd'},
    {namespace: 'same', data_model: 'last/yyyy/mm/dd'}
  ]}, {days: 1});
  assert.ok(result.files.filter(file => file.document.event_descriptor).every(file => file.path.startsWith('last/')));
});

test('writer creates legacy hierarchy, refuses overwrite and rejects traversal before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ob-generator-'));
  try {
    const files = [{ path: 'data/2026/01/15/events.json', document: { events: [] } }];
    await writeArtifacts(files, root);
    assert.deepEqual(JSON.parse(await readFile(join(root, files[0].path))), files[0].document);
    await assert.rejects(writeArtifacts(files, root), /already exists/);
    await assert.rejects(writeArtifacts([{ path: '../escape.json', document: {} }], root), /escapes/);
    await writeArtifacts(files, root, true);
    await mkdir(join(root, 'directory.json'));
    await assert.rejects(writeArtifacts([{ path: 'directory.json', document: {} }], root, true), /not a file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI generates a reusable ZIP and reports validation failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ob-cli-'));
  try {
    const config = join(root, 'config.json'), zip = join(root, 'timeline.zip');
    await writeFile(config, JSON.stringify({ pastCount: 2, futureCount: 1 }));
    const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
    const run = spawnSync(process.execPath, [cli, '--config', config, '--zip', zip], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stderr).events, 3);
    assert.ok((await readFile(zip)).length > 100);
    const bad = spawnSync(process.execPath, [cli, '--unknown'], { encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Invalid or incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local UI server serves ES modules and limits access to its own directory', async () => {
  const server = await startServer({ port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/engine.js');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(base + '/..%5c..%5cpackage.json')).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
