// clouds-always-drawn.test.mjs: Lane C, sprint 01Oct26h (D-043).
//
// Jordan (D-042 item 2): "The clouds look great, but they are appearing and
// disappearing quite unnaturally." D-043 item 1: every cloud inside the map is
// always drawn; no distance fade, no distance or quality puff thinning; "thin
// to a third above them" is one smooth fade of the whole layer, opacity only.
//
// Pinned here, in node, on the real cloud system (createCloudSystem):
//   1. The drawn set never depends on the camera or on Automatic's quality:
//      from the street, inside the layer, above it, at the M25 edge and far
//      outside the centre, the instance buffer holds the same clouds and puffs,
//      every cloud the M25 edge fade leaves in and nothing else.
//   2. Nothing that could drop a puff is left: the uniforms and the shader.
//   3. The fade above the layer is one smooth function of the camera's height
//      (1 up to the mean top, a third's opacity a kilometre higher), the same
//      for every cloud, and it is what the shader is given.
//   4. The far fade keeps every puff inside the camera's far plane.
// The running app (the GPU's per-puff opacity through a climb and two level
// flights) is tests/clouds-no-pop.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  createCloudSystem, CLOUD_CONFIG, CAMERA_FAR_M, layerOpacity, layerMeanTopM, farFade, nearDissolve,
} from '../src/clouds.js';
import { buildCloudLayout, cloudPositionsAt, sampleEdgeFade } from '../src/clouds-field.js';

const VE = 5;
const RATIO = 1.1 / VE; // Master 1.1
const T = 900;

function system() {
  const sys = createCloudSystem({ scene: null, enabled: true });
  sys.setTimeOverride(T);
  return sys;
}
function cameraAt(p, t) {
  const cam = new THREE.PerspectiveCamera(55, 1.6, 1, CAMERA_FAR_M);
  cam.userData.masterHeightController = { ratio: RATIO };
  cam.position.set(...p);
  cam.lookAt(new THREE.Vector3(...t));
  cam.updateMatrixWorld(true);
  return cam;
}
/** The drawn clouds as a sorted list of their (x, z) at t = 0, read back from the instance buffer. */
function drawnClouds(sys) {
  const g = sys.mesh.geometry, a = g.getAttribute('aCloud'), seen = new Set();
  for (let i = 0; i < g.instanceCount; i++) seen.add(`${a.getX(i)},${a.getY(i)}`);
  return [...seen].sort();
}

// Canonical poses (x, y, z at VE5; display height is y x 0.22 at Master 1.1).
const POSES = {
  street: [[2952.9, 337.8, -732.9], [1910.1, 196.2, -783.7]],
  streetUp: [[2952.9, 337.8, -732.9], [1900, 3300, -300]],
  inLayer: [[0, 6000, 4000], [0, 6000, -6000]],
  aboveLayer: [[-2500, 14000, 9000], [1500, 2500, -6000]],
  overview: [[0, 20000, 18000], [0, 0, 0]],
  m25Edge: [[4910.7, 634.3, -18445.1], [6239.5, 102.8, -20483.9]],
  heathrow: [[-19493.3, 1606.7, 4622.3], [-22570.2, 120, 4688.2]],
  farCorner: [[26000, 3000, 24000], [-26000, 3000, -22000]],
};

test('the drawn set never depends on the camera or on Automatic (D-043)', () => {
  const sys = system();
  const L = sys.layout;
  // Expected: every cloud the M25 edge fade leaves in, by the field model alone.
  const pos = cloudPositionsAt(L, T);
  let expected = 0, expectedPuffs = 0;
  L.clouds.forEach((c, i) => { if (sampleEdgeFade(L, pos[2 * i], pos[2 * i + 1]) > 0) { expected++; expectedPuffs += c.puffs.length; } });
  // About 875 clouds and 4,150 puffs at 1.25 oktas (835 and 3,965 in the
  // plan's count, which stopped at the old 0.004 cut).
  assert.ok(expected > 780 && expected < 900, `clouds inside the map ${expected}`);
  let reference = null;
  for (const [name, [p, t]] of Object.entries(POSES)) {
    for (const quality of [null, { scale: 0.35, samples: 0, shadows: false, clouds: 'thin' }]) {
      const cam = cameraAt(p, t);
      sys.setTimeOverride(T); // forces a re-sort for this camera
      sys.update({ camera: cam, time: T, airWeight: 1, quality });
      assert.equal(sys.status.visibleClouds, expected, `${name}: clouds drawn`);
      assert.equal(sys.mesh.geometry.instanceCount, expectedPuffs, `${name}: puffs drawn`);
      const set = drawnClouds(sys);
      if (!reference) reference = set;
      assert.deepEqual(set, reference, `${name}: the same clouds`);
    }
  }
});

