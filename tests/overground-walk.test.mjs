// overground-walk.test.mjs: sprint 02Oct26f, lane O (D-048 item 5), where the Pedestrian walker is shown on
// the Overground and the Overground trains passing through it, pinned in node:
//   * the walker is on the drawn track, 2.6 m to its left (the trains' lane formula), and the opposite
//     lane is 5.2 m away;
//   * the arc is the track's own: 60 and 200 m/s are track speeds (identity trackToChord);
//   * y is LIVE: it follows the drawn samples when Master changes, with no rebuild (the DLR's mapper
//     depends on the ratio; this one must not);
//   * a tunnel run of 40 m between open runs is bridged (open, y straight across), one of 100 m is not;
//     an open run under 60 m is dropped; connectors are the bore;
//   * the heading the walk is steered on is the track's, and a branch is chosen on it;
//   * a train in the walker's lane passes through it (inside, in the walker's window); one in the other
//     lane never does; the formula is the fleet's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOvergroundAirMap, overgroundPass, overgroundPassInputs, OG_LANE_M, OG_BRIDGE_M } from '../src/modes/overground-walk.js';
import { createOpenAirMap } from '../src/modes/open-air-map.js';
import { createOvergroundNetworkSource } from '../src/modes/overground-network.js';
import { buildTunnelNetwork, advance } from '../src/modes/pedestrian-tunnels.js';
import { CAR_STEP } from '../src/overground-trains.js';

const VE = 5, GROUND = 20;
const groundY = () => GROUND;

/** Drawn samples every 12 m along a straight run from (x0, z0) to (x1, z1); cls(x) gives the class. */
function run(x0, z0, x1, z1, cls = () => 'surface') {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 12)), pts = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n, c = cls(x, z);
    pts.push({ x, z, terrainY: GROUND, cls: c, y: c === 'tunnel' ? GROUND - 95 : c === 'viaduct' ? GROUND + 5 + 8 * VE : GROUND + 5 });
  }
  return pts;
}
/** The network path of one drawn piece (no stations), and its presenter. */
function walkerOf(pts, stations = []) {
  const group = { userData: { linePaths: new Map([['weaver', [pts]]]), stationSets: [{ id: 'weaver', stations }] } };
  const src = createOvergroundNetworkSource({ group, getGroundY: groundY, getStructuralY: groundY, VE });
  const input = src.input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers, halfSpacing: 6 });
  const path = net.paths[0];
  return { net, path, map: createOpenAirMap({ path, groundY, VE }), pts, src };
}

test('createOpenAirMap dispatches an Overground path to its own presenter (no Lane T network needed)', () => {
  const { map, path } = walkerOf(run(0, 0, 1000, 0));
  assert.equal(path.og.length, path.vertices.length);
  assert.equal(map.og, true);
  assert.equal(map.runs.length, 0);
  assert.deepEqual(map.refused, []);
});

test('the walker is shown on the drawn track, 2.6 m to the left of its direction of travel (the trains\' own lane formula)', () => {
  const { map, path } = walkerOf(run(0, 0, 1000, 0));
  const out = {};
  map.presentAt(500, 0, out);
  assert.ok(Math.abs(out.x - 500) < 1e-9 && Math.abs(out.z) < 1e-9, 'the centre of the track');
  assert.equal(out.lane, 0);
  assert.deepEqual([out.hx, out.hz], [1, 0]);
  // laneSign +1: the lane of the +s trains: x += hz * 2.6, z -= hx * 2.6 (overground-trains.js).
  map.presentAt(500, +1, out);
  assert.ok(Math.abs(out.z - (-OG_LANE_M)) < 1e-9 && Math.abs(out.x - 500) < 1e-9);
  assert.equal(out.lane, OG_LANE_M);
  map.presentAt(500, -1, out);
  assert.ok(Math.abs(out.z - OG_LANE_M) < 1e-9);
  // The two lanes are 5.2 m apart: beyond the pass tolerance, so a train in the other lane never passes through.
  const a = map.presentAt(500, 1, {}), b = map.presentAt(500, -1, {});
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 2 * OG_LANE_M) < 1e-9);
  assert.equal(OG_LANE_M, 2.6);
  // The same formula on a path running the other way, north to south.
  const south = walkerOf(run(0, 0, 0, 1000));
  const o2 = south.map.presentAt(300, 1, {});
  assert.ok(Math.abs(o2.x - 2.6) < 1e-9 && Math.abs(o2.z - 300) < 1e-9, `left of a southbound heading is +x: ${o2.x}`);
});

