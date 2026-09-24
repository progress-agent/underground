import { test, expect } from '@playwright/test';
import { createMotorway } from '../src/m25-motorway.js';
import { createOvergroundFleet } from '../src/overground-trains.js';
import { parseEconomies } from '../src/render-economies.js';
import { splitAwareTransparentSort, qualifiesForSplit } from '../src/double-side-split.js';

// Sprint 24Sep26h (D-038, Lane R): the per-layer economies behind
// render-economies.spec.js's pixel checks. Node-side tests first (no page).

test('economy flags: default on, ?econ=0 all off, exclusions and inclusions', () => {
  expect(Object.values(parseEconomies('')).every(Boolean)).toBe(true);
  expect(Object.values(parseEconomies('?econ=0')).some(Boolean)).toBe(false);
  const minus = parseEconomies('?econ=-shadowCache');
  expect(minus.shadowCache).toBe(false); expect(minus.dsplit).toBe(true);
  const only = parseEconomies('?econ=dsplit,m25Cull');
  expect(only.dsplit && only.m25Cull).toBe(true); expect(only.shadowCache).toBe(false);
});

test('split sort draws each back pass immediately before its own front pass', async () => {
  const THREE = await import('three');
  const item = (id, z, back = false, key = undefined) => ({ id, z, groupOrder: 0, renderOrder: 0, object: { __dsBack: back, __dsKey: key } });
  // Two objects at equal depth (e.g. both at the origin), ids 5 and 9; back children have their own higher ids.
  const items = [item(9, 1), item(900, 1, true, 9), item(5, 1), item(500, 1, true, 5), item(3, 2)];
  const order = items.sort(splitAwareTransparentSort).map(i => i.id);
  expect(order).toEqual([3, 500, 5, 900, 9]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide }));
  expect(qualifiesForSplit(m)).toBe(true);
  m.castShadow = true; expect(qualifiesForSplit(m)).toBe(false); m.castShadow = false;
  m.onBeforeRender = () => {}; expect(qualifiesForSplit(m)).toBe(false);
});

test('M25 frustum culling writes exactly the vehicles that can be in view, and switches off cleanly', async () => {
  const { PerspectiveCamera, Frustum, Matrix4, Sphere, Vector3 } = await import('three');
  const g = createMotorway({ getSurfaceY: () => 30, viewportHeightPx: 1800 });
  const total = g.userData.stats.vehicles;
  const camera = new PerspectiveCamera(55, 1.6, 1, 50000);
  const first = g.userData.vehicleAt(0);
  camera.position.set(first.x + 400, first.y + 300, first.z + 400); camera.lookAt(first.x, first.y, first.z); camera.updateMatrixWorld(true);
  const update = () => { for (let i = 0; i < 3; i++) g.userData.update(0, camera); };
  const written = () => { const ids = []; for (const m of g.children.filter(m => m.isInstancedMesh)) for (let i = 0; i < m.count; i++) ids.push(m.userData.vehicleIds[i]); return ids; };
  g.userData.setEconomies({ frustumCulling: true, instanceRanges: true });
  update();
  const ids = written();
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeGreaterThan(10);
  expect(ids.length).toBeLessThan(total / 4);
  expect(g.userData.trafficLod.culled + ids.length).toBe(total);
  // Every vehicle whose body sphere touches the frustum is written.
  const f = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const set = new Set(ids); let missing = 0;
  for (let id = 0; id < total; id++) { const p = g.userData.vehicleAt(id); if (f.intersectsSphere(new Sphere(new Vector3(p.x, p.y + 4.4, p.z), 12)) && !set.has(id)) missing++; }
  expect(missing).toBe(0);
  // Live-range upload: the range covers exactly the live instances.
  for (const m of g.children.filter(m => m.isInstancedMesh && m.count)) {
    expect(m.instanceMatrix.updateRanges).toEqual([{ start: 0, count: m.count * 16 }]);
  }
  // Off again: the module's whole-fleet partition returns.
  g.userData.setEconomies({ frustumCulling: false });
  update();
  expect(written().length).toBe(total);
  g.userData.dispose();
});

