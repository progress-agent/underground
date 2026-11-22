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
// Usage:  node scripts/bake-surface.mjs [--out public/data/surface/baked] [--vertical-reference <UGB1>] [--promote]
//
// DATA SAFETY (sprint 01Oct26h, D-043). public/data/surface is shared: in a
// worktree it is usually a symlink, or holds symlinks, into the main checkout's
// store, which production builds from. Before any work this script refuses an
// output directory that resolves outside this checkout or into the main
// store (the main checkout itself needs --promote), or a file there that is a
// link it would write through (scripts/surface-overlay.mjs assertBakeOutput);
// the remedy is `node scripts/surface-overlay.mjs prepare`. Each file is then
// written to a temporary name and renamed into place.

import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installNodeEnv, ROOT } from './bake-node-env.mjs';
import { LANDMARKS, isSuppressed } from './landmarks.mjs';
import { createHash } from 'node:crypto';
import { createAirportSuppression, airportSuppressionSignature, AIRPORT_SUPPRESSION_VERSION } from '../src/airport-suppression.js';
import { assertBakeOutput, writeLocal, OverlayError } from './surface-overlay.mjs';

import { buildingShape } from './buildings/shape.mjs';
import { encodeBuildingArea, encodeBuildingAspect } from '../src/building-record.js';
import { createStationBuildingIndex } from '../src/station-buildings.js';
import { isOffMapEdge } from '../src/m25-edge.js';
import { createTidewayBuildingExclusion } from '../src/tideway-platforms.js';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
installNodeEnv();

const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return path.join(ROOT, i > -1 ? process.argv[i + 1] : 'public/data/surface/baked');
})();

// The guard (DATA SAFETY above), before any of the work below.
const GUARD = { root: ROOT, promote: process.argv.includes('--promote') };
const OUT_FILES = ['buildings.bin', 'landmark-footprints.json', 'meta.json', 'buildings-square.bin', 'meta-square.json', 'station-buildings-square.json'];
try {
  await assertBakeOutput(OUT_DIR, OUT_FILES, GUARD);
} catch (e) {
  if (!(e instanceof OverlayError)) throw e;
  console.error(e.message);
  process.exit(1);
}

const MAGIC = 0x32424755;    // 'UGB2' little-endian
const REC_BYTES = 14;        // cx_dm, cz_dm, h_dm, area16, base_dm, aspect16, theta16
const DIR_BYTES = 16;        // i32 minX, i32 minZ, u32 offset, u32 count

const referenceArg=process.argv.indexOf('--vertical-reference');
const referenceFile=referenceArg<0?null:process.argv[referenceArg+1];
const reference=referenceFile?await readFile(path.resolve(referenceFile)):null;
const referenceMeta=referenceFile?JSON.parse(await readFile(path.join(path.dirname(path.resolve(referenceFile)),'meta.json'),'utf8')):null;
if(reference && (reference.readUInt32LE(0)!==0x31424755||reference.readUInt16LE(4)!==1))throw new Error('vertical reference must be the pinned UGB1 live bake');
let referenceTile=0,referenceRecord=0;
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
initM25Boundary(m25Data.supportPoints || m25Data.points);
const mesh = await terrain.tryCreateTerrainMesh({ thamesData });
if (!mesh) throw new Error('terrain mesh failed to build — cannot resolve building base heights');
log(`terrain + masks ready (${Date.now() - t0}ms), VE=${VE}`);
const stations = createStationBuildingIndex(JSON.parse(await readFile(path.join(ROOT,'public/data/station-buildings.json'),'utf8')));
const tideway = createTidewayBuildingExclusion((lat,lon)=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return {x:e-BNG_REF_E,z:BNG_REF_N-n};});
const predicates = [b=>stations.hidesBox(b), isOffMapEdge, tideway];
const identityCentres = {};


