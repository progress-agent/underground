// overground-network.test.mjs: sprint 02Oct26f, lane O (D-048 item 5), the Overground's entry into
// the Pedestrian walk network, pinned in node on synthetic drawn track:
//   * joins: a piece end within 30 m of another piece of its line is joined, at exact coordinates, so the
//     junction keys match; a gap over 30 m is not;
//   * the gap connector: up to 1000 m between components, walked in the bore at the drawn tunnel's own depth;
//   * stations: a stub past a piece's end (15 to 450 m), an insert within 250 m of the track, the reasons
//     for a non-stop, a station carried by every parallel piece, a station listed twice;
//   * the name rule of the interchanges (Seven Sisters merged at 220 m, Bethnal Green not at 461 m,
//     "Queens Park (London)" with "Queen's Park") and the merge of several same-named entrances;
//   * the network built from it: single bore, path.og kept, portal finders skip it, station junctions,
//     the Tube's own entrances unchanged;
//   * live y (the record reads the drawn sample, so Master follows with no rebuild).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  buildLineTopology, createOvergroundNetworkSource, liveY, ogNameKeys, ogNamesMatch, ogCleanName, nearestOn,
  JOIN_M, GAP_MAX_M, ON_TRACK_M, STUB_MIN_M, STUB_MAX_M, BASE_LIFT, TUNNEL_LIFT_M, OG_PREFIX, isOgLine,
} from '../src/modes/overground-network.js';
import { buildTunnelNetwork, markOpenSections, markOpenSectionsFromTrack } from '../src/modes/pedestrian-tunnels.js';

const VE = 5;
const GROUND = 20;
const groundY = () => GROUND;

/** A drawn piece: samples every 12 m along corners, class from `cls(x, z)`; `y` is a live field. */
function piece(corners, cls = () => 'surface') {
  const pts = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 12));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, c = cls(x, z);
      pts.push({ x, z, terrainY: GROUND, cls: c, y: c === 'tunnel' ? GROUND + BASE_LIFT + TUNNEL_LIFT_M * VE : GROUND + BASE_LIFT });
    }
  }
  return pts;
}
const station = (id, name, x, z) => ({ id, name: `${name} Rail Station`, pos: { x, y: GROUND, z } });
const topo = (branches, stations) => buildLineTopology({ id: 'weaver', branches, stations }, { groundY, structuralY: groundY, VE });
const sourceOf = (branches, stations, id = 'weaver') => {
  const group = { userData: { linePaths: new Map([[id, branches]]), stationSets: [{ id, stations }] } };
  return createOvergroundNetworkSource({ group, getGroundY: groundY, getStructuralY: groundY, VE });
};

test('the constants are the drawn tunnel formula of surface-rail.js (BASE_LIFT 5, tunnel -20 m) and the brief\'s distances', () => {
  const src = readFileSync(new URL('../src/surface-rail.js', import.meta.url), 'utf8');
  assert.match(src, /export const BASE_LIFT = 5;/);
  assert.match(src, /tunnel: -20,/);
  assert.equal(BASE_LIFT, 5); assert.equal(TUNNEL_LIFT_M, -20);
  assert.deepEqual([JOIN_M, GAP_MAX_M, ON_TRACK_M, STUB_MIN_M, STUB_MAX_M], [30, 1000, 250, 15, 450]);
  assert.equal(OG_PREFIX, 'og:'); assert.equal(isOgLine('og:weaver'), true); assert.equal(isOgLine('weaver'), false);
});

