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
  fitEnds, END_CLEAR_M, distanceToDrawn, FAIR_MAX_DEV_M,
  turnAt, kinkWindows, fairPolyline, remapAnchors, boundAnchorSpeed, KINK_TURN_DEG, KINK_SCALE_M, FAIR_TURN_DEG, FAIR_STEP_M, SPUR_CLOSE_M, SPEED_RATIO_MAX, SPEED_RATIO_MIN, VFAIR_GRADE_STEP,
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
  // A terminus on open track is extended along the drawn track; a station in tunnel is not.
  assert.equal(run.extendedEnd, true); assert.equal(run.extendedStart, false);
  // Along the drawn track while it carries on (to x = 4056 here, 48 to 60 m past C's node) and
  // never past its end. (Fix round 2: round 1 carried on straight for the rest of
  // RUN_END_EXTENSION_M, and trains dwelling at termini stood up to 54 m off the drawn track.)
  const ext = run.length - run.as.at(-1);
  assert.ok(ext > 40 && ext <= 60.01 && ext < RUN_END_EXTENSION_M, `extension ${ext}`);
  for (let i = 0; i < run.x.length; i++) assert.ok(run.x[i] <= 4056 + 1e-6 && Math.abs(run.z[i] - bow(run.x[i])) < 1e-6, `run vertex ${run.x[i]}, ${run.z[i]} off the drawn track`);
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

// ── Fix round 1 (01Oct26h): trains held together, at a believable speed ──────
// The fix-round verifier found cars standing at right angles to their
// neighbours or metres apart at 60 fixed places (route hops across junction
// gaps, a station node on a spur, DLR snaps alternating between parallel
// decks), and trains at up to 105 m/s where a portal anchor packed 770 m of
// track into 88 m of chord. These pin each cause on a synthetic network.
const sampleTurns = (run, step = FAIR_STEP_M) => {
  // The run's largest turn between consecutive `step` chords, and at the 8 m kink scale.
  const P = { x: run.x, z: run.z, cum: run.cum }, L = run.cum[run.cum.length - 1];
  let perStep = 0, kink = 0;
  for (let s = step; s + step <= L; s += step) perStep = Math.max(perStep, turnAt(P, s, step));
  for (let s = KINK_SCALE_M; s + KINK_SCALE_M <= L; s += 2) kink = Math.max(kink, turnAt(P, s, KINK_SCALE_M));
  return { perStep, kink };
};
const ratios = (run, L) => { const out = []; for (let k = 1; k < run.au.length; k++) out.push((run.as[k] - run.as[k - 1]) / ((run.au[k] - run.au[k - 1]) * L)); return out; };
const straightPiece = (x0, x1, z, step = 12, cls = () => 'surface') => ({ pts: Array.from({ length: Math.round((x1 - x0) / step) + 1 }, (_, i) => ({ x: x0 + i * step, z, terrainY: 0, y: 5, cls: cls(x0 + i * step) })), morph: true });

test('a sideways junction hop is faired into a crossover: never a kink, and the drawn track is kept away from it', () => {
  // Two parallel pieces 24 m apart; the route hops from one to the other at x = 1500 (within JOIN_M).
  const net = buildNetwork([straightPiece(0, 1500, 0), straightPiece(1500, 3000, 24)]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 0), new THREE.Vector3(1500, -20, 12), new THREE.Vector3(3000, -20, 24)]);
  const stations = [{ key: 'P', x: 0, z: 0 }, { key: 'Q', x: 1400, z: 0 }, { key: 'R', x: 3000, z: 24 }];
  const cum = [0, 1400.05, 3000.1];
  const { runs, stats } = mapTubeCurve({ curve, stationUs: [0, 0.4667, 1], stations, net, cache: fresh(net), extendM: 0 });
  assert.equal(runs.length, 1); assert.ok(stats.kinks >= 1, `kinks ${stats.kinks}`);
  const run = runs[0], t = sampleTurns(run);
  assert.ok(t.kink <= KINK_TURN_DEG, `kink scale turn ${t.kink}`);
  assert.ok(t.perStep <= FAIR_TURN_DEG + 0.5, `turn per ${FAIR_STEP_M} m ${t.perStep}`);
  // On the drawn track away from the hop; across the gap within the two pieces' band.
  for (let i = 0; i < run.x.length; i++) {
    if (run.x[i] < 1300) assert.ok(Math.abs(run.z[i]) < 1e-6, `at x ${run.x[i]}: z ${run.z[i]}`);
    if (run.x[i] > 1700) assert.ok(Math.abs(run.z[i] - 24) < 1e-6, `at x ${run.x[i]}: z ${run.z[i]}`);
    assert.ok(run.z[i] > -1e-6 && run.z[i] < 24 + 1e-6);
  }
  for (let k = 1; k < run.as.length; k++) assert.ok(run.as[k] >= run.as[k - 1] && run.au[k] > run.au[k - 1]);
  void cum;
});

test('a station node on a spur: the out-and-back is cut, the train never reverses', () => {
  // Main line along z = 0; a spur north from x = 2000. The middle station's nearest node is up the spur.
  const spur = { pts: Array.from({ length: 25 }, (_, i) => ({ x: 2000, z: -12 - i * 12, terrainY: 0, y: 5, cls: 'surface' })), morph: true };
  const net = buildNetwork([straightPiece(0, 4008, 0), spur]);
  const stations = [{ key: 'A', x: 0, z: 0 }, { key: 'B', x: 2000, z: -200 }, { key: 'C', x: 4008, z: 0 }];
  const pts = [new THREE.Vector3(0, -20, 0), new THREE.Vector3(2000, -20, -200), new THREE.Vector3(4008, -20, 0)];
  const cumP = [0, pts[1].distanceTo(pts[0])]; cumP.push(cumP[1] + pts[2].distanceTo(pts[1]));
  const { runs, stats } = mapTubeCurve({ curve: new THREE.CatmullRomCurve3(pts), stationUs: cumP.map(c => c / cumP[2]), stations, net, cache: fresh(net), extendM: 0 });
  assert.equal(stats.mapped, 2); assert.equal(runs.length, 1); assert.ok(stats.spurs >= 1, `spurs ${stats.spurs}`);
  const run = runs[0];
  // Never up the spur: the run stays on (or by) the main line.
  for (let i = 0; i < run.z.length; i++) assert.ok(run.z[i] > -SPUR_CLOSE_M, `up the spur at ${run.x[i]}, ${run.z[i]}`);
  // Progress along x never goes back (the train does not reverse).
  for (let i = 1; i < run.x.length; i++) assert.ok(run.x[i] >= run.x[i - 1] - 1e-6, `reverses at ${run.x[i]}`);
  // B's stop lands by the spur's foot.
  const kB = [...run.station].map((v, k) => v ? k : -1).filter(k => k >= 0)[1], pt = {};
  sampleRun(run, run.as[kB], 1, pt);
  assert.ok(Math.hypot(pt.x - 2000, pt.z) < SPUR_CLOSE_M + 12, `B at ${pt.x}, ${pt.z}`);
  assert.ok(sampleTurns(run).kink <= KINK_TURN_DEG);
});

