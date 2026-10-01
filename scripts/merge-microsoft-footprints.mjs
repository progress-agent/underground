#!/usr/bin/env node
/**
 * merge-microsoft-footprints.mjs: fill Park Royal and West Acton (sprint
 * 30Sep26w), and North Acton, East Acton, Harlesden and Willesden Junction
 * (sprint 01Oct26h, D-042 item 5, D-043), with Microsoft's open building
 * footprints where OpenStreetMap maps no building.
 *
 * Sprint 30Sep26w Lane M (D-040 item 3, D-041). OSM itself is thin in these
 * two 2 km tiles (962 and 853 buildings on a live Overpass count, against
 * roughly 2,000 to 3,000 real ones per km2 of street), so re-fetching OSM
 * cannot fill them (sprint 25Sep26f Lane E, captures park-royal / west-acton).
 * Microsoft's GlobalMLBuildingFootprints, UK quadkey 031313131 (release
 * 2026-02-03, uploaded 2026-02-23), has 2,306 and 2,910 footprints in the same
 * two tiles, 2,212 and 2,724 of them at 20 m2 or more.
 *
 * THE RULE: a Microsoft footprint is added only when NO OpenStreetMap building
 * overlaps it. The test is a polygon intersection on the footprints themselves
 * (not centroids): the exact area of the intersection, plus a boolean
 * crossing/containment backstop for the few OSM multipolygon footprints whose
 * outer ways are concatenated into one non-simple ring. Touching along a shared
 * edge (zero area) is not an overlap. OSM buildings from the target tile AND
 * its eight neighbours are tested, because a building near a tile edge can be
 * stored in the neighbouring file.
 *
 * Records are written in the tiles' existing schema, identical in shape to the
 * OSM ones (same projection, same integer-metre rounding, same 20 m2 floor,
 * same area and centroid code as scripts/fetch-surface-tiles.mjs), so the live
 * loader and the bake compiler read them unchanged. Each added record also
 * carries `source: "microsoft"`, which the renderer and the bake ignore (the
 * same way they ignore Lane E's `kind`), and each changed tile gains a
 * `microsoft` provenance block.
 *
 * HEIGHT: Microsoft's `height` (metres, from its ML model) is used, rounded to
 * 0.1 m as OSM heights are. Where it is not given (Microsoft writes -1, or the
 * value is missing, non-finite or not positive) the record takes the MEDIAN
 * Microsoft-given height of footprints in the same size band (HEIGHT_BANDS_M2)
 * among all candidates in the tile's GROUP (TILE_GROUPS). Not the pipeline's
 * flat 10 m OSM default: 84% of the height-less candidates in Park Royal and
 * West Acton are under 80 m2 (garden sheds and garages, given-height median
 * 3.6 to 4.1 m), and 10 m would stand each of them up as a pillar. A band with
 * no given heights falls back to 10 m (DEFAULT_BUILDING_HEIGHT in
 * fetch-surface-tiles.mjs).
 *
 * HEIGHT POOLS (sprint 01Oct26h). Each group of tiles, the ones merged together
 * in one sprint, pools its own medians and never another group's. So adding
 * North/East Acton and Harlesden/Willesden Junction leaves Park Royal and West
 * Acton byte-identical (D-043: their medians are not re-pooled), and the new
 * pair's missing heights come from their own streets rather than borrowed
 * from Park Royal's. Every group is scanned on every run, and a footprint's
 * tile is chosen among ALL target tiles, so a tile's bytes never depend on
 * which --tiles were asked for; --tiles only chooses which files are written.
 * The tracked summary always describes all target tiles.
 *
 * TILE ASSIGNMENT: a footprint belongs to the tile whose lat/lon bounds hold
 * the mean of its ring's vertices (south and west edges inclusive), so each
 * footprint lands in exactly one tile.
 *
 * IDEMPOTENT: records with `source: "microsoft"` are stripped before merging,
 * so a re-run from the cached download reproduces the same bytes. No
 * timestamps are written.
 *
 * DATA SAFETY (fix round 1): public/data/surface is shared. In a worktree it
 * is usually a symlink, or holds symlinks, into the main checkout's store, and
 * checking only whether the tile FILE is a link misses a symlinked parent
 * directory (the file is then a real file in the store). So before it
 * downloads or writes anything, a real run checks the whole path with
 * scripts/surface-overlay.mjs: tiles/ and baked/ must resolve (realpath)
 * inside this checkout and not into the main checkout's store (that needs
 * --promote, run from the main checkout), and no baked file may be a link,
 * because the `npm run bake` that follows writes with a plain writeFile. It
 * refuses otherwise and names the one-command remedy
 * (`node scripts/surface-overlay.mjs prepare`). Each file is written to a
 * temporary name and renamed into place, so a leaf symlink or hard link is
 * replaced, never written through.
 *
 * Usage:
 *   node scripts/surface-overlay.mjs prepare      (once per worktree)
 *   node scripts/merge-microsoft-footprints.mjs [--tiles tile_11_13.json,tile_11_14.json]
 *     [--dry-run] [--report <path>] [--root <checkout>] [--promote]
 *   (default: every target tile; each --tiles entry must be in TILE_GROUPS)
 *   npm run bake && npm run bake:verify
 * Download cache: scripts/.cache/microsoft-footprints/ (fetched when absent;
 * in a worktree scripts/.cache is the orchestrator's link to the shared
 * download cache, which holds downloads only, never served data).
 * Summary (tracked, pins the per-tile counts for tests): scripts/microsoft-footprints.json
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import os from 'node:os';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { assertOverlayWritable, writeLocal } from './surface-overlay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pathsFor = (root) => ({
  tileDir: path.join(root, 'public/data/surface/tiles'),
  cache: path.join(root, 'scripts/.cache/microsoft-footprints'),
  summary: path.join(root, 'scripts/microsoft-footprints.json'),
});
export const SUMMARY_PATH = pathsFor(ROOT).summary;

export const DATASET_LINKS = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';
export const LOCATION = 'UnitedKingdom';
export const QUADKEY = '031313131';
/**
 * The tiles merged, one group per sprint, in merge order. A group pools its
 * own missing-height medians (HEIGHT POOLS above). `heightRule` is written
 * into each of its tiles' provenance blocks, so it is part of their bytes:
 * the 30Sep26w text is frozen exactly as that run wrote it, and must never be
 * edited, or Park Royal and West Acton stop being byte-identical.
 */
