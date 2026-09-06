// Baked-buildings render path (06Sep26u) — does the renderer decode the payload
// into the same city the live path builds?
//
// scripts/verify-bake.mjs already proves the PAYLOAD is correct: it re-derives
// buildings from the source tiles and matches within the quantisation bound.
// That says nothing about the renderer. This spec closes the other half — the
// decode, the metre/scene-Y conversion and the instance-matrix write — by
// comparing the two paths' actual InstancedMesh contents in one browser session.
//
// TWO KNOWN, LEGITIMATE SOURCES OF MISMATCH, both asserted as bounded rather
// than assumed away:
//
//  1. Zero-area buildings. The live path keeps them (sqrt(0) -> side clamped to
//     0.1m); the compiler drops them (`b.area <= 0`). The baked city is
//     therefore a few buildings SMALLER, by design.
//  2. Boundary dedup order. The live path dedups in camera-arrival order, the
//     compiler in filename order, so which of two ~5m-apart duplicates survives
//     can differ per path.
//
// A decode bug does not look like either: it misplaces buildings en masse.

import { test, expect } from '@playwright/test';
import { LANDMARKS } from '../scripts/landmarks.mjs';

const WINDOW_M = 4000;   // half-extent of the comparison box around the camera
const TOL_M = 0.06;      // half-decimetre quantisation (0.05) plus float slack

/** Pull every building instance inside a box, from whichever path built it. */
const collect = (halfExtent) => {
  const g = window.__ug.surfaceGeometryGroup;
  const cam = window.__ug.camera;
  const out = [];
  if (!g) return out;
  g.traverse((o) => {
    if (!o.isInstancedMesh || !o.name) return;
    if (!o.name.startsWith('buildings-') && !o.name.startsWith('baked-buildings-')) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const p = i * 16;
      const x = a[p + 12], z = a[p + 14];
      if (Math.abs(x - cam.position.x) > halfExtent) continue;
      if (Math.abs(z - cam.position.z) > halfExtent) continue;
      out.push([x, a[p + 13], z, a[p], a[p + 5]]); // x, y, z, side, height
    }
  });
  return out;
};

async function bootLive(page) {
  await page.goto('/?buildings=live');
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );
  await page.waitForTimeout(6000); // let the proximity loader settle
}

test('baked path places buildings where the live path places them', async ({ page }) => {
  await bootLive(page);

  const live = await page.evaluate(collect, WINDOW_M);
  expect(live.length, 'live path produced no buildings to compare against').toBeGreaterThan(1000);

  // Swap in place. Reloading instead would resettle OrbitControls and move the
  // camera, and the comparison box is camera-relative.
  await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
  await page.waitForFunction(() => window.__ug.bakedStats?.tilesBuilt >= window.__ug.bakedStats?.tilesTotal,
    { timeout: 60000 });
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => window.__ug.bakedStats);
  console.log('baked payload:', JSON.stringify(stats));
  expect(stats.buildings, 'not every baked building became an instance').toBe(stats.buildingsTotal);

  const baked = await page.evaluate(collect, WINDOW_M);
  expect(baked.length).toBeGreaterThan(1000);

  // Match live -> baked on a 1m grid, searching the 3x3 neighbourhood so a
  // building sitting within the quantisation bound of a cell edge still finds
  // its counterpart.
  const report = await page.evaluate(([live, baked, tol, sites, VE]) => {
    const grid = new Map();
    for (const b of baked) {
      const k = `${Math.round(b[0])},${Math.round(b[2])}`;
      (grid.get(k) || grid.set(k, []).get(k)).push(b);
    }
    // A live building with no baked counterpart is EXPECTED inside a landmark
    // suppression disc and a defect anywhere else, so the two are counted
    // separately rather than lumped into one tolerance.
    const inSuppressionDisc = (x, z) => sites.find(s =>
      Math.hypot(x - s.x, z - s.z) <= s.suppressRadiusM);

    let matched = 0, missingSuppressed = 0, missingUnexplained = 0, displaced = 0, ambiguous = 0;
    const worst = { pos: 0, y: 0, h: 0, side: 0 };
    const unexplained = [], displacedPairs = [];
    const perSite = {};
    for (const L of live) {
      const gx = Math.round(L[0]), gz = Math.round(L[2]);
      // Score on ALL FIVE fields, not plan distance alone. OSM carries stacked
      // records — a building and its parts — at one centroid with different
      // heights, and both survive dedup in both paths because the hash includes
      // height. A nearest-in-plan matcher pairs those arbitrarily and then
      // reports a 30m height disagreement that is its own doing. A real decode
      // fault still fails this: it moves every building on some axis, so no
      // candidate scores well on any field.
      let best = null, bestD = Infinity, bestScore = Infinity, coincident = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const B of grid.get(`${gx + dx},${gz + dz}`) || []) {
          const d = Math.hypot(B[0] - L[0], B[2] - L[2]);
          if (d <= tol) coincident++;
          const score = Math.max(d, Math.abs(B[1] - L[1]) / VE, Math.abs(B[4] - L[4]) / VE, Math.abs(B[3] - L[3]));
          if (score < bestScore) { bestScore = score; bestD = d; best = B; }
        }
      }
      if (coincident > 1) ambiguous++;
      if (!best || bestD > tol) {
        const site = inSuppressionDisc(L[0], L[2]);
        if (site) { missingSuppressed++; perSite[site.id] = (perSite[site.id] || 0) + 1; }
        else {
          missingUnexplained++;
          if (unexplained.length < 8) unexplained.push({ x: +L[0].toFixed(1), z: +L[2].toFixed(1), side: +L[3].toFixed(2), h: +L[4].toFixed(2), nearest: Number.isFinite(bestD) ? +bestD.toFixed(3) : null });
        }
        continue;
      }
      matched++;
      const dy = Math.abs(best[1] - L[1]), dh = Math.abs(best[4] - L[4]), ds = Math.abs(best[3] - L[3]);
      if (bestD > worst.pos) worst.pos = bestD;
      if (dy > worst.y) worst.y = dy;
      if (dh > worst.h) worst.h = dh;
      if (ds > worst.side) worst.side = ds;
      // Vertical values are real metres in the payload and multiplied by VE at
      // build time, so the scene-unit bound is the metre bound x VE.
      if (dy > tol * VE || dh > tol * VE) {
        displaced++;
        if (displacedPairs.length < 8) displacedPairs.push({
          plan: +bestD.toFixed(4),
          live: { x: +L[0].toFixed(2), z: +L[2].toFixed(2), y: +L[1].toFixed(2), side: +L[3].toFixed(2), h: +L[4].toFixed(2) },
          baked: { x: +best[0].toFixed(2), z: +best[2].toFixed(2), y: +best[1].toFixed(2), side: +best[3].toFixed(2), h: +best[4].toFixed(2) },
        });
      }
    }
    return { live: live.length, baked: baked.length, matched, missingSuppressed, perSite,
             missingUnexplained, unexplained, ambiguous, displaced, displacedPairs, worst };
  }, [live, baked, TOL_M, LANDMARKS.map(l => ({ id: l.id, x: l.x, z: l.z, suppressRadiusM: l.suppressRadiusM })), 5]);

  console.log('live -> baked:', JSON.stringify(report, null, 2));

  // Landmark carve-outs are the compiler doing its job and are counted, not
  // tolerated: they are the reason the baked city currently has bald patches at
  // the ten named sites, and they close when the models land.
  const explained = report.matched + report.missingSuppressed;
  const rate = explained / report.live;
  expect(rate, `${(rate * 100).toFixed(3)}% of live buildings accounted for; ${report.missingUnexplained} unexplained`).toBeGreaterThan(0.999);
  expect(report.worst.pos, 'plan position drifted past the quantisation bound').toBeLessThanOrEqual(TOL_M);
  // Vertical agreement is the assertion that actually exercises the decode:
  // base elevation and height are the two fields converted from real metres to
  // scene units at build time, and a wrong VE or a sign error shows up here
  // long before it shows up in plan.
  expect(report.worst.y, 'base elevations disagree beyond quantisation').toBeLessThanOrEqual(TOL_M * 5);
  expect(report.worst.h, 'heights disagree beyond quantisation').toBeLessThanOrEqual(TOL_M * 5);
});

