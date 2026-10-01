// open-air-map.js: where the Pedestrian walker is shown when its line runs in
// the open (sprint 01Oct26h, D-042 item 1, D-043 item 4, Lane P). Pure: no
// scene, no DOM; tests/open-air-map.test.mjs pins it in node.
//
// Jordan (D-042 item 1): "it should be possible to keep traveling in the same
// way to the ends of the lines even above ground and only possible to exit
// them at stations." Settled (D-043 item 4): the walk's STATE stays on the
// station-chord network (pedestrian-tunnels.js: topology, branches, arrivals,
// "towards X" unchanged); in the open the walker is SHOWN on the drawn surface
// track, mapped from the chord, at the same speeds, in first person.
//
// THE MAPPING. Lane T already maps every train's station-chord curve onto the
// drawn track (surface-train-map.js mapTubeCurve, and mapSnapCurve for the
// DLR). This module is the walker's only consumer of that work, through its
// exported functions alone, run on the walker's OWN paths: the trains'
// mappings are keyed by each branch's left or right bore curve, their u is the
// arc-length fraction of that curve, and their station anchors come from
// polyline fractions of the centreline, none of which is the walker's arc, so
// stations would not land on the walker's station vertices.
//
// THE CHORD ADAPTER (one per network path). Its parameter u is
// mapTubeCurve's own `frac`: cumulative 3-D distance over path.vertices,
// divided by the total (the same lines as mapTubeCurve, so a station's u finds
// its own control point exactly). u and the walker's arc s are joined
// piecewise linearly through the pairs (vertexS[i], frac[i]), and the curve is
//   { points: path.vertices, getLength: () => path.length, getPointAt: u => pointAt(path, sOfU(u)) }
// so every station anchor lands exactly on its station vertex.
//
//   * Tube: mapTubeCurve({ curve, stationUs, stations, net, cache, getY, extendM: 0, halfTrainM: 0 }),
//     stationUs = path.stations through uOfS; each station is Lane R's record for its naptan (spread),
//     with key = its id and x, z from its vertex; net = surfaceTrains.networkFor(lineId).net with a
//     cache of our own.
//   * DLR: mapSnapCurve on the same adapter with networkFor('dlr').index and surfaceTrains.ratio; a
//     sample with no drawn deck near is undrawn (the fallback marks it so), and the walker stays in
//     the bore there.
//
// WHAT IT ANSWERS (createOpenAirMap's result):
//   presentAt(s, laneSign, out)  the point shown for chord arc s: sampleRun plus laneOffset (laneSign:
//                                the travel sense whose lane it is, +1 / -1; 0 the corridor's middle).
//                                out: { x, y, z, hx, hz, open, mapped, extra, ts, bridged } (y: drawn
//                                rail head at the structure ratio; open: open AND drawn track there, or
//                                a bridged gap under MIN_OPEN_M between two such stretches)
//   trackToChord(s, dir, d)      the chord arc reached by moving d metres along the drawn track from
//                                where s is shown, in sense dir (clamped to the run; any leftover is
//                                carried on along the chord one to one), so speeds are track speeds
//   openIntervals()              the chord stretches shown on open, drawn track ([[s0, s1]]; slivers
//                                under MIN_OPEN_M ignored either way: a gap that short is bridged, an open
//                                stretch that short dropped); everywhere else the walker is in the bore
//   drawnHeading(s, dir)         the drawn track's heading ahead of s, from the point shown to the run
//                                point min(HEADING_PROBE_M, half the open stretch) along it
//   branchHeading(s, dir)        what a branch is chosen on: drawnHeading averaged with the direction to
//                                the branch's next station as shown (branches that share a formation
//                                for a while part later than any short probe reaches)
//   refused                      the stretches between stations the railway draws in the open but the
//                                mapping refused (stats keys offTrack, noRoute, implausible, reversed):
//                                the bore there, by rule; `unmapped` adds the stretches wholly in tunnel
//
// No Math.random, no clock: a pure function of its inputs (the build time is
// measured by the caller).
import { pointAt, headingAt } from './pedestrian-tunnels.js';
import { mapTubeCurve, mapSnapCurve, sampleRun, sAt, runAt, laneOffset, laneDistance } from '../surface-train-map.js';

/** Open stretches shorter than this (chord metres) are slivers, not track to walk on. */
export const MIN_OPEN_M = 20;
/** How far along the drawn track its heading is read (shared trunks diverge some way past a station). */
export const HEADING_PROBE_M = 200;
/**
 * A branch is chosen on the drawn heading averaged with the direction to the branch's next station as
 * shown on its track: at Turnham Green the Richmond and Ealing branches share one formation for more
 * than 600 m, so the drawn heading alone read both the same and facing one could not choose it.
 */

