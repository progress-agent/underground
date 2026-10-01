// tunnel-trains.js: the walker's own line's trains inside the bore, for
// Pedestrian mode underground (sprint 30Sep26w, D-041 item 3, Lane P).
//
// Jordan (D-041 item 3): trains pass THROUGH the walker: "lit windows
// streaming past, a rush of air, a rumble and a brief shake; the walker is
// never stopped". Rejected at the grill: boarding (trains would set the pace)
// and being blocked behind trains (makes the 10x speed pointless).
//
// WHY THIS EXISTS: inside the bore the camera sees only INTERIOR_LAYER (7)
// (tube-interior.js isolates it so other lines' tubes cannot hang inside the
// lining), which also hid every train. This module adds layer 7 to the
// walker's own line's train meshes (the per-line InstancedMesh batches of
// trains.js, and each train's own near meshes when batching is off) while the
// walker is in the tunnel, and takes it away again on hide. Nothing else
// changes: a camera on the default layer mask sees exactly what it saw, the
// trains keep their true size (trains.js composes the true-proportion matrix)
// and their timetable (trainStateAt, a pure function of the simulation clock).
//
// PASSING: update() measures every train of the line against the walker's own
// bore, given as the tube-interior window polyline (canonical points with a
// signed real-metre arc `s`, 0 at the walker): a train counts when its centre
// projects onto that polyline within BORE_TOLERANCE_M laterally (the twin bore
// is 2 x halfSpacing away). Its signed axial distance, the rate that distance
// changes (the speed of the pass: the train's speed relative to the walker)
// and whether the walker is inside its length give the air rush, the rumble
// and the shake. Pure function of the train and walker positions, so it is
// deterministic.
//
// Fix round 2 (verifier): all three follow the MOTION of the pass, never mere
// presence. A train dwelling at a platform round a walker at rest passes
// nothing: no rush, no rumble, no shake (before, it rumbled at full and shook
// the view for the whole dwell, 25 to 30 s of timetable, while the arrival
// card was open).
// And the shake is brief whatever the speeds (stepShake): at most SHAKE.holdS
// of full shake per pass, then it dies away, even when a slow train takes
// seven seconds to pass a walker standing still.
//
// LAMPS: a train seen head-on is a dark disc in a dark bore (its lit windows
// are on its sides), so while the walker is inside, the nearest few of the
// line's trains carry a pair of white head lamps at the leading end and red
// tail lamps at the other, as the real stock does. Each pair is a small mesh
// parented to the train itself, so it follows the train's own pose (and its
// true-proportion matrix) when the frame is drawn, never a frame behind; one
// material per colour (D-015: no per-instance colour), on the default and
// interior layers like the lining, and only while the walker is in the bore.
//
// trains.js is read only through its train objects (userData.lineId, the
// batch in userData.batch, userData.nearGroup, position, quaternion); its
// exports are unchanged.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TRAIN_HALF_LENGTH_M = (96 + 2 * 3.8) / 2;  // trains.js CAPSULE_LENGTH 96 + two caps of CAPSULE_RADIUS 3.8 (caps are not scaled along z)
export const BORE_TOLERANCE_M = 2.5;
export const RUSH_REACH_M = 60;          // the air ahead of a train is felt this far out
// A pass at a running train's speed or faster is felt in full: trains.js runs
// every line at cruiseMps 12 (the Victoria at 14.5) of timetable, shown x the
// time scale (8 by default, 0.5 to 30 on its slider), so a train running past
// a walker at rest rumbles and shakes fully, and one standing still does not.
export const PASS_FULL_MPS = 12;
export const PASS_MIN_MPS = 2;           // slower than this nothing is passing (a train dwelling round a walker at rest)
// Faster than anything that moves in the bore, with room for an uneven frame
// (the walker's Shift maximum is 400; a Victoria train at the time scale's
// maximum of 30 shows 435): a jump past it is the window moving (a change of
// bore or path, a test placing the walker), not a train.
export const MAX_PASS_MPS = 2000;
// The speed of a pass is the rate over this much time, not one frame's: the
// mode runs before updateTrains in a tick, so one frame's train step comes
// from the frame before's dt, and headless or dropped frames made a single
// frame's rate read 4 to 26 m/s for a train running at 14.5. Over a window
// the frame lengths telescope and only the two ends can differ.
export const SPEED_WINDOW_S = 0.15;
// The view shake of a pass (Jordan, D-041 item 3: "a brief shake"): its peak,
// how long it is held at most per pass, and how fast it dies away.
export const SHAKE = Object.freeze({ rad: 0.012, holdS: 1.0, decayS: 0.25 });
// Lamps on the train's nose (real metres in its own frame: x across, y up, z along).
export const LAMP = Object.freeze({ radiusM: 0.09, sideM: 0.55, belowAxisM: 0.7, alongM: 51.3, rangeM: 700, max: 8 });

