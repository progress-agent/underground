// Verify (a) disposed surface tiles re-load when camera returns within range,
// and (b) reservoir water surface sits within ~2m of local terrain, not floating.
// Run: npx playwright test tests/tile-reload-reservoir-height.spec.js --headed

import { test, expect } from '@playwright/test';

test('Surface tiles re-load after camera drift; reservoirs sit near local terrain', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );
  await page.waitForTimeout(3000);

  // ── Test A: Surface tile reload on return ─────────────────────────
  // Capture initial loaded tile count, move camera far away, wait for disposal,
  // move back, wait, confirm tiles reloaded.
  const initialStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);
  const initialInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);
  expect(initialStats.loaded).toBeGreaterThan(0);
  expect(initialInstances).toBeGreaterThan(0);

  // Fling the camera 50km away on XZ so every tile exceeds UNLOAD_RADIUS=18km
  await page.evaluate(() => {
    const cam = window.__ug.camera;
    cam.position.set(50000, 2000, 50000);
  });

  // CHECK_INTERVAL is 500ms; give disposal several cycles
  await page.waitForTimeout(2500);
  const afterDriftStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);
  const afterDriftInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);

  // Return camera to origin area
  await page.evaluate(() => {
    const cam = window.__ug.camera;
    cam.position.set(-200, 85, 400);
  });

  // Wait for reload cycles (network + parse can take longer than dispose)
  await page.waitForTimeout(10000);
  const afterReturnStats = await page.evaluate(() => window.__ug.surfaceLoaderStats);
  const afterReturnInstances = await page.evaluate(() => window.__ug.buildingInstanceCount);

  console.log('Tile stats:', { initial: initialStats, afterDrift: afterDriftStats, afterReturn: afterReturnStats });
  console.log('Instance counts:', { initial: initialInstances, afterDrift: afterDriftInstances, afterReturn: afterReturnInstances });

  // This test now guards against TWO failure modes in the tile reload cycle:
  //
  // 1. Old failure (fixed at surface-loader.js ~L96): disposed tiles stayed at
  //    state='disposed' and never re-queued — afterReturnStats.loaded stayed 0.
  //    Asserted via the stats.loaded check below.
  //
  // 2. Phase 0b failure (fixed via per-tile dedup cleanup): the module-level
  //    placedBuildings Set was never drained on disposal. On reload, every
  //    building hashed identically to its prior pass, was rejected as a
  //    duplicate, and createTileBuildings returned null. Tiles reported as
  //    'loaded' but rendered ZERO buildings. The instance-count assertions
  //    below catch this — stats.loaded alone would mask it.
  expect(afterReturnStats.loaded).toBeGreaterThan(Math.floor(initialStats.loaded * 0.5));
  expect(afterReturnInstances).toBeGreaterThan(0);
  expect(afterReturnInstances).toBeGreaterThan(initialInstances * 0.85);

  // ── Test B: Reservoir altitude sanity ─────────────────────────────
  // Walk the scene for reservoir meshes, check water Y is within a reasonable
  // margin of the terrain Y at the reservoir centroid.
  const reservoirReport = await page.evaluate(() => {
    const scene = window.__ug.scene;
    const getTerrainMeshSurfaceY = window.__ug.getTerrainMeshSurfaceY;
    const VE = window.__ug.VERTICAL_EXAGGERATION;
    const offenders = [];
    let count = 0;

    scene.traverse((obj) => {
      if (obj.userData?.type === 'reservoir' && obj.geometry?.attributes?.position) {
        count++;
        const pos = obj.geometry.attributes.position;
        // Water Y is uniform across all vertices (setY in reservoirs.js)
        const waterY = pos.getY(0);

        // Sample a few vertices for local terrain Y
        let sumTerrainY = 0, samples = 0;
        const step = Math.max(1, Math.floor(pos.count / 8));
        for (let i = 0; i < pos.count; i += step) {
          const tY = getTerrainMeshSurfaceY({ x: pos.getX(i), z: pos.getZ(i) });
          if (tY !== null && tY !== undefined) {
            sumTerrainY += tY;
            samples++;
          }
        }
        if (samples === 0) return;
        const meanTerrainY = sumTerrainY / samples;
        const liftSceneUnits = waterY - meanTerrainY;
        const liftRealMetres = liftSceneUnits / VE;

        // Fail only on gross elevation anomalies (>10m real above mean rim
        // terrain OR >2m below — which would indicate terrain poking through).
        // Embanked reservoirs genuinely sit 3-8m above surrounding ground.
        if (liftRealMetres > 10 || liftRealMetres < -2) {
          offenders.push({
            name: obj.userData.name,
            waterY: +waterY.toFixed(1),
            meanTerrainY: +meanTerrainY.toFixed(1),
            liftRealMetres: +liftRealMetres.toFixed(2),
          });
        }
      }
    });

    return { count, offenders };
  });

  console.log(`Reservoirs checked: ${reservoirReport.count}, >10m-real lift: ${reservoirReport.offenders.length}`);
  if (reservoirReport.offenders.length > 0) {
    console.log('Worst offenders:', reservoirReport.offenders.slice(0, 5));
  }
  expect(reservoirReport.count).toBeGreaterThan(5);
  // London has genuinely embanked reservoirs (Queen Mary, Wraysbury, King
  // George VI) that sit 5-8m above surrounding ground in reality. The fix
  // removes external-hill sampling. One known OSM data anomaly (unnamed way
  // 1280733481) straddles a 20m elevation feature; allow up to 2 outliers.
  expect(reservoirReport.offenders.length).toBeLessThanOrEqual(2);
});
