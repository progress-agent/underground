// open-air-map.test.mjs: sprint 01Oct26h (D-042 item 1, D-043 item 4, Lane P),
// the Pedestrian walk to the ends of the lines, pinned in node:
//   * the chord adapter: u is mapTubeCurve's own frac, so station anchors land
//     on their track nodes, and progress along the drawn track is exact;
//   * one second of walking covers 60 m of drawn track (speeds are track speeds);
//   * a platform inside an open run gives one open interval (surface stations are stops);
//   * a refused interval gives no open interval (the walker stays in the bore);
//   * at a branch the drawn track's heading, not the chord's, picks the branch;
//   * the walk holds at the map edge, and stops beyond it are dropped;
//   * station links join a line's pieces that meet only at a station;
//   * advance's portal hold is the interior's opt-in; without it the walk crosses every stop to the line end;
//   * Terminal 4 reads "towards Cockfosters".
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { buildTunnelNetwork, advance, pointAt, headingAt, markMapEdge, EDGE_HOLD_M, STATION_LINK_M, travelDir } from '../src/modes/pedestrian-tunnels.js';
import { createOpenAirMap, chordAdapter, uAtTrack, MIN_OPEN_M } from '../src/modes/open-air-map.js';
import { buildNetwork, nearestNode, LANE_OFFSET_M } from '../src/surface-train-map.js';
import { towards, platformRows, cleanStationName, TOWARDS_WITHIN_STOPS } from '../src/modes/tube-routes.js';

const VE = 5;

/** A walker network from chord points and stations (all 20 m deep). */
function walkerNet(lineId, branches, stationPts) {
  const stations = stationPts.map(([id, x, z]) => ({ id, name: `${id} Underground Station`, pos: new THREE.Vector3(x, -100, z), surfaceY: 0, depthM: 20 }));
  return buildTunnelNetwork({ THREE, VE, branchesByLine: new Map([[lineId, branches.map(b => b.map(([x, z]) => ({ x, y: -100, z })))]]),
    stationLayers: new Map([[lineId, { stationsLayer: { stations } }]]) });
}
/** Drawn track: polyline corners -> samples every 12 m; cls(x, z) gives each sample's class. */
function piece(corners, cls = () => 'surface', { terrainY = 20 } = {}) {
  const pts = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 12));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, c = cls(x, z);
      pts.push({ x, z, terrainY, y: c === 'tunnel' ? terrainY - 100 : terrainY + 5, cls: c });
    }
  }
  return { pts, morph: true };
}

// A straight line A (0) - B (2000) - C (4000) on a straight chord; the drawn
// track bows 150 m north between the stations and is in tunnel west of x = 1000.
const bow = x => -150 * Math.sin(Math.PI * Math.max(0, Math.min(4000, x)) / 2000) ** 2;
function bowTrack({ tunnelBefore = 1000, from = -60, to = 4060 } = {}) {
  const pts = [];
  for (let x = from; x <= to; x += 12) pts.push({ x, z: bow(x), terrainY: 20, y: x < tunnelBefore ? -80 : 25, cls: x < tunnelBefore ? 'tunnel' : 'surface' });
  return buildNetwork([{ pts, morph: true }]);
}
const straight = () => walkerNet('central', [[[0, 0], [2000, 0], [4000, 0]]], [['A', 0, 0], ['B', 2000, 0], ['C', 4000, 0]]);

test('chord adapter: u is mapTubeCurve\'s frac over the vertices, and inverts the walker\'s arc exactly', () => {
  const net = walkerNet('central', [[[0, 0], [300, 400], [1300, 400], [1300, 1400]]], [['A', 0, 0], ['B', 1300, 1400]]);
  const p = net.paths[0], A = chordAdapter(p);
  // frac at each vertex: cumulative 3-D distance over the total (the vertices are level here).
  assert.deepEqual(Array.from(A.frac).map(x => +x.toFixed(6)), [0, 500 / 2500, 1500 / 2500, 1].map(x => +x.toFixed(6)));
  for (let i = 0; i < p.vertices.length; i++) {
    assert.ok(Math.abs(A.uOfS(p.vertexS[i]) - A.frac[i]) < 1e-12, `vertex ${i}`);
    assert.ok(Math.abs(A.sOfU(A.frac[i]) - p.vertexS[i]) < 1e-9);
  }
  for (const s of [0, 123.4, 777, 1999, p.length]) assert.ok(Math.abs(A.sOfU(A.uOfS(s)) - s) < 1e-9, `s ${s}`);
  const q = A.curve.getPointAt(A.uOfS(p.vertexS[2]));
  assert.ok(Math.hypot(q.x - 1300, q.z - 400) < 1e-6, 'the curve passes through the vertices');
  assert.equal(A.curve.getLength(), p.length);
});

