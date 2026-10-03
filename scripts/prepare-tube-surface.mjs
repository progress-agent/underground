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
//     The DLR (fix round 2, verifier 30Sep26w): its level is also the deck the
//     shared profile gives it (src/dlr-profile.js, the EA LiDAR decks). After
//     the collapse above, unchanged, a second pass only ADDS: a DLR stretch
//     beside kept track in plan but on a deck more than DLR_TWIN_DECK_TOL_M
//     away is a structure, not a twin (north of Canning Town the 8.8 m flyover
//     over the Jubilee, beside the 4.1 m viaduct), and the profile's raised
//     track v2 lacks (the Tower Gateway viaduct) is taken from the profile. A
//     DLR stretch raised on a deck above DLR_SHARE_MAX_DECK_M is never shared
//     (step 3): an owner would draw it at its own height, not the DLR's.
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
// s30:R fix round 2: the DLR's level is read from the shared profile (its
// measured decks), the same way the renderer lays it.
import { createDlrProfile, sampleForSurfaceRail, deckOfSample } from '../src/dlr-profile.js';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
// s01:R: the open-air track v2 lacks, from OSM (cached Overpass answer).
import { CACHE_FILE as OSM_CACHE_FILE, placeTrails, PLACES } from './fetch-tube-surface-osm.mjs';

/**
 * s01:R (sprint 01Oct26h, D-043 item 4): the places whose OSM track is merged
 * into a line (scripts/fetch-tube-surface-osm.mjs PLACES), with ways also on
 * another line's relations left out where that line owns the shared track.
 */
export const OSM_GAPS = {
  central: [['central-ealing'], ['central-hainault'], ['central-epping']],
  // Harrow-on-the-Hill to Rayners Lane only: from the junction east of
  // Rayners Lane the track is the Piccadilly's (transform 4 lays the
  // Metropolitan's colour on it, as before).
  metropolitan: [['metropolitan-west-harrow', { exclude: ['piccadilly'] }], ['metropolitan-watford']],
  // Lewisham: also the classes of the v2 track there (reclassFromOsm).
  dlr: [['dlr-stratford'], ['dlr-lewisham', { reclass: true }]],
};
export async function loadOsmCache(file = OSM_CACHE_FILE) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { throw new Error(`${file} is missing: run node scripts/fetch-tube-surface-osm.mjs (it caches the Overpass answer) (${e.message})`); }
}
export function osmTrailsFor(lineId, answer) {
  return (OSM_GAPS[lineId] || []).flatMap(([place, opts]) => placeTrails(answer, place, lineId, opts));
}

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
/** s30:R fix round 2: DLR stretches are twins only when their decks agree this closely (m). */
export const DLR_TWIN_DECK_TOL_M = 1.5;
/** s30:R fix round 2: a DLR stretch on a deck higher than this (m) is drawn by the DLR, never shared. */
export const DLR_SHARE_MAX_DECK_M = 1.5;
/** s30:R fix round 2: a DLR stretch beside kept track in plan but on another deck is a structure, kept from this length (m). */
export const DLR_MIN_DECK_PIECE_M = 30;

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
  /** Nearest segment within `near` whose direction is parallel and `accept(info, t)` holds (t along it). */
  nearest(p, dir, near, accept = () => true) {
    const c = this.cell, r = Math.ceil(near / c), cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c);
    let best = null;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const s of this.cells.get(`${x},${y}`) || []) {
        if (dir) { const cos = Math.abs((s.dx * dir[0] + s.dy * dir[1]) / s.len); if (cos < PARALLEL_COS) continue; }
        const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dy) / (s.len * s.len)));
        if (!accept(s.info, t)) continue;
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
 * parallel indexed segment of the same level family. With `heightAt` (the
 * DLR, fix round 2), also at a deck within `heightTol` of the indexed
 * segment's there (heightAt at the nearest point of it, with its class).
 */
export function coverage(xy, cls, index, near, keyOf = info => info.key, fams = cls.map(c => [levelFamily(c)]), { heightAt = null, heightTol = DLR_TWIN_DECK_TOL_M } = {}) {
  const out = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i], b = xy[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], fam = fams[i];
    const n = Math.max(1, Math.ceil(L / SAMPLE_M)), votes = new Map();
    for (let j = 0; j <= n; j++) {
      const t = j / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const h = heightAt ? heightAt(p, cls[i]) : null;
      const hit = index.nearest(p, dir, near, (info, u) => meets(info.fam ?? [levelFamily(info.cls)], fam)
        && (h === null || !info.a || Math.abs(heightAt([info.a[0] + (info.b[0] - info.a[0]) * u, info.a[1] + (info.b[1] - info.a[1]) * u], info.cls) - h) <= heightTol));
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
  const piece = { lonlat: trail.lonlat.slice(i0, i1 + 1), xy: trail.xy.slice(i0, i1 + 1), cls: trail.cls.slice(i0, i1) };
  if (trail.source) piece.source = trail.source;
  // s01:R: where points came from (OSM extensions) and segments opened as covered ways.
  if (trail.place) piece.place = trail.place;
  if (trail.from) piece.from = trail.from.slice(i0, i1 + 1);
  if (trail.opened) piece.opened = trail.opened.slice(i0, i1);
  return piece;
}

/** s01:R: point ranges of a piece whose `from` label is set: [{p0, p1, place}]. */
export function fromRanges(from) {
  const out = [];
  (from || []).forEach((f, i) => {
    if (!f) return;
    if (out.length && out.at(-1).place === f && out.at(-1).p1 === i - 1) out.at(-1).p1 = i;
    else out.push({ p0: i, p1: i, place: f });
  });
  return out;
}
/** s01:R: segment ranges flagged in `opened`: [{i0, i1}]. */
export function openedRanges(opened) {
  const out = [];
  (opened || []).forEach((o, i) => { if (!o) return; if (out.length && out.at(-1).i1 === i) out.at(-1).i1 = i + 1; else out.push({ i0: i, i1: i + 1 }); });
  return out;
}

/**
 * s30:R fix round 2: the DLR's RAISED track as the shared profile maps it
 * (src/dlr-profile-data.json, the OSM ways every DLR consumer is built on), as
 * source-format trails: elevated and embankment edges chained through the
 * nodes where exactly two of them meet, the class from the edge kind.
 * collapseLine takes them AFTER the v2 trails, so they only add the decks v2
 * lacks at that level and height: the Tower Gateway viaduct and the Stratford
 * approach from Pudding Mill Lane. At-grade track is not taken: where v2 and
 * the profile disagree about a tunnel (the Beckton branch), v2 decides, as it
 * does for every other line.
 */
export const PROFILE_CLASS = { elevated: 'viaduct', embankment: 'embankment' };
export function profileTrails(profileData) {
  const open = profileData.edges.filter(e => PROFILE_CLASS[e.kind]);
  const adj = new Map();
  open.forEach((e, k) => { for (const n of [e.a, e.b]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(k); } });
  const used = new Uint8Array(open.length), trails = [];
  // From `node`, leaving along edge `k`, through degree-2 nodes: [nodes..., classes...].
  const extend = (node, k) => {
    const nodes = [], cls = [];
    while (true) {
      used[k] = 1; const e = open[k], next = e.a === node ? e.b : e.a;
      nodes.push(next); cls.push(PROFILE_CLASS[e.kind]);
      const out = adj.get(next);
      if (out.length !== 2) break;
      const k2 = out[0] === k ? out[1] : out[0];
      if (used[k2]) break;
      node = next; k = k2;
    }
    return { nodes, cls };
  };
  for (let k = 0; k < open.length; k++) {
    if (used[k]) continue;
    const e = open[k];
    const fwd = extend(e.a, k);
    // Back from e.a, if it is a pass-through node.
    const outA = adj.get(e.a), kb = outA.length === 2 ? (outA[0] === k ? outA[1] : outA[0]) : -1;
    const back = kb >= 0 && !used[kb] ? extend(e.a, kb) : { nodes: [], cls: [] };
    const nodes = [...back.nodes.reverse(), e.a, ...fwd.nodes], cls = [...back.cls.reverse(), ...fwd.cls];
    const points = nodes.map(n => [profileData.nodes[n].lon, profileData.nodes[n].lat]);
    trails.push({ points, segments: encodeSegments(cls), source: 'dlr-profile' });
  }
  return trails;
}

/**
 * Pass A: one centreline per corridor for one line.
 *
 * s30:R fix round 2, the DLR (`heightAt(xy, cls)`, the deck a point is drawn
 * on): after that pass, unchanged, a second pass only ADDS. Every trail (the
 * source's, then the `supplement`, the profile's raised track) is compared
 * with everything kept, in plan AND deck: a stretch beside kept track in plan
 * but on a deck more than DLR_TWIN_DECK_TOL_M away is a structure (a flyover,
 * a ramp beside a viaduct), added from `minDeckPiece`; a supplement stretch
 * with no kept track beside it at all is added from `minPiece`. Nothing the
 * first pass kept is dropped or moved, so the corridors drawn before stay.
 */
