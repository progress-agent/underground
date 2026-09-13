import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyM25Mask } from '../src/m25.js';
import { installAirportDockTerrainMask } from '../src/airport-docks.js';
import { applyRiverBedMaterial } from '../src/river-materials.js';
import { applySurfaceTexture } from '../src/surface-texture.js';

test('async ground atlas changes the terrain program key while retaining M25, dock and river hooks', () => {
  const material = new THREE.MeshStandardMaterial();
  const texture = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
  const compile = () => {
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    material.onBeforeCompile(shader, null);
    return { key: material.customProgramCacheKey(), shader };
  };
  applyM25Mask(material, texture);
  installAirportDockTerrainMask(material);
  applyRiverBedMaterial(material);
  const early = compile();
  assert.ok(!early.shader.fragmentShader.includes('SURFACE_INJECTED'));
  applySurfaceTexture(material, texture, { minU: 0, minV: 0, maxU: 1, maxV: 1 });
  const ready = compile();
  assert.notEqual(ready.key, early.key, 'a shader compiled before the atlas arrives must not be reused');
  for (const token of ['m25Mask', 'inAirportDock0', 'uRiverBedMask', 'SURFACE_INJECTED']) {
    assert.ok(ready.shader.fragmentShader.includes(token), `missing chained hook: ${token}`);
  }
  assert.match(ready.key, /airport-wet-dock-v1/);
  assert.match(ready.key, /river-bed-v1/);
  assert.equal(compile().key, ready.key, 'stable installed chain shares its program');
  texture.dispose(); material.dispose();
});
