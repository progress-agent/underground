// M25 traffic distribution, vehicle classes and economy (sprint 23Sep26w,
// D-037 Lane B). Browser-free: the motorway builds against a flat stub
// terrain, exactly as tests/m25-motorway.spec.js does.
//
// Jordan: the traffic moved "in uniformly patterned groups ... leaving big
// gaps between clusters". The old placement squeezed each 3km into 1.2km,
// giving ~1.8km empty stretches. These tests pin the replacement: continuous,
// irregular, deterministic, never overlapping, 13,622 stable identities.

import { test, expect } from '@playwright/test';
import { createMotorway } from '../src/m25-motorway.js';
import { VEHICLE_TYPES, VEHICLE_COLOURS, TRAFFIC_VARIATION_M, TRAFFIC_CLEARANCE_M, TRAFFIC_SPEED_MPS, hash01, vehicleClass, laneFor } from '../src/m25-traffic.js';

const lengthOf = type => VEHICLE_TYPES.find(t => t.id === type).length;
// A fresh motorway per test: elapsed time only ever advances (update ignores
// negative dt), so each test walks its own times in ascending order.
const motorway = () => createMotorway({ getSurfaceY: () => 40 });
const setTime = (g, t) => {
  if (t < g.userData.getElapsed()) throw new Error('times must ascend within a test');
  g.userData.update(t - g.userData.getElapsed(), null, true);
  expect(g.userData.getElapsed()).toBeCloseTo(t, 6);
};

/** Vehicles of each carriageway (clockwise circuit; each anticlockwise bore
 * circuit separately), sorted by chainage, with bumper gaps. */
function carriagewayGaps(g) {
  const total = g.userData.stats.vehicles, byRoute = new Map();
  for (let id = 0; id < total; id++) {
    const p = g.userData.vehicleAt(id);
    if (!byRoute.has(p.routeId)) byRoute.set(p.routeId, []);
    byRoute.get(p.routeId).push({ ...p });
  }
  return [...byRoute.entries()].map(([routeId, vs]) => {
    const L = g.userData.routes.find(r => r.id === routeId).length;
    vs.sort((a, b) => a.distance - b.distance);
    const gaps = vs.map((v, i) => { const n = vs[(i + 1) % vs.length]; return ((n.distance - v.distance) % L + L) % L; });
    return { routeId, L, vs, gaps };
  });
}

test('every one of the 13,622 identities survives, each drawn exactly once', () => {
  const g = motorway();
  expect(g.userData.stats.vehicles).toBe(13622);
  setTime(g, 0);
  const seen = new Set();
  for (const mesh of g.children.filter(m => m.isInstancedMesh))
    for (let i = 0; i < mesh.count; i++) seen.add(mesh.userData.vehicleIds[i]);
  expect(seen.size).toBe(13622);
});

test('no platoons: the joint carriageway flow is continuous and irregular at any time', () => {
  const g = motorway();
  for (const t of [0, 377, 3600, 86400]) {
    setTime(g, t);
    // Clockwise is one carriageway, one circuit: the whole flow in one list.
    const cw = carriagewayGaps(g).find(c => c.vs[0] && g.userData.routes.find(r => r.id === c.routeId).direction === 'clockwise');
    const gaps = cw.gaps, n = gaps.length, mean = gaps.reduce((a, b) => a + b) / n;
    const cv = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / n) / mean;
    // Old layout: 1.8km holes every 3km (cv > 2). Evenly spaced: cv 0.
    expect(Math.max(...gaps)).toBeLessThan(250);
    expect(cv).toBeGreaterThan(0.3);
    expect(cv).toBeLessThan(1.0);
    // Every kilometre of carriageway carries traffic; no empty stretches.
    const perKm = new Array(Math.floor(cw.L / 1000)).fill(0);
    for (const v of cw.vs) if (v.distance < perKm.length * 1000) perKm[Math.floor(v.distance / 1000)]++;
    expect(Math.min(...perKm)).toBeGreaterThan(15);
    expect(Math.max(...perKm)).toBeLessThan(60);
  }
});

test('vehicles never overlap: bumper clearance holds on every carriageway over time', () => {
  const g = motorway();
  for (const t of [0, 90, 1234.5, 86400]) {
    setTime(g, t);
    // Planar test across all circuits of one direction at once (the two
    // anticlockwise bore circuits share most of their carriageway): any two
    // vehicles closer than half their summed lengths would be touching.
    const all = carriagewayGaps(g).flatMap(c => c.vs), cell = new Map(), key = (x, z) => `${Math.floor(x / 25)},${Math.floor(z / 25)}`;
    const directions = new Map(g.userData.routes.map(r => [r.id, r.direction])), direction = v => directions.get(v.routeId);
    for (const v of all) { const k = key(v.x, v.z); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(v); }
    let worst = Infinity;
    for (const v of all) {
      const cx = Math.floor(v.x / 25), cz = Math.floor(v.z / 25);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const w of cell.get(`${cx + a},${cz + b}`) || []) {
        // Opposite carriageways pass each other across the central reserve.
        if (w.id <= v.id || direction(w) !== direction(v)) continue;
        const need = (lengthOf(v.vehicleType) + lengthOf(w.vehicleType)) / 2;
        worst = Math.min(worst, Math.hypot(v.x - w.x, v.z - w.z) - need);
      }
    }
    // Lanes are 4.13m apart, so side-by-side neighbours pass; nose-to-tail
    // pairs keep the clearance (less the curvature of a chord).
    expect(worst).toBeGreaterThan(TRAFFIC_CLEARANCE_M - 0.5);
  }
});

