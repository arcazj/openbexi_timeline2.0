// Observe only the bootstrap path, preserving the original fetch call and error.
export async function observeBootstrap(page) {
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.__bootstrapDiagnostic = [];
    window.fetch = function (input, options) {
      'use strict';
      const args = [input, options];
      if (input !== '/api/v1/bootstrap') return Reflect.apply(fetch, this, args);
      const probe = { path: '/api/v1/bootstrap', startedAt: performance.now() };
      window.__bootstrapDiagnostic.push(probe);
      const failed = error => {
        Object.assign(probe, { elapsedMs: performance.now() - probe.startedAt, error: error.name, message: error.message });
        throw error;
      };
      try {
        return Reflect.apply(fetch, this, args).then(response => {
          Object.assign(probe, { elapsedMs: performance.now() - probe.startedAt, status: response.status });
          return response;
        }, failed);
      } catch (error) { return failed(error); }
    };
  });
}

export async function attachBootstrapDiagnostic(page, info) {
  try {
    await info.attach('bootstrap-diagnostic', {
      body: JSON.stringify(await page.evaluate(() => window.__bootstrapDiagnostic)), contentType: 'application/json',
    });
  } catch { /* A closed browser cannot provide diagnostics; retain the original failure. */ }
}