test('identity speed: 60 m/s for a second is 60 m of the drawn track, 200 m/s is 200, in either sense; clamped at the ends', () => {
  const { map, path } = walkerOf(run(0, 0, 2000, 0));
  assert.ok(Math.abs(path.length - 2000) < 1e-6, 'the arc is the track\'s');
  assert.equal(map.trackToChord(100, 1, 60), 160);
  assert.equal(map.trackToChord(1000, 1, 200), 1200);
  assert.equal(map.trackToChord(1000, -1, 200), 800);
  assert.equal(map.trackToChord(10, -1, 60), 0);
  assert.equal(map.trackToChord(1990, 1, 60), path.length);
  // Through advance() (the walk's own step), displacement in plan equals the speed on a level run.
  const pos = { path: 0, s: 300, dir: 1 };
  advance(map.path ? { paths: [path], junctionAt: new Map(), VE } : null, pos, 200, { x: 1, z: 0 }, { holdAtPortals: false });
  const q = map.presentAt(pos.s, 0, {});
  assert.ok(Math.abs(q.x - 500) < 1e-6);
});

test('y is live: it follows the drawn samples when Master changes, with no rebuild of the presenter', () => {
  const pts = run(0, 0, 1000, 0, () => 'viaduct');
  const { map } = walkerOf(pts);
  const y0 = map.presentAt(500, 0, {}).y;
  assert.ok(Math.abs(y0 - (GROUND + 5 + 8 * VE)) < 1e-9);
  // overground.js setHeightScale morphs every sample's y: the presenter reads it now.
  for (const p of pts) p.y = GROUND + 5 + 8 * VE * 0.2;
  const y1 = map.presentAt(500, 0, {}).y;
  assert.ok(Math.abs(y1 - (GROUND + 5 + 8 * VE * 0.2)) < 1e-9);
  assert.ok(y1 < y0);
});

test('open intervals: tunnel is the bore, a 40 m tunnel between open runs is bridged (open, y straight across), 100 m is not', () => {
  const mk = (tunnelM) => {
    const a = 1000, b = a + tunnelM;
    return walkerOf(run(0, 0, 2400, 0, (x) => (x >= a && x < b ? 'tunnel' : 'surface')));
  };
  const short = mk(40);
  const iv = short.map.openIntervals();
  assert.equal(iv.length, 1, '40 m of tunnel is an overbridge: one open stretch');
  assert.ok(iv[0][0] < 1 && iv[0][1] > 2390);
  const mid = short.map.presentAt(1020, 0, {});
  assert.equal(mid.open, true); assert.equal(mid.bridged, true);
  // y straight across the open vertices either side of the bridged run, not down the tunnel's dip.
  assert.ok(Math.abs(mid.y - (GROUND + 5)) < 1e-9, `${mid.y}`);
  const long = mk(100);
  const iv2 = long.map.openIntervals();
  assert.equal(iv2.length, 2, '100 m of tunnel is a tunnel');
  assert.equal(long.map.presentAt(1050, 0, {}).open, false);
  // Half-way between differing vertices, in the path's own 3-D arc (the synthetic portal here is a 20 m cliff in 12 m, which the arc counts).
  assert.ok(Math.abs(iv2[0][1] - 1000) < 20 && Math.abs(iv2[1][0] - 1100 - 15) < 20, `boundaries ${JSON.stringify(iv2)}`);
  assert.ok(iv2[1][0] - iv2[0][1] >= 100, 'at least the 100 m of tunnel is the bore');
  assert.ok(long.map.presentAt(1050, 0, {}).y < GROUND - 50, 'the bore is at the drawn tunnel depth');
  assert.equal(OG_BRIDGE_M, 60);
});

test('an open run under 60 m between tunnels is dropped; a connector is the bore', () => {
  const t = walkerOf(run(0, 0, 2000, 0, (x) => (x >= 1000 && x < 1040 ? 'surface' : 'tunnel')));
  assert.equal(t.map.openIntervals().length, 0, 'a 40 m surfacing is noise, not a portal');
  const gapped = walkerOf(run(0, 0, 1000, 0));
  const g = createOvergroundNetworkSource({ group: { userData: { linePaths: new Map([['x', [run(0, 0, 1000, 0), run(1700, 0, 3000, 0)]]]), stationSets: [{ id: 'x', stations: [] }] } }, getGroundY: groundY, VE }).input();
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: g.branches, stationLayers: new Map() });
  const conn = net.paths.find(p => p.og.some(r => r.kind === 'gap'));
  assert.ok(conn);
  const m = createOpenAirMap({ path: conn, groundY, VE });
  const mid = m.presentAt(conn.length / 2, 0, {});
  assert.equal(mid.open, false);
  assert.ok(mid.y < GROUND - 50);
  assert.equal(m.unmapped.length, 1, 'the connector is listed as unmapped');
});

