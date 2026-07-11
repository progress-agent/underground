// Thames waterline regression guards.
//
// Swollen-river (10Jul26f): land just beyond the waterline must never sit
// metres below the water surface — bilinear smear from bed vertices (-12m OD
// at Greenwich) once put banks at -6 to -9m OD, exposing the water volume's
// side walls ("swollen/aqueduct" read). Bank points are precomputed
// perpendicular offsets (+10m/+30m beyond halfW) from thames.json waypoints
// at the worst-affected Greenwich reach landmarks.
//
// Water-reading-low (11Jul26s): the inverse artefact — terrain INSIDE the
// channel standing proud of the RENDERED water top (riverLevelM*VE +
// WATER_LIFT = sceneY 12), which reads as mudflat bands / a drained river.
// The carve's edge shelf now extends one cell past the waterline and sits
// just below the rendered top (sceneY 10.75), so in-river terrain must stay
// below the rendered surface everywhere.

import { test, expect } from '@playwright/test';

const WATER_PLANE_SCENE_Y = 10;    // riverLevelM (2m OD) * VE 5 (data plane)
const WATER_TOP_SCENE_Y = 12;      // rendered top: riverLevelM*VE + WATER_LIFT
const BANK_POINTS = [
  { name: 'CuttySark-L+10', x: 8186.1, z: 2489.4 },
  { name: 'CuttySark-R+10', x: 8135.9, z: 2190.6 },
  { name: 'IoDWest-L+10', x: 6959, z: 1947.8 },
  { name: 'IoDWest-R+10', x: 7199, z: 1776.2 },
  { name: 'GreenwichPierE-L+10', x: 8706.2, z: 2274.9 },
  { name: 'GreenwichPierE-R+10', x: 8539.8, z: 2041.1 },
  { name: 'GreenwichPierE-L+30', x: 8717.8, z: 2291.2 },
  { name: 'GreenwichPierE-R+30', x: 8528.2, z: 2024.8 },
  { name: 'O2north-L+10', x: 9243.6, z: 93.6 },
  { name: 'O2north-R+10', x: 9414.4, z: -253.6 },
];
// Mid-channel points (between the L/R bank pairs): must stay AT or BELOW the
// water plane — the carve (shelf at 1.85m OD or bathymetric bed) still fires.
const CHANNEL_POINTS = [
  { name: 'CuttySark-mid', x: 8161.0, z: 2340.0 },
  { name: 'GreenwichPierE-mid', x: 8623.0, z: 2158.0 },
];

test('Thames banks sit at or above the water plane; channel stays carved', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null,
    { timeout: 90000 },
  );

  const sample = (pts) => page.evaluate(
    (points) => points.map((p) => ({
      name: p.name,
      y: window.__ug.getTerrainMeshSurfaceY({ x: p.x, z: p.z }),
    })),
    pts,
  );

  const banks = await sample(BANK_POINTS);
  for (const b of banks) {
    expect(b.y, `${b.name} sceneY`).not.toBeNull();
    // Small epsilon below the plane tolerated (bilinear mix with the shelf at
    // 9.25); pre-fix values here were -30 to -45.
    expect(b.y, `${b.name} must not sit below the water plane`).toBeGreaterThanOrEqual(9.5);
  }

  const channel = await sample(CHANNEL_POINTS);
  for (const c of channel) {
    expect(c.y, `${c.name} sceneY`).not.toBeNull();
    // Shelf sits at sceneY 10.75 (just below the rendered top at 12) since
    // the 11Jul26s re-derivation — carved means "below the rendered surface",
    // not "below the 2m OD data plane".
    expect(c.y, `${c.name} must remain carved below the rendered water top`).toBeLessThanOrEqual(WATER_TOP_SCENE_Y - 1);
  }
});

// Water-reading-low guard: transects across central reaches — every terrain
// sample INSIDE the river mask must sit below the rendered water top. Before
// the 11Jul26s shelf re-derivation, 30-70m bands inside the channel stood at
// up to 3m OD (sceneY 15), reading as mudflats beside a drained river.
const TRANSECTS = [
  // [name, centre x, centre z, axis] — scene coords, ±1200m scan
  ['putney', -6130, 4530, 'NS'],
  ['vauxhall', 70, 2320, 'NS'],
  ['city', 2500, -20, 'NS'],
  ['tower', 3655, 260, 'NS'],
];

test('Thames in-channel terrain stays below the rendered water surface', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && typeof window.__ug.isInThames === 'function'
      && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null,
    { timeout: 90000 },
  );

  const offenders = await page.evaluate((transects) => {
    const ug = window.__ug;
    const bad = [];
    for (const [name, cx, cz, axis] of transects) {
      for (let d = -1200; d <= 1200; d += 8) {
        const x = axis === 'NS' ? cx : cx + d;
        const z = axis === 'NS' ? cz + d : cz;
        if (!ug.isInThames(x, z)) continue;
        const y = ug.getTerrainMeshSurfaceY({ x, z });
        if (y !== null && y > 11.5) bad.push({ name, d, y: +y.toFixed(2) });
      }
    }
    return bad;
  }, TRANSECTS);

  expect(offenders, `in-river terrain above rendered water top: ${JSON.stringify(offenders.slice(0, 12))}`).toEqual([]);
});
