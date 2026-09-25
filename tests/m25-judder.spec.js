// Lane F (sprint 25Sep26f, D-039, Jordan's note 15): M25 judder. The fleet
// used to be re-posed only every third frame with no interpolation, so near
// vehicles stood still for two frames and jumped on the third. Near vehicles
// now move every frame; the far fleet keeps the cheap every-third-frame
// cadence. Browser-free, against flat stub terrain.
import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createMotorway } from '../src/m25-motorway.js';
import { TRAFFIC_SPEED_MPS } from '../src/m25-traffic.js';

const DT = 1 / 60;
function setup({ cull = false } = {}) {
  const scene = new THREE.Scene();
  const g = createMotorway({ getSurfaceY: () => 40, viewportHeightPx: 900 });
  scene.add(g);
  if (cull) g.userData.setEconomies({ frustumCulling: true, instanceRanges: true });
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1, 60000);
  const v = g.userData.vehicleAt(5000);
  camera.position.set(v.x + 70, v.y + 45, v.z + 70); camera.lookAt(v.x, v.y, v.z); camera.updateMatrixWorld(true);
  return { scene, g, camera };
}
/** id -> translation of every drawn instance, by LOD. */
function snapshot(g) {
  const near = new Map(), far = new Map();
  for (const mesh of g.children) {
    if (!mesh.isInstancedMesh || mesh.userData.part !== 'traffic') continue;
    const a = mesh.instanceMatrix.array, into = mesh.userData.lod === 'near' ? near : far;
    for (let i = 0; i < mesh.count; i++) into.set(mesh.userData.vehicleIds[i], [a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14], ...a.slice(i * 16, i * 16 + 12)]);
  }
  return { near, far };
}

for (const cull of [false, true]) {
  test(`near vehicles move every frame; the far fleet keeps its three-frame cadence (culling ${cull ? 'on' : 'off'})`, () => {
    const { g, camera } = setup({ cull });
    const tl = g.userData.trafficLod;
    // Start on a full pass so the near set is known.
    do g.userData.update(DT, camera); while (tl.frame % 3);
    const frames = [snapshot(g)];
    const fullBefore = tl.nearPasses || 0;
    for (let f = 0; f < 12; f++) { g.userData.update(DT, camera); frames.push(snapshot(g)); }
    expect(tl.near).toBeGreaterThan(20);             // there is near traffic in this view
    expect(tl.near).toBeLessThan(tl.near + tl.far);
    // Near: no vehicle holds its position over consecutive frames, and no step
    // is a catch-up jump. The traffic runs at 2.5 m/s +- 0.4, about 4 cm a
    // frame; a lane offset at a polyline corner can shorten or lengthen one
    // step, so the steps are bounded in bulk.
    const still = [], steps = [];
    for (let f = 1; f < frames.length; f++) {
      for (const [id, p] of frames[f].near) {
        const q = frames[f - 1].near.get(id); if (!q) continue;
        const d = Math.hypot(p[0] - q[0], p[2] - q[2]);
        steps.push(d);
        if (d < 1e-6) still.push([f, id]);
      }
    }
    expect(still).toEqual([]);
    expect(steps.length).toBeGreaterThan(12 * 20);
    const mean = steps.reduce((x, y) => x + y) / steps.length;
    expect(mean).toBeGreaterThan(TRAFFIC_SPEED_MPS * DT * 0.8); expect(mean).toBeLessThan(TRAFFIC_SPEED_MPS * DT * 1.2);
    // (A vehicle crossing onto a way with a different lane count shifts
    // sideways once; that is the traffic model, not the frame cadence.)
    const even = steps.filter(d => d > TRAFFIC_SPEED_MPS * DT * 0.3 && d < TRAFFIC_SPEED_MPS * DT * 2).length;
    expect(even / steps.length).toBeGreaterThan(0.99);
    // Each near instance is exactly where the pure function of elapsed time
    // puts it now (not a stale or interpolated guess).
    const last = frames.at(-1);
    let checked = 0;
    for (const [id, p] of last.near) {
      const v = g.userData.vehicleAt(id);
      expect(Math.hypot(p[0] - v.x, p[2] - v.z)).toBeLessThan(0.01); // float32 matrices
      if (++checked > 200) break;
    }
    // Far: only full passes (every third frame) write the silhouettes.
    let farChanges = 0;
    for (let f = 1; f < frames.length; f++) {
      const moved = [...frames[f].far].some(([id, p]) => { const q = frames[f - 1].far.get(id); return !q || p.some((x, k) => x !== q[k]); });
      if (moved) farChanges++;
      const full = f % 3 === 0;
      if (!full) expect(moved, `frame ${f}`).toBe(false);
    }
    expect(farChanges).toBe(4);
    // Cost is bounded by the near set: a between-pass frame re-poses exactly
    // the near vehicles, never the fleet.
    expect((tl.nearPasses || 0) - fullBefore).toBe(8);
    expect(tl.nearUpdates).toBe(tl.near);
    // With the app's frustum culling the per-frame set is a few per cent of
    // the 13,622; unculled it still excludes every far silhouette.
    expect(tl.nearUpdates).toBeLessThan(g.userData.stats.vehicles * (cull ? 0.05 : 0.15));
    console.log(`culling ${cull}: near ${tl.near}, far ${tl.far}, near pass ${tl.nearMs.toFixed(3)} ms, full pass ${tl.updateMs.toFixed(3)} ms`);
    g.userData.dispose();
  });
}

test('a paused clock re-poses nothing between passes; a far camera has no near work', () => {
  const { g, camera } = setup();
  const tl = g.userData.trafficLod;
  do g.userData.update(DT, camera); while (tl.frame % 3);
  const passes = tl.nearPasses || 0;
  g.userData.update(0, camera); g.userData.update(0, camera);
  expect(tl.nearPasses || 0).toBe(passes);
  // From 20 km up the whole fleet is far silhouettes: nothing to do per frame.
  camera.position.set(0, 20000 * 5, 18000); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  do g.userData.update(DT, camera); while (tl.frame % 3);
  expect(tl.near).toBe(0);
  const p2 = tl.nearPasses || 0;
  g.userData.update(DT, camera); g.userData.update(DT, camera);
  expect(tl.nearPasses || 0).toBe(p2);
  g.userData.dispose();
});
