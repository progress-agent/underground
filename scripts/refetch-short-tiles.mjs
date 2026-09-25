#!/usr/bin/env node
/**
 * refetch-short-tiles.mjs: re-fetch the buildings of short surface tiles.
 *
 * Sprint 25Sep26f Lane E (D-039). scripts/audit-building-tiles.mjs lists tiles
 * whose file holds far fewer buildings than OSM has for the same bbox. The
 * original fetch took each 2 km tile in ONE Overpass query; a query that hits
 * the server's time or memory cap still answers HTTP 200 with a partial element
 * list and a `remark`, and was written out as if complete.
 *
 * Here each tile is fetched as four quarter-size queries. Every query asks for
 * the server's own count of the set first and then the set itself, so a
 * response is accepted only when (a) it carries no error remark and (b) it
 * returns at least as many building ways and relations as it counted. A quarter
 * that fails either test is split into four again (up to two levels).
 *
 * Parsing matches scripts/fetch-surface-tiles.mjs exactly (same projection,
 * same rounding, same 20 m2 floor, same height rules), so a re-fetched tile is
 * the same shape as its neighbours. Each record also carries `kind` (the OSM
 * `building` value) for the category report; the renderer and the bake ignore
 * it. Parks and roads are kept from the existing tile (streets are out of
 * scope this sprint).
 *
 * A tile is replaced only if the new list is larger. The existing file (often
 * a symlink into the shared tile store) is REPLACED by a real file in this
 * checkout, never written through.
 *
 * Usage:
 *   node scripts/refetch-short-tiles.mjs [--audit scripts/.cache/tile-audit.json] [--tiles tile_10_13.json,...]
 *     [--baseline <dir of original tiles>]
 * Report: scripts/.cache/refetch-report.json
 */
import { readFile, writeFile, mkdir, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { overpass } from './audit-building-tiles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE_DIR = path.join(ROOT, 'public/data/surface/tiles');
const CACHE = path.join(ROOT, 'scripts/.cache/refetch');

// ── Identical to fetch-surface-tiles.mjs ─────────────────────────────────────
proj4.defs('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
  '+x_0=400000 +y_0=-100000 +ellps=airy ' +
  '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 ' +
  '+units=m +no_defs');
const [BNG_REF_E, BNG_REF_N] = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);
const DEFAULT_BUILDING_HEIGHT = 10;
const METRES_PER_LEVEL = 3.2;
const MIN_BUILDING_AREA = 20;
function llToScene(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return [Math.round(e - BNG_REF_E), Math.round(-(n - BNG_REF_N))];
}
function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1];
    area -= points[i + 1][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}
