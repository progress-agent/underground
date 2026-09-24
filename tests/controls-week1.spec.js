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

// Hold a set of movement keys and return the SIMULATED time they moved the
// camera for. Sprint 24Sep26h (lane H): these holds used to be a wall-clock
// waitForTimeout(400), but since 1429863 (11Sep26, "Bound camera recovery
// after stalls") tick() feeds updateFpsControls a delta clamped to 50ms, so a
// frame gap during loading (the terrain build alone blocks the main thread for
// about 2.7s just after ?skip=1 hands over) moves the camera 50ms, not the gap.
// A 400ms hold that met a stall measured 26 units where 200 were expected, and
// the Shift ratio compared a stalled hold with a clean one (ratio 47). That is
// the product working as designed, so the test was stale, not the controls.
//
// Now the keys go in and out inside rAF callbacks, which run after the app's
// tick in the same frame (tick registered its rAF first), and the hold sums
// exactly the delta each of those ticks used: min(frame delta, 50ms). Every
// distance below is divided by that, so the assertions compare speeds.
async function holdKeys(page, keys, frames = 24) {
  const simS = await page.evaluate(({ ks, frames }) => new Promise((resolve) => {
    const fc = window.__ug.fpsControls;
    let n = 0, last = 0, sim = 0;
    const step = (t) => {
      if (n === 0) { for (const k of ks) fc.keys.add(k); }
      else sim += Math.min((t - last) / 1000, 0.05); // the delta this frame's tick moved with
      last = t;
      if (n++ >= frames) { for (const k of ks) fc.keys.delete(k); resolve(sim); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { ks: keys, frames });
  // Let one more tick settle with keys released.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return simS;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

test.describe('Week-1 desktop keyboard controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?skip=1');
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

    const simW = await holdKeys(page, ['w']);
    const afterW = await snapshotCamera(page);
    const forwardDist = dist(start, afterW);
    // Base speed (500 u/s) x substrate factor; below ground there is no
    // altitude scaling. Well clear of any stall now that time is simulated.
    const speed = await page.evaluate(() => window.__ug.fpsControls.lastSpeed);
    expect(forwardDist / simW).toBeGreaterThan(50);
    expect(Math.abs(forwardDist / simW - speed) / speed).toBeLessThan(0.02);

    const simS = await holdKeys(page, ['s']);
    const afterS = await snapshotCamera(page);
    const backDist = dist(afterW, afterS);
    // S moves back along the same line at the same speed: the rates match and
    // what remains after cancelling the (simulated) time difference is tiny.
    const netDist = dist(start, afterS);
    console.log(`[controls] W=${forwardDist.toFixed(1)}/${simW.toFixed(3)}s S=${backDist.toFixed(1)}/${simS.toFixed(3)}s net=${netDist.toFixed(1)}`);
    expect(Math.abs(forwardDist / simW - backDist / simS) / (forwardDist / simW)).toBeLessThan(0.02);
    expect(netDist).toBeLessThan(Math.abs(simW - simS) * speed + forwardDist * 0.02);
  });

  test('X key is inert (removed from control set)', async ({ page }) => {
    const start = await snapshotCamera(page);
    await holdKeys(page, ['x']);
    const after = await snapshotCamera(page);
    const moved = dist(start, after);
    expect(moved).toBeLessThan(1); // no motion from X alone
  });

  test('Shift + W triples movement distance vs W alone', async ({ page }) => {
    const p0 = await snapshotCamera(page);
    const simN = await holdKeys(page, ['w']);
    const p1 = await snapshotCamera(page);
    const normalDist = dist(p0, p1) / simN; // units per simulated second

    await holdKeys(page, ['s']); // return (approximately)
    const p2 = await snapshotCamera(page);

    const simF = await holdKeys(page, ['shift', 'w']);
    const p3 = await snapshotCamera(page);
    const sprintDist = dist(p2, p3) / simF;

    const ratio = sprintDist / normalDist;
    console.log(`[controls] normal=${normalDist.toFixed(1)} sprint=${sprintDist.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    // Speeds per simulated second leave no dt jitter to allow for: measured
    // exactly 500 and 1500 (3.00) on every run, so the old 2.3-3.7 band is
    // tightened, not loosened.
    expect(ratio).toBeGreaterThan(2.9);
    expect(ratio).toBeLessThan(3.1);
  });

  test('HUD flight toggle latches and triples movement without Shift', async ({ page }) => {
    // Open HUD so button is visible (not strictly required since it's DOM-present)
    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });

    const btn = page.locator('#flightSprint');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    const p0 = await snapshotCamera(page);
    const simN = await holdKeys(page, ['w']);
    const normalDist = dist(p0, await snapshotCamera(page)) / simN;

    await holdKeys(page, ['s']);

    // Click toggle — should latch on.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const toggleState = await page.evaluate(() => window.__ug.fpsControls.flightToggle);
    expect(toggleState).toBe(true);

    const p1 = await snapshotCamera(page);
    const simT = await holdKeys(page, ['w']); // no shift this time
    const toggledDist = dist(p1, await snapshotCamera(page)) / simT;

    const ratio = toggledDist / normalDist;
    console.log(`[controls] toggle normal=${normalDist.toFixed(1)} toggled=${toggledDist.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(2.9);
    expect(ratio).toBeLessThan(3.1);

    // Click again — should release.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    const offState = await page.evaluate(() => window.__ug.fpsControls.flightToggle);
    expect(offState).toBe(false);
  });
});
