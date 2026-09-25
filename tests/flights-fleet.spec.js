// Lane F (sprint 25Sep26f, D-039): London City every 2 minutes, steady small-
// airfield circuits, two new types, three liveries as separate meshes, and
// aircraft at true proportions at every distance. The model and the render
// group run in Node against stub terrain; the last test checks the live app.
import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import * as F from '../src/flights.js';
import { getSurfaceWind } from '../src/wind.js';
import { AIRCRAFT_LIVERIES } from '../src/aircraft-model.js';

const DEG = Math.PI / 180;
const tilted = ({ x, z }) => (20 + x * 0.0002 + z * 0.0001) * 5;
const EASTERLY = () => ({ dirRad: 90 * DEG, speedMps: 6 });
test.afterEach(() => F.setWindSource(null));

test('London City: a departure about every 2 minutes, never bunched', () => {
  const m = F.createTrafficModel({ getSurfaceY: tilted });
  const stream = m.streams.find(s => s.id === 'london-city-departures');
  const anchors = [];
  for (let k = 0; k < 180; k++) anchors.push(m.flightVariant(stream, k).anchor); // six hours
  const gaps = anchors.slice(1).map((a, i) => a - anchors[i]);
  const mean = gaps.reduce((a, b) => a + b) / gaps.length;
  expect(mean).toBeGreaterThan(115); expect(mean).toBeLessThan(125);
  expect(Math.min(...gaps)).toBeGreaterThan(75);
  expect(Math.max(...gaps)).toBeLessThan(165);
  // Seen in the sky: brake releases counted from the rendered list over 3 hours.
  const seen = new Map();
  for (let t = 0; t < 10800; t += 2) for (const f of m.flightsAt(t, { includeHidden: true }))
    if (f.stream === 'london-city-departures' && !seen.has(f.id)) seen.set(f.id, f.anchor);
  const perHour = seen.size / 3;
  expect(perHour).toBeGreaterThan(27); expect(perHour).toBeLessThan(33);
  // Arrivals keep pace, so the airfield is balanced.
  const arr = m.streams.find(s => s.id === 'london-city-arrivals');
  expect(arr.period).toBe(120);
  // Arrival and departure never share the runway at the same moment: every
  // landing roll has ended before the next brake release.
  for (let k = 0; k < 120; k++) {
    const a = m.flightVariant(arr, k), path = m.pathFor(arr, a);
    const rollEnd = a.anchor + (path.duration - path.anchorT);
    const next = anchors.find(x => x >= a.anchor);
    expect(next - rollEnd).toBeGreaterThan(0);
  }
});

const CIRCUIT_FIELDS = ['northolt', 'biggin-hill', 'elstree', 'denham', 'stapleford', 'damyns-hall', 'kenley'];

test('each small airfield keeps a steady circuit of 2 or 3 aircraft, in every wind, without jumps', () => {
  for (const [name, wind] of [['default', null], ['easterly', EASTERLY], ['app surface wind', getSurfaceWind], ['northerly', () => ({ dirRad: 0, speedMps: 6 })]]) {
    F.setWindSource(wind);
    const m = F.createTrafficModel({ getSurfaceY: tilted });
    const bad = [], prev = new Map(), sizes = {};
    for (const s of m.streams.filter(s => s.kind === 'circuit')) {
      expect(s.loop, s.id).toBe(true);
      expect([2, 3]).toContain(s.aircraft);
      expect(s.period * s.aircraft).toBeCloseTo(s.lapSeconds, 6);
      sizes[s.airport] = s.aircraft;
    }
    expect(Object.keys(sizes).sort()).toEqual([...CIRCUIT_FIELDS].sort());
    for (let t = 0; t < 7200; t += 1) {
      const all = m.flightsAt(t, { includeHidden: true }), by = {}, inView = {};
      for (const f of all) {
        if (f.kind !== 'circuit') continue;
        by[f.airport] = (by[f.airport] || 0) + 1;
        if (f.visible) inView[f.airport] = (inView[f.airport] || 0) + 1;
        // One aircraft per slot, moving continuously lap after lap (the lap
        // handoff is exact: same place, same speed, same type and livery).
        const key = `${f.stream}#${f.slot}`, p = prev.get(key);
        if (p && (Math.hypot(f.x - p.x, f.z - p.z) > 90 || p.model !== f.model || p.livery !== f.livery)) bad.push([name, 'jump', key, t]);
        prev.set(key, f);
      }
      for (const id of CIRCUIT_FIELDS) {
        if ((by[id] || 0) !== sizes[id]) bad.push([name, 'in progress', id, t, by[id]]);
        const n = inView[id] || 0;
        if (n < 2 || n > 3) bad.push([name, 'in view', id, t, n]);
      }
      if (bad.length > 20) break;
    }
    expect(bad).toEqual([]);
  }
});