test('the adapter on buildNetwork pieces: anchors land on their nodes within 1 m; one second of walking covers 60 m of track', () => {
  const tnet = bowTrack();
  const net = straight();
  const m = createOpenAirMap({ path: net.paths[0], tnet: { net: tnet }, getY: () => 20 });
  assert.equal(m.runs.length, 1);
  for (const st of net.paths[0].stations) {
    const q = m.presentAt(st.s, 0, {});
    const node = nearestNode(tnet, st.s, 0, 300);
    assert.ok(Math.hypot(q.x - tnet.x[node], q.z - tnet.z[node]) <= 1, `${st.name}: ${q.x}, ${q.z} against node ${tnet.x[node]}, ${tnet.z[node]}`);
  }
  // Walk from B for one second at 60 m/s in 1/60 s frames: the drawn track's arc covered is 60 m, though the chord moves less.
  for (const [s0, dir] of [[2000, 1], [3000, -1], [1200, 1]]) {
    let s = s0, ts0 = m.presentAt(s0, 0, {}).ts;
    for (let k = 0; k < 60; k++) s = m.trackToChord(s, dir, 60 / 60);
    const ts1 = m.presentAt(s, 0, {}).ts;
    assert.ok(Math.abs(Math.abs(ts1 - ts0) - 60) < 1e-6, `from ${s0}: ${Math.abs(ts1 - ts0)} m of track`);
    assert.ok(Math.abs(s - s0) < 60, 'the chord is shorter than the bowed track');
  }
  // In a lane, the point shown is LANE_OFFSET_M from the corridor's middle, on the side of travel.
  const mid = m.presentAt(3000, 0, {}), lane = m.presentAt(3000, 1, {});
  assert.ok(Math.abs(Math.hypot(lane.x - mid.x, lane.z - mid.z) - LANE_OFFSET_M) < 1e-6);
  // Leftover beyond the run is carried along the chord one to one.
  const end = m.trackToChord(3990, 1, 50);
  assert.ok(Math.abs(end - 4000) < 1e-6);
});

test('a platform inside an open run gives one interval; the mouth is where the track leaves its tunnel', () => {
  const m = createOpenAirMap({ path: straight().paths[0], tnet: { net: bowTrack() }, getY: () => 20 });
  const iv = m.openIntervals();
  assert.equal(iv.length, 1, JSON.stringify(iv));
  const [a, b] = iv[0];
  assert.ok(b > 2000 && a < 2000, 'station B is inside the open run');
  assert.ok(Math.abs(b - 4000) < 1e-6);
  // The portal is anchored where the chord passes nearest the mouth (x 1000): the open interval starts there.
  assert.ok(Math.abs(a - 1000) < 15, `mouth at ${a}`);
  assert.equal(m.presentAt(2000, 0, {}).open, true);
  assert.equal(m.presentAt(500, 0, {}).open, false);
});

test('a refused interval gives no open interval: the walker stays in the bore', () => {
  // The drawn track between B and C is a 6 km detour (implausible against the 2 km chord): that interval is refused.
  const detour = buildNetwork([
    piece([[-60, 0], [2000, 0]], x => (x < 1000 ? 'tunnel' : 'surface')),
    piece([[2000, 0], [2000, -3000], [4000, -3000], [4000, 0], [4060, 0]]),
  ]);
  const m = createOpenAirMap({ path: straight().paths[0], tnet: { net: detour }, getY: () => 20 });
  assert.ok(m.stats.implausible + m.stats.noRoute >= 1, `the interval is refused: ${JSON.stringify(m.stats)}`);
  const iv = m.openIntervals();
  assert.ok(iv.every(([a, b]) => b <= 2000 + 1e-6), `nothing open between B and C: ${JSON.stringify(iv)}`);
  assert.equal(m.presentAt(3000, 0, {}).open, false);
  assert.deepEqual(m.unmapped.map(r => [r.from, r.to]), [['C Underground Station', 'B Underground Station'].reverse()]);
});

