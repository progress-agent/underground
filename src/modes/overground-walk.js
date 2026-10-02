// overground-walk.js: where the Pedestrian walker is shown on the London Overground, and the
// Overground trains passing through it (sprint 02Oct26f, lane O, D-048 item 5). Pure: no
// scene, no DOM; tests/overground-walk.test.mjs pins it in node.
//
// The Tube and DLR walk on station chords and are SHOWN on the drawn track through Lane T's
// mapping (open-air-map.js). An Overground network path IS the drawn track (overground-network.js
// builds it from `overgroundGroup.userData.linePaths`), so there is nothing to map: the walker is
// shown directly on the path's own vertices, and the 3-D arc `s` of the path is the walker's arc, so
// 60 and 200 m/s are track speeds (measured along the drawn track; a grade of 4 % costs 0.1 %).
//
//   * x and z are interpolated linearly between the vertices around s; y is LIVE: each vertex's record
//     (path.og, liveY) reads the drawn sample's own height, so the view follows Master with no rebuild
//     and the cache key carries no ratio (the DLR's mapper depends on it; this must not);
//   * the walker rides OG_LANE_M to the left of its direction of travel, the trains' own lane formula
//     (overground-trains.js: x += dir.z * 2.6, z -= dir.x * 2.6);
//   * open flags per vertex from the drawn class (tunnel: bore; everything else open), an open run running from its
//     first open vertex to its last; a tunnel run
//     shorter than OG_BRIDGE_M between two open runs is an overbridge and is bridged (shown open, y
//     straight across its ends: no flicker of cuts), an open run shorter than that is dropped;
//   * connectors (kind 'gap') are the bore; stubs inherit the state of the end they leave.
//
// Deterministic: a pure function of its inputs (nothing random, no clock).
import { liveY } from './overground-network.js';
import { passingState } from '../tunnel-trains.js';

export const OG_LANE_M = 2.6;       // the trains' lane offset (overground-trains.js)
export const OG_BRIDGE_M = 60;      // a tunnel run shorter than this between open runs is bridged, an open run shorter is dropped
export const OG_HEADING_PROBE_M = 200;
export const OG_PASS_REACH_M = 1200;   // Overground trains within this (plan) of the walker are tested
export const OG_PASS_WINDOW_M = 260;   // the walker's run, either way, that a pass is measured on
const WINDOW_STEP_M = 5;

/**
 * The presenter of one Overground network path, with the interface of open-air-map.js
 * createOpenAirMap's result (presentAt, trackToChord, openIntervals, drawnHeading, branchHeading,
 * intervalAt, refused, unmapped).
 * @param {object} o
 * @param {object} o.path  a network path built from an `og:` branch (path.og: one record per vertex)
 */
