// Sprint 30Sep26w (D-041 item 2, Lane T): the mapping from the underground
// timetable's station-chord curves to the open-air track
// (src/surface-train-map.js), in node. The browser checks (determinism over two
// loads, portals, counts per line, Master, the cull) are in
// tests/surface-trains.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  STOCK, PROFILES, LINE_STOCK, carLayout, CAR_GAP_M, buildNetwork, nearestNode, route, mapTubeCurve, mapSnapCurve,
  buildSegmentIndex, runAt, sAt, sampleRun, laneOffset, drawnY, JOIN_M, LANE_OFFSET_M, RUN_END_EXTENSION_M, computeCrossSlopes, profileGeometries, LANE_SPACING_M, LANE_EASE, RUN_MAX_LIFT_GRADE,
} from '../src/surface-train-map.js';

// ── Stock ─────────────────────────────────────────────────────────────────────
test('rolling stock: sourced lengths, widths and heights; cars fill the train', () => {
  // Wikipedia infoboxes (retrieved 01Oct26h); see surface-train-map.js.
  const expectTrain = { S8: 133.682, S7: 117.448, 1972: 113.552, 1992: 130, '1992-wc': 65, 1996: 126.492, 1995: 108.472, 1973: 106.81, B07: 84 };
  const expectCars = { S8: 8, S7: 7, 1972: 7, 1992: 8, '1992-wc': 4, 1996: 7, 1995: 6, 1973: 6, B07: 6 };
  for (const [key, s] of Object.entries(STOCK)) {
    assert.ok(Math.abs(s.trainM - expectTrain[key]) < 1e-9, key);
    const cars = carLayout(s);
    assert.equal(cars.length, expectCars[key], key);
    const span = cars.at(-1).offset + cars.at(-1).length / 2 - (cars[0].offset - cars[0].length / 2);
    assert.ok(span <= s.trainM && span > s.trainM - 2, `${key} spans ${span}`);
    assert.ok(Math.abs(cars.reduce((a, c) => a + c.offset, 0)) < 1e-9, `${key} centred`);
    for (let i = 1; i < cars.length; i++) assert.ok(cars[i].offset - cars[i - 1].offset >= (cars[i].length + cars[i - 1].length) / 2 + 0.29, `${key} cars do not overlap`);
    // A stock is drawn on its profile, scaled by at most 1% (the deep-tube stocks differ by 2 cm).
    const p = PROFILES[s.profile];
    assert.ok(Math.abs(s.widthM / p.widthM - 1) < 0.01 && Math.abs(s.heightM / p.heightM - 1) < 0.01, key);
  }
  // S Stock: two 18.139 m driving cars and 16.234 m middle cars, exactly the train.
  assert.ok(Math.abs(STOCK.S7.cars.reduce((a, b) => a + b) - STOCK.S7.trainM) < 1e-9);
  assert.ok(Math.abs(STOCK.S8.cars.reduce((a, b) => a + b) - STOCK.S8.trainM) < 1e-9);
  assert.equal(CAR_GAP_M, 0.6);
  // Profiles: the half section's widest point and its roof are the profile's size.
  for (const p of Object.values(PROFILES)) {
    assert.ok(Math.abs(2 * Math.max(...p.half.map(h => h[0])) - p.widthM) < 1e-9);
    assert.ok(Math.abs(p.half.at(-1)[1] - p.heightM) < 1e-9);
  }
  // The small deep-tube profile is lower and narrower than the sub-surface S Stock.
  assert.ok(PROFILES.deep.heightM < PROFILES.subsurface.heightM - 0.7 && PROFILES.deep.widthM < PROFILES.subsurface.widthM - 0.25);
  // Lines and stock.
  for (const l of ['metropolitan']) assert.equal(LINE_STOCK[l], 'S8');
  for (const l of ['district', 'circle', 'hammersmith-city']) assert.equal(STOCK[LINE_STOCK[l]].profile, 'subsurface');
  for (const l of ['bakerloo', 'central', 'jubilee', 'northern', 'piccadilly', 'waterloo-city']) assert.equal(STOCK[LINE_STOCK[l]].profile, 'deep');
  assert.equal(STOCK[LINE_STOCK.dlr].profile, 'dlr');
  assert.equal(LINE_STOCK.victoria, undefined); // wholly in tunnel
});

