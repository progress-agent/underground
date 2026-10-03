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

// Sprint 02Oct26f (Lane F): the parity tests compared a vertical and a horizontal wall-clock key hold
// (`holdKeys`: waitForTimeout(400) between two page.evaluate round trips), so any frame stall inside
// one hold and not the other moved the ratio (underground :126 failed under contention at 1.5 against a
// 1.4 bound). Both speeds are now measured on the app's OWN frame clock. Inside a requestAnimationFrame
// callback (it runs after the app's tick in the same frame; the tick integrates dt from this very
// timestamp, src/main.js tick(frameTime)) the keys are added and the position and timestamp recorded;
// after `frames` more frames (or earlier once the travel passes `maxTravel` units, so a submerged probe
// stays inside the channel) the keys are removed in another such callback. The time a frame contributes
// is the time the app integrates for it: the frame delta, capped at 50 ms exactly as the tick caps it for
// interactive motion (updateFpsControls(Math.min(dt, 0.05)); a first version that divided by the whole
// timestamp difference read 86 and 82 u/s against 150 after one stalled frame). So a stalled frame
// lengthens neither the distance nor the time, and speed = distance / time is the speed the mode ran at.
// The bounds below are unchanged.
const FRAME_CAP_MS = 50;
async function measureRate(page, keys, { frames = 12, maxTravel = 30 } = {}) {
  return page.evaluate(([ks, frames, maxTravel, cap]) => new Promise((resolve) => {
    const c = window.__ug.camera, keysSet = window.__ug.fpsControls.keys;
    let start = null, last = 0, n = 0, integrated = 0;
    const step = (t) => {
      if (!start) {
        for (const k of ks) keysSet.add(k);
        start = { x: c.position.x, y: c.position.y, z: c.position.z }; last = t;
      } else {
        n++; integrated += Math.min(t - last, cap); last = t;
        const d = Math.hypot(c.position.x - start.x, c.position.y - start.y, c.position.z - start.z);
        if (n >= frames || d >= maxTravel) {
          for (const k of ks) keysSet.delete(k);
          resolve({ distance: d, vertical: Math.abs(c.position.y - start.y), seconds: integrated / 1000, frames: n });
          return;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), [keys, frames, maxTravel, FRAME_CAP_MS]).then(async (r) => { await page.waitForTimeout(80); return { ...r, speed: r.distance / r.seconds }; });
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

    const v = await measureRate(page, ['q']); // down — stays inside the Thames footprint (stops at 30 units)
    await teleport(page, MID.x, SUB_Y, MID.z);
    const h = await measureRate(page, ['w']);
    const dV = v.speed, dH = h.speed;   // speeds on the app's frame clock, scene units per second

    const ratio = dV / dH;
    console.log(`[movement-submerged] vertical=${dV.toFixed(1)} u/s (${v.frames} frames) horizontal=${dH.toFixed(1)} u/s (${h.frames} frames) ratio=${ratio.toFixed(2)}`);
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

    const v = await measureRate(page, ['e'], { maxTravel: 150 }); // up — still ~3900 below the surface
    const h = await measureRate(page, ['w'], { maxTravel: 150 });
    const dV = v.speed, dH = h.speed;   // speeds on the app's frame clock, scene units per second

    const ratio = dV / dH;
    console.log(`[movement-submerged] underground vertical=${dV.toFixed(1)} u/s (${v.frames} frames) horizontal=${dH.toFixed(1)} u/s (${h.frames} frames) ratio=${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});