export const TILE_GROUPS = [
  { pool: '30Sep26w', decision: 'D-041', areas: 'Park Royal and West Acton',
    tiles: ['tile_10_13.json', 'tile_10_14.json'],
    heightRule: 'Microsoft height where given (rounded to 0.1 m). Where Microsoft gives none (-1), the median Microsoft-given height of candidates in the same footprint-area band across the target tiles (heightBands); 10 m only for a band with no given heights.' },
  { pool: '01Oct26h', decision: 'D-043', areas: 'North Acton, East Acton, Harlesden and Willesden Junction',
    tiles: ['tile_11_13.json', 'tile_11_14.json'],
    heightRule: 'Microsoft height where given (rounded to 0.1 m). Where Microsoft gives none (-1), the median Microsoft-given height of candidates in the same footprint-area band across this pool only, tile_11_13 and tile_11_14 (heightBands); never pooled with another sprint\'s tiles; 10 m only for a band with no given heights.' },
];
export const TARGET_TILES = TILE_GROUPS.flatMap((g) => g.tiles);
export const groupOf = (file) => TILE_GROUPS.find((g) => g.tiles.includes(file)) || null;
export const SOURCE = {
  name: 'Microsoft Building Footprints (GlobalMLBuildingFootprints)',
  repository: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
  licence: 'ODbL 1.0 (Open Data Commons Open Database License)',
  licenceUrl: 'https://opendatacommons.org/licenses/odbl/',
};

