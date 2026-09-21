import test from 'node:test';
import assert from 'node:assert/strict';
import { firefoxTestOptions } from '../../scripts/firefox-test-options.mjs';

test('local Firefox keeps native graphics policy on every supported platform', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const options = firefoxTestOptions({ platform, env: {} });
    assert.deepEqual(options.launchOptions, { firefoxUserPrefs: {} });
    assert.equal(options.headless, platform !== 'linux');
  }
});

test('Linux CI enables WebGL2 with Mesa software rendering and preserves the display', () => {
  const env = { CI: 'true', DISPLAY: ':99', GALLIUM_DRIVER: 'hardware', LIBGL_ALWAYS_SOFTWARE: 'false' };
  const options = firefoxTestOptions({ platform: 'linux', env });
  assert.equal(options.headless, false);
  assert.deepEqual(options.launchOptions.firefoxUserPrefs, { 'webgl.force-enabled': true });
  assert.equal(options.launchOptions.env.DISPLAY, ':99');
  assert.equal(options.launchOptions.env.GALLIUM_DRIVER, 'llvmpipe');
  assert.equal(options.launchOptions.env.LIBGL_ALWAYS_SOFTWARE, 'true');
  assert.equal(env.GALLIUM_DRIVER, 'hardware');
});

test('Windows CI retains its existing Firefox preference without Mesa overrides', () => {
  const options = firefoxTestOptions({ platform: 'win32', env: { CI: 'true' } });
  assert.equal(options.headless, true);
  assert.deepEqual(options.launchOptions, { firefoxUserPrefs: { 'webgl.force-enabled': true } });
});