test('the heading steers on the drawn track; a branch is chosen on the track heading averaged with the way to its next station', () => {
  const { map } = walkerOf(run(0, 0, 1000, 0));
  const h = map.drawnHeading(500, 1);
  assert.ok(Math.abs(h.x - 1) < 1e-9 && Math.abs(h.z) < 1e-9);
  const back = map.drawnHeading(500, -1);
  assert.ok(Math.abs(back.x + 1) < 1e-9);
  // At the end it is read from behind, still in the sense of travel.
  const end = map.drawnHeading(1000, 1);
  assert.ok(Math.abs(end.x - 1) < 1e-9);
  const bh = map.branchHeading(500, 1);
  assert.ok(Math.abs(Math.hypot(bh.x, bh.z) - 1) < 1e-9 && bh.x > 0.99);
});

test('presenting a path costs nothing like a rebuild: 20,000 presents under 100 ms', () => {
  const { map, path } = walkerOf(run(0, 0, 20000, 0));
  const out = {};
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) map.presentAt((i * 0.99) % path.length, i & 1 ? 1 : -1, out);
  assert.ok(performance.now() - t0 < 100);
  const t1 = performance.now();
  map.openIntervals();
  assert.ok(performance.now() - t1 < 4, 'the mapping is within the 4 ms a frame budget');
});

// ── trains through the walker ────────────────────────────────────────────────

/** An Overground fleet over one drawn path: trains as overground-trains.js builds them. */
function fleetOver(pts, { phase, cars = 4 }) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum.at(-1) + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum.at(-1), margin = cars * CAR_STEP / 2 + 4, runLen = total - 2 * margin;
  return { userData: { trains: [{ path: pts, cum, total, cars, margin, run: runLen, phase }] } };
}

test('a train in the walker\'s lane passes through the walker (inside); one in the other lane never does', () => {
  const pts = run(0, 0, 3000, 0);
  const { map } = walkerOf(pts);
  const margin = 4 * CAR_STEP / 2 + 4;
  // The train runs +s (phase < run): at arc margin + phase. Put it at arc 1500 + 300; the walker is at 1500 facing it.
  const fleet = fleetOver(pts, { phase: 1800 - margin, cars: 4 });
  const here = (lane) => map.presentAt(1500, lane, {});
  const state = { proxies: new Map(), prev: new Map() };
  let inside = 0, rumble = 0, speedSeen = 0;
  // The train comes at 13 m/s; the walker walks towards it at 200 m/s: relative motion 213 m/s, with dt 1/60.
  for (let k = 0, s = 1500; k < 120; k++) {
    s += 200 / 60;
    fleet.userData.trains[0].phase += 13 / 60;
    const h = map.presentAt(s, +1, {});
    const r = overgroundPass(map, h, +1, 1 / 60, fleet, state, { VE, carStep: CAR_STEP });
    if (r.inside) inside++;
    rumble = Math.max(rumble, r.rumble);
    speedSeen = Math.max(speedSeen, r.insideSpeed);
  }
  assert.ok(inside > 0, 'the walker was inside the train');
  assert.ok(rumble > 0.05);
  assert.ok(speedSeen > 100);
  // The other lane: the same moves, the walker on the far side of the track: never inside.
  const other = { proxies: new Map(), prev: new Map() };
  const fleet2 = fleetOver(pts, { phase: 1800 - margin, cars: 4 });
  let insideOther = 0;
  for (let k = 0, s = 1500; k < 120; k++) {
    s += 200 / 60;
    fleet2.userData.trains[0].phase += 13 / 60;
    const h = map.presentAt(s, -1, {});
    if (overgroundPass(map, h, -1, 1 / 60, fleet2, other, { VE, carStep: CAR_STEP }).inside) insideOther++;
  }
  assert.equal(insideOther, 0, 'the other lane is 5.2 m away');
  assert.equal(here(1).hx, 1);
});

test('overgroundPassInputs: the window is the walker\'s own lane +/- 260 m in 5 m steps; trains beyond 1200 m are left out; the formula is the fleet\'s', () => {
  const pts = run(0, 0, 4000, 0);
  const { map } = walkerOf(pts);
  const fleet = fleetOver(pts, { phase: 100, cars: 3 });
  fleet.userData.trains.push({ ...fleet.userData.trains[0], phase: 3000 });
  const walker = map.presentAt(1000, 1, {});
  const proxies = new Map();
  const { win, near, halfLength } = overgroundPassInputs(map, 1000, 1, walker, fleet, proxies, { carStep: CAR_STEP });
  assert.ok(Math.abs(win[0].s + 260) < 1e-9 && Math.abs(win.at(-1).s - 260) < 1e-9);
  assert.ok(Math.abs(win[1].s - win[0].s - 5) < 1e-9);
  for (const w of win) assert.ok(Math.abs(w.z + OG_LANE_M) < 1e-9, 'in the walker\'s lane');
  assert.equal(near.length, 1, 'the train at arc 3000+ is beyond 1200 m');
  assert.equal(halfLength, 3 * CAR_STEP / 2);
  // The train's proxy: centre + lane offset (dir +1: z -= dx/h * 2.6 -> -2.6), at its own arc (margin + phase).
  const margin = 3 * CAR_STEP / 2 + 4;
  assert.ok(Math.abs(near[0].position.x - (margin + 100)) < 1e-6);
  assert.ok(Math.abs(near[0].position.z + 2.6) < 1e-9);
  // Returning (phase past run): dir -1, the other side of the track.
  const back = fleetOver(pts, { phase: 0, cars: 3 });
  back.userData.trains[0].phase = back.userData.trains[0].run + 1000;
  const r2 = overgroundPassInputs(map, 1000, -1, walker, back, new Map(), { carStep: CAR_STEP });
  if (r2.near.length) assert.ok(Math.abs(r2.near[0].position.z - 2.6) < 1e-9, 'a returning train is in the +2.6 lane');
});