test('DLR: between two parallel decks the map match stays on one; it never alternates', () => {
  const deck = z => ({ pts: Array.from({ length: 101 }, (_, i) => ({ x: i * 12, z, terrainY: 0, y: 20, cls: 'viaduct' })), morph: false });
  const net = buildNetwork([deck(0), deck(6)]);
  // The curve wavers about the middle (z 2.6 to 3.4 every 10 m): nearest-per-sample snapping alternated.
  const pts = []; for (let x = 0; x <= 1200; x += 10) pts.push(new THREE.Vector3(x, 20, 3 + ((x / 10) % 2 ? 0.4 : -0.4)));
  const m = mapSnapCurve({ curve: new THREE.CatmullRomCurve3(pts), net, index: buildSegmentIndex(net), ratio: 1, fallback: () => { throw new Error('no fallback'); } });
  assert.equal(m.stats.switches, 0);
  const run = m.runs[0], z0 = run.z[0];
  assert.ok(z0 === 0 || z0 === 6);
  for (let i = 0; i < run.z.length; i++) assert.ok(Math.abs(run.z[i] - z0) < 1e-6, `left its deck at ${run.x[i]}: ${run.z[i]}`);
  // The curve leaves the near deck for the far one: one change of piece, faired, never a step.
  const pts2 = []; for (let x = 0; x <= 1200; x += 10) pts2.push(new THREE.Vector3(x, 20, x < 600 ? 0.5 : 5.5));
  const m2 = mapSnapCurve({ curve: new THREE.CatmullRomCurve3(pts2), net, index: buildSegmentIndex(net), ratio: 1, fallback: () => { throw new Error('no fallback'); } });
  assert.equal(m2.stats.switches, 1);
  assert.ok(sampleTurns(m2.runs[0]).kink <= KINK_TURN_DEG);
  for (const r of ratios(m2.runs[0], m2.runs[0].length)) assert.ok(r <= SPEED_RATIO_MAX + 1e-9 && r >= SPEED_RATIO_MIN - 1e-9, `ratio ${r}`);
});

test('speed bound: a portal anchor that would pack the track into a short stretch of chord is moved, and flagged', () => {
  // From A the track loops 1.5 km north and back before its tunnel mouth at x ~ 420, 420 m along the chord.
  const pts = [], add = (x, z) => pts.push({ x, z });
  for (let z = 0; z >= -500; z -= 1) add(0, z);
  for (let a = Math.PI; a <= 2 * Math.PI; a += 0.002) add(150 + 150 * Math.cos(a), -500 + 150 * Math.sin(a));
  for (let z = -500; z <= -100; z += 1) add(300, z);
  for (let a = Math.PI; a >= Math.PI / 2; a -= 0.005) add(400 + 100 * Math.cos(a), -100 + 100 * Math.sin(a));
  for (let x = 400; x <= 2000; x += 1) add(x, 0);
  const track = []; let acc = 12;
  for (let i = 0; i < pts.length; i++) { if (i) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (acc >= 12 || i === pts.length - 1) { track.push({ ...pts[i], terrainY: 0, y: pts[i].x > 420 && pts[i].z === 0 ? -100 : 5, cls: pts[i].x > 420 && pts[i].z === 0 ? 'tunnel' : 'surface' }); acc = 0; } }
  const net = buildNetwork([{ pts: track, morph: true }]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 0), new THREE.Vector3(1000, -20, 0), new THREE.Vector3(2000, -20, 0)]);
  const stations = [{ key: 'A', x: 0, z: 0 }, { key: 'B', x: 2000, z: 0 }];
  const { runs, stats } = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net), extendM: 0 });
  assert.equal(stats.mapped, 1); assert.equal(stats.portals, 1); assert.equal(stats.portalsMoved, 1); assert.equal(stats.portalsDropped, 0);
  const run = runs[0], L = curve.getLength();
  assert.equal([...run.portal].filter(v => v === 2).length, 1);
  // At the chord's nearest point the first stretch would run at about 3.7 times the timetable's speed.
  for (const r of ratios(run, L)) assert.ok(r <= SPEED_RATIO_MAX + 1e-6 && r >= SPEED_RATIO_MIN - 1e-6, `stretch ratio ${r}`);
});

test('a terminus on a stub: nothing is added past the drawn track, never along a sideways first step', () => {
  // The terminus T sits on a 4 m stub; the route steps 10 m north onto the main line, then runs east.
  // Fix round 1 found the extension heading south along that first step (Woodford), and pinned it heading
  // west; fix round 2 found the westward part drawn over bare ground (no track is drawn west of T), so an
  // end carries on only along drawn track: here, none.
  const stub = { pts: [{ x: 0, z: 10, terrainY: 0, y: 5, cls: 'surface' }, { x: 0, z: 6, terrainY: 0, y: 5, cls: 'surface' }], morph: true };
  const net = buildNetwork([stub, straightPiece(0, 3000, -4)]);
  const stations = [{ key: 'T', x: 0, z: 10 }, { key: 'E', x: 3000, z: -4 }];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 10), new THREE.Vector3(1500, -20, 3), new THREE.Vector3(3000, -20, -4)]);
  const { runs } = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net) });
  const run = runs[0];
  assert.equal(run.extendedStart, false);
  // Every vertex of the run is on the drawn track (the stub, or the main line at z = -4, or the faired step between).
  for (let i = 0; i < run.x.length; i++) assert.ok(run.x[i] >= -1e-6 && run.z[i] <= 10 + 1e-6 && run.z[i] >= -4 - 1e-6, `vertex ${run.x[i]}, ${run.z[i]}`);
  assert.ok(sampleTurns(run).kink <= KINK_TURN_DEG);
});

