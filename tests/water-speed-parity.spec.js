// water-speed-parity.spec.js: D-037 water speed rule (sprint 23Sep26w, lane A1).
//
// Jordan: "The motion speed seems to be doubled underwater? It should be the
// same as anywhere else." Rule: underwater speed equals the speed just above
// the surface at the same point.
//
// Measured 24Sep26h at this fixed Thames point, W held along the channel,
// controller velocity from rAF timestamps (not fps):
//   before: submerged 500 m/s (y=10 and y=-24) vs 150 m/s just above (y=12.5), 3.33x
//   after:  submerged 150 m/s vs 150 m/s just above, 1.00x
// Horizontal scene units are metres, so these are metres per second.

import { test, expect } from '@playwright/test';

const MID = { x: 8161, z: 2340 }; // Cutty Sark reach, mid-channel (bed -12m, top 2.4m)

test('underwater speed equals the speed just above the surface at the same point', async ({ page }) => {
  await page.goto('/?skip=1');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.fpsControls && window.__ug.intro
    && !window.__ug.intro.isRunning() && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null
    && window.__ug.isSubmergedAt(8161, 10, 2340)), null, { timeout: 90000 });

  const out = await page.evaluate(async (MID) => {
    const ug = window.__ug;
    // A heading that stays inside the channel for 400m, so no bank interferes.
    let hd = null;
    for (let i = 0; i < 64 && hd === null; i++) {
      const a = i / 64 * Math.PI * 2;
      let ok = true;
      for (let r = 25; r <= 400 && ok; r += 25) ok = ug.isSubmergedAt(MID.x + Math.sin(a) * r, 10, MID.z + Math.cos(a) * r);
      if (ok) hd = a;
    }
    const frame = () => new Promise(r => requestAnimationFrame(r));
    async function measure(y) {
      const tx = MID.x + Math.sin(hd) * 200, tz = MID.z + Math.cos(hd) * 200;
      ug.camera.position.set(MID.x, y, MID.z);
      ug.controls.target.set(tx, y, tz);
      ug.camera.lookAt(tx, y, tz);
      ug.camera.updateMatrixWorld(true);
      await frame(); await frame();
      const submerged = ug.isSubmergedAt(MID.x, y, MID.z);
      ug.fpsControls.keys.add('w');
      let last = null, prev = null, dist = 0, time = 0, n = 0, speeds = [];
      await new Promise(resolve => {
        function f(t) {
          const p = ug.camera.position;
          if (last !== null) {
            if (n > 2) { dist += Math.hypot(p.x - prev.x, p.z - prev.z); time += Math.min((t - last) / 1000, 0.05); speeds.push(ug.fpsControls.lastSpeed); }
            n++;
          }
          last = t; prev = { x: p.x, z: p.z };
          if (n < 16) requestAnimationFrame(f); else resolve();
        }
        requestAnimationFrame(f);
      });
      ug.fpsControls.keys.delete('w');
      await frame(); await frame();
      return { y, submerged, mps: dist / time, controller: speeds.at(-1) };
    }
    return { heading: hd, under: await measure(10), deep: await measure(-24), above: await measure(12.5) };
  }, MID);
  console.log(`[water-speed] ${JSON.stringify(out)}`);

  expect(out.heading).not.toBeNull();
  expect(out.under.submerged).toBe(true);
  expect(out.deep.submerged).toBe(true);
  expect(out.above.submerged).toBe(false);
  // Parity within 2% (frame-timing noise only; the controller speeds are exact).
  expect(out.under.mps / out.above.mps).toBeGreaterThan(0.98);
  expect(out.under.mps / out.above.mps).toBeLessThan(1.02);
  expect(out.deep.mps / out.above.mps).toBeGreaterThan(0.98);
  expect(out.deep.mps / out.above.mps).toBeLessThan(1.02);
  expect(out.under.controller).toBeCloseTo(out.above.controller, 6);
  // And never the old constant base (500): that was the 3.33x bug.
  expect(out.under.mps).toBeLessThan(300);
});
