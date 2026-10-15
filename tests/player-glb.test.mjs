// player-glb.test.mjs: the trimmed mannequin (sprint 14Oct26w, lane P, D-045 item 7): the file is well formed,
// holds the clips the game plays and nothing else, and can be rebuilt byte for byte from the pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb, trimGlb, writeGlb } from '../scripts/trim-player-glb.mjs';
import { KEEP_CLIPS, MANNEQUIN_URL } from '../src/player/mannequin-manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../public/models/player');
const glbPath = path.join(dir, path.basename(MANNEQUIN_URL));
const glb = parseGlb(readFileSync(glbPath));

test('the manifest points at the committed file, and the file is small', () => {
  assert.ok(existsSync(glbPath));
  assert.ok(readFileSync(glbPath).length <= 3_000_000, 'served bytes');
});

test('the animations are exactly the kept clips', () => {
  assert.deepEqual(glb.json.animations.map((a) => a.name),
    ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Crouch_Idle_Loop']);
  assert.deepEqual(glb.json.animations.map((a) => a.name), [...KEEP_CLIPS]);
});

test('every accessor points at a buffer view and every buffer view lies inside the binary chunk', () => {
  const { json, bin } = glb;
  assert.equal(json.buffers.length, 1);
  assert.ok(json.buffers[0].byteLength <= bin.length);
  for (const v of json.bufferViews) assert.ok((v.byteOffset ?? 0) + v.byteLength <= bin.length, 'view in range');
  for (const a of json.accessors) {
    assert.ok(Number.isInteger(a.bufferView) && a.bufferView >= 0 && a.bufferView < json.bufferViews.length, 'accessor view');
    const v = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    assert.ok((a.byteOffset ?? 0) + a.count * comps * size <= v.byteLength + (v.byteStride ? v.byteStride : 0), 'accessor in view');
  }
  for (const a of json.animations) for (const s of a.samplers) {
    assert.ok(s.input < json.accessors.length && s.output < json.accessors.length);
  }
});

test('one skin of 65 joints, 13,744 triangles, the two materials with the source colours', () => {
  const { json } = glb;
  assert.equal(json.skins.length, 1);
  assert.equal(json.skins[0].joints.length, 65);
  let tris = 0;
  for (const prim of json.meshes[0].primitives) tris += json.accessors[prim.indices].count / 3;
  assert.equal(tris, 13744);
  const mats = Object.fromEntries(json.materials.map((m) => [m.name, m.pbrMetallicRoughness.baseColorFactor]));
  assert.deepEqual(Object.keys(mats).sort(), ['M_Joints', 'M_Main']);
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  const all = Object.values(mats);
  assert.ok(all.some((c) => close(c, [0.799, 0.402, 0.042, 1])), 'orange');
  assert.ok(all.some((c) => close(c, [0.402, 0.133, 0.708, 1])), 'violet');
});

test('licence and credits sit beside the file, CC0, and nothing mentions Mixamo', () => {
  const names = readdirSync(dir);
  assert.ok(names.includes('LICENSE-quaternius.txt') && names.includes('CREDITS.md'));
  const credits = readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
  assert.match(credits, /Quaternius/);
  assert.match(credits, /Universal Animation Library/);
  assert.match(credits, /CC0 1\.0/);
  assert.match(credits, /https:\/\/quaternius\.com/);
  // Sprint 14Oct26w, lane D: the folder now has a Textures/ subfolder (the skateboard's texture, which its GLB names by that
  // relative path), so every FILE under it is scanned, folders walked into instead of read. Nothing is loosened: the scan
  // now covers the board, its texture and its licence as well.
  const files = (d, rel = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
  for (const n of files(dir)) {
    const body = readFileSync(path.join(dir, n));
    assert.ok(!/mixamo/i.test(n) && !/mixamo/i.test(body.toString('latin1')), `${n} has no Mixamo`);
  }
});

test('trimming is deterministic and idempotent', () => {
  const again = trimGlb(glb, [...KEEP_CLIPS]);
  const bytes = writeGlb(again.json, again.bin);
  assert.ok(bytes.equals(readFileSync(glbPath)));
});

test('trimming from the pack reproduces the committed file byte for byte (when the pack is at hand)', (t) => {
  const pack = process.env.UG_UAL_GLB
    ?? '/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/player-mock-01Oct26h/assets/quaternius/UAL1_Standard.glb';
  if (!existsSync(pack)) return t.skip('the pack GLB is not on this machine');
  const src = readFileSync(pack);
  const trimmed = trimGlb(parseGlb(src), [...KEEP_CLIPS]);
  assert.ok(writeGlb(trimmed.json, trimmed.bin).equals(readFileSync(glbPath)));
  const lic = path.join(path.dirname(pack), 'License.txt');
  if (existsSync(lic)) assert.ok(readFileSync(lic).equals(readFileSync(path.join(dir, 'LICENSE-quaternius.txt'))));
});