test('placement and speed variation are deterministic functions of identity and elapsed time', () => {
  const a = createMotorway({ getSurfaceY: () => 40 }), b = motorway();
  setTime(b, 5000);
  a.userData.update(5000, null, true);
  for (const id of [0, 1, 777, 6816, 9999, 13621]) {
    const p = a.userData.vehicleAt(id), q = b.userData.vehicleAt(id);
    expect(p.distance).toBe(q.distance);
    expect([p.vehicleType, p.colour, p.lane]).toEqual([q.vehicleType, q.colour, q.lane]);
    expect(p.distance).toBe(a.userData.vehicleChainageAt(id, 5000));
  }
  a.userData.dispose();
  // The variation exists (vehicles do not all move rigidly) and is bounded.
  const L = b.userData.routes[0].length;
  const advances = [];
  for (let id = 0; id < 400; id++) {
    const d0 = b.userData.vehicleChainageAt(id, 1000), d1 = b.userData.vehicleChainageAt(id, 1060);
    advances.push((((d1 - d0) % L) + L) % L);
  }
  const lo = Math.min(...advances), hi = Math.max(...advances), common = TRAFFIC_SPEED_MPS * 60;
  expect(hi - lo).toBeGreaterThan(1);
  expect(lo).toBeGreaterThan(common - 2 * TRAFFIC_VARIATION_M - 0.1);
  expect(hi).toBeLessThan(common + 2 * TRAFFIC_VARIATION_M + 0.1);
});

test('three types in a realistic mix, five colours, lorries a minority in the inside lane', () => {
  const g = motorway();
  setTime(g, 0);
  const total = g.userData.stats.vehicles, types = {}, colours = {}, lorryLane = { inside: 0, other: 0 }, lanes = {};
  for (let id = 0; id < total; id++) {
    const p = g.userData.vehicleAt(id);
    types[p.vehicleType] = (types[p.vehicleType] || 0) + 1;
    colours[p.colour] = (colours[p.colour] || 0) + 1;
    if (p.vehicleType === 'lorry') lorryLane[p.lane === 0 ? 'inside' : 'other']++;
    else lanes[p.lane] = (lanes[p.lane] || 0) + 1;
  }
  expect(Object.keys(types).sort()).toEqual(['car', 'lorry', 'van']);
  expect(Object.keys(colours).sort()).toEqual(['black', 'darkBlue', 'red', 'silver', 'white']);
  expect(types.car / total).toBeGreaterThan(0.6);
  expect(types.lorry / total).toBeGreaterThan(0.06);
  expect(types.lorry / total).toBeLessThan(0.2);
  expect(types.van / total).toBeGreaterThan(0.1);
  expect(lorryLane.inside / (lorryLane.inside + lorryLane.other)).toBeGreaterThan(0.7);
  // Cars and vans use every lane, including the outside lanes.
  expect(Object.keys(lanes).length).toBeGreaterThanOrEqual(4);
  for (const c of VEHICLE_COLOURS) expect(colours[c.id] / total).toBeGreaterThan(0.04);
  // Lane rules: lorries never take the outside lane of a 3+ lane road.
  for (let k = 0; k < 2000; k++) for (const n of [2, 3, 4, 5, 6]) {
    const lane = laneFor(2, hash01(k, 9), n);
    expect(lane).toBeLessThanOrEqual(Math.max(0, n - 2));
  }
  expect(VEHICLE_TYPES[2].id).toBe('lorry');
  expect(vehicleClass(12345)).toEqual(vehicleClass(12345));
});

test('economy: 15 near meshes (type x colour) and 5 far meshes, no per-instance colour', () => {
  const g = motorway();
  const traffic = g.children.filter(m => m.isInstancedMesh);
  const near = traffic.filter(m => m.userData.lod === 'near'), far = traffic.filter(m => m.userData.lod === 'far');
  expect(near).toHaveLength(15);
  expect(far).toHaveLength(5);
  expect(new Set(near.map(m => `${m.userData.vehicleType}/${m.userData.colour}`)).size).toBe(15);
  expect(new Set(far.map(m => m.userData.colour)).size).toBe(5);
  g.traverse(m => {
    if (!m.isMesh) return;
    expect(m.instanceColor).toBeFalsy();
    expect(m.geometry.getAttribute('instanceColor')).toBeFalsy();
  });
  // Colour is baked into ordinary vertex colours on one shared material.
  expect(new Set(near.map(m => m.material)).size).toBe(1);
  expect(near[0].material.vertexColors).toBe(true);
  for (const m of near) expect(m.userData.trianglesPerVehicle).toBe(36);
  // Draw calls stay bounded by class, not by circuit count.
  expect(g.userData.stats.allocatedDrawCalls).toBeLessThanOrEqual(6 + 15 + 5);
});
