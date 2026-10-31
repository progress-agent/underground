// The beyond-edge corridor built in slices equals the one built in one call (sprint 21Oct26w, lane L, approach E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBeyondEdgeCorridor, CORRIDOR_TILE_M } from '../src/beyond-edge.js';

// A square map edge of half-side 5000 m; lines run from inside it to well beyond it.
const isOff = ({ x, z }) => Math.abs(x) > 5000 || Math.abs(z) > 5000;
const lines = [
  [{ x: 0, z: 0 }, { x: 9000, z: 400 }, { x: 14000, z: 2000 }],
  [{ x: -200, z: 100 }, { x: -7000, z: -3000 }, { x: -12000, z: -3200 }],
  [{ x: 100, z: 100 }, { x: 150, z: 7500 }],
];

test('buildSteps drained step by step gives the same corridor as build, and really yields', () => {
  const whole = createBeyondEdgeCorridor({ isOffMapEdge: isOff });
  whole.build(lines);
  const sliced = createBeyondEdgeCorridor({ isOffMapEdge: isOff });
  const steps = sliced.buildSteps(lines);
  let n = 0;
  while (!steps.next().done) n++;
  assert.ok(n > 3, `yields ${n}`);
  assert.equal(whole.ready, true);
  assert.equal(sliced.ready, true);
  assert.equal(whole.stats.points, sliced.stats.points);
  assert.equal(whole.stats.tiles, sliced.stats.tiles);
  for (let x = -13000; x <= 15000; x += 137) for (let z = -4000; z <= 8000; z += 191) {
    assert.equal(sliced.distanceAt(x, z), whole.distanceAt(x, z), `distance at ${x},${z}`);
    assert.equal(sliced.weightAt(x, z), whole.weightAt(x, z), `weight at ${x},${z}`);
  }
  assert.ok(CORRIDOR_TILE_M > 0);
});

test('it is not ready until the generator has finished', () => {
  const c = createBeyondEdgeCorridor({ isOffMapEdge: isOff });
  const steps = c.buildSteps(lines);
  steps.next();
  assert.equal(c.ready, false);
  while (!steps.next().done);
  assert.equal(c.ready, true);
});
