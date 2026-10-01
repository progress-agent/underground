// open-air-walk.js: the Pedestrian walk above ground (sprint 01Oct26h, D-042
// item 1, D-043 item 4, Lane P). The controller between the walk on the
// station-chord network (pedestrian-tunnels.js) and the drawn surface track
// (open-air-map.js, Lane T's mapping run on the walker's own paths).
//
// Jordan (D-042 item 1): "we should stop and be offered the street at stations
// only, not when a line leaves its tunnel. not even when leaving its tunnel
// for good. it should be possible to keep traveling in the same way to the
// ends of the lines even above ground and only possible to exit them at
// stations."
//
// WHAT IT OWNS
//   * Mappings, cached per path: keyed by the path's vertex signature and Lane
//     T's network identity (plus the structure ratio for the DLR, whose drawn
//     deck follows Master), so a rebuilt walker network with the same
//     centrelines reuses them. The walker's own line is mapped synchronously
//     (ensureLine: on placeInTunnel, a descent, a transfer, the chooser card);
//     every other line lazily, within BUILD_BUDGET_MS a frame (pump).
//   * path.open, written from the mapping (path.openSource = 'map'): the chord
//     stretches the walker is shown on open, drawn track. The railway-class
//     intervals of markOpenSectionsFromTrack are kept as path.openTrack, so the
//     network stats are unchanged. One truth then sets both the lining's
//     daylight cap (tube-interior.js holds at path.open) and the cut. No
//     mapping, or a refused interval, means the bore: path.open is empty there.
//   * path.edge (pedestrian-tunnels.js markMapEdge), from isInsideM25 once the
//     ring is loaded, tested on the chord and on the drawn track shown.
//   * Surface trains passing through the walker in the open (surfacePass).
//   * The cut's DOM overlay, #ug-portal-flare: a daylight flare leaving a
//     tunnel, a dip from black entering one, on the mode clock.
//
// No Math.random, no wall clock in anything shown: the build budget reads
// performance.now() only to decide WHEN another line's mapping is built.
import { markMapEdge, headingAt } from './pedestrian-tunnels.js';
import { createOpenAirMap } from './open-air-map.js';
import { passingState } from '../tunnel-trains.js';
import { sampleRun, laneOffset } from '../surface-train-map.js';

export const BUILD_BUDGET_MS = 4;          // lazy mapping work per frame
export const PASS_REACH_M = 1200;          // surface trains within this (plan) of the walker are tested
export const PASS_WINDOW_M = 260;          // the walker's run, either way, that a pass is measured on
const WINDOW_STEP_M = 5;
export const FLARE_S = 0.35;               // leaving a tunnel: daylight
export const DIP_S = 0.25;                 // entering a tunnel: a dip from black

/** A stable signature of a path's centreline (decimetres), so a rebuilt network reuses its mappings. */
function signature(path) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v & 0xffff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 16) & 0xffff; h = Math.imul(h, 16777619) >>> 0; };
  for (const v of path.vertices) { mix(Math.round(v.x * 10)); mix(Math.round(v.y * 10)); mix(Math.round(v.z * 10)); }
  return `${path.lineId}:${path.vertices.length}:${h.toString(36)}`;
}

/**
 * @param {object} o
 * @param {() => object|null} o.surfaceTrains  main.js surfaceTrains (networkFor, placeAt, stockOf, ratio)
 * @param {() => object|null} o.surfaceRail    main.js surfaceRail (its data: Lane R's station records)
 * @param {() => object|null} [o.trainSystem]  trains.js (allTrains, simTime)
 * @param {(x, z) => number|null} o.getStructuralY
 * @param {(x, z) => number|null} o.getTerrainY
 * @param {(x, z) => boolean} [o.isInsideM25]  the map's edge (true everywhere until it is loaded)
 * @param {number} o.VE
 * @param {() => number} [o.now]  a clock for the build budget only
 * @param {Document} [o.document]
 */
