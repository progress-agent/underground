// West-of-Kew river regression guards (12Jul26u).
//
// The "patchy/broken ribbon" west of Kew (Jordan, 11Jul26s) had two causes:
//   1. thames.json carried v1 fallback widths west of Kew (42-58m vs the real
//      ~60-160m; the DEM water mask could not resolve the narrow upper river).
//      Fixed by remeasuring widths from OSM water polygons
//      (Working/water-volume-12Jul26u/build-thames-widths-west.mjs).
//   2. thames.js SAMPLES=600 gave 159m cross-section spacing vs 250m data
//      spacing; the spline cut sharp corners by up to 27m — more than the old
//      21m half-width — so the volume missed its own centreline at 7 bends.
//      Fixed by SAMPLES=1500 (~64m spacing).
//
// Guard 1: west transects — every terrain sample inside the river mask must
// stay below the rendered water top (same contract as river-banks.spec.js,
// applied to the upper river).
// Guard 2: water continuity — a downward raycast at EVERY thames.json
// waypoint must hit the thamesRiver mesh. Any miss means the volume no longer
// covers its own centreline (corner-cutting regression or width collapse).

import { test, expect } from '@playwright/test';

// Scene coords (x = e-530000, z = -(n-180400)) at west-of-Kew waypoints:
// Walton, Sunbury, Kingston, Teddington, Richmond, Syon/Old Deer Park, pre-Kew.
const WEST_TRANSECTS = [
  ['walton', -26413, 9157],      // idx 25  e503587 n171243
  ['sunbury', -25090, 11842],    // idx 40  e504910 n168558
  ['kingston', -17977, 11330],   // idx 90  e512023 n169070
  ['teddington', -14714, 11873], // idx 105 e515286 n168527
  ['richmond', -13867, 7884],    // idx 140 e516133 n172516
  ['syon', -13166, 4559],        // idx 160 e516834 n175841
  ['pre-kew', -11082, 2574],     // idx 172 e518918 n177826
];

test('west-of-Kew in-channel terrain stays below the rendered water surface', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && typeof window.__ug.isInThames === 'function'
      && window.__ug.getTerrainMeshSurfaceY({ x: 8161, z: 2340 }) !== null,
    { timeout: 90000 },
  );

  const result = await page.evaluate((transects) => {
    const ug = window.__ug;
    const bad = [];
    let inRiverSamples = 0;
    for (const [name, cx, cz] of transects) {
      // scan a square neighbourhood cross: both axes, ±400m — the upper river
      // meanders so a single fixed axis can run parallel to the channel.
      for (const axis of ['NS', 'EW']) {
        for (let d = -400; d <= 400; d += 6) {
          const x = axis === 'NS' ? cx : cx + d;
          const z = axis === 'NS' ? cz + d : cz;
          if (!ug.isInThames(x, z)) continue;
          inRiverSamples++;
          const y = ug.getTerrainMeshSurfaceY({ x, z });
          if (y !== null && y > 11.5) bad.push({ name, axis, d, y: +y.toFixed(2) });
        }
      }
    }
    return { bad, inRiverSamples };
  }, WEST_TRANSECTS);

  // The transect centres are on-channel waypoints — the mask must register a
  // meaningful corridor at each (guards against the mask collapsing to zero).
  expect(result.inRiverSamples, 'west transects found almost no in-river samples').toBeGreaterThan(50);
  expect(result.bad, `in-river terrain above rendered water top: ${JSON.stringify(result.bad.slice(0, 12))}`).toEqual([]);
});

test('Thames volume covers every centreline waypoint (water continuity)', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => !!(window.__ug && window.__ug.scene),
    { timeout: 90000 },
  );
  // let the async data/volume build settle
  await page.waitForFunction(() => {
    let water = null;
    window.__ug.scene.traverse((o) => { if (o.name === 'thamesRiver') water = o; });
    return !!water;
  }, { timeout: 60000 });

  const out = await page.evaluate(async () => {
    const THREE = await import('/@fs/Users/jc/repos/underground/node_modules/three/build/three.module.js');
    const ug = window.__ug;
    const res = await fetch('/data/thames.json', { cache: 'no-store' });
    const pts = (await res.json()).points;
    let water = null;
    ug.scene.traverse((o) => { if (o.name === 'thamesRiver') water = o; });
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const misses = [];
    for (const p of pts) {
      const x = p.e - 530000, z = -(p.n - 180400);
      ray.set(new THREE.Vector3(x, 5000, z), down);
      const hits = ray.intersectObject(water, false);
      if (!hits.length) misses.push({ e: p.e, n: p.n, w: p.w });
    }
    return { total: pts.length, misses };
  });

  expect(out.total).toBeGreaterThan(300);
  expect(out.misses, `waypoints with no water mesh overhead: ${JSON.stringify(out.misses.slice(0, 12))}`).toEqual([]);
});
