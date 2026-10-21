// skate-pose.test.mjs: the mannequin on the skateboard (sprint 14Oct26w, lane D, D-053 item 2), on the real GLB in node.
// The mannequin has no texture, so GLTFLoader parses it here; the pose is the design's numbers, checked on bones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createFigure } from '../src/player/figure.js';
import { MANNEQUIN } from '../src/player/mannequin-manifest.js';
import { registerSkatePose, skateTargets, backFootPath, kickDepth, footAim, SKATE_POSE, createPlant, stepPlant } from '../src/vehicles/skate-pose.js';

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

// ── s21:T ── the pushing foot is planted on the ground (sprint 21Oct26w). Pure tests of stepPlant / backFootPath / kickDepth.
// The old fixed stroke (0.44 m back in 0.495 s whatever the board's speed) is reproduced here from the 14Oct26w numbers, so "no plant
// passed" is checked against the original and not against itself.
const oldBackFoot = (phase) => {
  const S = SKATE_POSE, g = S.ankleM + S.groundSoleLiftM - S.deckTopM;
  const from = [S.groundSlideFrom[0], g, S.groundSlideFrom[1]], to = [S.groundSlideTo[0], g, S.groundSlideTo[1]];
  const ph = ((phase % 1) + 1) % 1, mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  if (ph < S.slideShare) return mix(from, to, ph / S.slideShare);
  const u = (ph - S.slideShare) / (1 - S.slideShare), p = mix(to, from, u);
  p[1] = g + (S.ankleM + S.returnLiftM - g) * Math.sin(Math.PI * u);
  return p;
};
const oldKick = (phase) => { const ph = ((phase % 1) + 1) % 1; if (ph < SKATE_POSE.slideShare) return 1; const u = (ph - SKATE_POSE.slideShare) / (1 - SKATE_POSE.slideShare); return 1 - 0.6 * Math.sin(Math.PI * u); };
const mulberry = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('s21:T with no plant, backFootPath, kickDepth and skateTargets are the 14Oct26w numbers at 50 phases', () => {
  for (let i = 0; i < 50; i++) {
    const ph = i / 49 * 1.3 - 0.1;   // includes wrap-around values
    const a = backFootPath(ph), b = backFootPath(ph, null), c = oldBackFoot(ph);
    for (let k = 0; k < 3; k++) { assert.ok(Math.abs(a[k] - c[k]) < 1e-12, `backFootPath ${ph} ${k}`); assert.deepEqual(a, b, 'plant null is plant absent'); }
    assert.ok(Math.abs(kickDepth(ph) - oldKick(ph)) < 1e-12);
    assert.equal(kickDepth(ph), kickDepth(ph, SKATE_POSE.slideShare));
    const t = skateTargets({ push: 1, pushPhase: ph, tuck: 0 }), t2 = skateTargets({ push: 1, pushPhase: ph, tuck: 0, plant: null });
    assert.deepEqual(t2, t, 'plant null is plant absent');
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(t.footR[k] - oldBackFoot(ph)[k]) < 1e-12, 'footR is the old path at full push');
  }
  assert.equal(SKATE_POSE.reachM, SKATE_POSE.groundSlideFrom[0] - SKATE_POSE.groundSlideTo[0], 'the reach is the old stroke length');
  assert.ok(Math.abs(SKATE_POSE.reachM - 0.44) < 1e-12);
});

/** Ride a board straight at speed v for `strokes` strokes with frame lengths dtOf(); the foot's world position along and across the board. */
function ride(v, dtOf, strokes = 5) {
  const S = SKATE_POSE, period = 0.9, pl = createPlant(), rows = [];
  let t = 0, boardX = 0, td = null, lastPh = 0;
  while (t < strokes * period) {
    const dt = dtOf(); t += dt; boardX += v * dt;
    const ph = (t / period) % 1;
    stepPlant(pl, { push: 1, pushPhase: ph, travelX: v * dt, travelZ: 0 });
    const target = backFootPath(ph, pl);
    rows.push({ t, ph, boardX, travel: v * dt, contact: pl.contact, dx: pl.dx, liftPhase: pl.liftPhase, world: boardX + target[0], target, wrapped: ph < lastPh });
    lastPh = ph;
  }
  return rows;
}

