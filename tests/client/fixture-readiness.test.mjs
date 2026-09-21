import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForFixtureReady } from '../integration/fixture-readiness.mjs';

const running = () => ({ pid: 42, exitCode: null, signalCode: null, spawnError: null });
const refused = () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };

test('fast refusals do not exhaust startup before the elapsed readiness deadline', async () => {
  let now = 0, attempts = 0;
  await waitForFixtureReady({ name: 'Fixture', childState: running, clock: () => now,
    pause: async duration => { now += duration; },
    probe: async () => { attempts++; if (now < 20000) refused(); return 200; },
  });
  assert.equal(now, 20000);
  assert.equal(attempts, 201);
});

for (const latency of [0, 250]) test(`failed ${latency}ms probes share one bounded elapsed startup budget`, async () => {
  let now = 0;
  await assert.rejects(waitForFixtureReady({ name: 'Fixture', childState: running, clock: () => now,
    pause: async duration => { now += duration; }, logs: () => 'Interpreter checkpoint',
    probe: async () => { now += Math.min(latency, 30000 - now); refused(); },
  }), error => {
    assert.match(error.message, /did not become ready/);
    assert.match(error.message, /"elapsedMs":30000/);
    assert.match(error.message, /"lastProbe":"ECONNREFUSED"/);
    assert.match(error.message, /"pid":42/);
    assert.match(error.message, /Interpreter checkpoint/);
    return true;
  });
  assert.equal(now, 30000);
});

test('spawn failure, exit code and signal stop readiness without additional probes', async () => {
  for (const change of [{ spawnError: 'ENOENT', pid: null }, { exitCode: 1 }, { signalCode: 'SIGTERM' }]) {
    await assert.rejects(waitForFixtureReady({ name: 'Fixture', childState: () => ({ ...running(), ...change }),
      probe: () => assert.fail('A failed child must not be probed'),
      pause: () => assert.fail('A failed child must not be awaited'),
    }), /exited before readiness/);
  }
});

test('an unhealthy response never counts as readiness and an exited child is reported', async () => {
  let now = 0, probes = 0;
  await assert.rejects(waitForFixtureReady({ name: 'Fixture',
    childState: () => ({ ...running(), exitCode: probes ? 3 : null }), clock: () => now,
    probe: async () => { probes++; return 503; }, pause: async duration => { now += duration; },
  }), error => {
    assert.match(error.message, /"lastProbe":"HTTP 503"/);
    assert.match(error.message, /"exitCode":3/);
    return true;
  });
  assert.equal(probes, 1);
});

test('a child exiting during a successful health probe is not admitted as ready', async () => {
  let exited = false;
  await assert.rejects(waitForFixtureReady({ name: 'Fixture',
    childState: () => ({ ...running(), exitCode: exited ? 0 : null }),
    probe: async () => { exited = true; return 200; },
    pause: () => assert.fail('Exit should be reported before waiting again'),
  }), /exited before readiness/);
});