test('a train standing where the drawn track ends is fitted onto it, at a terminus and where the next interval is refused', () => {
  // A straight line, drawn from x = 0 to x = 3000; stations A (x = 0) and B (x = 1500); C at x = 4500 has no
  // track within reach (the Chigwell interval from Grange Hill). With an S8's half length, a train dwelling at
  // A or at B (the end of the run, the B -> C interval refused) must stand wholly on the drawn track.
  const half = STOCK.S8.trainM / 2;
  const net = buildNetwork([straightPiece(0, 1560, 0)]); // the drawn track ends 60 m past B: less than half a train
  const stations = [{ key: 'A', x: 0, z: 0 }, { key: 'B', x: 1500, z: 0 }, { key: 'C', x: 4500, z: 0 }];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -20, 6), new THREE.Vector3(1500, -20, 6), new THREE.Vector3(4500, -20, 6)]);
  const cumP = [0, 1500, 4500].map(x => x / 4500), L = curve.getLength();
  const plain = mapTubeCurve({ curve, stationUs: cumP, stations, net, cache: fresh(net) });
  const { runs, stats } = mapTubeCurve({ curve, stationUs: cumP, stations, net, cache: fresh(net), halfTrainM: half });
  assert.equal(stats.offTrack, 1); assert.equal(stats.mapped, 1); assert.equal(runs.length, 1);
  assert.equal(stats.fitStart, 1); assert.equal(stats.fitEnd, 1);
  const run = runs[0], ref = plain.runs[0];
  // The run is the drawn track and no more: 0 to 1560 (the end extension walked the 60 m left, then stopped).
  assert.ok(Math.abs(run.length - 1560) < 1e-6, `run length ${run.length}`);
  assert.equal(run.extendedEnd, true);
  // Unfitted, the train at B stands 60 m from the drawn end, so its front 7 m are past it; at A its rear half is.
  assert.ok(ref.as.at(-1) + half > ref.length, 'the case needs fitting');
  // Fitted: the end anchors leave half a train plus END_CLEAR_M of drawn track, at each end.
  assert.ok(Math.abs(run.as[0] - (half + END_CLEAR_M)) < 1e-6, `start anchor ${run.as[0]}`);
  assert.ok(Math.abs(run.as.at(-1) - (run.length - half - END_CLEAR_M)) < 1e-6, `end anchor ${run.as.at(-1)}`);
  // Monotone, within the run, and the compressed stretch still keeps the speed bound.
  for (let k = 1; k < run.as.length; k++) assert.ok(run.as[k] >= run.as[k - 1] && run.au[k] > run.au[k - 1]);
  for (const r of ratios(run, L)) assert.ok(r >= SPEED_RATIO_MIN && r <= SPEED_RATIO_MAX, `stretch ratio ${r}`);
  // Every car centre and both ends of a dwelling train are on the run, open and drawn, at both ends.
  const pt = {};
  for (const u of [run.u0, run.u1]) {
    const s = sAt(run, u);
    for (const off of [-half, -half / 2, 0, half / 2, half]) {
      sampleRun(run, s + off, 1, pt);
      assert.ok(pt.inside && pt.open && pt.drawn === 1, `at u ${u}, offset ${off}: inside ${pt.inside} open ${pt.open} drawn ${pt.drawn}`);
    }
  }
});

test('fitting leaves alone a station in a tunnel, an end off the drawn track, and a stretch too short for the train', () => {
  // Re-pinned for sprint 01Oct26h (Lane T): fitEnds now takes the open, drawn stretch around the standing train, not
  // the one at the run's end vertex (so an open station whose run ends in a covered stretch is fitted: Barking, below
  // in this file), and counts a train past the stretch's inner end only as innerTunnel. Every pin here is re-derived
  // under that rule and holds as it was: a station in a tunnel, a too-short stretch and an end off the drawn deck are
  // still left alone; the portal cases keep their counts. innerTunnel is pinned at 0 for each.
  const half = STOCK.S8.trainM / 2;
  // A station in tunnel at x = 0 (the track is tunnel west of 1000, so no open node within STATION_OPEN_PREFER_M of
  // it), the run's other end on open track with 60 m beyond.
  const net = buildNetwork(track());
  const { curve, stationUs } = chord();
  const fit1 = mapTubeCurve({ curve, stationUs, stations: STATIONS, net, cache: fresh(net), halfTrainM: half }), run = fit1.runs[0];
  const ref = mapTubeCurve({ curve, stationUs, stations: STATIONS, net, cache: fresh(net) }).runs[0];
  assert.equal(run.as[0], ref.as[0]); // the station in the tunnel: unchanged
  assert.equal(fit1.stats.fitStart, 0); assert.equal(fit1.stats.fitEnd, 1); assert.equal(fit1.stats.innerTunnel, 0);
  // A portal 200 m short of the terminus (Morden, Cockfosters): the fit compresses only the stretch from the
  // portal anchor on, which stays where the chord passes nearest the mouth; the train still fits.
  const net2 = buildNetwork(track({ tunnelBefore: 3800 }));
  const fit2 = mapTubeCurve({ curve, stationUs, stations: STATIONS, net: net2, cache: fresh(net2), halfTrainM: half });
  const ref2 = mapTubeCurve({ curve, stationUs, stations: STATIONS, net: net2, cache: fresh(net2) }).runs[0];
  const run2 = fit2.runs[0];
  assert.ok(fit2.stats.portals >= 1 && [...ref2.portal].some(v => v === 1));
  assert.equal(fit2.stats.fitShort, 0); assert.equal(fit2.stats.fitEnd, 1); assert.equal(fit2.stats.innerTunnel, 0);
  for (let k = 0; k < ref2.as.length; k++) if (ref2.portal[k]) assert.equal(run2.as[k], ref2.as[k]);
  assert.ok(Math.abs(run2.as.at(-1) - (run2.length - half - END_CLEAR_M)) < 1e-6);
  // A portal moved by the speed bound (flag 2) is justified by a stretch beside it running outside the bound at the
  // chord's nearest approach (nearU): a window may end on it only while a stretch beside it, recomputed, still does
  // (Cockfosters; before sprint 01Oct26h only the stretch the window leaves alone counted: the near-side case is
  // the Kensington (Olympia) test below). Without that (no nearU here), it is refused; with the far stretch breaking
  // the bound, it is taken.
  const mk = nearU => ({ cum: Float64Array.from([0, 400, 600]), open: Uint8Array.from([0, 1, 1]), drawn: Uint8Array.from([1, 1, 1]), au: Float64Array.from([0, 0.67, 1]), as: Float64Array.from([0, 400, 590]), station: Uint8Array.from([1, 0, 1]), portal: Uint8Array.from([0, 2, 0]), nearU: Float64Array.from([NaN, nearU, NaN]) });
  const r3 = mk(NaN), st3 = {};
  fitEnds(r3, half, 600, st3);
  assert.equal(st3.fitSkipped, 1); assert.deepEqual([...r3.as], [0, 400, 590]); assert.equal(st3.innerTunnel ?? 0, 0);
  const r4 = mk(0.4), st4 = {}; // 400 m of track into 240 m of chord before the portal: 1.67, beyond the bound
  fitEnds(r4, half, 600, st4);
  assert.equal(st4.fitEnd, 1); assert.equal(r4.as[1], 400); assert.ok(Math.abs(r4.as[2] - (600 - half - END_CLEAR_M)) < 1e-9);
  // Direct: a 100 m drawn stretch can hold no 133.7 m train; it is left as it is (its cars past the ends are not drawn).
  const r = { cum: Float64Array.from([0, 50, 100]), open: Uint8Array.from([1, 1, 1]), drawn: Uint8Array.from([1, 1, 1]), au: Float64Array.from([0, 0.5, 1]), as: Float64Array.from([0, 50, 100]), station: Uint8Array.from([1, 0, 1]) };
  const st = {};
  fitEnds(r, half, 100, st);
  assert.equal(st.fitShort, 2); assert.equal(st.innerTunnel ?? 0, 0);
  assert.deepEqual([...r.as], [0, 50, 100]);
  // An end off the drawn track (a DLR curve ending past the deck) is not fitted either.
  const r2 = { cum: Float64Array.from([0, 100, 400]), open: Uint8Array.from([1, 1, 1]), drawn: Uint8Array.from([1, 1, 0]), au: Float64Array.from([0, 0.25, 1]), as: Float64Array.from([0, 100, 400]), station: Uint8Array.from([0, 0, 0]) };
  const st2 = {};
  fitEnds(r2, 42, 400, st2, { perStretch: true });
  assert.equal(st2.fitEnd ?? 0, 0); assert.equal(r2.as[2], 400);
  assert.equal(st2.fitStart, 1); assert.ok(Math.abs(r2.as[0] - 44) < 1e-9); assert.equal(st2.innerTunnel ?? 0, 0);
});

