// Sprint 24Sep26h (D-038, Lane R, fix round 2): tube trains drawn as one
// instanced body mesh and one instanced window mesh per line. Checks that the
// batch reproduces every per-train part's transform exactly, carries no
// per-instance colour (D-015), switches cleanly back to the per-train path,
// skips uploads when nothing moved, and is disposed by the line rebuild sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// trains.js paints its window texture on a canvas; a no-op 2D context suffices.
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }),
};
const { createTrainSystem, createTrains, updateTrains, disposeTrains, setTrainEconomies, trainBatchStats } = await import('../src/trains.js');

function line(lineId, colour) {
  const scene = new THREE.Scene();
  const group = new THREE.Group(); group.position.set(5, -30, 7); scene.add(group);
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(4000, 0, 800), new THREE.Vector3(9000, -20, 300), new THREE.Vector3(14000, 0, -500)];
  const left = new THREE.CatmullRomCurve3(pts), right = new THREE.CatmullRomCurve3(pts.map(p => p.clone().add(new THREE.Vector3(0, 0, 12))));
  const system = createTrainSystem({ scene });
  const trains = createTrains({ system, leftCurve: left, rightCurve: right, stationUs: [0.2, 0.5, 0.8], lineId, colour, group });
  return { scene, group, system, trains };
}
const sim = { paused: false, timeScale: 1 };
const batchRoot = group => group.children.find(c => c.userData.trainBatch);
const close = (a, b, eps = 1e-3) => a.every((x, i) => Math.abs(x - b[i]) <= eps * Math.max(1, Math.abs(b[i])));

test('each instance, placed by the batch root, lands exactly on the matching per-train part', () => {
  setTrainEconomies({ batch: true, reusePose: true });
  const { scene, group, system, trains } = line('central', 0xdc241f);
  // A camera far from the world origin: the batch rebases near it.
  const camera = new THREE.PerspectiveCamera(); camera.position.set(7013, 140, 611);
  updateTrains(system, sim, camera, 0.5);
  scene.updateMatrixWorld(true);
  const root = batchRoot(group);
  assert.ok(root, 'the line group holds a batch');
  assert.ok(root.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position) < 32, 'rebased near the camera');
  const [body, win] = root.children;
  assert.equal(body.count, trains.length);
  assert.equal(win.count, 2 * trains.length);
  const m = new THREE.Matrix4(), world = new THREE.Matrix4();
  const at = (mesh, i) => (mesh.getMatrixAt(i, m), world.multiplyMatrices(root.matrixWorld, m).elements);
  trains.forEach((t, i) => {
    assert.equal(t.userData.nearGroup.visible, false);
    const [capsule, wL, wR] = t.userData.nearGroup.children;
    assert.ok(close(at(body, i), capsule.matrixWorld.elements), `body ${i}`);
    assert.ok(close(at(win, 2 * i), wL.matrixWorld.elements), `left strip ${i}`);
    assert.ok(close(at(win, 2 * i + 1), wR.matrixWorld.elements), `right strip ${i}`);
  });
  // Moving the camera within one grid step rewrites nothing.
  const u0 = trainBatchStats.uploads;
  camera.position.x += 3;
  updateTrains(system, { paused: true, timeScale: 1 }, camera, 0.1);
  assert.equal(trainBatchStats.uploads, u0);
});

test('colour is per line in the material, never per instance (D-015)', () => {
  setTrainEconomies({ batch: true });
  const { group, trains } = line('jubilee', 0xa0a5a9);
  const [body, win] = batchRoot(group).children;
  for (const mesh of [body, win]) {
    assert.equal(mesh.instanceColor, null);
    assert.equal(mesh.geometry.getAttribute('color'), undefined);
  }
  // Same material parameters as the per-train path.
  const ref = trains[0].userData.nearGroup.children[0].material;
  assert.equal(body.material.emissive.getHex(), ref.emissive.getHex());
  assert.equal(body.material.emissiveIntensity, ref.emissiveIntensity);
  assert.equal(body.material.color.getHex(), ref.color.getHex());
  assert.equal(body.material.roughness, ref.roughness);
  assert.equal(body.material.metalness, ref.metalness);
  const wref = trains[0].userData.nearGroup.children[1].material;
  for (const k of ['alphaTest', 'toneMapped', 'side', 'transparent', 'map']) assert.equal(win.material[k], wref[k], k);
  assert.equal(win.material.transparent, false, 'strips are opaque cutouts, so draw order cannot change a pixel');
});

test('switching the economy off restores the per-train meshes and hides the batch', () => {
  setTrainEconomies({ batch: true });
  const { group, trains } = line('victoria', 0x0098d4);
  const root = batchRoot(group);
  setTrainEconomies({ batch: false });
  assert.equal(root.visible, false);
  assert.ok(trains.every(t => t.userData.nearGroup.visible));
  setTrainEconomies({ batch: true });
  assert.equal(root.visible, true);
  assert.ok(trains.every(t => !t.userData.nearGroup.visible));
});

test('a paused line uploads nothing; a moving one uploads once per frame', () => {
  setTrainEconomies({ batch: true, reusePose: true });
  const { system } = line('northern', 0x000000);
  updateTrains(system, sim, null, 0.1);
  const u0 = trainBatchStats.uploads;
  for (let i = 0; i < 5; i++) updateTrains(system, { paused: true, timeScale: 1 }, null, 0.1);
  assert.equal(trainBatchStats.uploads, u0);
  updateTrains(system, sim, null, 0.1);
  assert.equal(trainBatchStats.uploads, u0 + 1);
});

test('a hidden line is not written; shown again, it is current before the frame', () => {
  setTrainEconomies({ batch: true, reusePose: true });
  const { group, system, trains } = line('piccadilly', 0x003688);
  updateTrains(system, sim, null, 0.1);
  group.visible = false;
  const u0 = trainBatchStats.uploads;
  for (let i = 0; i < 4; i++) updateTrains(system, sim, null, 3);
  assert.equal(trainBatchStats.uploads, u0);
  group.visible = true;
  updateTrains(system, sim, null, 0);
  const [body] = batchRoot(group).children, m = new THREE.Matrix4();
  trains.forEach((t, i) => { t.updateMatrix(); assert.ok(close((body.getMatrixAt(i, m), m.elements), t.matrix.elements), `train ${i}`); });
});

test('the rebuild sweep disposes the batch through disposeTrains, and a new build makes a fresh one', () => {
  setTrainEconomies({ batch: true });
  const { group, system, trains } = line('bakerloo', 0xb36305);
  const root = batchRoot(group), batch = root.userData.trainBatch;
  // main.js: toRemove = children except kept DLR trains; oldTrains = groups with userData.lineId.
  const oldTrains = [...group.children].filter(c => c.isGroup && c.userData.lineId);
  assert.ok(oldTrains.includes(root));
  disposeTrains(system, oldTrains);
  assert.equal(batch.disposed, true);
  assert.equal(root.parent, null);
  assert.equal(system.allTrains.length, 0);
  assert.ok(trains.every(t => t.userData.batch === null));
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(3000, 0, 0)];
  const again = createTrains({ system, leftCurve: new THREE.CatmullRomCurve3(pts), rightCurve: new THREE.CatmullRomCurve3(pts.map(p => p.clone().setZ(12))), stationUs: [0.5], lineId: 'bakerloo', colour: 0xb36305, group });
  const fresh = batchRoot(group);
  assert.ok(fresh && fresh !== root);
  updateTrains(system, sim, null, 0.1);
  assert.equal(fresh.children[0].count, again.length);
});
