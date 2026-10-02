import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Night research proof (sprint 02Oct26f, lane R, THROWAWAY: never merged). Node-side
// guards for the pure parts of src/night.js. The shader terms are judged on captures
// and the render harness; these pin what can be pinned without a GPU:
//   1. with no ?night flag the proof is inert (no state change, empty star shader);
//   2. with ?night=1 the moon retints the sun state, deterministically and finitely;
//   3. nothing in the sky parameters can go NaN (bloom smears one NaN across the frame);
//   4. the shader source carries no per-instance colour and no randomness.

globalThis.location = { search: '' };
const off = await import('../src/night.js?off');

globalThis.location = { search: '?night=1&nparts=wgsm&nlit=0.4' };
const on = await import('../src/night.js?on');

const freshState = () => ({
  direction: new THREE.Vector3(0.8, 0.23, 0.55).normalize(), elevationDeg: 13.5,
  sunColor: new THREE.Color(0xfff4e6), sunFactor: 1, ambientFactor: 1, hemiFactor: 1,
  ambientColor: new THREE.Color(0xffffff), hemiSky: new THREE.Color(0xffe9c8),
  skyColor: new THREE.Color(0x5a7a8f), fogSky: new THREE.Color(0x3a4a52),
});

test('inert without ?night: state untouched, no star shader, zero uniforms', () => {
  assert.equal(off.NIGHT.enabled, false);
  const s = freshState(); const before = JSON.stringify(s);
  off.applyNightToSunState(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(off.STARS_FRAGMENT_UNIFORMS, '');
  assert.equal(off.STARS_FRAGMENT_FUNCTION, '');
  assert.equal(off.STARS_FRAGMENT_USE, '');
  assert.equal(off.starWeight(), 0);
  off.updateNight(1);
  assert.equal(off.nightUniforms.uNightAmt.value, 0);
});

test('?night=1 parses its flags', () => {
  assert.equal(on.NIGHT.enabled, true);
  assert.equal(on.NIGHT.level, 1);
  assert.deepEqual(on.NIGHT.parts, { windows: true, glow: true, stars: true, moon: true });
  assert.equal(on.NIGHT.lit, 0.4);
  assert.equal(on.starWeight(), 1);
});

test('moon: dim, cool, south-west, high enough to light the city, and deterministic', () => {
  const a = freshState(), b = freshState();
  on.applyNightToSunState(a); on.applyNightToSunState(b);
  assert.deepEqual(a.direction.toArray(), b.direction.toArray());
  assert.ok(a.sunFactor < 0.3 && a.ambientFactor < 0.3 && a.hemiFactor < 0.3, 'night light is a fraction of day');
  assert.ok(a.sunColor.b > a.sunColor.r, 'moonlight is cool');
  assert.ok(a.elevationDeg > 20 && a.elevationDeg < 60);
  // scene axes: x east, z south. South-west = negative x, positive z.
  assert.ok(a.direction.x < 0 && a.direction.z > 0);
  for (const v of [a.sunFactor, a.ambientFactor, a.hemiFactor, a.elevationDeg, ...a.direction.toArray(), ...a.skyColor.toArray(), ...a.fogSky.toArray()]) assert.ok(Number.isFinite(v));
});

test('sky parameters at night are finite and far darker than day', () => {
  const p = {
    illum: new THREE.Color(1.1, 1, 0.9), ambient: new THREE.Color(0.4, 0.55, 0.9), horizonGlow: 0.5, horizonGlowPow: 5,
    discColor: new THREE.Color(2.4, 2.3, 2.1), aureoleColor: new THREE.Color(1, 0.9, 0.7), aureoleCore: 0.55, aureoleSkirt: 0.22,
  };
  on.applyNightToSkyParams(p);
  for (const c of [p.illum, p.ambient, p.discColor, p.aureoleColor]) for (const v of c.toArray()) assert.ok(Number.isFinite(v) && v >= 0);
  assert.ok(p.ambient.b < 0.05 && p.illum.r < 0.05, 'sky light is a few percent of day');
  assert.ok(p.discColor.r < 1.5, 'the moon disc stays near the bloom threshold, not 2.4');
  assert.ok(p.horizonGlowPow > 0 && p.horizonGlowPow < 1, 'pow base can reach 0: the exponent must stay positive');
});

test('shader sources: no instanceColor, no setColorAt, no randomness, NaN-safe divisions', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/night.js', import.meta.url), 'utf8');
  const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');   // comments may name what is forbidden
  assert.ok(!/instanceColor/.test(code), 'no instanceColor term');
  assert.ok(!/setColorAt/.test(code), 'no setColorAt');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(code), 'deterministic: no clock or randomness');
  assert.match(src, /fract\( vec3\( p\.xyx \) \* 0\.1031 \)/, 'the hash is the arithmetic one, not sin()');
  assert.ok(!/sin\(\s*dot/.test(src), 'no sin-dot hash (driver-dependent)');
  assert.match(src, /max\( uHeightScale, 0\.05 \)/, 'floor height divisor is clamped');
});

test('stars: hashed lattice, above the horizon only, fade with the level', () => {
  assert.match(on.STARS_FRAGMENT_USE, /dd\.y > 0\.0/);
  assert.match(on.STARS_FRAGMENT_USE, /smoothstep\( 0\.03, 0\.3, dd\.y \)/);
  const half = new THREE.Vector3(); void half;
  assert.ok(on.STARS_FRAGMENT_FUNCTION.includes('ngHash33'));
});
