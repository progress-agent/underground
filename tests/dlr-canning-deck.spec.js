// dlr-canning-deck.spec.js: Lane F (sprint 02Oct26f, D-047 rail-canning-flyover).
//
// Where the DLR flyover leaves the deck it rises from at Canning Town (scene (9458, -905): a 17-point
// viaduct piece starts 9.3 m beside the viaduct piece it leaves) the two decks stepped by 3.1 to 3.4 m
// (reported as up to 1.5 m).
// src/dlr-deck-blend.js now blends the ending deck onto the through deck over its last 30 m, where
// the track is drawn (tube-surface-rail.js), so the trains that ride the drawn track follow.
//
// The probe casts vertical rays DOWN against the DLR's surface-rail meshes, every 0.5 m along each
// branch's centreline from 40 m before its end nearest the site, and along the straight segment from
// that end to the nearest point of the other branch, and records the first hit's y. The largest jump
// between consecutive hits (a miss across the gap keeps the last hit), times the Master ratio (built
// things are true size at every Master, D-039: display units are true metres), must be under 0.10 m at
// Master 1.1 and at Master 5.
//
// It asserts on the DECKS (the 'dressing' meshes: deck slab, piers, ballast), which is what "the deck
// step" means. The identity stripe and the shared-track bands are ribbons lifted 0.8 and 1.2 units above
// the deck by design (surface-rail.js STRIPE_LIFT, BAND_LIFT) and have edges, so a ray that crosses one
// meets a ledge of that height wherever it ends, however well the decks agree; that figure is recorded
// too (worstJumpAllMeshesM) but not asserted: the stripe and band ledges are the same before and after.
//
// UG_CANNING_OUT=<file> writes the figures first (used for the e0675d7 "before": >= 0.5 m).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const SITE = { x: 9458, z: -905 };

async function boot(page) {
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ug.groundReady && window.__ug.surfaceRail
    && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
}
const frames = (page, n = 3) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function setMaster(page, m) {
  await page.evaluate(m => {
    const el = document.getElementById('masterHeight');
    el.value = String(m); el.dispatchEvent(new Event('input', { bubbles: true }));
    window.__ug.structureMorph.flush();
  }, m);
  await frames(page, 6);
}