// ── A synthetic line ──────────────────────────────────────────────────────────
// Three stations on a straight east-west chord; the real track bows 150 m
// north between them (z negative is north) and is in tunnel west of x = 1000.
const STATIONS = [{ key: 'A', x: 0, z: 0 }, { key: 'B', x: 2000, z: 0 }, { key: 'C', x: 4000, z: 0 }];
const bow = x => -150 * Math.sin(Math.PI * Math.max(0, Math.min(4000, x)) / 2000) ** 2;
function track({ from = -60, to = 4060, gapAt = null, gap = 0, tunnelBefore = 1000 } = {}) {
  const pieces = [];
  let pts = [];
  for (let x = from; x <= to; x += 12) {
    if (gapAt !== null && x > gapAt && x < gapAt + gap) { if (pts.length) { pieces.push({ pts, morph: true }); pts = []; } continue; }
    const terrainY = 20;
    pts.push({ x, z: bow(x), terrainY, y: x < tunnelBefore ? terrainY - 100 : terrainY + 5, cls: x < tunnelBefore ? 'tunnel' : 'surface' });
  }
  if (pts.length) pieces.push({ pts, morph: true });
  return pieces;
}
function chord(extra = []) {
  const pts = [new THREE.Vector3(0, -30, 6), new THREE.Vector3(2000, -20, 6), ...extra, new THREE.Vector3(4000, -25, 6)];
  const curve = new THREE.CatmullRomCurve3(pts);
  // main.js stationUsFromPolyline: each stop's share of the polyline (3-D) length.
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const stationIdx = [0, 1, pts.length - 1];
  return { curve, stationUs: stationIdx.map(i => cum[i] / cum.at(-1)) };
}
const fresh = net => ({ routes: new Map(), stationNode: new Map() });

test('stations anchor the run; progress is linear in u between anchors; a portal is anchored where the chord passes nearest', () => {
  const net = buildNetwork(track());
  const { curve, stationUs } = chord();
  const { runs, stats } = mapTubeCurve({ curve, stationUs, stations: STATIONS, net, cache: fresh(net) });
  assert.equal(stats.anchors, 3);
  assert.equal(stats.mapped, 2);
  assert.equal(runs.length, 1);
  const run = runs[0];
  // Anchors strictly increasing in u and non-decreasing in s.
  for (let k = 1; k < run.au.length; k++) { assert.ok(run.au[k] > run.au[k - 1]); assert.ok(run.as[k] >= run.as[k - 1]); }
  // Stations at their own u, on the track node nearest each station.
  const st = [...run.station].map((v, k) => v ? k : -1).filter(k => k >= 0);
  assert.deepEqual(st.map(k => run.au[k]), stationUs);
  const pt = {};
  for (const [k, S] of st.map((k, i) => [k, STATIONS[i]])) {
    sampleRun(run, sAt(run, run.au[k]), 1, pt);
    assert.ok(Math.hypot(pt.x - S.x, pt.z - bow(S.x)) < 7, `station ${S.key} on its track node`);
  }
  // The tunnel ends at x = 1000: one portal anchor, at the chord's nearest approach.
  const portals = [...run.portal].map((v, k) => v ? k : -1).filter(k => k >= 0);
  assert.equal(portals.length, 1);
  const k = portals[0], up = run.au[k];
  sampleRun(run, run.as[k], 1, pt);
  assert.ok(Math.abs(pt.x - 1000) < 13, `portal at the tunnel mouth (${pt.x})`);
  const d = u => { const p = curve.getPointAt(u); return Math.hypot(p.x - pt.x, p.z - pt.z); };
  const du = 10 / curve.getLength();
  assert.ok(d(up) <= d(up - du) + 1e-6 && d(up) <= d(up + du) + 1e-6, 'along-track part of the jump at the portal is zero');
  // Cross-track: the chord runs 6 m south of z = 0, the track 150 m north at the mouth.
  assert.ok(Math.abs(d(up) - 156) < 3, `portal error ${d(up)}`);
  // Linear between anchors.
  const um = (run.au[k] + run.au[k + 1]) / 2;
  assert.ok(Math.abs(sAt(run, um) - (run.as[k] + run.as[k + 1]) / 2) < 1e-9);
  // In the tunnel, closed; in the open, open.
  sampleRun(run, sAt(run, stationUs[0] + 0.01), 1, pt); assert.equal(pt.open, 0);
  sampleRun(run, sAt(run, stationUs[1]), 1, pt); assert.equal(pt.open, 1);
  // A terminus on open track is extended so a dwelling train is drawn whole; a station in tunnel is not.
  assert.equal(run.extendedEnd, true); assert.equal(run.extendedStart, false);
  // Along the drawn track while it carries on (to x = 4056 here), then straight: at least the
  // extension, at most one 12 m sample more (the walk stops at the first node past it).
  const ext = run.length - run.as.at(-1);
  assert.ok(ext >= RUN_END_EXTENSION_M - 1e-6 && ext < RUN_END_EXTENSION_M + 12.5, `extension ${ext}`);
  sampleRun(run, run.as.at(-1) + 40, 1, pt);
  assert.ok(Math.abs(pt.z - bow(pt.x)) < 1e-6 || pt.x > 4056, 'on the drawn track while it lasts');
  // runAt finds the run for any u it covers, and nothing outside.
  assert.equal(runAt(runs, stationUs[1]), run);
  assert.equal(runAt([{ u0: 0.2, u1: 0.4 }, { u0: 0.6, u1: 0.8 }], 0.5), null);
});

