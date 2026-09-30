// Surface railway data for the Tube and the DLR (sprint 30Sep26w, D-041, Lane R).
//
// Builds public/data/tube-surface.json from the corrected Prog v2 delivery
// (Working/prog-rail-geometry-11Jul26s/v2/tube-surface-sections.json, the same
// schema as overground-lines.json), following build-overground-data.py, which
// prepares public/data/overground.json from the same delivery.
//
// Jordan, 27Sep26u and 30Sep26w (D-040 follow-up, D-041 items 1 and 2): the
// open-air stretches of the Tube and the DLR are drawn exactly like the
// Overground, stripe included; shared track is drawn once with every line's
// colour side by side; below-ground sections keep the underground look. The
// Elizabeth line waits for the main-line wave (item 1), so it is dropped here.
//
// Transforms, in order:
//  1. Line ids are mapped to the app's (hammersmith -> hammersmith-city,
//     waterloo -> waterloo-city); Elizabeth is excluded.
//  2. Twin collapse, per line. OSM route relations carry both running tracks
//     and every service variant as separate trails (twins NOT collapsed in the
//     source). build-overground-data.py keeps the longer of each near-duplicate
//     PAIR (median nearest-neighbour <= 32 m, length ratio >= 0.85). The Tube
//     trails are split at every junction and overlap partially, so a pairwise
//     test leaves partial duplicates; this pass uses the same 32 m rule as a
//     COVERAGE test instead: trails longest first, a stretch already within
//     32 m of kept track of the same line, running parallel at the same level,
//     is the other running track and is dropped. What survives is one
//     centreline per corridor, the convention of the Overground and the tube
//     bores.
//  3. Shared track (drawn once). A Tube stretch running parallel within 30 m
//     of an Overground corridor or of an earlier Tube line, at the same level
//     (tunnel / raised / at grade; a viaduct under 200 m is a bridge and meets
//     either), for at least 150 m, is that corridor's
//     track: the owner draws it and the other line adds its colour beside the
//     owner's stripe ("bands"). Bakerloo with Lioness to Harrow & Wealdstone,
//     District with Mildmay to Richmond, and the sub-surface lines' common
//     track are the large cases. Four-track corridors (Metropolitan with
//     Jubilee, District with Piccadilly) are within the same 30 m and are drawn
//     as one corridor too: at 18 m of ballast per corridor two parallel beds
//     would overlap.
//  4. Portals: every tunnel <-> open transition on each line's collapsed track
//     (before sharing, so every line has its own), with the lengths of tunnel
//     and open track either side, the direction into the open, and the
//     nearest station. Documented in docs/tube-surface-rail.md for Lane T
//     (trains leaving a portal) and the Pedestrian lane (a portal ends the walk).
//  5. Stations: each TfL stop of a line is classed surface or underground by
//     the class of the line's own track nearest to it (within 300 m).
//
// The DLR's deck heights are NOT in this file: they are measured from the
// Environment Agency LiDAR by scripts/prepare-dlr-deck-heights.mjs into
// src/dlr-deck-heights.json, which src/dlr-profile.js reads, so every DLR
// consumer (initialisation, trains, markers, shafts, hover, and this surface
// railway) takes the same height.
//
// Run: node scripts/prepare-tube-surface.mjs [--source <tube-surface-sections.json>]
//        [--overground public/data/overground.json] [--out public/data/tube-surface.json]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = '/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/prog-rail-geometry-11Jul26s/v2/tube-surface-sections.json';

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

export const ID_MAP = { hammersmith: 'hammersmith-city', waterloo: 'waterloo-city' };
export const EXCLUDED = new Set(['elizabeth']); // D-041 item 1: waits for the main-line wave
/** Canonical order: an earlier line owns shared track (its bed and dressing are drawn). */
export const LINE_ORDER = ['bakerloo', 'central', 'circle', 'district', 'hammersmith-city', 'jubilee',
  'metropolitan', 'northern', 'piccadilly', 'victoria', 'waterloo-city', 'dlr'];

