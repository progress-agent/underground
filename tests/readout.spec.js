// readout.spec.js — Beta v7 readout widget coverage.
//
// The readout widget (#ug-readout) is updated every tick in main.js. Tests
// use camera repositioning rather than calling update() directly, because the
// live tick loop overwrites any manual update() call before Playwright can
// assert the result.
//
// Uses ?skipintro=1 to bypass the cinematic descent. Camera starts at
// approximately (-200, 85, 400) scene units — above ground in central London.

import { test, expect } from '@playwright/test';

const BASE = '/?skipintro=1';

async function gotoAndWait(page) {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.readout), null, { timeout: 8000 });
}

test('readout element exists in DOM after init', async ({ page }) => {
  await gotoAndWait(page);
  await expect(page.locator('#ug-readout')).toBeAttached();
});

test('defaults to AIR substrate on first load (camera above ground)', async ({ page }) => {
  await gotoAndWait(page);
  // Camera starts above ground — allow a tick to run before asserting
  await page.waitForFunction(() => document.getElementById('ug-readout')?.dataset.substrate === 'AIR', null, { timeout: 3000 });
  await expect(page.locator('#ug-readout-sub')).toHaveText('AIR');
});

test('altitude sign is + and alt reads correctly when camera is above ground', async ({ page }) => {
  await gotoAndWait(page);
  // Teleport camera 500 scene units above terrain (=100m at VE=5) and wait for tick
  await page.evaluate(() => {
    const surf = window.__ug.getTerrainMeshSurfaceY({ x: 0, z: 0 }) ?? 75;
    window.__ug.camera.position.set(0, surf + 500, 0);
    window.__ug.controls.target.set(0, surf, 0);
  });
  await page.waitForFunction(() => document.getElementById('ug-readout-sign')?.textContent === '+', null, { timeout: 3000 });
  await expect(page.locator('#ug-readout-sign')).toHaveText('+');
  // Altitude should be ~100m (500 scene / VE=5)
  const altText = await page.locator('#ug-readout-alt').textContent();
  expect(parseInt(altText)).toBeGreaterThan(80);
  expect(parseInt(altText)).toBeLessThan(120);
});

test('substrate changes to CLAY when camera is underground (above chalk)', async ({ page }) => {
  await gotoAndWait(page);
  // Place camera below terrain surface but above chalk top (chalk ≈ -300 scene units)
  // Origin (0,0) ≈ Trafalgar Square, inside M25, not in Thames
  await page.evaluate(() => {
    const surf = window.__ug.getTerrainMeshSurfaceY({ x: 0, z: 0 }) ?? 75;
    window.__ug.camera.position.set(0, surf - 50, 0);
    window.__ug.controls.target.set(0, surf - 50, 500);
  });
  await page.waitForFunction(
    () => document.getElementById('ug-readout')?.dataset.substrate === 'CLAY',
    null, { timeout: 3000 }
  );
  await expect(page.locator('#ug-readout-sub')).toHaveText('CLAY');
  // Should show negative altitude
  await expect(page.locator('#ug-readout-sign')).toHaveText('−');
});

test('substrate changes to CHALK when camera is very deep', async ({ page }) => {
  await gotoAndWait(page);
  // -400 scene units is below chalk top (~-300 scene units)
  await page.evaluate(() => {
    window.__ug.camera.position.set(0, -400, 0);
    window.__ug.controls.target.set(0, -400, 500);
  });
  await page.waitForFunction(
    () => document.getElementById('ug-readout')?.dataset.substrate === 'CHALK',
    null, { timeout: 3000 }
  );
  await expect(page.locator('#ug-readout-sub')).toHaveText('CHALK');
});

test('outside M25 below surface never reads AIR (D6 substrate coherence)', async ({ page }) => {
  await gotoAndWait(page);
  // (30000, -1000, 0) is outside the M25 disc, well below the local terrain
  // surface. Before D6 this fell through the isUnderground(=cameraInsideM25
  // && belowSurface) gate and read AIR — a contradiction with "below ground".
  // The fix classifies purely on belowSurface + depth-vs-chalk-datum,
  // independent of M25 membership.
  await page.evaluate(() => {
    window.__ug.camera.position.set(30000, -1000, 0);
    window.__ug.controls.target.set(30000, -1000, 500);
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('ug-readout');
    return el && el.dataset.substrate && el.dataset.substrate !== 'AIR';
  }, null, { timeout: 3000 });
  const substrate = await page.locator('#ug-readout').getAttribute('data-substrate');
  expect(['CLAY', 'CHALK', 'WATER']).toContain(substrate);
});

test('heading is valid 000–359° format', async ({ page }) => {
  await gotoAndWait(page);
  await page.waitForFunction(() => {
    const az = document.querySelector('#ug-readout-az');
    return az && /^[0-3][0-9][0-9]°$/.test(az.textContent);
  }, null, { timeout: 5000 });
  const azText = await page.locator('#ug-readout-az').textContent();
  expect(azText).toMatch(/^[0-3][0-9][0-9]°$/);
});

test('old #compass and #altimeter elements are absent from DOM', async ({ page }) => {
  await gotoAndWait(page);
  await expect(page.locator('#compass')).not.toBeAttached();
  await expect(page.locator('#altimeter')).not.toBeAttached();
});