export function collapseLine(branches, { near = TWIN_NEAR_M, minPiece = MIN_PIECE_M, heightAt = null, supplement = [], minDeckPiece = DLR_MIN_DECK_PIECE_M, osm = [] } = {}) {
  const prep = list => list.map(b => {
    const lonlat = b.points, xy = lonlat.map(toBng);
    return { lonlat, xy, cls: segmentClasses(lonlat.length, b.segments), len: lengthOf(xy), ...(b.source ? { source: b.source } : {}), ...(b.place ? { place: b.place } : {}) };
  }).filter(t => t.xy.length >= 2).sort((a, b) => b.len - a.len);
  const trails = prep(branches);
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
  const sourceM = trails.reduce((s, t) => s + t.len, 0);
  // s01:R: track v2 lacks, from OSM (scripts/fetch-tube-surface-osm.mjs), merged
  // AFTER the v2 trails by the same coverage test, so it only adds.
  const osmReport = osm.length ? supplementFromOsm(pieces, index, prep(osm), { near, minPiece }) : null;
  if (!heightAt) return { pieces, droppedM, sourceM, osm: osmReport };

  // Pass A2 (the DLR): decks.
  const decks = new SegmentIndex(), segLen = (xy, i) => Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
  const index2 = piece => decks.addPolyline(piece.xy, i => ({ cls: piece.cls[i], a: piece.xy[i], b: piece.xy[i + 1] }));
  pieces.forEach(index2);
  let deckSeparatedM = 0, fromSupplementM = 0;
  for (const trail of [...trails, ...prep(supplement)]) {
    const atDeck = coverage(trail.xy, trail.cls, decks, near, () => 'self', undefined, { heightAt });
    const inPlan = coverage(trail.xy, trail.cls, decks, near, () => 'self');
    const apart = atDeck.map((k, i) => k === null && inPlan[i] !== null);
    // The source's own trails add deck-separated stretches only (their other
    // uncovered stretches were remnants, decided above); a supplement trail
    // adds any stretch no kept track covers at its deck.
    const add = trail.source ? atDeck.map(k => k === null) : apart;
    for (const run of runsOf(add.map(a => (a ? null : 'kept')), trail.xy)) {
      if (run.key !== null) continue;
      let apartM = 0;
      for (let i = run.i0; i < run.i1; i++) if (apart[i]) apartM += segLen(trail.xy, i);
      // s01:R: a short supplement stretch that runs on from the end of kept
      // track to the buffers (the last 41 m of the profile's track to
      // platform 4a at Stratford, beyond the end of OSM's route track)
      // extends that piece.
      // Only toward a dead end: the run reaches the end of the profile's
      // track, with no kept track beyond it (a flyover stub between other
      // decks, at West India Quay, is left as it was).
      const atTrailEnd = run.i0 === 0 || run.i1 === trail.xy.length - 1;
      const farEnd = run.i0 === 0 ? trail.xy[0] : trail.xy[trail.xy.length - 1];
      if (trail.source && !apartM && run.len < minPiece && atTrailEnd && !decks.nearest(farEnd, null, near)) {
        const arc = arcOf(trail.xy), join = findJoin(pieces, trail, arc, run);
        const x = join && applyJoin(join, trail, arc, run, trail.source);
        if (x) { for (let i = x.from; i < x.to; i++) decks.add(join.piece.xy[i], join.piece.xy[i + 1], { cls: join.piece.cls[i], a: join.piece.xy[i], b: join.piece.xy[i + 1] }); fromSupplementM += x.lengthM; }
        continue;
      }
      if (apartM < minDeckPiece && !(trail.source && run.len >= minPiece)) continue;
      const piece = slicePiece(trail, run.i0, run.i1);
      pieces.push(piece);
      index2(piece);
      if (trail.source) fromSupplementM += run.len; else deckSeparatedM += run.len;
    }
  }
  return { pieces, droppedM, sourceM, deckSeparatedM, fromSupplementM, osm: osmReport };
}

/**
 * s01:R (sprint 01Oct26h, D-043 item 4): open-air track the v2 delivery lacks,
 * from OpenStreetMap (scripts/fetch-tube-surface-osm.mjs: the line's own route
 * relations in a box around each gap, classed by pipeline-v2.py's rules).
 * The OSM trails, longest first, go through the same coverage test as pass A
 * against everything kept (v2 first), in plan: a stretch within 32 m of kept
 * track of the line, parallel, is that track and is not added (whatever the
 * two vintages' classes there).
 * An uncovered stretch is:
 *  - JOINED to a kept piece when that piece ends beside it (its end within
 *    JOIN_M of the stretch near the covered side, running the same way): the
 *    stretch's points beyond the end are appended (or prepended) to the
 *    piece, so a line runs on to its buffers as one piece (Watford, Epping,
 *    Lewisham), whatever the length;
 *  - otherwise added as a piece of its own from MIN_PIECE_M (the Ealing
 *    Broadway branch, the Hainault loop, Harrow-on-the-Hill to Rayners Lane);
 *  - otherwise dropped (twin noise).
 * Nothing kept before is moved; an extended piece keeps every point it had.
 * Returns {addedM, extendedM, droppedM, added: [...], extended: [...]}.
 */
export const JOIN_M = 32;
export const JUNCTION_SNAP_M = 6, JUNCTION_REACH_M = 150;
/** Arc length at each point of a polyline. */
const arcOf = xy => { const arc = [0]; for (let i = 0; i < xy.length - 1; i++) arc.push(arc[i] + Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1])); return arc; };

/**
 * A kept piece ending beside an uncovered stretch run[i0..i1] of a trail, near
 * its covered side and running on into it (JOIN_M; see supplementFromOsm), or
 * null: {piece, atEnd, side, pr}.
 */
export function findJoin(pieces, trail, arc, run, joinM = JOIN_M) {
  const project = (p, s0, s1) => {
    let best = null;
    for (let i = Math.max(0, s0); i < Math.min(s1, trail.xy.length - 1); i++) {
      const a = trail.xy[i], b = trail.xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (!best || d < best.d) best = { d, s: arc[i] + t * Math.sqrt(l2), seg: i };
    }
    return best;
  };
  let join = null;
  for (const piece of pieces) {
    if (piece.xy.length < 2) continue;
    for (const atEnd of [true, false]) {
      const E = atEnd ? piece.xy.at(-1) : piece.xy[0], F = atEnd ? piece.xy.at(-2) : piece.xy[1];
      const dir = [E[0] - F[0], E[1] - F[1]], dl = Math.hypot(...dir) || 1;
      for (const side of ['start', 'end']) {
        // The covered side of the run: before i0 (start) or after i1 (end).
        const pr = side === 'start' ? project(E, run.i0 - 3, run.i1) : project(E, run.i0, run.i1 + 3);
        if (!pr || pr.d > joinM) continue;
        const edge = side === 'start' ? arc[run.i0] : arc[run.i1];
        if (Math.abs(pr.s - edge) > 40) continue;
        // The stretch runs away from the covered side; the piece must run the same way.
        const k = Math.min(pr.seg, trail.xy.length - 2), tdir = [trail.xy[k + 1][0] - trail.xy[k][0], trail.xy[k + 1][1] - trail.xy[k][1]];
        const sign = side === 'start' ? 1 : -1, cos = sign * (dir[0] * tdir[0] + dir[1] * tdir[1]) / (dl * (Math.hypot(...tdir) || 1));
        if (cos < 0.5) continue;
        const beyond = side === 'start' ? arc[run.i1] - pr.s : pr.s - arc[run.i0];
        if (beyond < 5) continue;
        if (!join || pr.d < join.pr.d) join = { piece, atEnd, side, pr };
      }
    }
  }
  return join;
}

/**
 * Append (or prepend) to the joined piece the trail's points beyond the
 * projection of its end, away from the covered side, labelled `label` in the
 * piece's `from`. Returns {lengthM, classes, from, to} (point indices in the
 * piece, for indexing) or null.
 */
export function applyJoin(join, trail, arc, run, label) {
  const { piece, atEnd, side, pr } = join;
  const idx = [];
  if (side === 'start') { for (let i = run.i0; i <= run.i1; i++) if (arc[i] > pr.s + 0.5) idx.push(i); }
  else { for (let i = run.i1; i >= run.i0; i--) if (arc[i] < pr.s - 0.5) idx.push(i); }
  if (!idx.length) return null;
  const clsOf = i => side === 'start' ? trail.cls[Math.max(0, i - 1)] : trail.cls[Math.min(i, trail.cls.length - 1)];
  const pts = idx.map(i => trail.xy[i]), ll = idx.map(i => trail.lonlat[i]), cl = idx.map(clsOf);
  const E = atEnd ? piece.xy.at(-1) : piece.xy[0];
  let len = Math.hypot(pts[0][0] - E[0], pts[0][1] - E[1]);
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  piece.from ||= piece.xy.map(() => (piece.source === 'osm' ? piece.place : null));
  piece.opened ||= piece.cls.map(() => 0);
  const tags = pts.map(() => label);
  let from, to;
  if (atEnd) {
    from = piece.xy.length - 1;
    piece.xy.push(...pts); piece.lonlat.push(...ll); piece.cls.push(...cl); piece.from.push(...tags); piece.opened.push(...cl.map(() => 0));
    to = piece.xy.length - 1;
  } else {
    piece.xy.unshift(...pts.reverse()); piece.lonlat.unshift(...ll.reverse()); piece.cls.unshift(...cl.reverse());
    piece.from.unshift(...tags); piece.opened.unshift(...cl.map(() => 0));
    from = 0; to = pts.length;
  }
  return { lengthM: len, classes: [...new Set(cl)], at: atEnd ? 'end' : 'start', from, to };
}

