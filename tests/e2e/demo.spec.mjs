import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const site = 'https://openbexi-demo.test/openbexi_timeline2.0/';
const artifact = path.resolve('artifacts/demo/index.html');
const html = () => readFile(artifact, 'utf8');
const ready = page => expect.poll(() => page.evaluate(() => window.__timelineDebug?.ready)).toBe(true);

async function openHosted(page, query = '') {
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // A static host correctly returns 404 to the bounded backend discovery probe.
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  page.on('dialog', dialog => dialog.accept());
  const source = await html();
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    if (url.split(/[?#]/)[0] === site) return route.fulfill({ status: 200, contentType: 'text/html', body: source });
    if (url === 'https://openbexi-demo.test/api/v1/bootstrap') return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
    unexpected.push(url);
    return route.abort();
  });
  await page.goto(site + query);
  await ready(page);
  return { errors, unexpected };
}

async function canvasColors(page) {
  return page.locator('.plot-wrap canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    const colors = new Set();
    for (let i = 0; i < bytes.length; i += 4) colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
    return colors.size;
  });
}

test('demo package contains the same standalone application and only intended public files', async () => {
  expect((await readdir(path.dirname(artifact))).sort()).toEqual(['.nojekyll', 'THIRD-PARTY-NOTICES.json', 'index.html']);
  expect(await readFile(artifact)).toEqual(await readFile('dist/index.html'));
  expect(await readFile(path.join(path.dirname(artifact), 'THIRD-PARTY-NOTICES.json'))).toEqual(await readFile('dist/THIRD-PARTY-NOTICES.json'));
});

test('HTTPS project-site demo supports all datasets, row paging, and offline navigation', async ({ page }, info) => {
  test.setTimeout(90000);
  const observed = await openHosted(page);
  await expect(page.locator('.provider-status')).toContainText('Local');
  expect(await canvasColors(page)).toBeGreaterThan(8);
  await expect(page.locator('.overview-plot canvas')).toBeVisible();
  await page.screenshot({ path: info.outputPath('demo-desktop.png') });
  const initial = await page.evaluate(() => window.__timelineDebug);
  await page.locator('[data-action=next]').click();
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.startRow)).toBeGreaterThan(initial.startRow);
  const next = await page.evaluate(() => window.__timelineDebug);
  for (const field of ['fromMs', 'toMs', 'mapId']) expect(next[field]).toBe(initial[field]);
  await page.context().setOffline(true);
  try {
    for (const [id, count] of [['ephemeris',127], ['jfk',130], ['monet',27], ['religions',730], ['space_exploration',1287], ['multiple_sources_test',1145], ['default-dataset',1008]]) {
      await page.locator('[data-action=help]').click();
      await page.getByLabel('Test local dataset', { exact: true }).selectOption(id);
      await page.locator('[data-help=open-test-data]').click();
      await expect.poll(() => page.evaluate(() => window.__timelineDebug.testDatasetId)).toBe(id);
      await ready(page);
      expect(await page.evaluate(() => window.__timelineDebug.recordCount)).toBe(count);
      await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    }
    const before = await page.evaluate(() => window.__timelineDebug.fromMs);
    await page.locator('.plot-wrap').focus();
    await page.keyboard.press('ArrowRight');
    await ready(page);
    expect(await page.evaluate(() => window.__timelineDebug.fromMs)).not.toBe(before);
    expect(await canvasColors(page)).toBeGreaterThan(8);
    expect(observed.errors).toEqual([]);
    expect(observed.unexpected).toEqual([]);
  } finally { await page.context().setOffline(false); }
});

for (const id of ['default-dataset', 'ephemeris', 'jfk', 'monet', 'religions', 'space_exploration', 'multiple_sources_test']) {
  test(`live demo deep link opens ${id}`, async ({ page }) => {
    const observed = await openHosted(page, `?dataset=${id}`);
    expect(await page.evaluate(() => window.__timelineDebug.testDatasetId)).toBe(id);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    expect(observed.errors).toEqual([]);
    expect(observed.unexpected).toEqual([]);
  });
}

for (const query of ['?dataset=unknown', '?dataset=jfk&dataset=monet']) {
  test(`invalid demo selection safely opens the default: ${query}`, async ({ page }) => {
    const observed = await openHosted(page, query);
    expect(await page.evaluate(() => window.__timelineDebug.testDatasetId)).toBe('default-dataset');
    expect(observed.errors).toEqual([]);
    expect(observed.unexpected).toEqual([]);
  });
}

