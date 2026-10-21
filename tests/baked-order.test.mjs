// Hook 1 for lane V: the baked builder's tile order and completeRadius (sprint 21Oct26w, lane L; acceptance L-21 b).
// Node, synthetic payload: a 3 x 3 grid of tiles, one building each. The default is untouched: index order, and
// no extents are computed unless an origin order or completeRadius is asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseBakedBuildings, createBakedBuildingBuilder, tileExtents, distanceToExtent, resolveTileOrder } from '../src/baked-buildings.js';

const REC = 10, DIR = 16, HEAD = 12;

/** A UGB1 buffer: tiles at (col*1000, row*1000), 200 m wide cells, one 20 m building mid-tile. */
function payloadOf(cols = 3, rows = 3) {
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ minX: c * 1000, minZ: r * 1000 });
  const buf = new ArrayBuffer(HEAD + tiles.length * DIR + tiles.length * REC);
  const v = new DataView(buf);
  v.setUint32(0, 0x31424755, true); v.setUint16(4, 1, true); v.setUint16(6, tiles.length, true); v.setUint32(8, tiles.length, true);
  tiles.forEach((t, i) => {
    const d = HEAD + i * DIR;
    v.setInt32(d, t.minX, true); v.setInt32(d + 4, t.minZ, true); v.setUint32(d + 8, HEAD + tiles.length * DIR + i * REC, true); v.setUint32(d + 12, 1, true);
    const o = HEAD + tiles.length * DIR + i * REC;
    v.setUint16(o, 5000, true); v.setUint16(o + 2, 5000, true); v.setUint16(o + 4, 300, true); v.setUint16(o + 6, 200, true); v.setInt16(o + 8, 0, true);
  });
  return parseBakedBuildings(buf);
}
const material = new THREE.MeshBasicMaterial();
function build(payload, opts = {}) {
  const names = [];
  const b = createBakedBuildingBuilder(payload, { VE: 5, material, onMesh: (m) => names.push(m.name), ...opts });
  return { b, names };
}
function drain(b, per = 1) { while (!b.isDone()) { b.pump(0.0001); if (per === 'all') b.pump(1e9); } }

test('the default is index order and computes no extents', () => {
  const p = payloadOf();
  const { b, names } = build(p);
  b.pump(1e9);
  assert.deepEqual(names, p.tiles.map((_, i) => `baked-buildings-${i}`));
  assert.equal(b.stats().tilesBuilt, 9);
});

test('an explicit order is followed, and a bad one is ignored with a warning', () => {
  const p = payloadOf();
  const order = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const { b, names } = build(p, { order });
  b.pump(1e9);
  assert.deepEqual(names, order.map(i => `baked-buildings-${i}`));
  const warns = []; const w = console.warn; console.warn = (m) => warns.push(m);
  try {
    const bad = build(p, { order: [0, 0, 1, 2, 3, 4, 5, 6, 7] });
    bad.b.pump(1e9);
    assert.deepEqual(bad.names, p.tiles.map((_, i) => `baked-buildings-${i}`));
    assert.equal(warns.length, 1);
  } finally { console.warn = w; }
});

test('an origin builds nearest-first by distance to each tile\'s extent', () => {
  const p = payloadOf();
  const { b, names } = build(p, { origin: { x: 1500, z: 1500 } }); // inside tile 4's extent (x 1500 +- 100)
  b.pump(1e9);
  assert.equal(names[0], 'baked-buildings-4');
  const ex = tileExtents(p);
  const d = names.map(n => distanceToExtent(ex[Number(n.split('-').pop())], 1500, 1500));
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1], 'non-decreasing distance');
  assert.deepEqual(resolveTileOrder(p, { origin: { x: 1500, z: 1500 } }).slice(0, 1), [4]);
});

test('completeRadius is 0 before any tile, grows while building and is Infinity when all are built', () => {
  const p = payloadOf();
  const origin = { x: 1500, z: 1500 };
  const { b } = build(p, { origin });
  assert.equal(b.completeRadius(origin), 0, 'the origin tile is still to build');
  let last = 0;
  const seen = [];
  while (!b.isDone()) { b.pump(0.0001); const r = b.completeRadius(origin); assert.ok(r >= last, `monotonic ${last} -> ${r}`); last = r; seen.push(r); }
  assert.equal(b.completeRadius(origin), Infinity);
  assert.ok(seen.some(r => r > 0 && r < Infinity), 'it grows through finite values');
  // Nearest-first means the radius is exactly the distance to the nearest unbuilt extent.
  const ex = tileExtents(p);
  const nearestOfRest = Math.min(...ex.filter((_, i) => i !== 4).map(e => distanceToExtent(e, origin.x, origin.z)));
  assert.ok(nearestOfRest > 0);
  assert.ok(seen.some(r => Math.abs(r - nearestOfRest) < 1e-9), 'after the origin tile the radius is the distance to the next nearest');
});

test('with the default order completeRadius still answers (it computes extents on demand)', () => {
  const p = payloadOf();
  const { b } = build(p);
  assert.equal(b.completeRadius({ x: 0, z: 0 }) >= 0, true);
  b.pump(1e9);
  assert.equal(b.completeRadius({ x: 0, z: 0 }), Infinity);
});
