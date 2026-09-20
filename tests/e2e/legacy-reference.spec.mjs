import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startConfiguredProfileServer } from '../integration/configured-profile-server.mjs';

const files = ['SOURCES1', 'SOURCES2'].map(name => path.resolve(`../openbexi_timeline/tests/data/${name}/2024/03/18/events.json`));
const hashes = () => Promise.all(files.map(async file => createHash('sha256').update(await readFile(file)).digest('hex')));
const debug = page => page.evaluate(() => window.__timelineDebug);
async function ready(page) { await expect.poll(async () => (await debug(page))?.ready, { timeout: 20000 }).toBe(true); }

test('v2 SOURCE1/SOURCE2 reference keeps real data, dynamic grouping and toolbar modes', async ({ page }, info) => {
  expect(files.every(file => existsSync(file)), 'Requires the readonly sibling legacy SOURCES1/SOURCES2 fixture.').toBe(true);
  test.setTimeout(90000);
  const before = await hashes(), server = await startConfiguredProfileServer('yaml/default_test.yml');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1500, height: 795 });
    await page.goto(server.baseUrl); await ready(page);
    const initial = await debug(page);
    expect(Number(initial.fromMs)).toBe(Date.parse('2024-03-18T19:00:00Z'));
    expect(Number(initial.toMs)).toBe(Date.parse('2024-03-18T21:00:00Z'));
    expect(initial.scaleMode).toBe('uniform');
    expect(Number(initial.centerMs)).toBe(Date.parse('2024-03-18T20:00:00Z'));
    expect(initial.detailTotal).toBe(130);
    expect(initial.sourceName).toContain('SOURCE1'); expect(initial.sourceName).toContain('SOURCE2');
    await expect(page.locator('.overview-section')).toBeHidden();
    await expect(page.locator('.record-label').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('source1-source2-timeline.png') });
    const workspaceTools = page.getByRole('button', { name: 'Workspace tools', exact: true });
    await workspaceTools.click();
    const grouping = page.locator('#grouping-mode');
    const options = await grouping.locator('option').evaluateAll(items => items.map(item => ({ text: item.textContent, value: item.value })));
    for (const name of ['status', 'namespace']) {
      const option = options.find(item => item.text === name || item.text.toLowerCase() === name);
      expect(option, `dynamic ${name} option`).toBeTruthy();
      await grouping.selectOption(option.value); await ready(page);
      expect((await debug(page)).detailTotal).toBe(130);
      await workspaceTools.click();
      await page.screenshot({ path: info.outputPath(`source1-source2-${name}.png`) });
      await workspaceTools.click();
    }
    await workspaceTools.click();
    for (const view of ['table', 'split', 'timeline']) {
      await page.locator(`[data-view=${view}]`).click(); await ready(page);
      expect(Number((await debug(page)).fromMs)).toBe(Number(initial.fromMs));
      expect(Number((await debug(page)).toMs)).toBe(Number(initial.toMs));
    }
    await page.getByRole('button', { name: 'Switch to 3D', exact: true }).click(); await ready(page);
    expect((await debug(page)).cameraType).toBe('PerspectiveCamera');
    await page.getByRole('button', { name: 'Switch to 2D', exact: true }).click(); await ready(page);
    const wire = await page.evaluate(async () => {
      const { createLegacyTransport } = await import('/openbexi_timeline/transport.js');
      const transport = createLegacyTransport({ baseUrl: location.origin });
      const parameters = new URLSearchParams({ startDate: '2024-03-18T19:00:00Z', endDate: '2024-03-18T21:00:00Z', scene: '7', namespace: 'SOURCE1' });
      try {
        const response = await transport.request(`/openbexi_timeline/sessions?${parameters}`);
        const envelope = await response.json();
        const streamed = await new Promise((resolve, reject) => {
          const stream = new transport.EventSource(`/openbexi_timeline_sse/sessions?${parameters}`);
          const timeout = setTimeout(() => { stream.close(); reject(new Error('Legacy SSE message deadline')); }, 10000);
          stream.onmessage = event => { clearTimeout(timeout); stream.close(); resolve(JSON.parse(event.data)); };
          stream.onerror = () => { clearTimeout(timeout); stream.close(); reject(new Error('Legacy SSE authentication or transport failure')); };
        });
        return { status: response.status, scene: envelope.scene, events: envelope.events.length,
          namespaces: [...new Set(envelope.events.map(event => event.data.namespace))],
          streamScene: streamed.scene, streamEvents: streamed.events.length };
      } finally { transport.dispose(); }
    });
    expect(wire.status).toBe(200); expect(wire.scene).toBe('7'); expect(wire.events).toBeGreaterThan(0);
    expect(wire.namespaces).toEqual(['SOURCE1']); expect(wire.streamScene).toBe('7'); expect(wire.streamEvents).toBe(wire.events);
    await workspaceTools.click();
    const sourceCounts = [];
    for (const selected of [[0], [1], [0, 1]]) {
      await page.getByRole('button', { name: 'Sources', exact: true }).click();
      const paths = page.locator('.path-choice [name=path]');
      await expect(paths).toHaveCount(2);
      for (let index = 0; index < 2; index++) await paths.nth(index).setChecked(selected.includes(index));
      await page.locator('#path-form [type=submit]').click(); await ready(page);
      await expect.poll(async () => (await debug(page)).selectedSourceIds?.length).toBe(selected.length);
      await expect(page.locator('.busy-indicator')).toHaveCount(0);
      const scoped = await debug(page);
      expect(Number(scoped.fromMs)).toBe(Number(initial.fromMs));
      expect(Number(scoped.toMs)).toBe(Number(initial.toMs));
      expect(scoped.detailTotal).toBeGreaterThan(0);
      if (selected.length === 1) {
        sourceCounts.push(scoped.detailTotal);
        await expect(page.locator('.group-label .group-name')).toHaveText([`SOURCE${selected[0] + 1}`]);
      } else expect(scoped.detailTotal).toBe(sourceCounts.reduce((sum, count) => sum + count, 0));
    }
    expect((await debug(page)).detailTotal).toBe(130);
    expect(errors).toEqual([]);
  } finally { await server.stop(); expect(await hashes()).toEqual(before); }
});
