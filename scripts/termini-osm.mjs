// Track to the termini beyond the M25 (sprint 02Oct26f, D-048 item 7, lane T).
//
// Jordan, 02Oct26f: every line that leaves the map runs on to its terminus,
// "just a tunnel or track in empty space". Three branches need data work, and
// none of it is missing track so much as track the collapse lost:
//
//  * The Central needs nothing: branch 1 of public/data/tube-surface.json
//    already runs to the Epping buffers (R's central-epping place, 01Oct26h).
//  * The Metropolitan beyond Rickmansworth has three faults. (a) The Chesham
//    branch and the Chalfont & Latimer end of the main line stop 32 m short of
//    each other. (b) The Amersham branch starts 48 m short of the Chesham
//    branch: the twin collapse dropped the 0.9 km where the Amersham main line
//    runs 4 to 7 m beside the Chesham single line. (c) Five 2-point
//    fragments (863 m in all) lie 3 to 6 m beside the main line, the other
//    running track of the same corridor. applyTermini() drops the fragments
//    (dropTwinFragments) and closes the gaps along the OSM trail
//    (closeJunctionGaps), inside the Chilterns box only, with no reclassing, so
//    every in-map sample is byte-identical.
//  * The Weaver stops 520 m short of Cheshunt (the v2 delivery's last point is
//    the end of a stub). scripts/extend-overground-termini.mjs appends the
//    cached OSM stretch to public/data/overground.json; it uses the helpers
//    here (terminiTrails, weaverExtension).
//
// Inputs are OSM only, through one NEW cache file, scripts/.cache/termini-osm-overpass.json
// (additive: the shared tube-surface-osm-overpass.json is never refreshed or
// written). It is made by the same Overpass query builder as fetch-tube-surface-osm.mjs,
// or offline from the Prog relation dumps (read-only; never edited):
//   node scripts/termini-osm.mjs            write the cache if it is absent (Overpass)
//   node scripts/termini-osm.mjs --refresh  fetch again
//   node scripts/termini-osm.mjs --from-raw build it from the relation dumps in
//                                           Working/prog-rail-geometry-11Jul26s/_raw/
// The file records its `source`.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { buildQuery, overpass, clipWay, stitchTrails, encodeClasses, earthworksClass } from './fetch-tube-surface-osm.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TERMINI_CACHE_FILE = path.join(SCRIPT_DIR, '.cache', 'termini-osm-overpass.json');
export const PROG_RAW_DIR = '/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/prog-rail-geometry-11Jul26s/_raw';
/** The relation dumps the offline build reads (relation id: file in PROG_RAW_DIR). */
export const PROG_RAW_FILES = ['osm_rel_full_102783.json', 'osm_rel_full_7673622.json', 'e1b0ff412e65.json', '7b025bce54d9.json', 'osm_rel_full_9105026.json', 'osm_rel_full_9105027.json'];

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const toBng = ([lon, lat]) => proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
const fromBng = ([e, n]) => proj4('EPSG:27700', 'EPSG:4326', [e, n]);

/** The two places, boxes [south, west, north, east] (WGS84). */
export const TERMINI_PLACES = {
  'metropolitan-chilterns': { lines: ['metropolitan'], box: [51.640, -0.6200, 51.7120, -0.4800], note: 'Rickmansworth to Chalfont & Latimer, Amersham and Chesham' },
  'weaver-cheshunt': { lines: ['weaver'], box: [51.6880, -0.0420, 51.7060, -0.0170], note: 'Theobalds Grove to Cheshunt' },
};
/** Route relation names: the Weaver is not in fetch-tube-surface-osm.mjs's RELATION_NAME. */
export const TERMINI_RELATION_NAME = { metropolitan: /^metropolitan line:/i, weaver: /^weaver line:/i };
const TRACK_ROLES = new Set(['', 'track', 'forward', 'backward', 'outer', 'inner']);
const TRACK_RAILWAY = new Set(['rail', 'subway', 'light_rail']);
export const TERMINI_LABEL = 'termini-osm';

// ---- the cache ------------------------------------------------------------

