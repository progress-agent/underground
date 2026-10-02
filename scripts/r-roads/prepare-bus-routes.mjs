// R3 roads proof (sprint 02Oct26f, lane R): turn the cached TfL route sequences for bus routes 25 and 73
// into scene-metre polylines for the proof (public/data/r-roads/bus-routes.json), and check how well each
// route lies on the OSM road network that analyse-roads.mjs baked (public/data/r-roads/roads.ugr1).
//
//   node scripts/r-roads/prepare-bus-routes.mjs [--fetch]
//
// --fetch (re)downloads the four route sequences from the TfL Unified API with no key and no account
// (scripts/.cache/tfl-bus-routes/, additive); otherwise the cache is used.
// Source: https://api.tfl.gov.uk/Line/{id}/Route/Sequence/{direction}  (TfL Unified API, Open Government Licence v3.0
// with TfL's data terms; powered by TfL Open Data).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { BNG_REF_E, BNG_REF_N } from '../../src/coordinates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const req = createRequire(path.join(REPO, 'package.json'));
const proj4 = req('proj4');
const CACHE = path.join(REPO, 'scripts/.cache/tfl-bus-routes');
const OUT = path.join(REPO, 'public/data/r-roads');
const ROUTES = ['25', '73'];
const proj = (lon, lat) => { const [E, N] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return [E - BNG_REF_E, -(N - BNG_REF_N)]; };
const len = pts => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return d; };

async function fetchAll() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const l of ROUTES) for (const d of ['outbound', 'inbound']) {
    const res = await fetch(`https://api.tfl.gov.uk/Line/${l}/Route/Sequence/${d}`, { headers: { 'User-Agent': 'underground-roads-proof/1.0' } });
    fs.writeFileSync(path.join(CACHE, `${l}-${d}.json`), Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(path.join(CACHE, `${l}-${d}.headers`), [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n'));
    await new Promise(r => setTimeout(r, 1000));
  }
}
/** Chainage of the nearest point on the polyline. */
function chainageOf(pts, cum, x, z) {
  let best = Infinity, bc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az, L2 = dx * dx + dz * dz;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) { best = d; bc = cum[i] + t * Math.sqrt(L2); }
  }
  return bc;
}
/** Read the UGR1 file into per-piece scene-metre polylines (for the on-road check). */
function readUgr1(file) {
  const b = fs.readFileSync(file), n = b.readUInt32LE(20), x0 = b.readInt32LE(12), z0 = b.readInt32LE(16), cols = b.readUInt16LE(8), cell = b.readUInt16LE(6), out = [];
  for (let k = 0; k < n; k++) {
    const ci = b.readUInt16LE(24 + k * 16), cj = b.readUInt16LE(24 + k * 16 + 2); let o = b.readUInt32LE(24 + k * 16 + 4); const pc = b.readUInt32LE(24 + k * 16 + 8);
    for (let p = 0; p < pc; p++) {
      const cls = b.readUInt8(o) & 15, m = b.readUInt16LE(o + 1); o += 3; const pts = [];
      for (let i = 0; i < m; i++) { pts.push([x0 + ci * cell + b.readUInt16LE(o) / 10, z0 + cj * cell + b.readUInt16LE(o + 2) / 10]); o += 4; }
      out.push({ cls, pts });
    }
  }
  return out;
}
function onRoadCheck(routePts, pieces) {
  // bucket road segments in 100 m cells; for each route sample (every 25 m), the distance to the nearest segment
  const B = 100, grid = new Map();
  for (const p of pieces) for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i], c = p.pts[i + 1];
    for (let gx = Math.floor(Math.min(a[0], c[0]) / B); gx <= Math.floor(Math.max(a[0], c[0]) / B); gx++) for (let gz = Math.floor(Math.min(a[1], c[1]) / B); gz <= Math.floor(Math.max(a[1], c[1]) / B); gz++) {
      const k = gx * 100003 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a[0], a[1], c[0], c[1], p.cls]);
    }
  }
  const ds = [];
  for (let i = 0; i < routePts.length - 1; i++) {
    const a = routePts[i], b = routePts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 25));
    for (let s = 0; s < n; s++) {
      const x = a[0] + (b[0] - a[0]) * s / n, z = a[1] + (b[1] - a[1]) * s / n; let best = Infinity;
      for (let gx = Math.floor(x / B) - 1; gx <= Math.floor(x / B) + 1; gx++) for (let gz = Math.floor(z / B) - 1; gz <= Math.floor(z / B) + 1; gz++) for (const sg of grid.get(gx * 100003 + gz) || []) {
        const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz, t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - sg[0]) * dx + (z - sg[1]) * dz) / L2));
        const d = Math.hypot(x - (sg[0] + t * dx), z - (sg[1] + t * dz)); if (d < best) best = d;
      }
      ds.push(best);
    }
  }
  ds.sort((p, q) => p - q);
  const within = m => ds.filter(d => d <= m).length / ds.length;
  return { samples: ds.length, within5m: +within(5).toFixed(3), within10m: +within(10).toFixed(3), within20m: +within(20).toFixed(3), medianM: +ds[Math.floor(ds.length / 2)].toFixed(1), p95M: +ds[Math.floor(ds.length * 0.95)].toFixed(1), maxM: +ds[ds.length - 1].toFixed(1) };
}
async function main() {
  if (process.argv.includes('--fetch')) await fetchAll();
  const roadsFile = path.join(OUT, 'roads.ugr1'), pieces = fs.existsSync(roadsFile) ? readUgr1(roadsFile) : null;
  const routes = {}, report = {};
  for (const l of ROUTES) {
    routes[l] = {};
    for (const d of ['outbound', 'inbound']) {
      const j = JSON.parse(fs.readFileSync(path.join(CACHE, `${l}-${d}.json`), 'utf8'));
      const ls = JSON.parse(j.lineStrings[0])[0].map(([lon, lat]) => proj(lon, lat));
      // drop immediate duplicates
      const pts = ls.filter((p, i) => i === 0 || Math.hypot(p[0] - ls[i - 1][0], p[1] - ls[i - 1][1]) > 0.05);
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const stops = j.stopPointSequences[0].stopPoint.map(s => { const [x, z] = proj(s.lon, s.lat); return { name: s.name, id: s.id, x: +x.toFixed(1), z: +z.toFixed(1), chain: +chainageOf(pts, cum, x, z).toFixed(1) }; });
      routes[l][d] = { name: j.orderedLineRoutes[0].name.replace(/&harr;/g, 'to').replace(/\s+/g, ' '), lengthM: +cum.at(-1).toFixed(1), points: pts.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]), stops };
      report[`${l}-${d}`] = { name: routes[l][d].name, lengthKm: +(cum.at(-1) / 1000).toFixed(2), vertices: pts.length, stops: stops.length, meanStopSpacingM: +(cum.at(-1) / Math.max(1, stops.length - 1)).toFixed(0), ...(pieces ? { onRoad: onRoadCheck(pts, pieces) } : {}) };
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'bus-routes.json'), JSON.stringify({ source: 'TfL Unified API Line/{id}/Route/Sequence/{direction}, fetched 02Oct26f, no key', generated: new Date().toISOString(), routes }));
  console.log(JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join('/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/R/roads', 'bus-routes-stats.json'), JSON.stringify(report, null, 1));
}
main();
