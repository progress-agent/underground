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
// changes (the closing speed) and whether the walker is inside its length give
// the air rush, the rumble and the shake. Pure function of the train and
// walker positions, so it is deterministic.
//
// LAMPS: a train seen head-on is a dark disc in a dark bore (its lit windows
// are on its sides), so while the walker is inside, each of the line's trains
// near them carries a pair of white head lamps at its leading end and red
// tail lamps at the other, as the real stock does. Two InstancedMeshes, one
// per colour (D-015: no per-instance colour), shown only while the walker is
// in the bore (on the default and interior layers, like the lining),
// translation-only instances with the true-proportion 'local' patch (true
// size at every Master).
//
// trains.js is read only through its train objects (userData.lineId, the
// batch in userData.batch, userData.nearGroup, position, quaternion); its
// exports are unchanged.

import * as THREE from 'three';
import { patchTrueProportionMaterial, trueProportionUniform } from './true-proportion.js';

export const TRAIN_HALF_LENGTH_M = (96 + 2 * 3.8) / 2;  // trains.js CAPSULE_LENGTH 96 + two caps of CAPSULE_RADIUS 3.8 (caps are not scaled along z)
export const BORE_TOLERANCE_M = 2.5;
export const RUSH_REACH_M = 60;          // the air ahead of a train is felt this far out
export const LAMP = Object.freeze({ radiusM: 0.09, sideM: 0.55, belowAxisM: 0.7, rangeM: 700, max: 64 });

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
 * @param {Map} prev   train -> last signed arc (closing speed memory); updated in place
 * @returns {{ nearest: null | {id, axial, lateral, closing}, inside: boolean, rush: number, rumble: number }}
 */
export function passingState(trains, window, walker, prev, dt, { VE = 5, halfLength = TRAIN_HALF_LENGTH_M,
  tolerance = BORE_TOLERANCE_M, reach = RUSH_REACH_M } = {}) {
  let nearest = null, rush = 0, rumble = 0, inside = false;
  const seen = new Set();
  if (!window || window.length < 2 || !walker) { prev?.clear?.(); return { nearest, inside, rush, rumble }; }
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
    const before = prev?.get(t);
    const closing = before !== undefined && dt > 0 ? (Math.abs(before) - Math.abs(axial)) / dt : 0;
    prev?.set(t, axial);
    const gap = Math.max(0, Math.abs(axial) - halfLength);     // walker to the nearer end of the train
    const isInside = gap === 0;
    inside = inside || isInside;
    const speedK = Math.min(1.5, 0.35 + Math.abs(closing) / 60);
    rush = Math.max(rush, Math.exp(-gap / (reach / 3)) * speedK);
    rumble = Math.max(rumble, Math.exp(-gap / reach) * (isInside ? 1 : 0.7));
    if (!nearest || gap < nearest.gap) nearest = { id: t.userData?.id ?? null, axial, lateral: hit.lateral, closing, gap, inside: isInside };
  }
  if (prev) for (const k of [...prev.keys()]) if (!seen.has(k)) prev.delete(k);
  return { nearest, inside, rush: Math.min(1, rush), rumble: Math.min(1, rumble) };
}

/**
 * @param {object} o
 * @param {{ allTrains: THREE.Object3D[] } | (() => object)} o.trainSystem  trains.js train system (or a getter)
 * @param {number} o.layer  the interior camera layer (tube-interior.js INTERIOR_LAYER)
 */
export function createTunnelTrains({ trainSystem = null, layer = 7 } = {}) {
  const system = () => (typeof trainSystem === 'function' ? trainSystem() : trainSystem);
  // Head (white) and tail (red) lamps: separate meshes, one colour each.
  let lamps = null;
  function ensureLamps() {
    if (lamps) return lamps;
    const scene = system()?.scene;
    if (!scene || !globalThis.document) return null;
    const geo = new THREE.SphereGeometry(LAMP.radiusM, 10, 6);
    const make = (hex, name) => {
      const mat = patchTrueProportionMaterial(new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, fog: false }), { mode: 'local' });
      const m = new THREE.InstancedMesh(geo, mat, LAMP.max * 2);
      m.name = name;
      m.count = 0;
      m.frustumCulled = false;
      m.layers.enable(layer);   // and the default layer: near a portal the camera is not isolated
      m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    lamps = { head: make(0xf2efe6, 'tunnel-train-headlamps'), tail: make(0xd01010, 'tunnel-train-taillamps') };
    return lamps;
  }
  const _f = new THREE.Vector3(), _side = new THREE.Vector3(), _m = new THREE.Matrix4();
  function updateLamps(trainsNear, walker) {
    const L = ensureLamps();
    if (!L) return;
    let n = 0;
    const k = trueProportionUniform.value;   // canonical y per real metre
    for (const t of trainsNear) {
      if (n >= LAMP.max) break;
      const p = t.position;
      if (walker && Math.hypot(p.x - walker.x, p.z - walker.z) > LAMP.rangeM) continue;
      _f.set(0, 0, 1).applyQuaternion(t.quaternion); _f.y = 0;
      if (_f.lengthSq() < 1e-9) continue;
      _f.normalize();
      _side.set(-_f.z, 0, _f.x);
      for (const [mesh, sign] of [[L.head, 1], [L.tail, -1]]) {
        for (const s of [-1, 1]) {
          const i = 2 * n + (s > 0 ? 1 : 0);
          _m.makeTranslation(p.x + _f.x * sign * (TRAIN_HALF_LENGTH_M - 0.05) + _side.x * s * LAMP.sideM,
            p.y - LAMP.belowAxisM * k,
            p.z + _f.z * sign * (TRAIN_HALF_LENGTH_M - 0.05) + _side.z * s * LAMP.sideM);
          mesh.setMatrixAt(i, _m);
        }
      }
      n++;
    }
    for (const mesh of [L.head, L.tail]) { mesh.count = 2 * n; mesh.instanceMatrix.needsUpdate = true; mesh.visible = n > 0; }
  }
  function hideLamps() { if (lamps) { lamps.head.visible = false; lamps.tail.visible = false; lamps.head.count = lamps.tail.count = 0; } }
  const enabled = new Set();    // meshes we added `layer` to
  let lineId = null;
  const prev = new Map();
  let last = { nearest: null, inside: false, rush: 0, rumble: 0 };
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
      last = { nearest: null, inside: false, rush: 0, rumble: 0 };
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
        lamps: lamps ? lamps.head.count / 2 : 0 };
    },
  };
}
