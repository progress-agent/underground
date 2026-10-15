// skate-body.test.mjs: the skateboard's physics, pinned against a fake world (sprint 14Oct26w, lane D, D-053 item 2).
// The numbers are the design's: 12 m/s cruising reached in 12 / 7 = 1.714 s, Shift 18 m/s, coast 0.9 m/s per second,
// brake 12 more, steer 2.1 rad/s x (0.35 + 0.65 min(1, v / 5)), lean 0.04 rad per m/s to 20 degrees, ollie 4 m/s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEDESTRIAN_TUNABLES, createBody } from '../src/modes/pedestrian-body.js';
import {
  SKATE_TUNABLES, SKATE_DEFAULTS, createSkate, stepSkate, canBoard, topSpeed, REFUSALS,
} from '../src/modes/skate-body.js';

const VE = 5;
const P = Object.fromEntries(PEDESTRIAN_TUNABLES.map((d) => [d.key, d.default]));
const K = { ...SKATE_DEFAULTS };

/** A flat street at y = 0, optionally with a wall (x >= wallX blocks), a river (z > riverZ) and a roof. */
function world({ wallX = null, riverZ = null } = {}) {
  return {
    moveAndSlide(pos, delta) {
      let x = pos.x + delta.x, hit = false, normalX = 0;
      if (wallX !== null && x > wallX - 0.35) { x = wallX - 0.35; hit = true; normalX = -1; }
      return { x, y: pos.y, z: pos.z + delta.z, hit, normalX, normalZ: 0 };
    },
    standHeightAt: (x, z) => (riverZ !== null && z > riverZ ? -10 * VE : 0),
    waterAt: (x, z) => (riverZ !== null && z > riverZ ? { surfaceY: 0, bedY: -10 * VE } : null),
  };
}

function ride(opts = {}) {
  const sk = createSkate(), body = createBody(), w = world(opts);
  sk.on = true;
  return { sk, body, w, events: [] };
}
const step = (r, input, dt = 1 / 60) => stepSkate(r.sk, r.body, { forward: 0, steer: 0, shift: false, ollie: false, ...input }, dt, r.w, P, VE, r.events, K);
function run(r, input, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(r, input, dt);
}
function timeToSpeed(hz, target, input = { forward: 1 }, k = K) {
  const r = ride(); const dt = 1 / hz;
  for (let i = 1; i < 20 * hz; i++) {
    stepSkate(r.sk, r.body, { forward: 0, steer: 0, shift: false, ollie: false, ...input }, dt, r.w, P, VE, r.events, k);
    if (r.sk.v >= target - 1e-9) return i * dt;
  }
  return Infinity;
}

test('the Physics section carries the nine board tunables with the design defaults', () => {
  assert.deepEqual(SKATE_TUNABLES.map((d) => d.key), ['top', 'boost', 'push', 'coast', 'brake', 'steer', 'lean', 'maxLean', 'ollie']);
  assert.deepEqual(SKATE_DEFAULTS, { top: 12, boost: 1.5, push: 7, coast: 0.9, brake: 12, steer: 2.1, lean: 0.04, maxLean: 20, ollie: 4 });
  for (const d of SKATE_TUNABLES) assert.ok(d.default >= d.min && d.default <= d.max, d.key);
});

test('W from rest reaches 12 m/s in 12 / 7 = 1.714 s at 30, 60 and 120 Hz, within one frame', () => {
  for (const hz of [30, 60, 120]) {
    const t = timeToSpeed(hz, 12);
    assert.ok(Math.abs(t - 12 / 7) <= 1 / hz + 1e-9, `${hz} Hz: ${t}`);
  }
});

test('Shift raises the top to 18 m/s (1.5x), reached in 18 / 7 = 2.571 s, and never beyond', () => {
  const t = timeToSpeed(60, 18, { forward: 1, shift: true });
  assert.ok(Math.abs(t - 18 / 7) <= 1 / 60 + 1e-9, `t ${t}`);
  const r = ride();
  run(r, { forward: 1, shift: true }, 6);
  assert.ok(Math.abs(r.sk.v - 18) < 1e-9, `v ${r.sk.v}`);
  assert.equal(topSpeed(K, true), 18);
  assert.equal(topSpeed(K, false), 12);
});

test('the speed never passes the top, and letting Shift go eases it back at the coast rate', () => {
  const r = ride();
  run(r, { forward: 1, shift: true }, 5);
  run(r, { forward: 1, shift: false }, 1);
  assert.ok(Math.abs(r.sk.v - (18 - 0.9)) < 0.02, `v ${r.sk.v}`);
  run(r, { forward: 1 }, 10);
  assert.ok(Math.abs(r.sk.v - 12) < 1e-9);
});