export function supplementFromOsm(pieces, index, trails, { near = TWIN_NEAR_M, minPiece = MIN_PIECE_M, joinM = JOIN_M } = {}) {
  const rep = { addedM: 0, extendedM: 0, droppedM: 0, added: [], extended: [] };
  const indexPiece = (piece, from = 0, to = piece.xy.length - 1) => { for (let i = from; i < to; i++) index.add(piece.xy[i], piece.xy[i + 1], { cls: piece.cls[i] }); };
  for (const trail of trails) {
    const arc = arcOf(trail.xy);
    // In plan only, whatever the level: the supplement fills track v2 has
    // nowhere. Two OSM vintages draw class boundaries (a bridge, a covered
    // way) metres apart, and a level test would re-add the line beside itself
    // wherever they disagree (seen on the Central at Snaresbrook).
    const anyLevel = trail.cls.map(() => ['tunnel', 'raised', 'grade']);
    const keys = cleanRuns(coverage(trail.xy, trail.cls, index, near, () => 'self', anyLevel), trail.xy, { minCovered: 0, gapFill: minPiece });
    for (const run of runsOf(keys, trail.xy)) {
      if (run.key !== null) continue;
      // A kept piece ending beside this stretch, near its covered side, running on into it.
      const join = findJoin(pieces, trail, arc, run, joinM);
      if (join) {
        const x = applyJoin(join, trail, arc, run, trail.place);
        if (!x) continue;
        indexPiece(join.piece, x.from, x.to);
        rep.extendedM += x.lengthM;
        rep.extended.push({ place: trail.place, lengthM: Math.round(x.lengthM), at: x.at, classes: x.classes });
        continue;
      }
      if (run.len < minPiece) { rep.droppedM += run.len; continue; }
      // A new branch reaches back to the junction it leaves: on a side where
      // the trail runs on beside kept track (covered), the piece takes the
      // covered points back to the first within JUNCTION_SNAP_M of that track
      // (at most JUNCTION_REACH_M), so it meets the line it branches from as
      // v2's own branches do, instead of stopping 32 m short of it.
      let a = run.i0, b = run.i1;
      const nearKept = i => index.nearest(trail.xy[i], null, JUNCTION_SNAP_M);
      const reach = (from, step) => { let i = from, m = 0; while (i + step >= 0 && i + step < trail.xy.length && m < JUNCTION_REACH_M) { m += Math.hypot(trail.xy[i + step][0] - trail.xy[i][0], trail.xy[i + step][1] - trail.xy[i][1]); i += step; if (nearKept(i)) return i; } return from; };
      if (a > 0) a = reach(a, -1);
      if (b < trail.xy.length - 1) b = reach(b, 1);
      const piece = slicePiece(trail, a, b);
      pieces.push(piece);
      indexPiece(piece);
      rep.addedM += run.len;
      rep.added.push({ place: trail.place, lengthM: Math.round(run.len), classes: [...new Set(piece.cls)] });
    }
  }
  return rep;
}

/**
 * s01:R: the classes of kept track inside a place's box, from OSM, where the
 * v2 vintage and today's OSM disagree. Used only where OSM_GAPS asks (the
 * DLR's Lewisham terminus: v2 tags its last 106 m tunnel to the buffers;
 * today's OSM tags 85 m under the main-line railway as tunnel and the
 * platforms beyond it as open). A kept segment takes the class of the
 * parallel OSM segment within RECLASS_NEAR_M of its middle.
 */
export const RECLASS_NEAR_M = 12;
export function reclassFromOsm(pieces, trails, box, { near = RECLASS_NEAR_M } = {}) {
  const idx = new SegmentIndex();
  for (const t of trails) { const xy = t.points.map(toBng), cls = segmentClasses(t.points.length, t.segments); idx.addPolyline(xy, i => ({ cls: cls[i] })); }
  const [S, W, N, E] = box, changes = [];
  for (const piece of pieces) for (let i = 0; i < piece.cls.length; i++) {
    const [lon, lat] = piece.lonlat[i], [lon2, lat2] = piece.lonlat[i + 1];
    const mlon = (lon + lon2) / 2, mlat = (lat + lat2) / 2;
    if (mlat < S || mlat > N || mlon < W || mlon > E) continue;
    const a = piece.xy[i], b = piece.xy[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const hit = idx.nearest([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(b[0] - a[0]) / L, (b[1] - a[1]) / L], near);
    if (hit && hit.s.info.cls !== piece.cls[i]) { changes.push({ from: piece.cls[i], to: hit.s.info.cls, lengthM: L }); piece.cls[i] = hit.s.info.cls; }
  }
  return changes;
}

/**
 * s01:R (sprint 01Oct26h, D-043 item 4): a TUNNEL STUB. A piece that is
 * tunnel throughout, shorter than STUB_TUNNEL_MAX_M, and lies wholly (every
 * 10 m sample) within STUB_NEAR_M of the same line's open track is the other
 * running track's covered stretch, which the twin collapse cannot drop
 * (tunnel and grade never count as one level, coverage above). It is dropped.
 * The case that asked for it: the Jubilee at West Hampstead, a 227 m tunnel
 * piece running west from the station 13 to 46 m beside the open main track,
 * which classed the station as tunnel (no surface marker) and drew Jubilee
 * trains as stubs. A real tunnel is never beside open track of its own line
 * for its whole length; every piece the rule drops is reported.
 */
export const STUB_TUNNEL_MAX_M = 400, STUB_NEAR_M = 32;
export function dropTunnelStubs(pieces, { maxM = STUB_TUNNEL_MAX_M, near = STUB_NEAR_M, isRealTunnel = null } = {}) {
  const dropped = [], spared = [];
  const isStub = (piece) => piece.cls.length && piece.cls.every(c => c === 'tunnel') && lengthOf(piece.xy) < maxM;
  const open = new SegmentIndex();
  pieces.forEach(p => { if (!isStub(p)) p.cls.forEach((c, i) => { if (c !== 'tunnel') open.add(p.xy[i], p.xy[i + 1], { cls: c }); }); });
  const keep = [];
  for (const piece of pieces) {
    if (!isStub(piece)) { keep.push(piece); continue; }
    let all = true, worst = 0;
    for (let i = 0; i < piece.xy.length - 1 && all; i++) {
      const a = piece.xy[i], b = piece.xy[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_M));
      for (let j = 0; j <= n; j++) {
        const hit = open.nearest([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], null, near);
        if (!hit) { all = false; break; }
        worst = Math.max(worst, hit.d);
      }
    }
    const real = all && isRealTunnel ? isRealTunnel(piece) : null;
    if (all && !real) dropped.push({ piece, lengthM: Math.round(lengthOf(piece.xy)), maxDistanceM: Math.round(worst) });
    else { keep.push(piece); if (all) spared.push({ piece, lengthM: Math.round(lengthOf(piece.xy)), evidence: real }); }
  }
  pieces.length = 0; pieces.push(...keep);
  dropped.spared = spared;
  return dropped;
}

/**
 * s01:R: is a stub candidate a REAL tunnel? Today's OSM decides, from a cached
 * Overpass probe of the railway ways around every candidate
 * (scripts/.cache/tube-surface-stub-probe.json, written by
 * `node scripts/prepare-tube-surface.mjs --probe-stubs`): it is real when a way
 * of the same line tagged tunnel (not merely covered=yes, such as Heron Quays
 * station's building over its viaduct) passes within STUB_REAL_NEAR_M of the
 * stub's middle. The Bakerloo's stub west of Kensal Green is the Kensal Green
 * Tunnel itself (v2 classes the main track open there), so it is kept; the
 * Jubilee's at West Hampstead lies where OSM's Jubilee is open (its only
 * tunnel there is the 30 m under West End Lane, 236 m away), so it goes.
 */
export const STUB_REAL_NEAR_M = 25;
export const STUB_PROBE_FILE = path.join(ROOT, 'scripts/.cache/tube-surface-stub-probe.json');
export const LINE_NAME = {
  bakerloo: /bakerloo/i, central: /central/i, circle: /circle/i, district: /district/i, 'hammersmith-city': /hammersmith/i,
  jubilee: /jubilee/i, metropolitan: /metropolitan/i, northern: /northern/i, piccadilly: /piccadilly/i, victoria: /victoria/i,
  'waterloo-city': /waterloo/i, dlr: /docklands|dlr/i,
};
export function stubKey(lineId, piece) {
  const [lon, lat] = piece.lonlat[Math.floor(piece.lonlat.length / 2)];
  return `${lineId}@${lat.toFixed(5)},${lon.toFixed(5)}`;
}
export function realTunnelFromProbe(lineId, piece, probe, { near = STUB_REAL_NEAR_M } = {}) {
  const entry = probe?.candidates?.[stubKey(lineId, piece)];
  if (!entry) return undefined; // not probed
  const mid = toBng(piece.lonlat[Math.floor(piece.lonlat.length / 2)]);
  for (const w of probe.ways) {
    const t = w.tags || {};
    if (!t.tunnel || t.tunnel === 'no' || !LINE_NAME[lineId]?.test(`${t.name ?? ''} ${t.line ?? ''}`)) continue;
    const xy = w.geometry.map(g => toBng([g.lon, g.lat]));
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
      const u = Math.max(0, Math.min(1, ((mid[0] - a[0]) * dx + (mid[1] - a[1]) * dy) / l2));
      const d = Math.hypot(mid[0] - a[0] - dx * u, mid[1] - a[1] - dy * u);
      if (d <= near) return `OSM way ${w.id} (${t.name ?? t.line}${t['tunnel:name'] ? `, ${t['tunnel:name']}` : ''}, tunnel=${t.tunnel}) ${Math.round(d)} m from its middle`;
    }
  }
  return null;
}

/**
 * s01:R: a STATION'S COVERED WAY. A tunnel run shorter than
 * STATION_COVERED_WAY_MAX_M between open track, with a stop of the line
 * beside it (within STATION_COVERED_WAY_NEAR_M) whose nearest track is in
 * the run, is the station under a road bridge or its own building: Preston
 * Road (a 131 m run under Preston Road and the station), Wembley Park,
 * Hillingdon, the Central at Stratford. So is the approach to a terminus
 * whose platforms lie beyond it (the Lewisham DLR, under the main-line
 * railway). It is drawn as open track like the covered ways above. The open
 * track either side must be at least MINOR_OPEN_M long or run to the end of
 * the line (the buffers), so a station between two real tunnels (a short
 * daylight gap, in central London) stays in tunnel. Records every run opened.
 */