// ── the controller (open-air-walk.js) with an Overground path ───────────────
import { createOpenAirWalk } from '../src/modes/open-air-walk.js';

test('open-air-walk maps an Overground path with no surface trains at all: lazily within the budget, key without a ratio, path.open from the presenter', () => {
  const pts = run(0, 0, 3000, 0, (x) => (x >= 1000 && x < 1300 ? 'tunnel' : 'surface'));
  const { net, path } = walkerOf(pts);
  const walk = createOpenAirWalk({ surfaceTrains: () => null, surfaceRail: () => null, getStructuralY: () => GROUND, getTerrainY: () => GROUND, VE, document: null });
  walk.attach(net);
  assert.deepEqual(path.open, [], 'nothing mapped yet');
  const pending = walk.pump(net);
  assert.equal(pending, 0, 'built within the budget (and not "-1: nothing to map onto")');
  assert.ok(walk.mappingOf(path, { fresh: true }));
  assert.equal(path.openSource, 'map');
  assert.equal(path.open.length, 2, 'open, tunnel, open');
  assert.equal(walk.isOpen(path, 500), true); assert.equal(walk.isOpen(path, 1150), false);
  // The mapping is shared by a rebuilt network of the same centreline (no rebuild per Master step: the key has no ratio).
  const builds = walk.debug(net).builds;
  const again = walkerOf(pts);
  walk.attach(again.net);
  walk.pump(again.net);
  assert.equal(walk.debug(again.net).builds, builds, 'the same centreline reuses its mapping');
  // 200 m/s along the drawn track: chordDistance is the distance in the open and in the bore alike.
  assert.equal(walk.chordDistance(path, 500, 1, 200), 200);
  const rep = walk.debug(net);
  assert.equal(rep.lines['og:weaver'].mapped, rep.lines['og:weaver'].paths);
  assert.ok(rep.lines['og:weaver'].ms <= 4);
});

test('open-air-walk: the Overground pass is dispatched to the line\'s own fleet and a throw in it cannot kill the loop', () => {
  const pts = run(0, 0, 3000, 0);
  const { net, path } = walkerOf(pts);
  const margin = 4 * CAR_STEP / 2 + 4;
  const fleet = fleetOver(pts, { phase: 1800 - margin, cars: 4 });
  fleet.name = 'overground-trains-weaver';
  const group = { userData: { fleets: [fleet] } };
  const walk = createOpenAirWalk({ surfaceTrains: () => null, surfaceRail: () => null, getStructuralY: () => GROUND, getTerrainY: () => GROUND, VE, document: null, overground: () => group });
  walk.attach(net); walk.pump(net);
  const m = walk.mappingOf(path);
  let inside = 0, s = 1500;
  const here = {};
  for (let k = 0; k < 120; k++) {
    s += 200 / 60; fleet.userData.trains[0].phase += 13 / 60;
    walk.present(path, s, 1, here);
    if (walk.surfacePass(path, here, 1, 1 / 60).inside) inside++;
  }
  assert.ok(inside > 0 && walk.passes >= 1, 'one pass through the walker');
  // A fleet that throws: warned once, the loop goes on.
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    const bad = { userData: { fleets: [{ name: 'overground-trains-weaver', userData: { get trains() { throw new Error('boom'); } } }] } };
    const w2 = createOpenAirWalk({ surfaceTrains: () => null, surfaceRail: () => null, getStructuralY: () => GROUND, getTerrainY: () => GROUND, VE, document: null, overground: () => bad });
    w2.attach(net); w2.pump(net);
    walk.present(path, 1500, 1, here);
    for (let i = 0; i < 3; i++) assert.doesNotThrow(() => w2.surfacePass(path, here, 1, 1 / 60));
    assert.equal(warned, 1, 'warned once per line');
  } finally { console.warn = warn; }
  assert.ok(m);
});
