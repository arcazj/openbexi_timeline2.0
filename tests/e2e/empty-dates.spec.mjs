import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { startLocalPathsServer } from '../integration/local-paths-server-fixture.mjs';

const file = pathToFileURL(path.resolve('dist/index.html')).href;
const ready = page => expect.poll(() => page.evaluate(() => window.__timelineDebug?.ready), { timeout: 30000 }).toBe(true);
async function calendarDate(page, year, month, day, wait = true) {
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: 'Calendar year', exact: true });
  await input.fill(String(year)); await input.press('Tab');
  await page.getByRole('combobox', { name: 'Calendar month', exact: true }).selectOption(String(month));
  await page.getByRole('button', { name: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, exact: true }).click();
  if (!wait) return;
  await ready(page);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
}
async function selectSource(page, needle) {
  if (!await page.locator('#source-filter').isVisible()) await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  const value = await page.locator('#source-filter option').evaluateAll((options, text) => options.find(option => option.textContent.includes(text))?.value, needle);
  expect(value).toBeTruthy(); await page.locator('#source-filter').selectOption(value); await ready(page); return value;
}

test('offline empty dates navigate to selected source in either direction and preserve viewport width', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(file); await ready(page);
  await page.locator('[data-action=help]').click();
  await page.getByLabel('Test local dataset', { exact: true }).selectOption('multiple_sources_test');
  await page.locator('[data-help=open-test-data]').click();
  await expect.poll(() => page.evaluate(() => window.__timelineDebug?.testDatasetId)).toBe('multiple_sources_test'); await ready(page);
  const source = await selectSource(page, 'SOURCE2');
  await calendarDate(page, 2023, 12, 15);
  await expect(page.getByRole('list', { name: 'Available dates by source' })).toContainText('SOURCE2');
  await expect(page.getByRole('list', { name: 'Available dates by source' }).locator('li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Previous date with data', exact: true })).toBeDisabled();
  const span = await page.evaluate(() => Number(window.__timelineDebug.toMs) - Number(window.__timelineDebug.fromMs));
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('empty-source-dates.png') });
  await page.getByRole('button', { name: 'Next date with data', exact: true }).click(); await ready(page);
  await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
  expect(await page.locator('#source-filter').inputValue()).toBe(source);
  expect(await page.evaluate(() => Number(window.__timelineDebug.toMs) - Number(window.__timelineDebug.fromMs))).toBe(span);
  await page.setViewportSize({ width: 1600, height: 900 }); await ready(page);
  await calendarDate(page, 2025, 1, 1);
  await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous date with data', exact: true }).click(); await ready(page);
  await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
  expect(await page.locator('#source-filter').inputValue()).toBe(source);
  expect(errors).toEqual([]);
});

test('a pressed date-navigation button survives a layout-only resize and completes its click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(file + '?dataset=multiple_sources_test'); await ready(page);
  await selectSource(page, 'SOURCE2'); await calendarDate(page, 2023, 12, 15);
  const button = page.getByRole('button', { name: 'Next date with data', exact: true });
  await expect(button).toBeEnabled();
  const original = await button.elementHandle(), bounds = await button.boundingBox();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const priorLayout = await page.evaluate(() => window.__timelineDebug.layoutId);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  try {
    await page.setViewportSize({ width: 390, height: 864 });
    await expect.poll(() => page.evaluate(() => window.__timelineDebug.layoutId)).not.toBe(priorLayout); await ready(page);
    expect(await original.evaluate(node => node.isConnected), 'The pressed control must survive a layout-only render').toBe(true);
    expect(await button.evaluate((node, pressed) => node === pressed, original)).toBe(true);
    const current = await button.boundingBox();
    expect(point.y).toBeGreaterThan(current.y); expect(point.y).toBeLessThan(current.y + current.height);
  } finally { await page.mouse.up(); }
  await ready(page); await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
});

test('indexed server dates are provisional until verified and never substitute another source', async ({ page }) => {
  test.setTimeout(90000);
  const server = await startLocalPathsServer({ deferIndex: true });
  try {
    await page.goto(server.baseUrl); await ready(page);
    const source = await selectSource(page, 'SOURCE2');
    await calendarDate(page, 2024, 2, 1);
    // Closing the calendar changes plot width and can start an adaptive query.
    // Keep indexing held until that query has painted its provisional view.
    await expect.poll(() => page.locator('.plot-wrap').evaluate(node => Math.abs(window.__timelineDebug.layoutWidth - node.clientWidth))).toBeLessThan(1);
    await ready(page);
    await expect(page.locator('.empty-date-navigation')).toContainText('still being indexed');
    await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Refresh available dates', exact: true })).toBeEnabled();
    await server.releaseIndex();
    await expect.poll(() => page.evaluate(async () => {
      const response = await fetch('/api/v1/workspaces/default/legacy/loading', { headers: { 'X-OpenBEXI-Local': '1' }, credentials: 'omit' });
      if (!response.ok) throw new Error(`Loading status ${response.status}`);
      return (await response.json()).complete;
    })).toBe(true);
    await page.getByRole('button', { name: 'Refresh available dates', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeEnabled();
    await expect(page.getByRole('list', { name: 'Available dates by source' }).locator('li')).toHaveCount(1);
    const original = await page.evaluate(() => window.__timelineDebug);
    let requested = false, release;
    const held = new Promise(resolve => { release = resolve; });
    const pattern = '**/query-sessions';
    await page.route(pattern, async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.scaleMode !== 'adaptive') { await route.continue(); return; }
      requested = true; await held;
      try { await route.continue(); } catch { /* A later query can supersede this request. */ }
    });
    try {
      // A resize can be absorbed by an already queued layout. Explicit refresh
      // guarantees a new same-scope query whose pending state must disable dates.
      await page.getByRole('button', { name: 'Refresh verified view', exact: true }).click();
      await expect.poll(() => requested).toBe(true);
      expect(await page.evaluate(() => window.__timelineDebug.queryLoading)).toBe(true);
      await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeDisabled();
    } finally { release(); await page.unroute(pattern); }
    await ready(page);
    const refreshed = await page.evaluate(() => window.__timelineDebug);
    expect(refreshed.queryId).not.toBe(original.queryId);
    expect([refreshed.fromMs, refreshed.toMs]).toEqual([original.fromMs, original.toMs]);
    expect(await page.locator('#source-filter').inputValue()).toBe(source);
    await page.getByRole('button', { name: 'Next date with data', exact: true }).click(); await ready(page);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    expect(await page.locator('#source-filter').inputValue()).toBe(source);
  } finally { await server.stop(); }
});

