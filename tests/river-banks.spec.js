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
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

// Preserve the original BNG locations and bank offsets. These fixtures were
// recorded relative to E530000/N180400 before the scene origin was corrected.
const canonicalFixture = ({ x, z, ...rest }) => ({
  ...rest, x: x + 530000 - BNG_REF_E, z: z + BNG_REF_N - 180400,
});
const READY_POINT = canonicalFixture({ x: 8161, z: 2340 });

const WATER_PLANE_SCENE_Y = 10;    // riverLevelM (2m OD) * VE 5 (data plane)
const WATER_TOP_SCENE_Y = 12;      // rendered top: riverLevelM*VE + WATER_LIFT
const BANK_POINTS = [
  { name: 'CuttySark-L+10', x: 8186.1, z: 2489.4 },
  { name: 'CuttySark-R+10', x: 8135.9, z: 2190.6 },
  { name: 'GreenwichPierE-L+10', x: 8706.2, z: 2274.9 },
  { name: 'GreenwichPierE-R+10', x: 8539.8, z: 2041.1 },
  { name: 'GreenwichPierE-L+30', x: 8717.8, z: 2291.2 },
  { name: 'GreenwichPierE-R+30', x: 8528.2, z: 2024.8 },
  { name: 'O2north-L+10', x: 9243.6, z: 93.6 },
  { name: 'O2north-R+10', x: 9414.4, z: -253.6 },
].map(canonicalFixture);
// Mid-channel points (between the L/R bank pairs): must stay AT or BELOW the
// water plane — the carve (shelf at 1.85m OD or bathymetric bed) still fires.
const CHANNEL_POINTS = [
  { name: 'CuttySark-mid', x: 8161.0, z: 2340.0 },
  { name: 'GreenwichPierE-mid', x: 8623.0, z: 2158.0 },
  // Reclassified 24Sep26h (sprint 23Sep26w lane E). These two were recorded
  // as "+10m beyond halfW" of the 10Jul26f polyline, but the rendered water
  // ribbon (1500-sample Catmull-Rom cross-sections, c102d5a) already covered
  // both at 8e60ea2, where the old carve shelf (sceneY 10.75) hid it. D-036
  // (9990a5c) correctly lays the bathymetric bed (-12m OD, sceneY -60) under
  // every wet triangle, so they now read as river bed, not bank. They are
  // in-channel points and keep an assertion as such; the bank invariant is
  // guarded against the rendered waterline itself by the sweep below.
  { name: 'IoDWest-L+10', x: 6959, z: 1947.8 },
  { name: 'IoDWest-R+10', x: 7199, z: 1776.2 },
].map(canonicalFixture);

test('Thames banks sit at or above the water plane; channel stays carved', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    (point) => window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && window.__ug.getTerrainMeshSurfaceY(point) !== null,
    READY_POINT,
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

  // Every fixed bank fixture must actually lie outside the rendered water, or
  // it is not testing a bank at all (how the IoD West pair went stale).
  const outside = await page.evaluate(
    (points) => points.map((p) => window.__ug.getTerrainRiverBed().sample(p.x, p.z) === null),
    BANK_POINTS,
  );
  BANK_POINTS.forEach((p, i) => expect(outside[i], `${p.name} must lie outside the rendered water`).toBe(true));
});

// The swollen-river invariant measured against the RENDERED waterline: step
// 10m and 30m outward from every bank vertex of the water ribbon (1501
// sections x 2 sides) and require land at or above the water plane. Points
// that land back inside the ribbon (tight bends) are skipped, but only a
// handful may do so. Measured 24Sep26h: 0 offenders of 3000 at +10m.
test('land just beyond every rendered Thames bank sits at or above the water plane', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug?.scene?.getObjectByName('thamesRiver')
      && window.__ug.getTerrainRiverBed?.()
      && window.__ug.getTerrainMeshSurfaceY({ x: 0, z: 0 }) !== null,
    null, { timeout: 90000 },
  );
  const result = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, bed = u.getTerrainRiverBed();
    const mesh = u.scene.getObjectByName('thamesRiver');
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position, sections = pos.count / 4;
    const at = (i) => new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const out = {};
    for (const offset of [10, 30]) {
      let tested = 0, skipped = 0; const bad = [];
      for (let i = 0; i < sections; i++) for (const side of [0, 1]) {
        const a = at(i * 4 + side), b = at(i * 4 + 1 - side);
        const d = a.clone().sub(b).setY(0).normalize();
        const x = a.x + d.x * offset, z = a.z + d.z * offset;
        if (bed.sample(x, z) !== null) { skipped++; continue; }
        const y = u.getTerrainMeshSurfaceY({ x, z });
        if (y === null) { skipped++; continue; }
        tested++;
        if (y < 9.5) bad.push({ section: i, side, x: Math.round(x), z: Math.round(z), y: +y.toFixed(2) });
      }
      out[offset] = { sections, tested, skipped, bad };
    }
    return out;
  });
  for (const offset of [10, 30]) {
    const r = result[offset];
    expect(r.sections, 'ribbon section count').toBe(1501);
    expect(r.skipped, `+${offset}m points skipped`).toBeLessThanOrEqual(10);
    expect(r.bad, `+${offset}m beyond the rendered bank must not sit below the water plane`).toEqual([]);
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
].map(([name, x, z, axis]) => {
  const point = canonicalFixture({ x, z });
  return [name, point.x, point.z, axis];
});

test('Thames in-channel terrain stays below the rendered water surface', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    (point) => window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && typeof window.__ug.isInThames === 'function'
      && window.__ug.getTerrainMeshSurfaceY(point) !== null,
    READY_POINT,
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
