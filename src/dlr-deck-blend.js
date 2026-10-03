// DLR deck joins (sprint 02Oct26f, Lane F; D-047 item 1, rail-canning-flyover).
//
// Where one DLR path ends beside another, on a raised deck, the two decks can
// differ by a step: the flyover that leaves the deck at Canning Town starts
// 9.3 m beside the lower track it leaves, 3.1 to 3.4 m off (reported as up to
// 1.5 m). The heights are not in
// public/data/tube-surface.json (the DLR's come from the shared profile when
// the track is drawn), so the blend runs there, on the drawn paths, right
// after buildDlrPath, at both of tube-surface-rail.js's build sites. The trains
// ride the drawn track, so they follow.
//
// For each path end whose sample is raised (viaduct or embankment), take the
// nearest point of any other DLR path within reachM in plan and its height. A
// step of a true metre figure inside [minStepM, maxStepM] (smaller is noise;
// larger is a different structure) is closed by shifting the ending
// path's samples within blendM (arc length from the end) by the step times a
// smoothstep that is 1 at the end and 0 at the blend length (30 m, or longer
// for a bigger step). The through deck is never
// moved; where both paths end at each other, the shorter one moves.
//
// Scope (fix round 1, 03Oct26): the brief asked for Canning Town only, and nine other DLR junction ends the blend
// also moved had no capture and no review, so `within` gates it to listed sites: an end is blended only when it lies
// inside one of them. tube-surface-rail.js passes the Canning Town flyover; elsewhere the DLR decks are as drawn
// on e0675d7.

export const RAISED = new Set(['viaduct', 'embankment']);
// The step to close, in true metres: the flyover that leaves the deck at Canning Town starts 3.1 to 3.4 m above the
// lower track it leaves (the verifier's capture said 1.5 m; the drawn heights say 3.1 at Master 1.1, 3.4 at Master 5).
// Steps under minStepM are the ordinary few-decimetre disagreement between two decks at a junction and are left
// alone (a first version blended every step from 5 cm: 26 places across the DLR, 107 samples). Steps over maxStepM
// (a flyover end beside a lower viaduct it crosses, 4.7 m at the 8.8 m flyover over the 4.1 m viaduct) are two
// different structures. minParallel: the end must leave the deck along it, within 35 degrees of the other path's
// direction there (a path ending across another is a crossing, not a junction). rampPerM: a blend runs at least
// blendM and at least rampPerM metres of track for each metre of step, so the climb off the deck stays under
// about 7 percent.
export const DEFAULTS = { reachM: 12, blendM: 30, minStepM: 1.0, maxStepM: 4.0, rampPerM: 15, minParallel: Math.cos(35 * Math.PI / 180) };

const smoothstep = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const arcLength = path => { let m = 0; for (let i = 1; i < path.length; i++) m += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); return m; };

/** Nearest point of `path` to (x, z) in plan: { d, y, atEnd } with its interpolated height; atEnd when within 1 m of a path end. */
function nearestOnPath(path, x, z) {
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (!best || d < best.d) best = { d, y: a.y + (b.y - a.y) * t, i, t, tx: vx, tz: vz };
  }
  if (!best) return null;
  const last = path.length - 2;
  const toStart = best.i === 0 ? best.t * Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z) : Infinity;
  const toEnd = best.i === last ? (1 - best.t) * Math.hypot(path[last + 1].x - path[last].x, path[last + 1].z - path[last].z) : Infinity;
  best.atEnd = Math.min(toStart, toEnd) < 1;
  return best;
}

/**
 * Close the deck steps where DLR paths meet on raised track. Mutates the `y`
 * of the ending path's samples. `unitsPerTrueM` is canonical y per true metre
 * (5 x the structure scale, as dlr-profile.js info() converts). `within`, when
 * given, is a list of { x, z, radiusM } sites: only an end inside one is blended
 * (omitted: every end, as the module's unit tests use it). Returns the blends
 * made: { path, end, stepM, lengthM }.
 */
export function blendDeckJoins(paths, { unitsPerTrueM, within, ...opts } = {}) {
  if (!(unitsPerTrueM > 0)) throw new RangeError('blendDeckJoins needs unitsPerTrueM');
  const { reachM, blendM: baseBlendM, minStepM, maxStepM, rampPerM, minParallel } = { ...DEFAULTS, ...opts };
  const list = paths.filter(p => p && p.length >= 2);
  const lengths = new Map(list.map(p => [p, arcLength(p)]));
  const out = [];
  list.forEach((P, pi) => {
    for (const end of ['start', 'end']) {
      const E = end === 'end' ? P.at(-1) : P[0];
      if (!RAISED.has(E.cls)) continue;
      if (within && !within.some(w => Math.hypot(E.x - w.x, E.z - w.z) <= w.radiusM)) continue;
      let best = null;
      list.forEach((Q, qi) => { if (Q === P) return; const r = nearestOnPath(Q, E.x, E.z); if (r && r.d <= reachM && (!best || r.d < best.r.d)) best = { r, Q, qi }; });
      if (!best) continue;
      const stepM = (best.r.y - E.y) / unitsPerTrueM;
      if (Math.abs(stepM) < minStepM || Math.abs(stepM) > maxStepM) continue;
      // The end must leave the deck along it: its heading into its own path against the other deck's direction there.
      const nxt = end === 'end' ? P.at(-2) : P[1], hx = nxt.x - E.x, hz = nxt.z - E.z, hl = Math.hypot(hx, hz) || 1, tl = Math.hypot(best.r.tx, best.r.tz) || 1;
      if (Math.abs((hx * best.r.tx + hz * best.r.tz) / (hl * tl)) < minParallel) continue;
      // Both ends: only the shorter path moves (the lower index when equal); the through deck never does.
      if (best.r.atEnd) {
        const lp = lengths.get(P), lq = lengths.get(best.Q);
        if (lq < lp || (lq === lp && best.qi < pi)) continue;
      }
      const shift = best.r.y - E.y;
      // Long enough for a gentle climb, never more than half the path.
      const blendM = Math.min(Math.max(baseBlendM, rampPerM * Math.abs(stepM)), 0.5 * lengths.get(P));
      let arc = 0, moved = 0;
      const n = P.length;
      for (let k = 0; k < n; k++) {
        const i = end === 'end' ? n - 1 - k : k, prev = end === 'end' ? i + 1 : i - 1;
        if (k > 0) arc += Math.hypot(P[i].x - P[prev].x, P[i].z - P[prev].z);
        if (arc >= blendM) break;
        P[i].y += shift * smoothstep(1 - arc / blendM);
        P[i].deckBlended = true;   // moved off the profile by design (tests/surface-rail.spec.js exempts exactly these)
        P[i].deckBlendStepM = stepM;
        P[i].deckBlendShiftY = shift * smoothstep(1 - arc / blendM);   // canonical y units this sample moved
        moved = arc;
      }
      out.push({ path: pi, end, stepM, lengthM: moved });
    }
  });
  return out;
}
