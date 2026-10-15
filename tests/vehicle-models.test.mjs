// vehicle-models.test.mjs: the skateboard, the Drone and the Balloon as models (sprint 14Oct26w, lane D, D-053 items 2
// and 3): true sizes, triangle counts, no per-instance colour (D-015), and every moving part a function of the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { createDroneModel, droneBladeAngle, DRONE } from '../src/vehicles/drone-model.js';
import { createBalloonModel, balloonFlameLength, envelopeRadius, BALLOON } from '../src/vehicles/balloon-model.js';
import { createBoardModel, ollieNoseUp, BOARD } from '../src/vehicles/board-model.js';

const box = (obj) => new THREE.Box3().expandByObject(obj, true);
const size = (obj) => box(obj).getSize(new THREE.Vector3());
const tris = (obj) => { let n = 0; obj.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; };
const everyMesh = (obj, fn) => obj.traverse((o) => { if (o.isMesh) fn(o); });

test('the drone is about half a metre across and a few hundred triangles', () => {
  const d = createDroneModel({ THREE });
  d.update({ x: 10, y: 20, z: -5, yaw: 0, pitch: 0, roll: 0 }, 0);
  const s = size(d.group);
  assert.ok(Math.max(s.x, s.z) >= 0.45 && Math.max(s.x, s.z) <= 0.60, `across ${s.x} x ${s.z}`);
  assert.ok(s.y >= 0.05 && s.y <= 0.16, `height ${s.y}`);
  const c = box(d.group).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x - 10) < 0.05 && Math.abs(c.z + 5) < 0.05, `centre ${c.x}, ${c.z}`);
  const n = tris(d.group);
  assert.ok(n >= 150 && n <= 1500, `triangles ${n}`);
  assert.equal(d.triangles, n);
});

test('the drone keeps its size at any pitch, bank and yaw (a real-metre body)', () => {
  const d = createDroneModel({ THREE });
  d.update({ x: 0, y: 0, z: 0, yaw: 1.2, pitch: 0.3, roll: -0.4 }, 3);
  const diag = (b) => b.min.distanceTo(b.max);
  const b = box(d.group);
  assert.ok(diag(b) > 0.5 && diag(b) < 0.9, `diagonal ${diag(b)}`);
});