test('a stop list that is not one per control point (bridge points, _stationIndices) still anchors each station', () => {
  // Regression, 01Oct26h: the District's Wimbledon branch carries two Fulham
  // bridge points among its control points, while stationUs lists only the
  // stops. Matching by index anchored each stop at the station before it.
  const net = buildNetwork(track());
  const a = chord(), b = chord([new THREE.Vector3(3000, -22, 6)]);
  const ra = mapTubeCurve({ curve: a.curve, stationUs: a.stationUs, stations: STATIONS, net, cache: fresh(net) });
  const rb = mapTubeCurve({ curve: b.curve, stationUs: b.stationUs, stations: STATIONS, net, cache: fresh(net) });
  assert.equal(b.curve.points.length, 4); assert.equal(b.stationUs.length, 3);
  assert.equal(rb.stats.anchors, 3);
  const pt = {};
  for (const r of [ra, rb]) {
    const run = r.runs[0];
    const ks = [...run.station].map((v, k) => v ? k : -1).filter(k => k >= 0);
    ks.forEach((k, i) => { sampleRun(run, run.as[k], 1, pt); assert.ok(Math.abs(pt.x - STATIONS[i].x) < 7, `station ${STATIONS[i].key} at ${pt.x}`); });
  }
});

test('junction gaps join within JOIN_M; a wider gap leaves no route, counted', () => {
  const { curve, stationUs } = chord();
  const joined = buildNetwork(track({ gapAt: 2500, gap: JOIN_M - 30 })); // nodes every 12 m: a 30 m hole leaves the ends 36 m apart
  assert.equal(joined.pieces, 2); assert.ok(joined.joins >= 2);
  assert.equal(mapTubeCurve({ curve, stationUs, stations: STATIONS, net: joined, cache: fresh(joined) }).stats.mapped, 2);
  const split = buildNetwork(track({ gapAt: 2500, gap: JOIN_M + 40 }));
  const r = mapTubeCurve({ curve, stationUs, stations: STATIONS, net: split, cache: fresh(split) });
  assert.equal(r.stats.mapped, 1); assert.equal(r.stats.noRoute, 1);
});

