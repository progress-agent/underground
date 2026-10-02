// R3 roads proof (sprint 02Oct26f, lane R): fetch every OSM road inside the M25 from Overpass,
// in blocks of 3x3 surface tiles (about 6 km), cached gzip-compressed in scripts/.cache/roads-overpass/.
// Additive and rerunnable: an existing block file is never refetched or modified.
//
//   node scripts/r-roads/fetch-roads-overpass.mjs [--dry] [--limit n]
//
// Road set: every highway a motor vehicle, a bus or a service vehicle can use, plus pedestrian streets
// and tracks (reported as "other"). Footways, paths, steps, cycleways, bridleways, corridors and
// platforms are excluded. A way crossing a block edge appears in both blocks; the analysis dedups by id.
// Etiquette (Overpass API documentation): two slots, one query at a time here, a pause between queries,
// a descriptive User-Agent, gzip transfer. Data (c) OpenStreetMap contributors, ODbL 1.0.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const req = createRequire(path.join(REPO, 'package.json'));
const proj4 = req('proj4');
const BNG = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs';
const CACHE = path.join(REPO, 'scripts/.cache/roads-overpass');
const GRID = { lat0: 51.2792, lon0: -0.5894, dLat: 0.018, dLon: 0.029, cols: 31, rows: 25, span: 3 };
export const HIGHWAY_RE = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|service|living_street|road|pedestrian|track)$';
// overpass-api.de itself answered 504 for a long stretch on 02Oct26f; its two official sibling servers answered at once.
const ENDPOINTS = ['https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const UA = 'underground-roads-proof/1.0 (throwaway research proof; https://github.com/progress-agent/underground)';

const m25 = JSON.parse(fs.readFileSync(path.join(REPO, 'public/data/m25.json'), 'utf8')).points; // BNG e,n
function inPoly(e, n) {
  let c = false;
  for (let i = 0, j = m25.length - 1; i < m25.length; j = i++) {
    const a = m25[i], b = m25[j];
    if ((a.n > n) !== (b.n > n) && e < (b.e - a.e) * (n - a.n) / (b.n - a.n) + a.e) c = !c;
  }
  return c;
}
export function blocks() {
  const out = [];
  for (let r0 = 0; r0 < GRID.rows; r0 += GRID.span) for (let c0 = 0; c0 < GRID.cols; c0 += GRID.span) {
    const s = GRID.lat0 + r0 * GRID.dLat, n = GRID.lat0 + Math.min(GRID.rows, r0 + GRID.span) * GRID.dLat;
    const w = GRID.lon0 + c0 * GRID.dLon, e = GRID.lon0 + Math.min(GRID.cols, c0 + GRID.span) * GRID.dLon;
    // keep a block when any sample of its box, or any M25 vertex, falls inside it
    let hit = false;
    for (let i = 0; i <= 6 && !hit; i++) for (let j = 0; j <= 6 && !hit; j++) {
      const [E, N] = proj4('EPSG:4326', BNG, [w + (e - w) * i / 6, s + (n - s) * j / 6]);
      if (inPoly(E, N)) hit = true;
    }
    if (!hit) {
      const [E0, N0] = proj4('EPSG:4326', BNG, [w, s]), [E1, N1] = proj4('EPSG:4326', BNG, [e, n]);
      hit = m25.some(p => p.e >= Math.min(E0, E1) && p.e <= Math.max(E0, E1) && p.n >= Math.min(N0, N1) && p.n <= Math.max(N0, N1));
    }
    if (hit) out.push({ id: `blk_${String(c0).padStart(2, '0')}_${String(r0).padStart(2, '0')}`, s, w, n, e });
  }
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchBlock(b) {
  const q = `[out:json][timeout:180];way["highway"~"${HIGHWAY_RE}"](${b.s},${b.w},${b.n},${b.e});out geom;`;
  let lastErr;
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*', 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(240000) });
      if (res.status === 429 || res.status === 504 || res.status === 503) { lastErr = `HTTP ${res.status}`; console.log(`  ${b.id} attempt ${attempt + 1} on ${url}: ${lastErr}`); await sleep(4000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const j = JSON.parse(text);
      if (j.remark && /runtime error|out of memory/i.test(j.remark)) throw new Error(j.remark);
      return { text, osm3s: j.osm3s, n: j.elements.length, endpoint: url };
    } catch (e) { lastErr = String(e); console.log(`  ${b.id} attempt ${attempt + 1} on ${url}: ${lastErr.slice(0, 160)}`); await sleep(8000 * (attempt + 1)); }
  }
  throw new Error(`block ${b.id} failed: ${lastErr}`);
}
async function main() {
  const args = process.argv.slice(2), dry = args.includes('--dry'), limit = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
  fs.mkdirSync(CACHE, { recursive: true });
  const list = blocks();
  console.log(`${list.length} blocks inside the M25 bbox of ${Math.ceil(GRID.cols / GRID.span) * Math.ceil(GRID.rows / GRID.span)}`);
  if (dry) return;
  let done = 0, bytes = 0;
  for (const b of list) {
    const f = path.join(CACHE, b.id + '.json.gz');
    if (fs.existsSync(f)) { continue; }
    if (done >= limit) break;
    const t0 = Date.now();
    const r = await fetchBlock(b);
    fs.writeFileSync(f + '.tmp', zlib.gzipSync(Buffer.from(JSON.stringify({ block: b, fetched: new Date().toISOString(), osm3s: r.osm3s, endpoint: r.endpoint, elements: JSON.parse(r.text).elements }), 'utf8'), { level: 9 }));
    fs.renameSync(f + '.tmp', f);
    done++; bytes += r.text.length;
    console.log(`${b.id} ${r.n} ways, ${(r.text.length / 1e6).toFixed(1)} MB json, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await sleep(3000);
  }
  console.log(`fetched ${done} blocks, ${(bytes / 1e6).toFixed(0)} MB json`);
}
if (import.meta.url === 'file://' + process.argv[1]) main();
