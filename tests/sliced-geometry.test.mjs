// The sliced normals and bounds equal three's own, bit for bit (sprint 21Oct26w, lane L, approach E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeVertexNormalsSteps, computeBoundingSphereSteps, computeBoundingBoxSteps } from '../src/sliced-geometry.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function soup(n, seed) {
  const r = lcg(seed), p = new Float32Array(n * 9);
  for (let i = 0; i < p.length; i++) p[i] = (r() - 0.5) * 1000;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return g;
}
function indexed(n, seed) {
  const g = soup(n, seed), r = lcg(seed + 1), count = g.attributes.position.count, idx = [];
  for (let t = 0; t < n; t++) idx.push(Math.floor(r() * count), Math.floor(r() * count), Math.floor(r() * count));
  g.setIndex(idx);
  return g;
}
const drain = (it) => { let steps = 0; for (const _ of it) steps++; return steps; };
const same = (a, b, what) => { assert.equal(a.length, b.length, what); for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}[${i}]: ${a[i]} vs ${b[i]}`); };

for (const [name, make] of [['a triangle soup', () => soup(5000, 7)], ['an indexed geometry', () => indexed(5000, 9)]]) {
  test(`normals of ${name} equal computeVertexNormals, with and without existing normals`, () => {
    for (const preset of [false, true]) {
      const a = make(), b = make();
      if (preset) for (const g of [a, b]) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.3), 3));
      a.computeVertexNormals();
      const steps = drain(computeVertexNormalsSteps(b, 700));
      same(a.attributes.normal.array, b.attributes.normal.array, 'normal');
      assert.ok(steps > 5, `it really yields (${steps})`);
    }
  });
  test(`bounds of ${name} equal the library's`, () => {
    const a = make(), b = make();
    a.computeBoundingSphere(); a.computeBoundingBox();
    drain(computeBoundingSphereSteps(b, 1000)); drain(computeBoundingBoxSteps(b, 1000));
    assert.ok(Object.is(a.boundingSphere.radius, b.boundingSphere.radius));
    same(a.boundingSphere.center.toArray(), b.boundingSphere.center.toArray(), 'centre');
    same(a.boundingBox.min.toArray(), b.boundingBox.min.toArray(), 'min');
    same(a.boundingBox.max.toArray(), b.boundingBox.max.toArray(), 'max');
  });
}

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeGeometriesSteps } from '../src/sliced-geometry.js';

test('mergeGeometriesSteps equals mergeGeometries for non-indexed geometries with extra attributes', () => {
  const parts = () => Array.from({ length: 60 }, (_, i) => {
    const g = soup(3 + (i % 5), 100 + i);
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    g.setAttribute('airportBase', new THREE.BufferAttribute(new Float32Array(n).fill(i * 0.25), 1));
    g.setAttribute('airportLift', new THREE.BufferAttribute(new Float32Array(n).fill(i % 3), 1));
    return g;
  });
  const lib = mergeGeometries(parts(), false);
  const it = mergeGeometriesSteps(parts(), 7);
  let steps = 0, r;
  do { r = it.next(); steps++; } while (!r.done);
  const mine = r.value;
  assert.ok(steps > 4);
  assert.deepEqual(Object.keys(mine.attributes), Object.keys(lib.attributes));
  for (const name of Object.keys(lib.attributes)) {
    assert.equal(mine.attributes[name].array.constructor, lib.attributes[name].array.constructor, name);
    assert.equal(mine.attributes[name].itemSize, lib.attributes[name].itemSize, name);
    same(mine.attributes[name].array, lib.attributes[name].array, name);
  }
  assert.equal(mine.index, lib.index);
});
