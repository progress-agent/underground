// loadBakedGround: paced (one yield per 32 KB chunk, the deep-link path) and unpaced (48 ms slices behind the
// opening veil) produce the identical texture (sprint 21Oct26w, lane L, approach B).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// surface-texture.js needs a DOM canvas; give it the smallest one that works.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) };
const { loadBakedGround, GROUND_MAGIC, GROUND_HEADER } = await import('../src/baked-ground.js');

const bbox = { minX: -1000, maxX: 1000, minZ: -2000, maxZ: 2000 };

function payload() {
  const size = 4096, packed = size * size / 4;
  const buf = Buffer.alloc(GROUND_HEADER + packed);
  buf.writeUInt32LE(GROUND_MAGIC, 0); buf.writeUInt32LE(size, 4);
  ['minX', 'maxX', 'minZ', 'maxZ'].forEach((k, i) => buf.writeDoubleLE(bbox[k], 8 + i * 8));
  let seed = 12345;
  for (let i = 0; i < packed; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; buf[GROUND_HEADER + i] = seed >> 8 & 0xff; }
  return gzipSync(buf);
}

test('paced and unpaced expansion give the same pixels; unpaced yields far less often', async () => {
  const z = payload();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(z, { headers: { 'content-type': 'application/octet-stream' } });
  const realTimeout = globalThis.setTimeout;
  let yields = 0;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms === 0) yields++; return realTimeout(fn, ms, ...a); };
  try {
    yields = 0;
    const paced = await loadBakedGround(bbox, { paced: true });
    const pacedYields = yields;
    yields = 0;
    const fast = await loadBakedGround(bbox, { paced: false, sliceMs: 48 });
    const fastYields = yields;
    const h = (s) => createHash('sha256').update(Buffer.from(s.pixels.buffer, s.pixels.byteOffset, s.pixels.byteLength)).digest('hex');
    assert.equal(h(fast), h(paced));
    assert.equal(pacedYields, 128, 'one yield per 32 KB chunk, 128 chunks');
    assert.ok(fastYields < pacedYields / 4, `unpaced yields ${fastYields}`);
  } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
});
