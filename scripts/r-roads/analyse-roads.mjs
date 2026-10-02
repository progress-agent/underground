// R3 roads proof (sprint 02Oct26f, lane R): measure every OSM road inside the M25 and bake it.
//
//   node scripts/r-roads/analyse-roads.mjs [--tol 1.0] [--out <dir>] [--no-masks]
//
// Reads the Overpass blocks cached by fetch-roads-overpass.mjs (scripts/.cache/roads-overpass/), dedups ways by
// id, projects to scene metres with the app's own origin, keeps the segments whose midpoint lies inside the M25 ring
// (public/data/m25.json), and reports:
//   * km by class (motorway, trunk, primary, secondary, tertiary, residential, service, other), bridges and tunnels apart;
//   * raw vertex counts and the counts after Douglas-Peucker simplification;
//   * the size of the network as quantised polylines in a UGB1-style layout (tile-relative decimetres on a regular
//     2 km scene grid), fixed-width and delta-varint, each raw, gzip and brotli;
//   * the geometry cost if drawn as ribbons (triangles, vertices, bytes);
//   * the size of the roads as a rasterised mask at 4096, 8192 and 16384 texels (what the ground artwork would cost).
// It also writes the browser file public/data/r-roads/roads.ugr1 (+ roads-meta.json), which the proof reads.
// Data (c) OpenStreetMap contributors, ODbL 1.0.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { BNG_REF_E, BNG_REF_N } from '../../src/coordinates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const req = createRequire(path.join(REPO, 'package.json'));
const proj4 = req('proj4');
const CACHE = path.join(REPO, 'scripts/.cache/roads-overpass');
const args = process.argv.slice(2);
const argv = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const TOL = +argv('--tol', 1.0);
const OUT_DIR = argv('--out', path.join(REPO, 'public/data/r-roads'));
const REPORT_DIR = argv('--report', '/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/R/roads');
const DO_MASKS = !args.includes('--no-masks');

// ── classes ────────────────────────────────────────────────────────────────
export const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'other'];
// Rendered carriageway width in metres by class: an assumption of the proof (OSM carries width on few ways).
export const CLASS_WIDTH_M = [12, 10, 9, 8, 7, 6, 3.5, 4.5];
const CLASS_OF = {
  motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 2, primary_link: 2, secondary: 3, secondary_link: 3,
  tertiary: 4, tertiary_link: 4, residential: 5, service: 6, unclassified: 7, living_street: 7, road: 7, pedestrian: 7, track: 7,
};

