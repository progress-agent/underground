// Build the unchanged ground shader's masks with the live rasteriser. No
// Canvas/Image decoding: transparent park/road channels must retain their bytes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { installNodeEnv, ROOT } from './bake-node-env.mjs';
import { createSurfaceTexture, rasteriseTile } from '../src/surface-texture.js';
import { GROUND_HEADER, GROUND_MAGIC } from '../src/baked-ground.js';
import { initThamesMask } from '../src/thames-mask.js';

installNodeEnv();
const dir = path.join(ROOT, 'public/data/surface/tiles');
const out = path.join(ROOT, 'public/data/surface/baked');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const thames = JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
initThamesMask(thames.points);
const bbox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
for (const tile of manifest.tiles) {
  for (const key of Object.keys(bbox)) {
    bbox[key] = key.startsWith('min') ? Math.min(bbox[key], tile.sceneBBox[key]) : Math.max(bbox[key], tile.sceneBBox[key]);
  }
}
const state = createSurfaceTexture(bbox, 4096);
const t0 = performance.now();
let done = 0;
for (const tile of [...manifest.tiles].sort((a, b) => a.file.localeCompare(b.file))) {
  const data = JSON.parse(await readFile(path.join(dir, tile.file), 'utf8'));
  rasteriseTile(state, data, { quiet: true });
  if (++done % 100 === 0) console.log(`ground: ${done}/${manifest.tiles.length}`);
}
const packed = Buffer.alloc(GROUND_HEADER + state.size * state.size / 4);
packed.writeUInt32LE(GROUND_MAGIC, 0);
packed.writeUInt32LE(state.size, 4);
Object.keys(bbox).forEach((key, i) => packed.writeDoubleLE(bbox[key], 8 + i * 8));
for (let p = 0; p < state.size * state.size; p++) {
  const road = state.pixels[p * 4 + 2] ? 1 : 0;
  const green = state.pixels[p * 4 + 3] ? 2 : 0;
  packed[GROUND_HEADER + (p >> 2)] |= (road | green) << ((p & 3) * 2);
}
const compressed = gzipSync(packed, { level: 9 });
const meta = {
  format: 'UGG1', size: state.size, bbox, tiles: done,
  bytes: compressed.length, rgbaBytes: state.pixels.length,
  rgbaSha256: createHash('sha256').update(state.pixels).digest('hex'),
  generated: new Date().toISOString(), buildMs: Math.round(performance.now() - t0),
  note: 'Roads B / greenery A, lossless binary masks. Rebuild when source tiles, Thames mask or rasteriser change. Lighting remains dynamic.',
};
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'ground.bin'), compressed);
await writeFile(path.join(out, 'ground-meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