export const TWIN_NEAR_M = 32;      // build-overground-data.py PAIR_NN_MAX_M
export const SHARED_NEAR_M = 30;    // centreline separation for one drawn corridor
export const PARALLEL_COS = Math.cos(35 * Math.PI / 180);
export const MIN_SHARED_M = 150;    // shorter parallel brushes (junction throats) stay separate
export const GAP_FILL_M = 80;       // an uncovered sliver this short between covered stretches is covered
export const MIN_PIECE_M = 100;     // an own-line remnant shorter than this is twin noise
export const SAMPLE_M = 10;         // coverage is tested every 10 m along a segment
export const STATION_NEAR_M = 300;
export const MINOR_TUNNEL_M = 400, MINOR_OPEN_M = 150;

export function toBng([lon, lat]) { return proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); }

export function levelFamily(cls) {
  if (cls === 'tunnel') return 'tunnel';
  if (cls === 'viaduct') return 'raised';
  return 'grade'; // surface, cutting (drawn at grade, D-024), embankment
}

/**
 * Level families per segment, for sharing: a set, and two segments may share
 * when their sets meet. A viaduct run shorter than BRIDGE_MAX_M is a bridge
 * (over a road or a river) within a corridor, and OSM often tags only one
 * line's ways as the bridge, so it meets both 'raised' and 'grade'. A long
 * viaduct (the DLR beside the Jubilee to Stratford) is only 'raised'.
 */
export const BRIDGE_MAX_M = 200;
export function effectiveFamilies(xy, cls) {
  const fam = cls.map(c => levelFamily(c));
  const out = fam.map(f => [f]);
  let i = 0;
  while (i < cls.length) {
    if (fam[i] !== 'raised') { i++; continue; }
    let j = i, len = 0;
    while (j < cls.length && fam[j] === 'raised') { len += Math.hypot(xy[j + 1][0] - xy[j][0], xy[j + 1][1] - xy[j][1]); j++; }
    if (len < BRIDGE_MAX_M) for (let k = i; k < j; k++) out[k] = ['raised', 'grade'];
    i = j;
  }
  return out;
}
const meets = (a, b) => a.some(x => b.includes(x));

/** Per source segment i (pts[i] -> pts[i+1]) class, as overground.js reads it. */
export function segmentClasses(nPoints, segments) {
  const cls = new Array(Math.max(0, nPoints - 1)).fill('surface');
  for (const s of segments || []) for (let i = s.i0; i < Math.min(s.i1, nPoints - 1); i++) cls[i] = s.class;
  return cls;
}

/** Run-length encode per-segment classes back into {i0,i1,class}. */
export function encodeSegments(cls) {
  const out = [];
  for (let i = 0; i < cls.length; i++) {
    if (out.length && out.at(-1).class === cls[i] && out.at(-1).i1 === i) out.at(-1).i1 = i + 1;
    else out.push({ i0: i, i1: i + 1, class: cls[i] });
  }
  return out;
}

export function lengthOf(xy) { let s = 0; for (let i = 1; i < xy.length; i++) s += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]); return s; }

/** Uniform grid of segments for nearest, direction-aware queries (metres, BNG). */
export class SegmentIndex {
  constructor(cell = 50) { this.cell = cell; this.cells = new Map(); this.segs = []; }
  add(a, b, info) {
    const s = { a, b, info, dx: b[0] - a[0], dy: b[1] - a[1] };
    s.len = Math.hypot(s.dx, s.dy) || 1e-9; this.segs.push(s);
    const c = this.cell;
    const x0 = Math.floor(Math.min(a[0], b[0]) / c), x1 = Math.floor(Math.max(a[0], b[0]) / c);
    const y0 = Math.floor(Math.min(a[1], b[1]) / c), y1 = Math.floor(Math.max(a[1], b[1]) / c);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(s);
    }
  }
  addPolyline(xy, infoFor) { for (let i = 0; i < xy.length - 1; i++) this.add(xy[i], xy[i + 1], infoFor(i)); }
  /** Nearest segment within `near` whose direction is parallel and `accept(info)` holds. */
  nearest(p, dir, near, accept = () => true) {
    const c = this.cell, r = Math.ceil(near / c), cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c);
    let best = null;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const s of this.cells.get(`${x},${y}`) || []) {
        if (dir) { const cos = Math.abs((s.dx * dir[0] + s.dy * dir[1]) / s.len); if (cos < PARALLEL_COS) continue; }
        if (!accept(s.info)) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dy) / (s.len * s.len)));
        const d = Math.hypot(p[0] - s.a[0] - s.dx * t, p[1] - s.a[1] - s.dy * t);
        if (d <= near && (!best || d < best.d)) best = { d, t, s };
      }
    }
    return best;
  }
}

