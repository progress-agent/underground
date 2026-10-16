// s16-r-los.test.mjs: the two changes of lane R (sprint 16Oct26f, D-054) that have no flag because they cannot move a pixel:
//  1. collision.lineOfSight without per-sample allocation returns the very same numbers as 07391f3's
//     (tests/fixtures/s16/collision-07391f3.js is that file) over 10,000 random segments, ground hits included.
//  2. terrain-river-bed bedValueAt (the allocation-free sample) equals a copy of the 07391f3 sample, bit for bit,
//     over 10,000 random points, vertices and edges included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionService as createOld } from './fixtures/s16/collision-07391f3.js';
import { createCollisionService as createNew } from '../src/modes/collision.js';
import { bedValueAt } from '../src/terrain-river-bed.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const same = (a, b) => Object.is(a, b);

function tile(boxes) {
  const arr = new Float32Array(boxes.length * 16);
  boxes.forEach(({ x, z, side, h, y = 0 }, i) => { const o = i * 16; arr[o] = side; arr[o + 5] = h; arr[o + 10] = side; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1; });
  return { isInstancedMesh: true, name: 'baked-buildings-0', count: boxes.length, instanceMatrix: { array: arr } };
}

test('s16:R collision.lineOfSight equals the 07391f3 code number for number over 10,000 random segments', () => {
  const r = rng(16102026);
  const boxes = [];
  for (let i = 0; i < 60; i++) boxes.push({ x: (r() - 0.5) * 600, z: (r() - 0.5) * 600, side: 6 + r() * 30, h: (3 + r() * 40) * 5, y: r() * 20 });
  const meshes = [tile(boxes)];
  // rolling ground with a hole (NaN: off the map) and a step, so the ground loop meets every branch
  const ground = (x, z) => (x > 150 && x < 190 && z > -40 && z < 40 ? NaN : 8 + 6 * Math.sin(x / 37) * Math.cos(z / 53) + (x > 0 ? 4 : 0));
  const opts = { getBuildingMeshes: () => meshes, getHeightScale: () => 1, getGroundY: ground, getWaterSurfaceY: () => null, isSubmerged: () => false };
  const oldS = createOld(opts), newS = createNew(opts);
  const counts = { box: 0, ground: 0, clear: 0 };
  for (let i = 0; i < 10000; i++) {
    const from = { x: (r() - 0.5) * 500, y: 20 + r() * 150, z: (r() - 0.5) * 500 };
    const to = { x: from.x + (r() - 0.5) * 240, y: 10 + r() * 150 - (i % 3 === 0 ? 120 : 0), z: from.z + (r() - 0.5) * 240 };
    const o = i % 4 === 0 ? { pad: 0.25 + r() } : {};
    const a = oldS.lineOfSight(from, to, o), b = newS.lineOfSight(from, to, o);
    for (const k of ['clear', 'what']) assert.equal(b[k], a[k], `${k} case ${i}`);
    for (const k of ['t', 'x', 'y', 'z']) assert.ok(same(a[k], b[k]), `${k} case ${i}: ${a[k]} vs ${b[k]}`);
    counts[a.what ?? 'clear']++;
  }
  assert.ok(counts.ground > 300 && counts.box > 300 && counts.clear > 300, `the cases cover every branch: ${JSON.stringify(counts)}`);
});

// The 07391f3 sample, verbatim (terrain-river-bed.js), over the same tables.
const crossOld = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
function weightsOld(tri, p) { const [a, b, c] = tri, det = crossOld(a, b, c); return [crossOld(b, c, p) / det, crossOld(c, a, p) / det, crossOld(a, b, p) / det]; }
function sampleOld(bedBuckets, bedTriangles, bucketSize, x, z) {
  let y = null;
  for (const k of bedBuckets.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`) || []) {
    const tri = bedTriangles[k], bary = weightsOld(tri, { x, z });
    if (bary.every(w => w >= -1e-7 && w <= 1 + 1e-7)) { const value = bary.reduce((s, w, i) => s + w * tri[i].y, 0); y = y === null ? value : Math.min(y, value); }
  }
  return y;
}

test('s16:R the allocation-free river-bed sample equals the 07391f3 sample bit for bit over 10,000 random points', () => {
  const r = rng(54321), bucketSize = 256, tris = [], buckets = new Map();
  const put = (box, index) => {
    for (let x = Math.floor(box.minX / bucketSize); x <= Math.floor(box.maxX / bucketSize); x++)
      for (let z = Math.floor(box.minZ / bucketSize); z <= Math.floor(box.maxZ / bucketSize); z++) { const key = `${x},${z}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(index); }
  };
  for (let i = 0; i < 400; i++) {
    const cx = (r() - 0.5) * 3000, cz = (r() - 0.5) * 3000, tri = [];
    for (let k = 0; k < 3; k++) tri.push({ x: Math.fround(cx + (r() - 0.5) * 120), y: Math.fround(-6 + r() * 4), z: Math.fround(cz + (r() - 0.5) * 120) });
    if (i % 50 === 0) tri[2] = { ...tri[0], y: tri[2].y }; // a degenerate (zero-area) triangle: det 0
    const xs = tri.map(p => p.x), zs = tri.map(p => p.z);
    put({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }, tris.push(tri) - 1);
  }
  let hits = 0, vertex = 0, edge = 0;
  for (let i = 0; i < 10000; i++) {
    const tri = tris[Math.floor(r() * tris.length)];
    let x, z;
    if (i % 5 === 0) { const v = tri[i % 3]; x = v.x; z = v.z; vertex++; }                          // exactly a vertex
    else if (i % 5 === 1) { const a = tri[0], b = tri[1], t = r(); x = a.x + (b.x - a.x) * t; z = a.z + (b.z - a.z) * t; edge++; } // on an edge
    else if (i % 5 === 2) { x = (r() - 0.5) * 3200; z = (r() - 0.5) * 3200; }                          // anywhere
    else { x = tri[0].x + (r() - 0.3) * 80; z = tri[0].z + (r() - 0.3) * 80; }                         // near a triangle
    const a = sampleOld(buckets, tris, bucketSize, x, z), b = bedValueAt(buckets, tris, bucketSize, x, z);
    assert.ok(same(a, b), `case ${i}: ${a} vs ${b}`);
    if (a !== null) hits++;
  }
  assert.ok(hits > 3000 && vertex > 1500 && edge > 1500, `covers hits, vertices and edges: ${hits}/${vertex}/${edge}`);
});

