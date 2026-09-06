#!/usr/bin/env node
// Adversarial check on the baked payload: decode it back and prove each record
// reproduces what the live ingest path would have produced from source JSON,
// within the format's stated quantisation. A bake that silently misplaces
// buildings looks exactly like a correct one.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { installNodeEnv, ROOT } from './bake-node-env.mjs';
import { isSuppressed } from './landmarks.mjs';
installNodeEnv();

const terrain = await import('../src/terrain.js');
const { initThamesMask, isInThames } = await import('../src/thames-mask.js');
const { loadM25Data, initM25Boundary, isInsideM25 } = await import('../src/m25.js');
const VE = terrain.VERTICAL_EXAGGERATION;
const thamesData = JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
initThamesMask(thamesData.points);
initM25Boundary((await loadM25Data()).points);
await terrain.tryCreateTerrainMesh({ thamesData });

const BAKED = path.join(ROOT, 'public/data/surface/baked');
const meta = JSON.parse(await readFile(path.join(BAKED, 'meta.json'), 'utf8'));
const buf = await readFile(path.join(BAKED, 'buildings.bin'));

// header
const magic = buf.readUInt32LE(0), version = buf.readUInt16LE(4);
const tileCount = buf.readUInt16LE(6), total = buf.readUInt32LE(8);
console.log(`header: magic=0x${magic.toString(16)} v${version} tiles=${tileCount} buildings=${total.toLocaleString()}`);
if (magic !== 0x31424755) throw new Error('bad magic');
if (tileCount !== meta.tiles || total !== meta.buildings) throw new Error('header disagrees with meta.json');

// Decode every record; assert the payload is exactly the size the header claims
const expected = 12 + tileCount * 16 + total * 10;
if (buf.length !== expected) throw new Error(`size ${buf.length} != expected ${expected}`);

const decoded = new Map();   // "cx,cz" (rounded) -> {hM, sideM, baseM}
let seen = 0, badBase = 0, minBase = Infinity, maxBase = -Infinity, maxH = 0;
for (let i = 0; i < tileCount; i++) {
  const d = 12 + i * 16;
  const minX = buf.readInt32LE(d), minZ = buf.readInt32LE(d + 4);
  let off = buf.readUInt32LE(d + 8);
  const count = buf.readUInt32LE(d + 12);
  for (let j = 0; j < count; j++, off += 10) {
    const cx = minX + buf.readUInt16LE(off) / 10;
    const cz = minZ + buf.readUInt16LE(off + 2) / 10;
    const hM = buf.readUInt16LE(off + 4) / 10;
    const sideM = buf.readUInt16LE(off + 6) / 10;
    const baseM = buf.readInt16LE(off + 8) / 10;
    seen++;
    if (!Number.isFinite(baseM)) badBase++;
    minBase = Math.min(minBase, baseM); maxBase = Math.max(maxBase, baseM); maxH = Math.max(maxH, hM);
    decoded.set(`${Math.round(cx)},${Math.round(cz)}`, { hM, sideM, baseM });
  }
}
console.log(`decoded ${seen.toLocaleString()} records; baseElev range ${minBase}..${maxBase} m; max height ${maxH} m; non-finite ${badBase}`);
if (seen !== total) throw new Error('record count mismatch');

// --- Re-derive a random sample straight from source and compare -------------
const TILE_DIR = path.join(ROOT, 'public/data/surface/tiles');
const manifest = JSON.parse(await readFile(path.join(TILE_DIR, 'manifest.json'), 'utf8'));
const files = [...manifest.tiles].sort((a, b) => a.file.localeCompare(b.file));
let rng = 1234567; const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const sample = files.filter(() => rand() < 0.05);

let checked = 0, missing = 0, worstBase = 0, worstH = 0, worstSide = 0, suppressedFound = 0;
for (const t of sample) {
  const data = JSON.parse(await readFile(path.join(TILE_DIR, t.file), 'utf8'));
  for (const b of data.buildings || []) {
    if (!isInsideM25(b.cx, b.cz) || isInThames(b.cx, b.cz)) continue;
    if (isSuppressed(b.cx, b.cz)) {
      if (decoded.has(`${Math.round(b.cx)},${Math.round(b.cz)}`)) suppressedFound++;
      continue;
    }
    const got = decoded.get(`${Math.round(b.cx)},${Math.round(b.cz)}`);
    if (!got) { missing++; continue; }   // legitimately a dedup loser
    const sceneY = terrain.getTerrainMeshSurfaceY({ x: b.cx, z: b.cz });
    if (sceneY === null) continue;
    checked++;
    worstBase = Math.max(worstBase, Math.abs(got.baseM - sceneY / VE));
    worstH = Math.max(worstH, Math.abs(got.hM - Math.max(b.height, 0.5)));
    worstSide = Math.max(worstSide, Math.abs(got.sideM - Math.max(Math.sqrt(b.area), 0.1)));
  }
}
console.log(`\nre-derived ${checked.toLocaleString()} buildings from ${sample.length} source tiles`);
console.log(`  max |baseElev delta| ${worstBase.toFixed(4)} m   (bound 0.05 = half a decimetre)`);
console.log(`  max |height   delta| ${worstH.toFixed(4)} m   (bound 0.05 = half a decimetre)`);
console.log(`  max |side     delta| ${worstSide.toFixed(4)} m   (bound 0.05 = half a decimetre)`);
console.log(`  not in payload (dedup losers): ${missing.toLocaleString()}`);
console.log(`  SUPPRESSED buildings wrongly present: ${suppressedFound}`);

// Rounding to decimetres has a maximum error of EXACTLY half a decimetre, so
// 0.0500 is the pass boundary, not a failure. An epsilon, not a fudge.
const BOUND = 0.05 + 1e-9;
const fail = [];
if (worstBase > BOUND) fail.push(`baseElev exceeds quantisation (${worstBase})`);
if (worstH > BOUND) fail.push(`height exceeds quantisation (${worstH})`);
if (worstSide > BOUND) fail.push(`side exceeds quantisation (${worstSide})`);
if (suppressedFound > 0) fail.push('suppression leaked');
if (badBase > 0) fail.push('non-finite base elevations');
console.log(fail.length ? `\nFAIL: ${fail.join('; ')}` : '\nPASS — payload reproduces the live ingest within quantisation');
process.exit(fail.length ? 1 : 0);