/**
 * For each segment of a polyline, the key of the indexed track that covers it
 * (null if none): at least 80% of its 10 m samples lie within `near` of one
 * parallel indexed segment of the same level family.
 */
export function coverage(xy, cls, index, near, keyOf = info => info.key, fams = cls.map(c => [levelFamily(c)])) {
  const out = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i], b = xy[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], fam = fams[i];
    const n = Math.max(1, Math.ceil(L / SAMPLE_M)), votes = new Map();
    for (let j = 0; j <= n; j++) {
      const t = j / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const hit = index.nearest(p, dir, near, info => meets(info.fam ?? [levelFamily(info.cls)], fam));
      if (hit) { const k = keyOf(hit.s.info); votes.set(k, (votes.get(k) || 0) + 1); }
    }
    let key = null, count = 0;
    for (const [k, v] of votes) if (v > count) { key = k; count = v; }
    out.push(count >= 0.8 * (n + 1) ? key : null);
  }
  return out;
}

/** Runs of equal keys over segments, with lengths. */
export function runsOf(keys, xy) {
  const runs = [];
  for (let i = 0; i < keys.length; i++) {
    const len = Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
    if (runs.length && runs.at(-1).key === keys[i]) { runs.at(-1).i1 = i + 1; runs.at(-1).len += len; }
    else runs.push({ key: keys[i], i0: i, i1: i + 1, len });
  }
  return runs;
}

/** Clean coverage runs: short covered brushes become uncovered, short gaps between equal keys covered. */
export function cleanRuns(keys, xy, { minCovered, gapFill }) {
  let runs = runsOf(keys, xy);
  const out = keys.slice();
  // Fill short uncovered gaps between two runs of the same key first.
  for (let r = 1; r < runs.length - 1; r++) {
    if (runs[r].key === null && runs[r].len < gapFill && runs[r - 1].key !== null && runs[r - 1].key === runs[r + 1].key) {
      for (let i = runs[r].i0; i < runs[r].i1; i++) out[i] = runs[r - 1].key;
    }
  }
  runs = runsOf(out, xy);
  // The minimum applies to a covered BLOCK (consecutive covered runs, whatever
  // their owners): a shorter block is a brush past another line and goes back
  // to uncovered. Inside a long block, a run shorter than the minimum (owners
  // alternating at a junction) takes the key of its longer neighbour.
  for (let r = 0; r < runs.length;) {
    if (runs[r].key === null) { r++; continue; }
    let e = r, len = 0;
    while (e < runs.length && runs[e].key !== null) { len += runs[e].len; e++; }
    if (len < minCovered) { for (let k = r; k < e; k++) for (let i = runs[k].i0; i < runs[k].i1; i++) out[i] = null; }
    else for (let k = r; k < e; k++) {
      if (runs[k].len >= minCovered || e - r === 1) continue;
      const prev = k > r ? runs[k - 1] : null, next = k < e - 1 ? runs[k + 1] : null;
      const take = !next || (prev && prev.len >= next.len) ? prev : next;
      if (take) for (let i = runs[k].i0; i < runs[k].i1; i++) out[i] = take.key;
    }
    r = e;
  }
  return out;
}

/** Slice a trail [i0, i1] (segment range) into a piece keeping source points. */
export function slicePiece(trail, i0, i1) {
  return { lonlat: trail.lonlat.slice(i0, i1 + 1), xy: trail.xy.slice(i0, i1 + 1), cls: trail.cls.slice(i0, i1) };
}