/** Nearest point of a polyline [{x,y,z,s}] to p, in real metres (y / VE). */
export function projectOnPolyline(points, p, VE = 5) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const vx = b.x - a.x, vy = (b.y - a.y) / VE, vz = b.z - a.z;
    const len2 = vx * vx + vy * vy + vz * vz;
    if (!(len2 > 0)) continue;
    const px = p.x - a.x, py = (p.y - a.y) / VE, pz = p.z - a.z;
    const u = Math.max(0, Math.min(1, (px * vx + py * vy + pz * vz) / len2));
    const dx = px - vx * u, dy = py - vy * u, dz = pz - vz * u;
    const lateral = Math.hypot(dx, dy, dz);
    if (!best || lateral < best.lateral) best = { lateral, s: a.s + (b.s - a.s) * u, segment: i, u };
  }
  return best;
}

/**
 * The passing state of one line's trains against the walker's bore window.
 * @param {Array<{position:{x,y,z}, userData:{id?:string}}>} trains
 * @param {Array<{x,y,z,s}>} window  walker's bore polyline with an arc s
 * @param {{x,y,z}} walker  the walker's position (its own projection is arc 0)
 * @param {Map} prev   train -> { hist: [{axial, dt}], speed } (the speed memory); updated in place
 * @returns {{ nearest: null | {id, axial, lateral, closing, speed, gap, inside}, inside: boolean,
 *   insideSpeed: number, rush: number, rumble: number }}  insideSpeed: the fastest pass the walker is inside (m/s)
 */
export function passingState(trains, window, walker, prev, dt, { VE = 5, halfLength = TRAIN_HALF_LENGTH_M,
  tolerance = BORE_TOLERANCE_M, reach = RUSH_REACH_M } = {}) {
  let nearest = null, rush = 0, rumble = 0, inside = false, insideSpeed = 0;
  const seen = new Set();
  if (!window || window.length < 2 || !walker) { prev?.clear?.(); return { nearest, inside, insideSpeed, rush, rumble }; }
  const lo = window[0].s, hi = window[window.length - 1].s;
  const me = projectOnPolyline(window, walker, VE);
  const s0 = me ? me.s : 0;
  const far = Math.max(Math.abs(lo), Math.abs(hi)) + halfLength + 50;
  for (const t of trains) {
    const p = t.position;
    if (Math.abs(p.x - walker.x) > far || Math.abs(p.z - walker.z) > far) continue;
    const hit = projectOnPolyline(window, p, VE);
    if (!hit || hit.lateral > tolerance) continue;
    // A train whose centre projects onto a window end may be beyond it.
    if ((hit.s <= lo + 1e-6 || hit.s >= hi - 1e-6) && hit.lateral > 0.5) continue;
    seen.add(t);
    const axial = hit.s - s0;
    const rec = prev?.get(t) ?? { hist: [], speed: 0 };
    const last = rec.hist.at(-1);
    const closing = last && dt > 0 ? (Math.abs(last.axial) - Math.abs(axial)) / dt : 0;
    // The speed of the pass: how fast the train's arc moves relative to the
    // walker (the signed arc's rate, so it holds its value as the train's centre
    // goes by, where the closing rate flips), over SPEED_WINDOW_S. A jump no
    // train or walker can make is the window moving (a change of bore): start
    // the history again and keep the last speed until it has a step.
    if (last && dt > 0 && Math.abs(axial - last.axial) / dt > MAX_PASS_MPS) rec.hist = [];
    rec.hist.push({ axial, dt: Math.max(0, dt) });
    let span = 0, i = rec.hist.length - 1;
    while (i > 0 && span < SPEED_WINDOW_S) { span += rec.hist[i].dt; i--; }
    if (i > 0) rec.hist.splice(0, i);
    if (span > 0) rec.speed = Math.abs(axial - rec.hist[0].axial) / span;
    const speed = rec.speed;
    prev?.set(t, rec);
    const gap = Math.max(0, Math.abs(axial) - halfLength);     // walker to the nearer end of the train
    const isInside = gap === 0;
    inside = inside || isInside;
    if (isInside) insideSpeed = Math.max(insideSpeed, speed);
    // Nothing passes when nothing moves: the floor of the old curve (0.35) now
    // comes in with the speed of the pass, full from a running train's speed.
    const moveK = Math.min(1, speed / PASS_FULL_MPS);
    const speedK = Math.min(1.5, 0.35 * moveK + speed / 60);
    rush = Math.max(rush, Math.exp(-gap / (reach / 3)) * speedK);
    rumble = Math.max(rumble, Math.exp(-gap / reach) * (isInside ? 1 : 0.7) * moveK);
    if (!nearest || gap < nearest.gap) nearest = { id: t.userData?.id ?? null, axial, lateral: hit.lateral, closing, speed, gap, inside: isInside };
  }
  if (prev) for (const k of [...prev.keys()]) if (!seen.has(k)) prev.delete(k);
  return { nearest, inside, insideSpeed, rush: Math.min(1, rush), rumble: Math.min(1, rumble) };
}