export const STATION_COVERED_WAY_MAX_M = 150, STATION_COVERED_WAY_NEAR_M = 60;
export function openStationCoveredWays(pieces, stations, { maxM = STATION_COVERED_WAY_MAX_M, near = STATION_COVERED_WAY_NEAR_M, minOpenM = MINOR_OPEN_M } = {}) {
  const out = [];
  const segLen = (xy, i) => Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
  const segDist = (a, b, p) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
  // A piece end is the end of the line when no other piece of the line comes within 50 m of it.
  const lineEnd = (pi, atEnd) => {
    const E = atEnd ? pieces[pi].xy.at(-1) : pieces[pi].xy[0];
    return !pieces.some((q, k) => k !== pi && q.xy.some((_, i) => i < q.xy.length - 1 && segDist(q.xy[i], q.xy[i + 1], E) < 50));
  };
  // Each stop's nearest track: piece and segment.
  const nearestOf = s => { let best = null; pieces.forEach((piece, pi) => { for (let i = 0; i < piece.xy.length - 1; i++) { const d = segDist(piece.xy[i], piece.xy[i + 1], [s.e, s.n]); if (!best || d < best.d) best = { d, pi, i }; } }); return best; };
  const nearest = stations.map(nearestOf);
  pieces.forEach((piece, pi) => {
    for (let i0 = 1; i0 < piece.cls.length;) {
      if (piece.cls[i0] !== 'tunnel' || piece.cls[i0 - 1] === 'tunnel') { i0++; continue; }
      let i1 = i0; while (i1 < piece.cls.length && piece.cls[i1] === 'tunnel') i1++;
      const next = i1;
      if (i1 === piece.cls.length) { i0 = next; continue; } // open track on both sides
      let len = 0; for (let i = i0; i < i1; i++) len += segLen(piece.xy, i);
      const openRun = (from, step) => { let m = 0, i = from; while (i >= 0 && i < piece.cls.length && piece.cls[i] !== 'tunnel') { m += segLen(piece.xy, i); i += step; } return { m, toEnd: i < 0 || i >= piece.cls.length }; };
      const before = openRun(i0 - 1, -1), after = openRun(i1, 1);
      const terminusBefore = before.m < minOpenM && before.toEnd && lineEnd(pi, false);
      const terminusAfter = after.m < minOpenM && after.toEnd && lineEnd(pi, true);
      const sideOk = (side, terminus) => side.m >= minOpenM || terminus;
      if (len < maxM && sideOk(before, terminusBefore) && sideOk(after, terminusAfter)) {
        // The stop: its nearest track is in this run, or this run is the
        // approach to a terminus whose platforms are beyond it.
        let stop = null;
        const dist = (s, a, b) => { let d = Infinity; for (let i = a; i < b; i++) d = Math.min(d, segDist(piece.xy[i], piece.xy[i + 1], [s.e, s.n])); return d; };
        stations.forEach((s, k) => {
          const inRun = nearest[k] && nearest[k].pi === pi && nearest[k].i >= i0 && nearest[k].i < i1;
          // At a terminus the stop is at the platforms beyond the run.
          const d = inRun ? dist(s, i0, i1) : terminusAfter ? dist(s, i1, piece.cls.length) : terminusBefore ? dist(s, 0, i0) : Infinity;
          if (d <= near && (!stop || d < stop.d)) stop = { d, s };
        });
        if (stop) {
          const open = piece.cls[i0 - 1];
          piece.opened ||= piece.cls.map(() => 0);
          for (let i = i0; i < i1; i++) { piece.cls[i] = open === 'viaduct' ? 'surface' : open; piece.opened[i] = 1; }
          out.push({ piece: pi, i0, i1, lengthM: Math.round(len), station: stop.s.name, stationDistanceM: Math.round(stop.d), terminus: terminusBefore || terminusAfter });
        }
      }
      i0 = next;
    }
  });
  return out;
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
      piece.opened ||= piece.cls.map(() => 0);
      for (let k = i; k < j; k++) { piece.cls[k] = open === 'viaduct' ? 'surface' : open; piece.opened[k] = 1; }
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
 * Per segment: does any 10 m sample of it stand on a deck higher than `maxM`
 * (`heightAt`, the DLR's profile deck)? Such a segment is never shared.
 */
export function raisedSegments(xy, cls, heightAt, maxM = DLR_SHARE_MAX_DECK_M) {
  return cls.map((c, i) => {
    if (c === 'tunnel') return false;
    const a = xy[i], b = xy[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_M));
    for (let j = 0; j <= n; j++) if (heightAt([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], c) > maxM) return true;
    return false;
  });
}

/**
 * Pass B: shared track. `owners` is a SegmentIndex of already-drawn corridors
 * whose info carries {key, cls, owner, piece, seg}; returns, for one line's
 * pieces, the parts it must draw itself (new owners) and the parts it shares.
 * With `heightAt` (the DLR, fix round 2), a segment raised on a deck above
 * DLR_SHARE_MAX_DECK_M is its own, whatever the source class says (the
 * short-bridge rule and the gap fill included): the DLR draws it at its deck.
 */
export function splitShared(lineId, pieces, owners, { near = SHARED_NEAR_M, minShared = MIN_SHARED_M, gapFill = GAP_FILL_M, minPiece = MIN_PIECE_M, heightAt = null } = {}) {
  const own = [], shared = [];
  for (const piece of pieces) {
    // Per segment, the owner segment hit most often (by key = owner piece).
    // Tunnels are never shared: nothing below ground is drawn by the surface
    // railway, and each line keeps its whole bored route for later consumers.
    const raised = heightAt ? raisedSegments(piece.xy, piece.cls, heightAt) : piece.cls.map(() => false);
    const fams = effectiveFamilies(piece.xy, piece.cls).map((f, i) => raised[i] ? [] : f);
    const raw = coverage(piece.xy, piece.cls, owners, near, info => info.key, fams).map((k, i) => piece.cls[i] === 'tunnel' ? null : k);
    const keys = cleanRuns(raw, piece.xy, { minCovered: minShared, gapFill }).map((k, i) => raised[i] ? null : k);
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
  // s01:R: a stop the v2 track misses (v2Orphan); before the OSM supplement
  // that was every stop with no track at all. The Metropolitan's Rayners Lane
  // is still placed on the Piccadilly's track: OSM's own Metropolitan track
  // ends at the junction east of it, where the shared stretch begins.
  const orphans = line.stations.filter(s => s.v2Orphan ?? s.trackClass === null);
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
    let i0 = Math.min(...hits.map(h => h.i)), i1 = Math.max(...hits.map(h => h.i)) + 1;
    // s01:R: where the line's own track now meets that corridor (OSM's
    // Metropolitan from West Harrow joins the Piccadilly's at the junction east
    // of Rayners Lane), the band reaches the junction, so the line's colour,
    // and its trains, run on from its own track without a gap.
    for (const piece of line.pieces || []) for (const E of [piece.xy[0], piece.xy.at(-1)]) {
      let best = null;
      for (let i = 0; i < xy.length - 1; i++) {
        const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((E[0] - a[0]) * dx + (E[1] - a[1]) * dy) / l2));
        const d = Math.hypot(E[0] - a[0] - dx * t, E[1] - a[1] - dy * t);
        if (d <= BAND_JOIN_M && (!best || d < best.d)) best = { d, i };
      }
      if (!best) continue;
      const span = (j0, j1) => { let m = 0; for (let k = j0; k < j1; k++) m += Math.hypot(xy[k + 1][0] - xy[k][0], xy[k + 1][1] - xy[k][1]); return m; };
      if (best.i < i0 && span(best.i, i0) <= BAND_JOIN_REACH_M) i0 = best.i;
      if (best.i + 1 > i1 && span(i1, best.i + 1) <= BAND_JOIN_REACH_M) i1 = best.i + 1;
    }
    out.push({ key, lineId: line.id, j0: i0, j1: i1, inferred: true, stops: hits });
  }
  return out;
}
export const BAND_JOIN_M = 15, BAND_JOIN_REACH_M = 1000;

/**
 * s30:R fix round 2: the deck (true metres, 0 at grade) the surface railway
 * draws a DLR source point on, read from the shared profile exactly as
 * src/tube-surface-rail.js reads it (sampleForSurfaceRail); where no profiled
 * track is within reach, the class estimate the renderer then draws.
 */
export function dlrHeightAt(profile = createDlrProfile({ project: (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) }; }, sampleSurfaceY: () => 0 })) {
  const ESTIMATE = { viaduct: 8, embankment: 3 };
  return ([e, n], cls) => {
    if (cls === 'tunnel') return 0;
    const s = sampleForSurfaceRail(profile, { x: e - BNG_REF_E, z: -(n - BNG_REF_N), cls, structureScale: 1 });
    return s ? deckOfSample(s) : (ESTIMATE[cls] ?? 0);
  };
}

// ── s02:F rules ──
// Sprint 02Oct26f, Lane F (D-048 item 9; D-047 items train-hainault-gaps and
// train-stratford-1617). Two named rules, run in Pass A of build() right after
// the reclass block, before the tunnel stubs and the covered ways. Lane T also
// edits this file; every F constant and function sits in this section.

/**
 * LOOP_GAP_JOINS (train-hainault-gaps). On the Hainault loop the drawn pieces
 * do not meet in three places (north of Hainault, by Grange Hill, by Roding
 * Valley): the gaps are about 26 to 27 m, with headings 5 to 31 degrees apart.
 * The train network joins each piece end to the nearest node of another piece
 * within 60 m (src/surface-train-map.js JOIN_M), so trains cut across the gap
 * by up to 16 m off the drawn track.
 *
 * The rule EXTENDS the loose piece itself with a smooth connector, so the
 * piece's old end is gone and there is no chord left to take (a separate
 * connector piece would leave the old end in place for that 60 m join to find).
 * For each piece A of at least minPieceM and each of its ends E inside the
 * place's box: F is the nearest point of any other piece B of the line. The
 * end is joined when minGapM < |EF| <= maxGapM, B's tangent at F (oriented to
 * continue A's outward heading, measured over headingM) is within maxAngleDeg of
 * that heading, and either F is B's own end vertex (the other half of the same
 * track) or B is at least minSideM long (the main line it joins).
 *
 * The connector is a cubic Hermite from E to a target Q on B (tangents: A's
 * heading and B's tangent at Q, each of magnitude |EQ|) sampled every stepM, in
 * the class of A's end segment, labelled 'gap-join' in the piece's `from`. Q is
 * as near F as keeps the join gentle: the two ends are about 26 m apart along
 * the track and 9 to 10 m apart across it, an S-bend a train cannot take
 * without the train map (surface-train-map.js kinkWindows, which blends any
 * turn over KINK_TURN_DEG = 20 degrees in 8 m by up to 10 m off the drawn
 * track) re-fairing it, so the connector runs on beyond F along B (advanced in
 * advanceStepM steps, up to advanceMaxM) until no 8 m stretch of the joined
 * line turns more than maxTurnDeg. Where F is B's own end vertex, B is trimmed
 * to start at Q (the stretch of B before Q is the one the connector replaces,
 * so there is no second ribbon beside it); where B is the long main line F is
 * mid-piece and B is left whole. A pair of ends that qualify towards each
 * other is joined once.
 */