export async function fetchTerminiOverpass({ cacheFile = TERMINI_CACHE_FILE } = {}) {
  const query = buildQuery(TERMINI_PLACES);
  const json = await overpass(query);
  json.query = query;
  json.source = 'Overpass API';
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(json));
  console.log('cached', json.elements.length, 'elements to', cacheFile);
  return json;
}

/**
 * The answer shape of the Overpass query ({elements: [way with geometry, ...,
 * relation]}), built offline from Prog's relation dumps: each way gets its
 * geometry from the dump's nodes, and each relation is kept with its members.
 * Only the line's own ways are in the dumps, which is all lineWays reads.
 */
export async function answerFromRaw(rawDir = PROG_RAW_DIR, files = PROG_RAW_FILES) {
  const elements = [], seenWay = new Set(), seenRel = new Set();
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(rawDir, f), 'utf8'));
    const nodes = new Map(j.elements.filter(e => e.type === 'node').map(n => [n.id, n]));
    for (const e of j.elements) {
      if (e.type === 'relation' && TERMINI_RELATION_NAME && Object.values(TERMINI_RELATION_NAME).some(re => re.test(e.tags?.name ?? '')) && !seenRel.has(e.id)) {
        seenRel.add(e.id); elements.push({ type: 'relation', id: e.id, members: e.members, tags: e.tags });
      } else if (e.type === 'way' && !seenWay.has(e.id) && TRACK_RAILWAY.has(e.tags?.railway)) {
        const geometry = e.nodes.map(id => { const n = nodes.get(id); return n ? { lat: n.lat, lon: n.lon } : null; });
        if (geometry.some(g => !g)) continue;
        seenWay.add(e.id); elements.push({ type: 'way', id: e.id, nodes: e.nodes, tags: e.tags, geometry });
      }
    }
  }
  return { version: 0.6, source: 'Prog rail-geometry 11Jul26s relation dumps (offline: scripts/termini-osm.mjs --from-raw)', files, elements };
}

export async function loadTerminiCache(file = TERMINI_CACHE_FILE) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { throw new Error(`${file} is missing: run node scripts/termini-osm.mjs (Overpass) or node scripts/termini-osm.mjs --from-raw (offline) (${e.message})`); }
}

// ---- the line's ways and trails ---------------------------------------------

/** lineWays of fetch-tube-surface-osm.mjs, with this module's relation names (it has no Weaver). */
export function terminiLineWays(osm, lineId) {
  const ways = new Map(osm.elements.filter(e => e.type === 'way').map(w => [w.id, w]));
  const out = new Map();
  for (const r of osm.elements) {
    if (r.type !== 'relation' || !TERMINI_RELATION_NAME[lineId]?.test(r.tags?.name ?? '')) continue;
    for (const m of r.members || []) {
      if (m.type !== 'way' || !TRACK_ROLES.has(m.role ?? '')) continue;
      const w = ways.get(m.ref);
      if (!w || !TRACK_RAILWAY.has(w.tags?.railway)) continue;
      if (!out.has(w.id)) out.set(w.id, { id: w.id, nodes: w.nodes, coords: w.geometry.map(g => [g.lon, g.lat]), tags: w.tags, cls: earthworksClass(w.tags), relations: [] });
      out.get(w.id).relations.push(r.id);
    }
  }
  return out;
}

/** The line's trails inside a place's box (stitched, classed): [{points, segments, osmWays, source, place}]. */
export function terminiTrails(osm, placeKey, lineId) {
  const place = TERMINI_PLACES[placeKey];
  const clipped = [...terminiLineWays(osm, lineId).values()].flatMap(w => clipWay(w, place.box));
  return stitchTrails(clipped).map(t => ({ points: t.points, segments: encodeClasses(t.cls), cls: t.cls, osmWays: t.osmWays, source: 'osm', place: placeKey }));
}

// ---- geometry (BNG metres) ----------------------------------------------------

const lenXY = xy => { let s = 0; for (let i = 1; i < xy.length; i++) s += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]); return s; };
const inBoxLL = ([lon, lat], [S, W, N, E]) => lat >= S && lat <= N && lon >= W && lon <= E;