test('demo sharing retains the dataset and waits for review before applying the view', async ({ page }) => {
  await openHosted(page, '?dataset=jfk');
  await page.locator('[data-action=zoom-in]').click(); await ready(page);
  const fromMs = await page.evaluate(() => window.__timelineDebug.fromMs);
  await page.locator('[data-action=help]').click();
  await page.locator('[data-help-tab=share]').click();
  const link = await page.getByRole('textbox', { name: 'View link', exact: true }).inputValue();
  expect(new URL(link).search).toBe('?dataset=jfk');
  await page.goto(link); await page.reload(); await ready(page);
  expect(await page.evaluate(() => window.__timelineDebug.testDatasetId)).toBe('jfk');
  await expect(page.locator('.help-review')).toBeVisible();
  expect(await page.evaluate(() => window.__timelineDebug.fromMs)).not.toBe(fromMs);
  await page.locator('[data-help=apply-link]').click(); await ready(page);
  expect(await page.evaluate(() => window.__timelineDebug.fromMs)).toBe(fromMs);
});

test('multiple-source demo filters both namespaces, discovers grouping and navigates original dates', async ({ page }, info) => {
  const observed = await openHosted(page, '?dataset=multiple_sources_test');
  expect(await page.evaluate(() => window.__timelineDebug.recordCount)).toBe(1145);
  expect(await page.evaluate(() => window.__timelineDebug.detailTotal)).toBe(1145);
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  for (const [namespace, count] of [['SOURCE1', 1018], ['SOURCE2', 127]]) {
    const source = await page.locator('#source-filter option').evaluateAll((items, name) => items.find(item => item.textContent.includes(name))?.value, namespace);
    expect(source).toBeTruthy();
    await page.locator('#source-filter').selectOption(source); await ready(page);
    await expect.poll(() => page.evaluate(() => window.__timelineDebug.detailTotal)).toBe(count);
  }
  await page.locator('#source-filter').selectOption('all'); await ready(page);
  for (const name of ['status', 'namespace']) {
    const field = await page.locator('#grouping-mode option').evaluateAll((items, text) => items.find(item => item.textContent.toLowerCase() === text)?.value, name);
    expect(field).toBeTruthy();
    await page.locator('#grouping-mode').selectOption(field); await ready(page);
    expect(await page.evaluate(() => window.__timelineDebug.detailTotal)).toBe(1145);
  }
  await page.screenshot({ path: info.outputPath('multiple-sources-grouped.png') });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: '2024-03-24', exact: true }).click(); await ready(page);
  await expect(page.locator('.record-label').first()).toBeVisible();
  expect(Number(await page.evaluate(() => window.__timelineDebug.fromMs))).not.toBe(Date.parse('2024-03-17T00:00:00Z'));
  expect(observed.errors).toEqual([]); expect(observed.unexpected).toEqual([]);
});

test('expanded default demo renders sessions and events in both surrounding months', async ({ page }) => {
  await openHosted(page, '?dataset=default-dataset');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const time = page.getByLabel('Calendar center time / UTC', { exact: true });
  await time.fill('10:00'); await time.press('Tab'); await ready(page);
  for (const [month, date] of [['8', '2026-08-13'], ['10', '2026-10-12']]) {
    await page.getByRole('combobox', { name: 'Calendar month', exact: true }).selectOption(month);
    await page.getByRole('button', { name: date, exact: true }).click(); await ready(page);
    expect(await page.evaluate(() => window.__timelineDebug.detailTotal)).toBeGreaterThan(0);
    await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
    expect(await page.locator('.plot-wrap .record-label').allTextContents()).toContain(`Daily shift / operations / ${date}`);
  }
});

test('mobile project-site demo has visible canvases and no horizontal page overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observed = await openHosted(page);
  await expect(page.locator('.plot-wrap .record-label').first()).toBeVisible();
  await expect(page.locator('.overview-plot canvas')).toBeVisible();
  expect(await canvasColors(page)).toBeGreaterThan(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('demo-mobile.png') });
  expect(observed.errors).toEqual([]);
  expect(observed.unexpected).toEqual([]);
});

test('the packaged HTML opens from a local file without any HTTP request', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(artifact).href);
  await ready(page);
  expect(await canvasColors(page)).toBeGreaterThan(8);
  expect(requests).toEqual([]);
});