test('s21:T planted: the ankle target is constant against the ground through the contact, at 1, 3, 8, 12 and 17 m/s, fixed and jittered frames', () => {
  const S = SKATE_POSE;
  for (const v of [1, 3, 8, 12, 17]) for (const jitter of [0, 0.5]) {
    const r = mulberry(v * 7 + jitter * 100);
    const rows = ride(v, () => (1 / 60) * (1 + jitter * (2 * r() - 1)), 6);
    let td = null, contactFrames = 0, strokes = 0;
    rows.forEach((row, i) => {
      if (row.wrapped) td = null;
      if (!row.contact) return;
      contactFrames++;
      // the touchdown point, in the ground's frame: the board's position when the foot went down plus the stroke's start
      const prev = rows[i - 1];
      if (td === null) { const share = row.wrapped || !prev ? Math.min(1, row.dx / Math.max(1e-12, row.travel)) : 1; td = row.boardX - row.travel * share + S.groundSlideFrom[0]; strokes++; }
      assert.ok(Math.abs(row.world - td) < 1e-9, `v ${v} jitter ${jitter} t ${row.t.toFixed(3)}: the foot moved ${(row.world - td).toExponential(2)} m against the ground`);
      assert.ok(Math.abs(row.target[2] - S.groundSlideFrom[1]) < 1e-12, 'no sideways travel, no sideways slide');
      assert.ok(row.dx <= S.reachM + 1e-12, `the leg is never asked past its reach (${row.dx})`);
    });
    assert.ok(strokes >= 5, `v ${v}: strokes seen ${strokes}`);
    assert.ok(contactFrames >= 2, `v ${v}: contact frames ${contactFrames}`);
  }
});

test('s21:T planted: contact ends at the leg\'s reach or at slideShare, whichever is first, and the return is continuous', () => {
  const S = SKATE_POSE;
  for (const v of [0.5, 1, 3, 8, 12, 17]) {
    const rows = ride(v, () => 1 / 60, 3);
    // the time to reach 0.44 m at v against the time to slideShare x 0.9 s
    const byReach = S.reachM / v, bySlide = S.slideShare * 0.9;
    const expectLift = Math.min(byReach, bySlide) / 0.9;
    const lifted = rows.find((x, i) => !x.contact && i > 0 && rows[i - 1].contact);
    assert.ok(lifted, `v ${v}: contact ended`);
    assert.ok(Math.abs(lifted.liftPhase - expectLift) < 1e-9, `v ${v}: lift at phase ${lifted.liftPhase}, expected ${expectLift}`);
    if (byReach < bySlide) assert.ok(Math.abs(lifted.dx - S.reachM) < 1e-9, `v ${v}: lifted at the reach (${lifted.dx})`);
    // continuous: at the lift phase the return starts exactly where the foot is; at the end of the loop it is back at the touchdown point
    const g = S.ankleM + S.groundSoleLiftM - S.deckTopM, pl = { contact: false, dx: lifted.dx, dz: 0, liftPhase: lifted.liftPhase, liftX: S.groundSlideFrom[0] - lifted.dx, liftZ: S.groundSlideFrom[1], lastPhase: 0, lastPush: 1 };
    const a = backFootPath(lifted.liftPhase, pl), b = backFootPath(lifted.liftPhase + 1e-9, pl), z = backFootPath(0.9999999, pl);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `v ${v}: continuous at the lift ${k}`);
    assert.ok(Math.abs(a[0] - (S.groundSlideFrom[0] - lifted.dx)) < 1e-12 && Math.abs(a[1] - g) < 1e-12);
    assert.ok(Math.abs(z[0] - S.groundSlideFrom[0]) < 1e-4 && Math.abs(z[1] - g) < 1e-4, `v ${v}: back at the touchdown point at the end of the stroke`);
    // the body's rise follows the lift, and is continuous with the contact's 1
    assert.equal(kickDepth(lifted.liftPhase - 1e-9, lifted.liftPhase), 1);
    assert.ok(Math.abs(kickDepth(lifted.liftPhase + 1e-9, lifted.liftPhase) - 1) < 1e-6);
    assert.ok(Math.abs(kickDepth(0.9999999, lifted.liftPhase) - 1) < 1e-6, 'and back to 1 at the loop');
  }
});

test('s21:T planted: no push means no plant (a new stroke starts from touchdown whenever the weight comes back)', () => {
  const pl = createPlant();
  stepPlant(pl, { push: 0, pushPhase: 0, travelX: 0.2, travelZ: 0 });
  assert.equal(pl.contact, true); assert.ok(pl.dx <= 0.2 + 1e-12);
  stepPlant(pl, { push: 0.4, pushPhase: 0.01, travelX: 0.05, travelZ: 0 });
  assert.equal(pl.contact, true); assert.ok(Math.abs(pl.dx - 0.05) < 1e-12, `the stroke starts when the weight comes back, not from the coasting (${pl.dx})`);
  // skateTargets with a plant: the pose weight lerps in as before
  const t = skateTargets({ push: 0, pushPhase: 0.3, tuck: 0, plant: pl });
  assert.deepEqual(t.footR, skateTargets({ push: 0, pushPhase: 0.3, tuck: 0 }).footR, 'push 0: the stance foot, plant or not');
});