test('M25 hidden fleet keeps its clock but skips recompute, then shows the pure-time positions', () => {
  const g = createMotorway({ getSurfaceY: () => 30, viewportHeightPx: 1800 });
  g.userData.setEconomies({ hiddenSkip: true });
  for (let i = 0; i < 3; i++) g.userData.update(0, null);
  const before = g.children.find(m => m.isInstancedMesh && m.count).instanceMatrix.array.slice(0, 16);
  g.visible = false;
  for (let i = 0; i < 9; i++) g.userData.update(1, null);
  expect(g.userData.getElapsed()).toBe(9);
  expect(g.userData.trafficLod.skippedHidden).toBe(9);
  expect(Array.from(g.children.find(m => m.isInstancedMesh && m.count).instanceMatrix.array.slice(0, 16))).toEqual(Array.from(before));
  g.visible = true;
  for (let i = 0; i < 3; i++) g.userData.update(0, null);
  const mesh = g.children.find(m => m.isInstancedMesh && m.count), id = mesh.userData.vehicleIds[0], p = g.userData.vehicleAt(id), a = mesh.instanceMatrix.array;
  expect(Math.abs(a[12] - p.x)).toBeLessThan(.003); expect(Math.abs(a[14] - p.z)).toBeLessThan(.003);
  g.userData.dispose();
});

test('Overground: compacted live cars match the full layout; hidden fleets advance without writing', async () => {
  const { Vector3 } = await import('three');
  const path = Array.from({ length: 200 }, (_, i) => ({ x: i * 60, y: 20, z: Math.sin(i / 9) * 300 }));
  const make = () => createOvergroundFleet([path], 0xff0000, 'test');
  const full = make(), compact = make();
  compact.userData.setEconomies({ compact: true, ranges: true, skipHidden: true });
  const camera = { position: new Vector3(-6000, 100, 0) }; // trains beyond x = 6000 are out of the 12km range
  full.userData.update(3, camera, 5); compact.userData.update(3, camera, 5);
  // Same set of drawn matrices (full layout writes hidden cars as zero-scale).
  const drawn = fleet => { const out = []; const [body] = fleet.userData.meshes; for (let i = 0; i < body.count; i++) { const a = body.instanceMatrix.array.slice(i * 16, i * 16 + 16); if (a[0] || a[1] || a[2]) out.push(Array.from(a).map(v => v.toFixed(4)).join(',')); } return out.sort(); };
  expect(drawn(compact)).toEqual(drawn(full));
  expect(compact.userData.meshes[0].count).toBeLessThan(full.userData.meshes[0].count);
  expect(compact.userData.meshes[0].instanceMatrix.updateRanges[0]).toEqual({ start: 0, count: compact.userData.meshes[0].count * 16 });
  // Hidden: phases advance, matrices untouched.
  const phases = compact.userData.trains.map(t => t.phase), snapshot = compact.userData.meshes[0].instanceMatrix.array.slice();
  compact.visible = false; compact.userData.update(2, camera, 5);
  expect(compact.userData.trains.every((t, i) => t.phase !== phases[i])).toBe(true);
  expect(Array.from(compact.userData.meshes[0].instanceMatrix.array)).toEqual(Array.from(snapshot));
  // Shown again: identical to a fleet that was never hidden.
  compact.visible = true; full.userData.update(2, camera, 5); compact.userData.update(0, camera, 5);
  expect(drawn(compact)).toEqual(drawn(full));
});

