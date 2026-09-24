// submerged.spec.js — Thames traversable water volume (12Jul26u).
//
// Coverage:
//   1. Shared predicate: isSubmergedAt true inside the water column, false
//      above the surface and outside the corridor.
//   2. Submerged regime activates INSIDE: substrate reads WATER (fixing the
//      previously inverted predicate that read AIR in the water column),
//      fog collapses to the short clear-water band (D-036), interior shell renders.
//   3. Regime does NOT activate outside: fog released, substrate AIR above
//      the surface. The opaque bank shell still draws above ground, since
//      without it the banks are a translucent window onto the underground
//      (23Sep26w); it hides only for an underground camera outside the river.
//   4. Material-state regression: the translucent DoubleSide water material
//      is untouched and the shell stays BackSide, opaque and non-raycastable.
//
// Mid-channel probe points come from river-banks.spec.js (known in-channel
// coordinates at the Cutty Sark / Greenwich Pier reaches).

import { test, expect } from '@playwright/test';

const MID = { x: 8161, z: 2340 };        // Cutty Sark reach, mid-channel
const WATER_TOP_SCENE_Y = 12;            // WATER_LEVEL_M*VE + WATER_LIFT

async function gotoAndWait(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => !!(window.__ug
      && window.__ug.thamesInteriorShell
      && window.__ug.readout
      && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null),
    null, { timeout: 90000 },
  );
}

function teleport(page, x, y, z) {
  return page.evaluate(([px, py, pz]) => {
    window.__ug.camera.position.set(px, py, pz);
    window.__ug.controls.target.set(px, py, pz + 200);
  }, [x, y, z]);
}

test('isSubmergedAt: true in the water column, false above surface and outside corridor', async ({ page }) => {
  await gotoAndWait(page);
  const r = await page.evaluate((mid) => {
    const ug = window.__ug;
    return {
      topY: ug.WATER_TOP_Y,
      inColumn: ug.isSubmergedAt(mid.x, 6, mid.z),          // between bed and top
      justBelowTop: ug.isSubmergedAt(mid.x, 11.9, mid.z),
      aboveTop: ug.isSubmergedAt(mid.x, 12.1, mid.z),
      highAbove: ug.isSubmergedAt(mid.x, 500, mid.z),
      trafalgar: ug.isSubmergedAt(0, 6, 0),                 // low Y but not in Thames
    };
  }, MID);
  expect(r.topY).toBe(WATER_TOP_SCENE_Y);
  expect(r.inColumn).toBe(true);
  expect(r.justBelowTop).toBe(true);
  expect(r.aboveTop).toBe(false);
  expect(r.highAbove).toBe(false);
  expect(r.trafalgar).toBe(false);
});

test('inside the volume: substrate WATER, short clear-water fog, interior shell visible', async ({ page }) => {
  await gotoAndWait(page);
  await teleport(page, MID.x, 6, MID.z);

  // Substrate readout — the water column previously read AIR (inverted predicate).
  await page.waitForFunction(
    () => document.getElementById('ug-readout')?.dataset.substrate === 'WATER',
    null, { timeout: 3000 },
  );

  const state = await page.evaluate(() => {
    const ug = window.__ug;
    return {
      submergedBlend: ug.submergedBlend,
      shellVisible: ug.thamesInteriorShell.visible,
      fogFar: ug.scene.fog.far,
      fogNear: ug.scene.fog.near,
    };
  });
  expect(state.submergedBlend).toBeGreaterThan(0.99); // 6 units below top, ramp is 2
  expect(state.shellVisible).toBe(true);
  // Enclosed water: tunnels/infrastructure emerge only within the fog band.
  // D-036 (9990a5c, Jordan 13Sep26u: "much clearer water") deliberately
  // retuned the regime from murk (near 10 / far 250) to clearer green water
  // (ENV_CONFIG.waterFogNear 35 / waterFogFar 1100); the former <=400 bound
  // encoded the superseded 250 tuning. Pin the accepted value exactly (fully
  // submerged, so the lerp lands on it) and keep it far tighter than the
  // 25000 surface/clay regime so the river stays a distinct environment.
  expect(state.fogFar).toBeCloseTo(1100, 3);
  expect(state.fogFar).toBeLessThan(25000 / 10);
  expect(state.fogNear).toBeLessThanOrEqual(50);
});

