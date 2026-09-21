import { setTimeout as delay } from 'node:timers/promises';

// One elapsed budget: fast connection refusals must not shorten startup, and
// slow probes must not multiply the deadline. Matches the ordinary server fixture.
export async function waitForFixtureReady({ name, childState, probe, logs = () => '',
  timeoutMs = 30000, clock = () => performance.now(), pause = delay }) {
  const started = clock(), deadline = started + timeoutMs;
  let attempts = 0, lastProbe = 'not attempted';
  const failure = reason => new Error(`${name} ${reason}; ${JSON.stringify({
    elapsedMs: Math.round(clock() - started), attempts, lastProbe, ...childState(),
  })}\n${logs()}`);
  const stopped = () => {
    const child = childState();
    return child.spawnError || child.exitCode !== null || child.signalCode !== null;
  };
  while (clock() < deadline) {
    if (stopped()) throw failure('exited before readiness');
    const remaining = Math.max(1, Math.ceil(deadline - clock()));
    attempts++;
    try {
      const status = await probe(AbortSignal.timeout(Math.min(250, remaining)));
      lastProbe = `HTTP ${status}`;
      if (status >= 200 && status < 300 && clock() <= deadline && !stopped()) return;
    } catch (error) {
      lastProbe = error.cause?.code || error.code || error.name;
    }
    if (stopped()) throw failure('exited before readiness');
    const rest = deadline - clock();
    if (rest > 0) await pause(Math.min(100, rest));
  }
  throw failure('did not become ready');
}