test('A* finds the shortest route (against Dijkstra on a grid of pieces)', () => {
  // A 6 x 6 lattice of straight pieces, crossing at nodes joined by JOIN_M.
  const pieces = [];
  for (let i = 0; i < 6; i++) {
    pieces.push({ pts: Array.from({ length: 6 }, (_, j) => ({ x: j * 100 + (i % 2) * 7, z: i * 100, terrainY: 0, y: 1, cls: 'surface' })), morph: true });
    pieces.push({ pts: Array.from({ length: 6 }, (_, j) => ({ x: i * 100 + 3, z: j * 100 + 4, terrainY: 0, y: 1, cls: 'surface' })), morph: true });
  }
  const net = buildNetwork(pieces);
  const dijkstra = (s, t) => { const g = new Float64Array(net.n).fill(Infinity), done = new Uint8Array(net.n); g[s] = 0;
    for (;;) { let i = -1; for (let k = 0; k < net.n; k++) if (!done[k] && (i < 0 || g[k] < g[i])) i = k; if (i < 0 || g[i] === Infinity) break; done[i] = 1; if (i === t) break;
      for (let q = 0; q < net.adj[i].length; q += 2) { const j = net.adj[i][q], w = net.adj[i][q + 1]; if (g[i] + w < g[j]) g[j] = g[i] + w; } }
    return g[t]; };
  const len = p => { let L = 0; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], q = net.adj[a]; let w = Infinity; for (let k = 0; k < q.length; k += 2) if (q[k] === b) w = Math.min(w, q[k + 1]); L += w; } return L; };
  for (const [s, t] of [[0, net.n - 1], [3, 40], [17, 64], [5, 30]]) {
    const p = route(net, s, t);
    assert.ok(p && p[0] === s && p.at(-1) === t);
    assert.ok(Math.abs(len(p) - dijkstra(s, t)) < 1e-6);
  }
  assert.equal(route(net, 0, net.n - 1, 50), null); // bounded
  assert.equal(nearestNode(net, 1e6, 1e6, 300), -1);
});

test('deterministic: the same inputs give the same runs, with no Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random called by the surface-train mapping'); };
  try {
    const net1 = buildNetwork(track()), net2 = buildNetwork(track());
    const { curve, stationUs } = chord();
    const a = mapTubeCurve({ curve, stationUs, stations: STATIONS, net: net1, cache: fresh(net1) });
    const b = mapTubeCurve({ curve, stationUs, stations: STATIONS, net: net2, cache: fresh(net2) });
    assert.deepEqual(a.runs.map(r => [Array.from(r.au), Array.from(r.as), Array.from(r.x), Array.from(r.open)]), b.runs.map(r => [Array.from(r.au), Array.from(r.as), Array.from(r.x), Array.from(r.open)]));
  } finally { Math.random = real; }
});

// ── DLR: snapping a profile curve onto the drawn track ────────────────────────
test('DLR snapping: onto the drawn track within reach, the deck the curve is on at a flyover, tunnel closed', () => {
  // Two pieces side by side in plan (4 m apart): a lower viaduct at 4 m and a
  // flyover at 9 m (canonical y, morph false: already at the current scale).
  const line = (z, y, cls = 'viaduct') => ({ pts: Array.from({ length: 101 }, (_, i) => ({ x: i * 12, z, terrainY: 0, y, cls: i > 85 ? 'tunnel' : cls })), morph: false });
  const net = buildNetwork([line(0, 20), line(4, 45)]);
  const index = buildSegmentIndex(net);
  const curveAt = (z, y) => new THREE.CatmullRomCurve3([new THREE.Vector3(0, y, z), new THREE.Vector3(600, y, z), new THREE.Vector3(1200, y, z)]);
  const fallback = () => { throw new Error('no fallback expected'); };
  const low = mapSnapCurve({ curve: curveAt(-6, 20), net, index, ratio: 1, fallback });
  const high = mapSnapCurve({ curve: curveAt(10, 45), net, index, ratio: 1, fallback });
  const pt = {};
  for (const [m, y, z] of [[low, 20, 0], [high, 45, 4]]) {
    assert.equal(m.runs.length, 1);
    assert.equal(m.stats.fallback, 0);
    assert.ok(m.stats.maxSnapM <= 6 + 1e-9);
    const run = m.runs[0];
    sampleRun(run, sAt(run, 0.3), 1, pt);
    assert.ok(Math.abs(pt.y - y) < 1e-9 && Math.abs(pt.z - z) < 1e-9, `on its own deck (${pt.y}, ${pt.z})`);
    sampleRun(run, sAt(run, 0.95), 1, pt); assert.equal(pt.open, 0); // into the tunnel
    assert.ok(run.portal.some(Boolean));
  }
  // Out of reach: the fallback places it on the curve itself.
  const far = mapSnapCurve({ curve: curveAt(200, 20), net, index, ratio: 1, fallback: (x, y) => ({ base: 0, y, open: true }) });
  assert.equal(far.stats.snapped, 0);
  assert.ok(far.stats.fallback > 0);
});

