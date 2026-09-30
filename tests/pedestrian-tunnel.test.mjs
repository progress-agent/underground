// pedestrian-tunnel.test.mjs: sprint 30Sep26w, D-041, Lane P (the Pedestrian
// tunnel). Pure logic, pinned without a browser:
//   * arrival is the crossing of a platform inside advance(), at 60 and 200 m/s
//     and any frame length, exactly once per platform;
//   * portals found geometrically end the walk, and the walker can walk back;
//   * "Line · towards X" from TfL's bundled ordered routes;
//   * the chooser's capture-phase digit keys (they pick rows while it is open,
//     and pass through to the mode keys while it is closed);
//   * the train passing state (inside a train, closing speed, the other bore
//     ignored; a standing train round a walker at rest passes nothing, and
//     the shake is brief whatever the speeds: fix round 2), the platform
//     section's sourced clearances, and the route
//     source pinned to the bundled data unless ?tfl=live.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  buildTunnelNetwork, advance, pointAt, markOpenSections, nextStation, OPEN_MIN_RUN_M,
} from '../src/modes/pedestrian-tunnels.js';
import { towards, platformRows, routeDestination, joinOr, cleanStationName } from '../src/modes/tube-routes.js';
import { createPlatformChooser } from '../src/modes/platform-chooser.js';
import { passingState, projectOnPolyline, stepShake, TRAIN_HALF_LENGTH_M, SHAKE, MAX_PASS_MPS, SPEED_WINDOW_S } from '../src/tunnel-trains.js';
import { platformSection, PLATFORM, ROUNDEL, buildPlatformGeometry, slicePolyline } from '../src/platform-tunnel.js';
import { PEDESTRIAN_TUNABLES } from '../src/modes/pedestrian-body.js';
import { tflSource, fetchRouteSequence, tflStats } from '../src/tfl.js';
import { createTubeInterior, INTERIOR_LAYER } from '../src/tube-interior.js';

const VE = 5;
const v = (x, depthM, z) => ({ x, y: -depthM * VE, z });

/** A straight east-west line, stations every 1 km, all 20 m deep. */
function straightLine({ n = 6, spacing = 1000, depthM = 20 } = {}) {
  const pts = Array.from({ length: n }, (_, i) => v(i * spacing, depthM, 0));
  const ids = pts.map((_, i) => `S${i}`);
  const stations = pts.map((p, i) => ({ id: ids[i], name: `Station ${i} Underground Station`,
    pos: new THREE.Vector3(p.x, p.y, p.z), surfaceY: 0, depthM }));
  return buildTunnelNetwork({ THREE, VE, branchesByLine: new Map([['victoria', [pts]]]),
    stationLayers: new Map([['victoria', { stationsLayer: { stations } }]]) });
}

// ── arrival by crossing ──────────────────────────────────────────────────────

test('arrival: advance reports every platform crossed, at 60 and at 200 m/s, whatever the frame', () => {
  const net = straightLine();
  const path = net.paths[0];
  for (const speed of [60, 200]) {
    for (const dt of [1 / 120, 1 / 60, 0.05]) {
      const pos = { path: 0, s: 0, dir: 1 };
      const seen = [];
      while (pos.s < path.length - 1e-6) {
        const r = advance(net, pos, speed * dt, { x: 1, z: 0 });
        for (const c of r.crossed) seen.push(cleanStationName(c.stop.name));
        if (r.stopped) break;
      }
      // Station 0 is where the walker starts (no arrival); 1 to 5 are crossed once each.
      assert.deepEqual(seen, ['Station 1', 'Station 2', 'Station 3', 'Station 4', 'Station 5'], `${speed} m/s at dt ${dt}`);
    }
  }
});

test('arrival: a single long step still reports each platform, in order, with where along the step', () => {
  const net = straightLine();
  const pos = { path: 0, s: 500, dir: 1 };
  const r = advance(net, pos, 2600, { x: 1, z: 0 });
  assert.deepEqual(r.crossed.map(c => cleanStationName(c.stop.name)), ['Station 1', 'Station 2', 'Station 3']);
  const at = r.crossed.map(c => Math.round(c.at));
  assert.deepEqual(at, [500, 1500, 2500]);
  // Backwards too.
  const back = advance(net, { path: 0, s: 2500, dir: -1 }, 1600, { x: -1, z: 0 });
  assert.deepEqual(back.crossed.map(c => cleanStationName(c.stop.name)), ['Station 2', 'Station 1']);
});

