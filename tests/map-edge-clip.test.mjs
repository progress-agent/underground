// Sprint 25Sep26f Lane E (D-039): water and contours end at the map edge.
// Jordan: reservoirs, lakes and canals spilled past the M25 cliff (Wraysbury,
// Sawyers Lake, another reservoir, ~25 canal features incl. the Basingstoke
// Canal, Broadmead Cut, River Wey, part of the Slough Arm); contour lines ran on
// over the void.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { getMapEdgeRing, signedDistanceToRing, isOffMapEdge } from '../src/m25-edge.js';
import { clipWaterToMapEdge, clipPolygonToRing, clipPolylineToRing, clipLineSegmentsToMapEdge } from '../src/map-edge-clip.js';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const ring = getMapEdgeRing();
const ll = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) }; };
const load = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a / 2); };

test('reservoirs and lakes: wholly off-map bodies are dropped, nothing kept lies off the map', () => {
  const { data, report } = clipWaterToMapEdge(load('reservoirs.json'), ll, ring, { kind: 'polygon' });
  assert.deepEqual(report.dropped.sort(), ['Reservoir 1280733481', 'Sawyers Lake', 'Wraysbury Reservoir']);
  assert.equal(report.kept + report.clipped.length, 47);
  let worst = Infinity;
  for (const f of data.features) for (const [x, z] of f.coords) worst = Math.min(worst, signedDistanceToRing(x, z, ring));
  assert.ok(worst > -0.01, `a kept water vertex sits ${-worst} m beyond the edge`);
  // Everything that was on the map before is still there.
  for (const name of ['Queen Mary Reservoir', 'Staines Reservoirs', 'King George VI Reservoir', 'Queen Elizabeth II Reservoir', 'Brent Reservoir'])
    assert.ok(data.features.some(f => f.name === name), name);
});

test('canals: off-map features dropped, the Slough Arm cut at the edge, every kept vertex on the map', () => {
  const src = load('canals.json');
  const { data, report } = clipWaterToMapEdge(src, ll, ring, { kind: 'polyline', endInsetM: 6 });
  for (const name of ['Basingstoke Canal', 'Broadmead Cut', 'River Wey Navigation'])
    assert.ok(report.dropped.includes(name), `${name} should be dropped`);
  assert.ok(report.dropped.length + report.clipped.length >= 20 && report.dropped.length + report.clipped.length <= 30,
    `plan expected ~25 canal features off the map, got ${report.dropped.length + report.clipped.length}`);
  assert.ok(report.clipped.includes('Grand Union Canal - Slough Arm'));
  const slough = data.features.filter(f => f.name === 'Grand Union Canal - Slough Arm');
  assert.ok(slough.length >= 1, 'the on-map part of the Slough Arm survives');
  let worst = Infinity;
  for (const f of data.features) for (const [x, z] of f.coords) worst = Math.min(worst, signedDistanceToRing(x, z, ring));
  assert.ok(worst > -0.01, `a canal vertex sits ${-worst} m beyond the edge`);
  // Cut ends pulled back past the ribbon's 5 m half-width.
  for (const f of data.features.filter(f => f.clippedToMapEdge))
    for (const p of [f.coords[0], f.coords.at(-1)]) assert.ok(signedDistanceToRing(p[0], p[1], ring) > -0.01);
  // Untouched canals keep their exact geometry (same vertex count).
  const grandUnion = src.features.find(f => f.name === 'Grand Union Canal (Paddington Arm)');
  assert.equal(data.features.find(f => f.id === grandUnion.id).coords.length, grandUnion.coords.length);
});

test('polygon clip: straddling square keeps exactly its on-map half, cut on the ring', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const clipRing = [[50, -1000], [1000, -1000], [1000, 1000], [50, 1000]];
  const out = clipPolygonToRing(sq, clipRing);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(area(out[0]) - 5000) < 1e-6, `area ${area(out[0])}`);
  assert.deepEqual(clipPolygonToRing(sq, [[200, 0], [300, 0], [300, 100], [200, 100]]), []);
  assert.equal(area(clipPolygonToRing(sq, [[-10, -10], [110, -10], [110, 110], [-10, 110]])[0]), 10000);
});

test('polygon clip: a concave edge splits a body into two on-map pieces', () => {
  // Ring with a notch that cuts the subject in two.
  const clipRing = [[-100, -100], [200, -100], [200, 200], [60, 200], [60, -50], [40, -50], [40, 200], [-100, 200]];
  const out = clipPolygonToRing([[0, 0], [100, 0], [100, 100], [0, 100]], clipRing);
  assert.equal(out.length, 2);
  const total = out.reduce((s, p) => s + area(p), 0);
  assert.ok(Math.abs(total - 8000) < 1e-6, `area ${total}`);
});

test('polyline clip: in-out-in splits into two runs with cut ends inset', () => {
  const clipRing = [[-100, -100], [200, -100], [200, 200], [60, 200], [60, -50], [40, -50], [40, 200], [-100, 200]];
  const runs = clipPolylineToRing([[0, 0], [100, 0]], clipRing, 5);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].map(p => p.map(v => +v.toFixed(6))), [[0, 0], [35, 0]]);
  assert.deepEqual(runs[1].map(p => p.map(v => +v.toFixed(6))), [[65, 0], [100, 0]]);
});

test('contours: segments beyond the edge are dropped, crossing ones cut at it', () => {
  // Minimal stand-in for a THREE.BufferGeometry position attribute.
  class Attr { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
  const geo = { attrs: {}, getAttribute(n) { return this.attrs[n]; }, setAttribute(n, a) { this.attrs[n] = a; },
    computeBoundingBox() {}, computeBoundingSphere() {} };
  // Walk a line of segments from central London out past the western edge.
  const segs = [];
  for (let x = -20000; x > -40000; x -= 500) segs.push(x, 10, 0, x - 500, 10, 0);
  geo.setAttribute('position', new Attr(new Float32Array(segs), 3));
  const r = clipLineSegmentsToMapEdge(geo, 0, 0, isOffMapEdge);
  assert.ok(r.after < r.before && r.cut === 1, JSON.stringify(r));
  const a = geo.getAttribute('position').array;
  let worst = Infinity;
  for (let i = 0; i < a.length; i += 3) worst = Math.min(worst, signedDistanceToRing(a[i], a[i + 2], ring));
  assert.ok(worst > -1, `contour vertex ${-worst} m past the edge`);
  assert.ok(worst < 1, 'the crossing segment reaches the edge');
});