// ── joins ────────────────────────────────────────────────────────────────────
test('joins: a piece end within 30 m of another piece is joined at exact coordinates; 40 m is not joined', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const near = piece([[500, 17], [500, 600]]);              // its start is 17 m off A's body
  const T = topo([A, near], []);
  assert.equal(T.report.joins.length >= 1, true);
  const joined = T.pieces[1].verts[0];
  // The joining end now starts on A's body: appended exact copy of the vertex inserted there.
  const onA = T.pieces[0].verts.find(v => v.x === joined.x && v.z === joined.z);
  assert.ok(onA, 'the join point is a vertex of the other piece');
  assert.equal(joined.z, 0); assert.equal(Math.round(joined.x), 500);
  // Keys round to the metre, so the two share one: buildTunnelNetwork sees a junction.
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: sourceOf([A, near], []).input().branches, stationLayers: new Map() });
  assert.ok(net.stats.junctions >= 1, 'one junction at the join');
  // Not joined at 40 m.
  const far = piece([[500, 40], [500, 600]]);
  const T40 = topo([A, far], []);
  assert.equal(T40.report.joins.length, 0);
  assert.equal(T40.report.gaps.length, 1, 'a 40 m gap is a connector, not a join');
  assert.ok(Math.abs(T40.report.gaps[0].m - 40) < 1);
});

test('joins: ends of two pieces that meet end to end share their coordinates exactly', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const B = piece([[1010, 3], [2000, 3]]);                   // 10 m past A's end
  const T = topo([A, B], []);
  const a = T.pieces[0].verts.at(-1), b = T.pieces[1].verts[0];
  assert.deepEqual([a.x, a.z], [b.x, b.z]);
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: sourceOf([A, B], []).input().branches, stationLayers: new Map() });
  assert.equal(net.paths[0].junctions.length >= 1, true);
});

test('joins: a join that lands within 12 m of the other piece\'s own end lands ON that end, so three pieces meeting at one junction share one vertex (Willesden Junction)', () => {
  // Two branches start at one point (the Richmond and Clapham Junction branches); the main piece ends 7 m on, beside the first.
  const richmond = piece([[0, 0], [0, 800]]);
  const clapham = piece([[0, 0], [300, 400]]);
  const main = piece([[-17, 9], [-17, -600]]);             // its end (-17, 9): 19 m from the shared start, 7 m from its nearest point on the Richmond piece
  const T = topo([main, richmond, clapham], []);
  const at = (P) => [P.verts[0], P.verts.at(-1)].map(v => `${v.x}:${v.z}`);
  const shared = '0:0';
  assert.ok(at(T.pieces[1]).includes(shared) && at(T.pieces[2]).includes(shared), 'the two branches share their start');
  assert.ok(at(T.pieces[0]).includes(shared), 'and the main piece\'s join is that same vertex, not one 7 m along the Richmond piece');
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: sourceOf([main, richmond, clapham], []).input().branches, stationLayers: new Map() });
  const entries = [...net.junctionAt.values()].find(e => e.length >= 3);
  assert.ok(entries, 'one three-way junction');
  assert.deepEqual(new Set(entries.map(e => e.path)), new Set([0, 1, 2]));
});

test('every vertex carries a record and `.og` has one per vertex', () => {
  const A = piece([[0, 0], [600, 0]]), B = piece([[300, 10], [300, 500]]);
  const arrays = sourceOf([A, B], [station('S1', 'One', 200, 3)]).input().branches.get('og:weaver');
  for (const arr of arrays) { assert.equal(arr.og.length, arr.length); for (const r of arr.og) assert.ok(['track', 'mix', 'stub', 'gap'].includes(r.kind)); }
});

// ── gaps ─────────────────────────────────────────────────────────────────────
test('the gap connector: 820 m between components is bridged in the bore at the drawn tunnel depth; 1100 m is not', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const B = piece([[1820, 0], [3000, 0]]);
  const T = topo([A, B], []);
  assert.equal(T.report.gaps.length, 1);
  assert.ok(Math.abs(T.report.gaps[0].m - 820) < 1);
  const gap = T.pieces.find(p => p.kind === 'gap');
  assert.ok(gap);
  const inner = gap.verts.slice(1, -1);
  assert.ok(inner.length > 40);
  for (const v of inner) { assert.equal(v.rec.kind, 'gap'); assert.equal(v.rec.open, false); assert.equal(liveY(v.rec), GROUND + BASE_LIFT + TUNNEL_LIFT_M * VE); }
  // The ends are the real vertices (continuity, and junction keys that match both pieces).
  assert.deepEqual([gap.verts[0].x, gap.verts[0].z], [1000, 0]);
  assert.deepEqual([gap.verts.at(-1).x, gap.verts.at(-1).z], [1820, 0]);
  const farB = piece([[2200, 0], [3000, 0]]);
  assert.equal(topo([A, farB], []).report.gaps.length, 0, 'over GAP_MAX_M: no connector');
});

