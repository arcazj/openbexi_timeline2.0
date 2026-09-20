import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Keep filter/sort contracts independent of additions to the shipped demo.
export async function openContractFixture(page, baseUrl) {
  await page.goto(baseUrl);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug?.ready)).toBe(true);
  await page.locator('[data-action=sources]').first().click();
  await page.locator('#json-file').setInputFiles({
    name: 'contract-snapshot.json', mimeType: 'application/json',
    buffer: await readFile('shared/fixtures/initial-snapshot.json'),
  });
  await expect(page.locator('#json-file')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug?.ready && window.__timelineDebug.recordCount === 48)).toBe(true);
}