test('slivers under MIN_OPEN_M are ignored both ways: a short gap is bridged at the rail height, a short open stretch dropped', () => {
  // Open from 1000, with a 12 m stretch drawn as tunnel at 3000 (an overbridge) and a lone 10 m of open track at 600.
  const cls = (x) => ((x > 594 && x < 606) || x >= 1000) && !(x > 2994 && x < 3006) ? 'surface' : 'tunnel';
  const tnet = buildNetwork([piece([[-60, 0], [4060, 0]], cls)]);
  const m = createOpenAirMap({ path: straight().paths[0], tnet: { net: tnet }, getY: () => 20 });
  const iv = m.openIntervals();
  assert.equal(iv.length, 1, JSON.stringify(iv));
  assert.ok(iv[0][0] > 900, 'the lone open sample at 600 is not a stretch to walk on');
  const q = m.presentAt(3000, 0, {});
  assert.equal(q.open, true);
  assert.equal(q.bridged, true);
  assert.ok(Math.abs(q.y - 25) < 1e-6, `the rail height carried across the gap: ${q.y}`);
  assert.ok(MIN_OPEN_M >= 20);
});

test('at a branch the drawn heading beats the chord heading', () => {
  // A trunk west of J; branch B's chord heads north-east, branch C's due east. On the ground the track to B
  // leaves J due east for 400 m before it turns north, and the track to C leaves north-east first.
  const net = walkerNet('metropolitan', [[[-1000, 0], [0, 0], [1000, -1000]], [[-1000, 0], [0, 0], [1400, 0]]],
    [['A', -1000, 0], ['J', 0, 0], ['B', 1000, -1000], ['C', 1400, 0]]);
  const tnet = buildNetwork([
    piece([[-1060, 0], [0, 0]]),
    piece([[0, 0], [400, 0], [1000, -1000], [1000, -1060]]),
    piece([[0, 0], [300, -300], [1400, 0], [1460, 0]]),
  ]);
  const maps = net.paths.map(p => createOpenAirMap({ path: p, tnet: { net: tnet }, getY: () => 20 }));
  const drawn = (p, s, d) => maps[p.id].drawnHeading(s, d);
  const pB = net.paths.find(p => p.stations.some(st => st.id === 'B')), pC = net.paths.find(p => p.stations.some(st => st.id === 'C'));
  const jB = pB.stations.find(st => st.id === 'J').s;
  // The drawn heading leaving J toward B is east; the chord's turns north already (a centripetal CatmullRom
  // blends the trunk into the branch), and toward C the chord is the one heading east.
  const hb = drawn(pB, jB, 1), cb = headingAt(pB, jB, 1);
  const hc = drawn(pC, jB, 1), cc = headingAt(pC, pC.stations.find(st => st.id === 'J').s, 1);
  assert.ok(hb.x > 0.95, `drawn toward B ${JSON.stringify(hb)}`);
  assert.ok(cb.z < -0.3 && hb.x - cb.x > 0.05, `chord toward B ${JSON.stringify(cb)}`);
  assert.ok(cc.x > 0.99 && hc.x < 0.9, `toward C: chord ${JSON.stringify(cc)}, drawn ${JSON.stringify(hc)}`);
  // Facing due east, 200 m before J: by the drawn headings the walk takes B (the track the walker sees going
  // straight on); by the chords it would take C.
  const run = (headingOf) => {
    const pos = { path: pC.id, s: pC.stations.find(st => st.id === 'J').s - 200, dir: 1 };
    advance(net, pos, 600, { x: 1, z: 0 }, { holdAtPortals: false, headingOf });
    return net.paths[pos.path] === pB ? 'B' : 'C';
  };
  assert.equal(run(drawn), 'B');
  assert.equal(run(headingAt), 'C');
  // travelDir takes the same heading.
  assert.equal(travelDir(pB, jB + 50, { x: 1, z: 0 }, -1, drawn), 1);
});

