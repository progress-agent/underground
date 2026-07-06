// Week-1 controls — desktop keyboard smoke spec.
//
// Verifies the Week-1 refactor of src/main.js fpsControls:
//   1. W moves camera forward in its XZ heading.
//   2. S moves camera backward (opposite of W, symmetric distance).
//   3. X is inert (no movement — removed from control set).
//   4. Shift-hold triples translation distance vs unmodified key.
//   5. HUD flight toggle latches 3× on, releases on second click.
//   6. Flight toggle active without Shift produces ~3× motion.
//
// All tests bypass the intro via ?skip=1 and drive the keys Set directly on
// window.__ug.fpsControls — this is deterministic and avoids focus / keyup
// races with programmatic page.keyboard.down/up.

import { test, expect } from '@playwright/test';

async function waitForUg(page) {
  await page.waitForFunction(
    () => !!(window.__ug && window.__ug.camera && window.__ug.fpsControls),
    { timeout: 60000 },
  );
}

async function waitForIntroDone(page) {
  // ?skip=1 fires ug:intro-done synchronously during setup, but tick() may
  // not have run a frame yet. Small wait lets tick pick up the first dt.
  await page.waitForFunction(
    () => window.__ug && window.__ug.intro && !window.__ug.intro.isRunning(),
    { timeout: 10000 },
  );
}

async function snapshotCamera(page) {
  return page.evaluate(() => {
    const c = window.__ug.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
}

// Hold a set of movement keys for `durationMs` by injecting them into the
// fpsControls.keys Set. Keeps them resident across frames; then clears.
async function holdKeys(page, keys, durationMs) {
  await page.evaluate((ks) => {
    for (const k of ks) window.__ug.fpsControls.keys.add(k);
  }, keys);
  await page.waitForTimeout(durationMs);
  await page.evaluate((ks) => {
    for (const k of ks) window.__ug.fpsControls.keys.delete(k);
  }, keys);
  // Let one more tick settle with keys released.
  await page.waitForTimeout(80);
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

test.describe('Week-1 desktop keyboard controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/?skip=1');
    await waitForUg(page);
    await waitForIntroDone(page);
    // D-002 speed regimes make horizontal reach altitude-dependent above ground
    // (0.3x-20x of base), which compounds nonlinearly over a multi-frame key
    // hold and makes displacement-ratio assertions position-dependent. ?skip=1
    // leaves the camera at INITIAL_VIEW (y=85, just above the ~75 surface), in
    // that scaled regime. Drop camera + target by an equal delta into the
    // constant-base BELOW-ground regime (offset preserved so OrbitControls does
    // not reorient) — there speed is a clean base x sprint, exactly what these
    // Week-1 tests are asserting.
    await page.evaluate(() => {
      const dy = -4000;
      window.__ug.camera.position.y += dy;
      window.__ug.controls.target.y += dy;
      window.__ug.camera.updateMatrixWorld(true);
    });
  });

  test('W moves forward, S moves back (symmetric)', async ({ page }) => {
    const start = await snapshotCamera(page);

    await holdKeys(page, ['w'], 400);
    const afterW = await snapshotCamera(page);
    const forwardDist = dist(start, afterW);
    expect(forwardDist).toBeGreaterThan(50); // 500 u/s × 0.4s = 200u nominal

    await holdKeys(page, ['s'], 400);
    const afterS = await snapshotCamera(page);
    const backDist = dist(afterW, afterS);
    // S should undo most of W — end position close to start
    const netDist = dist(start, afterS);
    console.log(`[controls] W=${forwardDist.toFixed(1)} S=${backDist.toFixed(1)} net=${netDist.toFixed(1)}`);
    expect(netDist).toBeLessThan(forwardDist * 0.4); // nearly cancel (allow dt jitter)
  });

  test('X key is inert (removed from control set)', async ({ page }) => {
    const start = await snapshotCamera(page);
    await holdKeys(page, ['x'], 400);
    const after = await snapshotCamera(page);
    const moved = dist(start, after);
    expect(moved).toBeLessThan(1); // no motion from X alone
  });

  test('Shift + W triples movement distance vs W alone', async ({ page }) => {
    const p0 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400);
    const p1 = await snapshotCamera(page);
    const normalDist = dist(p0, p1);

    await holdKeys(page, ['s'], 400); // return (approximately)
    await page.waitForTimeout(100);
    const p2 = await snapshotCamera(page);

    await holdKeys(page, ['shift', 'w'], 400);
    const p3 = await snapshotCamera(page);
    const sprintDist = dist(p2, p3);

    const ratio = sprintDist / normalDist;
    console.log(`[controls] normal=${normalDist.toFixed(1)} sprint=${sprintDist.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(2.3); // allow dt jitter either side of 3×
    expect(ratio).toBeLessThan(3.7);
  });

  test('HUD flight toggle latches and triples movement without Shift', async ({ page }) => {
    // Open HUD so button is visible (not strictly required since it's DOM-present)
    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });

    const btn = page.locator('#flightSprint');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    const p0 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400);
    const normalDist = dist(p0, await snapshotCamera(page));

    await holdKeys(page, ['s'], 400);
    await page.waitForTimeout(100);

    // Click toggle — should latch on.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const toggleState = await page.evaluate(() => window.__ug.fpsControls.flightToggle);
    expect(toggleState).toBe(true);

    const p1 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400); // no shift this time
    const toggledDist = dist(p1, await snapshotCamera(page));

    const ratio = toggledDist / normalDist;
    console.log(`[controls] toggle normal=${normalDist.toFixed(1)} toggled=${toggledDist.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(2.3);
    expect(ratio).toBeLessThan(3.7);

    // Click again — should release.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    const offState = await page.evaluate(() => window.__ug.fpsControls.flightToggle);
    expect(offState).toBe(false);
  });
});
