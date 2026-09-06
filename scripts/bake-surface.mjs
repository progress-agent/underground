#!/usr/bin/env node
// Offline surface compiler — buildings half. (Bake go: Jordan, 06Sep26u.)
//
// Precomputes the 1.35M-building tile set from 723MB of JSON into ~13MB of
// packed binary, resolving offline every piece of work the browser currently
// does on the main thread on each tile arrival: terrain lookup, M25 clip, river
// exclusion, dedup, degenerate-data guards. That per-arrival step is measured
// at 7-106ms (median ~46) and is why flying stutters while the still frame is
// fine — p95 150ms, p99 220ms, 362 synchronous rasterisations in a 15s flight.
//
// THREE INVARIANTS. None is an implementation detail; each was a decision.
//
//  1. REAL METRES, NEVER SCENE-Y. Every vertical value written here is in real
//     metres and the renderer multiplies by VE at load. Pre-multiplying would
//     bake VERTICAL_EXAGGERATION into 1.35M records and turn a one-constant
//     change into a full recompile (D-023 §5). Costs 0 bytes; we store
//     decimetres either way.
//
//  2. SUPPRESSION. Buildings inside a landmark's disc are dropped, so a
//     hand-modelled Shard does not stand inside the generic grey box the map
//     data puts there. Registry: scripts/landmarks.mjs.
//
//  3. POLYGON RETENTION. The size win comes from discarding the outline
//     polygon, which nothing reads. Landmarks need theirs back, so they go to a
//     small side-file rather than into the main payload.
//
// THE COMPILER SHARES THE APP'S OWN TERRAIN CODE (src/terrain.js under a Node
// shim), not a reimplementation. Verified bit-identical to the browser across a
// 430-point lattice spanning the full map. A reimplementation that drifted
// would misplace every building silently.
//
// RE-RUN WHEN: the tile set changes, the terrain changes (heightmap, river
// carve, M25 ring), or the landmark registry changes. Not when VE changes.
//
// Usage:  node scripts/bake-surface.mjs [--out public/data/surface/baked]

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { installNodeEnv, ROOT } from './bake-node-env.mjs';
import { LANDMARKS, isSuppressed } from './landmarks.mjs';

installNodeEnv();

const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return path.join(ROOT, i > -1 ? process.argv[i + 1] : 'public/data/surface/baked');
})();

const MAGIC = 0x31424755;    // 'UGB1' little-endian
const REC_BYTES = 10;        // u16 cx_dm, u16 cz_dm, u16 h_dm, u16 side_dm, i16 base_dm
const DIR_BYTES = 16;        // i32 minX, i32 minZ, u32 offset, u32 count

const t0 = Date.now();
const log = (...a) => console.log(...a);

// ── Scene modules, in the app's own boot order ───────────────────────────────
const terrain = await import('../src/terrain.js');
const { initThamesMask, isInThames } = await import('../src/thames-mask.js');
const { loadM25Data, initM25Boundary, isInsideM25 } = await import('../src/m25.js');

const VE = terrain.VERTICAL_EXAGGERATION;
const thamesData = JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8'));

// Order matters and mirrors main.js: the mask must exist before the terrain
// carve and before any isInThames call.
initThamesMask(thamesData.points);
const m25Data = await loadM25Data();
initM25Boundary(m25Data.points);
const mesh = await terrain.tryCreateTerrainMesh({ thamesData });
if (!mesh) throw new Error('terrain mesh failed to build — cannot resolve building base heights');
log(`terrain + masks ready (${Date.now() - t0}ms), VE=${VE}`);

// ── Tiles ────────────────────────────────────────────────────────────────────
const TILE_DIR = path.join(ROOT, 'public/data/surface/tiles');
const manifest = JSON.parse(await readFile(path.join(TILE_DIR, 'manifest.json'), 'utf8'));
// Deterministic order. The live loader dedups in camera-arrival order, so which
// of two boundary duplicates survives depends on flight path; sorting makes the
// baked set reproducible and removes the dispose/reload hash-leak class of bug
// outright, because nothing is ever disposed.
const tiles = [...manifest.tiles].sort((a, b) => a.file.localeCompare(b.file));
log(`${tiles.length} tiles`);

const placed = new Set();                  // dedup: 5m grid + integer height
const retainedPolys = {};                  // landmark id -> [{height, area, footprint}]
const tileRecords = [];
const stats = { read: 0, outsideM25: 0, inThames: 0, suppressed: 0, dup: 0,
                noTerrain: 0, degenerate: 0, kept: 0, emptyTiles: 0 };

