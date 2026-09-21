import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { startLocalPathsServer } from '../integration/local-paths-server-fixture.mjs';
import packageManifest from '../../package.json' with { type: 'json' };

const fileUrl = pathToFileURL(path.resolve('dist/index.html')).href;
const debug = page => page.evaluate(() => window.__timelineDebug);
async function open(page) {
  await page.goto(fileUrl);
  await expect(page.locator('.record-label').first()).toBeVisible();
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
}
async function help(page, tab = 'help') {
  await expect.poll(async () => (await debug(page)).ready).toBe(true);
  await page.locator('[data-action=help]').click();
  await expect(page.getByRole('dialog', { name: 'Help and sharing' })).toBeVisible();
  if (tab !== 'help') await page.locator(`[data-help-tab=${tab}]`).click();
}
async function captureLink(page) {
  await help(page, 'share');
  const link = page.getByRole('textbox', { name: 'View link', exact: true });
  await expect(link).toHaveValue(/^#view=/);
  return link.inputValue();
}

for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
  test(`Help follows Settings and docs work fully offline at ${viewport.width}px`, async ({ page }, info) => {
    const requests = [], errors = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
    await page.setViewportSize(viewport); await open(page);
    expect(await page.locator('[data-action=settings]').evaluate(node => node.nextElementSibling.dataset.action)).toBe('help');
    const layout = await page.locator('.app-header').evaluate(header => {
      const boxes = [...header.querySelectorAll('button,.brand')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth > innerWidth, outside: boxes.some(b => b.left < 0 || b.right > innerWidth), overlaps: boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)) };
    });
    expect(layout).toEqual({ overflow: false, outside: false, overlaps: false });
    await help(page); await page.screenshot({ path: info.outputPath('help-menu.png'), fullPage: true });
    await expect(page.locator('[data-help=live-api]')).toBeDisabled();
    await page.locator('[data-help=readme]').click(); await expect(page.locator('.help-document h1')).toContainText('OpenBEXI');
    for (const guide of ['user-manual', 'design', 'data-design', 'architecture', 'testing', 'deployment', 'prompt-history']) {
      await page.locator('[data-help=home]').click();
      await page.locator(`[data-help=${guide}]`).click();
      await expect(page.locator('.help-document h1')).toContainText('OpenBEXI Timeline 2.0');
      if (guide === 'user-manual') {
        await expect(page.locator('.help-document img')).toHaveCount(7);
        expect(await page.locator('.help-document img').evaluateAll(async images => {
          await Promise.all(images.map(img => img.decode()));
          return images.every(img => img.naturalWidth > 0 && img.naturalHeight > 0);
        })).toBe(true);
      }
    }
    await page.locator('[data-help=home]').click(); await page.locator('[data-help=releases]').click();
    await expect(page.locator('.help-document')).toContainText('2.0.0');
    await page.locator('[data-help=home]').click(); await page.locator('[data-help=licenses]').click();
    await page.locator('summary').filter({ hasText: 'swagger-ui-dist' }).click();
    await expect(page.locator('details[open] pre')).toContainText('Apache License');
    await page.locator('[data-help=home]').click(); await page.locator('[data-help=swagger]').click();
    const frame = page.frameLocator('.help-swagger');
    await frame.locator('.opblock-tag').first().click();
    await expect(frame.locator('.opblock').first()).toBeVisible();
    await frame.locator('.opblock-summary').first().click();
    await expect(frame.locator('.try-out__btn')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('offline-swagger.png'), fullPage: true });
    await page.locator('[data-action=close-modal]').click();
    await expect(page.locator('[data-action=help]')).toBeFocused();
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });
}