// ── Sampling ──────────────────────────────────────────────────────────────────
test('sampling: never dips into the ground at a portal; morphs with the rail; left-hand lanes', () => {
  const run = { x: Float64Array.from([0, 10, 20, 30]), z: new Float64Array(4), base: Float64Array.from([10, 10, 10, 10]), y0: Float64Array.from([-90, -90, 15, 15]),
    morph: Uint8Array.from([1, 1, 1, 1]), open: Uint8Array.from([0, 0, 1, 1]), cum: Float64Array.from([0, 10, 20, 30]) };
  const pt = {};
  sampleRun(run, 14, 1, pt); assert.equal(pt.y, 15); assert.equal(pt.open, 0);   // the tunnel side of the mouth: hidden, and at the open height
  sampleRun(run, 17, 1, pt); assert.equal(pt.y, 15); assert.equal(pt.open, 1);
  sampleRun(run, 25, 0.5, pt); assert.equal(pt.y, 12.5);                         // lift scaled by the structure ratio (true proportions)
  assert.equal(drawnY(-90, 10, 1, 0.5), -90);                                    // below the terrain the morph leaves it
  sampleRun(run, 45, 1, pt); assert.equal(pt.inside, false);
  // Eastbound (+x): left is north (z negative); westbound: south.
  sampleRun(run, 25, 1, pt);
  assert.deepEqual(laneOffset(pt, 1), { ox: 0, oz: -LANE_OFFSET_M });
  assert.deepEqual(laneOffset(pt, -1), { ox: -0, oz: LANE_OFFSET_M });
});

test('on a cross-slope, a car in its lane rides the stripe as the rail morph draws it, at any Master', () => {
  // Terrain rising 0.5 per metre southwards (+z); track due east along z = 0.
  const getY = ({ z }) => 0.5 * z;
  const pts = Array.from({ length: 101 }, (_, i) => ({ x: i * 12, z: 0, terrainY: 0, y: 5, cls: 'surface' }));
  const net = computeCrossSlopes(buildNetwork([{ pts, morph: true }]), getY);
  assert.ok(Math.abs(net.slope[50] - 0.5) < 1e-9); // rises to offsetRails' left, (-dz, dx) = +z for an eastbound piece
  const { curve, stationUs } = (() => {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -30, 0), new THREE.Vector3(600, -30, 0), new THREE.Vector3(1200, -30, 0)]);
    return { curve: c, stationUs: [0, 0.5, 1] };
  })();
  const stations = [{ key: 'P', x: 0, z: 0 }, { key: 'Q', x: 600, z: 0 }, { key: 'R', x: 1200, z: 0 }];
  const { runs } = mapTubeCurve({ curve, stationUs, stations, net, cache: fresh(net), extendM: 0 });
  const run = runs[0], pt = {};
  for (const ratio of [1, 1 / 1.1, 1 / 3, 1 / 10]) for (const sign of [1, -1]) {
    // The stripe vertex at the lane's offset is morphed about the terrain under it.
    const laneZ = laneOffset({ dx: 1, dz: 0 }, sign).oz; // eastbound left-hand lane: north (z < 0)
    const stripeAtLane = getY({ z: laneZ }) + (5 - getY({ z: laneZ })) * ratio;
    sampleRun(run, 300, ratio, pt, -sign * LANE_OFFSET_M);
    assert.ok(Math.abs(pt.y - stripeAtLane) < 1e-9, `ratio ${ratio} sign ${sign}: ${pt.y} vs ${stripeAtLane}`);
  }
  // A run built against its piece's direction flips the slope with it.
  const back = mapTubeCurve({ curve: new THREE.CatmullRomCurve3([...curve.points].reverse()), stationUs, stations: [...stations].reverse(), net, cache: fresh(net), extendM: 0 }).runs[0];
  assert.ok(Math.abs(back.slope[10] + 0.5) < 1e-9);
});

