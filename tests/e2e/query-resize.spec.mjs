import { test as base, expect } from '@playwright/test';
import { startLocalPathsServer } from '../integration/local-paths-server-fixture.mjs';

const test = base.extend({
  pathsServer: [async ({}, use) => {
    const owned = await startLocalPathsServer({ archiveDays: 3 });
    try { await use(owned); } finally { await owned.stop(); }
  }, { timeout: 60000 }],
});
const debug = page => page.evaluate(() => window.__timelineDebug);
const ready = page => expect.poll(async () => (await debug(page))?.ready).toBe(true);
async function painted(page) {
  await expect.poll(() => page.locator('.plot-wrap').evaluate(plot => {
    const canvas = plot.querySelector('canvas');
    return window.__timelineDebug?.ready && canvas?.width === plot.clientWidth && canvas.height === plot.clientHeight;
  })).toBe(true);
}

for (const restoreWidth of [false, true]) {
  test(`${restoreWidth ? 'width changes supersede' : 'height changes preserve'} the query being prepared for a descriptor`, async ({ page, pathsServer }) => {
    let release, heldQueryId, intercepted = false;
    const gate = new Promise(resolve => { release = resolve; }), errors = [], layouts = [];
    const collectLayout = request => {
      if (heldQueryId && request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/query-sessions/${heldQueryId}/layouts`)) layouts.push({ request, input: request.postDataJSON() });
    };
    try {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathsServer.baseUrl); await ready(page);
      // One density candidate makes query reuse observable without depending on the optimizer's winner.
      await page.locator('#local-scale').press('Home'); await page.locator('#local-scale').press('Tab');
      await expect.poll(async () => (await debug(page)).scaleLimit).toBe(1);
      await painted(page);
      const before = await debug(page), initialBox = await page.locator('.plot-wrap').boundingBox();
      expect(before.scaleStrategy).toBe('automatic'); expect(before.scaleMode).toBe('adaptive');
      page.on('request', collectLayout);
      await page.route('**/api/v1/workspaces/default/query-sessions', async route => {
        if (intercepted || route.request().method() !== 'POST' || !(await debug(page)).queryLoading) return route.continue();
        intercepted = true;
        expect(route.request().postDataJSON().ratio).toBe(1);
        const response = await route.fetch({ headers: { ...await route.request().allHeaders(), 'sec-fetch-site': 'same-origin' } });
        expect([200, 202]).toContain(response.status());
        heldQueryId = (await response.json()).queryId; expect(heldQueryId).toEqual(expect.any(String));
        await gate; await route.fulfill({ response });
      });
      await page.locator('.plot-wrap .record-label').filter({ hasText: 'SOURCE1 session' }).first().click();
      await expect(page.locator('.descriptor')).toBeVisible();
      await expect.poll(() => !!heldQueryId).toBe(true);
      const preparingBox = await page.locator('.plot-wrap').boundingBox();
      expect(preparingBox.width).toBeLessThan(initialBox.width);
      if (restoreWidth) await page.locator('[data-action=close-descriptor]').click();
      else { const viewport = page.viewportSize(); await page.setViewportSize({ width: viewport.width, height: viewport.height + 80 }); }
      let previous, stable = 0;
      await expect.poll(async () => {
        const box = await page.locator('.plot-wrap').boundingBox(), key = JSON.stringify(box);
        const changed = restoreWidth ? Math.abs(box.width - initialBox.width) < 1 : box.height > preparingBox.height;
        stable = changed && key === previous ? stable + 1 : 0; previous = key;
        return stable;
      }, { intervals: [100], message: 'The changed viewport must settle while query preparation is held' }).toBeGreaterThanOrEqual(3);
      expect((await debug(page)).queryLoading).toBe(true);
      release(); await page.unrouteAll({ behavior: 'wait' }); await painted(page);
      let after = await debug(page);
      if (restoreWidth) expect(after.queryId).not.toBe(heldQueryId);
      else {
        expect(after.queryId).toBe(heldQueryId);
        await expect.poll(() => layouts.length).toBeGreaterThanOrEqual(2);
        const resized = layouts.at(-1);
        expect(resized.input.availableHeight).toBeGreaterThan(layouts[0].input.availableHeight);
        const response = await resized.request.response();
        expect([200, 202]).toContain(response.status());
        const { layoutId } = await response.json();
        expect(layoutId).toEqual(expect.any(String));
        await expect.poll(async () => {
          const view = await debug(page); return view.ready && view.layoutId === layoutId;
        }).toBe(true);
        after = await debug(page);
        expect(after.queryId).toBe(heldQueryId);
        await expect(page.locator('.descriptor')).toBeVisible();
      }
      expect([after.fromMs, after.toMs, after.providerId]).toEqual([before.fromMs, before.toMs, before.providerId]);
      expect(after.layoutWidth).toBe(Math.round((await page.locator('.plot-wrap').boundingBox()).width));
      expect(errors).toEqual([]);
    } finally {
      release();
      try { await page.unrouteAll({ behavior: 'wait' }); }
      finally { page.off('request', collectLayout); await page.close(); }
    }
  });
}
