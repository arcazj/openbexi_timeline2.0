import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacySseDecoder, createLegacyTransport, installLegacyTransport } from '../../client/src/data/legacy-transport.js';

const baseUrl = 'http://127.0.0.1:8765';
const streamUrl = `${baseUrl}/openbexi_timeline_sse/sessions?scene=0`;
const frameResponse = text => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const waitEvent = (source, name) => new Promise(resolve => source.addEventListener(name, resolve, { once: true }));

test('SSE decoder handles split CRLF, BOM, multiline data, bounded retry and unterminated EOF', () => {
  const events = [], retries = [], ids = [];
  const parser = createLegacySseDecoder({ onEvent: event => events.push(event), onRetry: value => retries.push(value), onId: value => ids.push(value) });
  parser.push('\uFEFF: heartbeat\r'); parser.push('\nid: revision-1\r\nevent: update\r\ndata: one\r');
  parser.push('\ndata: two\r\nretry: 999999\r\n\r'); parser.push('\n');
  parser.push('data: discarded at EOF', true);
  assert.deepEqual(events, [{ type: 'update', data: 'one\ntwo', lastEventId: 'revision-1' }]);
  assert.deepEqual(retries, [30000]); assert.deepEqual(ids, ['revision-1']);
});
test('SSE bounds apply to complete and incomplete frames and reset between events', () => {
  const parser = createLegacySseDecoder({ onEvent() {}, maxEventCharacters: 20 });
  parser.push('data: one\n\ndata: two\n\n');
  assert.throws(() => parser.push('data: '.padEnd(21, 'x')), /bound/);
  assert.throws(() => createLegacySseDecoder({ onEvent() {}, maxEventCharacters: 20 }).push('data: '.padEnd(21, 'x') + '\n\n'), /bound/);
});
test('fetch auth is scoped to exact origin/session routes and never follows redirects', async () => {
  const calls = [], transport = createLegacyTransport({ baseUrl, token: 'secret', fetch: async (...args) => { calls.push(args); return new Response('{}'); } });
  await transport.request('/openbexi_timeline/sessions?scene=1', { method: 'POST', body: 'payload', headers: { 'Content-Type': 'text/plain' } });
  const [url, init] = calls[0]; assert.equal(url, `${baseUrl}/openbexi_timeline/sessions?scene=1`);
  assert.equal(init.headers.get('authorization'), 'Bearer secret'); assert.equal(init.headers.get('x-openbexi-local'), '1');
  assert.equal(init.body, 'payload'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'same-origin');
  assert.throws(() => transport.request('https://other.test/openbexi_timeline/sessions'), /restricted/);
  assert.throws(() => transport.request('/api/v1/workspaces/default'), /restricted/); assert.equal(calls.length, 1);
});
test('EventSource reads UTF-8 chunks, dispatches messages and closes without reconnecting', async () => {
  let reads = 0;
  const transport = createLegacyTransport({ baseUrl, fetch: async () => {
    reads++; const bytes = new TextEncoder().encode('id: one\ndata: "séisme"\n\n');
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const source = new transport.EventSource(streamUrl), event = await waitEvent(source, 'message');
  assert.equal(event.data, '"séisme"'); assert.equal(event.lastEventId, 'one'); assert.equal(event.origin, baseUrl);
  source.close(); assert.equal(source.readyState, source.CLOSED); assert.equal(reads, 1); transport.dispose();
});
test('401 pauses streaming until credentials update and replacement carries only the new token', async () => {
  const tokens = [];
  const transport = createLegacyTransport({ baseUrl, token: 'old', fetch: async (url, init) => { tokens.push(init.headers.get('authorization')); return tokens.length === 1 ? new Response('', { status: 401 }) : frameResponse('data: ready\n\n'); } });
  const source = new transport.EventSource(streamUrl), failure = await waitEvent(source, 'error');
  assert.equal(failure.status, 401); assert.equal(source.readyState, source.CLOSED); assert.equal(tokens.length, 1);
  const next = waitEvent(source, 'message'); transport.updateCredentials('new'); assert.equal((await next).data, 'ready');
  source.close(); assert.deepEqual(tokens, ['Bearer old', 'Bearer new']); transport.dispose();
});
test('authorization error frame stops retry and explicit close stays closed after token update', async () => {
  let calls = 0;
  const transport = createLegacyTransport({ baseUrl, fetch: async () => { calls++; return frameResponse('event: error\ndata: {"status":403}\n\n'); } });
  const source = new transport.EventSource(streamUrl), failure = await waitEvent(source, 'error');
  assert.equal(failure.status, 403); source.close(); transport.updateCredentials('new');
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(source.readyState, source.CLOSED); transport.dispose();
});
test('normal lease completion reconnects with Last-Event-ID and close cancels the next timer', async () => {
  const ids = [];
  const transport = createLegacyTransport({ baseUrl, reconnectDelay: 100, fetch: async (url, init) => { ids.push(init.headers.get('Last-Event-ID')); return frameResponse(`id: ${ids.length}\nretry: 100\ndata: value\n\n`); } });
  const source = new transport.EventSource(streamUrl);
  await new Promise(resolve => source.addEventListener('message', () => { if (ids.length === 2) { source.close(); resolve(); } }));
  assert.deepEqual(ids, [null, '1']); assert.equal(source.readyState, source.CLOSED); transport.dispose();
});
test('installed shim delegates unrelated requests and native streams and restores originals', async () => {
  const calls = [], nativeStreams = [];
  const target = { fetch: async (...args) => { calls.push(args); return new Response('{}'); }, EventSource: class { constructor(url) { nativeStreams.push(url); } } };
  const original = { ...target }, shim = installLegacyTransport({ target, baseUrl, token: 'secret' });
  await target.fetch('/unrelated', { headers: { marker: 'untouched' } });
  await target.fetch(`${baseUrl}/openbexi_timeline/sessions`);
  new target.EventSource('https://other.test/stream');
  assert.deepEqual(calls[0], ['/unrelated', { headers: { marker: 'untouched' } }]);
  assert.equal(calls[1][1].headers.get('authorization'), 'Bearer secret'); assert.deepEqual(nativeStreams, ['https://other.test/stream']);
  shim.uninstall(); assert.equal(target.fetch, original.fetch); assert.equal(target.EventSource, original.EventSource);
});