// ── Identical to fetch-surface-tiles.mjs ─────────────────────────────────────
proj4.defs('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
  '+x_0=400000 +y_0=-100000 +ellps=airy ' +
  '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 ' +
  '+units=m +no_defs');
const [BNG_REF_E, BNG_REF_N] = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);
export const DEFAULT_BUILDING_HEIGHT = 10;
export const MIN_BUILDING_AREA = 20;
export function llToScene(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return [Math.round(e - BNG_REF_E), Math.round(-(n - BNG_REF_N))];
}
export function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1];
    area -= points[i + 1][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}
export function polygonCentroid(points) {
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cross = points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    cx += (points[i][0] + points[i + 1][0]) * cross;
    cy += (points[i][1] + points[i + 1][1]) * cross;
    area += cross;
  }
  area = area / 2;
  if (Math.abs(area) < 0.001) {
    const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [Math.round(sum[0] / points.length), Math.round(sum[1] / points.length)];
  }
  return [Math.round(cx / (6 * area)), Math.round(cy / (6 * area))];
}
// ─────────────────────────────────────────────────────────────────────────────

/** Microsoft height, or null when the dataset gives none (-1, missing, <= 0). */
export function sourceHeight(props) {
  const h = props?.height;
  return (typeof h === 'number' && Number.isFinite(h) && h > 0) ? Math.round(h * 10) / 10 : null;
}

/** Footprint-area bands (m2, lower bound inclusive) for the missing-height median. */
export const HEIGHT_BANDS_M2 = [20, 40, 80, 150, 400, 1500];
export const heightBand = (area) => {
  let k = 0;
  for (let i = 0; i < HEIGHT_BANDS_M2.length; i++) if (area >= HEIGHT_BANDS_M2[i]) k = i;
  return k;
};
/**
 * Median given height per band, from records carrying `_heightGiven`. The
 * lower median of an even count, so the value is always a real observation.
 */
export function bandMedians(records) {
  const per = HEIGHT_BANDS_M2.map(() => []);
  for (const r of records) if (r._heightGiven) per[heightBand(r.area)].push(r.height);
  return per.map((a) => {
    if (!a.length) return DEFAULT_BUILDING_HEIGHT;
    a.sort((x, y) => x - y);
    return a[(a.length - 1) >> 1];
  });
}

/**
 * One Microsoft GeoJSON feature as a tile building record, or null when it
 * falls under the 20 m2 floor or is not a usable polygon. Outer ring only,
 * as for OSM (holes are not modelled by the renderer).
 */
export function featureToRecord(feature) {
  const g = feature?.geometry;
  let ring = null;
  if (g?.type === 'Polygon') ring = g.coordinates?.[0];
  else if (g?.type === 'MultiPolygon') {
    // Largest part; Microsoft's footprints are single polygons in practice.
    let best = -1;
    for (const poly of g.coordinates || []) {
      const r = poly?.[0]; if (!r || r.length < 3) continue;
      const a = Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0));
      if (a > best) { best = a; ring = r; }
    }
  }
  if (!ring || ring.length < 3) return null;
  const fp = ring.map(([lon, lat]) => llToScene(lat, lon));
  if (fp[0][0] !== fp.at(-1)[0] || fp[0][1] !== fp.at(-1)[1]) fp.push([...fp[0]]);
  if (fp.length < 4) return null;
  const area = shoelaceArea(fp);
  if (area < MIN_BUILDING_AREA) return null;
  const [cx, cz] = polygonCentroid(fp);
  const h = sourceHeight(feature.properties);
  return { cx, cz, height: h ?? DEFAULT_BUILDING_HEIGHT, area: Math.round(area), footprint: fp,
           source: 'microsoft', _heightGiven: h !== null };
}

/** Mean of a WGS84 ring's vertices (closing duplicate excluded). */
export function ringMeanLL(ring) {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  let lon = 0, lat = 0;
  for (const p of open) { lon += p[0]; lat += p[1]; }
  return { lon: lon / open.length, lat: lat / open.length };
}