/** Pass A: one centreline per corridor for one line. */
export function collapseLine(branches, { near = TWIN_NEAR_M, minPiece = MIN_PIECE_M } = {}) {
  const trails = branches.map(b => {
    const lonlat = b.points, xy = lonlat.map(toBng);
    return { lonlat, xy, cls: segmentClasses(lonlat.length, b.segments), len: lengthOf(xy) };
  }).filter(t => t.xy.length >= 2).sort((a, b) => b.len - a.len);
  const index = new SegmentIndex(), pieces = [];
  let droppedM = 0;
  for (const trail of trails) {
    const keys = cleanRuns(coverage(trail.xy, trail.cls, index, near, () => 'self'), trail.xy,
      { minCovered: 0, gapFill: minPiece });
    for (const run of runsOf(keys, trail.xy)) {
      if (run.key !== null || run.len < minPiece) { droppedM += run.len; continue; }
      const piece = slicePiece(trail, run.i0, run.i1);
      pieces.push(piece);
      index.addPolyline(piece.xy, i => ({ cls: piece.cls[i] }));
    }
  }
  return { pieces, droppedM, sourceM: trails.reduce((s, t) => s + t.len, 0) };
}

/**
 * Covered ways: OSM tags the track under a road overbridge or a short covered
 * way as tunnel=yes. A tunnel run shorter than `maxM` with open track on BOTH
 * sides is not a tunnel the line goes underground through: it is drawn as open
 * track at grade (the class of the track before it), and recorded. Without
 * this, every road bridge over the line (Rayners Lane, Hillingdon under the
 * A40) would cut a gap in the drawn railway and add a portal pair.
 */
export const COVERED_WAY_MAX_M = 60;
export function openCoveredWays(piece, maxM = COVERED_WAY_MAX_M) {
  const out = [];
  let i = 0;
  while (i < piece.cls.length) {
    if (piece.cls[i] !== 'tunnel') { i++; continue; }
    let j = i, len = 0;
    while (j < piece.cls.length && piece.cls[j] === 'tunnel') { len += Math.hypot(piece.xy[j + 1][0] - piece.xy[j][0], piece.xy[j + 1][1] - piece.xy[j][1]); j++; }
    if (i > 0 && j < piece.cls.length && len < maxM) {
      const open = piece.cls[i - 1];
      for (let k = i; k < j; k++) piece.cls[k] = open === 'viaduct' ? 'surface' : open;
      out.push({ i0: i, i1: j, lengthM: Math.round(len) });
    }
    i = j;
  }
  return out;
}

/** Class of the line's own track nearest to a point (null when none within `near`). */
export function nearestClass(pieces, p, near = STATION_NEAR_M) {
  let best = null;
  for (const piece of pieces) for (let i = 0; i < piece.xy.length - 1; i++) {
    const a = piece.xy[i], b = piece.xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    if (d <= near && (!best || d < best.d)) best = { d, cls: piece.cls[i] };
  }
  return best;
}