test('the walk holds at the map edge, 150 m inside it; stops beyond it are dropped, the stations kept for "towards X"', () => {
  const net = walkerNet('central', [[[0, 0], [2000, 0], [4000, 0], [6000, 0]]], [['A', 0, 0], ['B', 2000, 0], ['C', 4000, 0], ['D', 6000, 0]]);
  const inside = (x) => x < 4500;   // the map ends at x = 4500
  const dropped = markMapEdge(net, { inside });
  const p = net.paths[0];
  assert.equal(dropped, 1);
  assert.deepEqual(p.stops.map(x => x.stop.id), ['A', 'B', 'C']);
  assert.deepEqual(p.stations.map(x => x.id), ['A', 'B', 'C', 'D'], 'the stations are untouched');
  assert.ok(!net.entrances.some(e => e.name === 'D'));
  assert.equal(p.edge.length, 1);
  assert.ok(Math.abs(p.edge[0][0] - (4500 - EDGE_HOLD_M)) <= 1, `hold at ${p.edge[0][0]}`);
  // Walking east at 200 m/s, 1/20 s frames, without the portal hold: held at the edge, reported, whatever the frame.
  const pos = { path: 0, s: 1000, dir: 1 };
  let r;
  for (let i = 0; i < 400; i++) { r = advance(net, pos, 10, { x: 1, z: 0 }, { holdAtPortals: false }); if (r.stopped) break; }
  assert.equal(r.edge, true);
  assert.ok(Math.abs(pos.s - p.edge[0][0]) < 1e-9);
  assert.equal(advance(net, pos, 10, { x: 1, z: 0 }, { holdAtPortals: false }).edge, true, 'pressing on does not pass it');
  assert.ok(Math.abs(pos.s - p.edge[0][0]) < 1e-9);
  // Walking back toward the map is free.
  const back = advance(net, pos, 50, { x: -1, z: 0 }, { holdAtPortals: false });
  assert.equal(back.stopped, false);
  // The "towards" text is unchanged: the last station that way is still D.
  const routes = new Map([['central', { lineName: 'Central', names: new Map(), orderedLineRoutes: [] }]]);
  const rows = platformRows(net, net.entrances.find(e => e.name === 'B'), { tubeRoutes: routes });
  assert.ok(rows.some(r => r.label === 'Central · towards D'), JSON.stringify(rows.map(r => r.label)));
  // A path starting off the map (Epping on its own branch): its first stop is dropped and the hold is at the other end.
  const net2 = walkerNet('central', [[[6000, 0], [4000, 0], [2000, 0]]], [['E', 6000, 0], ['F', 4000, 0], ['G', 2000, 0]]);
  markMapEdge(net2, { inside });
  assert.deepEqual(net2.paths[0].stops.map(x => x.stop.id), ['F', 'G']);
  assert.equal(net2.paths[0].edge[0][0], 0);
  assert.ok(Math.abs(net2.paths[0].edge[0][1] - (1500 + EDGE_HOLD_M)) <= 1);
});

test('station links: a line\'s pieces that meet only at a station (the DLR) are joined there, a different station is not', () => {
  // Piece 1: S0 - W (ends at W). Piece 2: W' (60 m from W) - Q. Piece 3: T (a terminus 50 m from piece 1's W, another station).
  const net = walkerNet('dlr', [[[0, 0], [1000, 0]], [[1060, 0], [1060, 1000]], [[1000, 50], [1000, 600]]],
    [['S0', 0, 0], ['W', 1000, 0], ['W', 1060, 0], ['Q', 1060, 1000], ['T', 1000, 600]]);
  assert.ok(net.stats.links >= 2, JSON.stringify(net.stats));
  assert.ok(STATION_LINK_M >= 60);
  // From S0 east, facing south at the end: on to Q.
  const pos = { path: 0, s: 100, dir: 1 };
  const seen = [];
  for (let i = 0; i < 200; i++) {
    const r = advance(net, pos, 20, i < 40 ? { x: 1, z: 0 } : { x: 0, z: 1 }, { holdAtPortals: false });
    for (const c of r.crossed) seen.push(c.stop.id);
    if (r.stopped) break;
  }
  assert.equal(net.paths[pos.path].stations.at(-1).id, 'Q');
  assert.deepEqual(seen, ['W', 'Q']);
  // The other station by the line's end is not joined: piece 3 still has its own ends.
  assert.ok(!net.junctionAt.has(`2:${net.paths[2].length}`) || !net.junctionAt.get(`2:${net.paths[2].length}`).some(e => e.path === 0));
});