test('a station on a gap connector is a stop on it (Bethnal Green, 150 m off the connector)', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const B = piece([[1820, 0], [3000, 0]]);
  const T = topo([A, B], [station('BG', 'Bethnal Green', 1400, 150)]);
  assert.equal(T.report.stops, 1);
  const pl = T.placements[0];
  assert.equal(pl.piece.kind, 'gap');
  assert.equal(pl.how, 'insert');
  // Its record is a mix of two connector records: in the bore at the tunnel's depth.
  assert.equal(liveY(pl.vertex.rec), GROUND + BASE_LIFT + TUNNEL_LIFT_M * VE);
});

// ── stations ─────────────────────────────────────────────────────────────────
test('a station past a piece end is reached by a straight stub to its site (15 to 450 m)', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const T = topo([A], [station('LS', 'London Liverpool Street', 1189, 0)]);
  assert.equal(T.report.stubs.length, 1);
  assert.ok(Math.abs(T.report.stubs[0].m - 189) < 1);
  const stub = T.pieces.find(p => p.kind === 'stub');
  assert.ok(stub);
  // The station is the stub's last vertex, exactly at the site; the stub starts at the end vertex (exact).
  assert.deepEqual([stub.verts.at(-1).x, stub.verts.at(-1).z], [1189, 0]);
  assert.deepEqual([stub.verts[0].x, stub.verts[0].z], [1000, 0]);
  assert.equal(T.placements[0].vertex, stub.verts.at(-1));
  assert.equal(T.report.nonStops.length, 0);
  // Stub samples are 12 m apart.
  for (let i = 1; i < stub.verts.length; i++) assert.ok(Math.hypot(stub.verts[i].x - stub.verts[i - 1].x, stub.verts[i].z - stub.verts[i - 1].z) <= 12.001);
});

test('a stub inherits the end sample\'s state: open from open track, a bore from a tunnel end; its y is the end\'s height above ground carried', () => {
  const open = piece([[0, 0], [1000, 0]]);
  const T1 = topo([open], [station('X', 'Open End', 1100, 0)]);
  const s1 = T1.pieces.find(p => p.kind === 'stub');
  for (const v of s1.verts) assert.equal(v.rec.open, true);
  const tun = piece([[0, 0], [1000, 0]], () => 'tunnel');
  const T2 = topo([tun], [station('X', 'Tunnel End', 1100, 0)]);
  const s2 = T2.pieces.find(p => p.kind === 'stub');
  for (const v of s2.verts) assert.equal(v.rec.open, false);
  // Ground is flat here, so the stub keeps the end's height; on a slope it keeps the height above the ground.
  const sloped = (x) => 20 + x / 100;
  const T3 = buildLineTopology({ id: 'x', branches: [open], stations: [station('X', 'Slope', 1100, 0)] }, { groundY: (x) => sloped(x), VE });
  const st = T3.pieces.find(p => p.kind === 'stub');
  const endY = liveY(st.verts[0].rec), lastY = liveY(st.verts.at(-1).rec);
  assert.ok(Math.abs((lastY - sloped(1100)) - (endY - sloped(1000))) < 1e-9, 'the same height above the ground at the site as at the end');
});

test('the 250 m insert: a station 240 m off the body of the track goes on it; 260 m is a non-stop (no-track)', () => {
  const A = piece([[0, 0], [2000, 0]]);
  const T = topo([A], [station('N', 'Near', 1000, 240), station('F', 'Far', 500, 260)]);
  assert.equal(T.report.stops, 1);
  assert.equal(T.placements[0].S.name, 'Near Rail Station');
  assert.equal(T.report.nonStops.length, 1);
  assert.deepEqual(T.report.nonStops[0], { name: 'Far', reason: 'no-track', d: 260 });
});

