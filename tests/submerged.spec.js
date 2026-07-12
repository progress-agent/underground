// submerged.spec.js — Thames traversable water volume (12Jul26u).
//
// Coverage:
//   1. Shared predicate: isSubmergedAt true inside the water column, false
//      above the surface and outside the corridor.
//   2. Submerged regime activates INSIDE: substrate reads WATER (fixing the
//      previously inverted predicate that read AIR in the water column),
//      fog collapses to the short murky band, interior shell renders.
//   3. Regime does NOT activate outside: shell hidden, fog released,
//      substrate AIR above the surface.
//   4. Outside appearance regression (material-state assertions): the
//      translucent DoubleSide water material is untouched and the opaque
//      interior shell is invisible for an exterior camera — the structural
//      guarantee that the outside view is pixel-identical.
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

test('inside the volume: substrate WATER, murky short fog, interior shell visible', async ({ page }) => {
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
  // Short murk: tunnels/infrastructure emerge only within the fog band.
  expect(state.fogFar).toBeLessThanOrEqual(400);
  expect(state.fogNear).toBeLessThanOrEqual(50);
});

test('outside the volume: regime off, shell hidden, substrate AIR', async ({ page }) => {
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
  expect(state.shellVisible).toBe(false);
  expect(state.fogFar).toBeGreaterThan(1000); // surface regime fog released
});

test('outside appearance regression: water material untouched, shell structurally non-rendering', async ({ page }) => {
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
      // Shell: invisible outside + BackSide + opaque — the pixel-identity guarantee.
      shellVisible: shell.visible,
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
  expect(state.shellVisible).toBe(false);
  expect(state.shellBackSide).toBe(true);
  expect(state.shellOpaque).toBe(true);
  expect(state.shellDepthWrite).toBe(true);
  expect(state.shellRaycastDisabled).toBe(true);
});
