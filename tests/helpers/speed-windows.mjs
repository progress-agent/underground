// speed-windows.mjs (sprint 21Oct26w, lane T, T-weaver): the Overground walk's speed windows, state- and distance-based.
// Not a spec and not a node test: imported by tests/pedestrian-overground.spec.js and tests/overground-speed-window.test.mjs.
//
// A frame record (from the spec's ride()) carries: clock (mode clock, s), path (network path id), s (arc position on that path, m),
// len (that path's length, m), speed (the walk's speed state), regime, cut, bridged, x, z (the camera in plan).
//
// Why: leg 2 of the Weaver failed once in five whole-group runs (`speed window 211.8` against 200 +/- 10). Its walker changes path at
// Edmonton Green, where the Enfield Town piece joins the Cheshunt trunk by a 3.54 m segment that turns 94 degrees. The shown point is 2.6 m
// to the left of each segment's own heading, and the presenter scales the step by the bend over +/- 12 m, so the first window on the new
// path read 198.4 to 207.9 m/s depending on where the frames happened to fall (frame timing), 211.8 on the real build at 69 fps.
// The windows below are chosen by state (frames within END_CLEAR_M of arc of either end of their path are not measured) and closed by
// distance (0.5 x speed metres of arc), never by the clock. The bounds the spec applies to the result are unchanged.

/** Frames nearer than this (m of arc) to either end of their path are not measured: the 3.54 m join hop, the 12 m bend probe and a frame's step (about 3 m at 69 fps), rounded up. */
export const END_CLEAR_M = 20;

const fromEnd = f => (Number.isFinite(f.len) && Number.isFinite(f.s) ? Math.min(f.s, f.len - f.s) : null);

/** A frame can be part of a window: open, at exactly `speed`, no cut, not bridged, on a path, clear of both path ends. */
const measurable = (f, speed) => f.regime === 'open' && f.speed === speed && !f.cut && !f.bridged && f.path !== null && fromEnd(f) !== null && fromEnd(f) >= END_CLEAR_M;

/**
 * Plan speed over windows of 0.5 x speed metres of arc, only where every frame is measurable and on one path. A window closes at the first
 * frame whose arc distance from the window's first frame is at least 0.5 x speed (100 m at 200 m/s, 30 m at 60). The jump guard is a step
 * whose plan distance exceeds 3 x the arc step + 1 m. Speed = summed plan distance of the camera / mode-clock span. Sorted ascending.
 */
export function speeds(r, speed) {
  const L = r.frames, out = [], need = 0.5 * speed;
  for (let i = 0; i < L.length; i++) {
    if (!measurable(L[i], speed)) continue;
    let j = i, ok = true;
    while (Math.abs(L[j].s - L[i].s) < need) {
      j++;
      if (j >= L.length) return out.sort((a, b) => a - b);
      if (L[j].path !== L[i].path || !measurable(L[j], speed)) { ok = false; break; }
    }
    if (!ok) continue;
    let d = 0, jump = false;
    for (let k = i + 1; k <= j; k++) {
      const dd = Math.hypot(L[k].x - L[k - 1].x, L[k].z - L[k - 1].z);
      if (dd > 3 * Math.abs(L[k].s - L[k - 1].s) + 1) jump = true;
      d += dd;
    }
    if (jump) continue;
    out.push(d / (L[j].clock - L[i].clock));
    i = j - 1;
  }
  return out.sort((a, b) => a - b);
}

/**
 * The rule of 7c2d4bd, kept only to explain the flake (UG_SPEED_TRACE=1) and to prove in a node test that it varies: windows of >= 0.5 s of the
 * mode clock, every frame open, at the given speed, no cut, not bridged. Each window reports its path, first arc position, the arc distance of
 * that first frame to the nearer end of its path, and its speed.
 */
export function oldRuleWindows(r, speed) {
  const L = r.frames, out = [];
  for (let i = 0; i < L.length; i++) {
    let j = i; while (j < L.length && L[j].clock - L[i].clock < 0.5) j++;
    if (j >= L.length) break;
    const seg = L.slice(i, j + 1);
    if (seg.some(f => f.regime !== 'open' || f.speed !== speed || f.cut || f.bridged)) continue;
    let d = 0, jump = false;
    for (let k = 1; k < seg.length; k++) {
      const dd = Math.hypot(seg[k].x - seg[k - 1].x, seg[k].z - seg[k - 1].z);
      if (dd > 3 * speed * (seg[k].clock - seg[k - 1].clock) + 1 || seg[k].path !== seg[k - 1].path) jump = true;
      d += dd;
    }
    if (jump) continue;
    out.push({ v: d / (seg.at(-1).clock - seg[0].clock), path: seg[0].path, s0: seg[0].s, fromEnd: fromEnd(seg[0]) });
    i = j - 1;
  }
  return out;
}
