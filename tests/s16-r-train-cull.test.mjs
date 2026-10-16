// s16-r-train-cull.test.mjs: the trainCull economy of lane R (sprint 16Oct26f, D-054). While the render's underground
// cull hides every line group, the tube trains are neither posed nor batched, but their curve position still advances
// (the audio reads it); the first frame the cull lifts, every train is posed exactly as if it had never been culled.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }),
};
const { createTrainSystem, createTrains, updateTrains, setTrainEconomies, setTrainCulled, trainPoseStats, trainBatchStats } = await import('../src/trains.js');

function line() {
  const scene = new THREE.Scene();
  const group = new THREE.Group(); group.name = 'line:central'; group.position.set(5, -30, 7); scene.add(group);
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(4000, 0, 800), new THREE.Vector3(9000, -20, 300), new THREE.Vector3(14000, 0, -500)];
  const left = new THREE.CatmullRomCurve3(pts), right = new THREE.CatmullRomCurve3(pts.map(p => p.clone().add(new THREE.Vector3(0, 0, 12))));
  const system = createTrainSystem({ scene });
  const trains = createTrains({ system, leftCurve: left, rightCurve: right, stationUs: [0.2, 0.5, 0.8], lineId: 'central', colour: 0xdc241f, group });
  return { scene, system, trains };
}
const sim = { paused: false, timeScale: 1 };
const camera = new THREE.PerspectiveCamera(); camera.position.set(7013, 140, 611);
const rec = trains => trains.map(t => [...t.position.toArray(), ...t.quaternion.toArray()]);

test('s16:R trainCull: culled trains are not posed or batched, still advance, and are posed exactly on the first frame the cull lifts', () => {
  setTrainEconomies({ batch: true, reusePose: true, cull: false });
  const A = line(), B = line(); // A is culled for a while, B never is
  assert.ok(A.trains.length > 10);
  const steps = [0.5, 1.3, 0.7, 2.1, 0.4, 3.3];
  // both systems see the same clock; the first step is shown to settle both
  updateTrains(A.system, sim, camera, 0.2); updateTrains(B.system, sim, camera, 0.2);
  const posed0 = trainPoseStats.posed, culled0 = trainPoseStats.culled, frames0 = trainBatchStats.frames;
  const before = A.trains.map(t => t.position.toArray());
  for (const dt of steps) { setTrainCulled(true); updateTrains(A.system, sim, camera, dt); setTrainCulled(false); updateTrains(B.system, sim, camera, dt); }
  assert.equal(trainPoseStats.culled - culled0, steps.length * A.trains.length, 'every train of every culled frame counted');
  // B posed each frame (B shows); A's frames posed nothing: the posed count grew only by B's
  assert.ok(trainPoseStats.posed - posed0 <= steps.length * B.trains.length, 'the culled system posed nothing');
  // the culled trains still moved (the audio reads their position), to the same curve points as the uncull system
  const moved = A.trains.filter((t, i) => t.position.toArray().some((v, k) => v !== before[i][k])).length;
  assert.ok(moved > A.trains.length * 0.5, `positions advance while culled (${moved} of ${A.trains.length})`);
  assert.ok(A.trains.every((t, i) => t.position.toArray().every((v, k) => Object.is(v, B.trains[i].position.toArray()[k]))), 'same positions as never culled');
  // the batch was not synced during the culled frames: syncBatches only ran for B's frames
  assert.ok(trainBatchStats.frames - frames0 >= steps.length, 'B synced');
  // the first frame the cull lifts: A is posed like B, number for number
  setTrainCulled(false);
  updateTrains(A.system, sim, camera, 0.9); updateTrains(B.system, sim, camera, 0.9);
  const a = rec(A.trains), b = rec(B.trains);
  a.forEach((row, i) => row.forEach((v, k) => assert.ok(Object.is(v, b[i][k]), `train ${i} value ${k}: ${v} vs ${b[i][k]}`)));
  const ma = A.trains.map(t => { t.updateMatrix(); return t.matrix.elements.slice(); }), mb = B.trains.map(t => { t.updateMatrix(); return t.matrix.elements.slice(); });
  ma.forEach((row, i) => row.forEach((v, k) => assert.ok(Object.is(v, mb[i][k]), `matrix ${i}/${k}`)));
});

test('s16:R trainCull: off (the default) changes nothing, and the flag is a plain boolean', () => {
  setTrainEconomies({ batch: true, reusePose: true, cull: false });
  assert.equal(setTrainCulled(false), false);
  const { system } = line();
  const c0 = trainPoseStats.culled;
  updateTrains(system, sim, camera, 0.5);
  assert.equal(trainPoseStats.culled, c0);
  assert.equal(setTrainCulled(1), true);
  assert.equal(setTrainCulled(0), false);
});