// ── Polygon overlap ──────────────────────────────────────────────────────────
// Rings are arrays of [x, z]; a closing duplicate vertex is allowed.

const openRing = (r) => (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r.slice(0, -1) : r);
const signedArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };

/** Sutherland-Hodgman: clip `subject` (any ring) by a CCW triangle. Signed area of the result. */
function clipAreaByTriangle(subject, tri) {
  let out = subject;
  for (let k = 0; k < 3 && out.length; k++) {
    const a = tri[k], b = tri[(k + 1) % 3];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const side = (p) => ex * (p[1] - a[1]) - ez * (p[0] - a[0]); // > 0: left of a->b (inside for CCW)
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const P = input[i], Q = input[(i + 1) % input.length];
      const sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
  }
  return out.length >= 3 ? signedArea(out) : 0;
}

/**
 * Area of A intersect B. Exact for simple polygons of any shape: B's winding
 * number is decomposed into the signed fan triangles (v0, vi, vi+1), and A
 * (oriented CCW) is clipped by each. The Sutherland-Hodgman connectors along a
 * clip edge enclose zero area, so a concave A is handled correctly.
 */
export function intersectionArea(A, B) {
  let a = openRing(A), b = openRing(B);
  if (a.length < 3 || b.length < 3) return 0;
  if (signedArea(a) < 0) a = [...a].reverse();
  if (signedArea(b) < 0) b = [...b].reverse();
  let sum = 0;
  for (let i = 1; i < b.length - 1; i++) {
    const t = [b[0], b[i], b[i + 1]];
    const s = signedArea(t);
    if (Math.abs(s) < 1e-12) continue;
    sum += s > 0 ? clipAreaByTriangle(a, t) : -clipAreaByTriangle(a, [t[0], t[2], t[1]]);
  }
  return Math.abs(sum);
}

/** Even-odd point in ring; points ON the boundary are reported as outside. */
export function strictlyInside(x, z, ring) {
  const r = openRing(ring);
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    // On-segment test first (collinear and within the segment's box).
    const cross = (xj - xi) * (z - zi) - (zj - zi) * (x - xi);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9
        && z >= Math.min(zi, zj) - 1e-9 && z <= Math.max(zi, zj) + 1e-9) return false;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function properCross(p1, p2, q1, q2) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(q1, q2, p1), d2 = o(q1, q2, p2), d3 = o(p1, p2, q1), d4 = o(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Boolean backstop: a proper edge crossing, or a vertex strictly inside the other ring. */
export function boundariesOverlap(A, B) {
  const a = openRing(A), b = openRing(B);
  for (const p of a) if (strictlyInside(p[0], p[1], b)) return true;
  for (const p of b) if (strictlyInside(p[0], p[1], a)) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (properCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

export const OVERLAP_EPS_M2 = 1e-6;
/** Do the interiors of two footprints intersect? Touching edges do not count. */
export function footprintsOverlap(A, B) {
  return intersectionArea(A, B) > OVERLAP_EPS_M2 || boundariesOverlap(A, B);
}

const bboxOf = (r) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return { minX, maxX, minZ, maxZ };
};

/** A 50 m grid over OSM footprints' boxes, for candidate lookup. */
export function createFootprintIndex(buildings, cell = 50) {
  const grid = new Map(), items = [];
  for (const b of buildings) {
    if (!Array.isArray(b.footprint) || b.footprint.length < 3) continue;
    const bb = bboxOf(b.footprint), id = items.length;
    items.push({ b, bb });
    for (let gx = Math.floor(bb.minX / cell); gx <= Math.floor(bb.maxX / cell); gx++)
      for (let gz = Math.floor(bb.minZ / cell); gz <= Math.floor(bb.maxZ / cell); gz++) {
        const k = `${gx},${gz}`; (grid.get(k) || grid.set(k, []).get(k)).push(id);
      }
  }
  return {
    /** OSM buildings whose footprint overlaps `ring` (interiors intersect). */
    overlapping(ring) {
      const bb = bboxOf(ring), seen = new Set(), hits = [];
      for (let gx = Math.floor(bb.minX / cell); gx <= Math.floor(bb.maxX / cell); gx++)
        for (let gz = Math.floor(bb.minZ / cell); gz <= Math.floor(bb.maxZ / cell); gz++)
          for (const id of grid.get(`${gx},${gz}`) || []) {
            if (seen.has(id)) continue; seen.add(id);
            const it = items[id];
            if (it.bb.maxX < bb.minX || it.bb.minX > bb.maxX || it.bb.maxZ < bb.minZ || it.bb.minZ > bb.maxZ) continue;
            if (footprintsOverlap(ring, it.b.footprint)) hits.push(it.b);
          }
      return hits;
    },
  };
}

/** The eight neighbours and the tile itself, as file names. */
export function neighbourFiles(file) {
  const m = /^tile_(\d+)_(\d+)\.json$/.exec(file);
  if (!m) return [file];
  const c = +m[1], r = +m[2], out = [];
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++)
    out.push(`tile_${String(c + dc).padStart(2, '0')}_${String(r + dr).padStart(2, '0')}.json`);
  return out;
}

export const isMicrosoft = (b) => b?.source === 'microsoft';

// ── Download ─────────────────────────────────────────────────────────────────

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest + '.part', buf);
  await rename(dest + '.part', dest);
  return buf.length;
}