test('the draw order is far to near, whole clouds at a time, for any camera', () => {
  const sys = system();
  for (const [name, [p, t]] of Object.entries(POSES)) {
    const cam = cameraAt(p, t);
    sys.setTimeOverride(T);
    sys.update({ camera: cam, time: T, airWeight: 1 });
    const g = sys.mesh.geometry, a = g.getAttribute('aCloud'), d = sys.status.drift, F = 72000, o = [-36000, -33500];
    const wrap = (v, k) => o[k] + (((v - o[k]) % F) + F) % F;
    let last = Infinity, prevKey = null, runs = 0;
    for (let i = 0; i < g.instanceCount; i++) {
      const key = `${a.getX(i)},${a.getY(i)}`;
      if (key === prevKey) continue;
      runs++; prevKey = key;
      const x = wrap(a.getX(i) + d.x, 0), z = wrap(a.getY(i) + d.z, 1);
      const dy = a.getZ(i) * RATIO * VE + a.getW(i) / 2 - p[1] * RATIO;
      const dist = Math.hypot(x - p[0], z - p[2], dy);
      assert.ok(dist <= last + 1e-3, `${name}: cloud ${runs} nearer than the one before it`);
      last = dist;
    }
    assert.equal(runs, sys.status.visibleClouds, `${name}: each cloud's puffs are contiguous`);
  }
});

/**
 * The instance buffer is a whole packing of the clouds it holds: each cloud
 * once, its puffs contiguous, bottom-up or top-down as the camera is above or
 * below its middle, clouds far to near. Returns the clouds' indices.
 */
function checkPacking(sys, cam, label) {
  const g = sys.mesh.geometry, aC = g.getAttribute('aCloud'), aP = g.getAttribute('aPuff');
  const L = sys.layout, d = sys.status.drift, byKey = new Map(L.clouds.map((c, i) => [`${Math.fround(c.cx)},${Math.fround(c.cz)}`, i]));
  const F = 72000, o = [-36000, -33500], wrap = (v, k) => o[k] + (((v - o[k]) % F) + F) % F;
  const seen = new Set();
  let i = 0, last = Infinity;
  const p = cam.position;
  while (i < g.instanceCount) {
    const ci = byKey.get(`${aC.getX(i)},${aC.getY(i)}`);
    assert.ok(ci !== undefined, `${label}: unknown cloud at ${i}`);
    assert.ok(!seen.has(ci), `${label}: cloud ${ci} twice`);
    seen.add(ci);
    const c = L.clouds[ci], x = wrap(c.cx + d.x, 0), z = wrap(c.cz + d.z, 1);
    const dy = c.base * RATIO * VE + c.height / 2 - p.y * RATIO;
    const dist = Math.hypot(x - p.x, z - p.z, dy);
    assert.ok(dist <= last + 1, `${label}: cloud ${ci} out of order`);
    last = dist;
    const puffs = dy > 0 ? [...c.puffs].reverse() : c.puffs;
    for (const q of puffs) {
      assert.ok(aP.getX(i) === Math.fround(q.dx) && aP.getY(i) === Math.fround(q.dy) && aP.getZ(i) === Math.fround(q.dz), `${label}: cloud ${ci} puffs`);
      i++;
    }
  }
  return [...seen];
}

