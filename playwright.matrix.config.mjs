import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
import { firefoxTestOptions } from './scripts/firefox-test-options.mjs';

export default defineConfig({
  ...base,
  testMatch: ['standalone.spec.mjs', 'configuration-apply.spec.mjs', 'test-data.spec.mjs', 'toolbar-icons.spec.mjs', 'empty-dates.spec.mjs',
    'record-descriptor.spec.mjs', 'descriptor-query-refresh.spec.mjs', 'server-reconnect.spec.mjs', 'reconnect-resize.spec.mjs', 'query-resize.spec.mjs', 'filters-v2.spec.mjs', 'smart-drag.spec.mjs', 'renderer-preview.spec.mjs', 'preview-baseline.spec.mjs', 'model-preview-admission.spec.mjs'],
  outputDir: 'artifacts/browser/matrix',
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser/matrix.json' }]],
  use: { ...base.use, launchOptions: {} },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: {
      browserName: 'firefox', ...firefoxTestOptions(),
    } },
    ...(process.platform === 'win32' ? [{ name: 'edge', use: { browserName: 'chromium', launchOptions: base.use.launchOptions } }] : []),
  ],
});