test('Share restores range, filters, search and selection only after explicit review', async ({ page }, info) => {
  await open(page); await page.locator('#kind-filter').selectOption('session');
  await page.locator('#search').fill('Telemetry');
  await expect(page.locator('.overview-count')).toContainText('search matches');
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await page.locator('.record-label').first().click(); await expect(page.locator('.descriptor')).toBeVisible();
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  const before = await debug(page), link = await captureLink(page);
  expect(link).toMatch(/^#view=/); expect(link).not.toContain('file:');
  await page.screenshot({ path: info.outputPath('share-view.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.locator('#search').fill('');
  await expect(page.locator('.overview-count')).toContainText('full context');
  await page.locator('#kind-filter').selectOption('all');
  await page.locator('[data-action=zoom-in]').click();
  await expect.poll(async () => (await debug(page)).fromMs).not.toBe(before.fromMs);
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  const changed = await debug(page);
  await help(page, 'share');
  await page.getByRole('textbox', { name: 'Shared view link', exact: true }).fill(link);
  await page.locator('[data-help=review-link]').click();
  expect((await debug(page)).fromMs).toBe(changed.fromMs);
  await page.locator('[data-help=apply-link]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await debug(page)).fromMs).toBe(before.fromMs);
  await expect(page.locator('#kind-filter')).toHaveValue('session');
  await expect(page.locator('#search')).toHaveValue('Telemetry');
  await expect(page.locator('.descriptor')).toBeVisible();
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('restored-view.png'), fullPage: true });
});

test('reviewed Apply waits for a pending resize without losing the shared view', async ({ page }) => {
  const server = await startLocalPathsServer(), errors = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.baseUrl);
    await expect.poll(async () => { const value = await debug(page); return value.localPaths && value.ready; }).toBe(true);
    const original = await debug(page);
    await help(page, 'share');
    const capturedLink = page.getByRole('textbox', { name: 'View link', exact: true });
    await expect(capturedLink).toHaveValue(/#view=/);
    const link = await capturedLink.inputValue();
    await page.keyboard.press('Escape');
    await page.locator('[data-action=zoom-in]').click();
    await expect.poll(async () => (await debug(page)).fromMs).not.toBe(original.fromMs);
    await expect.poll(async () => (await debug(page)).ready).toBe(true);
    await help(page, 'share');
    const input = page.getByRole('textbox', { name: 'Shared view link', exact: true });
    await input.fill(link); await page.locator('[data-help=review-link]').click();
    const review = page.locator('.help-review'), apply = page.locator('[data-help=apply-link]');
    await expect(review).toBeVisible(); await expect(apply).toBeEnabled();
    const reviewText = await review.textContent(), before = await debug(page);
    let intercepting = false, received = false;
    await page.route(`**/query-sessions/${before.queryId}/layouts`, async route => {
      if (intercepting || route.request().method() !== 'POST') { await route.continue(); return; }
      intercepting = true;
      // API-side route.fetch does not synthesize the browser's Fetch Metadata.
      const response = await route.fetch({ headers: { ...await route.request().allHeaders(), 'sec-fetch-site': 'same-origin' } });
      expect([200, 202]).toContain(response.status());
      received = true; await held;
      await route.fulfill({ response });
    });
    const viewport = page.viewportSize();
    // Height alone requests a layout while retaining the reviewed query scope.
    await page.setViewportSize({ width: viewport.width, height: viewport.height + 40 });
    await expect.poll(() => received).toBe(true);
    await expect(page.locator('.busy-indicator')).toBeVisible();
    expect((await debug(page)).ready).toBe(false);
    await expect(apply).toBeDisabled();
    await expect(input).toHaveValue(link); await expect(review).toHaveText(reviewText);
    expect((await debug(page)).queryId).toBe(before.queryId);
    expect((await debug(page)).fromMs).toBe(before.fromMs);
    release(); await page.unrouteAll({ behavior: 'wait' });
    await expect.poll(async () => (await debug(page)).ready).toBe(true);
    await expect(apply).toBeEnabled();
    await expect(input).toHaveValue(link); await expect(review).toHaveText(reviewText);
    await apply.click();
    await expect(page.getByRole('dialog', { name: 'Help and sharing' })).toHaveCount(0);
    await expect.poll(async () => (await debug(page)).queryId).not.toBe(before.queryId);
    await expect.poll(async () => (await debug(page)).ready).toBe(true);
    const restored = await debug(page);
    expect({ fromMs: restored.fromMs, toMs: restored.toMs }).toEqual({ fromMs: original.fromMs, toMs: original.toMs });
    expect(errors).toEqual([]);
  } finally {
    release();
    try { await page.unrouteAll({ behavior: 'wait' }); }
    finally { try { await page.close(); } finally { await server.stop(); } }
  }
});

test('invalid or unavailable shared views leave the current timeline untouched', async ({ page }) => {
  await open(page); const before = await debug(page), link = await captureLink(page);
  const value = JSON.parse(Buffer.from(link.slice(6), 'base64url').toString('utf8'));
  value.filters.sourceId = 'unavailable-source';
  const input = page.getByRole('textbox', { name: 'Shared view link', exact: true });
  await input.fill(`#view=${Buffer.from(JSON.stringify(value)).toString('base64url')}`);
  await page.locator('[data-help=review-link]').click(); await page.locator('[data-help=apply-link]').click();
  await expect(page.locator('.help-status')).toContainText('sources unavailable');
  expect((await debug(page)).queryId).toBe(before.queryId);
  await input.fill('#view=invalid!'); await page.locator('[data-help=review-link]').click();
  await expect(page.locator('[data-help=apply-link]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.goto(fileUrl + link); await expect(page.locator('.help-review')).toBeVisible();
  await expect(page.locator('[data-help=apply-link]')).toBeEnabled();
});

test('PNG preview and downloads contain nonblank main and overview images, with text clipboard fallback', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
  });
  await open(page); await help(page, 'share');
  await expect(page.locator('[data-help=native-share]')).toBeDisabled();
  await page.locator('[data-help=copy-link]').click(); await expect(page.locator('.help-status')).toContainText('Clipboard access is unavailable');
  await page.locator('[data-help=preview]').click();
  await expect(page.locator('.help-preview')).toBeVisible({ timeout: 20000 });
  const pixels = await page.locator('.help-preview').evaluate(async img => {
    await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
    const regions = ['.plot-wrap', '.overview-plot'].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect(), data = context.getImageData(box.x, box.y, box.width, box.height).data, colors = new Set();
      for (let i = 0; i < data.length; i += 4) colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
      return colors.size;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, regions };
  });
  expect(pixels.width).toBe(1600); expect(pixels.height).toBe(900); for (const colors of pixels.regions) expect(colors).toBeGreaterThan(15);
  await page.screenshot({ path: info.outputPath('image-preview.png'), fullPage: true });
  const download = page.waitForEvent('download'); await page.locator('[data-help=download-image]').click();
  const result = await download; expect(result.suggestedFilename()).toBe('openbexi-timeline.png'); await result.saveAs(info.outputPath('timeline-export.png'));
  await expect(page.locator('[data-help=copy-image]')).toBeDisabled();
  await page.locator('[data-help-tab=diagnostics]').click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Diagnostic report' }).inputValue());
  expect(report.provider).toBe('local'); expect(report.version).toBe(packageManifest.version);
  expect(JSON.stringify(report)).not.toMatch(/token|C:|title|Telemetry|sourceName|searchFields/);
  await expect(page.locator('[data-help=health]')).toBeDisabled();
});