test('the reasons for a non-stop: stub-too-long past an end beyond 450 m, no-track beside the body', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const T = topo([A], [station('C', 'Cheshunt', 1520, 0), station('B', 'Beside', 500, 400)]);
  assert.equal(T.report.stops, 0);
  const by = Object.fromEntries(T.report.nonStops.map(n => [n.name, n.reason]));
  assert.deepEqual(by, { Cheshunt: 'stub-too-long', Beside: 'no-track' });
  assert.equal(T.report.stubs.length, 0);
});

test('a station beside a piece\'s last segment is a station at the end: a stub (Upminster, 20 m off the side)', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const T = topo([A], [station('U', 'Upminster', 996, 20)]);
  assert.equal(T.report.stubs.length, 1);
  assert.deepEqual([T.placements[0].vertex.x, T.placements[0].vertex.z], [996, 20]);
});

test('a station within 15 m of the track is an insert at the nearest vertex or a new one: its stop is on the track', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const T = topo([A], [station('H', 'Hoxton', 503, 9)]);
  assert.equal(T.report.stubs.length, 0);
  const v = T.placements[0].vertex;
  assert.equal(v.z, 0, 'on the drawn track');
  assert.ok(Math.abs(v.x - 503) <= 2.5);
  // The inserted vertex is a mix of its neighbours (or an existing vertex), never off the track.
  assert.ok(['track', 'mix'].includes(v.rec.kind));
});

test('a station carried by every parallel piece of its line within d + 30 m (Hackney Downs on both trunks)', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const B = piece([[0, 12], [1000, 12]]);                   // a parallel trunk 12 m away (beyond the joins: ends too far from A's body? they are 12 m: joined)
  const T = topo([A, B], [station('HD', 'Hackney Downs', 500, 4)]);
  const pieces = new Set(T.placements.map(p => p.piece.id));
  assert.equal(pieces.size, 2, 'a stop on each trunk');
  assert.equal(T.report.stops, 1, 'one station');
});

test('a station listed twice by name within 100 m is one station with both ids (Clapham Junction)', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const T = topo([A], [station('CJ1', 'Clapham Junction', 500, 3), { id: 'CJ2', name: 'Clapham Junction Rail Station', pos: { x: 530, y: GROUND, z: 4 } }]);
  assert.equal(T.report.stations, 1);
  assert.deepEqual(T.placements[0].S.ids, ['CJ1', 'CJ2']);
  // 150 m apart is two stations.
  assert.equal(topo([A], [station('CJ1', 'Clapham Junction', 500, 3), { id: 'CJ2', name: 'Clapham Junction Rail Station', pos: { x: 650, y: GROUND, z: 4 } }]).report.stations, 2);
});

test('input(): stop records stand on their vertex, carry site, ids and surfaceY, and y follows the drawn sample live', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const src = sourceOf([A], [station('S', 'Stop', 503, 9)]);
  const first = src.input();
  const st = first.stationLayers.get('og:weaver').stationsLayer.stations[0];
  assert.equal(st.pos.z, 0); assert.deepEqual(st.site, { x: 503, z: 9 }); assert.deepEqual(st.ids, ['S']); assert.equal(st.surfaceY, GROUND);
  const arr = first.branches.get('og:weaver')[0];
  assert.equal(arr[10].y, A[10].y);
  // Master: the drawn samples' y moves, and the next input() reads it; no rebuild of the topology.
  for (const p of A) p.y += 7;
  const builds = src.builds;
  const again = src.input();
  assert.equal(again.branches.get('og:weaver')[0][10].y, A[10].y);
  assert.equal(src.builds, builds, 'topology built once');
  assert.equal(again.stationLayers.get('og:weaver').stationsLayer.stations[0].pos.y, st.pos.y + 7);
});

test('input() is null until the Overground exists', () => {
  const src = createOvergroundNetworkSource({ group: () => null, getGroundY: groundY, VE });
  assert.equal(src.input(), null); assert.equal(src.report(), null);
});

