/** Real-browser smoke test; no npm dependencies. Requires Node 22+ and Chrome/Edge. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {access, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../serve.js';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch { /* try next browser */ }
}
if (!executable) throw new Error('Chrome/Edge was not found. Set CHROME_PATH to its executable.');
if (typeof WebSocket === 'undefined') throw new Error('The browser smoke test requires Node 22+ (built-in WebSocket).');

const server = await startServer({port: 0});
const profile = await mkdtemp(path.join(tmpdir(), 'openbexi-browser-smoke-'));
const browser = spawn(executable, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-default-apps', '--disable-sync', 'about:blank',
], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
let socket;
let stderr = '';

try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Browser startup timed out. ${stderr}`)), 15000);
    browser.once('error', error => { clearTimeout(timer); reject(error); });
    browser.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited with ${code}. ${stderr}`)); });
    browser.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-20000);
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
  const pages = await fetch(`${debugOrigin}/json/list`).then(response => response.json());
  const page = pages.find(entry => entry.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Browser created a page target');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.id && pending.has(message.id)) {
      const {resolve, reject, timer} = pending.get(message.id);
      clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for browser condition: ${expression}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  const address = `http://127.0.0.1:${server.address().port}/`;
  await send('Page.navigate', {url: address});
  await waitFor('document.readyState === "complete"');

  await waitFor('document.querySelector("#config-pastCount") !== null');
  assert.equal(await evaluate('document.title'), 'OpenBEXI Timeline Generator');
  assert.ok(await evaluate('document.querySelectorAll("#config-tree details").length >= 7'), 'Configuration is mounted as an expandable tree');
  await send('Page.setDownloadBehavior', {behavior: 'deny'});
  await evaluate(`(() => {
    window.__smokeBlobs = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { window.__smokeBlobs.push(blob); return original(blob); };
    document.querySelector('#config-pastCount').value = '2';
    document.querySelector('#config-futureCount').value = '3';
    document.querySelector('#config-seed').value = '"browser-smoke"';
    document.querySelector('#generate').click();
  })()`);
  await waitFor('document.querySelector("#generation-status").textContent === "Generation complete"');
  assert.equal(await evaluate('document.querySelectorAll("#event-rows tr").length'), 5, 'Configured exact counts reach the preview');
  assert.equal(await evaluate('document.querySelector("#errors").hidden'), true);
  assert.equal(await evaluate('document.querySelectorAll("#timeline-chart rect").length'), 5, 'SVG overview draws every sampled event');
  await evaluate('document.querySelector("#download-timeline").click()');
  const firstJSON = await evaluate('window.__smokeBlobs.at(-1).text()');
  const first = JSON.parse(firstJSON);
  assert.equal(first.dateTimeFormat, 'iso8601');
  assert.equal(first.events.length, 5, 'Download contains all events');
  assert.ok(first.events.every(event => event.activities.length > 0), 'Nested activities survive browser worker serialization');
  assert.equal(first.events.filter(event => Date.parse(event.start) < Date.parse('2026-01-15T00:00:00Z')).length, 2);

  await evaluate('document.querySelector("#generate").click()');
  await waitFor('document.querySelector("#generation-status").textContent === "Generation complete"');
  await evaluate('document.querySelector("#download-timeline").click()');
  assert.equal(await evaluate('window.__smokeBlobs.at(-1).text()'), firstJSON, 'Same browser settings and seed reproduce exact JSON');

  await evaluate('document.querySelector("#download-all").click()');
  await waitFor('!document.querySelector("#download-all").disabled');
  assert.equal(await evaluate('document.querySelector("#errors").hidden'), true, 'Archive download succeeds');
  assert.deepEqual(await evaluate('window.__smokeBlobs.at(-1).arrayBuffer().then(buffer => [...new Uint8Array(buffer).slice(0,4)])'), [80, 75, 3, 4], 'Archive contains a ZIP local-file header');

  await evaluate(`(() => {
    document.querySelector('#config-pastCount').value = '-1';
    document.querySelector('#generate').click();
  })()`);
  assert.equal(await evaluate('document.querySelector("#errors").hidden'), false, 'Invalid values display validation feedback');
  assert.equal(await evaluate('document.querySelector("#config-pastCount").getAttribute("aria-invalid")'), 'true');
  assert.match(await evaluate('document.querySelector("#errors").textContent'), /pastCount/);

  await evaluate(`(() => {
    document.querySelector('#config-pastCount').value = '0';
    document.querySelector('#config-futureCount').value = '0';
    document.querySelector('#generate').click();
  })()`);
  await waitFor('document.querySelector("#generation-status").textContent === "Generation complete"');
  assert.equal(await evaluate('document.querySelectorAll("#event-rows tr").length'), 0, 'Zero-count generation has an empty preview');
  assert.equal(await evaluate('document.querySelector("#errors").hidden'), true, 'Successful correction clears validation feedback');

  await evaluate(`(() => {
    document.querySelector('#config-mode').value = 'legacy-simple';
    document.querySelector('#config-legacy-eventCount').value = '8';
    document.querySelector('#generate').click();
  })()`);
  await waitFor('document.querySelector("#generation-status").textContent === "Generation complete"');
  assert.equal(await evaluate('document.querySelectorAll("#event-rows tr").length'), 8, 'Legacy mode is selectable and runs through the worker');
  await evaluate('document.querySelector("#download-timeline").click()');
  const legacy = JSON.parse(await evaluate('window.__smokeBlobs.at(-1).text()'));
  assert.equal(legacy.events[0].activities.length, 4);
  assert.equal(legacy.events[1].activities.length, 3);
  assert.equal(Date.parse(legacy.events[0].end) - Date.parse(legacy.events[0].start), 1000000);

  // Date selection is exercised through the same calendar buttons users click.
  const downloadJSON = async selector => {
    const before = await evaluate('window.__smokeBlobs.length');
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    assert.equal(await evaluate('window.__smokeBlobs.length'), before + 1, `${selector} exports a document`);
    return JSON.parse(await evaluate('window.__smokeBlobs.at(-1).text()'));
  };
  const generate = async () => {
    await evaluate('document.querySelector("#generate").click()');
    await waitFor('!document.querySelector("#generate").disabled');
    assert.equal(await evaluate('document.querySelector("#errors").hidden'), true,
      await evaluate('document.querySelector("#errors").textContent'));
    assert.equal(await evaluate('document.querySelector("#generation-status").textContent'), 'Generation complete');
    return downloadJSON('#download-timeline');
  };
  await evaluate('document.querySelector("#reset-config").click()');
  assert.ok(await evaluate('document.querySelector("#date-calendar") !== null'), 'Date selection mounts as a calendar');
  assert.equal(await evaluate(`document.querySelectorAll('input[name="referenceDate"], input[name="rangeStart"], input[name="rangeEnd"], input[name="boundaryStart"], input[name="boundaryEnd"]').length`), 0,
    'The calendar replaces all five raw ISO date inputs');
  const reset = await downloadJSON('#save-config');
  assert.equal(reset.referenceDate, '2026-01-15T00:00:00.000Z', 'Reset preserves the original reference instant before calendar edits');
  assert.equal(reset.rangeStart, '2026-01-01T00:00:00.000Z');
  assert.equal(reset.rangeEnd, '2026-02-01T00:00:00.000Z');

  await evaluate(`(() => {
    document.querySelector('#config-pastCount').value = '2';
    document.querySelector('#config-futureCount').value = '3';
    document.querySelector('#config-duration-mode').value = 'fixed';
    document.querySelector('#config-duration-fixedMinutes').value = '30';
    document.querySelector('#config-pointEventProbability').value = '0';
    document.querySelector('#calendar-mode-days').click();
    document.querySelector('#calendar-clear').click();
    document.querySelector('[data-date="2026-01-10"]').click();
    document.querySelector('[data-date="2026-01-20"]').click();
  })()`);
  const selected = await downloadJSON('#save-config');
  assert.deepEqual(selected.selectedDays, ['2026-01-10', '2026-01-20'], 'Separate clicks select nonconsecutive days');
  assert.equal(selected.rangeStart, '2026-01-10T00:00:00.000Z');
  assert.equal(selected.boundaryStart, selected.rangeStart);
  assert.equal(selected.rangeEnd, '2026-01-21T00:00:00.000Z', 'The last selected day is included through the next midnight');
  assert.equal(selected.boundaryEnd, selected.rangeEnd);
  assert.ok(selected.selectedDays.includes(selected.referenceDate.slice(0, 10)), 'When necessary, selection moves the reference onto a selected day');
  assert.equal(selected.referenceDate.slice(11), '12:00:00.000Z', 'Automatic reference selection uses UTC noon');
  assert.equal(await evaluate('document.querySelector("[data-date=\\"2026-01-10\\"]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-date=\\"2026-01-20\\"]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-date=\\"2026-01-15\\"]").getAttribute("aria-pressed")'), 'false');

  await evaluate(`(() => {
    document.querySelector('#calendar-mode-reference').click();
    document.querySelector('[data-date="2026-01-15"]').click();
  })()`);
  const withReference = await downloadJSON('#save-config');
  assert.equal(withReference.referenceDate, '2026-01-15T12:00:00.000Z', 'Reference mode selects the middle of the clicked UTC day');
  assert.deepEqual(withReference.selectedDays, selected.selectedDays, 'Setting a reference does not add an unselected day');
  const calendarEvents = await generate();
  assert.equal(calendarEvents.events.length, 5);
  const countsByDay = {};
  for (const event of calendarEvents.events) {
    const day = new Date(event.start).toISOString().slice(0, 10);
    countsByDay[day] = (countsByDay[day] ?? 0) + 1;
    assert.ok(selected.selectedDays.includes(day), 'Generated events skip all unselected dates between selections');
    assert.ok(Date.parse(event.end) <= Date.parse(`${day}T00:00:00Z`) + 86400000, 'Sessions stay inside the selected day');
  }
  assert.deepEqual(countsByDay, {'2026-01-10': 2, '2026-01-20': 3}, 'Default density keeps both isolated selected days available');

  // A full-day session proves the upper boundary is exclusive next midnight,
  // rather than midnight at the beginning of the last selected date.
  await evaluate(`(() => {
    document.querySelector('#config-pastCount').value = '0';
    document.querySelector('#config-futureCount').value = '1';
    document.querySelector('#config-duration-fixedMinutes').value = '1440';
    document.querySelector('#config-density').value = 'sparse';
  })()`);
  const wholeDay = await generate();
  assert.equal(wholeDay.events.length, 1);
  assert.equal(new Date(wholeDay.events[0].start).toISOString(), '2026-01-20T00:00:00.000Z');
  assert.equal(new Date(wholeDay.events[0].end).toISOString(), '2026-01-21T00:00:00.000Z');

  await evaluate(`(() => {
    document.querySelector('#calendar-mode-days').click();
    document.querySelector('#calendar-clear').click();
    document.querySelector('#generate').click();
  })()`);
  assert.equal(await evaluate('document.querySelector("#errors").hidden'), false, 'Clearing all days cannot silently generate over the former range');
  assert.match(await evaluate('document.querySelector("#errors").textContent'), /select|day|date/i);
  assert.equal(await evaluate('document.querySelector("#generate").disabled'), false);

  await evaluate(`(() => {
    document.querySelector('#reset-config').click();
    document.querySelector('#calendar-mode-days').click();
    document.querySelector('#calendar-clear').click();
    document.querySelector('#calendar-previous').click();
    document.querySelector('[data-date="2025-12-31"]').click();
    document.querySelector('#calendar-next').click();
    document.querySelector('[data-date="2026-01-02"]').dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: true}));
  })()`);
  const crossYear = await downloadJSON('#save-config');
  assert.deepEqual(crossYear.selectedDays, ['2025-12-31', '2026-01-01', '2026-01-02'], 'Shift-click selects a contiguous range across month and year boundaries');
  assert.equal(crossYear.rangeStart, '2025-12-31T00:00:00.000Z');
  assert.equal(crossYear.rangeEnd, '2026-01-03T00:00:00.000Z');
  await evaluate('document.querySelector("[data-date=\\"2026-01-01\\"]").click()');
  const toggled = await downloadJSON('#save-config');
  assert.deepEqual(toggled.selectedDays, ['2025-12-31', '2026-01-02'], 'Clicking a selected day again removes only that day');
  await evaluate('document.querySelector("#reset-config").click()');
  assert.deepEqual(await downloadJSON('#save-config'), reset, 'Reset restores the complete original configuration after date edits');
  assert.deepEqual(exceptions, [], 'No unhandled browser exceptions');
  console.log('Browser smoke passed: tree controls, worker generation, repeatability, validation, legacy mode, downloads, calendar day toggles, reference selection, disconnected dates, full-day boundaries, empty selection, Shift ranges and reset.');
} finally {
  socket?.close();
  if (browser.exitCode === null) {
    const stopped = once(browser, 'exit').catch(() => {});
    browser.kill();
    await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  await new Promise(resolve => server.close(resolve));
  // Only remove this run's newly created profile after confirming its location.
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('openbexi-browser-smoke-')) {
    await rm(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}).catch(() => {});
  }
}