/**
 * One frame of the view shake of a pass (pure; the caller keeps the state).
 * A pass that moves shakes the view in proportion to its speed (full from a
 * running train's), for at most SHAKE.holdS, then the shake dies away with
 * SHAKE.decayS; a train standing round a walker at rest does not shake it at
 * all. The approach of a fast train (outside it) adds a little from the rush.
 * A pass begins again when the walker starts moving inside a standing train,
 * or when the train round a walker pulls away: each is brief.
 * @param {{ shake: number, passT: number|null }} state  passT: seconds since this pass began moving
 * @param {null | { inside: boolean, insideSpeed?: number, rush?: number }} pass  passingState's result (null: not in a bore)
 * @returns {{ shake: number, passT: number|null }}
 */
export function stepShake(state, pass, dt, { rad = SHAKE.rad, holdS = SHAKE.holdS, decayS = SHAKE.decayS } = {}) {
  const inside = !!pass?.inside;
  const speed = inside ? (pass.insideSpeed ?? 0) : 0;
  const moving = inside && speed > PASS_MIN_MPS;
  const passT = moving ? (state?.passT == null ? 0 : state.passT + dt) : null;
  let goal = 0;
  if (moving) goal = passT < holdS ? rad * Math.min(1, speed / PASS_FULL_MPS) : 0;
  else if (!inside) goal = rad * 0.5 * Math.max(0, (pass?.rush ?? 0) - 0.35);
  let shake = Math.max(goal, (state?.shake ?? 0) * Math.exp(-dt / decayS));
  if (shake < 1e-5) shake = 0;
  return { shake, passT };
}

/**
 * @param {object} o
 * @param {{ allTrains: THREE.Object3D[] } | (() => object)} o.trainSystem  trains.js train system (or a getter)
 * @param {number} o.layer  the interior camera layer (tube-interior.js INTERIOR_LAYER)
 */
