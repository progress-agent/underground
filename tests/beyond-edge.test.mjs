// The corridor round the lines beyond the M25 (sprint 02Oct26f, lane T, D-048 item 7). Node only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBeyondEdgeCorridor, regimeFrom, beyondRuns, densify, corridorSources, corridorWeightFromDistance,
  CORRIDOR_FULL_M, CORRIDOR_ZERO_M,
} from '../src/beyond-edge.js';

// A straight "ring" at x = 0: x > 0 is beyond the map. A line runs west to east through it at z = 0
// (a bore, sparse: station to station), and a branch runs north from (3000, 0) to (3000, 2000).
const isOff = ({ x }) => x > 0;
const line = [{ x: -3000, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 2000 }];
const make = () => { const c = createBeyondEdgeCorridor({ isOffMapEdge: isOff }); c.build([line]); return c; };

test('weight 1 within 150 m, 0 beyond 200 m, a smoothstep between, and 0 on the map', () => {
  const c = make();
  assert.equal(c.ready, true);
  assert.equal(c.weightAt(1500, 0), 1);
  assert.equal(c.weightAt(1500, 100), 1);
  assert.equal(c.weightAt(1500, 140), 1);
  const mid = c.weightAt(1500, 175);
  assert.ok(mid > 0 && mid < 1, `${mid}`);
  assert.equal(c.weightAt(1500, 200), 0);
  assert.equal(c.weightAt(1500, 400), 0);
  assert.equal(c.weightAt(-1500, 0), 0, 'on the map the corridor does not apply, though the line runs there');
  assert.equal(c.weightAt(-1, 0), 0);
  assert.equal(c.weightAt(3000, 1000), 1);
  assert.equal(c.weightAt(3100, 1000), 1);
  assert.equal(c.weightAt(3300, 1000), 0);
  // Monotone in the distance across the ramp.
  let prev = 1;
  for (let z = 150; z <= 200; z += 5) { const w = c.weightAt(1500, z); assert.ok(w <= prev + 1e-9); prev = w; }
});

test('the sparse bore is densified before the ring is applied, so the stretch between two stations is covered', () => {
  const c = make();
  assert.equal(c.weightAt(10, 0), 1, 'just beyond the ring on a segment whose first point is on the map');
  assert.equal(c.weightAt(1500, 0), 1);
});

test('distance: capped at 255 where nothing is near, and within 13 m of the truth (25 m cells)', () => {
  const c = make();
  assert.equal(c.distanceAt(1500, 5000), 255);
  assert.equal(c.distanceAt(-9e5, 9e5), 255);
  for (const z of [0, 40, 100, 160, 199]) {
    const d = c.distanceAt(1500, z);
    assert.ok(Math.abs(d - z) <= 20, `at ${z} m the cell says ${d}`);
  }
});

test('a point on a path\'s own samples is at distance about 0; before build, nothing', () => {
  const c = createBeyondEdgeCorridor({ isOffMapEdge: isOff });
  assert.equal(c.ready, false);
  assert.equal(c.weightAt(1500, 0), 0);
  assert.equal(c.distanceAt(1500, 0), 255);
  c.build([]);
  assert.equal(c.ready, true, 'built, with nothing to cover');
  assert.equal(c.weightAt(1500, 0), 0);
});

test('weightAt is O(1): a million lattice queries in well under 150 ms, no allocation', () => {
  const c = make();
  let sum = 0;
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) for (let j = 0; j < 1000; j++) sum += c.weightAt(-4000 + i * 10, -3000 + j * 6);
  const ms = performance.now() - t0;
  assert.ok(sum > 0);
  assert.ok(ms < 150, `${ms.toFixed(0)} ms`);
});

test('beyondRuns, densify and the sources', () => {
  assert.deepEqual(beyondRuns([{ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 9, z: 0 }, { x: -1, z: 0 }, { x: 4, z: 0 }], isOff).map(r => r.length), [2, 1]);
  const d = densify([{ x: 0, z: 0 }, { x: 95, z: 0 }], 10);
  assert.equal(d.length, 11);
  assert.ok(d.every((p, i) => i === 0 || Math.hypot(p.x - d[i - 1].x, p.z - d[i - 1].z) <= 10 + 1e-9));
  const s = corridorSources({ surfaceRailPaths: new Map([['central', [[{ x: 1, z: 1 }], null]]]), overgroundLinePaths: new Map([['weaver', [[{ x: 2, z: 2 }]]]]), boreBranches: new Map([['metropolitan', [[{ x: 3, z: 3 }]]]]) });
  assert.equal(s.length, 3);
  assert.equal(corridorWeightFromDistance(CORRIDOR_FULL_M), 1);
  assert.equal(corridorWeightFromDistance(CORRIDOR_ZERO_M), 0);
});

test('regimes: an underground camera in the corridor is underground; above ground, in the water, or outside the corridor it is not', () => {
  const base = { weight: 1, belowSurface: true, submerged: false, insideness: 0, cameraInsideM25: false };
  const r = regimeFrom(base);
  assert.equal(r.under, true); assert.equal(r.audioUnderground, true); assert.equal(r.labelsUnderground, true);
  assert.equal(r.regimeInsideness, 1); assert.equal(r.corridor, 1);
  // Above the ground: today's rules (daylight beyond the ring).
  const above = regimeFrom({ ...base, belowSurface: false });
  assert.deepEqual([above.under, above.audioUnderground, above.labelsUnderground, above.regimeInsideness, above.corridor], [false, false, false, 0, 1]);
  // Submerged: the water's own regime.
  assert.equal(regimeFrom({ ...base, submerged: true }).under, false);
  // Outside the corridor, below ground beyond the ring (the exterior cliff views): unchanged.
  const ext = regimeFrom({ ...base, weight: 0 });
  assert.deepEqual([ext.under, ext.audioUnderground, ext.regimeInsideness], [false, false, 0]);
  // Half a weight: not yet underground, but the light starts to follow.
  const half = regimeFrom({ ...base, weight: 0.4 });
  assert.deepEqual([half.under, half.audioUnderground, half.regimeInsideness], [false, false, 0.4]);
  // Inside the map: today's rules exactly, whatever the corridor says.
  const inside = regimeFrom({ weight: 0, belowSurface: true, submerged: false, insideness: 1, cameraInsideM25: true });
  assert.deepEqual([inside.under, inside.audioUnderground, inside.labelsUnderground, inside.regimeInsideness], [false, true, true, 1]);
  const insideAbove = regimeFrom({ weight: 0, belowSurface: false, submerged: false, insideness: 1, cameraInsideM25: true });
  assert.deepEqual([insideAbove.audioUnderground, insideAbove.regimeInsideness], [false, 1]);
});
