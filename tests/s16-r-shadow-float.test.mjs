// s16-r-shadow-float.test.mjs: the shadowFloat economy of lane R (sprint 16Oct26f, D-054): the shadow cache compares what
// the GPU receives (float32), so a last-bit float64 wobble of the fit's target repeats nothing, and a one-texel move
// is never taken for the same map. Off, the comparison is the 07391f3 exact one.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createShadowCache } from '../src/shadow-cache.js';

// ── the shadow cache ─────────────────────────────────────────────────────────
const bump = x => { const f = new Float64Array([x]); const u = new BigUint64Array(f.buffer); u[0] += 1n; return f[0]; };
function rig() {
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  const c = light.shadow.camera; c.left = -1500; c.right = 1500; c.top = 1500; c.bottom = -1500; c.near = 1; c.far = 9000; c.updateProjectionMatrix();
  light.shadow.map = {}; // a map exists
  const scene = new THREE.Scene(); scene.add(light, light.target);
  const renderer = { shadowMap: { needsUpdate: true } };
  const cache = createShadowCache({ renderer, light });
  const place = (tx, ty, tz) => { light.target.position.set(tx, ty, tz); light.position.set(tx + 3000, ty + 5000, tz - 2000); };
  const frame = (args = {}) => { renderer.shadowMap.needsUpdate = true; const skipped = cache.update({ enabled: true, active: true, heightScale: 1, casterVersion: 7, settled: true, ...args }); return { skipped, requested: renderer.shadowMap.needsUpdate }; };
  return { cache, place, frame, light };
}

test('s16:R shadowFloat: a last-bit wobble of the target repeats nothing with float32 on and renders with it off', () => {
  for (const [on, expectSkip] of [[true, true], [false, false]]) {
    const { cache, place, frame } = rig();
    cache.setFloat32(on);
    place(5175.2055123301, 12, -940.3333); assert.equal(frame().skipped, false, 'first frame renders');
    place(bump(5175.2055123301), 12, -940.3333);
    assert.equal(frame().skipped, expectSkip, `float32 ${on}: a one-ulp wobble ${expectSkip ? 'is' : 'is not'} the same map`);
    place(5175.2055123301, 12, -940.3333);
    assert.equal(frame().skipped, expectSkip);
  }
});

test('s16:R shadowFloat: a one-texel move of the target is never the same, with it on or off', () => {
  const texel = (2 * 1500) / 4096;
  for (const on of [true, false]) {
    const { cache, place, frame } = rig();
    cache.setFloat32(on);
    place(5175.2055123301, 12, -940.3333); frame();
    place(5175.2055123301 + texel, 12, -940.3333);
    assert.equal(frame().skipped, false, `float32 ${on}: moved one texel`);
    place(5175.2055123301 + texel, 12, -940.3333 + texel);
    assert.equal(frame().skipped, false);
    place(5175.2055123301 + texel, 12, -940.3333 + texel);
    assert.equal(frame().skipped, true, 'and then still, it is the same');
  }
});

test('s16:R shadowFloat: off, the comparison is the 07391f3 exact one (signature has no light-space matrices)', () => {
  const { cache, place, frame } = rig();
  assert.equal(cache.float32, false);
  place(1, 2, 3); frame(); place(1, 2, 3);
  assert.equal(frame().skipped, true, 'an identical frame is skipped');
  cache.setFloat32(true); place(1, 2, 3);
  assert.equal(frame().skipped, false, 'a change of mode forgets the last signature');
  assert.equal(frame().skipped, true);
});