export const LOOP_GAP_JOINS = {
  lineId: 'central', place: 'central-hainault',
  minPieceM: 300, minGapM: 1, maxGapM: 35, maxAngleDeg: 35, minSideM: 2000,
  headingM: 30, advanceMinM: 30, advanceStepM: 5, advanceMaxM: 120, maxTurnDeg: 12, turnM: 8, stepM: 5, label: 'gap-join',
};

const inBox = ([lon, lat], [s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e;
/** Nearest point of `xy` to p: {d, i, t, pt, atEnd: 'start'|'end'|null}. */
function nearestOnPolyline(xy, p) {
  let best = null;
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const pt = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
    if (!best || d < best.d) best = { d, i, t, pt };
  }
  if (best) best.atEnd = best.i === 0 && best.t === 0 ? 'start' : best.i === xy.length - 2 && best.t === 1 ? 'end' : null;
  return best;
}
const unit = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
/** The outward heading of a piece at one end, over the last m metres. */
function headingOf(xy, atEnd, m) {
  const E = atEnd ? xy.at(-1) : xy[0];
  let acc = 0, prev = E;
  for (let k = 1; k < xy.length; k++) {
    const q = atEnd ? xy[xy.length - 1 - k] : xy[k];
    acc += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q;
    if (acc >= m) return unit([E[0] - q[0], E[1] - q[1]]);
  }
  return unit([E[0] - prev[0], E[1] - prev[1]]);
}
/**
 * The point `dist` metres along the polyline `xy` from the point (segment i, parameter t), stepping `dir`
 * (+1 towards higher indices, -1 towards lower), clipped to the polyline: { pt, tangent (in the stepping
 * direction), seg, t } with the point on segment [seg, seg + 1] at parameter t.
 */
function advanceAlong(xy, i, t, dir, dist) {
  let pos = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t];
  let seg = i, left = dist, tangent;
  for (;;) {
    const a = xy[seg], b = xy[seg + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    tangent = unit(dir > 0 ? [b[0] - a[0], b[1] - a[1]] : [a[0] - b[0], a[1] - b[1]]);
    const target = dir > 0 ? b : a, run = Math.hypot(target[0] - pos[0], target[1] - pos[1]);
    if (run >= left) {
      const pt = [pos[0] + tangent[0] * left, pos[1] + tangent[1] * left];
      return { pt, tangent, seg, t: Math.max(0, Math.min(1, ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / (len * len))) };
    }
    left -= run; pos = target;
    const next = seg + dir;
    if (next < 0 || next > xy.length - 2) return { pt: pos, tangent, seg, t: dir > 0 ? 1 : 0, clipped: true };
    seg = next;
  }
}
/** A cubic Hermite from P0 to P1 with unit tangents t0, t1 scaled by |P0P1|, sampled every stepM; excludes P0, includes P1. */
function hermite(P0, t0, P1, t1, stepM) {
  const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), n = Math.max(2, Math.ceil(L / stepM)), out = [];
  for (let k = 1; k <= n; k++) {
    const u = k / n, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    out.push(k === n ? [...P1] : [h00 * P0[0] + h10 * L * t0[0] + h01 * P1[0] + h11 * L * t1[0], h00 * P0[1] + h10 * L * t0[1] + h01 * P1[1] + h11 * L * t1[1]]);
  }
  return out;
}
/** `pts` resampled every `step` metres along its length (first and last kept). */
function resample(pts, step) {
  const out = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = step - carry; d <= L + 1e-9; d += step) out.push([a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]);
    carry = (carry + L) % step;
  }
  if (Math.hypot(out.at(-1)[0] - pts.at(-1)[0], out.at(-1)[1] - pts.at(-1)[1]) > step * 0.25) out.push(pts.at(-1));
  return out;
}
/** The most any `turnM` stretch of the polyline (resampled every 2 m) turns, in degrees, between index windows [k0, k1] of the resample. */
function maxTurnOf(poly, turnM, from, to) {
  const P = resample(poly, 2), h = Math.max(1, Math.round(turnM / 2));
  const lo = P.findIndex((p, k) => k >= 0 && Math.hypot(p[0] - from[0], p[1] - from[1]) < 1.5), hi = P.findIndex((p) => Math.hypot(p[0] - to[0], p[1] - to[1]) < 1.5);
  let worst = 0;
  for (let k = Math.max(h, (lo < 0 ? 0 : lo) - h); k <= Math.min(P.length - 1 - h, (hi < 0 ? P.length - 1 : hi) + h); k++) {
    const a = [P[k][0] - P[k - h][0], P[k][1] - P[k - h][1]], b = [P[k + h][0] - P[k][0], P[k + h][1] - P[k][1]];
    const la = Math.hypot(...a), lb = Math.hypot(...b); if (!(la > 1e-9 && lb > 1e-9)) continue;
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * 180 / Math.PI);
  }
  return worst;
}
/** Points of `xy` starting at E going inward along the piece (end = true: E is the last point), `m` metres. */
function inwardFrom(xy, atEnd, m) {
  const pts = [atEnd ? xy.at(-1) : xy[0]]; let acc = 0;
  for (let k = 1; k < xy.length && acc < m; k++) { const q = atEnd ? xy[xy.length - 1 - k] : xy[k]; acc += Math.hypot(q[0] - pts.at(-1)[0], q[1] - pts.at(-1)[1]); pts.push(q); }
  return pts;
}
/** Points of B's body from the point (seg, t) onward in direction `dir`, `m` metres. */
function bodyFrom(xy, seg, t, dir, m) {
  const out = []; let pos = [xy[seg][0] + (xy[seg + 1][0] - xy[seg][0]) * t, xy[seg][1] + (xy[seg + 1][1] - xy[seg][1]) * t];
  out.push(pos);
  let k = dir > 0 ? seg + 1 : seg, acc = 0;
  while (k >= 0 && k < xy.length && acc < m) { const q = xy[k]; acc += Math.hypot(q[0] - out.at(-1)[0], q[1] - out.at(-1)[1]); out.push(q); k += dir; }
  return out;
}
/** Trim piece B so that its `side` end is the point (seg, t, Q): everything between the old end and Q goes. */
function trimEndTo(B, side, seg, t, Q) {
  const ll = proj4('EPSG:27700', 'EPSG:4326', Q);
  const hasFrom = !!B.from, hasOpened = !!B.opened;
  if (side === 'start') {
    const same = t >= 1 - 1e-9, i = same ? seg + 1 : seg;   // Q is the vertex seg + 1: keep it, no duplicate
    B.xy = same ? B.xy.slice(i) : [Q, ...B.xy.slice(seg + 1)];
    B.lonlat = same ? B.lonlat.slice(i) : [ll, ...B.lonlat.slice(seg + 1)];
    B.cls = B.cls.slice(same ? i : seg);
    if (hasFrom) B.from = same ? B.from.slice(i) : [null, ...B.from.slice(seg + 1)];
    if (hasOpened) B.opened = B.opened.slice(same ? i : seg);
  } else {
    const same = t <= 1e-9;                                  // Q is the vertex seg: keep it
    B.xy = same ? B.xy.slice(0, seg + 1) : [...B.xy.slice(0, seg + 1), Q];
    B.lonlat = same ? B.lonlat.slice(0, seg + 1) : [...B.lonlat.slice(0, seg + 1), ll];
    B.cls = B.cls.slice(0, same ? seg : seg + 1);
    if (hasFrom) B.from = same ? B.from.slice(0, seg + 1) : [...B.from.slice(0, seg + 1), null];
    if (hasOpened) B.opened = B.opened.slice(0, same ? seg : seg + 1);
  }
}

/**
 * Apply LOOP_GAP_JOINS to the pieces of one line (mutating the pieces it
 * extends, and trimming the end-vertex piece it joins onto). Returns the joins
 * made: {piece, at, gapM, connectorM, advanceM, maxTurnDeg, angleDeg, toPiece, toEnd, at_lonlat}.
 */
