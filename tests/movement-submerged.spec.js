// movement-submerged.spec.js — submerged speed regime + vertical parity (12Jul26u).
//
// Coverage:
//   1. Inside the Thames water volume, movement runs at the CONSTANT underground
//      base rate. Before the fix, the D-002 altitude clamp fired against the
//      carved bed (camera "above ground" at tiny altitude) and pinned speed to
//      the 0.3× crawl.
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

  test('submerged: W-hold moves at constant base, not the 0.3x altitude crawl', async ({ page }) => {
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

    // Nominal: 500 u/s x 0.4 s = 200u at constant base. The pre-fix altitude
    // clamp (0.3x against the carved bed) would give ~60u. Bounds separate the
    // two regimes with wide dt-jitter margin.
    console.log(`[movement-submerged] W-hold distance=${d.toFixed(1)}`);
    expect(d).toBeGreaterThan(130);
    expect(d).toBeLessThan(400);
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
