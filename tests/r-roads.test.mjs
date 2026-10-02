// Unit tests for the throwaway roads and buses proof (sprint 02Oct26f, lane R). Run: node --test tests/r-roads.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { parseRoadsParams, decodeUgr1, buildPath, buildBusGeometry, ROAD_CLASSES, BUS } from '../src/r-roads.js';
import { insideM25, CLASSES, CLASS_WIDTH_M } from '../scripts/r-roads/analyse-roads.mjs';

test('URL flags', () => {
  assert.equal(parseRoadsParams(''), null);
  assert.deepEqual(parseRoadsParams('?buses=real'), { ribbons: false, classes: null, realBuses: true, syntheticBuses: 0 });
  const p = parseRoadsParams('?roads=ribbons&rclasses=primary,bogus,tertiary&buses=real,3000');
  assert.equal(p.ribbons, true); assert.deepEqual([...p.classes].sort(), ['primary', 'tertiary']); assert.equal(p.realBuses, true); assert.equal(p.syntheticBuses, 3000);
  assert.equal(parseRoadsParams('?buses=9000').syntheticBuses, 9000);
  assert.equal(parseRoadsParams('?buses=real+1000').syntheticBuses, 1000, 'a plus in a query string reads as a space');
});
test('class tables agree between the baker and the browser', () => {
  assert.deepEqual(ROAD_CLASSES, CLASSES); assert.equal(CLASS_WIDTH_M.length, CLASSES.length);
});
test('UGR1 decodes tile-relative decimetres to scene metres', () => {
  const b = Buffer.alloc(24 + 16 + 3 + 12); b.write('UGR1', 0, 'ascii'); b.writeUInt16LE(1, 4); b.writeUInt16LE(2000, 6); b.writeUInt16LE(35, 8); b.writeUInt16LE(29, 10);
  b.writeInt32LE(-34000, 12); b.writeInt32LE(-28000, 16); b.writeUInt32LE(1, 20);
  b.writeUInt16LE(3, 24); b.writeUInt16LE(2, 26); b.writeUInt32LE(40, 28); b.writeUInt32LE(1, 32); b.writeUInt32LE(3, 36);
  b.writeUInt8(2 | 0x10, 40); b.writeUInt16LE(3, 41); [[0, 0], [100, 50], [20000, 20000]].forEach(([x, z], i) => { b.writeUInt16LE(x, 43 + i * 4); b.writeUInt16LE(z, 45 + i * 4); });
  const d = decodeUgr1(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.equal(d.cells.length, 1); const pc = d.cells[0].pieces[0];
  assert.equal(pc.cls, 2); assert.equal(pc.bridge, true);
  assert.deepEqual(Array.from(pc.pts), [-34000 + 6000, -28000 + 4000, -34000 + 6000 + 10, -28000 + 4000 + 5, -34000 + 6000 + 2000, -28000 + 4000 + 2000]);
});
test('buildPath resamples uniformly, keeps its length and drapes', () => {
  const p = buildPath([0, 0, 30, 0, 30, 40], (x, z) => x + z, { step: 8 });
  assert.ok(Math.abs(p.length - 70) < 1e-9); assert.ok(p.sp <= 8 + 1e-9); assert.equal(p.n, Math.ceil(70 / 8) + 1);
  assert.equal(p.y[0], 0); assert.ok(Math.abs(p.y[p.n - 1] - 70) < 1e-3);
  const c = buildPath([0, 0, 100, 0, 100, 100, 0, 100], () => 0, { closed: true });
  assert.ok(Math.abs(c.length - 400) < 1e-9);
});
test('the bus is a compact vertex-shaded body of real size', () => {
  const g = buildBusGeometry(); g.computeBoundingBox(); const s = g.boundingBox.getSize(new THREE.Vector3());
  assert.equal(g.index.count / 3, 72); assert.ok(g.attributes.color);
  assert.ok(Math.abs(s.z - BUS.length) < 0.01 && Math.abs(s.y - 4.2) < 0.25 && s.x < 2.6);
});
test('no per-instance colour anywhere in the proof (D-015: the M5 driver renders it black)', () => {
  const src = fs.readFileSync(new URL('../src/r-roads.js', import.meta.url), 'utf8');
  assert.ok(!/setColorAt|instanceColor|InstancedBufferAttribute\([^)]*colo/i.test(src.replace(/\/\/.*$/gm, '')));
  assert.ok(!/Math\.random/.test(src));
});
test('the M25 inside test', () => {
  assert.equal(insideM25(0, 0), true); assert.equal(insideM25(40000, 0), false); assert.equal(insideM25(-34000, -27000), false);
});