export function joinLoopGaps(pieces, rule = LOOP_GAP_JOINS) {
  const box = PLACES[rule.place].box, cosMax = Math.cos(rule.maxAngleDeg * Math.PI / 180);
  const joins = [];
  const consumed = new Set();      // `${piece}:${end}` already joined from the other side
  const len = () => pieces.map(p => lengthOf(p.xy));
  for (let a = 0; a < pieces.length; a++) {
    for (const atEnd of [true, false]) {
      const A = pieces[a], key = `${a}:${atEnd ? 'end' : 'start'}`, L = len();
      if (L[a] < rule.minPieceM || consumed.has(key)) continue;
      const E = atEnd ? A.xy.at(-1) : A.xy[0];
      if (!inBox(A.lonlat[atEnd ? A.lonlat.length - 1 : 0], box)) continue;
      let best = null;
      pieces.forEach((B, b) => { if (b === a) return; const r = nearestOnPolyline(B.xy, E); if (r && (!best || r.d < best.r.d)) best = { r, b }; });
      if (!best || !(best.r.d > rule.minGapM && best.r.d <= rule.maxGapM)) continue;
      const { r, b } = best, B = pieces[b], h = headingOf(A.xy, atEnd, rule.headingM);
      // B's tangent at F, oriented to continue A. At B's own end vertex only the way into B's body counts.
      let dir, seg, t0;
      if (r.atEnd) { dir = r.atEnd === 'start' ? 1 : -1; seg = r.atEnd === 'start' ? 0 : B.xy.length - 2; t0 = r.atEnd === 'start' ? 0 : 1; }
      else { const fwd = unit([B.xy[r.i + 1][0] - B.xy[r.i][0], B.xy[r.i + 1][1] - B.xy[r.i][1]]); dir = fwd[0] * h[0] + fwd[1] * h[1] >= 0 ? 1 : -1; seg = r.i; t0 = r.t; }
      const tF = advanceAlong(B.xy, seg, t0, dir, 0).tangent;
      if (tF[0] * h[0] + tF[1] * h[1] < cosMax) continue;
      if (!r.atEnd && L[b] < rule.minSideM) continue;
      const gapM = Math.hypot(r.pt[0] - E[0], r.pt[1] - E[1]);
      // The target on B: the smallest advance along B's body from F whose joined line has no kink.
      const reach = L[b] - 20, aStart = r.atEnd ? 0 : Math.max(2 * gapM, rule.advanceMinM);
      const tail = inwardFrom(A.xy, atEnd, 40).reverse();         // A's last 40 m, ending at E
      let chosen = null;
      for (let adv = aStart; adv <= Math.min(rule.advanceMaxM, reach); adv += rule.advanceStepM) {
        const q = advanceAlong(B.xy, seg, t0, dir, adv), pts = hermite(E, h, q.pt, q.tangent, rule.stepM);
        const body = bodyFrom(B.xy, q.seg, q.t, dir, 40);
        const turn = maxTurnOf([...tail, ...pts, ...body.slice(1)], rule.turnM, E, q.pt);
        if (!chosen || turn < chosen.turn - 1e-9) chosen = { adv, q, pts, turn };
        if (turn <= rule.maxTurnDeg) break;
      }
      if (!chosen) continue;
      const { q, pts } = chosen, connectorM = lengthOf([E, ...pts]);
      const ll = pts.map(p => proj4('EPSG:27700', 'EPSG:4326', p));
      const cl = A.cls[atEnd ? A.cls.length - 1 : 0];
      A.from ||= A.xy.map(() => (A.source === 'osm' ? A.place : null));
      A.opened ||= A.cls.map(() => 0);
      const tags = pts.map(() => rule.label), cls = pts.map(() => cl), opened = pts.map(() => 0);
      if (atEnd) { A.xy.push(...pts); A.lonlat.push(...ll); A.cls.push(...cls); A.from.push(...tags); A.opened.push(...opened); }
      else { A.xy.unshift(...[...pts].reverse()); A.lonlat.unshift(...[...ll].reverse()); A.cls.unshift(...cls); A.from.unshift(...tags); A.opened.unshift(...opened); }
      // The other half of a track met end to end begins at Q now, and is not joined again from its side.
      if (r.atEnd) { trimEndTo(B, r.atEnd, q.seg, q.t, q.pt); consumed.add(`${b}:${r.atEnd}`); }
      joins.push({ piece: a, at: atEnd ? 'end' : 'start', gapM, connectorM, advanceM: chosen.adv, maxTurnDeg: chosen.turn,
        angleDeg: Math.acos(Math.min(1, tF[0] * h[0] + tF[1] * h[1])) * 180 / Math.PI, toPiece: b, toEnd: r.atEnd ?? null,
        at_lonlat: proj4('EPSG:27700', 'EPSG:4326', E) });
    }
  }
  return joins;
}

/**
 * STRATFORD_1617_OPEN (train-stratford-1617). The DLR trains of Stratford
 * International stand at the Stratford DLR station's platforms 16 and 17,
 * where OSM tags the whole 324 to 352 m stretch tunnel=yes (the Jubilee and
 * the main-line railway run beside and over it), so the surface railway drew
 * nothing there and the trains vanished at their stop. In reality the platforms
 * are open to the sky. The tunnel segments whose midpoints lie within halfM
 * (along the piece) of the stop's foot on the DLR piece it lies beside are
 * drawn as open track at grade (class surface, opened: the output lists them as
 * coveredWays, which src/tube-surface-rail.js buildDlrPath lays at grade
 * whatever the DLR profile says; changing the class alone would not do, because
 * the profile there reads as tunnel). halfM was tuned in 75 to 150 until every
 * car of a dwelling train is drawn: 100 opens 200 m.
 */
export const STRATFORD_1617_OPEN = { lineId: 'dlr', stop: /^Stratford DLR Station/, reachM: 100, halfM: 150 };

export function openStratford1617(pieces, stops, rule = STRATFORD_1617_OPEN) {
  const out = [];
  for (const s of stops.filter(x => rule.stop.test(x.name))) {
    let best = null;
    pieces.forEach((piece, pi) => { const r = nearestOnPolyline(piece.xy, [s.e, s.n]); if (r && r.d <= rule.reachM && (!best || r.d < best.r.d)) best = { r, pi }; });
    if (!best) continue;
    const { r, pi } = best, piece = pieces[pi];
    if (piece.cls[r.i] !== 'tunnel') continue;
    const arc = [0]; for (let i = 0; i < piece.xy.length - 1; i++) arc.push(arc[i] + Math.hypot(piece.xy[i + 1][0] - piece.xy[i][0], piece.xy[i + 1][1] - piece.xy[i][1]));
    const foot = arc[r.i] + r.t * (arc[r.i + 1] - arc[r.i]);
    piece.opened ||= piece.cls.map(() => 0);
    let m = 0, i0 = null, i1 = null;
    for (let i = 0; i < piece.cls.length; i++) {
      if (piece.cls[i] !== 'tunnel') continue;
      if (Math.abs((arc[i] + arc[i + 1]) / 2 - foot) > rule.halfM) continue;
      piece.cls[i] = 'surface'; piece.opened[i] = 1; m += arc[i + 1] - arc[i];
      i0 ??= i; i1 = i + 1;
    }
    if (m) out.push({ piece: pi, i0, i1, lengthM: Math.round(m), station: s.name, stationDistanceM: Math.round(r.d) });
  }
  return out;
}

/**
 * LOOP_JOG_SMOOTH (train-hainault-gaps, fix round 2). Where the drawn Hainault
 * loop kinks sharply and the train map's own fairing (surface-train-map.js
 * kinkWindows: a turn over 20 degrees in 8 m is replaced by a gentle Hermite
 * blend, up to 10 m off the drawn track) would carry the cars more than a metre
 * off it, the DRAWN track is replaced by that same blend, so the trains and the
 * rails agree. Two such places exist at e0675d7: by Grange Hill, a 28.6 m
 * dogleg left where the v2 piece's end was joined to the OSM track (s01:R), that
 * cars cut by up to 8 m; and 160 m north of Hainault, a vertex 6.7 m out of line
 * that they cut by 1.9 m. Every other kink on the loop already keeps the cars
 * within 1 m, and is left alone.
 *
 * For each piece of the line with a vertex inside the place's box: kink
 * vertices are those where the polyline turns more than kinkDeg between the
 * kinkScaleM metres either side; kinks within clusterM of each other form a
 * cluster. Each cluster's window is the smallest margin (marginsM, either side)
 * whose cubic-Hermite replacement (tangents over tangentM metres beyond the
 * window, sampled every stepM) turns no more than calmDeg per stepM, else the
 * gentlest. A window is applied only when it lies inside the piece (not at an
 * end, which the train map handles), every segment in it is plain surface track,
 * and the replacement strays more than minStrayM from the old polyline: the
 * drawn track moves by that stray, no more. Points of the replacement take the
 * `from` tag of the old vertex nearest in proportion along the window.
 */
