// Keep the matrix and its early graphics check on the same browser settings.
export function firefoxTestOptions({ platform = process.platform, env = process.env } = {}) {
  const hosted = Boolean(env.CI) && ['linux', 'win32'].includes(platform);
  return {
    headless: platform !== 'linux',
    launchOptions: {
      // Mozilla's WebGLContext::CreateAndInitGL otherwise rejects blocked WebGL2
      // before trying the runner's software driver. This is a CI-only override.
      // https://github.com/mozilla/gecko-dev/blob/master/dom/canvas/WebGLContext.cpp
      firefoxUserPrefs: hosted ? { 'webgl.force-enabled': true } : {},
      ...(hosted && platform === 'linux' ? {
        // https://docs.mesa3d.org/envvars.html#envvar-GALLIUM_DRIVER
        env: { ...env, LIBGL_ALWAYS_SOFTWARE: 'true', GALLIUM_DRIVER: 'llvmpipe' },
      } : {}),
    },
  };
}