test('DLR snapping past the end of the drawn track: the train never halts on the end point and leaps', () => {
  // Drawn track stops at x = 600; the curve (the profile) runs on to x = 1200 (a data gap, like Pudding Mill Lane).
  const net = buildNetwork([{ pts: Array.from({ length: 51 }, (_, i) => ({ x: i * 12, z: 0, terrainY: 0, y: 5, cls: 'surface' })), morph: false }]);
  const index = buildSegmentIndex(net);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 5, 3), new THREE.Vector3(600, 5, 3), new THREE.Vector3(1200, 5, 3)]);
  const m = mapSnapCurve({ curve, net, index, ratio: 1, fallback: (x, y) => ({ base: 0, y, open: true }) });
  const run = m.runs[0];
  for (let k = 1; k < run.as.length; k++) assert.ok(run.as[k] - run.as[k - 1] > 5, `progress at anchor ${k}: ${run.as[k] - run.as[k - 1]}`);
  assert.ok(m.stats.fallback >= 55 && m.stats.fallback <= 62, `fallback ${m.stats.fallback}`); // the undrawn half follows the curve itself
});

test('DLR snapping refuses a track far above or below the curve: a viaduct never lands on a tunnel beside it', () => {
  // A tunnel piece 6 m beside a viaduct curve, 100 units (20 m) lower; no viaduct drawn here.
  const net = buildNetwork([{ pts: Array.from({ length: 51 }, (_, i) => ({ x: i * 12, z: 6, terrainY: 0, y: -100, cls: 'tunnel' })), morph: false }]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 35, 0), new THREE.Vector3(300, 35, 0), new THREE.Vector3(600, 35, 0)]);
  const m = mapSnapCurve({ curve, net, index: buildSegmentIndex(net), ratio: 1, fallback: (x, y) => ({ base: 0, y, open: true }) });
  assert.equal(m.stats.snapped, 0);
  assert.ok(m.runs[0].open.every(v => v === 1));
  // The same tunnel at the curve's own depth is taken.
  const deep = mapSnapCurve({ curve: new THREE.CatmullRomCurve3(curve.points.map(p => p.clone().setY(-100))), net, index: buildSegmentIndex(net), ratio: 1, fallback: () => { throw new Error('no fallback'); } });
  assert.equal(deep.stats.fallback, 0);
});

test('each profile is a closed body whose every face points outward, at its true size', () => {
  for (const [id, profile] of Object.entries(PROFILES)) {
    const { body, roof, windows } = profileGeometries(profile);
    const p = body.attributes.position;
    let inward = 0, faces = 0;
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (n.lengthSq() < 1e-12) continue;
      faces++;
      // Outward: away from the body's axis (x = 0, y = mid-height) for the walls, along z for the caps.
      const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const out = Math.abs(centre.z) > 0.499 ? new THREE.Vector3(0, 0, Math.sign(centre.z)) : new THREE.Vector3(centre.x, centre.y - profile.heightM / 2, 0);
      if (n.dot(out) <= 0) inward++;
    }
    assert.ok(faces > 20, id);
    assert.equal(inward, 0, `${id}: ${inward} of ${faces} faces point inward`);
    body.computeBoundingBox();
    const bb = body.boundingBox;
    assert.ok(Math.abs(bb.max.x - bb.min.x - profile.widthM) < 1e-6 && Math.abs(bb.max.y - profile.heightM) < 1e-6 && Math.abs(bb.max.z - bb.min.z - 1) < 1e-9, id);
    roof.computeBoundingBox(); windows.computeBoundingBox();
    assert.ok(roof.boundingBox.max.y <= profile.heightM + 0.011, `${id} roof within the height`);
    assert.ok(windows.boundingBox.min.y >= profile.windows[0] - 1e-5 && windows.boundingBox.max.y <= profile.windows[1] + 1e-5); // float32 positions
  }
});