test('liveY: a mix interpolates its two records, a stub keeps its end\'s height above the ground, a gap is fixed', () => {
  const a = { kind: 'track', a: { y: 100 }, open: true }, b = { kind: 'track', a: { y: 200 }, open: true };
  assert.equal(liveY({ kind: 'mix', r0: a, r1: b, t: 0.25, open: true }), 125);
  a.a.y = 140;
  assert.equal(liveY({ kind: 'mix', r0: a, r1: b, t: 0.5, open: true }), 170, 'live: reads the sample now');
  assert.equal(liveY({ kind: 'stub', base: a, gEnd: 30, g: 50, open: true }), 160);
  assert.equal(liveY({ kind: 'gap', y0: -75, open: false }), -75);
});

// ── names and interchanges ───────────────────────────────────────────────────
test('the name rule: case, parentheticals, apostrophes and "&" ignored, a leading "London " optional', () => {
  assert.equal(ogNamesMatch('Queens Park (London) Rail Station', "Queen's Park Underground Station"), true);
  assert.equal(ogNamesMatch('Stratford (London) Rail Station', 'Stratford Underground Station'), true);
  assert.equal(ogNamesMatch('London Euston Rail Station', 'Euston Underground Station'), true);
  assert.equal(ogNamesMatch('London Liverpool Street Rail Station', 'Liverpool Street Underground Station'), true);
  assert.equal(ogNamesMatch('Harrow & Wealdstone Rail Station', 'Harrow & Wealdstone Underground Station'), true);
  assert.equal(ogNamesMatch('Shepherds Bush Rail Station', "Shepherd's Bush (Central) Underground Station"), true);
  assert.equal(ogNamesMatch('Kensington (Olympia) Rail Station', 'Kensington (Olympia) Underground Station'), true);
  // Not the same station.
  assert.equal(ogNamesMatch('Bethnal Green Rail Station', 'Bethnal Green Underground Station'), true, 'same name: the DISTANCE decides, not the name');
  assert.equal(ogNamesMatch('Seven Sisters Rail Station', 'Seven Kings Rail Station'), false);
  assert.equal(ogNamesMatch('Kilburn High Road Rail Station', 'Kilburn Underground Station'), false);
  assert.deepEqual(ogNameKeys('London Euston Rail Station'), ['london euston', 'euston']);
  assert.equal(ogCleanName('London Euston Rail Station'), 'London Euston');
  assert.equal(ogCleanName('Stratford (London) Rail Station'), 'Stratford (London)');
});

/** A one-line Tube stand-in: stops at given places, each its own tiny branch. */
function tubeWith(stops) {
  const branches = new Map(), layers = new Map();
  for (const [lineId, name, x, z] of stops) {
    if (!branches.has(lineId)) { branches.set(lineId, []); layers.set(lineId, { stationsLayer: { stations: [] } }); }
    branches.get(lineId).push([{ x, y: -100, z }, { x: x + 200, y: -100, z }]);
    layers.get(lineId).stationsLayer.stations.push({ id: `${lineId}:${name}`, name: `${name} Underground Station`, pos: new THREE.Vector3(x, -100, z), surfaceY: 0, depthM: 20 });
  }
  return { branches, layers };
}
function withOg(tube, ogBranches, ogStations) {
  const src = sourceOf(ogBranches, ogStations);
  const og = src.input();
  for (const [k, v] of og.branches) tube.branches.set(k, v);
  for (const [k, v] of og.stationLayers) tube.layers.set(k, v);
  return buildTunnelNetwork({ THREE, VE, branchesByLine: tube.branches, stationLayers: tube.layers });
}
const entranceOf = (net, lineId, nm) => net.entrances.find(e => e.stops.some(s => s.lineId === lineId && ogCleanName(s.name) === nm));