for (const tile of tiles) {
  const data = JSON.parse(await readFile(path.join(TILE_DIR, tile.file), 'utf8'));
  const bs = data.buildings || [];
  const recs = [];
  let minX = Infinity, minZ = Infinity;

  for (const b of bs) {
    stats.read++;
    if (!isInsideM25(b.cx, b.cz)) { stats.outsideM25++; continue; }
    if (isInThames(b.cx, b.cz)) { stats.inThames++; continue; }

    const site = isSuppressed(b.cx, b.cz);
    if (site) {
      stats.suppressed++;
      if (b.footprint) (retainedPolys[site] ||= []).push({ height: b.height, area: b.area, footprint: b.footprint });
      continue;
    }

    const hash = `${Math.round(b.cx / 5) * 5},${Math.round(b.cz / 5) * 5},${Math.round(b.height)}`;
    if (placed.has(hash)) { stats.dup++; continue; }
    placed.add(hash);

    // Degenerate OSM data: 76 zero-height + 1 negative-height buildings exist in
    // the set. A zero-length scale axis makes the instance normal matrix divide
    // by zero, and one NaN fragment smears the whole frame through UnrealBloom.
    // The renderer guards this too; dropping it here means it never ships.
    if (!Number.isFinite(b.height) || !Number.isFinite(b.area) || b.area <= 0) { stats.degenerate++; continue; }

    const sceneY = terrain.getTerrainMeshSurfaceY({ x: b.cx, z: b.cz });
    if (sceneY === null || sceneY === undefined || Number.isNaN(sceneY)) { stats.noTerrain++; continue; }

    recs.push({
      cx: b.cx, cz: b.cz,
      hM: Math.max(b.height, 0.5),
      sideM: Math.max(Math.sqrt(b.area), 0.1),
      baseM: sceneY / VE,          // INVARIANT 1: real metres, not scene-Y
    });
    if (b.cx < minX) minX = b.cx;
    if (b.cz < minZ) minZ = b.cz;
    stats.kept++;
  }

  if (!recs.length) { stats.emptyTiles++; continue; }
  tileRecords.push({ file: tile.file, minX: Math.floor(minX), minZ: Math.floor(minZ), recs });
}

log(`scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── Pack ─────────────────────────────────────────────────────────────────────
const n = tileRecords.reduce((a, t) => a + t.recs.length, 0);
const headerBytes = 12 + tileRecords.length * DIR_BYTES;
const buf = Buffer.alloc(headerBytes + n * REC_BYTES);

buf.writeUInt32LE(MAGIC, 0);
buf.writeUInt16LE(1, 4);                      // format version
buf.writeUInt16LE(tileRecords.length, 6);
buf.writeUInt32LE(n, 8);

const clampU16 = (v, what, ctx) => {
  const r = Math.round(v);
  if (r < 0 || r > 65535) throw new Error(`${what} out of u16 range (${r}) at ${ctx} — format assumption broken`);
  return r;
};
const clampI16 = (v, what, ctx) => {
  const r = Math.round(v);
  if (r < -32768 || r > 32767) throw new Error(`${what} out of i16 range (${r}) at ${ctx} — format assumption broken`);
  return r;
};

let off = headerBytes;
tileRecords.forEach((t, i) => {
  const d = 12 + i * DIR_BYTES;
  buf.writeInt32LE(t.minX, d);
  buf.writeInt32LE(t.minZ, d + 4);
  buf.writeUInt32LE(off, d + 8);
  buf.writeUInt32LE(t.recs.length, d + 12);
  for (const r of t.recs) {
    buf.writeUInt16LE(clampU16((r.cx - t.minX) * 10, 'cx', t.file), off);
    buf.writeUInt16LE(clampU16((r.cz - t.minZ) * 10, 'cz', t.file), off + 2);
    buf.writeUInt16LE(clampU16(r.hM * 10, 'height', t.file), off + 4);
    buf.writeUInt16LE(clampU16(r.sideM * 10, 'side', t.file), off + 6);
    buf.writeInt16LE(clampI16(r.baseM * 10, 'baseElev', t.file), off + 8);
    off += REC_BYTES;
  }
});

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'buildings.bin'), buf);
await writeFile(path.join(OUT_DIR, 'landmark-footprints.json'), JSON.stringify(retainedPolys));
await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify({
  format: 'UGB1', version: 1, recordBytes: REC_BYTES, directoryBytes: DIR_BYTES,
  units: 'decimetres; every vertical value is REAL METRES x 10, never scene-Y',
  fields: ['u16 cx_dm (tile-relative)', 'u16 cz_dm (tile-relative)', 'u16 heightM_dm',
           'u16 sideM_dm (sqrt area)', 'i16 baseElevM_dm (terrain elevation, real metres)'],
  tiles: tileRecords.length, buildings: n,
  builtWithVE: VE,
  note: 'builtWithVE is RECORDED, NOT APPLIED — it documents the terrain scale the base elevations were divided by. Changing VE does NOT require a re-bake.',
  landmarks: LANDMARKS.map(l => ({ id: l.id, suppressed: (retainedPolys[l.id] || []).length })),
  stats, generated: new Date().toISOString(),
}, null, 2));

const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
log(`\nbuildings.bin  ${mb(buf.length)}  (${n.toLocaleString()} buildings, ${tileRecords.length} tiles)`);
log('drops:', JSON.stringify(stats));
log('\nlandmark suppression:');
for (const L of LANDMARKS) log(`  ${L.id.padEnd(14)} ${String((retainedPolys[L.id] || []).length).padStart(4)} boxes suppressed / footprints retained`);
log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
