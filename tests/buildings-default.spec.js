// buildings-default.spec.js: Lane F (sprint 02Oct26f, D-048 item 6). The baked city is the
// default building path; the live per-tile path stays as the explicit choice and as the
// automatic fallback. Pins (each case in a fresh browser context):
//   b1  a clean profile with no parameters fetches baked/buildings.bin and never a live tile;
//   b2  a 'live' saved before this release is dropped once (other prefs kept) and lands on baked;
//   b3  a live chosen with the HUD after the release persists; choosing baked again restores it
//       and the default URL carries no buildings parameter;
//   b4  ?buildings=live still works, for the visit only;
//   b5  a 404 on the payload falls back to live with the existing warning and no other error;
//   b6  an unparseable payload, and a missing footprint companion, fall back the same way.
// The production build is checked through its network requests by scripts/verify-preview.mjs.

import { test, expect } from '@playwright/test';

const PREFS = 'ug:prefs:v2';
const BIN = '**/baked/buildings.bin', FOOT = '**/baked/landmark-footprints.json';
const LIVE_TILE = /\/surface\/tiles\/(?!manifest).*\.json/;

async function open(browser, { url = '/', init = null, routes = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const log = { responses: [], requests: [], errors: [], warnings: [], pageErrors: [] };
  page.on('response', r => log.responses.push({ url: r.url(), status: r.status() }));
  page.on('request', r => log.requests.push(r.url()));
  page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text()); if (m.type() === 'warning') log.warnings.push(m.text()); });
  page.on('pageerror', e => log.pageErrors.push(String(e)));
  // Seeded once per tab: the init script runs again on every navigation, sessionStorage survives a reload.
  if (init) await page.addInitScript(([k, v]) => {
    try { if (!sessionStorage.getItem('ug-test-seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('ug-test-seeded', '1'); } } catch {}
  }, [PREFS, init]);
  for (const [pattern, handler] of routes) await page.route(pattern, handler);
  await page.goto(url);
  return { context, page, log };
}
const ready = page => page.waitForFunction(() => !!(window.__ug?.camera && window.__ug.groundReady), null, { timeout: 120000 });
const pathOf = page => page.evaluate(() => window.__ug.buildingsPath);
const prefsOf = page => page.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return null; } }, PREFS);
const loadedTiles = page => page.evaluate(() => window.__ug.surfaceLoaderStats.loaded);
const baked200 = log => log.responses.filter(r => /\/baked\/buildings\.bin/.test(r.url) && r.status === 200);
const openHud = page => page.evaluate(() => { document.getElementById('hudDetails').open = true; });
const urlParams = page => page.evaluate(() => Object.fromEntries(new URL(location.href).searchParams));
const ariaPressed = page => page.getAttribute('#bakedBuildings', 'aria-pressed');

test.describe.configure({ mode: 'serial' });

test('b1: a clean profile with no parameters runs the baked city and fetches no live tile', async ({ browser }) => {
  test.setTimeout(240000);
  const { context, page, log } = await open(browser, { url: '/' });
  await page.waitForFunction(() => document.getElementById('loadingBar')?.classList.contains('done'), null, { timeout: 150000 });
  await ready(page);
  expect(await pathOf(page)).toBe('baked');
  await page.waitForTimeout(12000);
  expect(baked200(log).length).toBeGreaterThanOrEqual(1);
  expect(log.requests.filter(u => LIVE_TILE.test(u)), 'no live tile requested').toEqual([]);
  await openHud(page);
  expect(await ariaPressed(page)).toBe('true');
  expect(log.errors, 'console errors').toEqual([]);
  expect(log.pageErrors).toEqual([]);
  await context.close();
});

test('b2 and b3: a pre-release saved live lands on baked; a live chosen after the release persists', async ({ browser }) => {
  test.setTimeout(240000);
  const { context, page, log } = await open(browser, { url: '/?skip=1', init: '{"buildingsPath":"live","masterHeight":1.1}' });
  await ready(page);
  // b2: dropped once; the other prefs stay; a revision marker is written.
  expect(await pathOf(page)).toBe('baked');
  let prefs = await prefsOf(page);
  expect(prefs.buildingsPath).toBeUndefined();
  expect(prefs.masterHeight).toBe(1.1);
  expect(prefs.buildingsPathRev).toBeGreaterThanOrEqual(2);
  await page.reload(); await ready(page);
  expect(await pathOf(page)).toBe('baked');
  // b3: the HUD choice of live persists across a reload with no parameters.
  await openHud(page);
  await page.click('#bakedBuildings');
  expect(await pathOf(page)).toBe('live');
  expect((await urlParams(page)).buildings).toBe('live');
  expect((await prefsOf(page)).buildingsPath).toBe('live');
  await page.goto('/?skip=1'); await ready(page);
  expect(await pathOf(page)).toBe('live');
  // And back: baked again, the default URL carries no buildings parameter, and it persists.
  await openHud(page);
  await page.click('#bakedBuildings');
  expect(await pathOf(page)).toBe('baked');
  expect((await urlParams(page)).buildings).toBeUndefined();
  await page.goto('/?skip=1'); await ready(page);
  expect(await pathOf(page)).toBe('baked');
  expect(log.pageErrors).toEqual([]);
  await context.close();
});

test('b4: ?buildings=live runs the live path for the visit, and is not saved', async ({ browser }) => {
  test.setTimeout(240000);
  const { context, page } = await open(browser, { url: '/?skip=1&buildings=live' });
  await ready(page);
  expect(await pathOf(page)).toBe('live');
  await page.waitForFunction(() => window.__ug.surfaceLoaderStats.loaded > 0, null, { timeout: 60000 });
  expect((await prefsOf(page)).buildingsPath).toBeUndefined();
  await page.goto('/?skip=1'); await ready(page);
  expect(await pathOf(page)).toBe('baked');
  await context.close();
});

for (const [name, routes, expectedErrors] of [
  ['b5: a 404 on the payload falls back to live with the existing warning', [[BIN, r => r.fulfill({ status: 404, body: 'not found' })]], 1],
  ['b6: an unparseable payload falls back to live', [[BIN, r => r.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(64) })]], 0],
  ['b6: a missing footprint companion falls back to live', [[FOOT, r => r.fulfill({ status: 404, body: 'not found' })]], 1],
]) {
  test(name, async ({ browser }) => {
    test.setTimeout(240000);
    const { context, page, log } = await open(browser, { url: '/?skip=1', routes });
    await ready(page);
    await page.waitForFunction(() => window.__ug.buildingsPath === 'live', null, { timeout: 60000 });
    await page.waitForFunction(() => window.__ug.surfaceLoaderStats.loaded > 0, null, { timeout: 60000 });
    await openHud(page);
    expect(await ariaPressed(page)).toBe('false');
    expect(log.warnings.filter(w => /Baked buildings unavailable/.test(w)).length).toBe(1);
    // Only the failed resource's own load error, if the browser logs one.
    expect(log.errors.length).toBeLessThanOrEqual(expectedErrors);
    for (const e of log.errors) expect(e).toMatch(/Failed to load resource/);
    expect(log.pageErrors).toEqual([]);
    // The fallback is not saved as a choice.
    expect((await prefsOf(page)).buildingsPath).not.toBe('live');
    await context.close();
  });
}
