import { test, expect } from '@playwright/test';
import { startConfiguredProfileServer } from '../integration/configured-profile-server.mjs';

const ready = page => expect.poll(() => page.evaluate(() => window.__timelineDebug?.ready), { timeout: 60000 }).toBe(true);

test('copied archives load both namespaces and navigate beyond the static preview', async ({ page }, info) => {
  test.setTimeout(120000);
  const server = await startConfiguredProfileServer('yaml/multiple_sources_test.yml');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(server.baseUrl); await ready(page);
    const initial = await page.evaluate(() => window.__timelineDebug);
    expect(Number(initial.fromMs)).toBe(Date.parse('2024-03-17T00:00:00Z'));
    expect(initial.detailTotal).toBeGreaterThanOrEqual(1145);
    const options = await page.locator('#source-filter option').allTextContents();
    expect(options.some(text => text.includes('SOURCE1'))).toBe(true);
    expect(options.some(text => text.includes('SOURCE2'))).toBe(true);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.getByRole('combobox', { name: 'Calendar month', exact: true }).selectOption('11');
    await page.getByRole('button', { name: '2024-11-11', exact: true }).click();
    await ready(page);
    expect(Number(await page.evaluate(() => window.__timelineDebug.centerMs))).toBeGreaterThan(Date.parse('2024-11-10T00:00:00Z'));
    expect(await page.evaluate(() => window.__timelineDebug.detailTotal)).toBeGreaterThan(0);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('full-archive-november.png') });
    expect(errors).toEqual([]);
  } finally { await server.stop(); }
});
