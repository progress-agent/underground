// Map edge = outer face of the outer carriageway (sprint 23Sep26w, D-037
// Lane B). Jordan: "the edge of the motorway actually defining the edge of
// the map, rather than the edge being this squiggly border a little way
// beyond the road."

import { test, expect } from '@playwright/test';
import { MOTORWAY_DATA, motorwayRoadWidth } from '../src/m25-motorway.js';
import { getMapEdgeRing, getMapEdgePointsBNG, signedDistanceToRing, rasterSignedDistanceMask, sampleMaskBilinear, trimRibbonVolumeToRing, MAP_EDGE_BARRIER_OUTSET_M } from '../src/m25-edge.js';
import airportData from '../src/airport-data.json' with { type: 'json' };
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const ring = getMapEdgeRing();
const byId = new Map(MOTORWAY_DATA.roads.map(w => [w.id, w]));
const outer = MOTORWAY_DATA.routes.find(r => r.id === MOTORWAY_DATA.boundary.routeId);

/** Rendered barrier outer faces of a way, both sides, at segment midpoints. */
function barrierFaces(w) {
  const h = motorwayRoadWidth(w) / 2 + MAP_EDGE_BARRIER_OUTSET_M, out = [];
  for (let i = 0; i < w.points.length - 1; i++) {
    const a = w.points[i], b = w.points[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1) continue;
    const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    out.push([mx - dz * h, mz + dx * h], [mx + dz * h, mz - dx * h]);
  }
  return out;
}

test('edge ring is simple, closed as BNG, and encloses the whole map it replaces', () => {
  expect(ring.length).toBeGreaterThan(1000);
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let crossings = 0; const n = ring.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = ring[i], b = ring[(i + 1) % n], c = ring[j], d = ring[(j + 1) % n];
    if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) crossings++;
  }
  expect(crossings).toBe(0);
  const bng = getMapEdgePointsBNG();
  expect(bng[0]).toEqual(bng.at(-1));
  // All nine airfields sit inside the ring (plan: closest ~1.3km).
  let closest = Infinity;
  for (const a of airportData.airports) for (const r of a.runways) for (const p of r.points) closest = Math.min(closest, signedDistanceToRing(p[0], p[1], ring));
  expect(closest).toBeGreaterThan(500);
});

test('edge radius equals the outer carriageway: the ring IS the outer barrier face', () => {
  // Every outer-circuit segment has one barrier face on the ring (distance ~0)
  // and the other a full carriageway width inside it.
  const onRing = [], inner = [];
  for (const id of outer.wayIds) {
    const w = byId.get(id), faces = barrierFaces(w), width = motorwayRoadWidth(w) + 2 * MAP_EDGE_BARRIER_OUTSET_M;
    for (let k = 0; k < faces.length; k += 2) {
      const d = [signedDistanceToRing(...faces[k], ring), signedDistanceToRing(...faces[k + 1], ring)].sort((a, b) => Math.abs(a) - Math.abs(b));
      onRing.push(Math.abs(d[0])); inner.push(d[1] - width);
    }
  }
  onRing.sort((a, b) => a - b); inner.sort((a, b) => a - b);
  const p99 = a => a[Math.floor(a.length * 0.99)];
  expect(p99(onRing)).toBeLessThan(0.5);
  expect(onRing[Math.floor(onRing.length / 2)]).toBeLessThan(0.05);
  expect(Math.abs(inner[Math.floor(inner.length / 2)])).toBeLessThan(0.1);
});

test('every mapped carriageway stays on the map (within 1.5m of the edge at worst)', () => {
  let worst = Infinity, outside = 0, total = 0;
  for (const w of MOTORWAY_DATA.roads) for (const f of barrierFaces(w)) {
    const d = signedDistanceToRing(...f, ring); total++;
    worst = Math.min(worst, d); if (d < -0.3) outside++;
  }
  expect(worst).toBeGreaterThan(-1.5);
  expect(outside / total).toBeLessThan(0.001);
});

test('signed-distance mask puts the bilinear 0.5 contour on the ring, not a texel squiggle', () => {
  // Same linear UV map as the terrain (xzToTerrainUV): BNG grid bounds
  // [490000, 151093.75, 560000, 205000] about the Trafalgar origin.
  const minX = 490000 - BNG_REF_E, minZ = BNG_REF_N - 205000, W = 70000, H = 205000 - 151093.75;
  const toUV = ({ x, z }) => ({ u: (x - minX) / W, v: (z - minZ) / H });
  const size = 2048, mask = rasterSignedDistanceMask(ring, size, toUV);
  let worst = 0;
  // Walk each probe along the local outward normal and find the 0.5 crossing.
  for (let i = 0; i < ring.length; i += 37) {
    const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 5) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
    if (signedDistanceToRing(mx + nx, mz + nz, ring) > 0) { nx = -nx; nz = -nz; }
    let prev = sampleMaskBilinear(mask, size, toUV, mx - nx * 20, mz - nz * 20), found = null;
    for (let t = -20 + 0.25; t <= 20; t += 0.25) {
      const v = sampleMaskBilinear(mask, size, toUV, mx + nx * t, mz + nz * t);
      if (prev >= 0.5 && v < 0.5) { found = t; break; }
      prev = v;
    }
    expect(found).not.toBeNull();
    // The exact local edge may be a neighbouring segment at a corner: compare
    // with the true signed distance at the found point, not with t.
    worst = Math.max(worst, Math.abs(signedDistanceToRing(mx + nx * found, mz + nz * found, ring)));
  }
  // Old binary mask: the discard contour wandered tens of metres off the ring.
  expect(worst).toBeLessThan(1.5);
});