export function createTunnelTrains({ trainSystem = null, layer = 7 } = {}) {
  const system = () => (typeof trainSystem === 'function' ? trainSystem() : trainSystem);
  // Head (white) and tail (red) lamps: a pool of per-train lamp groups.
  let shared = null;
  const pool = [];            // { group, train }
  function lampShared() {
    if (shared) return shared;
    const one = (x) => new THREE.SphereGeometry(LAMP.radiusM, 10, 6).translate(x, 0, 0);
    const pair = mergeGeometries([one(-LAMP.sideM), one(LAMP.sideM)]);
    shared = {
      pair,
      head: new THREE.MeshBasicMaterial({ color: 0xf2efe6, toneMapped: false, fog: false }),
      tail: new THREE.MeshBasicMaterial({ color: 0xd01010, toneMapped: false, fog: false }),
    };
    return shared;
  }
  function makeLamps() {
    const S = lampShared();
    const group = new THREE.Group();
    group.name = 'tunnel-train-lamps';
    for (const [mat, z, name] of [[S.head, LAMP.alongM, 'head'], [S.tail, -LAMP.alongM, 'tail']]) {
      const m = new THREE.Mesh(S.pair, mat);
      m.name = `tunnel-train-${name}lamps`;
      m.position.set(0, -LAMP.belowAxisM, z);
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = false;
      m.layers.enable(layer);   // and the default layer: near a portal the camera is not isolated
      group.add(m);
    }
    return { group, train: null };
  }
  function updateLamps(trainsNear, walker) {
    if (!globalThis.document) return;
    const near = trainsNear
      .map(t => ({ t, d: walker ? Math.hypot(t.position.x - walker.x, t.position.z - walker.z) : 0 }))
      .filter(x => x.d <= LAMP.rangeM)
      .sort((a, b) => a.d - b.d)
      .slice(0, LAMP.max)
      .map(x => x.t);
    const want = new Set(near);
    for (const item of pool) {
      if (item.train && !want.has(item.train)) { item.train.remove(item.group); item.train = null; }
    }
    const held = new Set(pool.filter(i => i.train).map(i => i.train));
    for (const t of near) {
      if (held.has(t)) continue;
      let item = pool.find(i => !i.train);
      if (!item) { item = makeLamps(); pool.push(item); }
      // The train's matrix scales its section by sectionScale; undo it so the
      // lamps are placed and sized in real metres in the train's own frame.
      const k = t.userData.sectionScale ?? 1;
      item.group.scale.set(1 / k, 1 / k, 1);
      t.add(item.group);
      item.train = t;
    }
  }
  function hideLamps() { for (const item of pool) { if (item.train) { item.train.remove(item.group); item.train = null; } } }
  const enabled = new Set();    // meshes we added `layer` to
  let lineId = null;
  const prev = new Map();
  let last = { nearest: null, inside: false, insideSpeed: 0, rush: 0, rumble: 0 };
  let passes = 0, wasInside = false;

  const lineTrains = (id) => (system()?.allTrains || []).filter(t => t.userData?.lineId === id);

  function meshesOf(id) {
    const out = [];
    const batches = new Set();
    for (const t of lineTrains(id)) {
      const b = t.userData.batch;
      if (b && !b.disposed) batches.add(b);
      t.userData.nearGroup?.traverse(o => { if (o.isMesh) out.push(o); });
    }
    for (const b of batches) { if (b.body) out.push(b.body); if (b.win) out.push(b.win); }
    return out;
  }

  function release() {
    for (const m of enabled) m.layers.disable(layer);
    enabled.clear();
  }

  return {
    /** Draw `id`'s trains on the interior layer (re-applied each frame: batches are rebuilt on a resnap). */
    show(id) {
      if (id !== lineId) { release(); hideLamps(); prev.clear(); lineId = id; }
      const now = new Set(meshesOf(id));
      for (const m of enabled) if (!now.has(m)) { m.layers.disable(layer); enabled.delete(m); }
      for (const m of now) {
        if (enabled.has(m)) continue;
        // Only a mesh we lifted is ever lowered again.
        if (m.layers.isEnabled(layer)) continue;
        m.layers.enable(layer);
        enabled.add(m);
      }
      return enabled.size;
    },
    hide() {
      release();
      hideLamps();
      lineId = null;
      prev.clear();
      last = { nearest: null, inside: false, insideSpeed: 0, rush: 0, rumble: 0 };
      wasInside = false;
    },
    /** Passing state against the walker's bore window this frame. */
    update(window, walker, dt, { VE = 5 } = {}) {
      if (!lineId) return last;
      const all = lineTrains(lineId);
      last = passingState(all, window, walker, prev, dt, { VE });
      updateLamps(all, walker);
      if (last.inside && !wasInside) passes++;
      wasInside = last.inside;
      return last;
    },
    get lineId() { return lineId; },
    get state() { return last; },
    debug() {
      return { lineId, meshes: enabled.size, passes, ...last, nearest: last.nearest ? { ...last.nearest } : null,
        lamps: pool.filter(i => i.train).length };
    },
  };
}
