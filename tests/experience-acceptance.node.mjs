import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import { applyRiverBedMaterial } from '../src/river-materials.js';
import { applySurfaceTexture } from '../src/surface-texture.js';
import { applyM25Mask } from '../src/m25.js';
import { installAirportDockTerrainMask } from '../src/airport-docks.js';
import { createMaterialResistance } from '../src/material-resistance.js';

test('a ground atlas arriving after first terrain compilation gets a new shader cache identity', () => {
  const material = new THREE.MeshStandardMaterial();
  const compile = () => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader, {});
    return shader;
  };
  applyM25Mask(material, new THREE.Texture());
  installAirportDockTerrainMask(material);
  applyRiverBedMaterial(material);
  const initialKey = material.customProgramCacheKey();
  const initial = compile();
  applySurfaceTexture(material, new THREE.Texture(), { minU: 0, minV: 0, maxU: 1, maxV: 1 });
  const final = compile();
  assert.notEqual(initial.fragmentShader, final.fragmentShader);
  assert.ok(final.uniforms.surfaceTex);
  assert.notEqual(material.customProgramCacheKey(), initialKey,
    'Three caches programs by this key; a changed fragment shader must not reuse the pre-atlas program');
});

test('the real main keyup listener cancels pressure before a same-frame repress', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf("window.addEventListener('keyup',");
  const end = source.indexOf('\n});', start) + '\n});'.length;
  assert.ok(start >= 0 && end > start, 'Find the actual production listener');
  const listeners = new Map();
  const materialResistance = createMaterialResistance({
    classify: p => p.x < 0 ? 'WATER' : 'CLAY',
    riverNormal: () => ({ x: 1, y: 0, z: 0 }),
  });
  materialResistance.apply({ x: -.1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .05);
  assert.equal(materialResistance.state.kind, 'hold');
  const fpsControls = { keys: new Set(['w']) };
  vm.runInNewContext(source.slice(start, end), {
    window: { addEventListener: (name, handler) => listeners.set(name, handler) },
    fpsControls, materialResistance,
  });
  listeners.get('keyup')({ key: 'w' });
  assert.equal(fpsControls.keys.size, 0);
  assert.equal(materialResistance.state, null, 'Releasing all movement must end this push before the next RAF');
});

test('the measured shallow central column preserves free entry and then holds the bed in one frame', () => {
  // Independently sampled live Westminster/Tower Bridge terrain: y10.75 floor,
  // y12 visible top. d=-7.5 is actual150unit/s air flight at the50ms recovery cap.
  const control = createMaterialResistance({
    classify: p => p.y >= 12 ? 'AIR' : p.y >= 10.75 ? 'WATER' : 'CLAY',
    riverNormal: () => ({ x: 0, y: -1, z: 0 }),
  });
  const allowed = control.apply({ x: 0, y: 14, z: 0 }, { x: 0, y: -7.5, z: 0 }, .05);
  assert.equal(control.state?.kind, 'hold', 'Do not collapse a thin AIR/WATER/CLAY sweep into AIR/CLAY drag');
  assert.ok(14 + allowed.y >= 10.75 && 14 + allowed.y < 10.8, 'Free water entry reaches the actual bed before resistance');
});