test('interchanges: 40 m merges; Seven Sisters joins by name at 220 m; Bethnal Green is NOT merged at 461 m; Queens Park (London) with Queen\'s Park', () => {
  const A = piece([[-5000, 0], [5000, 0]]);
  const tube = tubeWith([
    ['victoria', 'Seven Sisters', 220, 3], ['central', 'Bethnal Green', 461, 1500 + 0],
    ['bakerloo', "Queen's Park", 3010, 20], ['victoria', 'Highbury & Islington', -2000, 14], ['victoria', 'Walthamstow Central', 4000, 700],
  ]);
  const net = withOg(tube, [A], [
    station('SS', 'Seven Sisters', 0, 3), station('BG', 'Bethnal Green', 0 + 1500 * 0 + 1000, 3),
    station('QP', 'Queens Park (London)', 3000, 3), station('HI', 'Highbury & Islington', -2010, 5), station('WC', 'Walthamstow Central', 4000, 4),
  ]);
  const ss = entranceOf(net, 'og:weaver', 'Seven Sisters');
  assert.ok(ss.stops.some(s => s.lineId === 'victoria'), 'Seven Sisters: by name at 220 m');
  const pair = net.stats.ogInterchanges.find(p => p.og === 'Seven Sisters');
  assert.equal(pair.rule, 'name'); assert.ok(Math.abs(pair.m - 220) < 2);
  const bg = entranceOf(net, 'og:weaver', 'Bethnal Green');
  assert.equal(bg.stops.some(s => s.lineId === 'central'), false, 'Bethnal Green is not merged with the Central\'s: a different station');
  const qp = entranceOf(net, 'og:weaver', 'Queens Park (London)');
  assert.ok(qp.stops.some(s => s.lineId === 'bakerloo'));
  assert.ok(qp.names.includes("Queen's Park") && qp.names.includes('Queens Park (London)'));
  const hi = entranceOf(net, 'og:weaver', 'Highbury & Islington');
  assert.ok(hi.stops.some(s => s.lineId === 'victoria'), 'within 40 m of the site');
  // A beyond-400 m same name is a different station.
  const farNet = withOg(tubeWith([['victoria', 'Seven Sisters', 430, 0]]), [A], [station('SS', 'Seven Sisters', 0, 3)]);
  assert.equal(entranceOf(farNet, 'og:weaver', 'Seven Sisters').stops.some(s => s.lineId === 'victoria'), false);
});

test('interchanges: an Overground stop that matches several same-named entrances merges them into the nearest (Stratford)', () => {
  const A = piece([[-1000, 0], [1000, 0]]);
  const tube = tubeWith([['central', 'Stratford', 20, 10], ['jubilee', 'Stratford', 120, 10], ['dlr', 'Stratford', 260, 10], ['central', 'Mile End', 700, 10]]);
  const before = buildTunnelNetwork({ THREE, VE, branchesByLine: tube.branches, stationLayers: tube.layers });
  assert.equal(before.entrances.filter(e => e.name === 'Stratford').length, 3, 'three separate entrances today');
  const tube2 = tubeWith([['central', 'Stratford', 20, 10], ['jubilee', 'Stratford', 120, 10], ['dlr', 'Stratford', 260, 10], ['central', 'Mile End', 700, 10]]);
  const net = withOg(tube2, [A], [station('ST', 'Stratford (London)', 0, 4)]);
  const e = entranceOf(net, 'og:weaver', 'Stratford (London)');
  assert.deepEqual([...new Set(e.stops.map(s => s.lineId))].sort(), ['central', 'dlr', 'jubilee', 'og:weaver']);
  assert.equal(e.name, 'Stratford'); assert.equal(e.x, 20, 'the nearest keeps its position');
  assert.equal(net.entrances.filter(x => x.stops.some(s => /Stratford/.test(s.name))).length, 1);
  assert.equal(net.stats.ogMerges.length, 2);
  assert.equal(net.stats.entrances, net.entrances.length);
  // Mile End, which no Overground stop touched, is unchanged.
  const me = net.entrances.find(x => x.name === 'Mile End');
  assert.deepEqual([me.x, me.z, me.stops.length], [700, 10, 1]);
});