export function createOvergroundAirMap({ path } = {}) {
  const V = path.vertices, vs = path.vertexS, recs = path.og, n = V.length;
  const L = path.length;
  const clampS = (s) => (s < 0 ? 0 : s > L ? L : s);

  const sg = { i: 0, t: 0 };
  /** The segment i (vs[i] <= s <= vs[i+1], the last one at the end) and the fraction along it (one shared record). */
  function segmentOf(s) {
    s = clampS(s);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (vs[m] <= s) lo = m; else hi = m; }
    // Step over zero-length segments (a repeated vertex): the next real one carries on.
    while (lo < n - 2 && !(vs[lo + 1] - vs[lo] > 0)) lo++;
    const span = vs[lo + 1] - vs[lo];
    sg.i = lo; sg.t = span > 0 ? Math.min(1, Math.max(0, (s - vs[lo]) / span)) : 0;
    return sg;
  }

  /** The plan heading of segment i (towards +s), unit. */
  function segHeading(i, out) {
    for (let k = i; k < n - 1; k++) {
      const dx = V[k + 1].x - V[k].x, dz = V[k + 1].z - V[k].z, len = Math.hypot(dx, dz);
      if (len > 1e-6) { out.hx = dx / len; out.hz = dz / len; return out; }
    }
    for (let k = i - 1; k >= 0; k--) {
      const dx = V[k + 1].x - V[k].x, dz = V[k + 1].z - V[k].z, len = Math.hypot(dx, dz);
      if (len > 1e-6) { out.hx = dx / len; out.hz = dz / len; return out; }
    }
    out.hx = 0; out.hz = 0; return out;
  }

  // ── the open stretches ──────────────────────────────────────────────────
  let intervals = null;
  const filled = [];   // bridged tunnel runs { a, b (the run), sA, sB (the open vertices either side: the height is straight between them) }
  function openIntervals() {
    if (intervals) return intervals;
    // A run is open from its first open vertex to its last: the drawn track dips into a tunnel over the first samples
    // of it (surface-rail.js smooths the tunnel samples into the ground), so the half-segment toward a tunnel vertex
    // is already below the ground; the cut is made at the open vertex, where the track is still on the surface.
    const runs = [];
    let first = -1;
    for (let i = 0; i <= n; i++) {
      const f = i < n && recs[i].open;
      if (f && first < 0) first = i;
      if (!f && first >= 0) {
        // a/b: the run as shown (first to last open vertex); ma/mb: where it would end half-way to the neighbouring
        // tunnel vertex, which is what "a tunnel under 60 m" and "an open run under 60 m" are measured on.
        runs.push({ a: vs[first], b: vs[i - 1], ma: first === 0 ? 0 : (vs[first - 1] + vs[first]) / 2, mb: i < n ? (vs[i - 1] + vs[i]) / 2 : L, vFirst: vs[first], vLast: vs[i - 1] });
        first = -1;
      }
    }
    const merged = [];
    filled.length = 0;
    for (const run of runs) {
      const last = merged.at(-1);
      if (last && run.ma - last.mb < OG_BRIDGE_M) {
        if (run.a > last.b + 1e-6) filled.push({ a: last.b, b: run.a, sA: last.vLast, sB: run.vFirst });
        last.b = Math.max(last.b, run.b); last.mb = run.mb; last.vLast = run.vLast;
      } else merged.push({ ...run });
    }
    intervals = merged.filter(r => r.mb - r.ma >= OG_BRIDGE_M).map(r => [r.a, r.b]);
    for (let i = filled.length - 1; i >= 0; i--) if (!intervals.some(([a, b]) => filled[i].a >= a - 1e-6 && filled[i].b <= b + 1e-6)) filled.splice(i, 1);
    return intervals;
  }

  function intervalAt(s) {
    for (const iv of openIntervals()) if (s >= iv[0] - 1e-6 && s <= iv[1] + 1e-6) return iv;
    return null;
  }

  // ── where the walker is shown ───────────────────────────────────────────
  const hd = { hx: 0, hz: 0 };
  function raw(s, out) {
    const seg = segmentOf(s), i = seg.i, t = seg.t;
    const a = V[i], b = V[i + 1];
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    const ya = liveY(recs[i]), yb = liveY(recs[i + 1]);
    out.y = ya + (yb - ya) * t;
    segHeading(i, hd); out.hx = hd.hx; out.hz = hd.hz;
    return out;
  }
  const ea = {}, eb = {};
  /**
   * The point shown for arc s: { x, y, z, hx, hz (the +s heading), open, mapped, extra, lane, ts, run, bridged }.
   * laneSign: the travel sense whose lane it is (+1 / -1; 0 the track's centre).
   */
  function presentAt(s, laneSign = 0, out = {}) {
    if (intervals === null) openIntervals();
    raw(s, out);
    if (laneSign) { const k = laneSign > 0 ? 1 : -1; out.x += out.hz * k * OG_LANE_M; out.z -= out.hx * k * OG_LANE_M; }
    out.lane = laneSign ? OG_LANE_M : 0;
    out.open = !!intervalAt(s);
    out.mapped = true; out.extra = 0; out.ts = clampS(s); out.run = null; out.bridged = false;
    if (out.open && filled.length) {
      const gap = filled.find(g => s > g.sA && s < g.sB);
      if (gap) {
        // Across a bridged tunnel run (an overbridge): the plan point as sampled, the rail head straight across
        // between the open vertices either side of it, never down the dip the drawn tunnel makes.
        const k = (s - gap.sA) / (gap.sB - gap.sA);
        raw(gap.sA, ea); raw(gap.sB, eb);
        out.y = ea.y + (eb.y - ea.y) * k;
        out.bridged = s > gap.a && s < gap.b;
      }
    }
    return out;
  }

  /** The chord arc reached by moving d metres along the track: the path's own arc is the drawn track's, so s + d. */
  function trackToChord(s, dir, d) {
    return clampS(s + (dir >= 0 ? 1 : -1) * Math.max(0, d));
  }

  const ha = {}, hb = {};
  /** The drawn track's heading ahead of s, from the point shown to the point probeM along it (never more than half the open stretch, nor under 10 m). */
  function drawnHeading(s, dir, probeM = OG_HEADING_PROBE_M) {
    const sign = dir >= 0 ? 1 : -1;
    const iv = intervalAt(s);
    const span = iv ? iv[1] - iv[0] : Infinity;
    const probe = Math.max(10, Math.min(probeM, probeM > OG_HEADING_PROBE_M ? span : span / 2));
    let s0 = clampS(s), s1 = clampS(s + sign * probe);
    if (Math.abs(s1 - s0) < 1) { s1 = s0; s0 = clampS(s0 - sign * probe); }   // at the end: read it from behind, still in the sense of travel
    raw(s0, ha); raw(s1, hb);
    const x = hb.x - ha.x, z = hb.z - ha.z, len = Math.hypot(x, z);
    if (!(len > 1e-6)) { segHeading(segmentOf(s).i, hd); return { x: hd.hx * sign, z: hd.hz * sign }; }
    return { x: x / len, z: z / len };
  }

  /** The heading a branch is chosen on: the drawn heading averaged with the way to the next station as shown. */
  const bq = {}, bn = {};
  function branchHeading(s, dir) {
    const a = drawnHeading(s, dir);
    const sign = dir >= 0 ? 1 : -1;
    const S = path.stations || [];
    let next = null;
    if (sign > 0) { for (const st of S) if (st.s > s + 1) { next = st; break; } }
    else { for (let i = S.length - 1; i >= 0; i--) if (S[i].s < s - 1) { next = S[i]; break; } }
    if (!next) return a;
    raw(s, bq); raw(next.s, bn);
    let x = bn.x - bq.x, z = bn.z - bq.z;
    const l = Math.hypot(x, z);
    if (!(l > 1)) return a;
    x = a.x + x / l; z = a.z + z / l;
    const len = Math.hypot(x, z);
    return len > 1e-6 ? { x: x / len, z: z / len } : a;
  }

  // The stretches between stations that are connectors (kind 'gap'): the bore, by rule.
  const refused = [], unmapped = [];
  {
    let from = null;
    for (let i = 0; i < n; i++) {
      const gap = recs[i].kind === 'gap';
      if (gap && from === null) from = i;
      if (!gap && from !== null) { unmapped.push({ from: '', to: '', s0: vs[Math.max(0, from - 1)], s1: vs[i] }); from = null; }
    }
  }

  return { lineId: path.lineId, path, runs: [], stats: { og: 1, vertices: n, gaps: unmapped.length }, ratio: 1,
    presentAt, trackToChord, openIntervals, drawnHeading, branchHeading, intervalAt, refused, unmapped, og: true };
}