/** Nearest point on a polyline: {d, i, t, p} (segment i, parameter t). */
export function nearestOnPolyline(xy, p) {
  let best = null;
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { d, i, t, p: q };
  }
  return best;
}
/** Points along a polyline no more than stepM apart (the vertices kept), with the class of each point's segment. */
export function densifyXY(xy, cls, stepM = 10) {
  const out = { xy: [], cls: [] };
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i], b = xy[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / stepM));
    for (let k = 0; k < n; k++) { out.xy.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); out.cls.push(cls[i]); }
  }
  out.xy.push(xy.at(-1)); out.cls.push(cls.at(-1));
  return out;
}
/** Points every <= stepM along a polyline (for coverage tests). */
function sampleXY(xy, stepM = 10) { return densifyXY(xy, xy.slice(1).map(() => 'x'), stepM).xy; }
/** Nearest other piece: {d, piece, p}. */
function nearestOtherPiece(pieces, self, p) {
  let best = null;
  for (const q of pieces) {
    if (q === self || q.xy.length < 2) continue;
    const r = nearestOnPolyline(q.xy, p);
    if (!best || r.d < best.d) best = { d: r.d, piece: q, p: r.p, i: r.i };
  }
  return best;
}

// ---- the Metropolitan: fragments dropped, junction gaps closed ----------------

export const FRAGMENT_MAX_M = 400, FRAGMENT_NEAR_M = 32;
export const GAP_MIN_M = 6, GAP_MAX_M = 60, TRAIL_NEAR_M = 25, WALK_STOP_M = 6, PARALLEL_RUN_POINTS = 15, WALK_MAX_M = 1600;

/**
 * Drop each piece that lies wholly inside the box, is shorter than 400 m and
 * runs, at every 10 m sample (any class), within 32 m in plan of another kept
 * piece: the other running track's remnant. Mutates `pieces`; returns the dropped.
 */
export function dropTwinFragments(pieces, box) {
  const wholly = p => p.lonlat.every(ll => inBoxLL(ll, box));
  const cands = pieces.filter(p => wholly(p) && lenXY(p.xy) < FRAGMENT_MAX_M);
  const dropped = [];
  for (const c of cands) {
    const others = pieces.filter(q => q !== c && !cands.includes(q));
    const near = sampleXY(c.xy, 10).every(p => others.some(q => nearestOnPolyline(q.xy, p).d <= FRAGMENT_NEAR_M));
    if (near) dropped.push(c);
  }
  for (const c of dropped) pieces.splice(pieces.indexOf(c), 1);
  return dropped;
}

/** Extend `piece` at one end by `pts` (BNG), each point's segment class from `cls` (one per appended segment); labels `label`. */
function appendToPiece(piece, atEnd, pts, cls, label) {
  const ll = pts.map(fromBng);
  piece.from ||= piece.xy.map(() => (piece.source === 'osm' ? piece.place : null));
  piece.opened ||= piece.cls.map(() => 0);
  if (atEnd) {
    piece.xy.push(...pts); piece.lonlat.push(...ll); piece.cls.push(...cls); piece.from.push(...pts.map(() => label)); piece.opened.push(...cls.map(() => 0));
  } else {
    piece.xy.unshift(...[...pts].reverse()); piece.lonlat.unshift(...[...ll].reverse()); piece.cls.unshift(...[...cls].reverse());
    piece.from.unshift(...pts.map(() => label)); piece.opened.unshift(...cls.map(() => 0));
  }
}

/**
 * For every end of a piece inside the box whose nearest other kept piece is 6 to
 * 60 m away (a junction gap; none within 60 m is a buffer end), take the OSM
 * trail within 25 m of the end, densified to 10 m, and walk it away from the
 * piece (tangent cosine at least 0.5 with the end's outward direction),
 * appending points until one is within 6 m of another kept piece, or is the
 * 15th consecutive point within 32 m of one, or 1,600 m have been walked (then
 * nothing is appended). The nearest point on that other piece is appended last,
 * so the two ends meet. Longest piece first. Mutates the pieces; returns the report.
 */
