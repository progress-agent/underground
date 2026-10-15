// skate-pose.test.mjs: the mannequin on the skateboard (sprint 14Oct26w, lane D, D-053 item 2), on the real GLB in node.
// The mannequin has no texture, so GLTFLoader parses it here; the pose is the design's numbers, checked on bones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createFigure } from '../src/player/figure.js';
import { MANNEQUIN } from '../src/player/mannequin-manifest.js';
import { registerSkatePose, skateTargets, backFootPath, kickDepth, footAim, SKATE_POSE } from '../src/vehicles/skate-pose.js';

const buf = readFileSync(new URL('../public/models/player/UAL1_Standard-trim.glb', import.meta.url));
const parse = () => new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));

async function rider() {
  // a fresh parse per rider: a cloned skinned scene would still point at the first one's skeleton
  const fig = createFigure({ THREE, gltf: await parse(), manifest: MANNEQUIN });
  const params = { push: 0, pushPhase: 0, tuck: 0 };
  const handle = registerSkatePose(fig, THREE, params);
  const st = (extra = {}) => ({ x: 0, y: 0, z: 0, heading: 0, state: 'ground', speed: 0, clock: 0, liftM: SKATE_POSE.deckTopM, rootRoll: 0, ...extra });
  const run = (n, p = {}, target = 1) => { Object.assign(params, p); fig.setPoseOverride('skate', target); for (let i = 0; i < n; i++) fig.update(1 / 60, st()); };
  const v = new THREE.Vector3();
  const at = (name) => { fig.boneWorldPosition(name, v); return v.clone(); };
  fig.update(0, st());
  return { fig, params, handle, run, at, st };
}
const deg = (r) => r * 180 / Math.PI;
const bend = (a, b, c) => deg(Math.acos(Math.min(1, b.clone().sub(a).normalize().dot(c.clone().sub(b).normalize()))));

test('the stance is sideways with bent knees, feet 0.44 m apart on the deck, the left foot ahead', async () => {
  const r = await rider();
  r.run(60);
  // heading 0 faces -Z and the figure's left is -X, so the travel direction (its left) is -X
  const l = r.at('foot_l'), rr = r.at('foot_r'), pel = r.at('pelvis'), head = r.at('Head');
  assert.ok(l.y >= 0.20 && l.y <= 0.34 && rr.y >= 0.20 && rr.y <= 0.34, `feet ${l.y} ${rr.y}`);
  const sep = Math.hypot(l.x - rr.x, l.z - rr.z);
  assert.ok(sep >= 0.30 && sep <= 0.60, `separation ${sep}`);
  assert.ok(Math.abs((l.x - rr.x) / sep) >= 0.85, 'along the travel');
  assert.ok(l.x < rr.x, 'the left foot is ahead (travel is -X)');
  for (const s of ['l', 'r']) {
    const b = bend(r.at(`thigh_${s}`), r.at(`calf_${s}`), r.at(`foot_${s}`));
    assert.ok(b >= 15 && b <= 65, `knee ${s} ${b}`);
  }
  assert.ok(pel.y >= 0.88 && pel.y <= 1.05, `pelvis ${pel.y}`);
  assert.ok(head.y >= 1.50 && head.y <= 1.80, `head ${head.y}`);
  const box = r.fig.box(new THREE.Box3());
  assert.ok(box.min.y >= 0.08 && box.min.y <= 0.22, `mesh min ${box.min.y}`);
});

