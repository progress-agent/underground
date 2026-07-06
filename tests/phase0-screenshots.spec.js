// Phase 0c visual verification: capture three screenshots to prove that
// disposed tiles re-render their buildings on camera return.
//
// Flow: initial render → teleport camera 50km away (tiles unload) →
// return camera to origin (tiles reload) → screenshots at each stage.
//
// The Phase 0b fix (per-tile dedup Set cleanup on disposal) is what this
// exercises: before the fix, the return screenshot would show empty ground
// where buildings used to be, because placedBuildings dedup hashes were
// never drained on disposal.

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Save screenshots under the repo (machine-portable) instead of a hardcoded
// per-machine Wisdom project path.
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-results', 'phase0-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function waitForLoadingIdle(page, timeoutMs = 20000) {
  await page.waitForFunction(
    () => window.__ug && window.__ug.surfaceLoaderStats.loading === 0,
    { timeout: timeoutMs },
  );
}

test('Phase 0c — visual dispose→reload cycle', async ({ page }) => {
  test.setTimeout(180000);

  await page.goto('/');

  // Wait for initial boot (loading bar done) then settle.
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );
  await page.waitForTimeout(3000);
  await waitForLoadingIdle(page);

  // ── 01 initial ──────────────────────────────────────────────────────
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-initial.png'), fullPage: false });
  const initialInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);
  const initialStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);

  // ── Teleport far away (> UNLOAD_RADIUS 18km) ────────────────────────
  await page.evaluate(() => {
    window.__ug.camera.position.set(50000, 2000, 50000);
    if (window.__ug.controls && typeof window.__ug.controls.update === 'function') {
      window.__ug.controls.update();
    }
  });
  // Give disposal several CHECK_INTERVAL cycles + settle
  await page.waitForTimeout(2500);
  await waitForLoadingIdle(page);
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-far.png'), fullPage: false });
  const farInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);
  const farStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);

  // ── Return camera to origin area ────────────────────────────────────
  await page.evaluate(() => {
    window.__ug.camera.position.set(-200, 85, 400);
    if (window.__ug.controls && typeof window.__ug.controls.update === 'function') {
      window.__ug.controls.update();
    }
  });
  // Reload takes longer than unload — network + JSON parse + geometry build,
  // and the loader queues tiles in batches of MAX_CONCURRENT=4 every
  // CHECK_INTERVAL=500ms, so there are transient idle windows mid-refill.
  // Wait until stats.loaded approaches the initial count (or a long cap).
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    (target) => {
      const s = window.__ug.surfaceLoaderStats;
      return s.loading === 0 && s.loaded >= target;
    },
    Math.floor(initialStats.loaded * 0.9),
    { timeout: 60000 },
  );
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-return.png'), fullPage: false });
  const returnInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);
  const returnStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);

  console.log('Phase 0c screenshot spec — instance counts:', {
    initial: initialInstances,
    far: farInstances,
    return: returnInstances,
  });
  console.log('Phase 0c screenshot spec — stats:', {
    initial: initialStats,
    far: farStats,
    return: returnStats,
  });

  // Assertions
  expect(initialInstances).toBeGreaterThan(0);
  expect(returnInstances).toBeGreaterThan(0);
  expect(returnInstances).toBeGreaterThan(initialInstances * 0.85);
});