test('arrival: stopping exactly on a platform arrives there; leaving it again does not', () => {
  const net = straightLine();
  const pos = { path: 0, s: 900, dir: 1 };
  const r1 = advance(net, pos, 100, { x: 1, z: 0 });
  assert.deepEqual(r1.crossed.map(c => cleanStationName(c.stop.name)), ['Station 1']);
  const r2 = advance(net, pos, 100, { x: 1, z: 0 });
  assert.deepEqual(r2.crossed, []);
});

test('the next station along a path, either way', () => {
  const net = straightLine();
  const p = net.paths[0];
  assert.equal(cleanStationName(nextStation(p, 1000, 1).name), 'Station 2');
  assert.equal(cleanStationName(nextStation(p, 1000, -1).name), 'Station 0');
  assert.equal(nextStation(p, p.length, 1), null);
  assert.equal(p.stations.length, 6);
});

// ── portals ──────────────────────────────────────────────────────────────────

test('portals: found where the track reaches the ground; the walk stops there and can walk back', () => {
  // Deep at 0-2 km, rising to the surface by 3 km and staying there (a line leaving its tunnel).
  const pts = [v(0, 25, 0), v(1000, 22, 0), v(2000, 12, 0), v(3000, 0, 0), v(4000, 0, 0), v(5000, 0, 0)];
  const stations = [0, 1, 2].map(i => ({ id: `D${i}`, name: `Deep ${i}`, pos: new THREE.Vector3(pts[i].x, pts[i].y, pts[i].z), surfaceY: 0, depthM: -pts[i].y / VE }));
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: new Map([['metropolitan', [pts]]]),
    stationLayers: new Map([['metropolitan', { stationsLayer: { stations } }]]) });
  assert.equal(markOpenSections(net, { groundY: () => null }), -1, 'no ground yet: nothing marked');
  assert.equal(net.paths[0].open.length, 0);
  const portals = markOpenSections(net, { groundY: () => 0, VE });
  assert.equal(portals, 1);
  const [[a, b]] = net.paths[0].open;
  assert.ok(a > 2000 && a < 3000, `portal at ${a}`);
  assert.equal(Math.round(b), Math.round(net.paths[0].length));
  // Walk east at 200 m/s in 50 ms frames: stopped at the mouth, reported as a portal.
  const pos = { path: 0, s: 1000, dir: 1 };
  let r;
  for (let i = 0; i < 400; i++) { r = advance(net, pos, 10, { x: 1, z: 0 }); if (r.stopped) break; }
  assert.equal(r.stopped, true);
  assert.ok(r.portal && Math.abs(r.portal.s - a) < 1e-9);
  assert.ok(Math.abs(pos.s - a) < 1e-9);
  // Pressing on does not pass it.
  const again = advance(net, pos, 10, { x: 1, z: 0 });
  assert.equal(again.stopped, true);
  assert.ok(Math.abs(pos.s - a) < 1e-9);
  // Walking back is free.
  const back = advance(net, pos, 50, { x: -1, z: 0 });
  assert.equal(back.stopped, false);
  assert.ok(Math.abs(pos.s - (a - 50)) < 1e-6);
  // The walker is held an inset short of the mouth, and cannot creep nearer from inside the inset.
  const walker = { path: 0, s: 1000, dir: 1 };
  let w;
  for (let i = 0; i < 400; i++) { w = advance(net, walker, 10, { x: 1, z: 0 }, { portalInset: 20 }); if (w.stopped) break; }
  assert.ok(Math.abs(walker.s - (a - 20)) < 1e-9 && Math.abs(w.portal.mouth - a) < 1e-9);
  const inset = { path: 0, s: a - 5, dir: 1 };
  const w2 = advance(net, inset, 10, { x: 1, z: 0 }, { portalInset: 20 });
  assert.equal(w2.stopped, true);
  assert.ok(Math.abs(inset.s - (a - 5)) < 1e-9);
});