/** Portals on one line's collapsed pieces: tunnel <-> open class changes. */
export function findPortals(lineId, pieces, stations) {
  const out = [];
  pieces.forEach((piece, pi) => {
    const tun = piece.cls.map(c => c === 'tunnel');
    for (let i = 1; i < tun.length; i++) {
      if (tun[i] === tun[i - 1]) continue;
      // Boundary point i: segment i-1 on one side, segment i on the other.
      const run = (from, step) => { let s = 0, j = from; const t0 = tun[from]; while (j >= 0 && j < tun.length && tun[j] === t0) { s += Math.hypot(piece.xy[j + 1][0] - piece.xy[j][0], piece.xy[j + 1][1] - piece.xy[j][1]); j += step; } return s; };
      const tunnelIsBefore = tun[i - 1];
      const tunnelM = tunnelIsBefore ? run(i - 1, -1) : run(i, 1), openM = tunnelIsBefore ? run(i, 1) : run(i - 1, -1);
      const openCls = tunnelIsBefore ? piece.cls[i] : piece.cls[i - 1];
      // Direction from the tunnel into the open, along the track.
      const a = piece.xy[tunnelIsBefore ? i - 1 : i + 1], b = piece.xy[tunnelIsBefore ? i + 1 : i - 1];
      const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
      const [e, n] = piece.xy[i], [lon, lat] = piece.lonlat[i];
      let nearest = null;
      for (const s of stations) { const d = Math.hypot(s.e - e, s.n - n); if (!nearest || d < nearest.d) nearest = { d, s }; }
      out.push({
        lineId, lon: +lon.toFixed(7), lat: +lat.toFixed(7), e: Math.round(e * 10) / 10, n: Math.round(n * 10) / 10,
        branch: pi, point: i, bearingIntoOpenDeg: Math.round(bearing), openClass: openCls,
        tunnelM: Math.round(tunnelM), openM: Math.round(openM),
        // A tunnel run under 400 m is an underpass (a road or another railway
        // over the line); an open run under 150 m is a short daylight gap
        // between tunnels (a station box open to the sky). Consumers wanting
        // the mouths of real tunnels filter on !minor.
        minor: tunnelM < MINOR_TUNNEL_M || openM < MINOR_OPEN_M,
        nearestStation: nearest ? { name: nearest.s.name, naptan: nearest.s.naptan, distanceM: Math.round(nearest.d) } : null,
      });
    }
  });
  // Twins are collapsed, so two portals within 60 m on one line are one mouth
  // reached by two pieces: keep the one with the longer tunnel.
  const kept = [];
  for (const p of out.sort((a, b) => b.tunnelM - a.tunnelM)) {
    if (kept.some(k => Math.hypot(k.e - p.e, k.n - p.n) < 60)) continue;
    kept.push(p);
  }
  return kept.sort((a, b) => a.branch - b.branch || a.point - b.point).map((p, k) => ({ id: `${lineId}-${k + 1}`, ...p }));
}

/**
 * Pass B: shared track. `owners` is a SegmentIndex of already-drawn corridors
 * whose info carries {key, cls, owner, piece, seg}; returns, for one line's
 * pieces, the parts it must draw itself (new owners) and the parts it shares.
 */
export function splitShared(lineId, pieces, owners, { near = SHARED_NEAR_M, minShared = MIN_SHARED_M, gapFill = GAP_FILL_M, minPiece = MIN_PIECE_M } = {}) {
  const own = [], shared = [];
  for (const piece of pieces) {
    // Per segment, the owner segment hit most often (by key = owner piece).
    // Tunnels are never shared: nothing below ground is drawn by the surface
    // railway, and each line keeps its whole bored route for later consumers.
    const raw = coverage(piece.xy, piece.cls, owners, near, info => info.key, effectiveFamilies(piece.xy, piece.cls)).map((k, i) => piece.cls[i] === 'tunnel' ? null : k);
    const keys = cleanRuns(raw, piece.xy, { minCovered: minShared, gapFill });
    for (const run of runsOf(keys, piece.xy)) {
      if (run.key === null) {
        own.push(slicePiece(piece, run.i0, run.i1));
      } else {
        shared.push({ lineId, key: run.key, xy: piece.xy.slice(run.i0, run.i1 + 1), len: run.len });
      }
    }
  }
  return { own, shared };
}