test('the rotors turn as a function of the clock alone', () => {
  assert.equal(droneBladeAngle(0, 0), 0);
  assert.equal(droneBladeAngle(2, 1), 2 * DRONE.rotorHz + DRONE.rotorStepRad);
  const a = createDroneModel({ THREE }), b = createDroneModel({ THREE });
  a.update({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, 1.234);
  b.update({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, 1.234);
  assert.deepEqual(a.debug().bladeAngles, b.debug().bladeAngles);
  b.update({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, 1.30);
  assert.notDeepEqual(a.debug().bladeAngles, b.debug().bladeAngles);
  assert.deepEqual(a.blades.map((m) => m.rotation.y), a.debug().bladeAngles);
});

test('the balloon envelope is 16 m wide and 16.5 m tall with its mouth 3.4 m up, the whole thing under 20.8 m', () => {
  const m = createBalloonModel({ THREE });
  m.update({ x: 0, y: 0, z: 0, swayRoll: 0, swayPitch: 0, burner: false }, 0);
  const e = size(m.envelope);
  assert.ok(Math.max(e.x, e.z) >= 15 && Math.max(e.x, e.z) <= 17, `width ${e.x} x ${e.z}`);
  assert.ok(e.y >= 15.5 && e.y <= 17.5, `height ${e.y}`);
  const eb = box(m.envelope);
  assert.ok(eb.min.y >= 3.0 && eb.min.y <= 3.8, `mouth ${eb.min.y}`);
  const wb = box(m.group);
  assert.ok(wb.max.y >= 19.0 && wb.max.y <= 20.8, `top ${wb.max.y}`);
  assert.ok(Math.abs(wb.min.y) < 1e-6, 'the basket floor sits on the origin');
});

test('the balloon is about 1,350 triangles, with a vertex-coloured envelope and no instance colour', () => {
  const m = createBalloonModel({ THREE });
  const n = tris(m.group);
  assert.ok(n >= 1200 && n <= 1500, `triangles ${n}`);
  assert.ok(m.envelope.geometry.attributes.color, 'vertex colours');
  assert.equal(m.envelope.material.vertexColors, true);
  everyMesh(m.group, (o) => { assert.ok(!o.isInstancedMesh && !o.instanceColor, o.name); });
  everyMesh(createDroneModel({ THREE }).group, (o) => { assert.ok(!o.isInstancedMesh && !o.instanceColor); });
});

test('the basket is 1.5 m with walls 1.10 m high, and the inner wall is 0.69 m from the centre', () => {
  const m = createBalloonModel({ THREE });
  const baskets = [];
  m.group.traverse((o) => { if (o.name === 'player-balloon-basket') baskets.push(o); });
  m.update({ x: 0, y: 0, z: 0, swayRoll: 0, swayPitch: 0, burner: false }, 0);
  const bb = new THREE.Box3();
  for (const b of baskets) bb.expandByObject(b, true);
  const s = bb.getSize(new THREE.Vector3());
  assert.ok(Math.abs(s.x - BALLOON.basketM) < 1e-6 && Math.abs(s.z - BALLOON.basketM) < 1e-6);
  assert.ok(Math.abs(s.y - BALLOON.wallHeightM) < 1e-6);
  assert.ok(Math.abs(BALLOON.basketM / 2 - BALLOON.wallThicknessM - BALLOON.innerHalfM) < 0.025);
});

test('the flame is a function of the clock: same time, same length; shown only while the burner fires', () => {
  assert.equal(balloonFlameLength(1.5), balloonFlameLength(1.5));
  assert.notEqual(balloonFlameLength(1.5), balloonFlameLength(1.6));
  for (let t = 0; t < 10; t += 0.07) { const l = balloonFlameLength(t); assert.ok(l > 0.8 && l < 1.6, `${t}: ${l}`); }
  const m = createBalloonModel({ THREE });
  m.update({ x: 0, y: 0, z: 0, swayRoll: 0, swayPitch: 0, burner: true }, 2);
  assert.equal(m.burnerFlame, true);
  assert.equal(m.flame.visible, true);
  assert.equal(m.flame.scale.y, balloonFlameLength(2));
  m.update({ x: 0, y: 0, z: 0, swayRoll: 0, swayPitch: 0, burner: false }, 2.1);
  assert.equal(m.burnerFlame, false);
  assert.equal(m.flame.visible, false);
});

test('the envelope profile is the design lathe: widest 8 m, mouth radius under 2.4 m', () => {
  let max = 0;
  for (let i = 0; i <= 24; i++) max = Math.max(max, envelopeRadius(i / 24));
  assert.ok(max > 7.9 && max <= 8.0001, `max radius ${max}`);
  assert.ok(envelopeRadius(0) < 2.4);
});

// A stand-in for the Kenney board (0.30 x 0.137 x 0.70 m, 240 triangles) without the texture the node loader cannot read.
function fakeBoard() {
  const g = new THREE.BoxGeometry(0.30, 0.137, 0.70);
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
  return { scene, animations: [] };
}

test('the board is 0.80 m long with its wheels on the ground and the deck top at 0.157 m', () => {
  const b = createBoardModel({ THREE, gltf: fakeBoard() });
  b.update({ x: 4, y: 7, z: -3, heading: 0, lean: 0, airT: 0 });
  const bb = box(b.group), s = bb.getSize(new THREE.Vector3());
  assert.ok(s.z >= 0.76 && s.z <= 0.84, `long ${s.z}`);
  assert.ok(Math.abs(bb.min.y - 7) < 1e-6, 'sole on the feet point');
  assert.ok(Math.abs(s.y - 0.157) < 0.01, `deck top ${s.y}`);
  const c = bb.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x - 4) < 1e-6 && Math.abs(c.z + 3) < 1e-6);
});

test('the board turns with its heading, rolls with the lean, and noses up for a quarter second of an ollie', () => {
  const b = createBoardModel({ THREE, gltf: fakeBoard() });
  b.update({ x: 0, y: 0, z: 0, heading: Math.PI / 2, lean: 0, airT: 0 });
  const s = size(b.group);
  assert.ok(s.x > 0.76 && s.z < 0.4, `long axis along X after a quarter turn: ${s.x} x ${s.z}`);
  assert.equal(ollieNoseUp(0), 0);
  assert.equal(ollieNoseUp(BOARD.ollieNoseUpS), 0);
  assert.ok(Math.abs(ollieNoseUp(BOARD.ollieNoseUpS / 2) - BOARD.ollieNoseUpRad) < 1e-9);
  assert.equal(ollieNoseUp(0.5), 0);
  assert.equal(b.triangles, 12);
});

test('no model code draws a random number, uses instance colour, or masks a layer', () => {
  const dir = new URL('../src/vehicles/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/Math\.random/.test(src), `${f}: Math.random`);
    assert.ok(!/setColorAt|instanceColor/.test(src), `${f}: instance colour`);
    assert.ok(!/\blayers\./.test(src), `${f}: layer masks`);
    assert.ok(!/from 'three\/addons/.test(src), `${f}: three/addons`);
  }
});