test('late date replies cannot repopulate hints after a range change or authorization loss', async ({ page }) => {
  test.setTimeout(90000);
  const server = await startLocalPathsServer();
  let held;
  try {
    await page.goto(server.baseUrl); await ready(page);
    await page.route('**/date-availability', async route => { held = route; });
    await calendarDate(page, 2024, 2, 1); await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: 'Resynchronize reference time', exact: true }).click(); await ready(page);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    await held.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generation: 'stale', sources: [] }) }).catch(() => {});
    await expect(page.locator('.empty-date-navigation')).toHaveCount(0);
    await page.unroute('**/date-availability');
    await page.route('**/date-availability', route => route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ code: 'unauthorized', message: 'Authorization expired' }) }));
    await calendarDate(page, 2024, 2, 1, false);
    await expect(page.locator('.notice')).toContainText('authorization is required');
    await expect(page.locator('.empty-date-navigation')).toHaveCount(0);
    await expect(page.locator('#source-filter')).toHaveText('Authorization required');
  } finally { if (held) await held.abort().catch(() => {}); await server.stop(); }
});

test('restored-generation dates require explicit reload and failed reloads keep the view frozen', async ({ page }) => {
  const server = await startLocalPathsServer();
  try {
    await page.goto(server.baseUrl); await ready(page);
    const original = await page.evaluate(() => window.__timelineDebug.generation);
    await page.route('**/date-availability', route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ generation: 'replacement-generation', sources: [], previous: '2024-01-01T00:00:00Z', next: null }) }));
    await calendarDate(page, 2024, 2, 1, false);
    await expect(page.locator('.power-tool')).toHaveAttribute('data-connected', 'false');
    await expect(page.locator('.empty-date-navigation')).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('Reload the active workspace');
    expect(await page.evaluate(() => window.__timelineDebug.generation)).toBe(original);
    expect(await page.evaluate(() => window.__timelineDebug.ready)).toBe(false);
    const frozen = await page.evaluate(() => window.__timelineDebug);
    await page.unroute('**/date-availability');
    await page.route('**/api/v1/workspaces/default', route => route.fulfill({ status: 503, contentType: 'application/problem+json',
      body: JSON.stringify({ code: 'test_status_unavailable', message: 'Reload metadata unavailable' }) }));
    await page.locator('.notice [data-action=refresh]').click();
    await expect(page.locator('.toast')).toContainText('Reload metadata unavailable');
    await expect(page.locator('.notice')).toContainText('Reload the active workspace');
    expect(await page.evaluate(() => window.__timelineDebug.ready)).toBe(false);
    expect(await page.evaluate(() => window.__timelineDebug.queryId)).toBe(frozen.queryId);
    await page.unroute('**/api/v1/workspaces/default');
    await page.route('**/query-sessions', route => route.fulfill({ status: 429, contentType: 'application/problem+json',
      body: JSON.stringify({ code: 'preparation_capacity', message: 'Reload preparation unavailable' }) }));
    await page.locator('.notice [data-action=refresh]').click();
    await expect(page.locator('.toast')).toContainText('Reload preparation unavailable');
    await expect(page.locator('.power-tool')).toHaveAttribute('data-connected', 'false');
    await expect(page.locator('.notice')).toContainText('Reload the active workspace');
    expect(await page.evaluate(() => window.__timelineDebug.ready)).toBe(false);
    expect(await page.evaluate(() => window.__timelineDebug.queryId)).toBe(frozen.queryId);
    await page.unroute('**/query-sessions');
    await page.locator('.notice [data-action=refresh]').click(); await ready(page);
    await expect.poll(() => page.evaluate(() => window.__timelineDebug.queryId)).not.toBe(frozen.queryId);
    await expect(page.locator('.notice')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Next date with data', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__timelineDebug.fromMs)).toBe(frozen.fromMs);
    expect(await page.evaluate(() => window.__timelineDebug.toMs)).toBe(frozen.toMs);
    await page.getByRole('button', { name: 'Next date with data', exact: true }).click(); await ready(page);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
  } finally { await server.stop(); }
});
