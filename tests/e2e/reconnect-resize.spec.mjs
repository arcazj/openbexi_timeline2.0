import { test, expect } from '@playwright/test';
import { startLocalPathsServer } from '../integration/local-paths-server-fixture.mjs';

const debug = page => page.evaluate(() => window.__timelineDebug);
const ready = page => expect.poll(async () => (await debug(page))?.ready).toBe(true);

test('automatic viewport resizing cannot supersede explicit Retry while metadata is being validated', async ({ page }) => {
  test.setTimeout(60000);
  const server = await startLocalPathsServer();
  let finishMetadata;
  try {
    await page.goto(server.baseUrl); await ready(page);
    const initial = await debug(page);
    const allocations = '**/api/v1/workspaces/default/query-sessions';
    await page.route(allocations, route => route.abort());
    await page.locator('.plot-wrap').focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.notice [data-action=reconnect-server]')).toBeVisible();
    await page.unroute(allocations);
    // Showing the failure notice schedules a 100ms ResizeObserver relayout.
    // Let that interaction finish before Retry so only the deliberate resize below overlaps metadata.
    let settled = 0, previousFailure;
    await expect.poll(async () => {
      const value = await page.evaluate(() => {
        const state = window.__timelineDebug, plot = document.querySelector('.plot-wrap').getBoundingClientRect(), notice = document.querySelector('.notice');
        return { ready: state.ready, queryId: state.queryId, layoutId: state.layoutId, from: state.fromMs, to: state.toMs,
          width: plot.width, height: plot.height, noticeHeight: notice.getBoundingClientRect().height, noticeText: notice.textContent };
      });
      const key = JSON.stringify(value);
      settled = value.ready && key === previousFailure ? settled + 1 : value.ready ? 1 : 0;
      previousFailure = key; return settled;
    }, { intervals: [100], message: 'Failed navigation and its notice relayout must settle before Retry' }).toBeGreaterThanOrEqual(4);
    const failed = await debug(page);
    expect(failed.providerKind).toBe('server'); expect(failed.providerId).toBe(initial.providerId); expect(failed.queryId).toBe(initial.queryId);
    let metadataReady = false;
    const gate = new Promise(resolve => { finishMetadata = resolve; });
    await page.route('**/api/v1/workspaces/default', async route => {
      const response = await route.fetch({ headers: { ...route.request().headers(), 'x-openbexi-local': '1', 'sec-fetch-site': 'same-origin' } });
      expect(response.ok()).toBe(true); metadataReady = true; await gate; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => metadataReady, { message: 'Retry must request workspace metadata' }).toBe(true);
    await page.setViewportSize({ width: 1400, height: 740 });
    let stable = 0, previous;
    await expect.poll(async () => {
      const box = await page.locator('.plot-wrap').boundingBox(), key = JSON.stringify(box);
      stable = key === previous ? stable + 1 : 1; previous = key; return stable;
    }, { intervals: [100] }).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.notice')).toHaveAttribute('aria-busy', 'true');
    expect((await debug(page)).providerId).toBe(failed.providerId);
    expect((await debug(page)).queryId).toBe(failed.queryId);
    expect((await debug(page)).queryLoading).toBe(false);
    finishMetadata();
    await expect.poll(async () => (await debug(page)).providerId).not.toBe(failed.providerId);
    await ready(page); await expect(page.locator('.notice')).toBeHidden();
    const recovered = await debug(page), box = await page.locator('.plot-wrap').boundingBox();
    for (const key of ['fromMs', 'toMs', 'domain', 'search', 'view', 'theme', 'modelId', 'modelVersion']) expect(recovered[key]).toEqual(failed[key]);
    expect(Math.abs(recovered.layoutWidth - box.width)).toBeLessThanOrEqual(1);
    expect(recovered.layoutId).not.toBe(failed.layoutId); expect(recovered.pageCapacity).toBeLessThan(failed.pageCapacity);
  } finally {
    finishMetadata?.();
    try { await page.unrouteAll({ behavior: 'wait' }); } finally { await server.stop(); }
  }
});