function polygonCentroid(points) {
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
/** Building records from one Overpass JSON answer, keyed by OSM type/id. */
export function parseBuildings(osm) {
  const nodes = new Map(), ways = new Map();
  for (const e of osm.elements || []) {
    if (e.type === 'node') nodes.set(e.id, [e.lat, e.lon]);
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const out = new Map();
  for (const e of osm.elements || []) {
    if ((e.type !== 'way' && e.type !== 'relation') || !e.tags?.building) continue;
    let ids = [];
    if (e.type === 'way') ids = e.nodes || [];
    else for (const m of e.members || []) if (m.type === 'way' && m.role === 'outer') { const w = ways.get(m.ref); if (w?.nodes) ids.push(...w.nodes); }
    const fp = ids.map(id => nodes.get(id)).filter(Boolean).map(([la, lo]) => llToScene(la, lo));
    if (fp.length < 3) continue;
    if (fp[0][0] !== fp.at(-1)[0] || fp[0][1] !== fp.at(-1)[1]) fp.push([...fp[0]]);
    const area = shoelaceArea(fp);
    if (area < MIN_BUILDING_AREA) continue;
    const [cx, cz] = polygonCentroid(fp);
    let height = DEFAULT_BUILDING_HEIGHT;
    if (e.tags.height) { const h = parseFloat(e.tags.height); if (!isNaN(h)) height = h; }
    else if (e.tags['building:levels']) { const l = parseInt(e.tags['building:levels']); if (!isNaN(l)) height = l * METRES_PER_LEVEL; }
    out.set(`${e.type}/${e.id}`, { cx, cz, height: Math.round(height * 10) / 10, area: Math.round(area), footprint: fp, kind: e.tags.building });
  }
  return out;
}
// ─────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchBox(b, depth, log) {
  const key = `${b.s.toFixed(5)}_${b.w.toFixed(5)}_${b.n.toFixed(5)}_${b.e.toFixed(5)}.json`;
  const cached = path.join(CACHE, key);
  let j = null;
  if (existsSync(cached)) j = JSON.parse(await readFile(cached, 'utf8'));
  else {
    const bb = `${b.s},${b.w},${b.n},${b.e}`;
    const q = `[out:json][timeout:180][maxsize:536870912];(way["building"](${bb});relation["building"](${bb}););out count;out body;>;out skel qt;`;
    try {
      j = await overpass(q);
    } catch (err) {
      if (!err.truncated || depth >= 2) throw err;
      log.push({ box: b, depth, split: err.message });
      j = null;
    }
    if (j) {
      const counted = +(j.elements.find(e => e.type === 'count')?.tags?.total ?? -1);
      const got = j.elements.filter(e => (e.type === 'way' || e.type === 'relation') && e.tags?.building).length;
      // Members of building relations can themselves be building ways that sit
      // outside the bbox; they arrive via `>` without being counted. Require
      // at least the counted number; never fewer.
      if (got < counted) {
        if (depth >= 2) throw new Error(`incomplete at depth ${depth}: ${got}/${counted}`);
        log.push({ box: b, depth, split: `incomplete ${got}/${counted}` });
        j = null;
      } else {
        log.push({ box: b, depth, counted, got });
        await writeFile(cached, JSON.stringify(j));
      }
    }
    await sleep(1500);
  }
  if (j) return parseBuildings(j);
  // Split into quarters.
  const ms = (b.s + b.n) / 2, mw = (b.w + b.e) / 2, out = new Map();
  for (const q of [{ s: b.s, w: b.w, n: ms, e: mw }, { s: b.s, w: mw, n: ms, e: b.e }, { s: ms, w: b.w, n: b.n, e: mw }, { s: ms, w: mw, n: b.n, e: b.e }])
    for (const [k, v] of await fetchBox(q, depth + 1, log)) out.set(k, v);
  return out;
}

/** Old records matched to new ones (same footprint centre within 3 m and area within 25%). */
function classify(oldList, fresh) {
  const grid = new Map(), cell = k => `${Math.round(k.cx / 10)},${Math.round(k.cz / 10)}`;
  for (const o of oldList) { const c = cell(o); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(o); }
  const used = new Set(), existing = [], recovered = [];
  for (const n of fresh) {
    let hit = null;
    const gx = Math.round(n.cx / 10), gz = Math.round(n.cz / 10);
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dz = -1; dz <= 1 && !hit; dz++)
      for (const o of grid.get(`${gx + dx},${gz + dz}`) || [])
        if (!used.has(o) && Math.hypot(o.cx - n.cx, o.cz - n.cz) <= 3 && Math.abs(o.area - n.area) <= 0.25 * Math.max(o.area, n.area)) { hit = o; break; }
    if (hit) { used.add(hit); existing.push(n); } else recovered.push(n);
  }
  return { existing, recovered, oldUnmatched: oldList.length - used.size };
}

export function category(kind) {
  const k = (kind || 'yes').toLowerCase();
  if (['house', 'detached', 'semidetached_house', 'terrace', 'residential', 'apartments', 'bungalow', 'flats', 'dormitory'].includes(k)) return 'residential';
  if (['industrial', 'warehouse', 'factory', 'manufacture', 'storage_tank', 'hangar', 'depot', 'transportation', 'train_station', 'service'].includes(k)) return 'industrial / warehouse';
  if (['retail', 'commercial', 'office', 'supermarket', 'kiosk', 'hotel'].includes(k)) return 'commercial / retail';
  if (['garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'greenhouse', 'outbuilding'].includes(k)) return 'garages / sheds / roofs';
  if (['school', 'university', 'college', 'hospital', 'church', 'public', 'civic', 'government', 'sports_centre', 'sports_hall', 'stadium', 'community_centre'].includes(k)) return 'civic / education / health';
  if (k === 'yes') return 'untyped (building=yes)';
  return 'other';
}

function mix(list) {
  const m = {};
  for (const b of list) { const c = category(b.kind); m[c] = (m[c] || 0) + 1; }
  const n = list.length || 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { n: v, pct: +(100 * v / n).toFixed(1) }]));
}