test('Live API and health read the active local-path server without bearer tokens', async ({ page }) => {
  const server = await startLocalPathsServer(), requests = [];
  try {
    page.on('request', request => { if (request.url().endsWith('/openapi.json') || request.url().endsWith('/health')) requests.push({ url: request.url(), method: request.method(), headers: request.headers() }); });
    await page.goto(server.baseUrl); await expect.poll(async () => (await debug(page)).localPaths).toBe(true);
    await expect(page.locator('.busy-indicator')).toHaveCount(0);
    await help(page); await page.locator('[data-help=live-api]').click();
    await expect(page.locator('.help-json')).toContainText('openapi');
    await page.locator('[data-help-tab=diagnostics]').click(); await page.locator('[data-help=health]').click();
    await expect(page.locator('.help-status')).toContainText('responded successfully');
    expect(requests.some(item => item.url.endsWith('/openapi.json'))).toBe(true);
    for (const item of requests) { expect(item.method).toBe('GET'); expect(item.headers.authorization).toBeUndefined(); expect(item.headers['x-openbexi-local']).toBe('1'); }
  } finally { await server.stop(); }
});

test('supported native share and text/image clipboards receive only the reviewed payload', async ({ page }) => {
  const server = await startLocalPathsServer();
  try {
    await page.addInitScript(() => {
      window.__shared = {};
      Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { window.__shared.native = value; } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { window.__shared.text = value; },
        write: async items => { const blob = await items[0].getType('image/png'); window.__shared.image = { type: blob.type, size: blob.size }; },
      } });
    });
    await page.goto(server.baseUrl); await expect.poll(async () => (await debug(page)).localPaths).toBe(true);
    await expect(page.locator('.busy-indicator')).toHaveCount(0);
    await help(page, 'share');
    await expect(page.locator('[data-help=copy-link]')).toBeEnabled();
    const link = await page.getByRole('textbox', { name: 'View link', exact: true }).inputValue();
    await page.locator('[data-help=copy-link]').click(); await expect(page.locator('.help-status')).toContainText('Copied to clipboard');
    await page.locator('[data-help=native-share]').click();
    await expect.poll(() => page.evaluate(() => window.__shared.native?.url)).toBe(link);
    expect(await page.evaluate(() => window.__shared.text)).toBe(link);
    await page.locator('[data-help=preview]').click(); await expect(page.locator('.help-preview')).toBeVisible();
    await page.locator('[data-help=copy-image]').click();
    await expect(page.locator('.help-status')).toContainText('Image copied');
    const image = await page.evaluate(() => window.__shared.image); expect(image.type).toBe('image/png'); expect(image.size).toBeGreaterThan(10000);
  } finally { await server.stop(); }
});