test('coasting loses 0.9 m/s each second, and braking 12 m/s more', () => {
  const r = ride();
  run(r, { forward: 1 }, 3);
  assert.equal(r.sk.v, 12);
  run(r, {}, 2);
  assert.ok(Math.abs(r.sk.v - 10.2) < 0.02, `coast ${r.sk.v}`);
  const b = ride();
  run(b, { forward: 1 }, 3);
  let t = 0;
  for (; b.sk.v > 0.1 && t < 5; t += 1 / 60) step(b, { forward: -1 }, 1 / 60);
  assert.ok(t > 0.85 && t < 1.0, `braking from 12 took ${t} s (12 / 12.9 = 0.93)`);
  run(b, { forward: -1 }, 1);
  assert.equal(b.sk.v, 0, 'braking holds at rest, never reverses');
});

test('the steer law: rate x 2.1 x (0.35 + 0.65 min(1, v / 5)), left positive', () => {
  for (const v0 of [0, 1, 2.5, 5, 12]) {
    const r = ride(); r.sk.v = v0;
    const h0 = r.sk.heading;
    // one step with W held at the top so the speed is unchanged for v0 = 12; for the rest measure the actual v
    stepSkate(r.sk, r.body, { forward: 0, steer: 1, shift: false, ollie: false }, 1 / 60, r.w, P, VE, r.events, { ...K, coast: 0 });
    const expect = 2.1 * (0.35 + 0.65 * Math.min(1, v0 / 5)) / 60;
    assert.ok(Math.abs((r.sk.heading - h0) - expect) < 1e-9, `v ${v0}: ${r.sk.heading - h0} vs ${expect}`);
  }
  const d = ride(); d.sk.v = 8;
  stepSkate(d.sk, d.body, { forward: 0, steer: -1, shift: false, ollie: false }, 1 / 60, d.w, P, VE, d.events, { ...K, coast: 0 });
  assert.ok(d.sk.heading < 0, 'D turns right (heading falls)');
});

test('half a second of A at speed turns about one radian to the left, and leans 0.34 of it', () => {
  const r = ride();
  run(r, { forward: 1 }, 2);
  const h0 = r.sk.heading;
  run(r, { forward: 1, steer: 1 }, 0.5);
  const turned = r.sk.heading - h0;
  assert.ok(turned > 0.95 && turned < 1.15, `turned ${turned}`);
  assert.ok(r.sk.lean > 0.30 && r.sk.lean <= (20 * Math.PI) / 180 + 1e-9, `lean ${r.sk.lean}`);
});

test('the lean clamps at maxLean, follows the sign of the steer, and relaxes to level', () => {
  const r = ride();
  run(r, { forward: 1 }, 2);
  run(r, { forward: 1, steer: 1 }, 2);
  assert.ok(Math.abs(r.sk.lean - (20 * Math.PI) / 180) < 1e-3, `left ${r.sk.lean}`);
  run(r, { forward: 1, steer: -1 }, 2);
  assert.ok(Math.abs(r.sk.lean + (20 * Math.PI) / 180) < 1e-3, `right ${r.sk.lean}`);
  run(r, { forward: 1 }, 2);
  assert.ok(Math.abs(r.sk.lean) < 1e-3, `level ${r.sk.lean}`);
  // a slow board leans by speed x 0.04, not the full amount
  const s = ride(); s.sk.v = 3; s.body.vz = -3;
  for (let i = 0; i < 240; i++) stepSkate(s.sk, s.body, { forward: 1, steer: 1, shift: false, ollie: false }, 1 / 240, s.w, P, VE, s.events, { ...K, push: 0, coast: 0 });
  assert.ok(Math.abs(s.sk.lean - 3 * 0.04) < 0.005, `slow lean ${s.sk.lean}`);
});

test('Space is an ollie from the ground only: 0.82 m high, 0.82 s in the air, and never a jetpack', () => {
  const r = ride();
  run(r, { forward: 1 }, 2);
  let peak = 0, air = 0, jetEver = false;
  step(r, { forward: 1, ollie: true });
  assert.equal(r.body.state, 'air');
  for (let i = 0; i < 240 && r.body.state === 'air'; i++) {
    step(r, { forward: 1, ollie: false });
    peak = Math.max(peak, r.body.y / VE);
    air += 1 / 60;
    jetEver = jetEver || r.body.jet;
  }
  assert.ok(peak > 0.7 && peak < 0.95, `apex ${peak}`);
  assert.ok(air > 0.7 && air < 0.95, `air ${air}`);
  assert.equal(jetEver, false);
  assert.equal(r.body.state, 'ground');
  // an ollie edge in the air does nothing: no double jump, no jetpack from the held key
  const a = ride();
  step(a, { ollie: true });
  for (let i = 0; i < 20; i++) step(a, { ollie: true });
  assert.equal(a.body.jet, false);
  assert.ok(a.body.y / VE < 1, 'no second jump');
});

