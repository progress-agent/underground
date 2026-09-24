// Pedestrian mode (lane A2) pure logic: the real-scale slider ease, the body
// physics against the real collision service, swimming in and climbing out,
// and the tunnel network (platform depth, centreline lock, junction choice).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScaleEase, REAL_MASTER, REAL_STRUCTURE } from '../src/modes/pedestrian-scale.js';
import { PEDESTRIAN_TUNABLES, BODY, createBody, stepBody } from '../src/modes/pedestrian-body.js';
import { createCollisionService } from '../src/modes/collision.js';
import { readFileSync } from 'node:fs';
import {
  buildTunnelNetwork, pointAt, advance, nearestEntrance, chooseStop, nearestStopOnPath, boreVertices,
} from '../src/modes/pedestrian-tunnels.js';

const VE = 5;
const P = Object.fromEntries(PEDESTRIAN_TUNABLES.map(d => [d.key, d.default]));

// ── scale ease ───────────────────────────────────────────────────────────────

function fakeSliders(master = 1.1, structure = 2) {
  // Quantise like the HUD <input type=range step=0.1> does, and count writes.
  const s = { master, structure, writes: { master: 0, structure: 0 } };
  const q = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
  return Object.assign(s, {
    getMaster: () => s.master, getStructure: () => s.structure,
    setMaster: (v) => { s.writes.master++; s.master = q(v, 1, 10); return s.master; },
    setStructure: (v) => { s.writes.structure++; s.structure = q(v, 1, 5); return s.structure; },
  });
}

test('entering eases the sliders to real scale over the ease time, then restores on leaving', () => {
  const sl = fakeSliders(3.4, 2);
  const ease = createScaleEase({ sliders: sl });
  assert.deepEqual(ease.begin(), { master: 3.4, structure: 2 });
  const trace = [];
  for (let i = 0; i < 30; i++) { ease.update(1 / 60, 1); trace.push([sl.master, sl.structure]); }
  // Half way through (0.5s) it is in between, not snapped.
  const mid = trace[29];
  assert.ok(mid[0] < 3.4 && mid[0] > REAL_MASTER, `master mid ${mid[0]}`);
  assert.ok(mid[1] > 2 && mid[1] < REAL_STRUCTURE, `structure mid ${mid[1]}`);
  for (let i = 0; i < 40; i++) ease.update(1 / 60, 1);
  assert.equal(sl.master, REAL_MASTER);
  assert.equal(sl.structure, REAL_STRUCTURE);
  assert.equal(ease.running, false);
  // Monotonic: never overshoots or goes backwards.
  for (let i = 1; i < trace.length; i++) {
    assert.ok(trace[i][0] <= trace[i - 1][0] + 1e-9);
    assert.ok(trace[i][1] >= trace[i - 1][1] - 1e-9);
  }
  // Structure writes are throttled (it resnaps the DLR): far fewer than frames.
  assert.ok(sl.writes.structure <= 14, `structure writes ${sl.writes.structure}`);
  assert.deepEqual(ease.restore(), { master: 3.4, structure: 2 });
  assert.equal(sl.master, 3.4);
  assert.equal(sl.structure, 2);
});

test('a slider the viewer moves during the ease is left alone; restore still returns the prior value', () => {
  const sl = fakeSliders(1.1, 2);
  const ease = createScaleEase({ sliders: sl });
  ease.begin();
  for (let i = 0; i < 10; i++) ease.update(1 / 60, 1);
  sl.structure = 3.7; // the viewer drags Structure
  for (let i = 0; i < 80; i++) ease.update(1 / 60, 1);
  assert.equal(sl.structure, 3.7);
  assert.equal(sl.master, 1);
  assert.equal(ease.held.structure, true);
  ease.restore();
  assert.equal(sl.structure, 2);
  assert.equal(sl.master, 1.1);
});

// ── body physics against the real collision service ─────────────────────────

function tile(boxes) {
  const arr = new Float32Array(boxes.length * 16);
  boxes.forEach(({ x, z, side, h, y = 0 }, i) => {
    const o = i * 16;
    arr[o] = side; arr[o + 5] = h; arr[o + 10] = side;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  });
  return { isInstancedMesh: true, name: 'baked-buildings-0', count: boxes.length, instanceMatrix: { array: arr } };
}