test('a second line on a Tube owner\'s corridor runs in its own lanes, eased in and out; never a sideways jump', () => {
  const seg = (x0, x1, laneExtra) => ({ pts: Array.from({ length: Math.round((x1 - x0) / 10) + 1 }, (_, i) => ({ x: x0 + i * 10, z: 0, terrainY: 0, y: 5, cls: 'surface' })), morph: true, laneExtra });
  const net = buildNetwork([seg(0, 1000, 0), seg(1010, 2000, LANE_SPACING_M), seg(2010, 3000, 0)]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 0), new THREE.Vector3(1500, -20, 0), new THREE.Vector3(3000, -20, 0)]);
  const stations = [{ key: 'P', x: 0, z: 0 }, { key: 'Q', x: 1500, z: 0 }, { key: 'R', x: 3000, z: 0 }];
  const { runs } = mapTubeCurve({ curve, stationUs: [0, 0.5, 1], stations, net, cache: fresh(net), extendM: 0 });
  assert.equal(runs.length, 1);
  const run = runs[0], pt = {};
  const at = x => { let k = 0; while (run.x[k] < x) k++; return run.extra[k]; };
  assert.equal(at(1500), LANE_SPACING_M);           // on the shared corridor: one band further out
  assert.equal(at(300), 0); assert.equal(at(2700), 0); // on its own corridor: the usual lanes
  assert.ok(at(990) > 0 && at(990) < LANE_SPACING_M);  // easing in before the band
  for (let k = 1; k < run.extra.length; k++) assert.ok(Math.abs(run.extra[k] - run.extra[k - 1]) <= LANE_EASE * (run.cum[k] - run.cum[k - 1]) + 1e-9, `step at ${run.x[k]}`);
  sampleRun(run, sAt(run, 0.5), 1, pt);
  const { oz } = laneOffset(pt, 1);
  assert.ok(Math.abs(Math.abs(oz) - (LANE_OFFSET_M + LANE_SPACING_M)) < 1e-9);
});

test('a junction hop from ground track onto a viaduct piece is ramped at RUN_MAX_LIFT_GRADE, never stood on end', () => {
  // Ground piece (lift 1 m: y 5) then a viaduct piece starting 8 m up (y 45), joined within JOIN_M.
  const seg = (x0, x1, y) => ({ pts: Array.from({ length: Math.round((x1 - x0) / 12) + 1 }, (_, i) => ({ x: x0 + i * 12, z: 0, terrainY: 0, y, cls: y > 5 ? 'viaduct' : 'surface' })), morph: true });
  const net = buildNetwork([seg(0, 1200, 5), seg(1204, 2400, 45)]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 0), new THREE.Vector3(1200, -20, 0), new THREE.Vector3(2400, -20, 0)]);
  const stations = [{ key: 'P', x: 0, z: 0 }, { key: 'Q', x: 1200, z: 0 }, { key: 'R', x: 2400, z: 0 }];
  const run = mapTubeCurve({ curve, stationUs: [0, 0.5, 1], stations, net, cache: fresh(net), extendM: 0 }).runs[0];
  let steepest = 0;
  for (let k = 1; k < run.x.length; k++) steepest = Math.max(steepest, Math.abs(run.y0[k] - run.y0[k - 1]) / 5 / (run.cum[k] - run.cum[k - 1]));
  assert.ok(steepest <= RUN_MAX_LIFT_GRADE + 1e-9, `steepest ${steepest}`);
  // The viaduct keeps its height; the ground side climbs to it (raised, never lowered).
  const at = x => { let k = 0; while (run.x[k] < x) k++; return run.y0[k]; };
  assert.equal(at(2000), 45); assert.equal(at(400), 5);
  assert.ok(at(1190) > 5 && at(1190) < 45);
});

test('the DLR ramp never lifts a deck graded as the profile grades it, at any Master', () => {
  // A deck over a dip: the profile holds it level at 8% canonical grade (0.4 units a metre) while the ground falls away.
  const pts = Array.from({ length: 61 }, (_, i) => { const x = i * 10, ground = x > 200 && x < 400 ? -40 : 0; return { x, z: 0, terrainY: ground, y: 30 - Math.min(Math.abs(x - 300), 100) * 0.0, cls: 'viaduct' }; });
  const net = buildNetwork([{ pts, morph: false }]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 30, 0), new THREE.Vector3(300, 30, 0), new THREE.Vector3(600, 30, 0)]);
  for (const ratio of [1 / 1.1, 1 / 10]) {
    const run = mapSnapCurve({ curve, net, index: buildSegmentIndex(net), ratio, fallback: () => { throw new Error('no fallback'); } }).runs[0];
    for (let k = 0; k < run.y0.length; k++) assert.ok(Math.abs(run.y0[k] - 30) < 1e-9, `ratio ${ratio}: deck moved to ${run.y0[k]} at ${run.x[k]}`);
  }
});