test('re-sorts that re-pack only the stretch that changed always leave a whole packing', () => {
  // A long flight with the clock running, so clouds drift in and out across
  // the edge too: a second of wind a step, the camera moving 60 m a step, with
  // two long jumps that re-order everything.
  const flown = system();
  let rewrites = 0, partial = 0;
  for (let k = 0; k <= 240; k++) {
    const t = 900 + k;
    const jump = k === 80 ? 9000 : k >= 160 ? -7000 : 0;
    const cam = cameraAt([-7000 + k * 60 + jump, 3000 + 20 * k, -6000 + 3000 * Math.sin(k / 30)], [0, 0, 0]);
    const before = flown.status.rewrites ?? 0;
    flown.setTimeOverride(t);
    flown.update({ camera: cam, time: t, airWeight: 1 });
    if ((flown.status.rewrites ?? 0) > before) { rewrites++; if (flown.status.rewrittenPuffs < flown.status.instances) partial++; }
    const drawn = checkPacking(flown, cam, `step ${k}`);
    assert.equal(drawn.length, flown.status.visibleClouds);
    if (k % 40 === 0) {
      // Against a system packed once here: the same clouds, except any the
      // inside-the-map list (re-made every 25 m of drift) has yet to catch, all
      // at an edge fade of almost nothing.
      const fresh = system();
      fresh.setTimeOverride(t);
      fresh.update({ camera: cam, time: t, airWeight: 1 });
      const want = new Set(checkPacking(fresh, cam, `fresh ${k}`)), got = new Set(drawn);
      const pos = cloudPositionsAt(flown.layout, t);
      for (const ci of [...want].filter(x => !got.has(x)).concat([...got].filter(x => !want.has(x)))) {
        assert.ok(sampleEdgeFade(flown.layout, pos[2 * ci], pos[2 * ci + 1]) < 0.002, `step ${k}: cloud ${ci}`);
      }
    }
  }
  console.log(`rewrites ${rewrites}, partial ${partial}`);
  assert.ok(rewrites > 100 && partial > 20, `rewrites ${rewrites}, partial ${partial}`);
});

test('nothing left that drops a puff: no keep, thinning, distance detail or cull uniforms', () => {
  const sys = system();
  const u = Object.keys(sys.material.uniforms);
  for (const gone of ['uKeep', 'uThinAlpha', 'uThinOn', 'uThinKeep', 'uLod', 'uFarKeep', 'uFade']) assert.ok(!u.includes(gone), gone);
  for (const kept of ['uLayer', 'uFar', 'uOpacity', 'uEdge']) assert.ok(u.includes(kept), kept);
  // The vertex shader collapses a puff only for the air weight, the M25 edge or the far plane.
  const vs = sys.material.vertexShader;
  assert.equal((vs.match(/collapsed: no fragments/g) || []).length, 1);
  assert.match(vs, /if \( uOpacity <= 0\.0 \|\| !shown \)/);
  assert.match(vs, /bool shown = edge > 0\.0 && far > 0\.0;/);
  assert.match(vs, /vAlpha = uOpacity \* uLayer \* edge \* far \* near;/);
  assert.ok(!/aMisc\.x\s*>/.test(vs), 'no puff rank comparison');
  // No puff carries a rank any more; no preset field asks for thinning.
  assert.ok(sys.layout.clouds.every(c => c.puffs.every(p => !('rank' in p))));
  assert.ok(!('thinAbove' in sys.preset));
  // Automatic's quality has no say: the same uniforms with and without a level.
  const cam = cameraAt(...POSES.street);
  sys.update({ camera: cam, time: T, airWeight: 1, quality: null });
  const a = JSON.stringify(Object.fromEntries(u.map(k => [k, sys.material.uniforms[k].value?.toArray?.() ?? sys.material.uniforms[k].value?.uuid ?? sys.material.uniforms[k].value])));
  sys.update({ camera: cam, time: T, airWeight: 1, quality: { scale: 0.35, samples: 0, shadows: false, clouds: 'thin' } });
  const b = JSON.stringify(Object.fromEntries(u.map(k => [k, sys.material.uniforms[k].value?.toArray?.() ?? sys.material.uniforms[k].value?.uuid ?? sys.material.uniforms[k].value])));
  assert.equal(b, a);
});