// Flat ground at Y 0. A 20m-square, 10m-tall block centred at (0, 0).
// A river for x > 100: water top at 2m, bed at -6m, bank wall on its west edge.
const WATER_TOP = 2 * VE, BED = -6 * VE;
function makeWorld({ bankM = 0.8 } = {}) {
  const c = createCollisionService({
    getBuildingMeshes: () => [tile([{ x: 0, z: 0, side: 20, h: 10 * VE }])],
    getHeightScale: () => 1,
    getGroundY: (x) => (x > 100 ? BED : (x > 90 ? (WATER_TOP + bankM * VE) : 0)),
    getWaterSurfaceY: (x) => (x > 100 ? WATER_TOP : null),
    isSubmerged: (x, y) => x > 100 && y < WATER_TOP,
  });
  return {
    c,
    moveAndSlide: c.moveAndSlide, standHeightAt: c.standHeightAt, waterAt: c.waterAt,
  };
}

function run(body, world, input, seconds, events = [], dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const inp = typeof input === 'function' ? input(i, body) : input;
    stepBody(body, inp, dt, world, P, VE, events);
  }
  return body;
}

test('runs at ~6 m/s on the ground and stops at a facade, sliding along it', () => {
  const world = makeWorld();
  const b = Object.assign(createBody(), { x: -40, y: 0, z: 5 });
  // yaw -PI/2 faces +X.
  run(b, world, { forward: 1, yaw: -Math.PI / 2 }, 1);
  assert.ok(Math.abs(b.vx - P.speed) < 1e-6, `vx ${b.vx}`);
  run(b, world, { forward: 1, yaw: -Math.PI / 2 }, 5);
  assert.ok(b.x <= -10 - BODY.radius + 1e-3 && b.x > -10.5, `stopped at facade x=${b.x}`);
  assert.equal(b.state, 'ground');
  // Push diagonally into the wall: slides along it in Z, does not enter.
  const z0 = b.z;
  run(b, world, { forward: 1, right: 1, yaw: -Math.PI / 2 }, 1);
  assert.ok(b.z > z0 + 2, `slid along the facade (D strafes +Z facing +X): z ${z0} -> ${b.z}`);
  assert.ok(b.x <= -10 - BODY.radius + 1e-3, `still outside x=${b.x}`);
});

test('jump arcs under gravity; a tap does not fire the jetpack', () => {
  const world = makeWorld();
  const b = Object.assign(createBody(), { x: -60, y: 0, z: 40 });
  let peak = 0;
  run(b, world, (i) => ({ jumpPressed: i === 0, jumpHeld: i < 3 }), 2, [], 1 / 120);
  // Replay to find the apex.
  const b2 = Object.assign(createBody(), { x: -60, y: 0, z: 40 });
  for (let i = 0; i < 240; i++) {
    stepBody(b2, { jumpPressed: i === 0, jumpHeld: i < 3 }, 1 / 120, world, P, VE);
    peak = Math.max(peak, b2.y);
    assert.equal(b2.jet, false);
  }
  const apexM = peak / VE, expected = P.jump * P.jump / (2 * P.gravity);
  assert.ok(Math.abs(apexM - expected) < 0.08, `apex ${apexM.toFixed(3)}m vs ${expected.toFixed(3)}m`);
  assert.equal(b.state, 'ground');
  assert.equal(b.y, 0);
});

test('jetpack: holding thrusts up with inertia and lands on a roof', () => {
  const world = makeWorld();
  const b = Object.assign(createBody(), { x: -14, y: 0, z: 0 });
  const events = [];
  // Hold Space facing the block: climbs the facade (blocked) until clear of
  // the 10m roof, then drifts on over it. Release at 12m.
  let released = false;
  run(b, world, (i, body) => {
    if (body.y > 12 * VE) released = true;
    return released ? {} : { forward: 1, yaw: -Math.PI / 2, jumpPressed: i === 0, jumpHeld: true };
  }, 8, events);
  assert.ok(released, 'the jetpack climbed past the roof');
  assert.equal(b.state, 'ground');
  assert.ok(Math.abs(b.y - 10 * VE) < 1e-6, `stands on the roof at ${b.y / VE}m`);
  assert.ok(b.x > -10 && b.x < 10, `on the roof footprint: x ${b.x}`);
  assert.ok(events.some(e => e.type === 'land'));
  // Momentum carried (inertia): it did not stop dead when thrust ended.
  assert.ok(b.x > -9, `drifted on after release: x ${b.x}`);
});

