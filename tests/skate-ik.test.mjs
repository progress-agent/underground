// skate-ik.test.mjs: the two-bone solve behind the skateboard stance (sprint 14Oct26w, lane D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBone } from '../src/vehicles/two-bone-ik.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('a reachable target is reached to 1e-4 and both bones keep their length', () => {
  const hip = [0.1, 0.9, 0], l1 = 0.4, l2 = 0.43;
  for (const t of [[0.22, 0.1, 0.03], [-0.3, 0.2, 0.1], [0.05, 0.12, -0.2], [0, 0.3, 0.5]]) {
    const r = solveTwoBone(hip, t, l1, l2, [0, 0, 1]);
    assert.equal(r.reached, true);
    assert.ok(dist(r.end, t) < 1e-4, `end ${r.end} target ${t}`);
    assert.ok(Math.abs(dist(hip, r.knee) - l1) < 1e-4, 'upper bone');
    assert.ok(Math.abs(dist(r.knee, t) - l2) < 1e-4, 'lower bone');
  }
});

test('an unreachable target gives a straight limb pointing at it', () => {
  const hip = [0, 1, 0];
  const r = solveTwoBone(hip, [0, -3, 4], 0.4, 0.43, [0, 0, 1]);
  assert.equal(r.reached, false);
  assert.equal(r.bend, 0);
  const dir = [0, -Math.SQRT1_2, Math.SQRT1_2];
  assert.ok(dist(r.end, [hip[0] + dir[0] * 0.83, hip[1] + dir[1] * 0.83, hip[2] + dir[2] * 0.83]) < 1e-9);
  const k = [(r.knee[0] - hip[0]) / 0.4, (r.knee[1] - hip[1]) / 0.4, (r.knee[2] - hip[2]) / 0.4];
  assert.ok(dist(k, dir) < 1e-9, 'knee on the line');
});

test('the knee bends towards the pole', () => {
  const hip = [0, 0.9, 0], t = [0, 0.1, 0.05];
  const fwd = solveTwoBone(hip, t, 0.4, 0.43, [0, 0, 1]);
  assert.ok(fwd.knee[2] > t[2] + 0.05, `knee z ${fwd.knee[2]}`);
  const back = solveTwoBone(hip, t, 0.4, 0.43, [0, 0, -1]);
  assert.ok(back.knee[2] < t[2] - 0.05);
  const side = solveTwoBone(hip, t, 0.4, 0.43, [1, 0, 0]);
  assert.ok(side.knee[0] > 0.05);
  // a pole along the limb is made perpendicular, never NaN
  const along = solveTwoBone(hip, [0, 0.1, 0], 0.4, 0.43, [0, -1, 0]);
  assert.ok(along.knee.every(Number.isFinite));
  assert.ok(Math.abs(dist(hip, along.knee) - 0.4) < 1e-6);
});

test('the flexion rises as the foot comes closer to the hip', () => {
  const hip = [0, 0.9, 0];
  const far = solveTwoBone(hip, [0, 0.15, 0], 0.4, 0.43, [0, 0, 1]);
  const near = solveTwoBone(hip, [0, 0.45, 0], 0.4, 0.43, [0, 0, 1]);
  assert.ok(near.bend > far.bend);
  assert.ok(far.bend > 0 && near.bend < Math.PI);
});

test('zero-length and coincident input give no NaN', () => {
  for (const [hip, t, l1, l2] of [[[0, 0, 0], [0, 0, 0], 0.4, 0.43], [[1, 1, 1], [1, 1, 1], 0.4, 0.4], [[0, 0, 0], [0, 0.01, 0], 0.4, 0.43], [[0, 0, 0], [0, -0.83, 0], 0.4, 0.43]]) {
    const r = solveTwoBone(hip, t, l1, l2, [0, 0, 1]);
    assert.ok(r.knee.every(Number.isFinite) && r.end.every(Number.isFinite) && Number.isFinite(r.bend), JSON.stringify(r));
  }
  const z = solveTwoBone([0, 0, 0], [1, 1, 1], 0, 0, [0, 0, 1]);
  assert.ok(z.knee.every(Number.isFinite));
});

test('the solve is deterministic', () => {
  const a = solveTwoBone([0.1, 0.9, 0], [0.2, 0.1, 0.03], 0.4, 0.43, [0, 0, 1]);
  const b = solveTwoBone([0.1, 0.9, 0], [0.2, 0.1, 0.03], 0.4, 0.43, [0, 0, 1]);
  assert.deepEqual(a, b);
});
