import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { LocalProvider } from '../../client/src/data/local-provider.js';

const range = page => page.evaluate(() => ({ from: window.__timelineDebug.fromMs, to: window.__timelineDebug.toMs, selected: window.__timelineDebug.selectedId }));
async function ready(page) {
  await expect.poll(() => page.evaluate(() => !!window.__timelineDebug?.queryId && !window.__timelineDebug.queryLoading)).toBe(true);
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
}
test.beforeEach(async ({ page }) => { await page.goto(pathToFileURL(path.resolve('dist/index.html')).href); await ready(page); });

for (const width of [1600, 390]) test(`legacy toolbar controls and all three views remain usable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await ready(page);
  for (const name of ['User preferences and connection', 'Calendar', 'Resynchronize reference time', 'Filters', 'Run search', 'Clear search', 'Hide overview', 'Switch to 3D', 'Settings', 'Help and sharing']) {
    const control = page.getByRole('button', { name, exact: true }); await expect(control).toBeVisible();
    const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const before = await range(page);
  for (const view of ['Table', 'Split', 'Timeline']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (view === 'Split') { await expect(page.locator('.timeline-view')).toBeVisible(); await expect(page.locator('.table-view')).toBeVisible(); }
    await ready(page); expect(await range(page)).toEqual(before);
  }
  await page.screenshot({ path: `artifacts/browser/legacy-toolbar-${width}.png` });
});

test('overview and real camera toggles preserve the active query, range and selection', async ({ page }) => {
  const before = await range(page), query = await page.evaluate(() => window.__timelineDebug.queryId);
  await page.getByRole('button', { name: 'Hide overview', exact: true }).click();
  await expect(page.locator('.overview-section')).toBeHidden(); await ready(page);
  await page.getByRole('button', { name: 'Switch to 3D', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.cameraType)).toBe('PerspectiveCamera');
  await expect(page.getByRole('button', { name: 'Switch to 2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Switch to 2D', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.cameraType)).toBe('OrthographicCamera');
  await page.getByRole('button', { name: 'Show overview', exact: true }).click(); await ready(page);
  await expect(page.locator('.overview-section')).toBeVisible();
  expect(await range(page)).toEqual(before); expect(await page.evaluate(() => window.__timelineDebug.queryId)).toBe(query);
});

test('search click, Enter and clearing use the same search state', async ({ page }) => {
  const before = await range(page), search = page.getByRole('searchbox', { name: 'Search events and sessions' });
  await search.fill('timeline'); await page.getByRole('button', { name: 'Run search', exact: true }).click(); await ready(page);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.search)).toBe('timeline');
  await search.fill('session'); await search.press('Enter'); await ready(page);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.search)).toBe('session');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click(); await ready(page);
  await expect(search).toHaveValue(''); await expect.poll(() => page.evaluate(() => window.__timelineDebug.search)).toBe('');
  expect(await range(page)).toEqual(before);
  await expect(page.getByRole('combobox', { name: 'Sort by', exact: true })).toBeEnabled();
});

test('profile saves display preferences without changing the workspace identity', async ({ page }) => {
  await page.getByRole('button', { name: 'User preferences and connection', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Timeline reader');
  await page.getByLabel('Email', { exact: true }).fill('reader@example.test');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('button', { name: 'User preferences and connection', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Timeline reader');
  await page.getByRole('button', { name: 'Sources and connection', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Source and connection', exact: true })).toBeVisible();
});

test('geometry settings apply bounded dimensions and restore the window', async ({ page }) => {
  const before = await range(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const [label, value] of [['Top', '20'], ['Left', '30'], ['Width', '1300'], ['Height', '780']]) await page.getByLabel(`${label} / pixels`, { exact: true }).fill(value);
  await page.getByLabel('Camera', { exact: true }).selectOption('Perspective');
  await page.locator('#settings-form [type=submit]').click(); await ready(page);
  const rect = await page.locator('#app').boundingBox(); expect(rect.x).toBe(30); expect(rect.y).toBe(20); expect(rect.width).toBe(1300); expect(rect.height).toBe(780);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.cameraType)).toBe('PerspectiveCamera');
  expect(await range(page)).toEqual(before);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Fit window', exact: true }).click();
  await page.getByLabel('Camera', { exact: true }).selectOption('Orthographic');
  await page.locator('#settings-form [type=submit]').click(); await ready(page);
  const restored = await page.locator('#app').boundingBox(); expect(restored.x).toBe(0); expect(restored.y).toBe(0); expect(restored.width).toBe(1600);
});

test('reference resynchronization is separate from Now and calendar opens creation on its date', async ({ page }) => {
  const reference = await page.evaluate(() => JSON.parse(document.getElementById('timeline-data').textContent).settings.referenceTime);
  await page.getByRole('button', { name: 'Now', exact: true }).click(); await ready(page);
  await expect.poll(() => page.evaluate(() => Math.abs(Number(window.__timelineDebug.centerMs) - Date.now()))).toBeLessThan(10000);
  await page.getByRole('button', { name: 'Resynchronize reference time', exact: true }).click(); await ready(page);
  await expect.poll(() => page.evaluate(value => Math.abs(Number(window.__timelineDebug.centerMs) - Date.parse(value)), reference)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendar = page.getByRole('complementary', { name: 'Calendar', exact: true });
  const date = await calendar.locator('[aria-selected=true] button').getAttribute('data-date');
  await calendar.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create record', exact: true })).toBeVisible();
  await expect(page.locator('#record-form [name=start]')).toHaveValue(new RegExp(`^${date}`));
  await expect(page.getByLabel('Record icon', { exact: true })).toBeVisible();
});

test('observed custom JSON fields can group the timeline without authorizing predicate fields', async ({ page }) => {
  const local = new LocalProvider(await page.evaluate(() => JSON.parse(document.getElementById('timeline-data').textContent)));
  const metadata = await local.initialize();
  const draft = await local.mutateConfiguration({ family: 'schemas', type: 'create', generation: metadata.generation, clientCommandId: crypto.randomUUID(), payload: { name: 'Earthquake metadata', visibility: 'workspace', definition: { schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { magType: { type: 'string' } }, additionalProperties: false } } } });
  const published = await local.mutateConfiguration({ family: 'schemas', type: 'publish', resourceId: draft.resource.id, expectedRevision: draft.resource.revision, generation: metadata.generation, clientCommandId: crypto.randomUUID(), payload: {} });
  const snapshot = await local.exportSnapshot(); local.dispose();
  snapshot.records.forEach((record, index) => { record.schemaId = published.resource.id; record.schemaVersion = 1; record.data.magType = index % 2 ? 'Mw' : 'ML'; }); delete snapshot.manifest.contentSha256;
  await page.locator('[data-action=sources]').first().click();
  await page.locator('#json-file').setInputFiles({ name: 'observed-fields.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) }); await ready(page);
  await page.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('/data/magType'); await ready(page);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const form = page.locator('#settings-form');
  await form.locator('[name=definitionVersion]').selectOption('2');
  await expect(form.getByLabel('Group by field', { exact: true })).toHaveValue('/data/magType');
  await expect(form.locator('[type=submit]')).toBeEnabled(); await form.locator('[type=submit]').click(); await ready(page);
  await expect.poll(() => page.evaluate(() => window.__timelineDebug.grouping)).toBe('/data/magType');
  await page.getByRole('button', { name: 'Filters', exact: true }).click(); await expect(form.locator('[type=submit]')).toBeEnabled();
  await form.locator('[data-filter-command=add-root]').click();
  await expect(form.locator('[data-filter-field] option[value="/data/magType"]')).toHaveCount(0);
});