test('walking off a roof falls to the ground', () => {
  const world = makeWorld();
  const b = Object.assign(createBody(), { x: 5, y: 10 * VE, z: 0 });
  run(b, world, { forward: 1, yaw: -Math.PI / 2 }, 4);
  assert.equal(b.state, 'ground');
  assert.equal(b.y, 0);
  assert.ok(b.x > 10);
});

test('walking into the river enters swim with a splash; strokes rise, the body sinks slowly otherwise', () => {
  const world = makeWorld({ bankM: 0.8 });
  const b = Object.assign(createBody(), { x: 80, y: 0, z: 200 });
  const events = [];
  // Step up the bank then off it into the water.
  run(b, world, { forward: 1, yaw: -Math.PI / 2 }, 6, events);
  assert.equal(b.state, 'swim');
  assert.ok(events.some(e => e.type === 'splash'), 'splash on entry');
  // Idle: settles into a slow sink no faster than the sink speed.
  run(b, world, {}, 3);
  assert.ok(b.vy < 0 && b.vy >= -P.sink - 1e-9, `sinking at ${b.vy}`);
  const y0 = b.y;
  const ev2 = [];
  run(b, world, (i) => ({ jumpPressed: i % 20 === 0 }), 2, ev2);
  assert.ok(b.y > y0, 'strokes lift the swimmer');
  assert.ok(ev2.filter(e => e.type === 'stroke').length >= 5);
  // Head can break the surface but never leaves the water.
  run(b, world, (i) => ({ jumpPressed: i % 10 === 0 }), 5);
  assert.ok(b.y + P.eye * VE <= WATER_TOP + BODY.headOut * VE + 1e-6);
  // And the bed is a floor.
  run(b, world, { forward: 1, pitch: -1.2, yaw: -Math.PI / 2 }, 20);
  assert.ok(b.y >= BED - 1e-6);
});

test('swimming to a low bank climbs out; a high wall blocks', () => {
  const world = makeWorld({ bankM: 0.8 });
  const b = Object.assign(createBody(), { x: 130, y: WATER_TOP + (BODY.headOut - P.eye) * VE, z: 0, state: 'swim' });
  const events = [];
  // Face -X (yaw +PI/2) and swim to the bank at x = 100.
  for (let i = 0; i < 2400 && b.state === 'swim'; i++) {
    stepBody(b, { forward: 1, yaw: Math.PI / 2, jumpPressed: i % 30 === 0 }, 1 / 60, world, P, VE, events);
  }
  assert.equal(b.state, 'ground');
  assert.ok(events.some(e => e.type === 'climb'));
  assert.ok(Math.abs(b.y - (WATER_TOP + 0.8 * VE)) < 1e-6, `on the bank at ${b.y / VE}m`);

  const high = makeWorld({ bankM: 6 });
  const h = Object.assign(createBody(), { x: 130, y: WATER_TOP + (BODY.headOut - P.eye) * VE, z: 0, state: 'swim' });
  run(h, high, (i) => ({ forward: 1, yaw: Math.PI / 2, jumpPressed: i % 30 === 0 }), 40);
  assert.equal(h.state, 'swim');
  assert.ok(h.x > 100, `held at the wall: x ${h.x}`);
});

test('body physics is deterministic: the same inputs give bit-identical results', () => {
  const inputs = (i) => ({ forward: 1, right: (i >> 5) & 1 ? 1 : 0, yaw: -Math.PI / 2 + i * 0.001,
    jumpPressed: i % 90 === 0, jumpHeld: i % 90 < 40 });
  const a = run(Object.assign(createBody(), { x: -50, z: 30 }), makeWorld(), inputs, 8);
  const b = run(Object.assign(createBody(), { x: -50, z: 30 }), makeWorld(), inputs, 8);
  assert.deepEqual(a, b);
});