test('portals: a narrow dip in the ground, a short surfacing and a crossing under water are not portals', () => {
  const pts = Array.from({ length: 41 }, (_, i) => v(i * 100, 10, 0));
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: new Map([['central', [pts]]]), stationLayers: new Map() });
  // A 150 m wide, 12 m deep dip at 2 km: over the tunnel for a moment, gone once averaged.
  const dip = (x) => (Math.abs(x - 2000) < 75 ? -12 * VE : 0);
  assert.equal(markOpenSections(net, { groundY: (x) => dip(x), VE }), 0);
  // Under the river (a water top above the track): underground, even with low ground.
  net.openMarked = false;
  assert.equal(markOpenSections(net, { groundY: () => -20 * VE, waterY: (x) => (x > 1000 && x < 3000 ? 2 * VE : null), VE }), 2);
  const open = net.paths[0].open;
  assert.ok(open.every(([s0, s1]) => s1 <= 1050 || s0 >= 2950), JSON.stringify(open));
  assert.ok(OPEN_MIN_RUN_M >= 30);
});

// Fix round 1: the verifier found buildings drawn inside the bore within a
// window of a portal, because the camera was not isolated there. The mouth is
// now the lining's own daylight cap and the camera stays isolated up to it.
test('portal mouth: a daylight cap closes the window, graded ground to sky; the camera stays on the lining alone', () => {
  const pts = [v(0, 25, 0), v(1000, 22, 0), v(2000, 12, 0), v(3000, 0, 0), v(4000, 0, 0), v(5000, 0, 0)];
  const net = buildTunnelNetwork({ THREE, VE, branchesByLine: new Map([['metropolitan', [pts]]]), stationLayers: new Map() });
  assert.equal(markOpenSections(net, { groundY: () => 0, VE }), 1);
  const [[a]] = net.paths[0].open;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const mask0 = camera.layers.mask;
  const building = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(building);
  const interior = createTubeInterior({ scene, camera: () => camera });
  // Held 20 m inside the mouth, as the walk is (PORTAL_STAND_M), facing it.
  const pos = { path: 0, s: a - 20, dir: 1, side: 0 };
  interior.show(net, pos);
  const d = interior.debug();
  assert.equal(d.portalAhead, true);
  assert.equal(d.isolated, true, 'isolated right up to the mouth');
  assert.equal(camera.layers.mask, 1 << INTERIOR_LAYER);
  assert.ok(!building.layers.test(camera.layers), 'a building over a shallow tunnel is not drawn in it');
  const g = interior.mesh.geometry, uv = g.attributes.interiorUV, P = g.attributes.position, ax = g.attributes.trueAxisY;
  const last = interior.windowPoints.at(-1);
  assert.ok(Math.abs(d.mouth.end - last.s) < 1e-9 && d.mouth.start === null, JSON.stringify(d.mouth));
  assert.ok(Math.abs(last.s - 20) < 0.5, `the mouth 20 m ahead: ${last.s}`);
  // The mouth cap: v = -2.5 - 0.5 x (height off the axis / radius), exactly linear
  // in height (-2 at the invert, -3 at the crown); the far end's cap stays dark.
  // (On a sloping bore the cap's own up is tilted, so its vertical half-extent
  // is the radius times the cosine of the slope: measure against that.)
  let mouthVerts = 0, darkVerts = 0, half = 0;
  for (let i = 0; i < uv.count; i++) if (uv.getY(i) < -1.5) half = Math.max(half, Math.abs(P.getY(i) - ax.getX(i)));
  assert.ok(half > d.radius * 0.99 && half <= d.radius + 1e-9, `cap half-height ${half}`);
  for (let i = 0; i < uv.count; i++) {
    const y = uv.getY(i);
    if (y < -1.5) {
      mouthVerts++;
      assert.ok(y >= -3 - 1e-6 && y <= -2 + 1e-6, `mouth v ${y}`);
      const off = (P.getY(i) - ax.getX(i)) / half;
      assert.ok(Math.abs(y - (-2.5 - 0.5 * off)) < 1e-6, `mouth v ${y} at height ${off}`);
      // u: the offset across the bore over the radius (the rails run out to the horizon on it).
      const u = uv.getX(i);
      assert.ok(Math.abs(u) <= 1 + 1e-9 && Math.abs(u * u + off * off - (y === -2.5 && u === 0 ? 0 : 1)) < 1e-3,
        `mouth u ${u} v ${y}`);
    } else if (y < -0.5) { darkVerts++; assert.equal(y, -1); }
  }
  assert.ok(mouthVerts > 0 && darkVerts > 0, `${mouthVerts} mouth, ${darkVerts} dark`);
  // Looking out along the bore the view meets the mouth cap, 20 m ahead: closed, never the model beyond.
  const here = interior.windowPoints.find(q => q.s === 0);
  const eye = new THREE.Vector3(here.x, here.y, here.z);
  const rc = new THREE.Raycaster(eye, new THREE.Vector3(last.x - here.x, last.y - here.y, last.z - here.z).normalize(), 0, 1e4);
  const hit = rc.intersectObject(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), false)[0];
  assert.ok(hit && uv.getY(hit.face.a) < -1.5, 'the view along the bore ends on the daylight cap');
  // The daylight follows its source (main.js hands over the Sun slider's sky colour).
  interior.setDaylight(() => new THREE.Color(0.2, 0.3, 0.4));
  interior.show(net, pos);
  assert.deepEqual(interior.debug().daylight.map(x => +x.toFixed(6)), [0.2, 0.3, 0.4]);
  // Away from any portal: dark caps both ends, no mouth.
  interior.show(net, { path: 0, s: 600, dir: 1, side: 0 });
  assert.deepEqual(interior.debug().mouth, { start: null, end: null });
  let anyMouth = false;
  const uv2 = interior.mesh.geometry.attributes.interiorUV;
  for (let i = 0; i < uv2.count; i++) if (uv2.getY(i) < -1.5) anyMouth = true;
  assert.equal(anyMouth, false);
  interior.hide();
  assert.equal(camera.layers.mask, mask0);
});