const airportData=JSON.parse(await readFile(path.join(ROOT,'src/airport-data.json'),'utf8'));
const isAirportBuilding=createAirportSuppression(airportData);
const airportFingerprint=await airportSuppressionSignature(airportData);

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
const stats = { read: 0, outsideM25: 0, inThames: 0, suppressed: 0, airportsSuppressed: 0, dup: 0,
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
    // This precedes landmark neighbour retention, so airport replacement
    // footprints cannot be accidentally restored by the landmark companion.
    if (isAirportBuilding(b)) { stats.airportsSuppressed++; continue; }

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

    const sceneY = terrain.getStructuralSurfaceY({ x: b.cx, z: b.cz });
    if (sceneY === null || sceneY === undefined || Number.isNaN(sceneY)) { stats.noTerrain++; continue; }

    let heightM=Math.max(b.height,.5),baseM=sceneY/VE;
    if(reference){
      const d=12+referenceTile*16,ro=reference.readUInt32LE(d+8)+referenceRecord*10;
      const sx=reference.readInt32LE(d)+reference.readUInt16LE(ro)*.1,sz=reference.readInt32LE(d+4)+reference.readUInt16LE(ro+2)*.1;
      if(Math.abs(sx-b.cx)>.0500001||Math.abs(sz-b.cz)>.0500001||Math.abs(reference.readUInt16LE(ro+4)*.1-heightM)>.0500001)throw new Error('vertical reference population/order differs from source at '+tile.file);
      heightM=reference.readUInt16LE(ro+4)*.1;baseM=reference.readInt16LE(ro+8)*.1;referenceRecord++;
    }
    const shape = buildingShape(b);
    recs.push({
      cx: shape.cx, cz: shape.cz, sourceX: b.cx, sourceZ: b.cz,
      width: shape.w, depth: shape.h, theta: shape.theta,
      hM: heightM,
      sideM: Math.max(Math.sqrt(b.area), 0.1),
      baseM,          // INVARIANT 1: real metres, not scene-Y
    });
    if (Math.min(b.cx,shape.cx) < minX) minX = Math.min(b.cx,shape.cx);
    if (Math.min(b.cz,shape.cz) < minZ) minZ = Math.min(b.cz,shape.cz);
    stats.kept++;
  }

  if (!recs.length) { stats.emptyTiles++; continue; }
  if(reference){if(referenceRecord!==reference.readUInt32LE(12+referenceTile*16+12))throw new Error('vertical reference tile count differs');referenceTile++;referenceRecord=0;}
  tileRecords.push({ file: tile.file, minX: Math.floor(minX), minZ: Math.floor(minZ), recs });
}

