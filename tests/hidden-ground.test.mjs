// The hidden ground beyond the map edge (sprint 02Oct26f, lane T, D-048 item 7). Node only: a synthetic
// terrain grid with a canopy-lumpy half beyond a straight "ring" stands in for the app's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHiddenGround, WALK_INSET_M } from '../src/hidden-ground.js';

// A grid like the app's: 129 x 101 vertices over 12.8 km x 10 km (100 m cells). The "ring" is x = 0:
// x > 0 is beyond the map. Beyond it the surface is a gentle slope plus lumps (canopy, roofs).
const COLS = 129, ROWS = 101, MIN_X = -6400, MAX_X = 6400, MIN_Z = -5000, MAX_Z = 5000;
const cellW = (MAX_X - MIN_X) / (COLS - 1), cellH = (MAX_Z - MIN_Z) / (ROWS - 1);
function heightAt(i, j) {
  const x = MIN_X + i * cellW, z = MIN_Z + j * cellH;
  let y = 400 + x * 0.01 + 30 * Math.sin(z / 900);                  // broad relief
  if (x > 0) {
    // Canopy: 20 to 40 m (scene units 100 to 200) lumps a vertex or two wide.
    const h = Math.imul(i * 73856093 ^ j * 19349663, 0x9e3779b1) >>> 0;
    if (h % 7 === 0) y += 60 + (h >>> 8) % 120;
  }
  return y;
}
const Y = new Float64Array(COLS * ROWS);
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) Y[j * COLS + i] = heightAt(i, j);

// terrain.js getStructuralSurfaceY's own triangles, over this grid.
function structural({ x, z } = {}) {
  const gc = (x - MIN_X) / (MAX_X - MIN_X) * (COLS - 1), gr = (z - MIN_Z) / (MAX_Z - MIN_Z) * (ROWS - 1);
  if (gc < -0.001 || gc > COLS - 1 + 0.001 || gr < -0.001 || gr > ROWS - 1 + 0.001) return null;
  const c0 = Math.min(Math.max(0, Math.floor(gc)), COLS - 2), r0 = Math.min(Math.max(0, Math.floor(gr)), ROWS - 2);
  const u = gc - c0, v = gr - r0, at = (c, r) => Y[r * COLS + c];
  const y00 = at(c0, r0), y10 = at(c0 + 1, r0), y01 = at(c0, r0 + 1), y11 = at(c0 + 1, r0 + 1);
  return u + v <= 1 ? y00 + (y10 - y00) * u + (y01 - y00) * v : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
}
// A "river bed" on the map only, so the rendered sampler differs from the structural one there.
const rendered = ({ x, z } = {}) => { const s = structural({ x, z }); return s !== null && x < -2000 && x > -2200 ? s - 5 : s; };
const bounds = () => ({ minX: MIN_X, maxX: MAX_X, minZ: MIN_Z, maxZ: MAX_Z, columns: COLS, rows: ROWS });
const isOff = ({ x }) => x > 0;
const make = (over = {}) => createHiddenGround({ getTerrainMeshSurfaceY: rendered, getStructuralSurfaceY: structural, getTerrainBounds: bounds, isOffMapEdge: isOff, ...over });

test('on the map the hidden ground is the raw sampler, bit for bit', () => {
  const g = make();
  for (let x = -6400; x <= 0; x += 173.7) for (let z = -5000; z <= 5000; z += 211.3) {
    assert.ok(Object.is(g.terrainY(x, z), rendered({ x, z })), `terrainY at ${x}, ${z}`);
    assert.ok(Object.is(g.structuralY(x, z), structural({ x, z })), `structuralY at ${x}, ${z}`);
  }
});

test('beyond the map the lumps are smoothed: no grade steeper than the raw surface, and far gentler where the raw is lumpy', () => {
  const g = make();
  let rawWorst = 0, hidWorst = 0;
  for (let x = 1500; x <= 5500; x += 25) for (let z = -3000; z <= 3000; z += 25) {
    const r0 = structural({ x, z }), h0 = g.structuralY(x, z);
    const r1 = structural({ x: x + 25, z }), h1 = g.structuralY(x + 25, z);
    const r2 = structural({ x, z: z + 25 }), h2 = g.structuralY(x, z + 25);
    rawWorst = Math.max(rawWorst, Math.abs(r1 - r0), Math.abs(r2 - r0));
    hidWorst = Math.max(hidWorst, Math.abs(h1 - h0), Math.abs(h2 - h0));
  }
  assert.ok(hidWorst < rawWorst * 0.5, `worst 25 m step ${hidWorst.toFixed(2)} (hidden) against ${rawWorst.toFixed(2)} (raw)`);
  assert.ok(hidWorst <= 20, `${hidWorst.toFixed(2)} scene units per 25 m is at most a 16% grade`);
});