/** Map a shared stretch onto its owner's point range [j0, j1] (segments j0..j1-1). */
export function ownerRange(ownerXY, stretchXY) {
  const nearestSeg = p => {
    let best = null;
    for (let i = 0; i < ownerXY.length - 1; i++) {
      const a = ownerXY[i], b = ownerXY[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (!best || d < best.d) best = { d, i };
    }
    return best.i;
  };
  const i0 = nearestSeg(stretchXY[0]), i1 = nearestSeg(stretchXY.at(-1));
  return [Math.min(i0, i1), Math.max(i0, i1) + 1];
}

/**
 * Elementary bands on one owner piece: split the owner's point range into
 * intervals with a constant set of sharing lines. Lines are listed owner
 * first, then in LINE_ORDER.
 */
export function elementaryBands(ownerLine, ranges) {
  const cuts = new Set();
  for (const r of ranges) { cuts.add(r.j0); cuts.add(r.j1); }
  const xs = [...cuts].sort((a, b) => a - b), out = [];
  for (let k = 0; k < xs.length - 1; k++) {
    const j0 = xs[k], j1 = xs[k + 1];
    const lines = [...new Set(ranges.filter(r => r.j0 <= j0 && r.j1 >= j1).map(r => r.lineId))]
      .sort((a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b));
    if (!lines.length) continue;
    const all = [ownerLine, ...lines.filter(l => l !== ownerLine)];
    const inferred = [...new Set(ranges.filter(r => r.inferred && r.j0 <= j0 && r.j1 >= j1).map(r => r.lineId))];
    if (out.length && out.at(-1).j1 === j0 && out.at(-1).lines.join() === all.join()
      && (out.at(-1).inferred || []).join() === inferred.join()) out.at(-1).j1 = j1;
    else out.push({ j0, j1, lines: all, ...(inferred.length ? { inferred } : {}) });
  }
  return out;
}

/**
 * Source gap repair from TfL stops (sourced, not guessed geometry). Where a
 * line's own OSM route is missing a branch (the v2 Metropolitan has no
 * Uxbridge branch), yet at least `minStops` of its TfL stops with no own track
 * within 300 m sit within `near` of ONE other line's drawn corridor, that
 * corridor is the only railway there and carries this line too: a band is
 * added between the outermost of those stops.
 */
export function inferBandsFromStops(line, ownerPieces, { near = 150, minStops = 3 } = {}) {
  const orphans = line.stations.filter(s => s.trackClass === null);
  const out = [];
  for (const [key, xy] of ownerPieces) {
    if (key === `tube:${line.id}` || key.startsWith(`tube:${line.id}:`)) continue;
    const hits = [];
    for (const s of orphans) {
      let best = null;
      for (let i = 0; i < xy.length - 1; i++) {
        const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((s.e - a[0]) * dx + (s.n - a[1]) * dy) / l2));
        const d = Math.hypot(s.e - a[0] - dx * t, s.n - a[1] - dy * t);
        if (d <= near && (!best || d < best.d)) best = { d, i };
      }
      if (best) hits.push({ s, i: best.i, d: best.d });
    }
    if (hits.length < minStops) continue;
    const i0 = Math.min(...hits.map(h => h.i)), i1 = Math.max(...hits.map(h => h.i)) + 1;
    out.push({ key, lineId: line.id, j0: i0, j1: i1, inferred: true, stops: hits });
  }
  return out;
}

