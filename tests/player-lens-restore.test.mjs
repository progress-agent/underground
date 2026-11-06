import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOnFoot } from '../src/player/on-foot.js';
import { BLEND_S } from '../src/player/third-person.js';

function fixture() {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1, 50000);
  camera.filmGauge = 36;
  camera.position.set(0, 9, 0);
  let mm = 22, phase = 'body';
  const lens = { get: () => mm, preferred: () => 30,
    set(value) { mm = value; camera.setFocalLength(value); } };
  lens.set(mm);
  const ctx = { THREE, camera, masterHeight: { ratio: 0.2 }, lens,
    player: { loaded: true, update() {}, project() {} }, collision: { groundHeightAt: () => 0, waterAt: () => null }, look: { setMode() {} } };
  const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'ground' };
  const view = createOnFoot({ ctx, body, P: { easeTime: 1 }, VE: 5,
    getPhase: () => phase, getRegime: () => 'bore',
    look: { get: () => ({ yaw: 0, pitch: 0 }), set() {} } });
  view.activate(); view.postUpdate(1);
  return { view, lens, camera, enterTunnel() { phase = 'tunnel'; view.preUpdate(0); } };
}

// A legitimate last frame can leave less than the old 1e-6 mm exit tolerance.
// That tiny residual still changes hundreds of pixels at the G1 reference pose.
for (const finish of [false, true]) {
  test(`leaving Pedestrian restores the exact preferred lens after a ${finish ? 'completed' : 'cut-short'} view blend`, () => {
    const { view, lens, camera, enterTunnel } = fixture();
    enterTunnel();
    const k = 1 - Math.cbrt(9e-7 / 8); // 22 -> 30 mm, 0.0000009 mm short
    let remaining = BLEND_S.forced * k;
    while (remaining > 0.05) { view.postUpdate(0.05); remaining -= 0.05; }
    view.postUpdate(remaining);
    assert.ok(lens.get() < 30 && 30 - lens.get() < 1e-6);
    if (finish) view.postUpdate(0.01);
    view.deactivate();
    assert.equal(lens.get(), 30);
    const expected = camera.clone(); expected.setFocalLength(30);
    assert.deepEqual(camera.projectionMatrix.elements, expected.projectionMatrix.elements);
  });
}