test('outside the volume: regime off, bank shell drawn, substrate AIR', async ({ page }) => {
  await gotoAndWait(page);
  // 500 scene units above the same mid-channel point — clearly exterior.
  await teleport(page, MID.x, 500, MID.z);

  await page.waitForFunction(
    () => document.getElementById('ug-readout')?.dataset.substrate === 'AIR',
    null, { timeout: 3000 },
  );

  const state = await page.evaluate(() => {
    const ug = window.__ug;
    return {
      submergedBlend: ug.submergedBlend,
      shellVisible: ug.thamesInteriorShell.visible,
      fogFar: ug.scene.fog.far,
    };
  });
  expect(state.submergedBlend).toBe(0);
  expect(state.shellVisible).toBe(true); // opaque banks, not a window underground
  expect(state.fogFar).toBeGreaterThan(1000); // surface regime fog released
});

test('underground beside the river: shell hidden, river body stays translucent', async ({ page }) => {
  await gotoAndWait(page);
  // Step off the channel until the point is dry land, then drop 30m below it.
  const probe = await page.evaluate((mid) => {
    const ug = window.__ug;
    for (let d = 200; d <= 2000; d += 100) {
      const x = mid.x, z = mid.z + d, surface = ug.getTerrainMeshSurfaceY({ x, z });
      if (surface !== null && !ug.isSubmergedAt(x, surface - 150, z)) return { x, y: surface - 150, z };
    }
    return null;
  }, MID);
  expect(probe).not.toBeNull();
  await teleport(page, probe.x, probe.y, probe.z);
  await page.waitForFunction(
    () => ['CLAY', 'CHALK'].includes(document.getElementById('ug-readout')?.dataset.substrate),
    null, { timeout: 3000 },
  );
  expect(await page.evaluate(() => window.__ug.thamesInteriorShell.visible)).toBe(false);
});

test('material regression: water material untouched, shell BackSide, opaque, non-raycastable', async ({ page }) => {
  await gotoAndWait(page);
  await teleport(page, MID.x, 500, MID.z);
  await page.waitForFunction(() => window.__ug.submergedBlend === 0, null, { timeout: 3000 });

  const state = await page.evaluate(() => {
    const ug = window.__ug;
    const water = ug.thamesMesh.material;
    const shell = ug.thamesInteriorShell;
    return {
      // Translucent volume material — must be byte-identical to pre-shell build.
      waterTransparent: water.transparent,
      waterOpacity: water.opacity,
      waterDoubleSide: water.side === 2,   // THREE.DoubleSide
      waterDepthWrite: water.depthWrite,
      // Shell: BackSide + opaque, so it culls the near bank from the land.
      shellBackSide: shell.material.side === 1, // THREE.BackSide
      shellOpaque: shell.material.transparent === false,
      shellDepthWrite: shell.material.depthWrite,
      // Shell must never intercept hover raycasts.
      shellRaycastDisabled: shell.raycast.toString().replace(/\s/g, '').includes('{}'),
    };
  });
  expect(state.waterTransparent).toBe(true);
  expect(state.waterOpacity).toBeCloseTo(0.58, 2);
  expect(state.waterDoubleSide).toBe(true);
  expect(state.waterDepthWrite).toBe(false);
  expect(state.shellBackSide).toBe(true);
  expect(state.shellOpaque).toBe(true);
  expect(state.shellDepthWrite).toBe(true);
  expect(state.shellRaycastDisabled).toBe(true);
});