test('the push puts the back foot on the ground and brings it back through the air', async () => {
  const r = await rider();
  r.run(30, { push: 1, pushPhase: 0 });
  const ys = [], along = [];
  for (let i = 0; i < 54; i++) {
    r.run(1, { push: 1, pushPhase: i / 54 });
    ys.push(r.at('foot_r').y);
    along.push(-(r.at('foot_r').x - r.at('pelvis').x));   // along the travel (-X)
    assert.ok(r.at('foot_l').y >= 0.18 && r.at('foot_l').y <= 0.36, `front foot ${r.at('foot_l').y}`);
  }
  assert.ok(Math.min(...ys) <= 0.14, `lowest ${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) >= 0.24, `highest ${Math.max(...ys)}`);
  assert.ok(Math.max(...along) - Math.min(...along) >= 0.35, `span ${Math.max(...along) - Math.min(...along)}`);
});

test('in the air the feet stay near the board', async () => {
  const r = await rider();
  r.run(40, { push: 0, tuck: 1 });
  for (const s of ['l', 'r']) assert.ok(r.at(`foot_${s}`).y >= 0.15 && r.at(`foot_${s}`).y <= 0.50, s);
});

test('holding the pose does not add its edit again every frame', async () => {
  const r = await rider();
  r.run(30);
  const y0 = r.at('pelvis').y, x0 = r.at('foot_l').x;
  r.run(300);
  assert.ok(Math.abs(r.at('pelvis').y - y0) < 0.02, `pelvis drifted ${r.at('pelvis').y - y0}`);
  assert.ok(Math.abs(r.at('foot_l').x - x0) < 0.02);
});

test('restore() gives the clip pose back once the pose has faded out', async () => {
  const r = await rider();
  const rest = { pelvis: r.at('pelvis').y, footL: r.at('foot_l').toArray() };
  r.run(40);
  assert.ok(rest.pelvis - r.at('pelvis').y > 0.03, `posed: the pelvis dropped ${rest.pelvis - r.at('pelvis').y}`);
  r.run(40, {}, 0);
  r.handle.restore();
  r.fig.update(0, r.st());
  assert.ok(Math.abs(r.at('pelvis').y - rest.pelvis) < 0.02, `pelvis ${r.at('pelvis').y} vs ${rest.pelvis}`);
  assert.ok(Math.abs(r.at('foot_l').x - rest.footL[0]) < 0.05);
});

test('the lean rolls the figure about its own +X (into a left turn the head goes towards the back)', async () => {
  const r = await rider();
  r.run(40);
  const head0 = r.at('Head');
  r.fig.update(1 / 60, r.st({ rootRoll: -0.3 }));
  const head1 = r.at('Head');
  assert.ok(Math.abs(head1.z - head0.z) > 0.1, 'rolled about the way the board runs');
  assert.ok(Math.abs(head1.x - head0.x) < 0.1);
});

test('the pose targets are a pure function of the state', () => {
  assert.deepEqual(skateTargets({ push: 0.4, pushPhase: 0.3, tuck: 0.2 }), skateTargets({ push: 0.4, pushPhase: 0.3, tuck: 0.2 }));
  const stance = skateTargets({});
  assert.deepEqual(stance.footL, [0.22, 0.103, 0.03]);
  assert.deepEqual(stance.footR, [-0.22, 0.103, 0.03]);
  assert.equal(stance.drop, SKATE_POSE.stanceDropM);
  const air = skateTargets({ tuck: 1 });
  assert.ok(air.footL[1] > stance.footL[1] && air.drop > stance.drop);
});

test('the back foot slides on the ground then arcs back, continuous round the loop', () => {
  const ground = SKATE_POSE.ankleM + SKATE_POSE.groundSoleLiftM - SKATE_POSE.deckTopM;
  const a = backFootPath(0), m = backFootPath(0.3), e = backFootPath(SKATE_POSE.slideShare), up = backFootPath(0.77), z = backFootPath(0.999999);
  assert.ok(Math.abs(a[1] - ground) < 1e-9 && Math.abs(m[1] - ground) < 1e-9 && Math.abs(e[1] - ground) < 1e-9);
  assert.ok(up[1] > ground + 0.2, `arc ${up[1]}`);
  assert.ok(a[0] > m[0] && m[0] > e[0], 'slides back');
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(z[k] - a[k]) < 1e-3, `loop closes ${k}`);
  assert.ok(Math.abs(kickDepth(0) - kickDepth(0.999999)) < 1e-3);
  assert.equal(kickDepth(0.2), 1);
  assert.ok(kickDepth(0.77) < 0.5);
});

test('the foot aim is a unit vector turned from across the board towards the nose', () => {
  for (const yaw of [0, 0.26, Math.PI / 2]) {
    const d = footAim(yaw);
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9);
    assert.ok(d[1] < 0, 'toes below the ankle with a flat sole');
  }
  assert.ok(footAim(0)[2] > 0.8 && Math.abs(footAim(0)[0]) < 1e-9);
  assert.ok(footAim(Math.PI / 2)[0] > 0.8);
});