test('DLR: where no track is drawn within reach the train keeps its progress, but no car is drawn there', () => {
  // Drawn deck from x = 0 to 600 and again from 900 to 1500: the 300 m between is undrawn (Abbey Road, Stratford).
  const deck = (x0, x1) => ({ pts: Array.from({ length: Math.round((x1 - x0) / 12) + 1 }, (_, i) => ({ x: x0 + i * 12, z: 0, terrainY: 0, y: 20, cls: 'viaduct' })), morph: false });
  const net = buildNetwork([deck(0, 600), deck(900, 1500)]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 20, 0.5), new THREE.Vector3(750, 20, 0.5), new THREE.Vector3(1500, 20, 0.5)]);
  const m = mapSnapCurve({ curve, net, index: buildSegmentIndex(net), ratio: 1, fallback: (x, y) => ({ base: 0, y, open: true }) });
  const run = m.runs[0], pt = {};
  assert.ok(m.stats.fallback > 20, `fallback ${m.stats.fallback}`);
  for (let s = 0; s <= run.length; s += 5) {
    sampleRun(run, s, 1, pt);
    // The 35 m snap reach and the 10 m piece-end rule: undrawn from about x = 610 to 890.
    if (pt.x > 650 && pt.x < 850) assert.equal(pt.drawn, 0, `drawn at x ${pt.x}`);
    if (pt.x < 590 || pt.x > 910) assert.equal(pt.drawn, 1, `undrawn at x ${pt.x}`);
    if (pt.drawn) assert.ok(Math.abs(pt.z) < 0.6 && (pt.x <= 611 || pt.x >= 889), `a drawn sample off the deck at ${pt.x}, ${pt.z}`);
  }
  // Progress is still monotone through the gap (the train runs on, unseen, and reappears in step).
  for (let k = 1; k < run.as.length; k++) assert.ok(run.as[k] > run.as[k - 1]);
});

test('DLR: a train standing at either end of its curve is drawn whole, on the deck carrying on past the stop or fitted where it ends', () => {
  // Fix round 2: every DLR train dwelling at the end of its curve was drawn as half a train (the half past the curve's end).
  const half = STOCK.B07.trainM / 2;
  const deck = (x0, x1) => ({ pts: Array.from({ length: Math.round((x1 - x0) / 10) + 1 }, (_, i) => ({ x: x0 + i * 10, z: 0, terrainY: 0, y: 20, cls: 'viaduct' })), morph: false });
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 20, 1), new THREE.Vector3(500, 20, 1), new THREE.Vector3(1000, 20, 1)]);
  const L = curve.getLength(), pt = {};
  const wholeAt = (run, u) => { const sc = sAt(run, u); return [-half, -half / 2, 0, half / 2, half].every(o => { sampleRun(run, sc + o, 1, pt); return pt.inside && pt.open && pt.drawn === 1; }); };
  for (const [x0, x1, extended] of [[-200, 1200, true], [0, 1000, false]]) {
    const net = buildNetwork([deck(x0, x1)]);
    const m = mapSnapCurve({ curve, net, index: buildSegmentIndex(net), ratio: 1, fallback: () => { throw new Error('no fallback'); }, halfTrainM: half });
    const run = m.runs[0];
    assert.equal(run.extendedStart, extended); assert.equal(run.extendedEnd, extended);
    if (extended) { assert.ok(run.as[0] >= RUN_END_EXTENSION_M - 1e-6, `start anchor ${run.as[0]}`); assert.equal(m.stats.fitStart, 0); }
    else { assert.equal(m.stats.fitStart, 1); assert.equal(m.stats.fitEnd, 1); assert.ok(m.stats.fitMaxM <= half + END_CLEAR_M + 1e-6); }
    assert.ok(wholeAt(run, 0) && wholeAt(run, 1), `whole at both ends (deck ${x0} to ${x1})`);
    // Never past the deck; the approach never slower than the speed bound.
    for (let i = 0; i < run.x.length; i++) assert.ok(run.x[i] >= x0 - 1e-6 && run.x[i] <= x1 + 1e-6);
    for (const q of ratios(run, L)) assert.ok(q >= SPEED_RATIO_MIN - 1e-9 && q <= SPEED_RATIO_MAX + 1e-9, `stretch ratio ${q}`);
  }
});