/**
 * The chord adapter of a network path: u is mapTubeCurve's frac (cumulative
 * 3-D distance over the vertices, canonical y, over the total), piecewise
 * linear in the walker's arc s through the vertex pairs.
 */
export function chordAdapter(path) {
  const V = path.vertices, n = V.length, vs = path.vertexS;
  // Copied from mapTubeCurve, so a station's u is its own control point's.
  const frac = new Float64Array(n);
  for (let i = 1; i < n; i++) frac[i] = frac[i - 1] + Math.hypot(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y, V[i].z - V[i - 1].z);
  const total = frac[n - 1] || 1;
  for (let i = 0; i < n; i++) frac[i] /= total;
  const L = path.length;
  const interp = (xs, ys, x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    // Step past repeated knots (a vertex given twice): the later one carries on.
    const span = xs[hi] - xs[lo];
    return span > 0 ? ys[lo] + (x - xs[lo]) / span * (ys[hi] - ys[lo]) : ys[hi];
  };
  const uOfS = (s) => interp(vs, frac, Math.min(L, Math.max(0, s)));
  const sOfU = (u) => interp(frac, vs, Math.min(1, Math.max(0, u)));
  const tmp = {};
  const curve = {
    points: V,
    getLength: () => L,
    getPointAt: (u) => { pointAt(path, sOfU(u), tmp, 0); return { x: tmp.x, y: tmp.y, z: tmp.z }; },
  };
  return { frac, uOfS, sOfU, curve };
}

/** The anchor-table inverse: curve parameter u at run arc ts (as non-decreasing; across a flat stretch, its far end in sense dir). */
export function uAtTrack(run, ts, dir = 1) {
  const au = run.au, as = run.as, k = as.length;
  if (ts <= as[0]) return au[0];
  if (ts >= as[k - 1]) return au[k - 1];
  let lo = 0, hi = k - 1;
  if (dir > 0) { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (as[m] <= ts) lo = m; else hi = m; } }
  else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (as[m] < ts) lo = m; else hi = m; } }
  const span = as[hi] - as[lo];
  return span > 1e-12 ? au[lo] + (ts - as[lo]) / span * (au[hi] - au[lo]) : (dir > 0 ? au[hi] : au[lo]);
}

/**
 * Map one walker path onto its line's drawn track.
 * @param {object} o
 * @param {object} o.path         a pedestrian-tunnels.js network path
 * @param {object} o.tnet         surfaceTrains.networkFor(lineId): { net, index? }
 * @param {Map<string, object>} [o.records]  Lane R's station records by naptan (tube-surface.json)
 * @param {number} [o.ratio]      the structure ratio the drawn track is at (surfaceTrains.ratio)
 * @param {(p: {x, z}) => number} [o.getY]  the structural ground (fairing), as Lane T passes it
 * @param {(x, z) => number|null} [o.groundY]  the terrain (the DLR's undrawn fallback height)
 * @param {number} [o.VE]
 */