test('the opening removes canopy lumps and keeps the broad relief', () => {
  const g = make();
  // The mean offset from the raw surface over the lumpy region is the canopy taken off (negative), bounded by the lumps.
  let sum = 0, n = 0, worstUp = 0;
  for (let x = 1500; x <= 5500; x += 100) for (let z = -3000; z <= 3000; z += 100) {
    const d = g.structuralY(x, z) - structural({ x, z });
    sum += d; n++; worstUp = Math.max(worstUp, d);
  }
  assert.ok(sum / n < -5, `canopy taken off on average (${(sum / n).toFixed(1)})`);
  // The slope of the broad relief survives: east 4 km along the same z the ground rises by about the 0.01 slope x 4000.
  const east = g.structuralY(5000, 0) - g.structuralY(1000, 0);
  assert.ok(Math.abs(east - 40) < 25, `relief kept (${east.toFixed(1)} against about 40)`);
});

test('continuous across the ring: the blend adds no cliff', () => {
  const g = make();
  for (let z = -4000; z <= 4000; z += 487) {
    let rawStep = 0, hidStep = 0, prevR = null, prevH = null;
    for (let x = -300; x <= 600; x += 1) {
      const r = structural({ x, z }), h = g.structuralY(x, z);
      if (prevR !== null) { rawStep = Math.max(rawStep, Math.abs(r - prevR)); hidStep = Math.max(hidStep, Math.abs(h - prevH)); }
      prevR = r; prevH = h;
    }
    assert.ok(hidStep <= rawStep + 0.5, `z=${z}: largest 1 m step ${hidStep.toFixed(2)} against the raw ${rawStep.toFixed(2)}`);
  }
});

test('order independent: any order of queries gives identical values', () => {
  const pts = []; for (let k = 0; k < 1500; k++) pts.push([1200 + (k * 37) % 5000, -4000 + (k * 91) % 8000]);
  const a = make(), b = make();
  const fwd = pts.map(([x, z]) => a.structuralY(x, z)), rev = [...pts].reverse().map(([x, z]) => b.structuralY(x, z)).reverse();
  assert.deepEqual(fwd, rev);
  // And the rendered sampler too, after a mix of vertex orders.
  const c = make(); for (const [x, z] of pts.slice(0, 400).reverse()) c.terrainY(x, z);
  assert.deepEqual(pts.map(([x, z]) => c.terrainY(x, z)), pts.map(([x, z]) => make().terrainY(x, z)));
});

test('null stays null: outside the grid, and before the terrain exists', () => {
  const g = make();
  assert.equal(g.terrainY(MAX_X + 500, 0), null);
  assert.equal(g.structuralY(0, MIN_Z - 1), null);
  const none = createHiddenGround({ getTerrainMeshSurfaceY: () => null, getStructuralSurfaceY: () => null, getTerrainBounds: () => null, isOffMapEdge: isOff });
  assert.equal(none.terrainY(3000, 0), null);
  assert.equal(none.insideWalkBounds(1e6, 1e6), true, 'true everywhere until the terrain is loaded');
  assert.equal(none.holdBox, null);
});

test('the walk bounds are the terrain grid inset 200 m', () => {
  const g = make();
  assert.deepEqual(g.holdBox, { minX: MIN_X + WALK_INSET_M, maxX: MAX_X - WALK_INSET_M, minZ: MIN_Z + WALK_INSET_M, maxZ: MAX_Z - WALK_INSET_M });
  assert.equal(g.insideWalkBounds(0, 0), true);
  assert.equal(g.insideWalkBounds(MAX_X - 100, 0), false);
  assert.equal(g.insideWalkBounds(MAX_X - 200, 0), true);
  assert.equal(g.insideWalkBounds(1e6, 1e6), false);
});

test('cheap: 10,000 fresh beyond-ring points in a few tens of milliseconds, nothing computed at construction', () => {
  const g = make();
  assert.equal(g.stats.vertices, 0, 'lazy: nothing read at boot');
  const t0 = performance.now();
  for (let k = 0; k < 10000; k++) g.terrainY(1000 + (k % 100) * 45, -2000 + Math.floor(k / 100) * 40);
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `${ms.toFixed(0)} ms`);
});