// ── tunnels ─────────────────────────────────────────────────────────────────

// A Y-shaped line: trunk A-B-J, then two branches J-C (east) and J-D (north).
// Heights are canonical (depth x VE below a 0 surface). Two branches share A-B-J.
const v = (x, depthM, z) => ({ x, y: -depthM * VE, z });
const A = v(0, 20, 0), B = v(500, 25, 0), J = v(1000, 30, 0), C = v(1600, 22, 0), D = v(1000, 26, -600);
function yNetwork() {
  const branchesByLine = new Map([['northern', [[A, B, J, C], [A, B, J, D]]]]);
  const st = (id, name, p, depthM) => ({ id, name, pos: new THREE.Vector3(p.x, p.y, p.z), surfaceY: 0, depthM });
  const stationLayers = new Map([['northern', { stationsLayer: { stations: [
    st('a', 'Alpha Underground Station', A, 20), st('b', 'Bravo', B, 25), st('j', 'Junction', J, 30),
    st('c', 'Charlie', C, 22), st('d', 'Delta', D, 26),
  ] } }]]);
  return buildTunnelNetwork({ THREE, branchesByLine, stationLayers, VE });
}

test('platforms sit at their true depth, one entrance per station site', () => {
  const net = yNetwork();
  assert.equal(net.paths.length, 2);
  assert.equal(net.entrances.length, 5);
  const bravo = nearestEntrance(net, 510, 12, 35);
  assert.equal(bravo.name, 'Bravo');
  assert.equal(nearestEntrance(net, 560, 0, 35), null);
  for (const stop of bravo.stops) {
    assert.equal(stop.platformY, -25 * VE);
    assert.equal(stop.depthM, 25);
  }
  assert.equal(nearestEntrance(net, 0, 0, 5).name, 'Alpha');
});

test('tunnel lock: W walks the centreline, facing picks the branch at the junction', () => {
  const net = yNetwork();
  const bravo = nearestEntrance(net, 500, 0, 35);
  // Facing east at Bravo.
  const pick = chooseStop(net, bravo, { x: 1, z: 0 });
  assert.equal(pick.dir, 1);
  const pos = { path: pick.stop.path, s: pick.stop.s, dir: pick.dir };
  // Walk 300m east: still on the trunk, on the curve, between B and J.
  advance(net, pos, 300, { x: 1, z: 0 });
  const p = pointAt(net.paths[pos.path], pos.s);
  assert.ok(Math.abs(p.x - 800) < 5 && Math.abs(p.z) < 5, `on the trunk at ${p.x},${p.z}`);
  assert.ok(p.y < -25 * VE && p.y > -30 * VE, 'at tunnel depth between the platforms');

  // Through the junction facing north: takes the Delta branch.
  const north = { ...pos };
  advance(net, north, 400, { x: 0, z: -1 });
  const pn = pointAt(net.paths[north.path], north.s);
  assert.ok(pn.z < -150 && Math.abs(pn.x - 1000) < 60, `north branch at ${pn.x.toFixed(1)},${pn.z.toFixed(1)}`);

  // Same place, facing east: takes the Charlie branch.
  const east = { ...pos };
  advance(net, east, 400, { x: 1, z: 0 });
  const pe = pointAt(net.paths[east.path], east.s);
  assert.ok(pe.x > 1150 && Math.abs(pe.z) < 30, `east branch at ${pe.x.toFixed(1)},${pe.z.toFixed(1)}`);

  // Walk to the end of the line: stops there, never leaves the path.
  const r = advance(net, east, 5000, { x: 1, z: 0 });
  assert.equal(r.stopped, true);
  const end = pointAt(net.paths[east.path], east.s);
  assert.ok(Math.hypot(end.x - C.x, end.z - C.z) < 1e-6);
  assert.equal(nearestStopOnPath(net, east.path, east.s, 30).name, 'Charlie');

  // S (walking away from the facing) goes back west.
  const back = { path: pick.stop.path, s: pick.stop.s, dir: 1 };
  advance(net, back, 200, { x: -1, z: 0 });
  assert.ok(pointAt(net.paths[back.path], back.s).x < 320);
});