export const LOOP_JOG_SMOOTH = {
  lineId: 'central', place: 'central-hainault',
  kinkDeg: 20, kinkScaleM: 8, clusterM: 40, marginsM: [10, 20, 30, 45, 60, 80, 100, 130, 160, 200],
  tangentM: 12, stepM: 4, calmDeg: 3.5, minStrayM: 1,
};
export function smoothLoopJogs(pieces, rule = LOOP_JOG_SMOOTH) {
  const box = PLACES[rule.place].box, done = [];
  const angle = (a, b) => { const la = Math.hypot(...a), lb = Math.hypot(...b); return la > 1e-9 && lb > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * 180 / Math.PI : 0; };
  pieces.forEach((piece, pi) => {
    const n = piece.xy.length;
    if (n < 4 || !piece.lonlat.some(ll => inBox(ll, box))) return;
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(piece.xy[i][0] - piece.xy[i - 1][0], piece.xy[i][1] - piece.xy[i - 1][1]));
    const L = cum[n - 1];
    const seg = s => { if (s <= 0) return 0; if (s >= L) return n - 2; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lo; };
    const at = s => { const i = seg(s), l = cum[i + 1] - cum[i], t = l > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / l)) : 0; return [piece.xy[i][0] + (piece.xy[i + 1][0] - piece.xy[i][0]) * t, piece.xy[i][1] + (piece.xy[i + 1][1] - piece.xy[i][1]) * t]; };
    const turnAt = (s, d) => { const a = at(s - d), b = at(s), c = at(s + d); return angle([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]); };
    const kinks = [];
    for (let i = 1; i < n - 1; i++) { const d = Math.min(rule.kinkScaleM, cum[i], L - cum[i]); if (d >= 0.5 && inBox(piece.lonlat[i], box) && turnAt(cum[i], d) > rule.kinkDeg) kinks.push(cum[i]); }
    if (!kinks.length) return;
    const fairWindow = (a, b) => {
      let best = null;
      for (const e of rule.marginsM) {
        const w0 = Math.max(0, a - e), w1 = Math.min(L, b + e);
        const A = at(w0), B = at(w1), ch = unit([B[0] - A[0], B[1] - A[1]]);
        let tA = null, tB = null;
        if (w0 > 0.5) { const q = at(Math.max(0, w0 - rule.tangentM)); tA = unit([A[0] - q[0], A[1] - q[1]]); }
        if (w1 < L - 0.5) { const q = at(Math.min(L, w1 + rule.tangentM)); tB = unit([q[0] - B[0], q[1] - B[1]]); }
        if (!tA && !tB) { tA = ch; tB = ch; } else if (!tA) tA = unit([2 * ch[0] - tB[0], 2 * ch[1] - tB[1]]); else if (!tB) tB = unit([2 * ch[0] - tA[0], 2 * ch[1] - tA[1]]);
        const pts = [A, ...hermite(A, tA, B, tB, rule.stepM)];
        let turn = 0, prev = tA;
        for (let k = 1; k < pts.length; k++) { const v = [pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]; turn = Math.max(turn, angle(prev, v)); prev = v; }
        turn = Math.max(turn, angle(prev, tB));
        const w = { w0, w1, pts, turn };
        if (!best || turn < best.turn - 1e-9) best = w;
        if (turn <= rule.calmDeg) break;
        if (w0 === 0 && w1 === L) break;
      }
      return best;
    };
    const windows = [];
    let a = NaN, b = NaN;
    const close = () => {
      let w = fairWindow(a, b);
      while (windows.length && w.w0 < windows.at(-1).w1 + rule.kinkScaleM) { a = windows.pop().a; w = fairWindow(a, b); }
      windows.push({ ...w, a, b });
    };
    for (const s of kinks) { if (Number.isFinite(b) && s - b <= rule.clusterM) b = s; else { if (Number.isFinite(a)) close(); a = s; b = s; } }
    if (Number.isFinite(a)) close();
    // Which windows are applied: inside the piece, plain surface throughout, straying more than minStrayM.
    const stray = w => { let worst = 0; for (const p of w.pts) { const r = nearestOnPolyline(piece.xy, p); if (r.d > worst) worst = r.d; } return worst; };
    const apply = windows.filter(w => {
      if (w.w0 <= 0 || w.w1 >= L) return false;
      for (let i = seg(w.w0); i <= seg(w.w1); i++) { if (piece.cls[i] !== 'surface' || piece.opened?.[i]) return false; }
      w.strayM = stray(w);
      return w.strayM > rule.minStrayM;
    });
    if (!apply.length) return;
    // Rebuilt vertex by vertex (cls and opened belong to the segment that begins at the vertex; the last is dropped).
    const out = { xy: [], lonlat: [], cls: [], from: piece.from ? [] : null, opened: piece.opened ? [] : null };
    const push = (p, ll, cls, from, opened) => { out.xy.push(p); out.lonlat.push(ll); out.cls.push(cls); if (out.from) out.from.push(from); if (out.opened) out.opened.push(opened); };
    const keep = i => push(piece.xy[i], piece.lonlat[i], piece.cls[i] ?? 'surface', piece.from?.[i], piece.opened?.[i] ?? 0);
    let i = 0;
    for (const w of apply) {
      // Vertices before the window, then its start point, the blend, and its end point; the old vertices inside it go.
      while (i < n && cum[i] < w.w0 - 1e-6) { keep(i); i++; }
      const tag = f => { if (!piece.from) return undefined; const s = w.w0 + f * (w.w1 - w.w0), j = seg(s), t = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0; return piece.from[t < 0.5 ? j : j + 1]; };
      w.pts.forEach((p, k) => push(p, proj4('EPSG:27700', 'EPSG:4326', p), 'surface', tag(k / (w.pts.length - 1)), 0));
      while (i < n && cum[i] <= w.w1 + 1e-6) i++;
      done.push({ piece: pi, fromM: Math.round(w.w0), toM: Math.round(w.w1), lengthM: Math.round(w.w1 - w.w0), strayM: w.strayM, turnDeg: w.turn, at_lonlat: proj4('EPSG:27700', 'EPSG:4326', at((w.w0 + w.w1) / 2)) });
    }
    while (i < n) { keep(i); i++; }
    out.cls.pop(); if (out.opened) out.opened.pop();
    piece.xy = out.xy; piece.lonlat = out.lonlat; piece.cls = out.cls;
    if (out.from) piece.from = out.from;
    if (out.opened) piece.opened = out.opened;
  });
  return done;
}
// ── /s02:F rules ──