log(`scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── Pack ─────────────────────────────────────────────────────────────────────
if(reference&&referenceTile!==reference.readUInt16LE(6))throw new Error('vertical reference total tiles differ');
const n = tileRecords.reduce((a, t) => a + t.recs.length, 0);
const headerBytes = 12 + tileRecords.length * DIR_BYTES;
const buf = Buffer.alloc(headerBytes + n * REC_BYTES);

buf.writeUInt32LE(MAGIC, 0);
buf.writeUInt16LE(2, 4);                      // format version
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
    buf.writeUInt16LE(encodeBuildingArea(r.width*r.depth), off + 6);
    buf.writeInt16LE(clampI16(r.baseM * 10, 'baseElev', t.file), off + 8);
    buf.writeUInt16LE(Math.round(encodeBuildingAspect(r.width/r.depth)/16)*16, off + 10);
    buf.writeUInt16LE(Math.min(127,Math.round(r.theta / (Math.PI / 2) * 128))*512, off + 12);
    const source = {x:t.minX+Math.round((r.sourceX-t.minX)*10)*.1,z:t.minZ+Math.round((r.sourceZ-t.minZ)*10)*.1};
    const drawn = {x:t.minX+Math.round((r.cx-t.minX)*10)*.1,z:t.minZ+Math.round((r.cz-t.minZ)*10)*.1};
    // Retain source identity only where shifting the centre changes any existing
    // suppression predicate. No million-entry JS identity map is kept on phones.
    if (predicates.some(test=>test(source)!==test(drawn)) || (reference && terrain.getReservoirFootDelta(source.x,source.z)!==terrain.getReservoirFootDelta(drawn.x,drawn.z))) identityCentres[off] = [source.x,source.z];
    off += REC_BYTES;
  }
});

await mkdir(OUT_DIR, { recursive: true });
await writeLocal(path.join(OUT_DIR,'station-buildings-square.json'),execFileSync('git',['show','b3a51d4:public/data/station-buildings.json'],{cwd:ROOT}),GUARD);
await writeLocal(path.join(OUT_DIR, 'buildings.bin'), buf, GUARD);
await writeLocal(path.join(OUT_DIR, 'landmark-footprints.json'), JSON.stringify(retainedPolys), GUARD);
const metadata = {
  format: 'UGB2', version: 2, recordBytes: REC_BYTES, directoryBytes: DIR_BYTES,
  units: 'decimetres; every vertical value is REAL METRES x 10, never scene-Y',
  fields: ['u16 cx_dm (tile-relative)', 'u16 cz_dm (tile-relative)', 'u16 heightM_dm',
           'u16 area_half_m2_or_log2_2048', 'i16 baseElevM_dm (source terrain elevation, real metres)', 'u16 aspect_log2_2048', 'u16 theta_quarter_turn'],
  tiles: tileRecords.length, buildings: n,
  identityCentres, shape: 'minimum-area rectangle, scaled about its centre to true outline area',
  payloadSha256: createHash('sha256').update(buf).digest('hex'),
  airportSuppression: { version: AIRPORT_SUPPRESSION_VERSION, fingerprint: airportFingerprint, buildings: stats.airportsSuppressed },
  builtWithVE: VE,
  terrain: {...mesh.meta,...(reference?{reservoirFeetVersion:referenceMeta.terrain?.reservoirFeetVersion??0}:{})},
  verticalReference: reference?{sha256:createHash('sha256').update(reference).digest('hex'),buildings:reference.readUInt32LE(8),note:'Original live height/base fields retained; terrain repair stays in the existing runtime foot delta.'}:null,
  terrainBounds: terrain.getTerrainBounds(),
  note: 'builtWithVE is RECORDED, NOT APPLIED — it documents the terrain scale the base elevations were divided by. Changing VE does NOT require a re-bake.',
  landmarks: LANDMARKS.map(l => ({ id: l.id, suppressed: (retainedPolys[l.id] || []).length })),
  stats, generated: new Date().toISOString(),
};
await writeLocal(path.join(OUT_DIR, 'meta.json'), JSON.stringify(metadata,null,2), GUARD);
// The opt-in comparison payload preserves the original source centre and
// decimetre square side exactly. It is never requested by the default path.
const square = Buffer.alloc(headerBytes+n*10);
buf.copy(square,0,0,headerBytes); square.writeUInt32LE(0x31424755,0);square.writeUInt16LE(1,4);
let so=headerBytes;
for(let i=0;i<tileRecords.length;i++){
  const t=tileRecords[i];square.writeUInt32LE(so,12+i*16+8);
  for(const r of t.recs){
    square.writeUInt16LE(clampU16((r.sourceX-t.minX)*10,'sourceX',t.file),so);
    square.writeUInt16LE(clampU16((r.sourceZ-t.minZ)*10,'sourceZ',t.file),so+2);
    square.writeUInt16LE(clampU16(r.hM*10,'height',t.file),so+4);
    square.writeUInt16LE(clampU16(r.sideM*10,'side',t.file),so+6);
    square.writeInt16LE(clampI16(r.baseM*10,'base',t.file),so+8);so+=10;
  }
}
await writeLocal(path.join(OUT_DIR,'buildings-square.bin'),square,GUARD);
await writeLocal(path.join(OUT_DIR,'meta-square.json'),JSON.stringify({...metadata,format:'UGB1',version:1,recordBytes:10,fields:['u16 source_cx_dm (tile-relative)','u16 source_cz_dm (tile-relative)','u16 heightM_dm','u16 sideM_dm (source sqrt area)','i16 baseElevM_dm'],shape:'legacy source-centred square',identityCentres:{},payloadSha256:createHash('sha256').update(square).digest('hex')}),GUARD);

const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
log(`\nbuildings.bin  ${mb(buf.length)}  (${n.toLocaleString()} buildings, ${tileRecords.length} tiles)`);
log('drops:', JSON.stringify(stats));
log('\nlandmark suppression:');
for (const L of LANDMARKS) log(`  ${L.id.padEnd(14)} ${String((retainedPolys[L.id] || []).length).padStart(4)} boxes suppressed / footprints retained`);
log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
