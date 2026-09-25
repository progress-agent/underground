// Sprint 25Sep26f Lane E: the re-fetch parser must match the original tile
// fetch (same projection, rounding, 20 m2 floor, height rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuildings, category } from '../scripts/refetch-short-tiles.mjs';

// A ~30 m square near Trafalgar Square, a 3 m2 shed, and a two-way multipolygon.
const d = 0.00027;
const sq = (id, lat, lon, s) => [
  { type: 'node', id: id + 1, lat, lon }, { type: 'node', id: id + 2, lat, lon: lon + s },
  { type: 'node', id: id + 3, lat: lat + s * 0.62, lon: lon + s }, { type: 'node', id: id + 4, lat: lat + s * 0.62, lon }];
const osm = { elements: [
  ...sq(100, 51.5074, -0.1278, d),
  { type: 'way', id: 1, nodes: [101, 102, 103, 104, 101], tags: { building: 'house', 'building:levels': '3' } },
  ...sq(200, 51.508, -0.128, 0.00002),
  { type: 'way', id: 2, nodes: [201, 202, 203, 204, 201], tags: { building: 'shed' } },
  ...sq(300, 51.509, -0.129, d * 3),
  { type: 'way', id: 3, nodes: [301, 302, 303, 304, 301] },
  { type: 'relation', id: 9, members: [{ type: 'way', ref: 3, role: 'outer' }], tags: { building: 'warehouse', height: '8.5' } },
] };

test('parse: projection, 20 m2 floor, levels and height, relation outers, kind', () => {
  const b = parseBuildings(osm);
  assert.deepEqual([...b.keys()].sort(), ['relation/9', 'way/1']);
  const h = b.get('way/1');
  assert.ok(Math.abs(h.cx) < 30 && Math.abs(h.cz) < 30, 'Trafalgar origin');
  assert.equal(h.height, 9.6);
  assert.ok(h.area > 300 && h.area < 500, `area ${h.area}`);
  assert.deepEqual(h.footprint[0], h.footprint.at(-1));
  assert.equal(h.kind, 'house');
  assert.equal(b.get('relation/9').height, 8.5);
  assert.equal(b.get('relation/9').kind, 'warehouse');
});

test('categories', () => {
  assert.equal(category('terrace'), 'residential');
  assert.equal(category('warehouse'), 'industrial / warehouse');
  assert.equal(category('yes'), 'untyped (building=yes)');
  assert.equal(category(undefined), 'untyped (building=yes)');
  assert.equal(category('garage'), 'garages / sheds / roofs');
});
