// Produces the SHA-256 of every procedural texture's pixels by running a checkout's OWN src/textures.js under a
// canvas shim (sprint 21Oct26w, lane L, approach G). Run against the live build to make the goldens:
//   node tests/fixtures/texture-goldens.mjs ~/repos/ug-s21-livebase/src/textures.js
// and against the branch to compare; tests/texture-pixels.test.mjs holds the 7c2d4bd values and checks the
// branch's src/texture-pixels.js (and textures.js) against them.
// The terrain normal map's input is the real heightmap (public/data/terrain/london_full_height_u16.png) decoded
// as terrain.js does (16-bit, normalised to 0..1, on its own 1400 x 1000 grid).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');

export function installCanvasShim() {
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 0, height: 0, _bytes: null,
        getContext() {
          return {
            createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: (img) => { canvas._bytes = img.data; },
            getImageData: () => ({ width: canvas.width, height: canvas.height, data: canvas._bytes }),
          };
        },
      };
      return canvas;
    },
  };
}

export function realHeightmap(repoRoot) {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const UPNG = require('upng-js');
  const buf = readFileSync(path.join(repoRoot, 'public/data/terrain/london_full_height_u16.png'));
  const png = UPNG.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const raw = new Uint8Array(png.data), count = png.width * png.height;
  const floats = new Float32Array(count);
  let min = 65535, max = 0;
  for (let i = 0; i < count; i++) { const v = (raw[i * 2] << 8) | raw[i * 2 + 1]; if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  for (let i = 0; i < count; i++) floats[i] = (((raw[i * 2] << 8) | raw[i * 2 + 1]) - min) / range;
  return { floats, width: png.width, height: png.height };
}

/** @returns {Promise<Record<string,string>>} texture name -> SHA-256 of its RGBA bytes */
export async function texturesOf(texturesJsPath) {
  installCanvasShim();
  const tx = await import(pathToFileURL(path.resolve(texturesJsPath)).href);
  const repoRoot = path.resolve(path.dirname(path.resolve(texturesJsPath)), '..');
  const hm = realHeightmap(repoRoot);
  const out = {};
  const bytesOf = (tex) => tex.image.getContext('2d').getImageData(0, 0, tex.image.width, tex.image.height).data;
  out.terrainGrain = sha(bytesOf(tx.generateTerrainGrainTexture()));
  out.terrainRoughness = sha(bytesOf(tx.generateTerrainRoughnessTexture()));
  out.terrainNormal = sha(bytesOf(tx.generateTerrainNormalMap(hm.floats, hm.width, hm.height)));
  const ug = tx.generateUndersideGrainTexture();
  out.undersideGrain = sha(bytesOf(ug));
  out.undersideNormal = sha(bytesOf(tx.generateUndersideNormalMap(ug)));
  const cg = tx.generateChalkGrainTexture();
  out.chalkGrain = sha(bytesOf(cg));
  out.chalkRoughness = sha(bytesOf(tx.generateChalkRoughnessTexture()));
  out.chalkNormal = sha(bytesOf(tx.generateUndersideNormalMap(cg)));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) throw new Error('usage: node texture-goldens.mjs <path to src/textures.js>');
  console.log(JSON.stringify(await texturesOf(target), null, 2));
}
