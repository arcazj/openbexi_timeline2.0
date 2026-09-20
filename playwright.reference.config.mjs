import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Explicit acceptance against the user's separate, read-only legacy checkout.
export default defineConfig({
  ...base, testIgnore: [], testMatch: 'legacy-reference.spec.mjs',
  outputDir: 'artifacts/browser/reference',
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser/reference.json' }]],
});
