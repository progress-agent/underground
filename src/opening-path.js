// opening-path.js: the opening study's descent path (sprint 02Oct26f, lane V, D-048 item 10).
//
// REFERENCE COPY. The scout copies it verbatim into its clearance check, and each
// variant builder copies it verbatim to src/opening-path.js in its worktree, so all
// five agents fly and check exactly the same curve. Pure: no scene, no DOM.
//
// Coordinates are canonical scene units (VE5): x and z in metres, y = real metres x 5.
// The altimeter reads (y - surfaceY) / 5, so 25,000 m on the altimeter is 125,000 units
// above the ground. Master is a display transform only (vertical-scale.js): the camera
// at altimeter height h sits h x Master display units above the displayed ground, and
// the far plane is 50,000 display units, so the start is capped at 40,000 / Master m.
//
// The path is a centripetal Catmull-Rom curve through four points, flown by arc length:
//   S  the start: startAltM above the crossing, backM behind it (away from the look-at)
//   A  the approach: approachAltM directly above the crossing
//   C  the crossing: where the camera passes through the ground (open ground, scout-checked)
//   E  the landing pose (underground), from the scout's shortlist
// Measured with these defaults (C 250 m behind E): above ground the camera never strays more
// than about 70 m behind C along the heading, so the scout clears a corridor 100 m long and
// 30 m wide behind C up to approachAltM. The camera looks at L (the vista's look-at) on every frame, as intro.js does today, so
// it looks almost straight down from altitude and settles on the vista's framing at E.
import * as THREE from 'three';

export const VE = 5;
export const DIVISIONS = 3000; // a multiple of 3: C sits exactly on a division (t = 2/3)

export function easeOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const k = 1 - t;
  return 1 - k * k * k;
}

/**
 * Smooth-start time warp in [0, 1]: zero velocity at t = 0, full rate after about tau.
 * Used where the camera has been seen at rest before the descent begins, so the plunge
 * launches instead of jumping. tauMs = 0 gives the plain linear clock (today's opening).
 */
export function launchWarp(tMs, totalMs, tauMs) {
  if (tMs <= 0) return 0;
  if (tMs >= totalMs) return 1;
  if (!(tauMs > 0)) return tMs / totalMs;
  const f = t => t - tauMs * (1 - Math.exp(-t / tauMs));
  return f(tMs) / f(totalMs);
}

/** Start height after the far-plane cap for this Master (metres on the altimeter). */
export function cappedStartAltM(startAltM, master = 1.1) {
  return Math.min(startAltM, 40000 / Math.max(1, master));
}

/**
 * spec: {
 *   C: {x, z}, surfaceYAtC (canonical y of the ground at C),
 *   E: {x, y, z}, L: {x, y, z}            (from the scout's vistas.json)
 *   startAltM, master = 1.1, backM = 300, approachAltM = 300,
 *   totalMs, tauMs = 600
 * }
 */
export function createOpeningPath(spec) {
  const { C, surfaceYAtC, E, L, backM = 300, approachAltM = 300, totalMs, tauMs = 600 } = spec;
  const startAltM = cappedStartAltM(spec.startAltM, spec.master ?? 1.1);
  const hx = L.x - C.x, hz = L.z - C.z, hl = Math.hypot(hx, hz) || 1;
  const ux = hx / hl, uz = hz / hl;
  const S = new THREE.Vector3(C.x - ux * backM, surfaceYAtC + startAltM * VE, C.z - uz * backM);
  const A = new THREE.Vector3(C.x, surfaceYAtC + approachAltM * VE, C.z);
  const Cv = new THREE.Vector3(C.x, surfaceYAtC, C.z);
  const Ev = new THREE.Vector3(E.x, E.y, E.z);
  const Lv = new THREE.Vector3(L.x, L.y, L.z);
  const curve = new THREE.CatmullRomCurve3([S, A, Cv, Ev], false, 'centripetal');
  curve.arcLengthDivisions = DIVISIONS;
  const lengths = curve.getLengths(DIVISIONS);
  const total = lengths[DIVISIONS];
  const uA = lengths[DIVISIONS / 3] / total;      // arc fraction at the approach point
  const uC = lengths[(2 * DIVISIONS) / 3] / total; // arc fraction at the crossing

  /** Arc fraction flown after `ms` of played time. */
  function arcAt(ms) { return easeOutCubic(launchWarp(ms, totalMs, tauMs)); }
  /** Played time (ms) at which the arc fraction first reaches u (bisection; for gates). */
  function msAtArc(u) {
    let lo = 0, hi = totalMs;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (arcAt(mid) < u) lo = mid; else hi = mid; }
    return hi;
  }
  /** Camera position at arc fraction u (0 = S, 1 = E). */
  function pointAtArc(u, out = new THREE.Vector3()) {
    return curve.getPointAt(Math.min(1, Math.max(0, u)), out);
  }
  /** Camera position after `ms` of played time; look at L. */
  function poseAt(ms, out = new THREE.Vector3()) { return pointAtArc(arcAt(ms), out); }

  return { S, A, C: Cv, E: Ev, L: Lv, startAltM, totalMs, tauMs, curve, lengthUnits: total,
    uA, uC, arcAt, msAtArc, pointAtArc, poseAt };
}