test('embedded Markdown is sanitized and external documentation never executes inline content', async ({ page }) => {
  const requests = []; await open(page);
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.evaluate(() => {
    const node = document.getElementById('help-content'), content = JSON.parse(node.textContent);
    content.documents['README.md'].markdown = '# Safe title\n<script>window.__xss=1</script>\n<img src="https://invalid.example/private" onerror="window.__xss=2">\n[Unsafe](javascript:alert(1))\n<iframe src="https://invalid.example"></iframe>';
    node.textContent = JSON.stringify(content);
  });
  await help(page); await page.locator('[data-help=readme]').click();
  await expect(page.locator('.help-document h1')).toHaveText('Safe title');
  await expect(page.locator('.help-document script,.help-document img,.help-document iframe,.help-document a[href]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined(); expect(requests).toEqual([]);
});

test('late Live API responses cannot replace another help document or a closed dialog', async ({ page }) => {
  const server = await startLocalPathsServer();
  try {
    await page.goto(server.baseUrl); await expect.poll(async () => (await debug(page)).localPaths).toBe(true);
    await expect(page.locator('.busy-indicator')).toHaveCount(0);
    let release, received;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
    await page.route('**/openapi.json', async route => { received(); await gate; await route.fulfill({ json: { openapi: '3.1.1', late: true } }).catch(() => {}); });
    await help(page); await page.locator('[data-help=live-api]').click(); await started;
    await page.locator('[data-help=readme]').click(); release();
    await expect(page.locator('.help-body')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.help-document h1')).toContainText('OpenBEXI');
    await expect(page.locator('.help-json')).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-action=help]')).toBeFocused();
  } finally { await server.stop(); }
});