// ── M25 ring in scene metres, with a coarse inside grid for speed ──────────
const m25 = JSON.parse(fs.readFileSync(path.join(REPO, 'public/data/m25.json'), 'utf8')).points.map(p => [p.e - BNG_REF_E, -(p.n - BNG_REF_N)]);
const ringBox = m25.reduce((b, p) => ({ x0: Math.min(b.x0, p[0]), x1: Math.max(b.x1, p[0]), z0: Math.min(b.z0, p[1]), z1: Math.max(b.z1, p[1]) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
function exactInside(x, z) {
  let c = false;
  for (let i = 0, j = m25.length - 1; i < m25.length; j = i++) {
    const a = m25[i], b = m25[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const GC = 200, GX0 = Math.floor(ringBox.x0 / GC) - 1, GZ0 = Math.floor(ringBox.z0 / GC) - 1;
const GW = Math.ceil((ringBox.x1 - ringBox.x0) / GC) + 3, GH = Math.ceil((ringBox.z1 - ringBox.z0) / GC) + 3;
const cellState = new Uint8Array(GW * GH); // 0 outside, 1 inside, 2 boundary (exact test)
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) cellState[j * GW + i] = exactInside((GX0 + i + .5) * GC, (GZ0 + j + .5) * GC) ? 1 : 0;
for (let k = 0; k < m25.length; k++) {
  const a = m25[k], b = m25[(k + 1) % m25.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40) + 1;
  for (let s = 0; s <= n; s++) {
    const x = a[0] + (b[0] - a[0]) * s / n, z = a[1] + (b[1] - a[1]) * s / n;
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const i = Math.floor(x / GC) - GX0 + dx, j = Math.floor(z / GC) - GZ0 + dz;
      if (i >= 0 && i < GW && j >= 0 && j < GH) cellState[j * GW + i] = 2;
    }
  }
}
export function insideM25(x, z) {
  const i = Math.floor(x / GC) - GX0, j = Math.floor(z / GC) - GZ0;
  if (i < 0 || i >= GW || j < 0 || j >= GH) return false;
  const s = cellState[j * GW + i];
  return s === 2 ? exactInside(x, z) : s === 1;
}
let ringAreaKm2 = 0;
for (let i = 0, j = m25.length - 1; i < m25.length; j = i++) ringAreaKm2 += (m25[j][0] * m25[i][1] - m25[i][0] * m25[j][1]) / 2;
ringAreaKm2 = Math.abs(ringAreaKm2) / 1e6;

// ── load, dedup, project ───────────────────────────────────────────────────
function loadWays() {
  const files = fs.readdirSync(CACHE).filter(f => /^blk_.*\.json\.gz$/.test(f)).sort();
  const ways = new Map(); let rawJsonBytes = 0, fetchedBytesGz = 0;
  for (const f of files) {
    const gz = fs.readFileSync(path.join(CACHE, f)); fetchedBytesGz += gz.length;
    const buf = zlib.gunzipSync(gz); rawJsonBytes += buf.length;
    const j = JSON.parse(buf);
    for (const e of j.elements) if (e.type === 'way' && e.geometry && e.geometry.length > 1 && !ways.has(e.id)) ways.set(e.id, e);
  }
  return { ways, files: files.length, rawJsonBytes, fetchedBytesGz };
}
const isTunnel = t => !!t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage';
const isBridge = t => t.bridge && t.bridge !== 'no';
const isM25 = t => /(^|;)(M25|A282)(;|$)/.test(t.ref || '');

function dp(pts, tol) { // pts: [[x,z],...]; returns kept points
  const n = pts.length; if (n < 3 || !(tol > 0)) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop(); if (b <= a + 1) continue;
    const ax = pts[a][0], az = pts[a][1], bx = pts[b][0], bz = pts[b][1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (L2 < 1e-12) d = Math.hypot(pts[i][0] - ax, pts[i][1] - az);
      else { const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - az) * dz) / L2)); d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (az + t * dz)); }
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── 2 km scene grid clipping ───────────────────────────────────────────────
export const CELL_M = 2000;
export const GRID = { x0: -34000, z0: -28000, cols: 35, rows: 29 }; // covers the M25 box with margin
const cellIndex = (x, z) => [Math.floor((x - GRID.x0) / CELL_M), Math.floor((z - GRID.z0) / CELL_M)];
/** Split a polyline at 2 km grid lines; returns [{ci,cj,pts}] pieces (each piece lies in one cell). */
function clipToGrid(pts) {
  const pieces = []; let cur = null;
  const push = (ci, cj, p) => {
    if (!cur || cur.ci !== ci || cur.cj !== cj) { cur = { ci, cj, pts: [] }; pieces.push(cur); }
    const l = cur.pts[cur.pts.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) cur.pts.push(p);
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], ts = [0, 1];
    const gx0 = Math.floor((a[0] - GRID.x0) / CELL_M), gx1 = Math.floor((b[0] - GRID.x0) / CELL_M);
    for (let g = Math.min(gx0, gx1) + 1; g <= Math.max(gx0, gx1); g++) ts.push((GRID.x0 + g * CELL_M - a[0]) / (b[0] - a[0]));
    const gz0 = Math.floor((a[1] - GRID.z0) / CELL_M), gz1 = Math.floor((b[1] - GRID.z0) / CELL_M);
    for (let g = Math.min(gz0, gz1) + 1; g <= Math.max(gz0, gz1); g++) ts.push((GRID.z0 + g * CELL_M - a[1]) / (b[1] - a[1]));
    ts.sort((p, q) => p - q);
    for (let s = 0; s < ts.length - 1; s++) {
      const t0 = ts[s], t1 = ts[s + 1]; if (t1 - t0 < 1e-12) continue;
      const tm = (t0 + t1) / 2, [ci, cj] = cellIndex(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm);
      push(ci, cj, [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
      push(ci, cj, [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    }
  }
  return pieces.filter(p => p.pts.length > 1);
}

// ── binary writers ─────────────────────────────────────────────────────────
function writeFixed(cells) { // UGR1 fixed width
  const keys = [...cells.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(24); header.write('UGR1', 0, 'ascii'); header.writeUInt16LE(1, 4); header.writeUInt16LE(CELL_M, 6);
  header.writeUInt16LE(GRID.cols, 8); header.writeUInt16LE(GRID.rows, 10); header.writeInt32LE(GRID.x0, 12); header.writeInt32LE(GRID.z0, 16); header.writeUInt32LE(keys.length, 20);
  const dir = Buffer.alloc(keys.length * 16); const bodies = []; let off = 24 + dir.length;
  keys.forEach((k, n) => {
    const pcs = cells.get(k); let size = 0, verts = 0;
    for (const p of pcs) { size += 3 + p.q.length * 2; verts += p.q.length / 2; }
    const body = Buffer.alloc(size); let o = 0;
    for (const p of pcs) { body.writeUInt8(p.cls | (p.bridge ? 0x10 : 0), o++); body.writeUInt16LE(p.q.length / 2, o); o += 2; for (const v of p.q) { body.writeUInt16LE(v, o); o += 2; } }
    dir.writeUInt16LE(k % GRID.cols, n * 16); dir.writeUInt16LE(Math.floor(k / GRID.cols), n * 16 + 2); dir.writeUInt32LE(off, n * 16 + 4); dir.writeUInt32LE(pcs.length, n * 16 + 8); dir.writeUInt32LE(verts, n * 16 + 12);
    off += size; bodies.push(body);
  });
  return Buffer.concat([header, dir, ...bodies]);
}
function varint(out, v) { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
const zig = v => (v << 1) ^ (v >> 31);
function writeDelta(cells) { // same directory, pieces as zigzag varint deltas
  const keys = [...cells.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(24); header.write('UGR2', 0, 'ascii');
  const dir = Buffer.alloc(keys.length * 16); const out = [];
  keys.forEach((k, n) => {
    for (const p of cells.get(k)) {
      out.push(p.cls | (p.bridge ? 0x10 : 0)); varint(out, p.q.length / 2);
      let px = 0, pz = 0;
      for (let i = 0; i < p.q.length; i += 2) { varint(out, zig(p.q[i] - px)); varint(out, zig(p.q[i + 1] - pz)); px = p.q[i]; pz = p.q[i + 1]; }
    }
  });
  return Buffer.concat([header, dir, Buffer.from(out)]);
}
const gz = b => zlib.gzipSync(b, { level: 9 }).length;
const br = b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

// ── mask raster ────────────────────────────────────────────────────────────
function rasterMask(pieces, N, bbox) {
  const sx = N / (bbox.maxX - bbox.minX), sz = N / (bbox.maxZ - bbox.minZ); // texels per metre
  const bits = new Uint8Array(N * N / 8);
  const set = (x, z) => { const i = z * N + x; bits[i >> 3] |= 1 << (i & 7); };
  for (const p of pieces) {
    const halfPxX = Math.max(p.w / 2 * sx, 0.5), halfPxZ = Math.max(p.w / 2 * sz, 0.5);
    for (let k = 0; k < p.pts.length - 1; k++) {
      const ax = (p.pts[k][0] - bbox.minX) * sx, az = (p.pts[k][1] - bbox.minZ) * sz, bx = (p.pts[k + 1][0] - bbox.minX) * sx, bz = (p.pts[k + 1][1] - bbox.minZ) * sz;
      const hp = Math.max(halfPxX, halfPxZ);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hp)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + hp));
      const z0 = Math.max(0, Math.floor(Math.min(az, bz) - hp)), z1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + hp));
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const px = x + .5 - ax, pz = z + .5 - az;
        const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (px * dx + pz * dz) / L2));
        const ex = (px - t * dx) / halfPxX, ez = (pz - t * dz) / halfPxZ;
        if (ex * ex + ez * ez <= 1) set(x, z);
      }
    }
  }
  let on = 0; for (let i = 0; i < bits.length; i++) { let v = bits[i]; while (v) { on += v & 1; v >>= 1; } }
  return { bits, on };
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const t0 = Date.now();
  const { ways, files, rawJsonBytes, fetchedBytesGz } = loadWays();
  console.log(`${files} blocks, ${ways.size} unique ways, ${(rawJsonBytes / 1e6).toFixed(0)} MB raw Overpass JSON (${(fetchedBytesGz / 1e6).toFixed(0)} MB gzip on disk)`);
  const blank = () => ({ ways: 0, km: 0, kmBridge: 0, kmTunnelExcluded: 0, vertsRaw: 0, vertsSimplified: 0, pieces: 0, ribbonTriangles: 0, ribbonVertices: 0 });
  const stat = Object.fromEntries(CLASSES.map(c => [c, blank()]));
  const serviceSub = {}; const m25Km = { ring: 0 }; let tunnelKm = 0, outsideKm = 0, withWidth = 0, withLanes = 0, waysInside = 0;
  const wayLabel = Object.fromEntries(CLASSES.map(c => [c, new Set()]));
  const cells = new Map(); const maskPieces = []; const allPieces = [];
  const RIBBON_STEP = 20; // max metres between drape samples
  for (const w of ways.values()) {
    const t = w.tags || {}, cls = CLASS_OF[t.highway]; if (cls === undefined) continue;
    const xy = w.geometry.map(p => { const [E, N] = proj4('EPSG:4326', 'EPSG:27700', [p.lon, p.lat]); return [E - BNG_REF_E, -(N - BNG_REF_N)]; });
    // keep the runs of segments whose midpoint is inside the M25
    const runs = []; let cur = null; let kmIn = 0;
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i], b = xy[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (insideM25((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) { if (!cur) { cur = [a]; runs.push(cur); } cur.push(b); kmIn += len / 1000; } else { cur = null; if (len) outsideKm += len / 1000; }
    }
    if (!runs.length) continue;
    const name = CLASSES[cls], S = stat[name];
    if (isM25(t)) { m25Km.ring += kmIn; continue; }
    if (isTunnel(t)) { S.kmTunnelExcluded += kmIn; tunnelKm += kmIn; continue; } // underground: not drawn at the surface (D-040)
    waysInside++; S.ways++; S.km += kmIn; if (isBridge(t)) S.kmBridge += kmIn;
    if (t.width) withWidth++; if (t.lanes) withLanes++;
    if (name === 'service') { const sv = t.service || 'unspecified'; serviceSub[sv] = (serviceSub[sv] || 0) + kmIn; }
    for (const run of runs) {
      S.vertsRaw += run.length;
      const simp = dp(run, TOL); S.vertsSimplified += simp.length;
      for (const pc of clipToGrid(simp)) {
        const x0 = GRID.x0 + pc.ci * CELL_M, z0 = GRID.z0 + pc.cj * CELL_M;
        const q = []; for (const p of pc.pts) q.push(Math.max(0, Math.min(65535, Math.round((p[0] - x0) * 10))), Math.max(0, Math.min(65535, Math.round((p[1] - z0) * 10))));
        const key = pc.cj * GRID.cols + pc.ci; if (!cells.has(key)) cells.set(key, []);
        const piece = { cls, bridge: isBridge(t), q, pts: pc.pts, w: CLASS_WIDTH_M[cls] };
        cells.get(key).push(piece); S.pieces++;
        let len = 0; for (let i = 1; i < pc.pts.length; i++) len += Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]);
        // ribbon: drape samples at most RIBBON_STEP metres apart, two rail vertices per sample, two triangles per step
        let steps = 0; for (let i = 1; i < pc.pts.length; i++) steps += Math.max(1, Math.ceil(Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]) / RIBBON_STEP));
        S.ribbonTriangles += steps * 2; S.ribbonVertices += (steps + 1) * 2;
        piece.len = len; allPieces.push(piece);
      }
      maskPieces.push({ pts: simp, w: CLASS_WIDTH_M[cls] });
    }
  }
  const total = blank(); for (const s of Object.values(stat)) for (const k of Object.keys(total)) total[k] += s[k];
  for (const s of [...Object.values(stat), total]) for (const k of Object.keys(s)) s[k] = Math.round(s[k] * 10) / 10;
  const fixed = writeFixed(cells), delta = writeDelta(cells);
  const fixedPerClass = {}; // bytes per class in the fixed layout (3 + 4n per piece)
  for (const pcs of cells.values()) for (const p of pcs) fixedPerClass[CLASSES[p.cls]] = (fixedPerClass[CLASSES[p.cls]] || 0) + 3 + p.q.length * 2;
  const cellsUsed = cells.size;
  const sizes = {
    tolerance_m: TOL, cellM: CELL_M, cellsWithRoads: cellsUsed,
    fixedBytes: fixed.length, fixedGzip: gz(fixed), fixedBrotli: br(fixed),
    deltaBytes: delta.length, deltaGzip: gz(delta), deltaBrotli: br(delta),
    fixedBytesPerClass: fixedPerClass,
    ribbonFloat32Bytes: total.ribbonVertices * 12, ribbonIndex16Bytes: total.ribbonTriangles * 3 * 2, ribbonIndex32Bytes: total.ribbonTriangles * 3 * 4,
    ribbonQuantisedVertexBytes: total.ribbonVertices * 4, // u16 x, u16 z tile-relative; y from the terrain in the shader
  };
  let masks = null;
  if (DO_MASKS) {
    const bbox = { minX: -32471, maxX: 31089, minZ: -25531, maxZ: 26096 }; // the existing ground bake's bounds
    masks = {};
    for (const N of [4096, 8192, 16384]) {
      for (const [label, filter] of [['allRoads', () => true], ['primaryAndTrunkOnly', p => p.w >= 9]]) {
        if (N === 16384 && label !== 'allRoads') continue;
        const { bits, on } = rasterMask(maskPieces.filter(filter), N, bbox);
        masks[`${N}_${label}`] = { texels: N, texelMetresX: +(((bbox.maxX - bbox.minX) / N).toFixed(2)), texelMetresZ: +(((bbox.maxZ - bbox.minZ) / N).toFixed(2)), roadTexels: on, coverage: +(on / (N * N)).toExponential(2), bitmaskBytes: bits.length, gzip: gz(Buffer.from(bits.buffer)), brotli: br(Buffer.from(bits.buffer)), r8TextureBytes: N * N, rgba8TextureBytes: N * N * 4 };
        console.log(`mask ${N} ${label}: ${on} texels on, brotli ${(masks[`${N}_${label}`].brotli / 1e6).toFixed(2)} MB`);
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'roads.ugr1'), fixed);
  const meta = { format: 'UGR1', generated: new Date().toISOString(), tolerance_m: TOL, cellM: CELL_M, grid: GRID, classes: CLASSES, classWidthM: CLASS_WIDTH_M, bytes: fixed.length, source: 'OpenStreetMap contributors, ODbL 1.0, via Overpass', note: 'Throwaway proof (sprint 02Oct26f lane R). Roads inside the M25 as quantised polylines, tile-relative decimetres on a 2 km scene grid.' };
  fs.writeFileSync(path.join(OUT_DIR, 'roads-meta.json'), JSON.stringify(meta, null, 1));
  const result = {
    generated: new Date().toISOString(), blocks: files, uniqueWaysFetched: ways.size, rawOverpassJsonBytes: rawJsonBytes, overpassGzipOnDiskBytes: fetchedBytesGz,
    m25RingAreaKm2: +ringAreaKm2.toFixed(0), waysInsideM25: waysInside, wayTagCoverage: { withWidthTag: withWidth, withLanesTag: withLanes },
    classes: stat, total, m25RingKmExcluded: +m25Km.ring.toFixed(1), tunnelKmExcluded: +tunnelKm.toFixed(1), serviceKmBySubtype: Object.fromEntries(Object.entries(serviceSub).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v)])),
    sizes, masks, elapsedS: (Date.now() - t0) / 1000,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'stats.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ total, sizes: { ...sizes, fixedBytesPerClass: undefined } }, null, 1));
  // pieces of at least 250 m on the larger classes, for the synthetic bus fleet
  console.log('pieces >=250m, classes motorway..tertiary:', allPieces.filter(p => p.cls <= 4 && p.len >= 250).length);
}
if (import.meta.url === 'file://' + process.argv[1]) main();
