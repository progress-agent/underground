// player-measure-views.test.mjs: the figure's measurement views (sprint 14Oct26w, lane P, D-053 item 10).
// Gate 3 holds at the standard views AND at the body views, because the figure is the sprint's main new cost.
// They live in PLAYER_VIEWS, outside VIEWS and EXTRA_VIEWS, so the pinned lists of those two do not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, EXTRA_VIEWS, PLAYER_VIEWS } from '../scripts/measure-setups.mjs';

test('playerFoot is third person walking past Bank at street level, with a shuttle', () => {
  assert.deepEqual(PLAYER_VIEWS.playerFoot, { player: 'foot', x: 2743.9, z: -760.9, yaw: Math.PI, shuttleS: 3 });
});

test('playerFootNoShadow is the same pose with the shadow off', () => {
  assert.deepEqual(PLAYER_VIEWS.playerFootNoShadow, { ...PLAYER_VIEWS.playerFoot, shadow: false });
});

test('the body views are outside the default six and outside the extras', () => {
  assert.deepEqual(Object.keys(VIEWS), ['overview', 'streetBank', 'riverGreenwich', 'm25Edge', 'heathrow', 'arrival']);
  assert.deepEqual(Object.keys(EXTRA_VIEWS), ['amersham', 'kingsCross']);
  for (const k of Object.keys(PLAYER_VIEWS)) {
    assert.ok(!(k in VIEWS) && !(k in EXTRA_VIEWS), k);
  }
});

test('the pose is a street 60 m east of the Bank junction, open to the south', () => {
  // 51.5136, -0.0880 is the Bank junction; the walker faces south (yaw PI), which is +Z on the map
  const { x, z, yaw } = PLAYER_VIEWS.playerFoot;
  assert.ok(Math.abs(yaw - Math.PI) < 1e-12);
  assert.ok(x > 2700 && x < 2800 && z > -800 && z < -720);
});