export function closeJunctionGaps(pieces, trails, box) {
  const report = [];
  const dense = trails.map(t => { const xy = t.points.map(toBng); return densifyXY(xy, t.cls ?? t.segments.flatMap(s => Array(s.i1 - s.i0).fill(s.class)), 10); });
  const order = [...pieces].sort((a, b) => lenXY(b.xy) - lenXY(a.xy));
  for (const piece of order) {
    for (const atEnd of [true, false]) {
      const n = piece.xy.length, E = atEnd ? piece.xy[n - 1] : piece.xy[0];
      if (!inBoxLL(fromBng(E), box)) continue;
      const near = nearestOtherPiece(pieces, piece, E);
      if (!near || near.d < GAP_MIN_M || near.d > GAP_MAX_M) continue;
      // The outward direction: from a point about 15 m back along the piece to the end.
      let back = atEnd ? n - 2 : 1, acc = 0;
      while (acc < 15 && (atEnd ? back > 0 : back < n - 1)) { const nb = atEnd ? back - 1 : back + 1; acc += Math.hypot(piece.xy[nb][0] - piece.xy[back][0], piece.xy[nb][1] - piece.xy[back][1]); back = nb; }
      const out = [E[0] - piece.xy[back][0], E[1] - piece.xy[back][1]], ol = Math.hypot(...out) || 1;
      // The trail point nearest the end, and the direction along the trail that runs away from the piece.
      let pick = null;
      for (const t of dense) for (let i = 0; i < t.xy.length; i++) {
        const d = Math.hypot(t.xy[i][0] - E[0], t.xy[i][1] - E[1]);
        if (d > TRAIL_NEAR_M) continue;
        for (const dir of [1, -1]) {
          const j = i + 2 * dir; if (j < 0 || j >= t.xy.length) continue;
          const tg = [t.xy[j][0] - t.xy[i][0], t.xy[j][1] - t.xy[i][1]], cos = (tg[0] * out[0] + tg[1] * out[1]) / ((Math.hypot(...tg) || 1) * ol);
          if (cos >= 0.5 && (!pick || d < pick.d - 1e-9 || (Math.abs(d - pick.d) < 1e-9 && cos > pick.cos))) pick = { t, i, dir, d, cos };
        }
      }
      if (!pick) { report.push(`metropolitan gap at ${E.map(Math.round)} (${Math.round(near.d)} m): no OSM trail within ${TRAIL_NEAR_M} m runs on`); continue; }
      const pts = [], cls = [], others = pieces.filter(q => q !== piece);
      let walked = 0, run = 0, hit = null, prev = E;
      for (let i = pick.i + pick.dir; i >= 0 && i < pick.t.xy.length; i += pick.dir) {
        const q = pick.t.xy[i];
        walked += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q;
        if (walked > WALK_MAX_M) break;
        pts.push(q); cls.push(pick.dir > 0 ? pick.t.cls[i - 1] : pick.t.cls[i]);
        let dMin = Infinity, onPiece = null;
        for (const o of others) { const r = nearestOnPolyline(o.xy, q); if (r.d < dMin) { dMin = r.d; onPiece = r; } }
        run = dMin <= FRAGMENT_NEAR_M ? run + 1 : 0;
        if (dMin <= WALK_STOP_M || run >= PARALLEL_RUN_POINTS) { hit = onPiece; break; }
      }
      if (!hit) { report.push(`metropolitan gap at ${E.map(Math.round)} (${Math.round(near.d)} m): no junction within ${WALK_MAX_M} m along the OSM trail, left as it was`); continue; }
      pts.push(hit.p); cls.push(cls.at(-1));
      appendToPiece(piece, atEnd, pts, cls, TERMINI_LABEL);
      report.push(`metropolitan junction gap closed at the ${atEnd ? 'end' : 'start'} of a ${Math.round(lenXY(piece.xy))} m piece: ${Math.round(lenXY([E, ...pts]))} m of OSM track (${[...new Set(cls)].join(', ')}), ${Math.round(near.d)} m gap`);
    }
  }
  return report;
}

/**
 * The Metropolitan beyond Rickmansworth (the one hook prepare-tube-surface.mjs
 * calls, once per line, after the stubs and covered ways): drop the twin
 * fragments in the Chilterns box, then close the junction gaps there. Other
 * lines are untouched. Returns the report lines.
 */
