#!/usr/bin/env node
/**
 * audit-building-tiles.mjs: find surface tiles whose building list is short.
 *
 * Sprint 25Sep26f Lane E (D-039). Some 2km OSM tiles were fetched in a single
 * Overpass query that came back truncated (Overpass answers HTTP 200 with a
 * `remark: runtime error` and a partial element list when it hits its time or
 * memory cap), so whole districts such as Park Royal and West Acton carry a
 * fraction of their real buildings.
 *
 * Two signals per tile:
 *   1. density against its eight neighbours (tile buildings / km2);
 *   2. the live OSM count for the same bbox (`out count`, cheap on the server).
 * A tile is SHORT when the file holds under SHORT_RATIO of the OSM count. The
 * ratio is never 1.0 even for a healthy tile: the fetch drops footprints under
 * 20 m2 and OSM has grown since the fetch, so healthy tiles sit around 0.85-0.95.
 *
 * Usage:
 *   node scripts/audit-building-tiles.mjs [--tiles 10_13,9_13] [--out file.json]
 * Results are cached per tile in scripts/.cache/osm-counts/ so a rerun is free.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE_DIR = path.join(ROOT, 'public/data/surface/tiles');
const CACHE_DIR = path.join(ROOT, 'scripts/.cache/osm-counts');
export const SHORT_RATIO = 0.6;
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const UA = 'UnderGround-surface-audit/1.0 (+https://under-ground.pages.dev)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query, { attempts = 6 } = {}) {
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      // A truncated answer is still HTTP 200: the only tell is the remark.
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
        const e = new Error(`TRUNCATED: ${json.remark}`); e.truncated = true; throw e;
      }
      return json;
    } catch (err) {
      if (err.truncated) throw err;
      if (a === attempts) throw err;
      const wait = Math.min(5000 * 2 ** (a - 1), 90000);
      console.warn(`  overpass retry ${a} in ${wait}ms (${err.message})`);
      await sleep(wait);
    }
  }
}

export function bboxOf(tile) {
  const [s, w] = tile.bounds.sw; const [n, e] = tile.bounds.ne;
  return { s, w, n, e };
}

/** Live OSM building counts for many tiles in ONE request (one `out count`
 * per bbox, answered in order), cached per tile. */
async function osmCounts(tiles) {
  const need = tiles.filter(t => !existsSync(path.join(CACHE_DIR, t.file)));
  if (need.length) {
    const q = '[out:json][timeout:600];' + need.map(t => {
      const { s, w, n, e } = bboxOf(t);
      return `(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out count;`;
    }).join('');
    const j = await overpass(q);
    const counts = j.elements.filter(e => e.type === 'count');
    if (counts.length !== need.length) throw new Error(`expected ${need.length} counts, got ${counts.length}`);
    for (let k = 0; k < need.length; k++) {
      const t = counts[k].tags;
      await writeFile(path.join(CACHE_DIR, need[k].file), JSON.stringify({ ways: +t.ways, relations: +t.relations, total: +t.total, osmBase: j.osm3s?.timestamp_osm_base }));
    }
  }
  const out = new Map();
  for (const t of tiles) out.set(t.file, JSON.parse(await readFile(path.join(CACHE_DIR, t.file), 'utf8')));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--tiles') ? new Set(args[args.indexOf('--tiles') + 1].split(',')) : null;
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'scripts/.cache/tile-audit.json');
  await mkdir(CACHE_DIR, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(TILE_DIR, 'manifest.json'), 'utf8'));
  const byKey = new Map();
  for (const t of manifest.tiles) {
    const d = JSON.parse(await readFile(path.join(TILE_DIR, t.file), 'utf8'));
    const bb = t.sceneBBox;
    const km2 = ((bb.maxX - bb.minX) * (bb.maxZ - bb.minZ)) / 1e6;
    byKey.set(`${t.col}_${t.row}`, { tile: t, count: d.buildings.length, km2 });
  }
  const rows = [];
  const entries = [...byKey.entries()].filter(([k]) => !only || only.has(k));
  const BATCH = +(process.env.AUDIT_BATCH || 20);
  const osm = new Map();
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH).map(([, v]) => v.tile);
    try { for (const [f, c] of await osmCounts(batch)) osm.set(f, c); }
    catch (err) { console.warn(`  batch ${i}: ${err.message}`); }
    console.log(`  ${Math.min(i + BATCH, entries.length)}/${entries.length}`);
  }
  for (const [key, v] of entries) {
    const nb = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const o = byKey.get(`${v.tile.col + dc}_${v.tile.row + dr}`);
      if (o) nb.push(o.count / o.km2);
    }
    nb.sort((a, b) => a - b);
    const nbMedian = nb.length ? nb[Math.floor(nb.length / 2)] : 0;
    const o = osm.get(v.tile.file) ?? null;
    const ratio = o ? v.count / Math.max(1, o.total) : null;
    rows.push({ key, file: v.tile.file, col: v.tile.col, row: v.tile.row, count: v.count,
      density: +(v.count / v.km2).toFixed(1), nbMedianDensity: +nbMedian.toFixed(1),
      osm: o?.total ?? null, osmDensity: o ? +(o.total / v.km2).toFixed(1) : null,
      ratio: ratio === null ? null : +ratio.toFixed(3),
      short: ratio !== null && ratio < SHORT_RATIO && o.total - v.count > 200 });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const short = rows.filter((r) => r.short).sort((a, b) => a.ratio - b.ratio);
  await writeFile(out, JSON.stringify({ generated: new Date().toISOString(), shortRatio: SHORT_RATIO, short, rows }, null, 2));
  console.log(`\n${short.length} short tiles (file < ${SHORT_RATIO} x OSM count and > 200 missing):`);
  for (const r of short) console.log(`  ${r.file}  file ${r.count}  osm ${r.osm}  ratio ${r.ratio}  density ${r.density}/km2 (neighbours ${r.nbMedianDensity})`);
  console.log(`\nwritten ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