test('in the air the speed and the heading hold; a landing keeps the speed', () => {
  const r = ride();
  run(r, { forward: 1 }, 2);
  step(r, { forward: 1, ollie: true });
  const v0 = r.sk.v, h0 = r.sk.heading;
  for (let i = 0; i < 20; i++) step(r, { forward: -1, steer: 1 });
  assert.equal(r.body.state, 'air');
  assert.equal(r.sk.v, v0, 'S does not brake in the air');
  assert.equal(r.sk.heading, h0, 'A does not steer in the air');
  assert.ok(r.sk.tuck > 0.9, 'crouched in the air');
  assert.equal(r.sk.lean, r.sk.lean);
  run(r, { forward: 1 }, 1);
  assert.equal(r.body.state, 'ground');
  assert.ok(r.sk.v >= 0.85 * v0, `landing speed ${r.sk.v} vs ${v0}`);
});

test('a facade takes the speed off: the board stops at the wall and v follows the body', () => {
  const r = ride({ wallX: 30 });
  r.sk.heading = -Math.PI / 2;   // yaw -PI/2 faces +X
  run(r, { forward: 1 }, 6);
  assert.ok(r.body.x <= 30 - 0.35 + 1e-6, `x ${r.body.x}`);
  assert.ok(r.sk.v < 0.05, `v ${r.sk.v}`);
  assert.equal(r.body.state, 'ground');
  assert.equal(r.sk.on, true);
});

test('riding into the river drops the board: swim state, off, lastDrop water', () => {
  const r = ride({ riverZ: 20 });
  r.sk.heading = Math.PI;   // yaw PI faces +Z
  run(r, { forward: 1 }, 6);
  assert.equal(r.body.state, 'swim');
  assert.equal(r.sk.on, false);
  assert.equal(r.sk.lastDrop, 'water');
  assert.equal(r.sk.v, 0);
});

test('the push runs while W is held below the top, with a 0.9 s stroke, and stops at the top', () => {
  const r = ride();
  run(r, { forward: 1 }, 0.5);
  assert.ok(r.sk.push >= 0.99, `push ${r.sk.push}`);
  const phases = new Set();
  for (let i = 0; i < 30; i++) { step(r, { forward: 1 }); phases.add(Math.floor(r.sk.pushPhase * 4)); }
  assert.ok(phases.size >= 3, 'the stroke goes round');
  run(r, { forward: 1 }, 2);
  assert.ok(r.sk.push < 0.05, `at the top push ${r.sk.push}`);
  const c = ride();
  run(c, { forward: 1 }, 0.4);
  run(c, {}, 0.5);
  assert.equal(c.sk.push, 0, 'no push without W');
});

test('every refusal has its reason, in order of precedence', () => {
  const ok = { phase: 'body', state: 'ground', inWater: false, cardOpen: false };
  assert.equal(canBoard(ok), null);
  assert.equal(canBoard({ ...ok, inWater: true }), 'water');
  assert.equal(canBoard({ ...ok, state: 'swim' }), 'water');
  assert.equal(canBoard({ ...ok, state: 'air' }), 'air');
  for (const phase of ['enter', 'shaft', 'tunnel', 'transfer', 'step', 'off']) assert.equal(canBoard({ ...ok, phase }), 'below', phase);
  assert.equal(canBoard({ ...ok, cardOpen: true }), 'card');
  assert.equal(canBoard({ ...ok, unavailable: true }), 'unavailable');
  assert.equal(canBoard({ ...ok, phase: 'shaft', cardOpen: true, inWater: true }), 'below');
  for (const r of ['water', 'air', 'below', 'card', 'unavailable']) assert.ok(REFUSALS.includes(r));
});

test('identical inputs give identical outputs (no randomness)', () => {
  const a = ride(), b = ride();
  const script = [{ forward: 1 }, { forward: 1, steer: 1 }, { forward: 1, ollie: true }, { forward: 1 }, { forward: -1 }];
  for (let i = 0; i < 300; i++) { const inp = script[Math.floor(i / 60) % script.length]; step(a, inp); step(b, inp); }
  assert.deepEqual(a.sk, b.sk);
  assert.deepEqual(a.body, b.body);
});

test('a zero or negative dt changes nothing', () => {
  const r = ride();
  run(r, { forward: 1 }, 1);
  const before = JSON.stringify([r.sk, r.body]);
  step(r, { forward: 1, steer: 1 }, 0);
  step(r, { forward: 1, steer: 1 }, -1);
  assert.equal(JSON.stringify([r.sk, r.body]), before);
});