// ── towards X from the bundled TfL data ──────────────────────────────────────

function bundled(line) {
  const d = JSON.parse(readFileSync(new URL(`../public/data/tfl/route-sequence/${line}.json`, import.meta.url), 'utf8'));
  const names = new Map();
  for (const sq of d.stopPointSequences) for (const sp of sq.stopPoint) names.set(sp.id, sp.name);
  return { lineName: d.lineName, orderedLineRoutes: d.orderedLineRoutes, names };
}
const idOf = (r, name) => [...r.names].find(([, n]) => cleanStationName(n) === name)?.[0];

test('towards X: read from the bundled orderedLineRoutes at known stations', () => {
  const cases = [
    ['victoria', 'Oxford Circus', 'Green Park', 'Brixton'],
    ['victoria', 'Oxford Circus', 'Warren Street', 'Walthamstow Central'],
    ['bakerloo', 'Oxford Circus', "Regent's Park", 'Harrow & Wealdstone'],
    ['bakerloo', 'Oxford Circus', 'Piccadilly Circus', 'Elephant & Castle'],
    ['central', 'Bank', 'Liverpool Street', 'Epping or Hainault'],
    ['northern', 'Camden Town', 'Chalk Farm', 'Edgware'],
    ['northern', 'Camden Town', 'Kentish Town', 'High Barnet or Mill Hill East'],
    ['northern', 'Camden Town', 'Euston', 'Morden via Bank'],
    ['northern', 'Camden Town', 'Mornington Crescent', 'Battersea Power Station or Morden via Charing Cross'],
    // Northbound from Euston the "via Bank" is behind the train: dropped.
    ['northern', 'Euston', 'Camden Town', 'Edgware, High Barnet or Mill Hill East'],
    ['dlr', 'Bank', 'Shadwell', 'Lewisham or Woolwich Arsenal'],
  ];
  for (const [line, at, next, want] of cases) {
    const r = bundled(line);
    const t = towards(r, { stationId: idOf(r, at), nextId: idOf(r, next) });
    assert.equal(t.label, want, `${line} ${at} -> ${next}`);
  }
});

test('towards X: an independent reading of the same file agrees for every Victoria platform', () => {
  const r = bundled('victoria');
  // The simplest possible reading: for each route, the destination is the last stop's name.
  for (const route of r.orderedLineRoutes) {
    const ids = route.naptanIds;
    for (let i = 0; i < ids.length - 1; i++) {
      const t = towards(r, { stationId: ids[i], nextId: ids[i + 1] });
      assert.deepEqual(t.destinations, [cleanStationName(r.names.get(ids.at(-1)))]);
    }
  }
  assert.deepEqual(routeDestination({ name: 'Edgware  &harr;  Morden  via Bank ' }), { base: 'Morden', via: 'Bank' });
  assert.equal(joinOr(['A', 'B', 'C']), 'A, B or C');
});