test('shallow and elevated stations have no platform to descend to', () => {
  const branchesByLine = new Map([['dlr', [[v(0, -8, 0), v(400, -8, 0)]]]]);
  const stationLayers = new Map([['dlr', { stationsLayer: { stations: [
    { id: 'x', name: 'Elevated', pos: new THREE.Vector3(0, 8 * VE, 0), surfaceY: 0, depthM: -8 },
  ] } }]]);
  const net = buildTunnelNetwork({ THREE, branchesByLine, stationLayers, VE });
  assert.equal(net.entrances.length, 0);
});

// ── twin bores: the walker is inside a RENDERED tunnel, not between them ─────
//
// main.js draws each branch as two tubes (radius 4.5m) either side of the
// shared centreline. main.js is not importable in node, so the real
// buildOffsetCurvesFromCenterline is lifted from its source text: if the
// mirror in pedestrian-tunnels.js ever drifts from it, these fail.
const MAIN_SRC = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const mainOffsetFn = (() => {
  const start = MAIN_SRC.indexOf('function buildOffsetCurvesFromCenterline(');
  assert.ok(start >= 0, 'main.js still defines buildOffsetCurvesFromCenterline');
  let i = MAIN_SRC.indexOf('{', start), depth = 0;
  for (; i < MAIN_SRC.length; i++) {
    if (MAIN_SRC[i] === '{') depth++;
    else if (MAIN_SRC[i] === '}' && --depth === 0) break;
  }
  const src = MAIN_SRC.slice(start, i + 1);
  return new Function('THREE', `${src}; return buildOffsetCurvesFromCenterline;`)(THREE);
})();
const TUBE_RADIUS = Number(/const radius = ([\d.]+);/.exec(MAIN_SRC)[1]);
const HALF = Number(/const TUNNEL_OFFSET_METRES = ([\d.]+);/.exec(MAIN_SRC)[1]);

function distToCurve(curve, p, samples = 4000) {
  const pts = curve.getPoints(samples);
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z, len2 = vx * vx + vy * vy + vz * vz || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / len2));
    best = Math.min(best, Math.hypot(p.x - a.x - vx * u, p.y - a.y - vy * u, p.z - a.z - vz * u));
  }
  return best;
}

// A curving line so the bores are not trivially straight offsets, plus a
// branch drawn the OTHER way round (from its far end back to the junction).
const Cq = v(1400, 28, -250), Cr = v(1700, 24, -700);
function twinNetwork(halfSpacing = HALF) {
  const trunk = [A, B, J, Cq, Cr];
  const spur = [v(1300, 30, 500), v(1150, 30, 200), J]; // ends at J: reversed relative to travel
  const branchesByLine = new Map([['jubilee', [trunk, spur]]]);
  const st = (id, name, p, depthM) => ({ id, name, pos: new THREE.Vector3(p.x, p.y, p.z), surfaceY: 0, depthM });
  const stationLayers = new Map([['jubilee', { stationsLayer: { stations: [
    st('b', 'Bravo', B, 25), st('q', 'Quebec', Cq, 28),
  ] } }]]);
  const net = buildTunnelNetwork({ THREE, branchesByLine, stationLayers, VE, halfSpacing });
  const rendered = [trunk, spur].map(pts => mainOffsetFn(pts.map(p => new THREE.Vector3(p.x, p.y, p.z)), halfSpacing));
  return { net, rendered };
}

test('boreVertices is main.js buildOffsetCurvesFromCenterline, vertex for vertex', () => {
  const { net, rendered } = twinNetwork();
  assert.equal(TUBE_RADIUS, 4.5);
  assert.equal(HALF, 6);
  net.paths.forEach((path, i) => {
    const mine = boreVertices(THREE, path.vertices, HALF);
    for (const [k, side] of [['left', 'leftCurve'], ['right', 'rightCurve']]) {
      rendered[i][side].points.forEach((q, j) => {
        assert.ok(q.distanceTo(mine[k][j]) < 1e-9, `${k} vertex ${j}`);
      });
    }
  });
});