export async function build({ source = DEFAULT_SOURCE, overgroundPath = path.join(ROOT, 'public/data/overground.json'), osmCache = null, probe = null, probeOnly = false } = {}) {
  const src = JSON.parse(await readFile(source, 'utf8'));
  const og = JSON.parse(await readFile(overgroundPath, 'utf8'));
  const report = [];
  const dlrHeight = dlrHeightAt();
  const dlrProfileData = JSON.parse(await readFile(path.join(ROOT, 'src/dlr-profile-data.json'), 'utf8'));

  // s01:R: OSM track for the v2 delivery's gaps (cached Overpass answer).
  const osmAnswer = osmCache ?? await loadOsmCache();
  // s01:R: the OSM probe that tells a real tunnel from a tunnel stub.
  const stubProbe = probe ?? await readFile(STUB_PROBE_FILE, 'utf8').then(JSON.parse, () => null);
  const missingProbes = [];
  // Pass A: collapse each line.
  const lines = [];
  for (const L of src.lines) {
    if (EXCLUDED.has(L.id)) { report.push(`${L.id}: excluded (D-041 item 1, main-line wave)`); continue; }
    const id = ID_MAP[L.id] || L.id;
    const osm = osmTrailsFor(id, osmAnswer);
    const { pieces, droppedM, sourceM, deckSeparatedM, osm: osmReport } = collapseLine(L.branches, id === 'dlr' ? { heightAt: dlrHeight, supplement: profileTrails(dlrProfileData), osm } : { osm });
    // s01:R: where OSM_GAPS asks, the classes of kept track from today's OSM (the Lewisham terminus).
    const reclassed = (OSM_GAPS[id] || []).filter(([, o]) => o?.reclass)
      .flatMap(([place, o]) => reclassFromOsm(pieces, placeTrails(osmAnswer, place, id, o), PLACES[place].box).map(c => ({ place, ...c })));
    for (const [place, group] of Object.entries(Object.groupBy(reclassed, c => c.place))) {
      const by = {}; for (const c of group) by[`${c.from}->${c.to}`] = (by[`${c.from}->${c.to}`] || 0) + c.lengthM;
      report.push(`${id} classes from OSM in ${place}: ${Object.entries(by).map(([k, m]) => `${k} ${Math.round(m)} m`).join(', ')}`);
    }
    // ── s02:F rules ── (named rules; see the section above build())
    if (id === LOOP_GAP_JOINS.lineId) {
      for (const j of joinLoopGaps(pieces)) report.push(`central gap joined: ${j.gapM.toFixed(1)} m at ${j.at_lonlat[1].toFixed(5)},${j.at_lonlat[0].toFixed(5)}, connector ${j.connectorM.toFixed(1)} m (target ${j.advanceM} m along the other piece), angle ${j.angleDeg.toFixed(0)} deg, sharpest turn ${j.maxTurnDeg.toFixed(1)} deg per ${LOOP_GAP_JOINS.turnM} m (s02:F)`);
    }
    if (id === LOOP_JOG_SMOOTH.lineId) {
      for (const j of smoothLoopJogs(pieces)) report.push(`central jog smoothed: ${j.lengthM} m stretch at ${j.at_lonlat[1].toFixed(5)},${j.at_lonlat[0].toFixed(5)}, drawn track moved by up to ${j.strayM.toFixed(1)} m, sharpest turn ${j.turnDeg.toFixed(1)} deg per ${LOOP_JOG_SMOOTH.stepM} m (s02:F)`);
    }
    if (id === STRATFORD_1617_OPEN.lineId) {
      const f1617 = (L.stations || []).filter(s => Number.isFinite(s.lon) && Number.isFinite(s.lat)).map(s => { const [e, n] = toBng([s.lon, s.lat]); return { name: s.name, e, n }; });
      for (const o of openStratford1617(pieces, f1617)) report.push(`dlr platforms opened at Stratford 16/17: ${o.lengthM} m (${o.station}, ${o.stationDistanceM} m from the track; s02:F)`);
    }
    // ── /s02:F rules ──
    // s01:R: tunnel stubs beside the line's own open track (West Hampstead),
    // unless today's OSM has the line in tunnel there (Kensal Green).
    const isRealTunnel = piece => {
      const r = realTunnelFromProbe(id, piece, stubProbe);
      if (r === undefined) { missingProbes.push({ key: stubKey(id, piece), points: [piece.lonlat[0], piece.lonlat[Math.floor(piece.lonlat.length / 2)], piece.lonlat.at(-1)] }); return probeOnly ? 'unprobed' : null; }
      return r;
    };
    // The covered ways under road bridges first, so a stub is judged against
    // the open track as drawn; then the stubs (before the stations' covered
    // ways, whose test asks which track is nearest a stop: at Wembley Park the
    // stub was); then once more for any stub the stations' covered ways have
    // put beside open track.
    const coveredWays = pieces.flatMap((piece, pi) => openCoveredWays(piece).map(c => ({ piece: pi, ...c })));
    const stubs = dropTunnelStubs(pieces, { isRealTunnel });
    const stops = (L.stations || []).filter(s => Number.isFinite(s.lon) && Number.isFinite(s.lat)).map(s => { const [e, n] = toBng([s.lon, s.lat]); return { ...s, e, n }; });
    // s01:R: stations under a road bridge or their own building (Preston Road, Lewisham DLR).
    const stationCoveredWays = openStationCoveredWays(pieces, stops);
    const stubs2 = dropTunnelStubs(pieces, { isRealTunnel });
    stubs.push(...stubs2); stubs.spared.push(...stubs2.spared.filter(sp => !stubs.spared.some(x => x.piece === sp.piece)));
    for (const sp of stubs.spared) report.push(`${id} tunnel stub KEPT, a real tunnel: ${sp.lengthM} m at ${stubKey(id, sp.piece).split('@')[1]}: ${sp.evidence}`);
    const v2Pieces = pieces.filter(p => p.source !== 'osm');
    const stations = stops.map(s => {
      const near = nearestClass(pieces, [s.e, s.n]);
      // The source gap repair (transform 4) asks which stops the v2 track misses.
      const v2 = nearestClass(v2Pieces, [s.e, s.n]);
      return { name: s.name, naptan: s.naptan, lon: s.lon, lat: s.lat, e: s.e, n: s.n,
        surface: !!near && near.cls !== 'tunnel', trackClass: near?.cls ?? null, railOffsetM: near ? Math.round(near.d) : null, v2Orphan: !v2 };
    });
    for (const st of stubs) {
      const mid = st.piece.lonlat[Math.floor(st.piece.lonlat.length / 2)], [e, n] = toBng(mid);
      let nearest = null; for (const s of stations) { const d = Math.hypot(s.e - e, s.n - n); if (!nearest || d < nearest.d) nearest = { d, s }; }
      st.report = `${id} tunnel stub dropped: ${st.lengthM} m at ${mid[1].toFixed(5)},${mid[0].toFixed(5)}, ${Math.round(nearest?.d ?? 0)} m from ${nearest?.s.name.replace(/ (Underground|DLR) Station$/, '')}, every point within ${st.maxDistanceM} m of the line's open track`;
      report.push(st.report);
    }
    for (const c of stationCoveredWays) report.push(`${id} station covered way opened: ${c.lengthM} m at ${c.station.replace(/ (Underground|DLR) Station$/, '')} (${c.stationDistanceM} m)`);
    if (osmReport) {
      for (const a of osmReport.added) report.push(`${id} OSM track added: ${a.lengthM} m (${a.place}; ${a.classes.join(', ')})`);
      for (const x of osmReport.extended) report.push(`${id} OSM track extends a piece at its ${x.at}: ${x.lengthM} m (${x.place}; ${x.classes.join(', ')})`);
    }
    lines.push({ id, sourceId: L.id, name: L.name, colour: L.colour, pieces, stations, droppedM, sourceM, coveredWays, deckSeparatedM,
      osm: osmReport, stubs: stubs.map(s => ({ lengthM: s.lengthM, maxDistanceM: s.maxDistanceM, report: s.report })), stationCoveredWays,
      stubsKept: (stubs.spared || []).map(sp => ({ lengthM: sp.lengthM, at: stubKey(id, sp.piece).split('@')[1], evidence: sp.evidence })),
      sources: L.sources, confidence: L.confidence });
  }
  if (probeOnly) return { missingProbes };
  if (missingProbes.length) throw new Error(`${missingProbes.length} tunnel stub candidates have no OSM probe (${missingProbes.map(m => m.key).join('; ')}): run node scripts/prepare-tube-surface.mjs --probe-stubs`);
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
  // s01:R: in two rounds. First every line's corridors from v2 (with any
  // points appended to them), in the data's order, exactly as before; then
  // the corridors OSM adds, which only add: where one runs beside a corridor
  // already drawn (the Central's Ealing Broadway branch beside the District
  // into Ealing Broadway) it is that corridor's band, and nothing drawn
  // before changes hands.
  for (const line of lines) { line.own = []; line.shared = []; }
  for (const round of ['v2', 'osm']) for (const line of lines) {
    const pieces = line.pieces.filter(p => (p.source === 'osm') === (round === 'osm'));
    if (!pieces.length) continue;
    const { own, shared } = splitShared(line.id, pieces, owners, { heightAt: line.id === 'dlr' ? dlrHeight : null });
    const base = line.own.length;
    line.own.push(...own);
    line.shared.push(...shared);
    own.forEach((piece, k) => {
      const key = `tube:${line.id}:${base + k}`;
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
      if (piece.source) b.source = piece.source; // s30:R fix round 2: open DLR track v2 lacks, from the shared profile; s01:R 'osm'
      if (piece.source === 'osm') b.place = piece.place; // s01:R: which gap (scripts/fetch-tube-surface-osm.mjs PLACES)
      const extended = piece.source === 'osm' ? [] : fromRanges(piece.from).map(({ p0, p1, place }) => ({ p0, p1, from: place }));
      if (extended.length) b.extended = extended; // s01:R: points appended to a corridor (to the buffers): from an OSM place, or the DLR profile
      const opened = openedRanges(piece.opened);
      if (opened.length) b.coveredWays = opened; // s01:R: segments tagged tunnel in OSM, drawn open (a covered way)
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
      stations: line.stations.map(({ e, n, v2Orphan, ...s }) => s),
      portals,
      summary: {
        sourceTrailsM: Math.round(line.sourceM), collapsedM: Math.round(line.pieces.reduce((s, p) => s + lengthOf(p.xy), 0)),
        drawnM: Math.round(ownM), drawnOpenM: Math.round(openOwnM), sharedM: sharedWith,
        coveredWaysOpened: line.coveredWays.length, coveredWaysM: line.coveredWays.reduce((s, c) => s + c.lengthM, 0),
        ...(line.id === 'dlr' ? { deckSeparatedM: Math.round(line.deckSeparatedM), fromProfileM: Math.round(line.own.filter(p => p.source === 'dlr-profile').reduce((s, p) => s + lengthOf(p.xy), 0)) } : {}),
        // s01:R: OSM track for the v2 gaps, tunnel stubs dropped, stations' covered ways opened.
        ...(line.osm ? { osmAddedM: Math.round(line.osm.addedM), osmExtendedM: Math.round(line.osm.extendedM) } : {}),
        ...(line.stubs.length ? { tunnelStubsDropped: line.stubs.map(s => s.lengthM) } : {}),
        ...(line.stubsKept.length ? { tunnelStubsKept: line.stubsKept } : {}),
        ...(line.stationCoveredWays.length ? { stationCoveredWays: line.stationCoveredWays.map(c => ({ station: c.station, lengthM: c.lengthM })) } : {}),
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
        coveredWays: 'A tunnel run under 60 m between open track (a road overbridge or covered way) is drawn as open track at grade; summary.coveredWaysOpened counts them. s01:R: so is a tunnel run under 150 m at a stop of the line, with open track either side at least 150 m long or running to the buffers (the station under a road bridge or its own building; summary.stationCoveredWays). branches[].coveredWays lists every segment range so opened, {i0,i1}.',
        osm: 'Sprint 01Oct26h (s01:R): open-air track the v2 delivery lacks, from OpenStreetMap through scripts/fetch-tube-surface-osm.mjs (the line\'s own route relations in a box around each gap, cached Overpass answer, classes by pipeline-v2.py\'s rules), merged after v2 by the same coverage test: branches with source "osm" (and place) are new corridors (the Central\'s Ealing Broadway branch and Hainault loop, the Metropolitan from Harrow-on-the-Hill to Rayners Lane, the DLR into Stratford); branches[].extended {p0,p1,from} are points appended to a corridor to its buffers (from an OSM place: Epping, Stratford DLR; from "dlr-profile": the last metres to platform 4a at Stratford), and the Hainault loop is appended to the short v2 pieces at Hainault. summary.osmAddedM and osmExtendedM.',
        tunnelStubs: 'Sprint 01Oct26h (s01:R): a piece that is tunnel throughout, under 400 m, lying wholly within 32 m of the line\'s own open track is the other running track\'s covered stretch and is dropped (the Jubilee at West Hampstead); summary.tunnelStubsDropped lists their lengths, and the build prints each with its place. A candidate is kept when today\'s OSM has a way of the line tagged tunnel within 25 m of its middle (a cached Overpass probe, scripts/.cache/tube-surface-stub-probe.json): summary.tunnelStubsKept, with the way as evidence (the Kensal Green Tunnel, for one).',
        dlrHeights: 'DLR deck heights come from src/dlr-deck-heights.json via src/dlr-profile.js (EA LiDAR DSM 1m, flagged fallback); not repeated here.',
        dlrLevels: `The DLR's level is also its profile deck: after the collapse, a stretch beside kept track but on a deck more than ${DLR_TWIN_DECK_TOL_M} m away is added from ${DLR_MIN_DECK_PIECE_M} m (summary.deckSeparatedM), and a stretch on a deck above ${DLR_SHARE_MAX_DECK_M} m is never shared (the DLR draws it at its own height). Branches with source "dlr-profile" are raised track the v2 source lacks, taken from src/dlr-profile-data.json (summary.fromProfileM).`,
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
  if (process.argv.includes('--probe-stubs')) {
    // Every stub candidate (whole-tunnel piece beside the line's open track),
    // probed in one cached Overpass query: the railway ways within 60 m of its
    // start, middle and end, with tags and geometry.
    const { missingProbes } = await build({ source: arg('--source', DEFAULT_SOURCE), overgroundPath: arg('--overground', path.join(ROOT, 'public/data/overground.json')), probe: { candidates: {}, ways: [] }, probeOnly: true });
    const around = missingProbes.flatMap(m => m.points.map(([lon, lat]) => `  way(around:60,${lat.toFixed(6)},${lon.toFixed(6)})["railway"~"^(subway|light_rail|rail)$"];`));
    const query = `[out:json][timeout:90];\n(\n${around.join('\n')}\n);\nout tags geom;\n`;
    const { overpass } = await import('./fetch-tube-surface-osm.mjs');
    const json = await overpass(query);
    const out = { query, fetched: 'Overpass API', candidates: Object.fromEntries(missingProbes.map(m => [m.key, { points: m.points }])), ways: json.elements.filter(e => e.type === 'way').map(w => ({ id: w.id, tags: w.tags, geometry: w.geometry })) };
    await writeFile(STUB_PROBE_FILE, JSON.stringify(out));
    console.log(`probed ${missingProbes.length} stub candidates: ${out.ways.length} ways cached in ${STUB_PROBE_FILE}`);
    process.exit(0);
  }
  const { data, report } = await build({ source: arg('--source', DEFAULT_SOURCE), overgroundPath: arg('--overground', path.join(ROOT, 'public/data/overground.json')) });
  await writeFile(outPath, JSON.stringify(data));
  console.log(report.join('\n'));
  console.log(`overground shared bands: ${data.overgroundShared.map(b => `${b.overground}[${b.branch}] ${b.j0}-${b.j1} ${b.lines.join('+')}`).join('; ')}`);
  const pts = data.lines.reduce((s, l) => s + l.branches.reduce((t, b) => t + b.points.length, 0), 0);
  console.log(`wrote ${outPath}: ${data.lines.length} lines, ${data.lines.reduce((s, l) => s + l.branches.length, 0)} corridors, ${pts} points`);
}