async function main() {
  const args = process.argv.slice(2);
  const arg = f => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  await mkdir(CACHE, { recursive: true });
  let files;
  if (arg('--tiles')) files = arg('--tiles').split(',');
  else {
    const audit = JSON.parse(await readFile(arg('--audit') || path.join(ROOT, 'scripts/.cache/tile-audit.json'), 'utf8'));
    files = audit.short.map(r => r.file);
  }
  const manifestPath = path.join(TILE_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const report = { generated: new Date().toISOString(), tiles: [], replaced: [], totals: {} };
  const allExisting = [], allRecovered = [];
  for (const file of files) {
    const entry = manifest.tiles.find(t => t.file === file);
    if (!entry) { console.warn(`${file}: not in manifest`); continue; }
    const tilePath = path.join(TILE_DIR, file);
    // --baseline <dir>: compare against the ORIGINAL tiles (e.g. the shared,
    // read-only store) so a rerun from the query cache reports the true
    // old -> new change even after this checkout's tiles were replaced.
    const old = JSON.parse(await readFile(arg('--baseline') ? path.join(arg('--baseline'), file) : tilePath, 'utf8'));
    const [s, w] = entry.bounds.sw, [n, e] = entry.bounds.ne;
    const log = [];
    let fresh;
    try {
      // Quarter-size queries from the start (depth 1); each may split once more.
      const ms = (s + n) / 2, mw = (w + e) / 2;
      fresh = new Map();
      for (const q of [{ s, w, n: ms, e: mw }, { s, w: mw, n: ms, e }, { s: ms, w, n, e: mw }, { s: ms, w: mw, n, e }])
        for (const [k, v] of await fetchBox(q, 1, log)) fresh.set(k, v);
    } catch (err) {
      console.warn(`${file}: FAILED ${err.message}`);
      report.tiles.push({ file, error: err.message, log });
      continue;
    }
    const list = [...fresh.values()];
    const cls = classify(old.buildings, list);
    const rec = { file, col: entry.col, row: entry.row, oldCount: old.buildings.length, newCount: list.length,
      recovered: cls.recovered.length, oldUnmatched: cls.oldUnmatched, queries: log.length,
      splits: log.filter(l => l.split).length, replaced: false };
    if (list.length > old.buildings.length) {
      const next = { ...old, buildings: list, refetched: { at: new Date().toISOString(), by: 'scripts/refetch-short-tiles.mjs', previousCount: old.buildings.length } };
      const st = await lstat(tilePath);
      if (st.isSymbolicLink()) await rm(tilePath); // never write through into the shared store
      const text = JSON.stringify(next, null, 2);
      await writeFile(tilePath, text);
      entry.counts = { ...entry.counts, buildings: list.length };
      entry.sizeBytes = text.length;
      rec.replaced = true;
      report.replaced.push(file);
      allExisting.push(...cls.existing); allRecovered.push(...cls.recovered);
    }
    report.tiles.push(rec);
    console.log(`${file}: ${rec.oldCount} -> ${rec.newCount} (recovered ${rec.recovered}, ${rec.splits} splits)${rec.replaced ? '' : ' NOT replaced'}`);
  }
  if (report.replaced.length) {
    manifest.totals.buildings = manifest.tiles.reduce((a, t) => a + (t.counts?.buildings || 0), 0);
    manifest.totals.totalSizeBytes = manifest.tiles.reduce((a, t) => a + (t.sizeBytes || 0), 0);
    const st = await lstat(manifestPath);
    if (st.isSymbolicLink()) await rm(manifestPath);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  const big = b => b.area >= 2000 && b.height <= 15;
  report.totals = {
    tilesReplaced: report.replaced.length,
    oldBuildings: report.tiles.filter(t => t.replaced).reduce((a, t) => a + t.oldCount, 0),
    newBuildings: report.tiles.filter(t => t.replaced).reduce((a, t) => a + t.newCount, 0),
    mixExisting: mix(allExisting), mixRecovered: mix(allRecovered),
    largeLowSheds: { existing: allExisting.filter(big).length, recovered: allRecovered.filter(big).length,
      rule: 'footprint >= 2000 m2 and height <= 15 m' },
    medianAreaM2: { existing: median(allExisting.map(b => b.area)), recovered: median(allRecovered.map(b => b.area)) },
    heightSourced: { existing: pct(allExisting, b => b.height !== DEFAULT_BUILDING_HEIGHT), recovered: pct(allRecovered, b => b.height !== DEFAULT_BUILDING_HEIGHT) },
  };
  await writeFile(path.join(ROOT, 'scripts/.cache/refetch-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.totals, null, 2));
}
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function pct(a, f) { return a.length ? +(100 * a.filter(f).length / a.length).toFixed(1) : null; }

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
