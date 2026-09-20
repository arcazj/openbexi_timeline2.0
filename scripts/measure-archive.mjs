// Real-browser sample of the copied full archive, separate from ASGI timings.
// Run after npm run build: npm run measure:archive -- --runs 3
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startConfiguredProfileServer } from '../tests/integration/configured-profile-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const { values } = parseArgs({ options: { runs: { type: 'string', default: '3' }, output: { type: 'string', default: 'artifacts/performance/archive-browser.json' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('node scripts/measure-archive.mjs [--runs 1..10] [--output artifacts/performance/archive-browser.json]\nRequires a current npm run build and installed Playwright Chromium (or OPENBEXI_BROWSER executable). Output must be a .json file under this checkout\'s ignored artifacts/ or runtime/. Uses a fresh temporary server state and never edits source archives.');
  process.exit(0);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer from 1 to 10');
const output = path.resolve(values.output), python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const outputRelative = path.relative(root, output);
if (path.isAbsolute(outputRelative) || !['artifacts', 'runtime'].includes(outputRelative.split(path.sep)[0]) || path.extname(output).toLowerCase() !== '.json') throw new Error('--output must be a .json file under this checkout\'s ignored artifacts/ or runtime/');
const execute = promisify(execFile), profile = 'yaml/multiple_sources_test.yml';
const html = await readFile('dist/index.html');
const report = {
  format: 'openbexi-archive-browser-v1', measuredAt: new Date().toISOString(), status: 'running', profile,
  bundleSha256: createHash('sha256').update(html).digest('hex'), iterations: runs,
  methodology: {
    scope: 'Full copied SOURCE1 and SOURCE2 archives through an isolated loopback Python server and real Chromium browser.',
    startup: 'Fresh temporary server state and browser context; filesystem caches uncontrolled and record files read for integrity receipts before startup.',
    operations: 'After the archive index completes, repeat November/March range navigation, SOURCE1/all filtering and dynamic status/namespace/NONE grouping.',
    frames: 'requestAnimationFrame intervals during one fixed 48-step back-and-forth mouse drag, with 16 ms pacing; automation and headless rendering overhead are included.',
    memory: 'CDP JavaScript heap samples for the main browser target; excludes Python, browser native/GPU memory and separate worker heaps. No forced garbage collection.',
    interpretation: 'Diagnostic observations on one machine, not a release gate or SLO qualification. Source record bytes and all archive file metadata checked before and after.',
  },
  environment: { platform: platform(), osRelease: release(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), viewport: { width: 1600, height: 900 } },
  operations: [], memory: [], pageErrors: [], loading: {},
};
const round = value => Math.round(value * 100) / 100;
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2), median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { samples: sorted.length, min: round(sorted[0]), median: round(median), p95: round(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)]), max: round(sorted.at(-1)) };
};
async function inventory() {
  const result = await execute(python, ['-c', `import importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('archive_benchmark','scripts/benchmark-archive.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps(module.archive_inventory([Path('data/SOURCES1'),Path('data/SOURCES2')]),sort_keys=True))`], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}
const snapshot = page => page.evaluate(() => {
  const value = window.__timelineDebug;
  return { queryId: value.queryId, layoutId: value.layoutId, fromMs: value.fromMs, toMs: value.toMs, detailTotal: value.detailTotal,
    totalRows: value.totalRows, loadedCount: value.loadedCount, grouping: value.grouping, ready: value.ready, navigationBuffer: value.navigationBuffer };
});
const ready = (page, before) => page.waitForFunction(previous => {
  const value = window.__timelineDebug;
  return value?.ready && (!previous || value.queryId !== previous.queryId || value.layoutId !== previous.layoutId || value.fromMs !== previous.fromMs);
}, before, { timeout: 60000 });
let browser, server, stopPromise, beforeInventory;
const stopServer = () => stopPromise ??= server?.stop();
const interrupted = () => { report.interrupted = true; void browser?.close(); void stopServer(); };
process.once('SIGINT', interrupted);
try {
  beforeInventory = await inventory();
  report.integrityBefore = beforeInventory;
  report.environment.python = (await execute(python, ['--version'], { windowsHide: true })).stdout.trim();
  browser = await chromium.launch({ ...(process.env.OPENBEXI_BROWSER ? { executablePath: process.env.OPENBEXI_BROWSER } : {}), headless: true });
  report.environment.browser = browser.version();
  report.environment.browserExecutable = process.env.OPENBEXI_BROWSER || 'Playwright Chromium';
  const context = await browser.newContext({ viewport: report.environment.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await cdp.send('Performance.enable');
  async function memory(label) {
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    report.memory.push({ label, usedBytes: metrics.JSHeapUsedSize, totalBytes: metrics.JSHeapTotalSize });
  }
  await page.addInitScript(() => {
    const observe = () => {
      if (window.__timelineDebug?.ready) window.__archiveFirstReady = performance.now();
      else requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const serverStarted = performance.now();
  server = await startConfiguredProfileServer(profile);
  report.serverHealthReadyMs = round(performance.now() - serverStarted);
  const response = await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (response.status() !== 200) throw new Error(`Timeline returned HTTP ${response.status()}`);
  await page.waitForFunction(() => window.__archiveFirstReady !== undefined, undefined, { timeout: 120000 });
  report.pageReadyMs = round(await page.evaluate(() => window.__archiveFirstReady));
  report.serverToTimelineReadyMs = round(performance.now() - serverStarted);
  report.initial = await snapshot(page);
  await memory('first-ready');
  const loading = () => page.evaluate(async () => {
    const response = await fetch('/api/v1/workspaces/default/legacy/loading', { headers: { 'X-OpenBEXI-Local': '1' } });
    if (!response.ok) throw new Error(`Loading status returned HTTP ${response.status}`);
    return response.json();
  });
  report.loading.firstReady = await loading();
  console.log(`First browser view: ${report.pageReadyMs} ms; server + browser: ${report.serverToTimelineReadyMs} ms`);
  const indexDeadline = performance.now() + 240000;
  let lastProgress = performance.now();
  for (;;) {
    const state = await loading();
    if (state.complete) { report.loading.indexComplete = state; break; }
    if (performance.now() > indexDeadline) throw new Error('Archive index did not complete within 240 seconds');
    if (performance.now() - lastProgress > 10000) { console.log(`Indexing: ${state.indexedFiles} files, ${state.indexedRecords} records`); lastProgress = performance.now(); }
    await page.waitForTimeout(1000);
  }
  report.serverToIndexCompleteMs = round(performance.now() - serverStarted);
  await memory('index-complete');
  if (!await page.locator('#source-filter').isVisible()) await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await ready(page);
  const source1 = await page.locator('#source-filter option').evaluateAll(items => items.find(item => item.textContent.includes('SOURCE1'))?.value);
  if (!source1) throw new Error('SOURCE1 filter is unavailable');
  async function measure(kind, label, action, iteration) {
    const before = await snapshot(page), started = performance.now();
    await action(); await ready(page, before);
    const milliseconds = round(performance.now() - started), after = await snapshot(page);
    report.operations.push({ iteration, kind, label, milliseconds, ...after });
    console.log(`${iteration} ${kind}/${label}: ${milliseconds} ms; ${after.detailTotal} records`);
  }
  async function range(from, to, iteration, label) {
    await page.getByRole('button', { name: 'Date and time range', exact: true }).click();
    await page.getByLabel('Start / UTC', { exact: true }).fill(from);
    await page.getByLabel('End / UTC', { exact: true }).fill(to);
    await measure('navigation', label, () => page.getByRole('button', { name: 'Apply range', exact: true }).click(), iteration);
  }
  for (let iteration = 1; iteration <= runs; iteration++) {
    await range('2024-11-11T00:00', '2024-11-12T00:00', iteration, 'November 11');
    await range('2024-03-17T00:00', '2024-03-25T00:00', iteration, 'March 17–25');
    await measure('source-filter', 'SOURCE1', () => page.locator('#source-filter').selectOption(source1), iteration);
    await measure('source-filter', 'all', () => page.locator('#source-filter').selectOption('all'), iteration);
    for (const label of ['status', 'namespace', 'none']) {
      const value = await page.locator('#grouping-mode option').evaluateAll((items, name) => items.find(item => item.textContent.toLowerCase() === name)?.value, label);
      if (value === undefined) throw new Error(`Dynamic grouping ${label} unavailable`);
      await measure('grouping', label, () => page.locator('#grouping-mode').selectOption(value), iteration);
    }
    await memory(`iteration-${iteration}`);
  }
  await range('2024-03-24T00:00', '2024-03-25T00:00', runs + 1, 'pan preparation');
  const plot = await page.locator('.plot-wrap').boundingBox(), x = plot.x + plot.width * .5, y = plot.y + plot.height * .8;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.evaluate(() => {
    window.__archiveFrames = { running: true, intervals: [], previous: null };
    const frame = time => {
      const trace = window.__archiveFrames;
      if (!trace.running) return;
      if (trace.previous !== null) trace.intervals.push(time - trace.previous);
      trace.previous = time; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const offsets = [-.25, .25, -.1], traceStarted = performance.now();
  let previous = 0;
  for (const target of offsets) {
    for (let step = 1; step <= 16; step++) {
      await page.mouse.move(x + plot.width * (previous + (target - previous) * step / 16), y);
      await page.waitForTimeout(16);
    }
    previous = target;
  }
  const panDuring = await page.evaluate(() => {
    window.__archiveFrames.running = false;
    return { intervals: window.__archiveFrames.intervals, phase: window.__timelineDebug.navigationPhase, offset: window.__timelineDebug.navigationOffset };
  });
  await page.mouse.up(); await ready(page);
  report.pan = { offsets, stepsPerSegment: 16, requestedPacingMs: 16, elapsedMs: round(performance.now() - traceStarted), during: panDuring,
    frameIntervalMs: summarize(panDuring.intervals), intervalsOver50Ms: panDuring.intervals.filter(value => value > 50).length, after: await snapshot(page) };
  if (panDuring.phase !== 'dragging' || panDuring.intervals.length < 2) throw new Error('Fixed pan trace did not exercise a rendered drag');
  await memory('after-pan');
  report.loading.final = await loading();
  report.summaries = Object.fromEntries(['navigation', 'source-filter', 'grouping'].map(kind => [kind, summarize(report.operations.filter(value => value.kind === kind && value.label !== 'pan preparation').map(value => value.milliseconds))]));
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output.replace(/\.json$/i, '') + '.png' });
  if (report.pageErrors.length) throw new Error(`Browser errors: ${report.pageErrors.join('; ')}`);
  report.status = 'measured';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || error.message; process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupted);
  try { await browser?.close(); } finally {
    await stopServer();
    if (beforeInventory) {
      report.integrityAfter = await inventory();
      report.sourcesUnchanged = JSON.stringify(report.integrityAfter) === JSON.stringify(beforeInventory);
      if (!report.sourcesUnchanged) { report.status = 'failed'; report.error = 'Source archive receipts changed'; process.exitCode = 1; }
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
}
console.log(`Report: ${output} (${report.status}). ${report.methodology.interpretation}`);
