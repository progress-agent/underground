#!/usr/bin/env node
// trim-player-glb.mjs: cut the Quaternius Universal Animation Library mannequin down to the clips the
// game plays (sprint 14Oct26w, lane P, D-053 item 2 and the plan's "figure's cost").
//
//   node scripts/trim-player-glb.mjs <in.glb> <out.glb> [clip ...]
//
// The source GLB is 7.6 MB: the mesh and skin are about 0.6 MB and the other 7 MB is 43 animation clips, of
// which the game plays eight. This keeps the mesh, the skin and the listed clips, drops every other
// animation, and repacks the binary chunk with only the accessors and buffer views still referenced (4-byte
// aligned), rewriting every index. No dependency: Node's Buffer only. Deterministic: the same input and the
// same clip list give the same bytes, so the committed file can be reproduced (tests/player-glb.test.mjs).
//
// Lane D appends its clips to KEEP_CLIPS in src/player/mannequin-manifest.js and re-runs this; the default
// list below is read from that file's `KEEP_CLIPS` so there is one list.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const pad4 = (n) => (n + 3) & ~3;

export function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + pad4(len);
  }
  if (!json || !bin) throw new Error('GLB needs a JSON and a BIN chunk');
  return { json, bin };
}

export function writeGlb(json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
  const bn = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length, 0)]);
  const total = 12 + 8 + js.length + 8 + bn.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(JSON_CHUNK, 16); js.copy(out, 20);
  const o = 20 + js.length;
  out.writeUInt32LE(bn.length, o); out.writeUInt32LE(BIN_CHUNK, o + 4); bn.copy(out, o + 8);
  return out;
}

/** Keep `clips` (in that order) and what they and the mesh reference. Returns { json, bin }. */
export function trimGlb({ json, bin }, clips) {
  const src = structuredClone(json);
  const byName = new Map(src.animations.map((a) => [a.name, a]));
  const missing = clips.filter((c) => !byName.has(c));
  if (missing.length) throw new Error(`clips not in the source: ${missing.join(', ')}`);
  src.animations = clips.map((c) => byName.get(c));

  // Accessors still referenced, in first-use order.
  const accMap = new Map();
  const useAcc = (i) => { if (i === undefined || i === null) return undefined; if (!accMap.has(i)) accMap.set(i, accMap.size); return accMap.get(i); };
  for (const mesh of src.meshes ?? []) {
    for (const prim of mesh.primitives) {
      for (const k of Object.keys(prim.attributes)) prim.attributes[k] = useAcc(prim.attributes[k]);
      if (prim.indices !== undefined) prim.indices = useAcc(prim.indices);
    }
  }
  for (const skin of src.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = useAcc(skin.inverseBindMatrices);
  for (const anim of src.animations) {
    for (const s of anim.samplers) { s.input = useAcc(s.input); s.output = useAcc(s.output); }
  }
  const oldAccessors = [...accMap.keys()];

  // Buffer views still referenced, repacked in first-use order.
  const viewMap = new Map();
  const chunks = [];
  let at = 0;
  const accessors = oldAccessors.map((oi) => {
    const a = { ...src.accessors[oi] };
    if (a.sparse) throw new Error('sparse accessors are not supported');
    if (a.bufferView !== undefined) {
      if (!viewMap.has(a.bufferView)) {
        const v = src.bufferViews[a.bufferView];
        if (v.buffer !== 0) throw new Error('single-buffer GLB only');
        const start = v.byteOffset ?? 0;
        const data = bin.subarray(start, start + v.byteLength);
        const nv = { ...v, buffer: 0, byteOffset: at };
        chunks.push(data);
        const padded = pad4(data.length);
        if (padded > data.length) chunks.push(Buffer.alloc(padded - data.length));
        at += padded;
        viewMap.set(a.bufferView, { index: viewMap.size, view: nv });
      }
      a.bufferView = viewMap.get(a.bufferView).index;
    }
    return a;
  });
  const bufferViews = [...viewMap.values()].map((e) => e.view);
  const out = { ...src, accessors, bufferViews, buffers: [{ byteLength: at }] };
  return { json: out, bin: Buffer.concat(chunks) };
}

export async function defaultClips() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const m = await import(pathToFileURL(path.join(here, '../src/player/mannequin-manifest.js')).href);
  return [...m.KEEP_CLIPS];
}

async function main() {
  const [inp, outp, ...clips] = process.argv.slice(2);
  if (!inp || !outp) { console.error('usage: trim-player-glb.mjs <in.glb> <out.glb> [clip ...]'); process.exit(64); }
  const use = clips.length ? clips : await defaultClips();
  const trimmed = trimGlb(parseGlb(readFileSync(inp)), use);
  const glb = writeGlb(trimmed.json, trimmed.bin);
  writeFileSync(outp, glb);
  console.log(`${outp}: ${glb.length} bytes (source ${readFileSync(inp).length}), ${use.length} clips`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
