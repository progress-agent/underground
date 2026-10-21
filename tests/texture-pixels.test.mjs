// Byte identity of the procedural textures (sprint 21Oct26w, lane L, approach G; acceptance L-02 a).
// The goldens in fixtures/texture-goldens.json were produced by running 7c2d4bd's own src/textures.js under a
// canvas shim (node tests/fixtures/texture-goldens.mjs <that file>); this test hashes the branch's pixel
// functions, the branch's textures.js built on them, and the worker's two-stage normal map against them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { texturesOf, realHeightmap } from './fixtures/texture-goldens.mjs';
import * as px from '../src/texture-pixels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/texture-goldens.json'), 'utf8'));
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

test('the goldens cover the eight textures', () => {
  assert.deepEqual(Object.keys(GOLD).sort(), ['chalkGrain', 'chalkNormal', 'chalkRoughness', 'terrainGrain', 'terrainNormal', 'terrainRoughness', 'undersideGrain', 'undersideNormal']);
});

test('pixel functions equal the 7c2d4bd goldens, texel for texel', () => {
  assert.equal(sha(px.terrainGrainPixels()), GOLD.terrainGrain);
  assert.equal(sha(px.terrainRoughnessPixels()), GOLD.terrainRoughness);
  const ug = px.undersideGrainPixels();
  assert.equal(sha(ug), GOLD.undersideGrain);
  assert.equal(sha(px.sobelNormalPixels(ug, 1024, 1024)), GOLD.undersideNormal);
  const cg = px.chalkGrainPixels();
  assert.equal(sha(cg), GOLD.chalkGrain);
  assert.equal(sha(px.chalkRoughnessPixels()), GOLD.chalkRoughness);
  assert.equal(sha(px.sobelNormalPixels(cg, 512, 512)), GOLD.chalkNormal);
});

test('the terrain normal map equals the golden with and without the precomputed grain field', () => {
  const hm = realHeightmap(ROOT);
  assert.equal(sha(px.terrainNormalPixels(hm.floats, hm.width, hm.height)), GOLD.terrainNormal);
  const field = px.terrainNormalGrainField(2048);
  assert.equal(field.length, 2048 * 2048);
  assert.equal(sha(px.terrainNormalPixels(hm.floats, hm.width, hm.height, 2048, 3.0, field)), GOLD.terrainNormal);
});

test('the branch textures.js (canvas path) equals the goldens', async () => {
  const got = await texturesOf(path.join(ROOT, 'src/textures.js'));
  assert.deepEqual(got, GOLD);
});