test('the portal hold is the interior\'s opt-in: without it the walk crosses every stop to the line end', () => {
  // Deep at the west end, in the open from 2.5 km: the bore's lining still holds at the mouth (holdAtPortals default),
  // the walk does not.
  const net = straight();
  const p = net.paths[0];
  p.open = [[2500, p.length]];
  const held = { path: 0, s: 1000, dir: 1 };
  let r;
  for (let i = 0; i < 400; i++) { r = advance(net, held, 10, { x: 1, z: 0 }); if (r.stopped) break; }
  assert.ok(r.portal && Math.abs(held.s - 2500) < 1e-9, 'the interior\'s window is held at the mouth');
  for (const speed of [60, 200]) {
    for (const dt of [1 / 60, 0.05]) {
      const pos = { path: 0, s: 0, dir: 1 };
      const seen = [];
      for (let i = 0; i < 10000; i++) {
        const w = advance(net, pos, speed * dt, { x: 1, z: 0 }, { holdAtPortals: false });
        for (const c of w.crossed) seen.push(c.stop.id);
        assert.equal(w.portal, null);
        if (w.stopped) break;
      }
      assert.deepEqual(seen, ['B', 'C'], `${speed} m/s, dt ${dt}`);
      assert.ok(Math.abs(pos.s - p.length) < 1e-9, 'to the end of the line');
    }
  }
});

test('the anchor inverse: across a flat anchor stretch it takes the far end in the sense of travel', () => {
  const run = { au: [0, 0.2, 0.4, 1], as: [0, 100, 100, 400] };
  assert.equal(uAtTrack(run, 50, 1), 0.1);
  assert.equal(uAtTrack(run, 100, 1), 0.4);
  assert.equal(uAtTrack(run, 100, -1), 0.2);
  assert.equal(uAtTrack(run, 250, 1), 0.7);
  assert.equal(uAtTrack(run, -5, 1), 0);
  assert.equal(uAtTrack(run, 999, -1), 1);
});

function bundled(line) {
  const d = JSON.parse(readFileSync(new URL(`../public/data/tfl/route-sequence/${line}.json`, import.meta.url), 'utf8'));
  const names = new Map();
  for (const sq of d.stopPointSequences) for (const sp of sq.stopPoint) names.set(sp.id, sp.name);
  return { lineName: d.lineName, orderedLineRoutes: d.orderedLineRoutes, names };
}
const idOf = (r, name) => [...r.names].find(([, n]) => cleanStationName(n) === name)?.[0];

test('Terminal 4 reads "towards Cockfosters": the next station on the walker\'s path may come within three stops of a route', () => {
  const r = bundled('piccadilly');
  // The walker's path from Terminal 4 reaches Hatton Cross next; the trains call at Terminals 2 & 3 first.
  const t4 = idOf(r, 'Heathrow Terminal 4'), hx = idOf(r, 'Hatton Cross');
  assert.equal(towards(r, { stationId: t4, nextId: hx }, { withinStops: 1 }).label, '', 'no route has the two in a row');
  assert.equal(towards(r, { stationId: t4, nextId: hx }).label, 'Cockfosters');
  assert.equal(TOWARDS_WITHIN_STOPS, 3);
  // A direct pair reads exactly as before: the wider match is only a fallback.
  for (const [at, next] of [['Green Park', 'Hyde Park Corner'], ['Green Park', 'Piccadilly Circus'], ['Hatton Cross', 'Heathrow Terminal 4']]) {
    const direct = towards(r, { stationId: idOf(r, at), nextId: idOf(r, next) }, { withinStops: 1 });
    assert.ok(direct.label, `${at} -> ${next} is a direct pair`);
    assert.deepEqual(towards(r, { stationId: idOf(r, at), nextId: idOf(r, next) }), direct);
  }
});