test('platform rows: one per platform and direction, "Line · towards X", deduplicated and sorted', () => {
  const net = straightLine();
  const routes = new Map([['victoria', { lineName: 'Victoria', names: new Map(),
    orderedLineRoutes: [{ name: 'Station 0 &harr; Station 5', naptanIds: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] },
      { name: 'Station 5 &harr; Station 0', naptanIds: ['S5', 'S4', 'S3', 'S2', 'S1', 'S0'] }] }]]);
  const entrance = net.entrances.find(e => e.name === 'Station 2');
  const rows = platformRows(net, entrance, { tubeRoutes: routes, lineColour: () => 0x0098d4 });
  assert.deepEqual(rows.map(r => r.label), ['Victoria · towards Station 0', 'Victoria · towards Station 5']);
  assert.deepEqual(rows.map(r => r.dir).sort(), [-1, 1]);
  assert.equal(rows[0].colour, 0x0098d4);
  // A terminus has one platform direction.
  const end = platformRows(net, net.entrances.find(e => e.name === 'Station 5'), { tubeRoutes: routes });
  assert.deepEqual(end.map(r => r.label), ['Victoria · towards Station 0']);
});

// ── the chooser's keys ───────────────────────────────────────────────────────

function fakeWindow() {
  const listeners = [];
  return {
    addEventListener(type, fn, opts) { listeners.push({ type, fn, capture: !!(opts === true || opts?.capture) }); },
    removeEventListener() {},
    /** Dispatch the way the browser does to a window target: capture listeners first, then the rest. */
    key(key) {
      const e = { type: 'keydown', key, repeat: false, stopped: false, prevented: false, target: null,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; } };
      for (const l of listeners.filter(x => x.type === 'keydown' && x.capture)) { l.fn(e); if (e.stopped) return e; }
      for (const l of listeners.filter(x => x.type === 'keydown' && !x.capture)) { l.fn(e); if (e.stopped) return e; }
      return e;
    },
  };
}

test('chooser: while open, digits pick rows before the mode keys see them; closed, they pass through', () => {
  const win = fakeWindow();
  let lock = true, exits = 0;
  const look = { isLocked: () => lock, exit: () => { lock = false; exits++; } };
  const chooser = createPlatformChooser({ document: null, window: win, look });
  // The mode switcher (modes/index.js) listens on the bubbling phase.
  const modeKeys = [];
  win.addEventListener('keydown', (e) => { if (['1', '2', '3', '4'].includes(e.key)) modeKeys.push(e.key); });
  const picked = [];
  chooser.open({ title: 'Oxford Circus', rows: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], onPick: (row, i) => picked.push(i) });
  assert.equal(exits, 1, 'opening releases pointer lock so the rows can be clicked');
  const e4 = win.key('4');                     // out of range: captured, no pick, no mode switch
  assert.equal(e4.stopped, true);
  assert.equal(chooser.isOpen, true);
  const e2 = win.key('2');
  assert.equal(e2.prevented, true);
  assert.deepEqual(picked, [1]);
  assert.equal(chooser.isOpen, false);
  assert.deepEqual(modeKeys, [], 'no digit reached the mode switcher while the card was open');
  // Closed: the same digit switches mode as before.
  win.key('3');
  assert.deepEqual(modeKeys, ['3']);
  // Esc cancels; W passes through untouched.
  let cancelled = 0;
  chooser.open({ rows: [{ label: 'x' }], onCancel: () => cancelled++ });
  assert.equal(win.key('w').stopped, false);
  win.key('Escape');
  assert.equal(cancelled, 1);
  assert.equal(chooser.isOpen, false);
  assert.equal(chooser.debug().keysCaptured, 2);
});

// ── trains passing through ───────────────────────────────────────────────────

test('passing: inside a train, its closing speed, and the other bore ignored', () => {
  const window = Array.from({ length: 101 }, (_, i) => ({ x: -250 + i * 5, y: -100, z: 0, s: -250 + i * 5 }));
  const walker = { x: 0, y: -100, z: 0 };
  const train = (x, z = 0) => ({ position: { x, y: -100, z }, userData: { id: `t${x}` } });
  const prev = new Map();
  const t1 = train(120);
  let st = passingState([t1, train(20, 12)], window, walker, prev, 0.05);  // the second is in the twin bore, 12 m away
  assert.equal(st.inside, false);
  assert.equal(st.nearest.id, 't120');
  assert.ok(Math.abs(st.nearest.gap - (120 - TRAIN_HALF_LENGTH_M)) < 1e-6);
  t1.position.x = 117;                          // 3 m closer in 0.05 s: closing at 60 m/s
  st = passingState([t1], window, walker, prev, 0.05);
  assert.ok(Math.abs(st.nearest.closing - 60) < 1e-6);
  assert.ok(st.rush > 0 && st.rumble > 0);
  t1.position.x = 30;
  st = passingState([t1], window, walker, prev, 0.05);
  assert.equal(st.inside, true);
  assert.equal(st.rumble, 1);
  const hit = projectOnPolyline(window, { x: 12, y: -100, z: 1 });
  assert.ok(Math.abs(hit.s - 12) < 1e-9 && Math.abs(hit.lateral - 1) < 1e-9);
});