test('circuits fly a closed touch-and-go lap near the airfield, at circuit height', () => {
  const m = F.createTrafficModel({ getSurfaceY: tilted });
  for (const s of m.streams.filter(s => s.kind === 'circuit')) {
    const v = m.flightVariant(s, 3), path = m.pathFor(s, v), a = path.samples[0], b = path.samples.at(-1);
    expect(Math.hypot(a.x - b.x, a.z - b.z), s.id).toBeLessThan(0.01);
    expect(a.ground && b.ground).toBe(true);
    const top = Math.max(...path.samples.map(x => x.alt)) - path.elevation;
    const P = F.CIRCUIT_PATTERNS[s.pattern];
    expect(top).toBeGreaterThan(P.H - 5); expect(top).toBeLessThan(P.H + 5);
    const c = s.site.centre, far = Math.max(...path.samples.map(x => Math.hypot(x.x - c[0], x.z - c[1])));
    expect(far).toBeLessThan(9000);
  }
});

test('two new types at true size: an ATR 72-class turboprop and an A380-class widebody', () => {
  const g = F.createFlights({ getSurfaceY: tilted });
  const size = key => { const geo = g.userData.meshes[key].geometry; geo.computeBoundingBox(); const b = geo.boundingBox; return { span: b.max.x - b.min.x, height: b.max.y - b.min.y, length: b.max.z - b.min.z }; };
  const atr = size('turboprop:dove'), big = size('superjumbo:dove'), narrow = size('narrow:dove');
  // ATR 72: 27.2 m long, 27.1 m span, 7.7 m tall (drawn a touch longer at the prop discs).
  expect(atr.length).toBeGreaterThan(26); expect(atr.length).toBeLessThan(29);
  expect(atr.span).toBeGreaterThan(25.5); expect(atr.span).toBeLessThan(28.5);
  expect(atr.height).toBeGreaterThan(7); expect(atr.height).toBeLessThan(10);
  // A380: 72.7 m long, 79.8 m span, 24.1 m tall.
  expect(big.length).toBeGreaterThan(70); expect(big.length).toBeLessThan(76);
  expect(big.span).toBeGreaterThan(76); expect(big.span).toBeLessThan(83);
  expect(big.height).toBeGreaterThan(20); expect(big.height).toBeLessThan(27);
  expect(big.length).toBeGreaterThan(narrow.length * 1.6);
  expect(F.AIRCRAFT_TYPES.turboprop.length).toBe(27);
  expect(F.AIRCRAFT_TYPES.superjumbo.length).toBe(73);
  g.userData.dispose();
});

test('three liveries are separate meshes per type, chosen by the hash, never per-instance colour', () => {
  expect([...F.FLIGHT_LIVERIES]).toEqual(['warmGrey', 'taupe', 'dove']);
  const g = F.createFlights({ getSurfaceY: tilted });
  const meshes = Object.entries(g.userData.meshes);
  expect(meshes).toHaveLength(Object.keys(F.AIRCRAFT_TYPES).length * 3);
  const materials = new Set();
  const c = new THREE.Color();
  for (const [key, mesh] of meshes) {
    const [model, livery] = key.split(':');
    expect(mesh.userData).toMatchObject({ type: 'flight', model, livery });
    expect(mesh.instanceColor).toBeNull();
    expect(mesh.geometry.getAttribute('instanceColor')).toBeFalsy();
    expect(mesh.material.vertexColors).toBe(true);
    materials.add(mesh.material);
    // The livery's body colour is baked into the vertex colours.
    c.setHex(AIRCRAFT_LIVERIES[livery].white);
    const col = mesh.geometry.attributes.color.array;
    let body = 0; for (let i = 0; i < col.length; i += 3) if (Math.abs(col[i] - c.r) < 1e-6 && Math.abs(col[i + 1] - c.g) < 1e-6 && Math.abs(col[i + 2] - c.b) < 1e-6) body++;
    expect(body, key).toBeGreaterThan(col.length / 3 * 0.3);
  }
  expect(materials.size).toBe(1); // one program for the whole fleet
  // Every drawn aircraft sits in the mesh of its own type and livery, and over
  // an hour every livery flies and the hash spreads them.
  const tally = {};
  for (let t = 0; t < 3600; t += 30) {
    g.userData.setElapsed(t);
    const want = {};
    for (const f of g.userData.flights) { want[f.meshKey] = (want[f.meshKey] || 0) + 1; expect(f.meshKey).toBe(`${f.model}:${f.livery}`); tally[f.livery] = (tally[f.livery] || 0) + 1; }
    for (const [key, mesh] of meshes) { expect(mesh.count, key).toBe(want[key] || 0); expect(mesh.visible).toBe(mesh.count > 0); }
  }
  const total = Object.values(tally).reduce((a, b) => a + b);
  for (const l of F.FLIGHT_LIVERIES) expect(tally[l] / total).toBeGreaterThan(0.15);
  // Deterministic: the same flight always wears the same livery.
  const m = g.userData.traffic, s = m.streams[0];
  expect(m.flightVariant(s, 42).livery).toBe(m.flightVariant(s, 42).livery);
  g.userData.dispose();
});

