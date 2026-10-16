// s16-r-m25-chunks.test.mjs: the m25Chunks economy of lane R (sprint 16Oct26f, D-054). With the chunk memory on, a full pass
// of the M25 fleet writes exactly what it writes with it off: the same vehicles, in the same order, into the same slots with
// the same matrices, and the same counts; only the searches for culled vehicles are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createMotorway } from '../src/m25-motorway.js';

function mk(memory) {
  const scene = new T.Scene(); scene.fog = new T.Fog(0x1a2a3a, 5000, 9000);
  const g = createMotorway({ getSurfaceY: () => 30, viewportHeightPx: 1800 }); scene.add(g);
  g.userData.setEconomies({ frustumCulling: true, fogCulling: true, instanceRanges: true });
  g.userData.setChunkMemory(memory);
  return { scene, g };
}
const meshes = g => g.children.filter(m => m.isInstancedMesh);
function snapshot(g) {
  const ts = g.userData.trafficLod;
  return { stats: [ts.near, ts.far, ts.triangles, ts.drawCalls, ts.culled, ts.fogCulledChunks],
    meshes: meshes(g).map(m => ({ count: m.count, visible: m.visible, ids: Array.from(m.userData.vehicleIds.slice(0, m.count)), mat: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)) })) };
}
function same(a, b, where) {
  assert.deepEqual(a.stats, b.stats, `stats ${where}`);
  a.meshes.forEach((m, k) => {
    assert.equal(m.count, b.meshes[k].count, `count of mesh ${k} ${where}`);
    assert.equal(m.visible, b.meshes[k].visible);
    assert.deepEqual(m.ids, b.meshes[k].ids, `ids of mesh ${k} ${where}`);
    for (let i = 0; i < m.mat.length; i++) if (!Object.is(m.mat[i], b.meshes[k].mat[i])) assert.fail(`matrix ${i} of mesh ${k} ${where}: ${m.mat[i]} vs ${b.meshes[k].mat[i]}`);
  });
}

test('s16:R m25Chunks: the chunk memory writes exactly what the unmemoried pass writes, across pans, jumps of the clock and revalidation', () => {
  const off = mk(false), on = mk(true);
  const total = on.g.userData.stats.vehicles;
  const camera = new T.PerspectiveCamera(55, 1.6, 1, 50000);
  const anchors = [0, Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.8)].map(id => off.g.userData.vehicleAt(id));
  let step = 0, written = 0;
  const run = (dt, force = false) => {
    for (const { g } of [off, on]) g.userData.update(dt, camera, force);
    same(snapshot(off.g), snapshot(on.g), `step ${step}`); step++; written += snapshot(on.g).meshes.reduce((n, m) => n + m.count, 0);
  };
  const place = (a, k, yaw) => { camera.position.set(a.x + 700 * Math.cos(k), 350 + 60 * (k % 3), a.z + 700 * Math.sin(k)); camera.lookAt(a.x, 0, a.z); camera.rotateY(yaw); camera.updateMatrixWorld(true); };
  // a long walk of small steps: nearly every culled vehicle is answered from memory
  for (const a of anchors) {
    place(a, 0.5, 0);
    for (let i = 0; i < 18; i++) run(0.05);
    // the camera pans between the full passes: revalidate widens the written set in both fleets identically
    for (let k = 0; k < 4; k++) {
      for (const { g } of [off, on]) g.userData.update(0.05, camera);
      place(a, 0.5 + k, 0.7 * k);
      const r1 = off.g.userData.revalidate(camera), r2 = on.g.userData.revalidate(camera);
      assert.equal(r1, r2, 'revalidate agrees');
      same(snapshot(off.g), snapshot(on.g), `revalidate ${k}`);
    }
  }
  // the clock jumps (the 8x time scale, a paused tab coming back, a long stall): chunks are crossed, memory must not mislead
  place(anchors[0], 1, 0);
  for (const dt of [0.05, 0.4, 0.4, 3, 7.5, 0.05, 30, 120, 0.05, 600, 0.05]) { for (let i = 0; i < 3; i++) run(dt); }
  // a forced update (a height change) and a fog change
  run(0, true);
  off.scene.fog.far = on.scene.fog.far = 20000; for (let i = 0; i < 3; i++) run(0.05);
  off.scene.fog.far = on.scene.fog.far = 4000; for (let i = 0; i < 3; i++) run(0.05);
  assert.ok(written > 1000, `the passes wrote vehicles (${written})`);
  // and the memory did its job: far fewer searches than vehicles asked
  const a = off.g.userData.trafficLod, b = on.g.userData.trafficLod;
  assert.equal(a.chunkSearches, 0, 'memory off never records a search');
  assert.ok(b.chunkSearches < step * 0.5 * total, `searches ${b.chunkSearches} against ${step} passes of ${total} vehicles`);
  off.g.userData.dispose(); on.g.userData.dispose();
});

test('s16:R m25Chunks: off (the default) is the 07391f3 path, and the steepest map slope is exposed per carrier', () => {
  const { g } = mk(false);
  for (const c of g.userData.carriers) { assert.ok(Number.isFinite(c.layout.maxSlope) && c.layout.maxSlope >= 0.5 && c.layout.maxSlope < 2, `slope ${c.layout.maxSlope}`); }
  assert.equal(g.userData.setChunkMemory(false), false);
  assert.equal(g.userData.setChunkMemory(true), true);
  g.userData.dispose();
});