test('fairing keeps to the drawn track: a jump between parallel pieces on a bend is never faired by cutting the bend', () => {
  // Fix round 2, Canning Town: the DLR curves 100 degrees north of the station on a radius of about 90 m, drawn as
  // two parallel pieces 7 m apart; the run starts (a free end) on the inner piece and jumps to the outer 30 m in.
  // Widened until it turned gently enough, the jump's window reached the free start and its blend cut the whole
  // bend: 29.5 m from the drawn track here, 43 m in the app.
  const R = 90, A = 100 * Math.PI / 180, pt = (r, a) => ({ x: r * Math.sin(a), z: R - r * Math.cos(a) });
  const arcPts = r => { const out = []; for (let s = 0; s <= r * A; s += 12) out.push({ ...pt(r, s / r), terrainY: 0, y: 5, cls: 'surface' }); return out; };
  const net = buildNetwork([{ pts: arcPts(R), morph: false }, { pts: arcPts(R + 7), morph: false }]);
  const index = buildSegmentIndex(net), near = (x, z, cap) => distanceToDrawn(net, index, x, z, cap);
  const xs = [], zs = [];
  for (let s = 0; s <= 30; s += 4) { const p = pt(R, s / R); xs.push(p.x); zs.push(p.z); }
  for (let s = (R + 7) * 30 / R + 4; s <= (R + 7) * A; s += 4) { const p = pt(R + 7, s / (R + 7)); xs.push(p.x); zs.push(p.z); }
  const n = xs.length, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const fill = v => new Array(n).fill(v);
  const P = { x: xs, z: zs, cum, base: fill(0), y0: fill(5), morph: fill(0), open: fill(1), slope: fill(0), extra: fill(0), vj: fill(0), drawn: fill(1) };
  const stray = Q => Math.max(...Q.x.map((x, i) => near(x, Q.z[i], 500)));
  const kink = Q => { let k = 0; for (let s = KINK_SCALE_M; s + KINK_SCALE_M <= Q.cum.at(-1); s += 2) k = Math.max(k, turnAt(Q, s, KINK_SCALE_M)); return k; };
  const bare = fairPolyline(P), kept = fairPolyline(P, null, near);
  assert.ok(stray(bare.P) > 20, `the case: a blend free of the drawn track cuts the bend (${stray(bare.P)})`);
  assert.equal(kept.kinks, 1);
  assert.ok(stray(kept.P) <= 5, `strays ${stray(kept.P)} m from the drawn track`); // the jump itself strays 3.5 m
  assert.ok(FAIR_MAX_DEV_M <= 10);
  assert.ok(kink(kept.P) <= KINK_TURN_DEG, `kink ${kink(kept.P)}`);
});

test('fairing primitives: windows replace only what they cover; anchors re-placed evenly in u inside them', () => {
  // A straight run with one 20 m sideways step at x = 500.
  const xs = [], zs = []; for (let x = 0; x <= 1000; x += 10) { xs.push(x); zs.push(x < 500 ? 0 : 20); }
  const cumA = [0]; for (let i = 1; i < xs.length; i++) cumA.push(cumA[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const n = xs.length, P = { x: xs, z: zs, cum: cumA, base: new Array(n).fill(0), y0: new Array(n).fill(5), morph: new Array(n).fill(1), open: new Array(n).fill(1), slope: new Array(n).fill(0), extra: new Array(n).fill(0) };
  const w = kinkWindows(P);
  assert.equal(w.length, 1);
  assert.ok(w[0].w0 > 300 && w[0].w1 < 750, `window ${w[0].w0} to ${w[0].w1}`);
  const r = fairPolyline(P);
  // Anchors every vertex at u = x / 1000: re-placed, they are monotone and even through the window.
  const au = xs.map(x => x / 1000), as = cumA.slice();
  let out = as; for (const pass of r.passes) out = remapAnchors(au, out, pass);
  for (let k = 1; k < out.length; k++) assert.ok(out[k] >= out[k - 1]);
  const inWin = au.map((u, k) => [u, out[k]]).filter(([, s]) => s > w[0].w0 + 1 && s < w[0].w1 - 30);
  const steps = inWin.slice(1).map(([u, s], k) => (s - inWin[k][1]) / (u - inWin[k][0]));
  assert.ok(Math.max(...steps) - Math.min(...steps) < 1e-6 * Math.max(...steps), 'even in u through the window');
  // Speed bound on a lumpy table: every stretch within the bounds, the ends kept.
  const lumpy = [0, 10, 20, 60, 70, 80, 90, 100], uu = lumpy.map((_, k) => k / 7);
  const bounded = boundAnchorSpeed(uu, lumpy, 70, SPEED_RATIO_MIN, SPEED_RATIO_MAX);
  for (let k = 1; k < bounded.length; k++) { const q = (bounded[k] - bounded[k - 1]) / ((uu[k] - uu[k - 1]) * 70); assert.ok(q <= SPEED_RATIO_MAX + 1e-9 && q >= SPEED_RATIO_MIN - 1e-9, `ratio ${q}`); }
  assert.ok(Math.abs(bounded[0] - 0) < 15 && Math.abs(bounded[7] - 100) < 15);
});

test('vertical fairing: a change between decks at different heights is a vertical curve, never a car pitched against its neighbours', () => {
  // Two DLR decks in line, the second 2.6 m higher (13 canonical units at structure scale 1): the run steps up at x = 600.
  const deck = (x0, x1, y) => ({ pts: Array.from({ length: Math.round((x1 - x0) / 10) + 1 }, (_, i) => ({ x: x0 + i * 10, z: 0, terrainY: 0, y, cls: 'viaduct' })), morph: false });
  const net = buildNetwork([deck(0, 600, 20), deck(610, 1200, 33)]);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 20, 0), new THREE.Vector3(590, 20, 0), new THREE.Vector3(620, 33, 0), new THREE.Vector3(1200, 33, 0)]);
  const ve = 5, ratio = 1, unitsPerM = ve * ratio;
  const run = mapSnapCurve({ curve, net, index: buildSegmentIndex(net), ratio, ve, fallback: () => { throw new Error('no fallback'); } }).runs[0];
  assert.ok(run.verticalFaired >= 1, `vertical windows ${run.verticalFaired}`);
  // Neighbouring DLR sections (13.5 m) pitch at most 2.3 degrees apart (a 4% change of grade between consecutive
  // 13.5 m chords; the grade limit alone left 12% ramps meeting level decks: 6.8 degrees).
  const yAt = s => { let i = 0; while (i + 2 < run.cum.length && run.cum[i + 1] < s) i++; const t = Math.max(0, Math.min(1, (s - run.cum[i]) / ((run.cum[i + 1] - run.cum[i]) || 1))); return run.y0[i] + (run.y0[i + 1] - run.y0[i]) * t; };
  const sec = 13.5, gradeAt = s => (yAt(s + sec) - yAt(s)) / sec / unitsPerM;
  let worst = 0;
  for (let s = 0; s + 2 * sec <= run.length; s += 1) worst = Math.max(worst, Math.abs(gradeAt(s + sec) - gradeAt(s)));
  assert.ok(worst <= 0.04, `neighbouring sections' grades differ by ${worst}`);
  assert.ok(VFAIR_GRADE_STEP * sec / FAIR_STEP_M < 0.04);
  // Away from the step each deck keeps its own height.
  assert.ok(Math.abs(yAt(100) - 20) < 1e-6 && Math.abs(yAt(run.length - 100) - 33) < 1e-6);
});