async function ensureSource(CACHE) {
  await mkdir(CACHE, { recursive: true });
  const linksPath = path.join(CACHE, 'dataset-links.csv');
  if (!existsSync(linksPath)) await download(DATASET_LINKS, linksPath);
  const row = (await readFile(linksPath, 'utf8')).split('\n')
    .map((l) => l.split(','))
    .find((c) => c[0] === LOCATION && c[1] === QUADKEY);
  if (!row) throw new Error(`${LOCATION} quadkey ${QUADKEY} not in dataset-links.csv`);
  const [, , url, size, uploadDate] = row;
  const file = path.join(CACHE, `${LOCATION}-${QUADKEY}.csv.gz`);
  if (!existsSync(file)) { console.log(`downloading ${size} from ${url}`); await download(url, file); }
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  return { file, url, size, uploadDate: uploadDate?.trim(), sha256 };
}

// ── Merge ────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { mainRoot } = {}) {
  const arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
  const dry = argv.includes('--dry-run');
  const root = path.resolve(arg('--root') || ROOT);
  const guard = { root, promote: argv.includes('--promote'), mainRoot };
  const { tileDir: TILE_DIR, cache: CACHE, summary: SUMMARY } = pathsFor(root);
  const readTile = async (file) => JSON.parse(await readFile(path.join(TILE_DIR, file), 'utf8'));
  const targets = arg('--tiles') ? arg('--tiles').split(',') : TARGET_TILES;
  for (const f of targets) if (!groupOf(f)) throw new Error(`${f} is not in TILE_GROUPS: add it to a group (its height pool) first`);
  // Before any download or write: this checkout's tiles/ and baked/ must be
  // its own (see DATA SAFETY above). A dry run writes no data and skips it.
  if (!dry) await assertOverlayWritable(guard);
  const src = await ensureSource(CACHE);
  const manifestPath = path.join(TILE_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entries = new Map(manifest.tiles.map((t) => [t.file, t]));
  // Every group is computed on every run (HEIGHT POOLS above); `targets` only
  // chooses which tiles are written.
  for (const f of TARGET_TILES) if (!entries.has(f)) throw new Error(`${f} not in manifest`);

  // OSM baselines: every target tile and its neighbours, Microsoft records stripped.
  const osm = new Map();
  for (const f of new Set(TARGET_TILES.flatMap(neighbourFiles))) {
    if (!entries.has(f)) continue;
    const t = await readTile(f);
    osm.set(f, (t.buildings || []).filter((b) => !isMicrosoft(b)));
  }

  // Region filter: the union of the target tiles' bounds. A footprint belongs
  // to the first target tile (in TARGET_TILES order) whose bounds hold it.
  const boxes = TARGET_TILES.map((f) => { const b = entries.get(f).bounds; return { file: f, s: b.sw[0], w: b.sw[1], n: b.ne[0], e: b.ne[1] }; });
  const region = { s: Math.min(...boxes.map((b) => b.s)), w: Math.min(...boxes.map((b) => b.w)),
                   n: Math.max(...boxes.map((b) => b.n)), e: Math.max(...boxes.map((b) => b.e)) };
  const perTile = new Map(TARGET_TILES.map((f) => [f, { features: [], scanned: 0 }]));
  const rl = createInterface({ input: createReadStream(src.file).pipe(createGunzip()), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (!line) continue;
    lines++;
    // Cheap prefilter on the first coordinate before a full parse.
    const m = /"coordinates":\s*\[+\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const lon = +m[1], lat = +m[2];
    if (lat < region.s - 0.005 || lat > region.n + 0.005 || lon < region.w - 0.008 || lon > region.e + 0.008) continue;
    const f = JSON.parse(line);
    const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0];
    if (!ring) continue;
    const c = ringMeanLL(ring);
    const box = boxes.find((b) => c.lat >= b.s && c.lat < b.n && c.lon >= b.w && c.lon < b.e);
    if (box) perTile.get(box.file).features.push(f);
  }

  // Records for every candidate first: the missing-height rule needs the given
  // heights of the tile's whole group (its pool), and of no other group.
  const candidates = new Map(TARGET_TILES.map((f) => [f, perTile.get(f).features.map(featureToRecord)]));
  const pools = TILE_GROUPS.map((g) => {
    const medians = bandMedians(g.tiles.flatMap((f) => candidates.get(f)).filter(Boolean));
    return { ...g, medians, bandTable: HEIGHT_BANDS_M2.map((lo, i) => ({ fromM2: lo, toM2: HEIGHT_BANDS_M2[i + 1] ?? null, medianM: medians[i] })) };
  });
  const poolOf = (file) => pools.find((p) => p.tiles.includes(file));

  const summary = { source: { ...SOURCE, location: LOCATION, quadkey: QUADKEY, url: src.url, uploadDate: src.uploadDate,
                               size: src.size, sha256: src.sha256, featuresInQuadkey: lines },
    rule: 'Added only where no OpenStreetMap building (target tile or its eight neighbours) overlaps the footprint: exact intersection area > 1e-6 m2, or a proper edge crossing or a vertex strictly inside the other ring. Touching edges are not an overlap.',
    heightRule: 'Microsoft height where given (rounded to 0.1 m). Where Microsoft gives none (-1), the median Microsoft-given height of candidates in the same footprint-area band within the tile\'s height pool (heightPools: the tiles merged together in one sprint), never across pools, so adding a pool leaves earlier tiles byte-identical; 10 m only for a band with no given heights.',
    heightPools: pools.map((p) => ({ pool: p.pool, decision: p.decision, areas: p.areas, tiles: p.tiles, heightBands: p.bandTable })),
    assignment: 'Tile whose lat/lon bounds hold the mean of the footprint ring vertices (south and west edges inclusive; the first target tile in order on a shared edge).',
    tiles: {} };

  let manifestChanged = false;
  for (const file of TARGET_TILES) {
    const tilePath = path.join(TILE_DIR, file);
    const tile = await readTile(file);
    const base = osm.get(file);
    const neighbours = neighbourFiles(file).filter((f) => osm.has(f)).flatMap((f) => osm.get(f));
    const index = createFootprintIndex(neighbours);
    const recs = candidates.get(file);
    const pool = poolOf(file);
    let small = 0, overlap = 0, overlapSliver = 0, heightGiven = 0, heightFromBand = 0;
    const added = [];
    for (const rec of recs) {
      if (!rec) { small++; continue; }
      const hits = index.overlapping(rec.footprint);
      if (hits.length) {
        overlap++;
        // Diagnostic only: rejected although the overlap is a sliver (< 5% of
        // the Microsoft footprint). The rule stays strict.
        const worst = Math.max(...hits.map((h) => intersectionArea(rec.footprint, h.footprint)));
        if (worst < 0.05 * rec.area) overlapSliver++;
        continue;
      }
      if (rec._heightGiven) heightGiven++;
      else { rec.height = pool.medians[heightBand(rec.area)]; heightFromBand++; }
      delete rec._heightGiven;
      added.push(rec);
    }
    // Deterministic order: by centroid, then area.
    added.sort((a, b) => a.cz - b.cz || a.cx - b.cx || a.area - b.area);
    const osmOnly = { ...tile };
    delete osmOnly.microsoft;
    const baseText = JSON.stringify({ ...osmOnly, buildings: base }, null, 2);
    const next = { ...osmOnly, buildings: [...base, ...added], microsoft: {
      by: 'scripts/merge-microsoft-footprints.mjs', source: SOURCE.name, licence: SOURCE.licence,
      url: src.url, uploadDate: src.uploadDate, sha256: src.sha256,
      rule: summary.rule, heightRule: pool.heightRule, heightBands: pool.bandTable,
      osmBuildings: base.length, candidates: recs.length, belowFloor: small, overlapOsm: overlap,
      added: added.length, heightGiven, heightFromBand } };
    const text = JSON.stringify(next, null, 2);
    const before = baseText.length;
    const heights = added.map((b) => b.height).sort((x, y) => x - y);
    summary.tiles[file] = { pool: pool.pool, osmBuildings: base.length, candidates: recs.length, belowFloor: small, overlapOsm: overlap,
      overlapOsmSliverUnder5pct: overlapSliver,
      added: added.length, heightGiven, heightFromBand, buildingsAfter: base.length + added.length,
      medianAddedAreaM2: added.length ? [...added.map((b) => b.area)].sort((x, y) => x - y)[added.length >> 1] : null,
      medianAddedHeightM: heights.length ? heights[heights.length >> 1] : null,
      bytesBefore: before, bytesAfter: text.length,
      sha256Before: createHash('sha256').update(baseText).digest('hex'),
      sha256After: createHash('sha256').update(text).digest('hex') };
    const write = targets.includes(file);
    console.log(`${file}${write ? '' : ' (computed, not written)'}: OSM ${base.length}, Microsoft candidates ${recs.length}, below 20 m2 ${small}, overlap OSM ${overlap} (${overlapSliver} slivers), added ${added.length} (height given ${heightGiven}, band median ${heightFromBand}); ${before} -> ${text.length} bytes`);
    if (!dry && write) {
      await writeLocal(tilePath, text, guard);
      const e = entries.get(file);
      e.counts = { ...e.counts, buildings: next.buildings.length };
      e.sizeBytes = text.length;
      manifestChanged = true;
    }
  }
  if (manifestChanged) {
    manifest.totals.buildings = manifest.tiles.reduce((a, t) => a + (t.counts?.buildings || 0), 0);
    manifest.totals.totalSizeBytes = manifest.tiles.reduce((a, t) => a + (t.sizeBytes || 0), 0);
    await writeLocal(manifestPath, JSON.stringify(manifest, null, 2), guard);
  }
  summary.totals = { added: Object.values(summary.tiles).reduce((a, t) => a + t.added, 0),
                     manifestBuildings: manifest.totals.buildings };
  // A dry run's report goes to the system temp dir, not the shared download cache.
  const reportPath = arg('--report') || (dry ? path.join(os.tmpdir(), 'merge-microsoft-footprints.dry.json') : SUMMARY);
  await writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`summary -> ${path.relative(root, reportPath)}`);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.name === 'OverlayError' ? e.message : e); process.exit(1); });
}
