import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Serve the unchanged bundle and a genuinely slow HTTP response, without routing
// interception or replacing fetch. The inspection gate cannot shorten the delay.
export async function startColdBootstrapHttpFixture({ html, port = 0 } = {}) {
  const document = html ?? await readFile(new URL('../../dist/index.html', import.meta.url));
  const receipts = [], errors = [], sockets = new Set(), tasks = new Set(), controllers = new Set();
  let enter, release, stopPromise, stopping = false;
  const requested = new Promise(resolve => { enter = resolve; });
  const inspected = new Promise(resolve => { release = resolve; });
  const report = { bundleSha256: createHash('sha256').update(document).digest('hex'), receipts, errors,
    get pendingTasks() { return tasks.size; }, get openSockets() { return sockets.size; } };
  async function handle(request, response) {
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
    if (pathname === '/' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(document) });
      response.end(document); return;
    }
    if (pathname !== '/api/v1/bootstrap') { response.writeHead(404); response.end(); return; }
    const receipt = { method: request.method, path: pathname, receivedAt: performance.now(), receivedEpochMs: Date.now() };
    receipts.push(receipt); enter(receipt);
    const controller = new AbortController(); controllers.add(controller);
    const closed = () => { if (!response.writableEnded) { receipt.abortedAt = performance.now(); controller.abort(); } };
    response.once('close', closed);
    const minimumDelay = async () => {
      const until = receipt.receivedAt + 2500;
      while (performance.now() < until) await delay(Math.max(1, Math.ceil(until - performance.now())), undefined, { signal: controller.signal });
    };
    let aborted;
    const canceled = new Promise((resolve, reject) => {
      aborted = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', aborted, { once: true });
    });
    try {
      // A disconnect must also interrupt inspection after the timer has elapsed.
      await Promise.race([Promise.all([minimumDelay(), inspected]), canceled]);
      if (stopping || controller.signal.aborted || response.destroyed) return;
      receipt.respondedAt = performance.now(); receipt.elapsedMs = receipt.respondedAt - receipt.receivedAt; receipt.status = 404;
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"detail":"Not Found"}');
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    } finally {
      controllers.delete(controller); response.removeListener('close', closed);
      controller.signal.removeEventListener('abort', aborted);
    }
  }
  const server = createServer((request, response) => {
    const task = handle(request, response).catch(error => {
      errors.push({ name: error.name, message: error.message }); response.destroy();
    }).finally(() => tasks.delete(task));
    tasks.add(task);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const stop = () => stopPromise ??= (async () => {
    stopping = true; release(); for (const controller of controllers) controller.abort();
    const closed = new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
    const socketClosures = [...sockets].map(socket => {
      const ended = new Promise(resolve => socket.once('close', resolve)); socket.destroy(); return ended;
    });
    await Promise.all([closed, ...socketClosures, Promise.all([...tasks])]);
    report.stopped = true;
  })();
  try { server.listen(port, '127.0.0.1'); await once(server, 'listening'); }
  catch (error) { await stop(); throw error; }
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requested, release, stop, report,
    idle: () => Promise.all([...tasks]) };
}
