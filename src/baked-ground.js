// Lossless ground masks, not baked lighting. Four pixels per byte, each with
// road/green bits, gzip-compressed on disk. The shader still receives the exact
// RGBA bytes produced by surface-texture.js, at the original 4096 resolution.
import { createSurfaceTexture } from './surface-texture.js';

export const GROUND_URL = '/data/surface/baked/ground.bin';
export const GROUND_MAGIC = 0x31474755; // UGG1
export const GROUND_HEADER = 40;

export function parseGround(buffer, expectedBBox) {
  if (buffer.byteLength < GROUND_HEADER) throw new Error('ground header truncated');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GROUND_MAGIC) throw new Error('ground format invalid');
  const size = view.getUint32(4, true);
  if (size !== 4096) throw new Error('ground resolution invalid');
  if (buffer.byteLength !== GROUND_HEADER + size * size / 4) throw new Error('ground length invalid');
  const bbox = {};
  ['minX', 'maxX', 'minZ', 'maxZ'].forEach((key, i) => {
    bbox[key] = view.getFloat64(8 + i * 8, true);
    if (!Number.isFinite(bbox[key]) || Math.abs(bbox[key] - expectedBBox[key]) > 0.001) {
      throw new Error(`ground bounds mismatch: ${key}`);
    }
  });
  return { size, bbox, packed: new Uint8Array(buffer, GROUND_HEADER) };
}

export async function loadBakedGround(bbox) {
  const response = await fetch(GROUND_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`ground fetch failed (${response.status})`);
  }
  // .bin deliberately avoids server Content-Encoding ambiguity. Gzip framing
  // includes CRC validation; unsupported decompression takes the live fallback.
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const { packed, size } = parseGround(await new Response(stream).arrayBuffer(), bbox);
  const state = createSurfaceTexture(bbox, size);
  // Yield between chunks: expanding 16 million pixels must not monopolise the
  // frame thread during the opening descent, especially on slower machines.
  const chunk = 32768;
  for (let start = 0; start < packed.length; start += chunk) {
    const end = Math.min(start + chunk, packed.length);
    for (let i = start; i < end; i++) {
      const bits = packed[i];
      for (let p = 0; p < 4; p++) {
        const offset = (i * 4 + p) * 4;
        state.pixels[offset + 2] = bits & (1 << (p * 2)) ? 255 : 0;
        state.pixels[offset + 3] = bits & (2 << (p * 2)) ? 255 : 0;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return state;
}
