// Node shims so the bake compiler can import the app's OWN scene modules.
//
// This is the whole correctness strategy: the compiler must resolve the same
// terrain the renderer does, or 1.35M buildings land at subtly wrong heights
// and nothing catches it. Verified 06Sep26u — bit-identical to the browser
// across a 430-point lattice spanning the full 70x50km map (max |delta| = 0).
//
// Two shims are needed and neither touches anything baked:
//   fetch    — maps /data/... to public/data/... on disk
//   document — a no-op 2d canvas, because terrain.js pulls in textures.js to
//              rasterise procedural textures for the terrain MATERIAL. The bake
//              reads only the geometry position attribute (getTerrainMeshSurfaceY),
//              so no baked value depends on a pixel these produce.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

const stubCtx = new Proxy({}, {
  get: (_, k) => {
    if (k === 'canvas') return { width: 1, height: 1 };
    if (k === 'createImageData' || k === 'getImageData') {
      return (a, b, w, h) => {
        const width = h === undefined ? a : w, height = h === undefined ? b : h;
        return { data: new Uint8ClampedArray(width * height * 4), width, height };
      };
    }
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 0 });
    return () => {};
  },
  set: () => true,
});

export function installNodeEnv() {
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas'
      ? { width: 1, height: 1, style: {}, getContext: () => stubCtx }
      : { style: {} }),
  };

  globalThis.fetch = async (url) => {
    const u = String(url).split('?')[0];
    const file = path.join(ROOT, 'public', u.replace(/^\//, ''));
    const buf = await readFile(file);
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type'
          ? (u.endsWith('.json') ? 'application/json' : 'application/octet-stream')
          : null),
      },
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8'),
    };
  };
}