// ── Sprint 30Sep26w integration: only what Lane R draws carries a car ─────────
test('a lone open sample between tunnel samples is not drawn track: no car, no portal (Lane R draws open runs of 2+ samples)', async () => {
  const { drawnOpenFlags } = await import('../src/surface-train-map.js');
  const { buildCorridor } = await import('../src/surface-rail.js');
  const P = cls => cls.map((c, i) => ({ x: i * 12, z: 0, y: 20, terrainY: 20, cls: c }));
  // surface-rail.js buildCorridor with skipTunnel (the Tube and DLR): a stripe for each open run of 2 or more samples.
  const cls = ['tunnel', 'surface', 'tunnel', 'tunnel', 'cutting', 'surface', 'tunnel', 'surface'];
  assert.deepEqual([...drawnOpenFlags(P(cls))], [0, 0, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual([...drawnOpenFlags(P(['surface']))], [0]);
  assert.deepEqual([...drawnOpenFlags(P(['surface', 'viaduct', 'tunnel']))], [1, 1, 0]);
  // Agreement with the renderer itself: the drawn stripe covers exactly the flagged samples.
  for (const c of [cls, ['surface', 'tunnel', 'surface', 'surface'], ['tunnel', 'embankment', 'cutting', 'tunnel', 'surface', 'tunnel']]) {
    const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
    buildCorridor(P(c), out, { skipTunnel: true });
    const covered = new Set();
    for (const g of out.stripe) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) covered.add(Math.round(p.getX(i) / 12)); }
    const flags = drawnOpenFlags(P(c));
    for (let i = 0; i < c.length; i++) assert.equal(covered.has(i), !!flags[i], `${c.join(',')} sample ${i}`);
  }
  // The mapping: an island at x = 504 inside the synthetic line's tunnel (west of x = 1000).
  const island = () => { const pieces = track(); for (const p of pieces) for (const s of p.pts) if (s.x === 504) { s.cls = 'surface'; s.y = s.terrainY + 5; } return pieces; };
  const { curve, stationUs } = chord();
  const at504 = run => { const k = [...run.x].findIndex(x => Math.abs(x - 504) < 1e-6); assert.ok(k >= 0, 'the route passes the island'); const pt = {}; sampleRun(run, run.cum[k], 1, pt); return { open: pt.open, portals: [...run.portal].filter(Boolean).length }; };
  const asBefore = buildNetwork(island());
  const before = at504(mapTubeCurve({ curve, stationUs, stations: STATIONS, net: asBefore, cache: fresh(asBefore) }).runs[0]);
  assert.equal(before.open, 1); assert.equal(before.portals, 3); // the fixture bites: round 2 drew a car there
  const drawn = buildNetwork(island().map(p => ({ ...p, drawnOpen: drawnOpenFlags(p.pts) })));
  const after = at504(mapTubeCurve({ curve, stationUs, stations: STATIONS, net: drawn, cache: fresh(drawn) }).runs[0]);
  assert.equal(after.open, 0); assert.equal(after.portals, 1);
});

// ── Sprint 01Oct26h (Lane T): station nodes on open track, trains standing at line ends whole ─────────
test('a station prefers an open node within STATION_OPEN_PREFER_M of its nearest: West Hampstead\'s Jubilee is drawn whole, never as a stub', async () => {
  const { stationNode, STATION_OPEN_PREFER_M, nearestNode: nearest } = await import('../src/surface-train-map.js');
  assert.equal(STATION_OPEN_PREFER_M, 30);
  // West Hampstead before Lane R removed the stub (sprint 01Oct26h): the open track 18 m south of the stop, the other
  // running track's undrawn 227 m tunnel stub 11 m north of it. Stations P and Q 1.4 km either side, on the open track.
  const open = straightPiece(-1500, 1500, 18);
  const stub = straightPiece(-110, 118, -11, 12, () => 'tunnel');
  const net = buildNetwork([open, stub]);
  const WH = { key: 'WH', x: 0, z: 0 }, stations = [{ key: 'P', x: -1400, z: 18 }, WH, { key: 'Q', x: 1400, z: 18 }];
  const iOpen = stationNode(net, 0, 0), iNear = nearest(net, 0, 0, 300);
  assert.equal(net.open[iNear], 0); assert.ok(Math.abs(net.z[iNear] + 11) < 1e-9, 'the nearest node is on the stub');
  assert.equal(net.open[iOpen], 1); assert.ok(Math.abs(net.z[iOpen] - 18) < 1e-9, 'the station is placed on the open track');
  // Not past nearest + STATION_OPEN_PREFER_M: a station really in tunnel keeps its own node; nothing beyond maxM.
  const far = buildNetwork([straightPiece(-200, 200, 45), straightPiece(-200, 200, -5, 12, () => 'tunnel')]);
  assert.equal(far.open[stationNode(far, 0, 0)], 0, 'an open node 45 m away against a tunnel node 5 m away: the tunnel node');
  assert.equal(stationNode(far, 0, 1000), -1);
  // Where the nearest node is open it is taken, as before.
  assert.equal(stationNode(net, 0, 30), nearest(net, 0, 30, 300));
  // The mapping: a train standing at West Hampstead and passing it is drawn whole, every car on open, drawn track.
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-1400, -20, 0), new THREE.Vector3(0, -20, 0), new THREE.Vector3(1400, -20, 0)]);
  const stationUs = [0, 0.5, 1], half = STOCK['1996'].trainM / 2, layout = carLayout(STOCK['1996']);
  const carsOpen = (runs, uc) => { const run = runAt(runs, uc), pt = {}; if (!run) return -1; return layout.filter(c => { sampleRun(run, sAt(run, uc) + c.offset, 1, pt); return pt.inside && pt.open && pt.drawn; }).length; };
  const now = mapTubeCurve({ curve, stationUs, stations, net, cache: fresh(net), halfTrainM: half });
  // The same with the station placed on its nearest node, as before this sprint (the cache filled by hand).
  const was = mapTubeCurve({ curve, stationUs, stations, net, cache: { routes: new Map(), stationNode: new Map([['P', nearest(net, -1400, 18, 300)], ['WH', iNear], ['Q', nearest(net, 1400, 18, 300)]]) }, halfTrainM: half });
  let stubs = 0;
  for (let uc = 0.5 - 300 / 2800; uc <= 0.5 + 300 / 2800; uc += 2 / 2800) {
    assert.equal(carsOpen(now.runs, uc), layout.length, `a train centred ${((uc - 0.5) * 2800).toFixed(0)} m from West Hampstead is whole`);
    const w = carsOpen(was.runs, uc); if (w >= 0 && w < layout.length) stubs++;
  }
  assert.ok(stubs > 100, `the fixture bites: before, the train was drawn in part at ${stubs} of 301 places`);
  assert.equal(carsOpen(now.runs, 0.5), layout.length); // standing at the station
});