export function createOpenAirMap({ path, tnet, records = null, ratio = 1, getY = null, groundY = null, VE = 5 }) {
  const lineId = path.lineId;
  const isDlr = lineId === 'dlr';
  const A = chordAdapter(path);
  let result;
  if (!tnet?.net) result = { runs: [], stats: { noNetwork: 1 } };
  else if (isDlr) {
    const index = tnet.index;
    // Our own fallback: nothing drawn near, so nothing is shown there (the run marks it undrawn).
    const fallback = (x, y, z) => { const g = groundY ? groundY(x, z) : null; return { base: Number.isFinite(g) ? g : y, y, open: 0 }; };
    result = index ? mapSnapCurve({ curve: A.curve, net: tnet.net, index, ratio, fallback, getY, ve: VE, extendM: 0, halfTrainM: 0 })
      : { runs: [], stats: { noIndex: 1 } };
  } else {
    const vAt = new Map();
    path.vertexS.forEach((s, i) => { if (!vAt.has(s)) vAt.set(s, path.vertices[i]); });
    const stations = [];
    for (const st of path.stations || []) {
      const v = vAt.get(st.s);
      if (!v) continue;
      const rec = st.id && records ? records.get(st.id) : null;
      stations.push({ ...(rec || {}), name: st.name, key: st.id ?? `${path.id}:${st.s}`, x: v.x, z: v.z });
    }
    const stationUs = (path.stations || []).map(st => A.uOfS(st.s));
    result = mapTubeCurve({ curve: A.curve, stationUs, stations, net: tnet.net, cache: { routes: new Map(), stationNode: new Map() },
      getY, extendM: 0, halfTrainM: 0 });
  }
  const runs = result.runs;
  const stats = result.stats || {};
  const smp = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, open: 0, drawn: 1, inside: false, extra: 0, run: null, seg: -1 };
  const smp2 = { ...smp };

  function presentAt(s, laneSign = 0, out = {}) {
    if (intervals === null) openIntervals();
    const u = A.uOfS(s);
    const run = runs.length ? runAt(runs, u) : null;
    if (!run) { out.mapped = false; out.open = false; return out; }
    const gap = filled.length ? filled.find(([a, b]) => s > a && s < b) : null;
    const ts = sAt(run, u);
    sampleRun(run, ts, ratio, smp, 0, laneSign ? -laneSign : 0);
    let x = smp.x, z = smp.z;
    if (laneSign) { const o = laneOffset(smp, laneSign); x += o.ox; z += o.oz; }
    const h = Math.hypot(smp.dx, smp.dz) || 1;
    out.x = x; out.y = smp.y; out.z = z; out.hx = smp.dx / h; out.hz = smp.dz / h;
    out.open = !!(smp.inside && smp.open && smp.drawn);
    out.mapped = true; out.extra = smp.extra || 0; out.lane = laneSign ? laneDistance(smp) : 0;
    out.ts = ts; out.run = run; out.bridged = false;
    if (gap) {
      // Across a bridged gap: the plan point as sampled, the rail head straight across from its two ends.
      const [a, b] = gap, k = (s - a) / (b - a);
      const ya = presentAt(a, laneSign, edgeA).y, yb = presentAt(b, laneSign, edgeB).y;
      out.y = ya + (yb - ya) * k;
      out.open = true; out.bridged = true;
      // presentAt above reused the shared sample: restore what the caller reads.
      out.ts = ts; out.run = run;
    }
    return out;
  }
  const edgeA = {}, edgeB = {};

  function trackToChord(s, dir, d) {
    const u = A.uOfS(s);
    const run = runs.length ? runAt(runs, u) : null;
    const sign = dir >= 0 ? 1 : -1;
    if (!run || !(d > 0)) return Math.min(path.length, Math.max(0, s + sign * Math.max(0, d)));
    const ts = sAt(run, u), k = run.as.length;
    let tt = ts + sign * d, left = 0;
    if (tt > run.as[k - 1]) { left = tt - run.as[k - 1]; tt = run.as[k - 1]; }
    else if (tt < run.as[0]) { left = run.as[0] - tt; tt = run.as[0]; }
    let s2 = A.sOfU(uAtTrack(run, tt, sign));
    // Never backwards: a flat anchor or a rounding step must not undo the move.
    if (sign > 0 ? s2 < s : s2 > s) s2 = s;
    s2 += sign * left;
    return Math.min(path.length, Math.max(0, s2));
  }

  // The open stretches, exactly: a run's sample is open where its nearer vertex is open and drawn
  // (sampleRun), so the boundaries are the mid-points between differing vertices; each is carried
  // back through the anchors (the earliest u for a start, the latest for an end) to the chord.
  let intervals = null;
  function openIntervals() {
    if (intervals) return intervals;
    const out = [];
    for (const run of runs) {
      const n = run.cum.length, k = run.as.length;
      const lo = run.as[0], hi = run.as[k - 1];
      const flag = (i) => !!(run.open[i] && (!run.drawn || run.drawn[i]));
      const local = [];
      let start = null;
      for (let i = 0; i < n; i++) {
        const f = flag(i);
        const left = i === 0 ? run.cum[0] : (run.cum[i - 1] + run.cum[i]) / 2;
        if (f && start === null) start = left;
        if (!f && start !== null) { local.push([start, left]); start = null; }
      }
      if (start !== null) local.push([start, run.cum[n - 1]]);
      for (const [ta, tb] of local) {
        const a = Math.max(ta, lo), b = Math.min(tb, hi);
        if (b > a) out.push([A.sOfU(uAtTrack(run, a, -1)), A.sOfU(uAtTrack(run, b, 1))]);
      }
    }
    out.sort((x, y) => x[0] - y[0]);
    // Slivers under MIN_OPEN_M either way: a gap that short between two open stretches is bridged (a junction
    // gap in the drawn deck, a lone undrawn sample, an overbridge drawn as a few metres of tunnel), and an
    // open stretch that short on its own is dropped.
    const merged = [];
    filled.length = 0;
    for (const [a, b] of out) {
      const last = merged.at(-1);
      if (last && a <= last[1] + MIN_OPEN_M) {
        if (a > last[1] + 1e-6) filled.push([last[1], a]);
        last[1] = Math.max(last[1], b);
      } else merged.push([a, b]);
    }
    intervals = merged.filter(([a, b]) => b - a >= MIN_OPEN_M);
    for (let i = filled.length - 1; i >= 0; i--) if (!intervals.some(([a, b]) => filled[i][0] >= a - 1e-6 && filled[i][1] <= b + 1e-6)) filled.splice(i, 1);
    return intervals;
  }
  const filled = [];   // bridged gaps [[s0, s1]] (presentAt carries the height straight across them)

  function intervalAt(s) {
    for (const iv of openIntervals()) if (s >= iv[0] - 1e-6 && s <= iv[1] + 1e-6) return iv;
    return null;
  }

  const ha = {}, hb = {};
  /** probeM: how far along (default HEADING_PROBE_M; never more than half the open stretch, nor under 10 m). */
  function drawnHeading(s, dir, probeM = HEADING_PROBE_M) {
    const sign = dir >= 0 ? 1 : -1;
    const u = A.uOfS(s);
    const run = runs.length ? runAt(runs, u) : null;
    if (!run) return headingAt(path, s, sign);
    const iv = intervalAt(s);
    // The brief's probe: min(HEADING_PROBE_M, half the open stretch). A longer probe (the branch choice)
    // is capped at the whole stretch instead.
    const span = iv ? iv[1] - iv[0] : Infinity;
    const probe = Math.max(10, Math.min(probeM, probeM > HEADING_PROBE_M ? span : span / 2));
    const ts = sAt(run, u), k = run.as.length;
    const clampT = (t) => Math.min(run.as[k - 1], Math.max(run.as[0], t));
    const t1 = clampT(ts + sign * probe);
    let x, z;
    if (Math.abs(t1 - ts) >= 1) { sampleRun(run, ts, ratio, ha); sampleRun(run, t1, ratio, hb); x = hb.x - ha.x; z = hb.z - ha.z; }
    else {
      // At the run's end: read it from behind, still in the sense of travel.
      const t0 = clampT(ts - sign * probe);
      sampleRun(run, t0, ratio, ha); sampleRun(run, ts, ratio, hb); x = hb.x - ha.x; z = hb.z - ha.z;
    }
    const len = Math.hypot(x, z);
    if (!(len > 1e-6)) return headingAt(path, s, sign);
    return { x: x / len, z: z / len };
  }
  /**
   * The heading a branch is chosen on: the drawn heading (the track in front of the walker) averaged with
   * the direction from the point shown to the branch's next station as shown (where the branch goes).
   */
  const bq = {}, bn = {};
  function branchHeading(s, dir) {
    const a = drawnHeading(s, dir);
    const sign = dir >= 0 ? 1 : -1;
    const S = path.stations || [];
    let next = null;
    if (sign > 0) { for (const st of S) if (st.s > s + 1) { next = st; break; } }
    else { for (let i = S.length - 1; i >= 0; i--) if (S[i].s < s - 1) { next = S[i]; break; } }
    if (!next) return a;
    const p0 = presentAt(s, 0, bq), p1 = presentAt(next.s, 0, bn);
    if (!p0.mapped || !p1.mapped) return a;
    let x = p1.x - p0.x, z = p1.z - p0.z;
    const l = Math.hypot(x, z);
    if (!(l > 1)) return a;
    x = a.x + x / l; z = a.z + z / l;
    const len = Math.hypot(x, z);
    return len > 1e-6 ? { x: x / len, z: z / len } : a;
  }

  // Stretches between stations no run covers (in chord arc): the bore there. Those the railway draws in
  // the open somewhere (path.openTrack, Lane R's classes) are REFUSED open track, reported per line; the
  // rest is tunnel, the bore by rule.
  const refused = [], unmapped = [];
  {
    const St = path.stations || [];
    const track = path.openTrack || [];
    for (let i = 0; i + 1 < St.length; i++) {
      const um = A.uOfS((St[i].s + St[i + 1].s) / 2);
      if (runs.length && runAt(runs, um)) continue;
      const r = { from: St[i].name, to: St[i + 1].name, s0: St[i].s, s1: St[i + 1].s };
      unmapped.push(r);
      if (track.some(([a, b]) => Math.min(b, r.s1) - Math.max(a, r.s0) > MIN_OPEN_M)) refused.push(r);
    }
  }

  return { lineId, path, runs, stats, ratio, adapter: A, presentAt, trackToChord, openIntervals, drawnHeading, branchHeading, intervalAt, refused, unmapped };
}