test('no aircraft is ever scaled non-uniformly, near or far, at any Master', () => {
  const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 400000);
  const m4 = new THREE.Matrix4();
  for (const master of [1, 1.1, 3, 10]) {
    // The app passes getBuildingHeightScale, which is 1 / Master since D-039;
    // the camera then shows canonical y x Master / 5.
    const g = F.createFlights({ getSurfaceY: tilted, getHeightScale: () => 1 / master });
    const ratio = master / 5;
    let checked = 0, grown = 0;
    const bad = [];
    for (const t of [1000, 2000.5, 3333]) {
      g.userData.setElapsed(t);
      const f0 = g.userData.flights[0];
      for (const [dx, dy, dz] of [[150, 50, 150], [3000, 800, 2000], [30000, 20000, 40000]]) {
        cam.position.set(f0.x + dx, f0.y + dy, f0.z + dz); cam.lookAt(f0.x, f0.y, f0.z); cam.updateMatrixWorld(true);
        g.userData.update(0, cam);
        for (const f of g.userData.flights) if (f.displayScale > 1) grown++;
        for (const mesh of Object.values(g.userData.meshes)) for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m4);
          const e = m4.elements;
          // Displayed basis columns: y rows multiplied by the camera's Master / 5.
          const cols = [0, 4, 8].map(o => new THREE.Vector3(e[o], e[o + 1] * ratio, e[o + 2]));
          const L = cols.map(v => v.length());
          const spread = (Math.max(...L) - Math.min(...L)) / Math.max(...L);
          const skew = Math.max(Math.abs(cols[0].dot(cols[1])), Math.abs(cols[0].dot(cols[2])), Math.abs(cols[1].dot(cols[2]))) / (L[0] * L[1]);
          if (!(spread < 1e-6 && skew < 1e-6)) bad.push([master, mesh.name, i, spread, skew]);
          checked++;
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(50);
    expect(grown).toBeGreaterThan(0); // the far view exercised the speck floor
    g.userData.dispose();
  }
});

// ── Live scene ──────────────────────────────────────────────────────────────
test('live scene: every drawn aircraft is uniform on screen at Master 1, 1.1 and 4, near and far', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/?skip=1');
  await page.waitForFunction(() => window.__ug?.flightsGroup && window.__ug?.masterHeight, null, { timeout: 150000 });
  const r = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, g = u.flightsGroup, ud = g.userData;
    u.sim.paused = true;
    const out = [], m4 = new T.Matrix4();
    for (const master of [1, 1.1, 4]) {
      u.masterHeight.setValue(master);
      for (const dist of [200, 40000]) {
        ud.setElapsed(1000);
        const f0 = ud.flights[0];
        u.camera.position.set(f0.x + dist * .6, f0.y + dist * .3, f0.z + dist * .7); u.camera.lookAt(f0.x, f0.y, f0.z); u.camera.updateMatrixWorld(true);
        ud.update(0, u.camera);
        const ratio = u.masterHeight.ratio;
        let worst = 0, n = 0, grown = 0;
        for (const f of ud.flights) if (f.displayScale > 1) grown++;
        for (const mesh of Object.values(ud.meshes)) for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m4); const e = m4.elements;
          const cols = [0, 4, 8].map(o => new T.Vector3(e[o], e[o + 1] * ratio, e[o + 2]));
          const L = cols.map(v => v.length()), mx = Math.max(...L);
          worst = Math.max(worst, (mx - Math.min(...L)) / mx, Math.abs(cols[0].dot(cols[1])) / (L[0] * L[1]), Math.abs(cols[1].dot(cols[2])) / (L[1] * L[2]));
          n++;
        }
        out.push({ master, dist, worst, n, grown });
      }
    }
    u.masterHeight.setValue(1.1);
    return out;
  });
  // (The frustum-cull economy draws only the aircraft in view.)
  for (const x of r) { expect(x.n, JSON.stringify(x)).toBeGreaterThan(0); expect(x.worst, JSON.stringify(x)).toBeLessThan(1e-4); }
  expect(r.reduce((a, x) => a + x.n, 0)).toBeGreaterThan(20);
  expect(r.some(x => x.grown > 0)).toBe(true);
});
