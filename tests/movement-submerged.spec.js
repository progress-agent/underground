// movement-submerged.spec.js — submerged speed regime + vertical parity (12Jul26u).
//
// Coverage:
//   1. Inside the Thames water volume, movement runs at the speed just above
//      the surface at the same point (D-037, 23Sep26w, superseding D-020 §3's
//      constant underground base). Jordan: underwater motion "should be the
//      same as anywhere else". Measured before the change at this point:
//      500 m/s submerged vs 150 m/s just above (3.33x). The old assertion here
//      (130 < d < 400 for a 400ms hold, i.e. constant base) pinned the very
//      behaviour Jordan reported as the bug, so it is replaced, not loosened.
//      tests/water-speed-parity.spec.js measures the parity directly.
//   2. Vertical (Q/E) displacement equals horizontal (WASD) for equal holds —
//      on-screen scene-unit parity (Jordan-locked; the old 2.5× real-metre
//      compensation is gone). Asserted both submerged and underground.
//
// Mid-channel probe point from river-banks.spec.js (Cutty Sark reach). Key
// injection pattern from controls-week1.spec.js (drive fpsControls.keys
// directly — deterministic, no focus/keyup races).

import { test, expect } from '@playwright/test';

const MID = { x: 8161, z: 2340 };  // Cutty Sark reach, mid-channel
const SUB_Y = 10;                   // in the water column (top = 12)

async function waitReady(page) {
  await page.waitForFunction(
    () => !!(window.__ug
      && window.__ug.fpsControls
      && window.__ug.isSubmergedAt
      && window.__ug.intro && !window.__ug.intro.isRunning()
      && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null),
    null, { timeout: 90000 },
  );
}

function teleport(page, x, y, z) {
  return page.evaluate(([px, py, pz]) => {
    window.__ug.camera.position.set(px, py, pz);
    window.__ug.controls.target.set(px, py, pz + 200);
    window.__ug.camera.updateMatrixWorld(true);
  }, [x, y, z]);
}

async function snapshotCamera(page) {
  return page.evaluate(() => {
    const c = window.__ug.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
}

async function holdKeys(page, keys, durationMs) {
  await page.evaluate((ks) => {
    for (const k of ks) window.__ug.fpsControls.keys.add(k);
  }, keys);
  await page.waitForTimeout(durationMs);
  await page.evaluate((ks) => {
    for (const k of ks) window.__ug.fpsControls.keys.delete(k);
  }, keys);
  await page.waitForTimeout(80); // let one tick settle with keys released
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

test.describe('Submerged movement regime + vertical parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?skip=1');
    await waitReady(page);
  });

  test('submerged: W-hold moves at the just-above-surface speed, not the constant base', async ({ page }) => {
    await teleport(page, MID.x, SUB_Y, MID.z);
    await page.waitForFunction(
      () => window.__ug.isSubmergedAt(
        window.__ug.camera.position.x,
        window.__ug.camera.position.y,
        window.__ug.camera.position.z,
      ),
      null, { timeout: 3000 },
    );

    const p0 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400);
    const p1 = await snapshotCamera(page);
    const d = dist(p0, p1);
    const submergedSpeed = await page.evaluate(() => window.__ug.fpsControls.lastSpeed);

    // Just above the water at the same point.
    await teleport(page, MID.x, 12.5, MID.z);
    await holdKeys(page, ['w'], 120);
    const aboveSpeed = await page.evaluate(() => window.__ug.fpsControls.lastSpeed);

    // Nominal: 150 u/s x 0.4 s = 60u (0.3x crawl over the 14m-deep reach).
    // The superseded constant base would give ~200u. Bounds separate the two.
    console.log(`[movement-submerged] W-hold distance=${d.toFixed(1)} speed=${submergedSpeed} above=${aboveSpeed}`);
    expect(submergedSpeed).toBeCloseTo(aboveSpeed, 6);
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(110);
  });

  test('submerged: vertical (Q) displacement matches horizontal (W) for equal holds', async ({ page }) => {
    await teleport(page, MID.x, SUB_Y, MID.z);

    const p0 = await snapshotCamera(page);
    await holdKeys(page, ['q'], 400); // down — stays inside the Thames footprint
    const p1 = await snapshotCamera(page);
    const dV = Math.abs(p1.y - p0.y);

    await teleport(page, MID.x, SUB_Y, MID.z);
    const p2 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400);
    const p3 = await snapshotCamera(page);
    const dH = dist(p2, p3);

    const ratio = dV / dH;
    console.log(`[movement-submerged] dV=${dV.toFixed(1)} dH=${dH.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    // On-screen parity: ratio ~1. The old displacement.y *= 2.5 gave ~2.5.
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });

  test('underground: vertical (E) displacement matches horizontal (W) for equal holds', async ({ page }) => {
    // Same constant-base drop as controls-week1: below ground the D-002 regime
    // is clean base x sprint, so parity is measured without altitude scaling.
    await page.evaluate(() => {
      const dy = -4000;
      window.__ug.camera.position.y += dy;
      window.__ug.controls.target.y += dy;
      window.__ug.camera.updateMatrixWorld(true);
    });

    const p0 = await snapshotCamera(page);
    await holdKeys(page, ['e'], 400); // up — still ~3900 below the surface
    const p1 = await snapshotCamera(page);
    const dV = Math.abs(p1.y - p0.y);

    const p2 = await snapshotCamera(page);
    await holdKeys(page, ['w'], 400);
    const p3 = await snapshotCamera(page);
    const dH = dist(p2, p3);

    const ratio = dV / dH;
    console.log(`[movement-submerged] underground dV=${dV.toFixed(1)} dH=${dH.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});