// Fix round 2 (verifier): the rush, the rumble and the shake follow the MOTION
// of the pass. A walker at rest inside a train dwelling at a platform (the
// arrival card open, 15 to 30 s of dwell) saw the view shake at full and heard
// the rumble at full for the whole dwell. Jordan (D-041 item 3): "a brief shake".
const passWindow = () => Array.from({ length: 101 }, (_, i) => ({ x: -250 + i * 5, y: -100, z: 0, s: -250 + i * 5 }));
/** Run passingState + stepShake frame by frame: trainX(t), walkerX(t) in metres along the bore. */
function runPass({ seconds, trainX, walkerX = () => 0, dt = 1 / 60 }) {
  const window = passWindow(), prev = new Map(), train = { position: { x: 0, y: -100, z: 0 }, userData: { id: 'T' } };
  let sh = { shake: 0, passT: null };
  const frames = [];
  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    train.position.x = trainX(t);
    const st = passingState([train], window, { x: walkerX(t), y: -100, z: 0 }, prev, dt);
    sh = stepShake(sh, st, dt);
    frames.push({ t, inside: st.inside, speed: st.insideSpeed, rush: st.rush, rumble: st.rumble, shake: sh.shake, passT: sh.passT });
  }
  return frames;
}
/** Longest run of consecutive frames satisfying f, in seconds. */
const longestRun = (frames, f, dt = 1 / 60) => { let best = 0, run = 0; for (const x of frames) { run = f(x) ? run + 1 : 0; best = Math.max(best, run); } return best * dt; };

test('passing: a train dwelling round a walker at rest passes nothing: no rush, no rumble, no shake, for the whole dwell', () => {
  const frames = runPass({ seconds: 30, trainX: () => 10 });   // the walker 10 m from the centre of a standing train: inside it
  assert.ok(frames.every(f => f.inside), 'the walker is inside the train throughout');
  assert.ok(frames.every(f => f.rush === 0 && f.rumble === 0), 'no air rush and no rumble from a train standing still');
  assert.equal(Math.max(...frames.map(f => f.shake)), 0, 'the view never shakes');
  // Coming to rest there just after a pass: the shake it left dies away within two seconds.
  let sh = { shake: SHAKE.rad, passT: 0.4 };
  const still = { inside: true, insideSpeed: 0, rush: 0, rumble: 0 };
  for (let i = 0; i < 120; i++) sh = stepShake(sh, still, 1 / 60);
  assert.equal(sh.shake, 0);
  // Deterministic: the same frames give the same numbers.
  assert.deepEqual(runPass({ seconds: 2, trainX: () => 10 }), frames.slice(0, 120));
});

test('passing: a running train through a walker at rest rumbles all the way, but the shake is brief', () => {
  // Victoria cruise, 14.5 m/s: its 103.6 m pass the walker in about 7 s.
  const frames = runPass({ seconds: 26, trainX: t => -190 + 14.5 * t });
  const inside = frames.filter(f => f.inside);
  assert.ok(inside.length * (1 / 60) > 6.9, `inside ${inside.length} frames`);
  assert.ok(inside.slice(1).every(f => Math.abs(f.speed - 14.5) < 1e-6 && f.rumble === 1), 'full rumble while it runs through');
  assert.ok(Math.abs(Math.max(...frames.map(f => f.shake)) - SHAKE.rad) < 1e-12, 'a full shake as it arrives');
  // At most SHAKE.holdS of it, dying away with SHAKE.decayS: above a third of the
  // peak for no longer than holdS + decayS * ln 3, though the pass lasts 7 s.
  const strong = longestRun(frames, f => f.shake > SHAKE.rad / 3);
  assert.ok(strong > SHAKE.holdS - 0.05 && strong <= SHAKE.holdS + SHAKE.decayS * Math.log(3) + 0.02, `strong shake ${strong} s`);
  assert.ok(inside.filter(f => f.passT > 3).every(f => f.shake === 0), 'the view is still for the rest of the pass');
});

