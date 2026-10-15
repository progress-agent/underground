// player-measure-views-d.test.mjs: the other bodies' measurement views (sprint 14Oct26w, lane D, D-053 item 10).
// Gate 3 holds at the standard views AND at the body views; these three are the skateboard, the Drone and the Balloon.
// They live in PLAYER_VIEWS_D, outside VIEWS, EXTRA_VIEWS and lane P's PLAYER_VIEWS, so those pinned lists do not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, EXTRA_VIEWS, PLAYER_VIEWS, PLAYER_VIEWS_D } from '../scripts/measure-setups.mjs';

test('playerSkate rides the street past Bank, put back at the start every three seconds', () => {
  assert.deepEqual(PLAYER_VIEWS_D.playerSkate, { player: 'skate', x: 2743.9, z: -760.9, yaw: Math.PI, replaceS: 3 });
});

test('playerDrone is the Drone 5 m over the same street, W for two seconds and then S', () => {
  assert.deepEqual(PLAYER_VIEWS_D.playerDrone, { player: 'drone', x: 2743.9, z: -760.9, upM: 5, yaw: Math.PI, shuttleS: 2 });
});

test('playerBalloon is the Balloon 150 m over the Thames at Waterloo Bridge', () => {
  assert.deepEqual(PLAYER_VIEWS_D.playerBalloon, { player: 'balloon', x: 885.1, z: -145.1, upM: 150 });
});

test('the three views are outside every other list, and lane P\'s list is as it was', () => {
  assert.deepEqual(Object.keys(PLAYER_VIEWS_D), ['playerSkate', 'playerDrone', 'playerBalloon']);
  assert.deepEqual(Object.keys(VIEWS), ['overview', 'streetBank', 'riverGreenwich', 'm25Edge', 'heathrow', 'arrival']);
  assert.deepEqual(Object.keys(EXTRA_VIEWS), ['amersham', 'kingsCross']);
  assert.deepEqual(Object.keys(PLAYER_VIEWS), ['playerFoot', 'playerFootNoShadow']);
  for (const k of Object.keys(PLAYER_VIEWS_D)) assert.ok(!(k in VIEWS) && !(k in EXTRA_VIEWS) && !(k in PLAYER_VIEWS), k);
});

test('the skateboard and the Drone start in the street Bank\'s views use, open to the south', () => {
  for (const k of ['playerSkate', 'playerDrone']) {
    const { x, z, yaw } = PLAYER_VIEWS_D[k];
    assert.ok(Math.abs(yaw - Math.PI) < 1e-12);
    assert.ok(x > 2700 && x < 2800 && z > -800 && z < -720);
  }
});