// ── Overground trains through the walker ───────────────────────────────────

/**
 * The inputs of one Overground pass: the walker's window (its own track, in its lane, +/- OG_PASS_WINDOW_M of arc)
 * and the proxies of the line's trains near it, each at its own lane position. The train formula is
 * overground-trains.js update(): dir by phase against run, arc margin + phase (or the way back), the
 * lane offset 2.6 m to the left of its direction of travel.
 * @param {object} map     the path's presenter (createOvergroundAirMap)
 * @param {number} s       the walker's arc
 * @param {number} laneSign
 * @param {{ x, y, z }} walker  the point shown
 * @param {object|null} fleet  the line's fleet group (userData.trains: { path, cum, margin, run, phase, cars })
 * @param {Map} proxies   train -> { position, userData } (kept by the caller, pruned here)
 * @param {{ carStep: number, reachM?: number, windowM?: number }} o
 * @returns {{ win: Array, near: Array, halfLength: number }}
 */
export function overgroundPassInputs(map, s, laneSign, walker, fleet, proxies, { carStep, reachM = OG_PASS_REACH_M, windowM = OG_PASS_WINDOW_M } = {}) {
  const L = map.path.length;
  const lo = Math.max(0, s - windowM), hi = Math.min(L, s + windowM);
  const win = [];
  const q = {};
  for (let t = lo; t <= hi + 1e-9; t += WINDOW_STEP_M) {
    const tt = Math.min(t, hi);
    map.presentAt(tt, laneSign, q);
    win.push({ x: q.x, y: q.y, z: q.z, s: tt - s });
    if (tt === hi) break;
  }
  const near = [];
  const seen = new Set();
  let halfLength = 0;
  const trains = fleet?.userData?.trains || [];
  for (let idx = 0; idx < trains.length; idx++) {
    const train = trains[idx];
    const dir = train.phase < train.run ? 1 : -1;
    const ts = train.margin + (dir === 1 ? train.phase : 2 * train.run - train.phase);
    const cum = train.cum, P = train.path;
    let a = 0, b = cum.length - 1;
    while (a < b - 1) { const m = (a + b) >> 1; if (cum[m] <= ts) a = m; else b = m; }
    const pa = P[a], pb = P[b], span = cum[b] - cum[a] || 1, u = Math.min(1, Math.max(0, (ts - cum[a]) / span));
    const x = pa.x + (pb.x - pa.x) * u, z = pa.z + (pb.z - pa.z) * u;
    if (Math.hypot(x - walker.x, z - walker.z) > reachM) continue;
    const dx = (pb.x - pa.x) * dir, dz = (pb.z - pa.z) * dir, h = Math.hypot(dx, dz) || 1;
    let px = proxies.get(train);
    if (!px) { px = { position: { x: 0, y: 0, z: 0 }, userData: { id: `${fleet.name ?? 'overground'}:${idx}` } }; proxies.set(train, px); }
    px.position.x = x + dz / h * OG_LANE_M;
    px.position.y = pa.y + (pb.y - pa.y) * u;
    px.position.z = z - dx / h * OG_LANE_M;
    near.push(px); seen.add(train);
    halfLength = Math.max(halfLength, train.cars * carStep / 2);
  }
  for (const k of [...proxies.keys()]) if (!seen.has(k)) proxies.delete(k);
  return { win, near, halfLength: halfLength || 50 };
}

/**
 * The passing state of the walker's line's trains against the walker on the Overground:
 * { nearest, inside, insideSpeed, rush, rumble } (tunnel-trains.js passingState), as for a surface Tube train.
 * Only a train in the walker's own lane (2.5 m tolerance; the other lane is 5.2 m across) passes through it.
 * @param {object} state { proxies: Map, prev: Map } kept by the caller between frames
 */
export function overgroundPass(map, here, laneSign, dt, fleet, state, { VE = 5, carStep = 20.5 } = {}) {
  const walker = { x: here.x, y: here.y, z: here.z };
  const { win, near, halfLength } = overgroundPassInputs(map, here.ts, laneSign, walker, fleet, state.proxies, { carStep });
  return passingState(near, win, walker, state.prev, dt, { VE, halfLength });
}