test('one fade of the whole layer above it: smooth, to a third, by the camera height alone', () => {
  const L = buildCloudLayout();
  const top = layerMeanTopM(L, RATIO);
  // The mean top at Master 1.1: mean base x Master plus mean height (true size).
  assert.ok(Math.abs(top - (L.meanBaseM * 1.1 + 2 * L.meanHalfHeightM)) < 1e-9);
  assert.ok(top > 1600 && top < 1900, `mean top ${top}`);
  const A = CLOUD_CONFIG.above;
  assert.equal(A.spanM, 1000);
  assert.equal(layerOpacity(0, top), 1);
  assert.equal(layerOpacity(top, top), 1);
  assert.ok(Math.abs(layerOpacity(top + 1000, top) - A.alpha) < 1e-12);
  assert.ok(Math.abs(layerOpacity(top + 5000, top) - A.alpha) < 1e-12);
  // Monotone and smooth: no step anywhere in the climb. In 1 m steps the largest
  // change is what the eased curve allows (about 0.4% of the opacity a metre).
  let prev = layerOpacity(top - 100, top), worst = 0;
  for (let y = top - 99; y <= top + 1100; y++) {
    const v = layerOpacity(y, top);
    assert.ok(v <= prev + 1e-12, `rises at ${y}`);
    worst = Math.max(worst, prev - v);
    prev = v;
  }
  assert.ok(worst < 0.005, `largest change per metre ${worst}`);
  // Geometric in the opacity: halfway up, the square root of the end opacity.
  assert.ok(Math.abs(layerOpacity(top + 500, top) - Math.sqrt(A.alpha)) < 1e-9);
  // The system hands the shader exactly this value, for the camera's display height.
  const sys = system();
  for (const y of [300, 6000, (top + 250) / RATIO, (top + 600) / RATIO, 20000]) {
    const cam = cameraAt([1000, y, 2000], [1000, y - 100, 1000]);
    sys.update({ camera: cam, time: T, airWeight: 1 });
    assert.ok(Math.abs(sys.material.uniforms.uLayer.value - layerOpacity(y * RATIO, top)) < 1e-12);
    assert.equal(sys.status.layer, sys.material.uniforms.uLayer.value);
  }
  // Measurement switch: off gives the unthinned layer.
  sys.setThinning(false);
  sys.update({ camera: cameraAt([0, 20000, 0], [0, 0, -1]), time: T, airWeight: 1 });
  assert.equal(sys.material.uniforms.uLayer.value, 1);
});

test('the far fade keeps every puff inside the far plane, and starts beyond 40 km', () => {
  const [a, b] = CLOUD_CONFIG.farFadeM;
  assert.ok(a >= 40000 && b <= 49500 && b - a >= 5000, `far fade ${a}..${b}`);
  assert.equal(farFade(a - 1), 1);
  assert.equal(farFade(b), 0);
  // The main camera's far plane is the one this assumes.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, new RegExp(`new THREE\\.PerspectiveCamera\\(55, [^,]+, 1\\.0, ${CAMERA_FAR_M}\\)`));
  // A puff's centre lies at most `reach` display metres from its cloud's centre
  // (bodies are true size), and sprites face the camera, so a puff whose cloud
  // has faded out at b is still nearer than b + reach < the far plane.
  const L = buildCloudLayout();
  let reach = 0;
  for (const c of L.clouds) for (const p of c.puffs) reach = Math.max(reach, Math.hypot(p.dx, p.dz, p.dy - c.height / 2));
  assert.ok(b + reach < CAMERA_FAR_M, `fade ends ${b}, reach ${reach.toFixed(0)}`);
});

test('the near dissolve is the only per-puff term, and it is continuous', () => {
  for (const r of [132, 300, 720]) {
    assert.equal(nearDissolve(0, r), 0);
    assert.equal(nearDissolve(r * 2.2, r), 1);
    // Its steepest change is 1.5 / (1.6 r) per metre (a smoothstep over 1.6 r).
    let worst = 0;
    for (let d = 0; d < r * 2.5; d += 0.5) worst = Math.max(worst, Math.abs(nearDissolve(d + 0.5, r) - nearDissolve(d, r)) / 0.5);
    assert.ok(worst <= 1.5 / (1.6 * r) + 1e-9, `r ${r}: ${worst}`);
  }
});