test('a train standing at an open station whose run ends in a covered stretch is fitted whole (Barking); one standing in a tunnel is left alone', () => {
  // The Hammersmith & City at Barking: the band it runs on ends 34 m past the platforms, under a bridge (three
  // tunnel samples); the run's start extension walked into them, and the S7 train standing at Barking reached 13 m
  // past the open track, its end car drawn nowhere. Here: a terminus T at x = 40, tunnel samples at x < 0.
  const half = STOCK.S7.trainM / 2;
  const net = buildNetwork([straightPiece(-36, 3000, 0, 12, x => (x < 0 ? 'tunnel' : 'surface'))]);
  const stations = [{ key: 'T', x: 40, z: 0 }, { key: 'E', x: 2950, z: 0 }];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(40, -20, 6), new THREE.Vector3(1500, -20, 6), new THREE.Vector3(2950, -20, 6)]);
  const L = curve.getLength();
  const plain = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net) }).runs[0];
  const { runs, stats } = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net), halfTrainM: half });
  const run = runs[0], pt = {};
  assert.equal(run.extendedStart, true); assert.equal(run.open[0], 0, 'the run starts on the covered stretch');
  // Unfitted, the train standing at T reaches past the open track.
  sampleRun(plain, plain.as[0] - half, 1, pt); assert.ok(!(pt.inside && pt.open), 'the case needs fitting');
  assert.equal(stats.fitStart, 1); assert.equal(stats.innerTunnel ?? 0, 0);
  // Fitted: the train's end 2 m inside the open track (x = 0), moved by at most half a train plus END_CLEAR_M.
  sampleRun(run, run.as[0] - half, 1, pt); assert.ok(Math.abs(pt.x - END_CLEAR_M) < 1e-6, `train end at x ${pt.x}`);
  assert.ok(run.as[0] - (plain.as[0] - plain.cum[0] + run.cum[0]) <= half + END_CLEAR_M + 1e-6);
  for (const c of carLayout(STOCK.S7)) { sampleRun(run, run.as[0] + c.offset, 1, pt); assert.ok(pt.inside && pt.open && pt.drawn === 1, `car at ${c.offset}`); }
  for (const q of ratios(run, L)) assert.ok(q >= SPEED_RATIO_MIN - 1e-9 && q <= SPEED_RATIO_MAX + 1e-9, `stretch ratio ${q}`);
  // A terminus in the tunnel itself (x = -45, the open track 45 m off: more than STATION_OPEN_PREFER_M past its
  // nearest node): nothing moves; its drawn cars are the ones out of the mouth.
  const tnet = buildNetwork([straightPiece(-300, 3000, 0, 12, x => (x < 0 ? 'tunnel' : 'surface'))]);
  const inT = [{ key: 'T', x: -45, z: 0 }, { key: 'E', x: 2950, z: 0 }];
  const curve2 = new THREE.CatmullRomCurve3([new THREE.Vector3(-45, -20, 6), new THREE.Vector3(1500, -20, 6), new THREE.Vector3(2950, -20, 6)]);
  const a = mapTubeCurve({ curve: curve2, stationUs: [0, 1], stations: inT, net: tnet, cache: fresh(tnet) }).runs[0];
  const b = mapTubeCurve({ curve: curve2, stationUs: [0, 1], stations: inT, net: tnet, cache: fresh(tnet), halfTrainM: half });
  sampleRun(a, a.as[0], 1, pt); assert.equal(pt.open, 0, 'the station is in the tunnel');
  assert.equal(b.runs[0].as[0], a.as[0]); assert.equal(b.stats.fitStart, 0);
});

test('a train standing at the end of its run past the inner end of the open track only is left alone, counted (Earl\'s Court)', () => {
  // The District from Upminster at Earl's Court: it comes out of the tunnel 5 m before the station's node and the
  // drawn track runs on 82 m past it, shorter than the train either side: the rear two cars stay in the tunnel the
  // train came out of. The front never reaches past the drawn track's end.
  const half = STOCK.S7.trainM / 2;
  const net = buildNetwork([straightPiece(0, 2064, 0, 12, x => (x < 1980 ? 'tunnel' : 'surface')), straightPiece(-1000, 0, 0, 12, () => 'surface')]);
  const stations = [{ key: 'A', x: -900, z: 0 }, { key: 'EC', x: 1985, z: 0 }];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-900, -20, 6), new THREE.Vector3(500, -20, 6), new THREE.Vector3(1985, -20, 6)]);
  const plain = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net) }).runs[0];
  const { runs, stats } = mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net), halfTrainM: half });
  assert.equal(stats.innerTunnel, 1); assert.equal(stats.fitEnd, 0);
  assert.equal(runs[0].as.at(-1), plain.as.at(-1));
  const pt = {};
  sampleRun(runs[0], runs[0].as.at(-1) + half, 1, pt); assert.ok(pt.inside && pt.open, 'the front stands on the drawn track');
  sampleRun(runs[0], runs[0].as.at(-1) - half, 1, pt); assert.ok(pt.inside && !pt.open, 'the rear is in the tunnel, on the run');
});