export function applyTermini(lineId, pieces, answer, stops = []) {
  if (lineId !== 'metropolitan' || !answer) return [];
  const box = TERMINI_PLACES['metropolitan-chilterns'].box, report = [];
  const dropped = dropTwinFragments(pieces, box);
  if (dropped.length) report.push(`metropolitan twin fragments dropped beyond Rickmansworth: ${dropped.length} pieces, ${Math.round(dropped.reduce((s, p) => s + lenXY(p.xy), 0))} m (each within ${FRAGMENT_NEAR_M} m of the corridor's other track)`);
  const trails = terminiTrails(answer, 'metropolitan-chilterns', 'metropolitan');
  report.push(...closeJunctionGaps(pieces, trails, box));
  return report;
}

// ---- the Weaver: the last stretch to Cheshunt ---------------------------------

export const WEAVER_TRAIL_NEAR_M = 12;

/**
 * The points to append to a Weaver branch to run it on to the end of the OSM
 * trail through its last point: the trail within 12 m of the branch's last
 * point (the nearest), from the projection of that point onward in the
 * direction the branch is running, to the trail's end in the box, densified so
 * that no two points are more than 10 m apart. `branchPoints` are [lon, lat].
 * Returns {points: [[lon, lat]] (not including the branch's last point), cls
 * (the class of the segment arriving at each appended point), lengthM} or null.
 */
export function weaverExtension(branchPoints, trails, stepM = 10) {
  const last = toBng(branchPoints.at(-1)), prev = toBng(branchPoints.at(-2));
  const dir = [last[0] - prev[0], last[1] - prev[1]], dl = Math.hypot(...dir) || 1;
  let best = null;
  for (const t of trails) {
    const xy = t.points.map(toBng), r = nearestOnPolyline(xy, last);
    if (r.d <= WEAVER_TRAIL_NEAR_M && (!best || r.d < best.r.d)) best = { t, xy, r };
  }
  if (!best) return null;
  const { t, xy, r } = best, cls = t.cls;
  // Direction along the trail: the one whose tangent at the projection runs with the branch.
  const a = xy[r.i], b = xy[r.i + 1], tg = [b[0] - a[0], b[1] - a[1]];
  const fwd = (tg[0] * dir[0] + tg[1] * dir[1]) / ((Math.hypot(...tg) || 1) * dl) >= 0;
  const pts = [last], cl = [];
  if (fwd) { for (let i = r.i + 1; i < xy.length; i++) { pts.push(xy[i]); cl.push(cls[i - 1]); } }
  else { for (let i = r.i; i >= 0; i--) { pts.push(xy[i]); cl.push(cls[i]); } }
  if (pts.length < 2) return null;
  // The first segment runs from the branch's last point to the first trail vertex ahead of its projection.
  const dense = densifyXY(pts, cl, stepM);
  return { points: dense.xy.slice(1).map(fromBng), cls: dense.cls.slice(0, -1), lengthM: lenXY(pts) };
}

// ---- CLI ------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const refresh = process.argv.includes('--refresh'), fromRaw = process.argv.includes('--from-raw');
  if (existsSync(TERMINI_CACHE_FILE) && !refresh && !fromRaw) console.log('cache exists:', TERMINI_CACHE_FILE, '(use --refresh to fetch again)');
  else if (existsSync(TERMINI_CACHE_FILE) && fromRaw && !refresh) console.log('cache exists:', TERMINI_CACHE_FILE, '(use --refresh --from-raw to replace it)');
  else {
    const json = fromRaw ? await answerFromRaw() : await fetchTerminiOverpass();
    if (fromRaw) { await mkdir(path.dirname(TERMINI_CACHE_FILE), { recursive: true }); await writeFile(TERMINI_CACHE_FILE, JSON.stringify(json)); console.log('cached', json.elements.length, 'elements (offline) to', TERMINI_CACHE_FILE); }
  }
  const osm = await loadTerminiCache();
  for (const [key, place] of Object.entries(TERMINI_PLACES)) for (const lineId of place.lines) {
    const t = terminiTrails(osm, key, lineId);
    console.log(`${key.padEnd(24)} ${lineId.padEnd(13)} ${t.length} trails, ${t.reduce((s, tr) => s + tr.points.length, 0)} points (source: ${osm.source})`);
  }
}