export async function build({ source = DEFAULT_SOURCE, overgroundPath = path.join(ROOT, 'public/data/overground.json') } = {}) {
  const src = JSON.parse(await readFile(source, 'utf8'));
  const og = JSON.parse(await readFile(overgroundPath, 'utf8'));
  const report = [];

  // Pass A: collapse each line.
  const lines = [];
  for (const L of src.lines) {
    if (EXCLUDED.has(L.id)) { report.push(`${L.id}: excluded (D-041 item 1, main-line wave)`); continue; }
    const id = ID_MAP[L.id] || L.id;
    const { pieces, droppedM, sourceM } = collapseLine(L.branches);
    const coveredWays = pieces.flatMap((piece, pi) => openCoveredWays(piece).map(c => ({ piece: pi, ...c })));
    const stations = (L.stations || []).filter(s => Number.isFinite(s.lon) && Number.isFinite(s.lat)).map(s => {
      const [e, n] = toBng([s.lon, s.lat]);
      const near = nearestClass(pieces, [e, n]);
      return { name: s.name, naptan: s.naptan, lon: s.lon, lat: s.lat, e, n,
        surface: !!near && near.cls !== 'tunnel', trackClass: near?.cls ?? null, railOffsetM: near ? Math.round(near.d) : null };
    });
    lines.push({ id, sourceId: L.id, name: L.name, colour: L.colour, pieces, stations, droppedM, sourceM, coveredWays,
      sources: L.sources, confidence: L.confidence });
  }
  lines.sort((a, b) => LINE_ORDER.indexOf(a.id) - LINE_ORDER.indexOf(b.id));

  // Pass B: shared track, Overground corridors first (they are drawn already).
  const owners = new SegmentIndex(), ownerXY = new Map(), ownerCls = new Map();
  for (const l of og.lines) l.branches.forEach((b, bi) => {
    const xy = b.points.map(toBng), cls = segmentClasses(b.points.length, b.segments), key = `overground:${l.id}:${bi}`;
    const fam = effectiveFamilies(xy, cls);
    ownerXY.set(key, xy);
    owners.addPolyline(xy, i => ({ key, cls: cls[i], fam: fam[i] }));
  });
  const sharedRanges = new Map(); // owner key -> [{lineId, j0, j1}]
  for (const line of lines) {
    const { own, shared } = splitShared(line.id, line.pieces, owners);
    line.own = own;
    line.shared = shared;
    own.forEach((piece, pi) => {
      const key = `tube:${line.id}:${pi}`;
      ownerXY.set(key, piece.xy);
      ownerCls.set(key, piece.cls);
      const fam = effectiveFamilies(piece.xy, piece.cls);
      owners.addPolyline(piece.xy, i => ({ key, cls: piece.cls[i], fam: fam[i] }));
    });
    for (const s of shared) {
      const [j0, j1] = ownerRange(ownerXY.get(s.key), s.xy);
      if (!sharedRanges.has(s.key)) sharedRanges.set(s.key, []);
      sharedRanges.get(s.key).push({ lineId: line.id, j0, j1, len: s.len });
    }
  }

  const tubeOwners = [...ownerXY].filter(([k]) => k.startsWith('tube:'));
  const inferredReport = [];
  for (const line of lines) {
    for (const r of inferBandsFromStops(line, tubeOwners)) {
      if (!sharedRanges.has(r.key)) sharedRanges.set(r.key, []);
      sharedRanges.get(r.key).push(r);
      // Those stops are on track now: surface or not by that track's class.
      for (const h of r.stops) Object.assign(h.s, { trackClass: ownerCls.get(r.key)[h.i], surface: ownerCls.get(r.key)[h.i] !== 'tunnel',
        railOffsetM: Math.round(h.d), trackInferredFrom: r.key.split(':')[1] });
      inferredReport.push(`${line.id} inferred on ${r.key} ${r.j0}-${r.j1} from stops ${r.stops.map(h => h.s.name.replace(/ Underground Station$/, '')).join(', ')}`);
    }
  }
  report.push(...inferredReport);

  const overgroundShared = [];
  const out = { lines: [] };
  for (const line of lines) {
    const branches = line.own.map((piece, pi) => {
      const ranges = sharedRanges.get(`tube:${line.id}:${pi}`) || [];
      const b = { points: piece.lonlat.map(([lon, lat]) => [+lon.toFixed(7), +lat.toFixed(7)]), segments: encodeSegments(piece.cls) };
      const bands = elementaryBands(line.id, ranges);
      if (bands.length) b.bands = bands;
      return b;
    });
    const portals = findPortals(line.id, line.pieces, line.stations);
    const sharedWith = {};
    for (const s of line.shared) { const owner = s.key.split(':').slice(0, 2).join(':'); sharedWith[owner] = Math.round((sharedWith[owner] || 0) + s.len); }
    const ownM = line.own.reduce((s, p) => s + lengthOf(p.xy), 0);
    const openOwnM = line.own.reduce((s, p) => s + p.cls.reduce((t, c, i) => t + (c === 'tunnel' ? 0 : Math.hypot(p.xy[i + 1][0] - p.xy[i][0], p.xy[i + 1][1] - p.xy[i][1])), 0), 0);
    out.lines.push({
      id: line.id, sourceId: line.sourceId, name: line.name, mode: line.id === 'dlr' ? 'dlr' : 'tube', colour: line.colour,
      branches,
      stations: line.stations.map(({ e, n, ...s }) => s),
      portals,
      summary: {
        sourceTrailsM: Math.round(line.sourceM), collapsedM: Math.round(line.pieces.reduce((s, p) => s + lengthOf(p.xy), 0)),
        drawnM: Math.round(ownM), drawnOpenM: Math.round(openOwnM), sharedM: sharedWith,
        coveredWaysOpened: line.coveredWays.length, coveredWaysM: line.coveredWays.reduce((s, c) => s + c.lengthM, 0),
      },
      sources: line.sources, confidence: line.confidence,
    });
    report.push(`${line.id.padEnd(16)} source ${(line.sourceM / 1000).toFixed(1)} km -> collapsed ${(out.lines.at(-1).summary.collapsedM / 1000).toFixed(1)} km; `
      + `drawn ${(ownM / 1000).toFixed(1)} km (${(openOwnM / 1000).toFixed(1)} open) in ${branches.length} corridors; shared ${JSON.stringify(sharedWith)}; `
      + `${line.stations.filter(s => s.surface).length}/${line.stations.length} surface stations; ${portals.filter(p => !p.minor).length} portals (+${portals.filter(p => p.minor).length} minor)`);
  }
  for (const [key, ranges] of sharedRanges) {
    if (!key.startsWith('overground:')) continue;
    const [, lineId, bi] = key.split(':');
    for (const band of elementaryBands(lineId, ranges)) overgroundShared.push({ overground: lineId, branch: +bi, ...band });
  }
  out.overgroundShared = overgroundShared;
  return {
    data: {
      version: 1,
      generated: src.generated,
      source: 'Prog rail-geometry 11Jul26s v2 (tube-surface-sections.json), twin-collapsed and shared-track resolved by scripts/prepare-tube-surface.mjs',
      attribution: src.attribution,
      notes: {
        excluded: 'Elizabeth line (D-041 item 1: waits for the main-line railway wave).',
        branches: 'Owned corridors only: points [lon,lat], segments {i0,i1,class} per source segment (as overground.json). A stretch another corridor already carries is not repeated; it appears as that corridor\'s bands.',
        bands: 'On an owner corridor, {j0,j1,lines}: over owner segments j0..j1-1 these lines share the track; the stripe is split side by side, owner first.',
        overgroundShared: 'Bands on public/data/overground.json corridors: {overground, branch, j0, j1, lines} with j indexing that branch\'s points.',
        portals: 'Per line, before sharing: tunnel <-> open transitions. bearingIntoOpenDeg is the compass bearing (BNG grid) from the tunnel into the open; minor = tunnel under 400 m (an underpass) or open under 150 m (a daylight gap). See docs/tube-surface-rail.md.',
        stations: 'surface: the line\'s own nearest track (within 300 m) is not tunnel. trackInferredFrom: the line\'s own OSM route lacks the branch; the stop sits on that line\'s track (see bands.inferred).',
        coveredWays: 'A tunnel run under 60 m between open track (a road overbridge or covered way) is drawn as open track at grade; summary.coveredWaysOpened counts them.',
        dlrHeights: 'DLR deck heights come from src/dlr-deck-heights.json via src/dlr-profile.js (EA LiDAR DSM 1m, flagged fallback); not repeated here.',
      },
      lines: out.lines,
      overgroundShared,
    },
    report,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const outPath = arg('--out', path.join(ROOT, 'public/data/tube-surface.json'));
  const { data, report } = await build({ source: arg('--source', DEFAULT_SOURCE), overgroundPath: arg('--overground', path.join(ROOT, 'public/data/overground.json')) });
  await writeFile(outPath, JSON.stringify(data));
  console.log(report.join('\n'));
  console.log(`overground shared bands: ${data.overgroundShared.map(b => `${b.overground}[${b.branch}] ${b.j0}-${b.j1} ${b.lines.join('+')}`).join('; ')}`);
  const pts = data.lines.reduce((s, l) => s + l.branches.reduce((t, b) => t + b.points.length, 0), 0);
  console.log(`wrote ${outPath}: ${data.lines.length} lines, ${data.lines.reduce((s, l) => s + l.branches.length, 0)} corridors, ${pts} points`);
}