const probe = (page, site) => page.evaluate((site) => {
  const u = window.__ug, T = window.__ugTHREE, ratio = u.camera.userData.masterHeightController.ratio;
  u.scene.updateMatrixWorld(true);
  const meshes = [];
  u.scene.traverse(o => { if (o.isMesh && o.userData?.lineId === 'dlr' && (o.parent?.userData?.kind === 'surface-rail' || o.userData?.kind === 'surface-rail')) meshes.push(o); });
  const paths = (u.surfaceRail.paths.get('dlr') || []).filter(Boolean);
  const near = paths.filter(p => p.some(s => Math.hypot(s.x - site.x, s.z - site.z) <= 40));
  // The junction is where a path END lies within 15 m of the site: here the flyover's start. The other branch is
  // reached along the straight segment from that end to its nearest point; its own far end, 55 m away, has a
  // 0.9 m ledge in the deck mesh of its own (measured after the blend, at (9474, -881)) that no deck blend touches.
  const junction = near.filter(p => [p[0], p.at(-1)].some(s => Math.hypot(s.x - site.x, s.z - site.z) <= 15));
  const ray = new T.Raycaster(); ray.far = 100000;
  const down = new T.Vector3(0, -1, 0), origin = new T.Vector3();
  const decks = meshes.filter(m => m.userData.part === 'dressing');
  const hitIn = (set, x, z) => { origin.set(x, 50000, z); ray.set(origin, down); const h = ray.intersectObjects(set, false)[0]; return h ? h.point.y : null; };
  const hitY = (x, z) => hitIn(decks, x, z), hitAll = (x, z) => hitIn(meshes, x, z);
  const hitPart = (x, z) => { origin.set(x, 50000, z); ray.set(origin, down); const h = ray.intersectObjects(meshes, false)[0]; return h ? h.object.userData.part : null; };
  const arcs = path => { const a = [0]; for (let i = 1; i < path.length; i++) a.push(a[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z)); return a; };
  const pointAt = (path, A, s) => { let i = 0; while (i < path.length - 2 && A[i + 1] < s) i++; const t = (s - A[i]) / ((A[i + 1] - A[i]) || 1); return { x: path[i].x + (path[i + 1].x - path[i].x) * t, z: path[i].z + (path[i + 1].z - path[i].z) * t }; };
  const nearestOther = (p, mine) => { let best = null; for (const q of near) { if (q === mine) continue; for (let i = 0; i < q.length - 1; i++) { const a = q[i], b = q[i + 1], vx = b.x - a.x, vz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1))); const x = a.x + vx * t, z = a.z + vz * t, d = Math.hypot(p.x - x, p.z - z); if (!best || d < best.d) best = { d, x, z }; } } return best; };
  const report = [];
  for (const path of junction) {
    const A = arcs(path), total = A.at(-1);
    // The end nearest the site.
    const dStart = Math.hypot(path[0].x - site.x, path[0].z - site.z), dEnd = Math.hypot(path.at(-1).x - site.x, path.at(-1).z - site.z);
    const atEnd = dEnd <= dStart, E = atEnd ? path.at(-1) : path[0];
    const samples = [];
    for (let m = 40; m >= 0; m -= 0.5) { const s = atEnd ? total - m : m, p = pointAt(path, A, Math.max(0, Math.min(total, s))); samples.push(p); }
    // (for the start end m runs 40 down to 0 as the arc from the start, so the end is reached last here too)
    const other = nearestOther(E, path);
    if (other && other.d < 60) { const n = Math.ceil(other.d / 0.5); for (let k = 1; k <= n; k++) samples.push({ x: E.x + (other.x - E.x) * k / n, z: E.z + (other.z - E.z) * k / n }); }
    let last = null, worst = 0, hits = 0, at = null, worstK = -1, lastAll = null, worstAll = 0;
    const trace = [];
    samples.forEach((p, k) => {
      const y = hitY(p.x, p.z); trace.push([+p.x.toFixed(1), +p.z.toFixed(1), y === null ? null : +y.toFixed(2), hitPart(p.x, p.z)]);
      const ya = hitAll(p.x, p.z); if (ya !== null) { if (lastAll !== null) worstAll = Math.max(worstAll, Math.abs(ya - lastAll)); lastAll = ya; }
      if (y === null) return; hits++;
      if (last !== null && Math.abs(y - last.y) > worst) { worst = Math.abs(y - last.y); at = { x: p.x, z: p.z }; worstK = k; }
      last = { y };
    });
    report.push({ points: path.length, lengthM: total, endDistToSite: Math.min(dStart, dEnd), otherDistM: other?.d ?? null, hits, samples: samples.length, worstJumpCanonical: worst, worstJumpM: worst * ratio, worstJumpAllMeshesM: worstAll * ratio, at,
      traceAroundWorst: worstK < 0 ? [] : trace.slice(Math.max(0, worstK - 6), worstK + 4) });
  }
  return { ratio, meshes: meshes.length, decks: decks.length, branches: near.length, junctions: junction.length, report, worstJumpM: Math.max(0, ...report.map(r => r.worstJumpM)) };
}, site);

test('the DLR flyover leaves its deck without a step at Canning Town, at Master 1.1 and Master 5', async ({ page }) => {
  test.setTimeout(240000);
  await boot(page);
  const results = {};
  for (const m of [1.1, 5]) {
    await setMaster(page, m);
    results[m] = await probe(page, SITE);
  }
  if (process.env.UG_CANNING_OUT) fs.writeFileSync(process.env.UG_CANNING_OUT, JSON.stringify(results, null, 2));
  for (const [m, r] of Object.entries(results)) {
    console.log(`[dlr-canning-deck] Master ${m}: ${r.branches} branches, ${r.meshes} meshes, worst jump ${r.worstJumpM.toFixed(3)} m ${JSON.stringify(r.report.map(x => ({ n: x.points, hits: x.hits, jumpM: +x.worstJumpM.toFixed(3), allMeshesM: +x.worstJumpAllMeshesM.toFixed(2), at: x.at && [Math.round(x.at.x), Math.round(x.at.z)], trace: x.traceAroundWorst })))}`);
    expect(r.meshes, 'the DLR surface-rail meshes exist').toBeGreaterThan(0);
    expect(r.decks, 'the DLR deck meshes exist').toBeGreaterThan(0);
    expect(r.branches, 'DLR branches near the site').toBeGreaterThanOrEqual(2);
    expect(r.junctions, 'a DLR path ends at the junction').toBeGreaterThanOrEqual(1);
    expect(r.report.some(x => x.hits > 20), 'the probe hit the drawn deck').toBe(true);
    expect(r.worstJumpM, `deck step at Master ${m}: ${JSON.stringify(r.report.map(x => [x.points, +x.worstJumpM.toFixed(2), x.at]))}`).toBeLessThan(0.10);
  }
});
