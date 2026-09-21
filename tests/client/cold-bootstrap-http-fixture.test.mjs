import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startColdBootstrapHttpFixture } from '../integration/cold-bootstrap-http-fixture.mjs';

const html = '<!doctype html><title>Native bootstrap fixture</title>';
async function fixture(t) {
  const owned = await startColdBootstrapHttpFixture({ html });
  t.after(async () => {
    await owned.stop();
    assert.equal(owned.report.pendingTasks, 0);
    assert.equal(owned.report.openSockets, 0);
    assert.deepEqual(owned.report.errors, []);
  });
  return owned;
}

test('a released inspection gate still serves a real 404 only after 2.5 seconds', { timeout: 10000 }, async t => {
  const owned = await fixture(t);
  assert.equal(await (await fetch(owned.baseUrl)).text(), html);
  const pending = fetch(`${owned.baseUrl}/api/v1/bootstrap`); void pending.catch(() => {});
  await owned.requested; owned.release();
  const response = await pending;
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { detail: 'Not Found' });
  assert.equal(owned.report.receipts.length, 1);
  assert.ok(owned.report.receipts[0].elapsedMs >= 2500);
});

test('elapsed server delay cannot bypass a still-held inspection gate', { timeout: 10000 }, async t => {
  const owned = await fixture(t);
  let responded = false;
  const pending = fetch(`${owned.baseUrl}/api/v1/bootstrap`).then(response => { responded = true; return response; });
  void pending.catch(() => {});
  const receipt = await owned.requested;
  await delay(2550);
  assert.equal(responded, false);
  assert.equal(receipt.status, undefined);
  owned.release();
  const response = await pending;
  assert.equal(response.status, 404);
  await response.arrayBuffer();
  assert.ok(receipt.elapsedMs >= 2500);
});

for (const elapsed of [0, 2550]) test(`client disconnect after ${elapsed}ms cancels work without releasing inspection`, { timeout: 10000 }, async t => {
  const owned = await fixture(t), controller = new AbortController();
  const pending = fetch(`${owned.baseUrl}/api/v1/bootstrap`, { signal: controller.signal }); void pending.catch(() => {});
  const receipt = await owned.requested;
  if (elapsed) await delay(elapsed);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await owned.idle();
  assert.equal(owned.report.pendingTasks, 0);
  assert.ok(Number.isFinite(receipt.abortedAt));
  assert.equal(receipt.status, undefined);
});

test('shutdown drains a held request and is idempotent', { timeout: 10000 }, async t => {
  const owned = await fixture(t);
  const pending = fetch(`${owned.baseUrl}/api/v1/bootstrap`); void pending.catch(() => {});
  await owned.requested;
  const stopped = owned.stop();
  assert.equal(owned.stop(), stopped);
  await stopped;
  await assert.rejects(pending);
  assert.equal(owned.report.stopped, true);
  assert.equal(owned.report.pendingTasks, 0);
  assert.equal(owned.report.openSockets, 0);
  assert.equal(owned.report.receipts[0].status, undefined);
});

test('failed listen preserves the occupied fixture and cleans up its own attempt', { timeout: 10000 }, async t => {
  const owned = await fixture(t), port = Number(new URL(owned.baseUrl).port);
  await assert.rejects(startColdBootstrapHttpFixture({ html, port }), { code: 'EADDRINUSE' });
  assert.equal(await (await fetch(owned.baseUrl)).text(), html);
});
