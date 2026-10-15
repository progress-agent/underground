// player-flames.test.mjs: the jetpack flames as pure functions (sprint 14Oct26w, lane P, D-053 item 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { flameLength, flameRadius, flameVisible, flameDirection, FLAME } from '../src/player/flames.js';

const meanLen = (L, i = 0) => { let s = 0, n = 0; for (let t = 0; t <= 2; t += 1 / 240) { s += flameLength(L, t, i); n++; } return s / n; };

test('length is zero at level 0 and below the visibility floor', () => {
  for (let i = 0; i < 4; i++) for (const t of [0, 0.3, 1.7]) {
    assert.equal(flameLength(0, t, i), 0);
    assert.equal(flameLength(FLAME.minLevel, t, i), 0);
    assert.equal(flameLength(-1, t, i), 0);
  }
});

test('the mean length over 2 s strictly increases with the level', () => {
  const means = [0.25, 0.5, 0.75, 1].map((L) => meanLen(L));
  for (let k = 1; k < means.length; k++) assert.ok(means[k] > means[k - 1], `${means}`);
  assert.ok(means[0] > 0);
});

test('identical inputs give identical outputs (no random draw)', () => {
  for (let i = 0; i < 4; i++) for (const L of [0.1, 0.5, 1]) for (const t of [0, 0.123, 5.5]) {
    assert.equal(flameLength(L, t, i), flameLength(L, t, i));
  }
  const a = [], b = [];
  for (let t = 0; t < 2; t += 0.01) { a.push(flameLength(0.6, t, 2)); b.push(flameLength(0.6, t, 2)); }
  assert.deepEqual(a, b);
});

test('the flicker stays within a 1.7 ratio per flame over 2 s, at every level', () => {
  for (const L of [0.05, 0.25, 0.5, 1]) for (let i = 0; i < 4; i++) {
    let lo = Infinity, hi = 0;
    for (let t = 0; t <= 2; t += 1 / 240) { const v = flameLength(L, t, i); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(hi / lo <= 1.7, `level ${L} flame ${i}: ${hi / lo}`);
  }
});

test('the four flames do not flicker in step', () => {
  const t = 0.37;
  const v = [0, 1, 2, 3].map((i) => flameLength(1, t, i));
  assert.ok(new Set(v.map((x) => x.toFixed(6))).size === 4);
});

test('the flame is longer than 0.12 m at any firing level, and wider with thrust', () => {
  for (let t = 0; t < 2; t += 0.01) assert.ok(flameLength(0.2, t, 0) >= 0.12);
  assert.ok(flameRadius(1) > flameRadius(0.1));
  assert.ok(flameRadius(0) > 0);
});

test('flames are hidden when submerged, swimming or not firing', () => {
  assert.equal(flameVisible({ level: 1, submerged: false, state: 'air' }), true);
  assert.equal(flameVisible({ level: 1, submerged: true, state: 'air' }), false);
  assert.equal(flameVisible({ level: 1, submerged: false, state: 'swim' }), false);
  assert.equal(flameVisible({ level: 0, submerged: false, state: 'air' }), false);
  assert.equal(flameVisible({ level: 0.02, submerged: false, state: 'air' }), false);
  assert.equal(flameVisible({ level: 0.5, state: 'ground' }), true);
});

test('the direction is down, leaning back against the velocity by at most 25 degrees', () => {
  const still = flameDirection(0, 0);
  assert.deepEqual(still.map((x) => +x.toFixed(9)), [0, -1, 0].map((x) => +x.toFixed(9)));
  const fast = flameDirection(0, -30);                // moving north at 30 m/s: the flame trails south
  assert.ok(fast[2] > 0 && fast[1] < -0.9);
  assert.ok(Math.abs(Math.hypot(...fast) - 1) < 1e-9);
  const tilt = Math.acos(-fast[1]);
  assert.ok(Math.abs(tilt - FLAME.maxTiltRad) < 1e-9);
  const slow = flameDirection(2, 0);
  assert.ok(Math.abs(Math.acos(-slow[1]) - 0.08) < 1e-9);
  assert.ok(slow[0] < 0);
  assert.ok(flameDirection(5, 5)[1] < -0.8);
});