test('below ground the walker is inside a rendered bore, never in the rock between them', () => {
  const { net, rendered } = twinNetwork();
  const bravo = nearestEntrance(net, 500, 0, 35);
  const pick = chooseStop(net, bravo, { x: 1, z: 0 });
  for (const side of [1, -1]) {
    const pos = { path: pick.stop.path, s: pick.stop.s, dir: pick.dir, side };
    const bore = (p) => (p.side > 0 ? rendered[p.path].leftCurve : rendered[p.path].rightCurve);
    let worst = 0, minCentre = Infinity;
    // Walk the trunk east past the curve, then back and down the reversed spur.
    const legs = [[{ x: 1, z: 0 }, 1200], [{ x: -1, z: 0 }, 900], [{ x: 0.6, z: 0.8 }, 700]];
    for (const [want, total] of legs) {
      for (let d = 0; d < total; d += 25) {
        advance(net, pos, 25, want);
        const p = pointAt(net.paths[pos.path], pos.s, {}, pos.side);
        worst = Math.max(worst, distToCurve(bore(pos), p));
        minCentre = Math.min(minCentre, Math.hypot(p.x - pointAt(net.paths[pos.path], pos.s).x,
          p.z - pointAt(net.paths[pos.path], pos.s).z));
      }
    }
    // On the bore's own axis (well inside the 4.5m radius), and never on the
    // shared centreline, which lies 6m from both bores.
    assert.ok(worst < 0.5, `side ${side}: ${worst.toFixed(3)}m off the rendered bore axis`);
    assert.ok(minCentre > HALF - 1, `side ${side}: came within ${minCentre.toFixed(2)}m of the centreline`);
    assert.equal(pos.path, 1, 'ended on the spur');
  }
});

test('a walker keeps to its bore: turning round and crossing a reversed branch never swap bores', () => {
  const { net } = twinNetwork();
  const bravo = nearestEntrance(net, 500, 0, 35);
  const pick = chooseStop(net, bravo, { x: 1, z: 0 });
  const pos = { path: pick.stop.path, s: pick.stop.s, dir: pick.dir, side: pick.dir };
  const at = () => pointAt(net.paths[pos.path], pos.s, {}, pos.side);
  // Physical side of travel: cross product sign of heading x (point - centre).
  let prev = at();
  let maxJump = 0;
  const step = (want, dist) => {
    for (let d = 0; d < dist; d += 5) {
      advance(net, pos, 5, want);
      const p = at();
      maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.z - prev.z));
      prev = p;
    }
  };
  step({ x: 1, z: 0 }, 300);
  const sideBefore = pos.side;
  step({ x: -1, z: 0 }, 100);             // turn round: same path, same bore
  assert.equal(pos.side, sideBefore);
  step({ x: 1, z: 0 }, 250);              // back east, short of the junction
  step({ x: 0.6, z: 0.8 }, 400);          // onto the reversed spur
  assert.equal(pos.path, 1);
  // Never a teleport: 5m steps move at most ~5m plus the small kink where the
  // two branches' bores meet at the junction (each is offset along its own
  // chord there, exactly as main.js draws them), never the 12m bore-to-bore swap.
  assert.ok(maxJump < 2 * HALF - 1, `largest single-step move ${maxJump.toFixed(2)}m`);
  // Spur is drawn toward J, so travelling away from J is dir -1 and the side flips sign
  // to stay in the same physical bore.
  assert.equal(pos.dir, -1);
  assert.equal(pos.side, -sideBefore);
});

test('platform in a bore is still at the platform\'s true depth', () => {
  const { net } = twinNetwork();
  const bravo = nearestEntrance(net, 500, 0, 35);
  const stop = bravo.stops[0];
  for (const side of [1, -1]) {
    const p = pointAt(net.paths[stop.path], stop.s, {}, side);
    assert.equal(p.y, stop.platformY);
    assert.ok(Math.abs(Math.hypot(p.x - stop.x, p.z - stop.z) - HALF) < 1e-9);
  }
  // Single-bore (twin tunnels off): the centreline is the tunnel.
  const single = twinNetwork(0).net;
  const q = pointAt(single.paths[0], single.paths[0].stops[0].s, {}, 1);
  assert.ok(Math.hypot(q.x - B.x, q.z - B.z) < 1e-9);
});