test('river ribbon trims to the cliff: cut on the edge, nothing beyond, layout intact', () => {
  // Synthetic straight ribbon crossing the west edge, 4 vertices per section.
  const i = ring.reduce((best, p, k) => (p[0] < ring[best][0] ? k : best), 0), p = ring[i];
  const sections = 40, pos = new Float32Array(sections * 4 * 3);
  for (let s = 0; s < sections; s++) {
    const x = p[0] + 200 - s * 10;
    [[x, 12, p[1] - 20], [x, 12, p[1] + 20], [x, -20, p[1] - 20], [x, -20, p[1] + 20]].forEach((v, k) => pos.set(v, (s * 4 + k) * 3));
  }
  const geometry = { attr: { array: pos, count: sections * 4, needsUpdate: false },
    getAttribute() { return this.attr; }, computeBoundingBox() {}, computeBoundingSphere() {} };
  const kept = trimRibbonVolumeToRing(geometry, ring);
  expect(kept).not.toBeNull();
  let beyond = 0, maxOut = 0;
  for (let v = 0; v < sections * 4; v++) {
    const d = signedDistanceToRing(pos[v * 3], pos[v * 3 + 2], ring);
    if (d < -0.5) beyond++;
    maxOut = Math.max(maxOut, -d);
  }
  expect(beyond).toBe(0);
  expect(maxOut).toBeLessThan(0.5);
  expect(pos.length).toBe(sections * 12);
});

test('live scene: terrain ends at the edge, both waterfalls spill on it, the cliff faces out', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(() => !!(window.__ug?.scene?.getObjectByName('geology-exterior') && window.__ug.scene.getObjectByName('thamesWaterfalls')), null, { timeout: 90000 });
  const out = await page.evaluate(async () => {
    const { getMapEdgeRing, signedDistanceToRing } = await import('/src/m25-edge.js');
    const ring = getMapEdgeRing(), s = window.__ug.scene;
    const thames = (await (await fetch('/data/thames.json')).json()).points;
    const E = 530028.7469586737, N = 180380.09351556934, line = thames.map(p => [p.e - E, N - p.n]);
    const toLine = (x, z) => { let b = Infinity; for (let i = 0; i < line.length - 1; i++) { const [ax, az] = line[i], [bx, bz] = line[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((x - ax) * dx + (z - az) * dz) / l2; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
    const falls = s.getObjectByName('thamesWaterfalls').children.map(m => {
      const p = m.geometry.attributes.position, x = (p.getX(0) + p.getX(1)) / 2, z = (p.getZ(0) + p.getZ(1)) / 2;
      return { name: m.name, onEdge: signedDistanceToRing(x, z, ring), onRiver: toLine(x, z) };
    });
    // Skirt faces outward: its triangle normals point down the distance field.
    const skirt = s.getObjectByName('clayDiscSkirt'), pos = skirt.geometry.attributes.position, idx = skirt.geometry.index.array;
    let outward = 0, inward = 0;
    for (let t = 0; t < idx.length; t += 3 * 97) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(i => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0], l = Math.hypot(nx, nz);
      if (l < 1e-6) continue;
      const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      (signedDistanceToRing(cx + nx / l * 5, cz + nz / l * 5, ring) < signedDistanceToRing(cx, cz, ring) ? outward++ : inward++);
    }
    let skirtOff = 0;
    for (let i = 0; i < pos.count; i += 9 * 11) skirtOff = Math.max(skirtOff, Math.abs(signedDistanceToRing(pos.getX(i), pos.getZ(i), ring)));
    let mask = null; s.traverse(o => { if (!mask && o.name === 'terrainMesh') mask = o.material.userData.m25Mask; });
    // River water ends at the cliff.
    const river = s.getObjectByName('thamesRiver').geometry.attributes.position;
    let riverBeyond = 0;
    for (let i = 0; i < river.count; i += 13) riverBeyond = Math.max(riverBeyond, -signedDistanceToRing(river.getX(i), river.getZ(i), ring));
    return { falls, outward, inward, skirtOff, band: mask?.userData?.signedDistanceBandM, riverBeyond };
  });
  expect(out.falls.map(f => f.name).sort()).toEqual(['thamesWaterfall_east', 'thamesWaterfall_west']);
  for (const f of out.falls) {
    expect(Math.abs(f.onEdge)).toBeLessThan(1);   // the lip is on the map edge
    expect(f.onRiver).toBeLessThan(1);            // where the river's own line crosses it
  }
  // A handful of samples sit on the short steps where the carriageway width
  // changes, whose 5m probe can land beside a corner; an inside-out skirt
  // would score ~0% outward.
  expect(out.outward).toBeGreaterThan(100);
  expect(out.outward / (out.outward + out.inward)).toBeGreaterThan(0.98);
  expect(out.skirtOff).toBeLessThan(0.5);
  expect(out.band).toBeGreaterThan(0);
  expect(out.riverBeyond).toBeLessThan(1);
});