test('passing: the walker at 60 m/s through a standing train shakes and rumbles; the train pulling away is a new, brief pass', () => {
  // Walking through a train dwelling at a platform.
  const walk = runPass({ seconds: 5, trainX: () => 0, walkerX: t => -150 + 60 * t });
  const inWalk = walk.filter(f => f.inside);
  assert.ok(inWalk.length > 0 && inWalk.slice(1).every(f => Math.abs(f.speed - 60) < 1e-6 && f.rumble === 1));
  assert.ok(Math.abs(Math.max(...inWalk.map(f => f.shake)) - SHAKE.rad) < 1e-12);
  assert.ok(Math.max(...inWalk.map(f => f.rush)) > 0.9, 'a strong air rush');
  // At rest inside a dwelling train for 5 s, then it departs at 12 m/s (trains.js
  // cruise): still, then a full but brief shake as it pulls away round the walker.
  const dep = runPass({ seconds: 14, trainX: t => (t < 5 ? 0 : 12 * (t - 5)) });
  const before = dep.filter(f => f.t < 5);
  assert.ok(before.every(f => f.shake === 0 && f.rumble === 0 && f.rush === 0));
  // The speed is read over SPEED_WINDOW_S, so by then the pass is at its full 12 m/s.
  const moving = dep.filter(f => f.t > 5 + SPEED_WINDOW_S + 0.02 && f.t < 5.4);
  assert.ok(moving.length > 0 && moving.every(f => f.inside && Math.abs(f.speed - 12) < 1e-6
    && Math.abs(f.shake - SHAKE.rad) < 1e-9 && Math.abs(f.rumble - 1) < 1e-9), JSON.stringify(moving[0]));
  assert.ok(longestRun(dep, f => f.shake > SHAKE.rad / 3) <= SHAKE.holdS + SHAKE.decayS * Math.log(3) + 0.02);
  // A jump no train or walker can make (the window moved: a change of bore) is
  // not a pass at 4000 m/s; the last speed holds for that frame.
  const window = passWindow(), prev = new Map(), t1 = { position: { x: 30, y: -100, z: 0 }, userData: {} };
  passingState([t1], window, { x: 0, y: -100, z: 0 }, prev, 0.05);
  t1.position.x = 29.3;
  assert.ok(Math.abs(passingState([t1], window, { x: 0, y: -100, z: 0 }, prev, 0.05).insideSpeed - 14) < 1e-6);
  t1.position.x = -50.7;                          // 80 m in 0.02 s, still inside it
  assert.ok(Math.abs(passingState([t1], window, { x: 0, y: -100, z: 0 }, prev, 0.02).insideSpeed - 14) < 1e-6);
  assert.ok(MAX_PASS_MPS > 2 * (400 + 14.5 * 30), 'the Shift maximum meeting a Victoria train at the 30x time scale is still a pass, even on an uneven frame');
});

test('passing: the speed of a pass survives uneven frames (the mode runs before the trains in a tick)', () => {
  // Frames alternate 10 ms and 30 ms; each frame the walker (at rest) sees the
  // step the train took in the frame BEFORE, as main.js's tick orders them.
  const window = passWindow(), prev = new Map(), train = { position: { x: -240, y: -100, z: 0 }, userData: { id: 'T' } };
  const walker = { x: 0, y: -100, z: 0 };
  let lastDt = 0, single = [], est = [];
  let lastAxial = null;
  for (let i = 0; i < 400; i++) {
    const dt = i % 2 ? 0.03 : 0.01;
    train.position.x += 14.5 * lastDt;         // updateTrains ran after the mode last frame
    const st = passingState([train], window, walker, prev, dt);
    const ax = st.nearest?.axial;
    if (lastAxial !== null && ax !== undefined && i > 20) { single.push(Math.abs(ax - lastAxial) / dt); est.push(st.nearest.speed); }
    lastAxial = ax ?? null;
    lastDt = dt;
  }
  assert.ok(est.length > 300);
  assert.ok(Math.max(...single) > 14.5 * 2.5 && Math.min(...single) < 14.5 / 2.5, 'one frame alone reads 3x out');
  assert.ok(est.every(v => Math.abs(v - 14.5) / 14.5 < 0.15), `windowed ${Math.min(...est)} to ${Math.max(...est)}`);
});