export function createOpenAirWalk({ surfaceTrains, surfaceRail, trainSystem = () => null, getStructuralY, getTerrainY,
  isInsideM25 = null, VE = 5, now = () => globalThis.performance?.now?.() ?? 0, document = globalThis.document } = {}) {
  const sigOf = new WeakMap();            // path -> signature
  const netIds = new WeakMap();           // Lane T network -> id
  let nextNetId = 1;
  const cache = new Map();                // key -> mapping
  const latest = new Map();               // signature -> the last mapping built for it (stale use while a rebuild waits)
  const timing = new Map();               // lineId -> { paths, ms, max }
  const recordsByLine = new Map();
  let recordsFor = null;
  let builds = 0;

  function records(lineId) {
    const rail = surfaceRail?.();
    if (rail?.data && recordsFor !== rail.data) { recordsByLine.clear(); recordsFor = rail.data; }
    if (!recordsByLine.has(lineId)) {
      const line = rail?.data?.lines?.find(l => l.id === lineId);
      recordsByLine.set(lineId, new Map((line?.stations || []).map(s => [s.naptan, s])));
    }
    return recordsByLine.get(lineId);
  }

  function keyOf(path) {
    const st = surfaceTrains?.();
    if (!st) return null;
    let tnet;
    try { tnet = st.networkFor(path.lineId); } catch { return null; }
    if (!tnet?.net) return null;
    if (!sigOf.has(path)) sigOf.set(path, signature(path));
    if (!netIds.has(tnet.net)) netIds.set(tnet.net, nextNetId++);
    const ratio = path.lineId === 'dlr' ? `:${(st.ratio ?? 1).toFixed(4)}` : '';
    return { key: `${sigOf.get(path)}@${netIds.get(tnet.net)}${ratio}`, sig: sigOf.get(path), tnet, st };
  }

  function build(path) {
    const k = keyOf(path);
    if (!k) return null;
    if (cache.has(k.key)) return cache.get(k.key);
    const t0 = now();
    let m;
    try {
      m = createOpenAirMap({ path, tnet: k.tnet, records: records(path.lineId), ratio: k.st.ratio ?? 1,
        getY: (p) => getStructuralY(p.x, p.z), groundY: (x, z) => getTerrainY(x, z), VE });
      m.openIntervals();
    } catch (err) {
      console.warn('[pedestrian] open-air mapping', path.lineId, err);
      m = null;
    }
    const ms = now() - t0;
    builds++;
    const t = timing.get(path.lineId) || { paths: 0, ms: 0, max: 0 };
    t.paths++; t.ms += ms; t.max = Math.max(t.max, ms);
    timing.set(path.lineId, t);
    if (m) { m.ms = ms; cache.set(k.key, m); latest.set(k.sig, m); }
    return m;
  }

  /** The path's mapping: fresh, else (unless `fresh`) the last one built for the same centreline. */
  function mappingOf(path, { fresh = false } = {}) {
    if (!path) return null;
    const k = keyOf(path);
    if (k && cache.has(k.key)) return cache.get(k.key);
    if (fresh) return null;
    return latest.get(sigOf.get(path) ?? signature(path)) ?? null;
  }

  // ── path.open, path.openTrack, path.edge ───────────────────────────────────
  function apply(net, path) {
    // Whatever a portal finder wrote is the railway's class (kept for the stats); ours is the mapping's.
    if (path.open !== path._mapOpen) path.openTrack = path.open;
    const m = mappingOf(path);
    path.open = m ? m.openIntervals().map(iv => iv.slice()) : [];
    path._mapOpen = path.open;
    path.openSource = 'map';
  }
  /** Attach to a (new) network: every path's open stretches from what is mapped now; the edge once known. */
  function attach(net) {
    if (!net) return net;
    for (const p of net.paths) apply(net, p);
    markEdge(net);
    return net;
  }
  /** A portal finder rewrote some path.open (the railway arrived): take it as openTrack, put the mapping's back. */
  function sync(net) {
    if (!net) return;
    for (const p of net.paths) if (p.open !== p._mapOpen) apply(net, p);
  }
  const edgeReady = () => typeof isInsideM25 === 'function' && isInsideM25(1e6, 1e6) === false;
  const shown = {};
  /** The map edge: the whole network once the ring is loaded, then again for each path as it is mapped. */
  function markEdge(net, only = null) {
    if (!net || !edgeReady()) return;
    if (net.edgeMarked && !only) return;
    markMapEdge(net, { inside: isInsideM25, only: net.edgeMarked ? only : null, positionsAt: (p, s) => {
      const m = mappingOf(p);
      if (!m) return null;
      const q = m.presentAt(s, 0, shown);
      return q.mapped && q.open ? [{ x: q.x, z: q.z }] : null;
    } });
  }

  /** Map a line now (synchronously): every path of it on the network. */
  function ensureLine(net, lineId) {
    if (!net || !lineId) return 0;
    const done = new Set();
    for (const p of net.paths) {
      if (p.lineId !== lineId) continue;
      if (!mappingOf(p, { fresh: true })) { build(p); done.add(p.id); }
      apply(net, p);
    }
    markEdge(net);
    if (done.size) markEdge(net, done);
    return done.size;
  }
  /** Lazily map what is left, within the budget; returns how many paths still wait (-1: nothing to map onto yet). */
  function pump(net, budgetMs = BUILD_BUDGET_MS) {
    if (!net) return -1;
    sync(net);
    markEdge(net);
    if (!surfaceTrains?.()) return -1;
    const end = now() + budgetMs;
    let pending = 0;
    const done = new Set();
    for (const p of net.paths) {
      if (mappingOf(p, { fresh: true })) continue;
      if (now() < end) { build(p); apply(net, p); done.add(p.id); }
      else pending++;
    }
    if (done.size) markEdge(net, done);
    return pending;
  }

  // ── where the walker is shown ──────────────────────────────────────────────
  function isOpen(path, s) {
    for (const [a, b] of path?.open || []) if (s >= a - 1e-9 && s <= b + 1e-9) return true;
    return false;
  }
  function present(path, s, laneSign = 0, out = {}) {
    const m = mappingOf(path);
    if (!m) { out.mapped = false; out.open = false; return out; }
    return m.presentAt(s, laneSign, out);
  }
  /** The drawn track's heading where the walk is in the open, the chord's elsewhere. */
  function headingOf(path, s, dir) {
    if (isOpen(path, s)) { const m = mappingOf(path); if (m) return m.drawnHeading(s, dir); }
    return headingAt(path, s, dir);
  }
  /** Chord arc reached by `d` metres along what is shown (the drawn track in the open, the chord in the bore). */
  function chordDistance(path, s, dir, d) {
    if (!isOpen(path, s)) return d;
    const m = mappingOf(path);
    return m ? Math.abs(m.trackToChord(s, dir, d) - s) : d;
  }

  // ── surface trains through the walker ─────────────────────────────────────
  const proxies = new Map();   // train -> { position, userData: { id } }
  const prev = new Map();
  const pt = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, open: 0, drawn: 1, inside: false, extra: 0, run: null, seg: -1 };
  const wq = { ...pt };
  let lastPass = { nearest: null, inside: false, insideSpeed: 0, rush: 0, rumble: 0 };
  let passes = 0, wasInside = false, passLine = null;
  function resetPasses() { proxies.clear(); prev.clear(); wasInside = false; lastPass = { nearest: null, inside: false, insideSpeed: 0, rush: 0, rumble: 0 }; }
  /**
   * The passing state of the walker's line's surface trains against the walker
   * in the open: { nearest, inside, insideSpeed, rush, rumble } (tunnel-trains.js passingState).
   * here = present(path, s, laneSign) for the walker, laneSign its lane.
   */
  function surfacePass(path, here, laneSign, dt) {
    const st = surfaceTrains?.(), ts = trainSystem?.();
    if (!st || !ts || !here?.mapped || !here.run) { resetPasses(); return lastPass; }
    if (passLine !== path.lineId) { resetPasses(); passLine = path.lineId; }
    const ratio = st.ratio ?? 1;
    // The walker's window: its own run, in its lane, +/- PASS_WINDOW_M of track.
    const run = here.run, n = run.cum.length;
    const lo = Math.max(run.cum[0], here.ts - PASS_WINDOW_M), hi = Math.min(run.cum[n - 1], here.ts + PASS_WINDOW_M);
    const win = [];
    for (let t = lo; t <= hi + 1e-9; t += WINDOW_STEP_M) {
      const tt = Math.min(t, hi);
      sampleRun(run, tt, ratio, wq, 0, -laneSign);
      const o = laneOffset(wq, laneSign);
      win.push({ x: wq.x + o.ox, y: wq.y, z: wq.z + o.oz, s: tt - here.ts });
      if (tt === hi) break;
    }
    const walker = { x: here.x, y: here.y, z: here.z };
    const simT = ts.simTime ?? 0;
    const near = [];
    let halfLength = 50;
    const seen = new Set();
    for (const train of ts.allTrains || []) {
      if (train.userData?.lineId !== path.lineId) continue;
      if (Math.hypot(train.position.x - walker.x, train.position.z - walker.z) > PASS_REACH_M) continue;
      // Budget 0: never builds a mapping (the trains' own are built by surface-trains.js).
      const place = st.placeAt(train, simT, 0);
      if (!place) continue;
      sampleRun(place.run, place.s, ratio, pt, 0, -place.sign);
      if (!pt.inside || !pt.open || !pt.drawn) continue;
      const o = laneOffset(pt, place.sign);
      let px = proxies.get(train);
      if (!px) { px = { position: { x: 0, y: 0, z: 0 }, userData: { id: train.userData.id ?? null } }; proxies.set(train, px); }
      px.position.x = pt.x + o.ox; px.position.y = pt.y; px.position.z = pt.z + o.oz;
      near.push(px); seen.add(train);
      halfLength = place.stock?.trainM ? place.stock.trainM / 2 : halfLength;
    }
    for (const k of [...proxies.keys()]) if (!seen.has(k)) proxies.delete(k);
    lastPass = passingState(near, win, walker, prev, dt, { VE, halfLength });
    if (lastPass.inside && !wasInside) passes++;
    wasInside = lastPass.inside;
    return lastPass;
  }

  // ── the cut overlay ────────────────────────────────────────────────────────
  let overlay = null;
  if (document?.createElement) {
    overlay = document.createElement('div');
    overlay.id = 'ug-portal-flare';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '28', opacity: '0', background: '#000' });
    (document.body || document.documentElement)?.appendChild(overlay);
  }
  let cut = null;              // { kind: 'flare' | 'dip', t, T, colour }
  const cuts = [];             // test log
  function startCut(kind, { colour = null, at = 0, where = null } = {}) {
    const T = kind === 'flare' ? FLARE_S : DIP_S;
    cut = { kind, t: 0, T, colour: kind === 'flare' ? (colour || '#f4f6f8') : '#000' };
    cuts.push({ kind, at, ...(where || {}) });
    if (cuts.length > 64) cuts.shift();
    if (overlay) { overlay.style.background = cut.colour; overlay.style.opacity = '1'; }
  }
  function stepCut(dt) {
    if (!cut) return 0;
    cut.t += dt;
    const k = Math.max(0, 1 - cut.t / cut.T);
    if (overlay) overlay.style.opacity = k.toFixed(4);
    if (k <= 0) cut = null;
    return k;
  }
  function clearCut() { cut = null; if (overlay) overlay.style.opacity = '0'; }

  function debug(net = null) {
    const lines = {};
    for (const [lineId, t] of timing) lines[lineId] = { builtPaths: t.paths, ms: +t.ms.toFixed(2), maxPathMs: +t.max.toFixed(2) };
    if (net) {
      for (const p of net.paths) {
        const L = lines[p.lineId] ||= {};
        const m = mappingOf(p);
        L.paths = (L.paths || 0) + 1;
        L.mapped = (L.mapped || 0) + (m ? 1 : 0);
        L.openM = (L.openM || 0) + (p.open || []).reduce((a, [x, y]) => a + y - x, 0);
        L.lengthM = (L.lengthM || 0) + p.length;
        if (m) {
          const rs = L.refused ||= [];
          for (const r of m.refused) if (!rs.some(x => x.from === r.from && x.to === r.to)) rs.push({ from: r.from, to: r.to });
          const agg = L.stats ||= {};
          for (const key of ['offTrack', 'noRoute', 'implausible', 'tunnelOnly', 'reversed', 'mapped', 'intervals', 'portals', 'fallback', 'snapped']) {
            if (Number.isFinite(m.stats?.[key])) agg[key] = (agg[key] || 0) + m.stats[key];
          }
        }
      }
    }
    return { builds, lines, cut: cut ? { kind: cut.kind, t: cut.t, opacity: Math.max(0, 1 - cut.t / cut.T) } : null,
      cuts: cuts.map(c => ({ ...c })), passes, pass: { ...lastPass, nearest: lastPass.nearest ? { ...lastPass.nearest } : null },
      edgeReady: edgeReady() };
  }

  return {
    attach, apply, sync, ensureLine, pump, mappingOf, isOpen, present, headingOf, chordDistance, markEdge,
    surfacePass, resetPasses, startCut, stepCut, clearCut, debug,
    get overlay() { return overlay; },
    get cutting() { return cut; },
    get passes() { return passes; },
  };
}