test('interchanges: the Tube\'s own entrances are untouched where no Overground stop reaches them', () => {
  const A = piece([[-1000, 0], [1000, 0]]);
  const mk = () => tubeWith([['central', 'Elsewhere', 5000, 5000], ['central', 'Second', 5300, 5000], ['district', 'Elsewhere', 5010, 5000]]);
  const plain = buildTunnelNetwork({ THREE, VE, branchesByLine: mk().branches, stationLayers: mk().layers });
  const net = withOg(mk(), [A], [station('X', 'Somewhere Else', 0, 0)]);
  const snap = (n) => n.entrances.filter(e => !e.stops.some(s => s.lineId.startsWith('og:'))).map(e => [e.name, e.x, e.z, e.stops.length]);
  assert.deepEqual(snap(net), snap(plain));
});

// ── the network built from it ────────────────────────────────────────────────
test('the network: an Overground path is single-bore on its centreline, keeps path.og, and a stop stands at its site', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const input = sourceOf([A], [station('S', 'Stop', 503, 9)]).input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers, halfSpacing: 6 });
  const p = net.paths[0];
  assert.equal(p.left, null); assert.equal(p.right, null);
  assert.equal(p.og.length, p.vertices.length);
  assert.equal(p.n, p.vertices.length, 'the drawn vertices are the samples: no spline between');
  const st = p.stops[0].stop;
  assert.deepEqual([st.x, st.z], [503, 9], 'the stop is at the station\'s site');
  assert.deepEqual(st.ids, ['S']);
  assert.ok(Math.abs(p.vertices[p.vertexS.findIndex(s => Math.abs(s - st.s) < 1e-6)].z) < 1e-9, 'its platform is on the track');
  assert.equal(net.entrances.length, 1);
  assert.equal(net.entrances[0].name, 'Stop'); assert.deepEqual([net.entrances[0].x, net.entrances[0].z], [503, 9]);
  assert.deepEqual(net.entrances[0].names, ['Stop']);
});

test('the portal finders skip an Overground path: no open stretch of theirs, no unmatchedPaths for it', () => {
  const A = piece([[0, 0], [1000, 0]]);
  const input = sourceOf([A], [station('S', 'Stop', 503, 3)]).input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers });
  markOpenSections(net, { groundY: () => 0, VE });
  markOpenSectionsFromTrack(net, { classAt: () => 1 });
  assert.deepEqual(net.paths[0].open, []);
  assert.equal(net.stats.unmatchedPaths ?? 0, 0);
  assert.equal(net.stats.openShare?.['og:weaver'], undefined);
});

test('station junctions: a station on two pieces is one junction group, so a walker can change track at it', () => {
  const A = piece([[0, 0], [1000, 0]]), B = piece([[0, 60], [1000, 60]]);   // two parallel trunks 60 m apart (not joined)
  const input = sourceOf([A, B], [station('HD', 'Hackney Downs', 500, 30)]).input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers });
  assert.equal(net.paths.length, 3, 'the two trunks and the connector between them (60 m apart)');
  assert.equal(net.paths[0].stops.length, 1); assert.equal(net.paths[1].stops.length, 1);
  const a = net.paths[0].stops[0], b = net.paths[1].stops[0];
  const entries = net.junctionAt.get(`0:${a.s}`);
  assert.ok(entries && entries.some(e => e.path === 1 && Math.abs(e.s - b.s) < 1e-6), 'the two stops are one junction');
  assert.equal(net.stats.ogLinks, 1);
  assert.equal(net.entrances.length, 1, 'one station, one entrance');
});

test('no path has two stops of one station (a join vertex beside a station vertex must not double it)', () => {
  const A = piece([[0, 0], [1000, 0]]), B = piece([[502, 10], [502, 500]]);
  const input = sourceOf([A, B], [station('S', 'Junction', 500, 4)]).input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers });
  for (const p of net.paths) assert.equal(new Set(p.stops.map(x => x.stop.name)).size, p.stops.length, `path ${p.id}`);
});

test('nearestOn: the nearest point of a polyline, and whether it is the end', () => {
  const V = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }];
  assert.deepEqual([nearestOn(V, 5, 3).k, nearestOn(V, 5, 3).end], [0, false]);
  assert.equal(nearestOn(V, 30, 0).end, true);
  assert.equal(nearestOn(V, -4, 1).end, true);
  assert.equal(nearestOn(V, 19.9, 1).end, false);
});
