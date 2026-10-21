// The gzip-framed building payload is derived at build time and never stored (sprint 21Oct26w, lane L,
// approaches A + I). Node-only: reads the surface store, writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressPayload, PAYLOAD_SOURCE, PAYLOAD_Z_ROUTE } from '../vite.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, PAYLOAD_SOURCE);
const META = path.join(ROOT, 'public/data/surface/baked/meta.json');
const have = existsSync(SOURCE) && existsSync(META);

test('the route is the one the client asks for', async () => {
  const { BAKED_Z_URL } = await import('../src/baked-buildings.js');
  assert.equal(PAYLOAD_Z_ROUTE, BAKED_Z_URL);
});

test('the compressed payload gunzips to the store file byte for byte and to the metadata checksum', { skip: !have }, async () => {
  const z = await compressPayload(ROOT);
  const plain = readFileSync(SOURCE);
  const back = gunzipSync(z);
  assert.equal(back.length, plain.length);
  assert.ok(back.equals(plain), 'gunzip(z) equals buildings.bin');
  const meta = JSON.parse(readFileSync(META, 'utf8'));
  assert.equal(createHash('sha256').update(back).digest('hex'), meta.payloadSha256);
  assert.ok(z.length <= 9.0 * 1024 * 1024, `compressed size ${z.length} is at most 9.0 MB`);
  assert.ok(z.length < plain.length * 0.75, 'a real saving');
});

test('the compression is deterministic and equals plain node zlib level 6', { skip: !have }, async () => {
  const a = await compressPayload(ROOT);
  const b = await compressPayload(ROOT);
  assert.ok(a.equals(b), 'two runs are identical');
  assert.ok(a.equals(gzipSync(readFileSync(SOURCE), { level: 6 })), 'equals gzipSync level 6 (the acceptance reference)');
  assert.deepEqual([...a.subarray(0, 10)].slice(0, 8), [0x1f, 0x8b, 8, 0, 0, 0, 0, 0], 'gzip header with no timestamp');
});
