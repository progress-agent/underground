import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSkyDome, updateEnvironment } from '../src/environment.js';

test('actual sky dome retains an upward sky underwater and restores clay/chalk suppression on exit', () => {
  const previousDocument = globalThis.document;
  // Canvas allocation only; all geometry, material and atmosphere code is real.
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  try {
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0, 100, 1000);
    const sky = createSkyDome(scene), camera = new THREE.PerspectiveCamera();
    camera.position.set(100, -25, 200);
    const update = state => updateEnvironment(camera, scene, sky, null,
      { insideness: 1, chalkBlend: 0, clayLift: 0, chalkClarity: 0, submergedBlend: 0, ...state });
    update({ submergedBlend: 1 });
    assert.equal(sky.visible, true, 'a transparent water ceiling needs an actual upward sky');
    assert.equal(sky.material.opacity, 1);
    assert.equal(sky.userData.submergedSky.value, 1);
    assert.equal(sky.material.depthWrite, false, 'the sky cannot occlude river bounds');
    assert.equal(sky.material.depthTest, true, 'opaque banks and bed occlude the sky');
    update({});
    assert.equal(sky.visible, false, 'ordinary clay does not acquire a sky');
    assert.equal(sky.userData.submergedSky.value, 0);
    update({ chalkBlend: 1, chalkClarity: 1 });
    assert.equal(sky.visible, false, 'chalk suppression remains intact');
    camera.position.y = 1000;
    update({});
    assert.equal(sky.visible, true);
    assert.equal(sky.userData.submergedSky.value, 0, 'exterior keeps its existing abyss-cap texture');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    sky.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uSubmergedSky, sky.userData.submergedSky);
    assert.ok(shader.fragmentShader.includes('aboveWaterHorizon'));
    sky.geometry.dispose(); sky.material.map.dispose(); sky.material.dispose();
  } finally { globalThis.document = previousDocument; }
});