// ── In the app ────────────────────────────────────────────────────────────
test.describe('in the running app', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('/?fast=1&buildings=baked');
    await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
      && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup && window.__ug.overground, null, { timeout: 180000 });
    await page.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.controls.enableDamping = false; });
  });
  test.afterAll(async () => { await page?.close(); });

  test('hidden flights skip their per-frame list and matrices; the clock still runs', async () => {
    const r = await page.evaluate(async () => {
      const f = window.__ug.flightsGroup, ud = f.userData;
      const t0 = ud.getElapsed(), skipped0 = ud.stats.skippedHidden || 0, list = ud.flights;
      f.visible = false;
      await new Promise(r => setTimeout(r, 600));
      const hidden = { skipped: (ud.stats.skippedHidden || 0) - skipped0, sameList: ud.flights === list, advanced: ud.getElapsed() > t0 };
      f.visible = true;
      await new Promise(r => setTimeout(r, 200));
      // Shown again: the list is rebuilt from the pure function of elapsed time.
      ud.setElapsed(ud.getElapsed());
      const expected = ud.flightsAt(ud.getElapsed()).map(x => x.id).sort(), shown = ud.flights.map(x => x.id).sort();
      return { hidden, fresh: ud.flights !== list, match: JSON.stringify(expected) === JSON.stringify(shown) };
    });
    expect(r.hidden.skipped).toBeGreaterThan(5);
    expect(r.hidden.sameList).toBe(true);
    expect(r.hidden.advanced).toBe(true);
    expect(r.fresh).toBe(true);
    expect(r.match).toBe(true);
  });

  test('tube trains on a hidden line keep moving and are posed correctly once shown', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, trains = u.trainSystem.allTrains, T = window.__ugTHREE;
      const line = trains[0].parent; const mine = trains.filter(t => t.parent === line);
      const ts = mine.map(t => t.userData.t);
      line.visible = false;
      await new Promise(r => setTimeout(r, 800));
      const moved = mine.some((t, i) => t.userData.t !== ts[i]);
      const stale = mine.filter(t => !(t.userData._poseT === t.userData.t)).length;
      line.visible = true;
      await new Promise(r => setTimeout(r, 200));
      // Every train's pose equals a fresh evaluation at its own (t, dir).
      let worst = 0;
      for (const t of mine) {
        const p = t.userData.curve.getPointAt(t.userData.t);
        worst = Math.max(worst, p.distanceTo(t.position));
      }
      return { moved, stale, worst, count: mine.length };
    });
    expect(r.count).toBeGreaterThan(0);
    expect(r.moved).toBe(true);
    expect(r.stale).toBeGreaterThan(0);
    expect(r.worst).toBeLessThan(1e-6);
  });

  test('shadow map: rendered once while still, re-rendered when the camera or sun moves', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, sun = window.__ugSun, cache = u.shadowCache.stats;
      sun.setShadowsEnabled(true, { persist: false });
      u.camera.position.set(2952.9, 337.8, -732.9); u.controls.target.set(1910.1, 196.2, -783.7); u.controls.update();
      await new Promise(r => setTimeout(r, 600));
      const a = { ...cache };
      await new Promise(r => setTimeout(r, 1000));
      const still = { rendered: cache.rendered - a.rendered, skipped: cache.skipped - a.skipped, active: sun.status.active };
      const b = { ...cache };
      for (let i = 0; i < 20; i++) { u.camera.position.x += 40; u.controls.target.x += 40; u.controls.update(); await new Promise(r => requestAnimationFrame(r)); }
      const moving = { rendered: cache.rendered - b.rendered };
      const c = { ...cache };
      sun.setTime(sun.time > 0.5 ? 0.3 : 0.7, { persist: false });
      await new Promise(r => setTimeout(r, 200));
      return { still, moving, sunMoved: cache.rendered - c.rendered };
    });
    expect(r.still.active).toBe(true);
    expect(r.still.rendered).toBeLessThanOrEqual(1);
    expect(r.still.skipped).toBeGreaterThan(20);
    expect(r.moving.rendered).toBeGreaterThan(5);
    expect(r.sunMoved).toBeGreaterThanOrEqual(1);
  });
});