test('baked path survives a round trip back to live and forward again', async ({ page }) => {
  await bootLive(page);
  const liveCount = await page.evaluate(() => window.__ug.buildingInstanceCount);
  expect(liveCount).toBeGreaterThan(0);

  await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
  await page.waitForFunction(() => window.__ug.bakedStats?.tilesBuilt >= window.__ug.bakedStats?.tilesTotal,
    { timeout: 60000 });
  const bakedCount = await page.evaluate(() => window.__ug.buildingInstanceCount);
  expect(bakedCount).toBe(await page.evaluate(() => window.__ug.bakedStats.buildingsTotal));

  // Back to live. Tiles loaded while baked was active hold no building meshes,
  // so resetLoadedTiles() has to send them round the arrival path again. This
  // is the exact shape of the old dedup-hash leak: tiles report 'loaded' and
  // render nothing. A count of zero here is that bug returning.
  await page.evaluate(() => window.__ug.setBuildingsPath('live'));
  await page.waitForTimeout(12000);
  const backToLive = await page.evaluate(() => window.__ug.buildingInstanceCount);
  console.log('round trip:', { liveCount, bakedCount, backToLive });
  expect(backToLive, 'live path rendered nothing after returning from baked — dedup hashes leaked').toBeGreaterThan(0);

  // And forward again: this one is a re-attach of retained meshes, not a rebuild.
  await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
  await page.waitForTimeout(1000);
  const backToBaked = await page.evaluate(() => window.__ug.buildingInstanceCount);
  expect(backToBaked).toBe(bakedCount);
});

test('a corrupt payload is rejected rather than decoded into a scattered city', async ({ page }) => {
  await bootLive(page);
  const outcomes = await page.evaluate(async () => {
    const { parseBakedBuildings } = await import('/src/baked-buildings.js');
    const attempt = (buf) => { try { parseBakedBuildings(buf); return 'ACCEPTED'; } catch (e) { return e.message; } };

    const good = new ArrayBuffer(12 + 16 + 10);
    const dv = new DataView(good);
    dv.setUint32(0, 0x31424755, true); dv.setUint16(4, 1, true);
    dv.setUint16(6, 1, true); dv.setUint32(8, 1, true);

    const badMagic = good.slice(0); new DataView(badMagic).setUint32(0, 0xdeadbeef, true);
    const badVersion = good.slice(0); new DataView(badVersion).setUint16(4, 2, true);
    const truncated = good.slice(0, good.byteLength - 4);

    return {
      good: attempt(good),
      badMagic: attempt(badMagic),
      badVersion: attempt(badVersion),
      truncated: attempt(truncated),
      empty: attempt(new ArrayBuffer(4)),
    };
  });
  console.log('payload validation:', JSON.stringify(outcomes, null, 2));
  expect(outcomes.good).toBe('ACCEPTED');
  expect(outcomes.badMagic).toContain('bad magic');
  expect(outcomes.badVersion).toContain('version');
  expect(outcomes.truncated).toContain('truncated or corrupt');
  expect(outcomes.empty).toContain('header');
});
