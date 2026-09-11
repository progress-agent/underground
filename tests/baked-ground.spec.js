import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('ground bytes match the offline rasteriser; flight fetches no source tiles; live toggle recovers', async ({ page }) => {
  const requests = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/surface\/tiles\/(?!manifest).*\.json/.test(r.url())) requests.push(r.url()); });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.bakedStats && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal);
  const expected = JSON.parse(await readFile(new URL('../public/data/surface/baked/ground-meta.json', import.meta.url), 'utf8'));
  const actual = await page.evaluate(async () => {
    const state = window.__ug.surfaceTexState;
    const digest = await crypto.subtle.digest('SHA-256', state.pixels);
    return { sha: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''),
      size: state.size, bbox: state.bbox, version: state.texture.version, path: window.__ug.groundPath };
  });
  expect(actual.sha).toBe(expected.rgbaSha256);
  expect(actual.size).toBe(4096);
  expect(actual.bbox).toEqual(expected.bbox);
  expect(actual.path).toBe('baked');
  for (const x of [-22000, 18000, 0]) {
    await page.evaluate(x => { window.__ug.camera.position.set(x, 900, 0); }, x);
    await page.waitForTimeout(600);
  }
  expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => window.__ug.surfaceTexState.texture.version)).toBe(actual.version);
  await page.evaluate(() => window.__ug.setBuildingsPath('live'));
  await page.waitForFunction(() => window.__ug.buildingInstanceCount > 1000);
  expect(requests.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__ug.surfaceTexState.texture.version)).toBe(actual.version);
  expect(errors).toEqual([]);
});

for (const failure of ['missing', 'html', 'corrupt']) {
  test(`ground ${failure} degrades to functioning live ground`, async ({ page }) => {
    await page.route('**/surface/baked/ground.bin', route => route.fulfill({
      status: failure === 'missing' ? 404 : 200,
      contentType: failure === 'html' ? 'text/html' : 'application/octet-stream',
      body: failure === 'html' ? '<html>SPA fallback</html>' : 'bad ground payload',
    }));
    await page.goto('/?fast=1&buildings=baked');
    await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.groundPath === 'live');
    await page.waitForFunction(() => window.__ug.surfaceLoaderStats.loaded > 2);
    expect(await page.evaluate(() => window.__ug.surfaceTexState.pixels.some(x => x > 0))).toBe(true);
  });
}

test('switching buildings during the incremental bake does not mix render paths', async ({ page }) => {
  await page.goto('/?fast=1&buildings=live');
  await page.waitForFunction(() => window.__ug?.groundReady);
  await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
  await page.waitForFunction(() => {
    const ug = window.__ug, stats = ug.bakedStats;
    if (!stats || stats.tilesBuilt === stats.tilesTotal) return false;
    ug.setBuildingsPath('live');
    return true;
  });
  await page.waitForFunction(() => {
    const s = window.__ug.bakedStats;
    return s && s.tilesBuilt === s.tilesTotal;
  });
  expect(await page.evaluate(() => window.__ug.surfaceGeometryGroup.children.filter(m => m.name.startsWith('baked-buildings-')).length)).toBe(0);
  await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
  expect(await page.evaluate(() => window.__ug.surfaceGeometryGroup.children.filter(m => m.name.startsWith('baked-buildings-')).length))
    .toBe(await page.evaluate(() => window.__ug.bakedStats.tilesTotal));
});
