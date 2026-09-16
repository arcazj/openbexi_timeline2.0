import {DEFAULT_CONFIG, normalizeConfig} from '../config.js';
import {TreeSJEditor} from './tree.sj.js';

const $ = selector => document.querySelector(selector);
const editor = new TreeSJEditor($('#config-tree'), DEFAULT_CONFIG);
let worker;
let generated;

function showError(error) {
  const errors = error.errors?.length ? error.errors : [error.message || String(error)];
  const box = $('#errors');
  box.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = 'Please review these settings';
  const list = document.createElement('ul');
  for (const message of errors) {
    const item = document.createElement('li');
    item.textContent = message;
    list.append(item);
  }
  box.append(title, list);
  box.hidden = false;
  editor.markErrors(errors);
  box.focus();
}

function clearError() { $('#errors').hidden = true; }
function busy(active, message) {
  $('#generate').disabled = active;
  $('#cancel').hidden = !active;
  $('#generation-status').textContent = message;
  $('#config-tree').setAttribute('aria-busy', String(active));
}
function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const utc = value => {
  if (!value) return 'Point event';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace('.000Z', '') : value;
};

function render(result) {
  generated = result;
  const events = result.timeline.events;
  $('#empty-preview').hidden = true;
  $('#preview-content').hidden = false;
  $('#result-summary').textContent = `${events.length.toLocaleString()} events generated · ${result.config.mode} · namespace ${result.config.namespace}`;
  const pointCount = events.filter(event => !event.end).length;
  const activities = events.reduce((count, event) => count + (event.activities?.length ?? 0), 0);
  $('#stats').replaceChildren();
  for (const [label, value] of [['Events', events.length], ['Point events', pointCount], ['Activities', activities], ['Output files', result.files.length]]) {
    const card = document.createElement('div');
    const number = document.createElement('strong');
    number.textContent = value.toLocaleString();
    const name = document.createElement('span');
    name.textContent = label;
    card.append(number, name);
    $('#stats').append(card);
  }
  $('#warnings').replaceChildren();
  $('#warnings').hidden = !result.warnings?.length;
  for (const warning of result.warnings ?? []) {
    const line = document.createElement('p');
    line.textContent = typeof warning === 'string' ? warning : JSON.stringify(warning);
    $('#warnings').append(line);
  }
  $('#event-rows').replaceChildren();
  for (const event of events.slice(0, 150)) {
    const row = document.createElement('tr');
    for (const value of [event.data?.title, utc(event.start), utc(event.end), event.data?.type, event.data?.system, event.data?.priority]) {
      const cell = document.createElement('td');
      cell.textContent = value ?? '—';
      row.append(cell);
    }
    $('#event-rows').append(row);
  }
  $('#json-output').textContent = json({...result.timeline, events: events.slice(0, 3)});
  drawTimeline(events);
}

function drawTimeline(events) {
  const svg = $('#timeline-chart');
  svg.replaceChildren();
  const sample = events.slice(0, 120);
  if (!sample.length) { $('#chart-caption').textContent = 'No events requested.'; return; }
  const min = Math.min(...sample.map(event => Date.parse(event.start)));
  const max = Math.max(...sample.map(event => Date.parse(event.end || event.start)));
  const span = Math.max(1, max - min);
  const element = (name, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  for (let i = 0; i <= 4; i++) {
    const x = 12 + i * 184;
    svg.append(element('line', {x1: x, x2: x, y1: 10, y2: 200, stroke: '#e1e9ef'}));
  }
  sample.forEach((event, index) => {
    const x = 12 + 736 * (Date.parse(event.start) - min) / span;
    const end = Date.parse(event.end || event.start);
    const width = Math.max(3, 736 * (end - Date.parse(event.start)) / span);
    const rect = element('rect', {x, y: 12 + (index % 16) * 12, width, height: 7, rx: 2,
      fill: /^#[\da-f]{6}$/i.test(event.render?.color) ? event.render.color : '#167d94', opacity: 0.85});
    const title = element('title', {});
    title.textContent = `${event.data?.title}: ${utc(event.start)}`;
    rect.append(title);
    svg.append(rect);
  });
  $('#chart-caption').textContent = `${utc(new Date(min).toISOString())} — ${utc(new Date(max).toISOString())} · first ${sample.length} events, displayed across 16 rows`;
}

$('#generator-form').addEventListener('submit', event => {
  event.preventDefault();
  clearError();
  let config;
  try { config = normalizeConfig(editor.getValue()); } catch (error) { showError(error); return; }
  worker?.terminate();
  busy(true, 'Generating timeline…');
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = ({data}) => {
      worker.terminate();
      worker = undefined;
      if (data.ok) { render(data.result); busy(false, 'Generation complete'); }
      else { showError(data.error); busy(false, 'Generation failed'); }
    };
    worker.onerror = event => {
      worker?.terminate();
      worker = undefined;
      showError(new Error(event.message || 'The generation worker could not start. Serve this page through the provided local HTTP server.'));
      busy(false, 'Generation failed');
    };
    worker.postMessage(config);
  } catch (error) { showError(error); busy(false, 'Generation failed'); }
});
$('#cancel').addEventListener('click', () => { worker?.terminate(); worker = undefined; busy(false, 'Generation cancelled'); });
$('#reset-config').addEventListener('click', () => { editor.setValue(DEFAULT_CONFIG); clearError(); });
$('#save-config').addEventListener('click', () => {
  try { download('timeline-generator.config.json', json(normalizeConfig(editor.getValue()))); clearError(); } catch (error) { showError(error); }
});
$('#load-config').addEventListener('click', () => $('#config-file').click());
$('#config-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1048576) throw new Error('Configuration files must be smaller than 1 MB.');
    editor.setValue(normalizeConfig(JSON.parse(await file.text())));
    clearError();
    $('#generation-status').textContent = `Loaded ${file.name}`;
  } catch (error) { showError(error); }
  event.target.value = '';
});
$('#download-timeline').addEventListener('click', () => download('events.json', json(generated.timeline)));
$('#download-used-config').addEventListener('click', () => download('timeline-generator.config.json', json(generated.config)));
$('#download-all').addEventListener('click', async () => {
  const button = $('#download-all');
  button.disabled = true;
  try {
    const {createZip} = await import('../archive.js');
    const files = [...generated.files, {path: 'timeline-generator.config.json', document: generated.config}];
    download('timeline-data.zip', await createZip(files), 'application/zip');
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