test('a fit window may end on a portal the speed bound moved while either stretch beside it still justifies the move (Kensington (Olympia))', () => {
  // The portal was moved for the stretch before it (2.5 times the timetable's speed at the chord's nearest point);
  // the fit only makes that stretch a little slower. Fix round 2 asked the stretch beyond it, which never broke the
  // bound, and refused the fit: the train stood at Earl's Court with two cars in the tunnel.
  const half = STOCK.S7.trainM / 2;
  const mk = () => ({ cum: Float64Array.from([0, 12, 24, 36, 1150]), open: Uint8Array.from([0, 0, 1, 1, 1]), drawn: Uint8Array.from([1, 1, 1, 1, 1]), au: Float64Array.from([0, 0.2, 1]), as: Float64Array.from([80, 330, 1080]), station: Uint8Array.from([1, 0, 1]), portal: Uint8Array.from([0, 2, 0]), nearU: Float64Array.from([NaN, 0.1, NaN]) });
  const r = mk(), st = {};
  fitEnds(r, half, 1000, st);
  assert.equal(st.fitStart, 1); assert.ok(Math.abs(r.as[0] - (24 + half + END_CLEAR_M)) < 1e-9); assert.equal(r.as[1], 330);
  // Neither side justifying it (nearU where the stretch before keeps the bound): refused, as before.
  const r2 = mk(); r2.nearU[1] = 0.17; const st2 = {};
  fitEnds(r2, half, 1000, st2);
  assert.equal(st2.fitSkipped, 1); assert.deepEqual([...r2.as], [80, 330, 1080]);
});

test('DLR: a curve whose last stretch leaves the drawn track carries on along the drawn piece it was on, and its train stands there whole (Stratford)', async () => {
  const { TAIL_WALK_MAX_M } = await import('../src/surface-train-map.js');
  // Canning Town to Stratford: the curve's last 120 m follow the eastern track into platforms 16 and 17, which is not
  // drawn; the DLR's colour is drawn on the Jubilee's corridor beside it, 40 to 55 m west. Here the deck runs along
  // z = 0 to x = 1300; the curve leaves it from x = 850 and ends 60 m north of it.
  const half = STOCK.B07.trainM / 2;
  const deck = { pts: Array.from({ length: 131 }, (_, i) => ({ x: i * 10, z: 0, terrainY: 0, y: 20, cls: 'viaduct' })), morph: false };
  const net = buildNetwork([deck]), index = buildSegmentIndex(net);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 20, 1), new THREE.Vector3(500, 20, 1), new THREE.Vector3(850, 20, -2), new THREE.Vector3(950, 20, -45), new THREE.Vector3(1010, 20, -62)]);
  const fallback = (x, y) => ({ base: 0, y, open: true });
  const pt = {}, wholeAt = (run, u) => { const sc = sAt(run, u); return carLayout(STOCK.B07).every(c => { sampleRun(run, sc + c.offset, 1, pt); return pt.inside && pt.open && pt.drawn === 1; }); };
  const was = mapSnapCurve({ curve, net, index, ratio: 1, fallback, extendM: 0 }); // the Pedestrian's call: unchanged
  assert.ok(was.stats.fallback > 5, `the fixture bites: ${was.stats.fallback} samples undrawn`);
  const wr = was.runs[0]; sampleRun(wr, sAt(wr, 1), 1, pt); assert.equal(pt.drawn, 0);
  const m = mapSnapCurve({ curve, net, index, ratio: 1, fallback, halfTrainM: half });
  const run = m.runs[0];
  assert.equal(m.stats.tailWalks, 1); assert.ok(m.stats.tailWalkSamples * 10 <= TAIL_WALK_MAX_M);
  assert.equal(run.tailWalkEnd, true); assert.equal(run.tailWalkStart, false);
  assert.ok(wholeAt(run, 1), 'whole, standing at the end of its curve');
  for (let i = 0; i < run.x.length; i++) assert.ok(Math.abs(run.z[i]) < 1e-6 && run.x[i] <= 1300 + 1e-6, `vertex ${run.x[i]}, ${run.z[i]} on the deck`);
  for (let s = 0; s <= run.length; s += 5) { sampleRun(run, s, 1, pt); assert.equal(pt.drawn, 1, `undrawn at ${s}`); }
  for (let k = 1; k < run.as.length; k++) assert.ok(run.as[k] >= run.as[k - 1]);
  // A tail bounded by tunnel is left as it is (Woolwich Arsenal).
  const tdeck = { pts: deck.pts.map(p => ({ ...p, cls: p.x > 800 ? 'tunnel' : 'viaduct' })), morph: false };
  const tnet = buildNetwork([tdeck]);
  const t = mapSnapCurve({ curve, net: tnet, index: buildSegmentIndex(tnet), ratio: 1, fallback, halfTrainM: half });
  assert.equal(t.stats.tailWalks ?? 0, 0);
});

test('a piece\'s open end joins an open node beside a tunnel mouth, so a route crossing there never dips into the tunnel (Dagenham Heathway)', async () => {
  const { JOIN_OPEN_PREFER_M } = await import('../src/surface-train-map.js');
  assert.equal(JOIN_OPEN_PREFER_M, 12);
  // The main piece runs east to west, open east of x = 8 and tunnel west of it; a parallel open piece 10 m south runs
  // west from x = 3, its east end 10.4 m from the mouth's first tunnel node and 13.5 m from the last open one. A
  // route from the east onto the parallel piece crossed through the tunnel node: a car hidden for 7 m, two portals.
  const main = straightPiece(-600, 1200, 0, 12, x => (x < 8 ? 'tunnel' : 'surface'));
  const side = straightPiece(-597, 3, -10);
  const stations = [{ key: 'E', x: 1150, z: 0 }, { key: 'DH', x: -300, z: -10 }];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(1150, -20, 0), new THREE.Vector3(400, -20, -5), new THREE.Vector3(-300, -20, -10)]);
  const runOf = net => mapTubeCurve({ curve, stationUs: [0, 1], stations, net, cache: fresh(net) });
  const was = runOf(buildNetwork([main, side], { joinOpenPreferM: 0 })), now = runOf(buildNetwork([main, side]));
  assert.ok(was.stats.portals >= 2, `the fixture bites: ${was.stats.portals} portals`);
  assert.equal(now.stats.portals, 0); assert.equal(now.stats.mapped, 1);
  const run = now.runs[0];
  for (let i = 0; i < run.x.length; i++) assert.equal(run.open[i], 1, `vertex ${run.x[i]}, ${run.z[i]} open`);
  assert.ok(sampleTurns(run).kink <= KINK_TURN_DEG);
});