// ── the platform tunnel ──────────────────────────────────────────────────────

test('platform section: sourced sizes hold together (clearance, platform width, edge gap)', () => {
  const S = platformSection(1.72);              // the deep tube lining
  assert.equal(S.Rs, PLATFORM.tunnelDiameterM / 2);
  assert.ok(Math.abs(S.edgeU - (2.629 / 2 + 0.075)) < 1e-9);
  assert.ok(S.trainClearanceM > 0.4, `train clearance ${S.trainClearanceM}`);
  assert.ok(S.platformWidthM > 2.5 && S.platformWidthM < 3.2, `platform ${S.platformWidthM}`);
  assert.ok(Math.abs(S.platformV - S.railV - 0.685) < 1e-9);
  assert.ok(S.headroomAtEdgeM > 3.5);
  // The larger bores widen the station tunnel so the running tunnel's eye fits.
  for (const r of [2.115, 2.24, 2.54]) {
    const L = platformSection(r);
    assert.ok(L.Rs >= Math.hypot(L.cu, L.cv) + r, `eye fits at lining ${r}`);
  }
  // The roundel: 973 x 798 mm boards match the construction's proportions to 1%.
  assert.ok(Math.abs(PLATFORM.roundelWidthM / PLATFORM.roundelHeightM - ROUNDEL.width / ROUNDEL.height) < 0.02);
  // Geometry along a straight 107 m slice: true-size offsets about the axis.
  const pts = Array.from({ length: 50 }, (_, i) => ({ x: 0, y: -100, z: -i * 3, s: i * 3 }));
  const slice = slicePolyline(pts, 10, 10 + PLATFORM.lengthM);
  assert.ok(Math.abs(slice[0].s - 10) < 1e-9 && Math.abs(slice.at(-1).s - 10 - PLATFORM.lengthM) < 1e-9);
  const g = buildPlatformGeometry(slice, { sigma: 1 });
  const p = g.attributes.position, ax = g.attributes.trueAxisY;
  let maxR = 0;
  for (let i = 0; i < p.count; i++) maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getY(i) - ax.getX(i)));
  assert.ok(maxR <= Math.hypot(S.cu, S.cv) + S.Rs + 1e-6, `section stays within the tunnel (${maxR})`);
});

// ── tunables and the route source ────────────────────────────────────────────

test('tunnel walk 60 m/s (10x the 6 m/s run) and Shift 200 m/s, both on the Physics panel', () => {
  const def = Object.fromEntries(PEDESTRIAN_TUNABLES.map(d => [d.key, d]));
  assert.equal(def.tunnelWalk.default, 60);
  assert.equal(def.tunnelWalk.default, 10 * def.speed.default);
  assert.equal(def.tunnelSprint.default, 200);
  assert.ok(def.tunnelSprint.max >= 200 && def.tunnelWalk.max >= 60);
});

test('route data: pinned to the bundled files; ?tfl=live keeps the live fetch', async () => {
  assert.equal(tflSource(''), 'bundled');
  assert.equal(tflSource('?skip=1&buildings=baked'), 'bundled');
  assert.equal(tflSource('?tfl=live'), 'live');
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).startsWith('/data/tfl/')) {
      const file = new URL(`../public${url}`, import.meta.url);
      return { ok: true, json: async () => JSON.parse(readFileSync(file, 'utf8')), text: async () => '' };
    }
    throw new Error('offline');
  };
  try {
    const seq = await fetchRouteSequence('victoria', { source: 'bundled' });
    assert.equal(seq.lineId, 'victoria');
    assert.ok(seq.orderedLineRoutes.length >= 2);
    assert.deepEqual(fetched, ['/data/tfl/route-sequence/victoria.json']);
    fetched.length = 0;
    // Live: TfL first, then (offline here) the bundled fallback.
    const live = await fetchRouteSequence('victoria', { source: 'live', useCache: false });
    assert.equal(live.lineId, 'victoria');
    assert.ok(fetched[0].startsWith('https://api.tfl.gov.uk/Line/victoria/'));
    assert.ok(tflStats.bundled >= 1 && tflStats.live >= 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
