// Lane D (sprint 23Sep26w): pure sun path, light quality, air weight, shadow
// fit and the Automatic ladder's shadows-first rung. Run: node --test tests/sun.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  sunDirection, sunState, DEFAULT_SUN_TIME, LEGACY_SUN_DIRECTION, PATH_RESIDUAL_DEG,
  SUN_CONFIG, airWeightFor, shadowAltitudeFade, fitShadowFrustum, patchShadowChunk,
  applyShadowPolicy, buildingDepthMaterial,
} from '../src/sun.js';
import { createAtmosphere, updateLighting, updateEnvironment, setAirSun, LEGACY_SUN_POSITION } from '../src/environment.js';
import { QUALITY_LEVELS, createAdaptiveQuality } from '../src/adaptive-quality.js';
import { getBuildingMaterial } from '../src/surface-geometry.js';

const DEG = Math.PI / 180;
const el = v => Math.asin(v.y) / DEG;
const az = v => (Math.atan2(v.x, -v.z) / DEG + 360) % 360;

test('default slider position reproduces the legacy sun exactly', () => {
  assert.ok(PATH_RESIDUAL_DEG < 0.5, `path passes near legacy (${PATH_RESIDUAL_DEG.toFixed(3)} deg)`);
  assert.ok(DEFAULT_SUN_TIME > 0.1 && DEFAULT_SUN_TIME < 0.25, `morning default ${DEFAULT_SUN_TIME}`);
  const s = sunState(DEFAULT_SUN_TIME);
  assert.ok(s.direction.angleTo(new THREE.Vector3(...LEGACY_SUN_POSITION).normalize()) < 1e-9);
  assert.equal(s.sunColor.getHex(), new THREE.Color(0xfff4e6).getHex());
  assert.equal(s.sunFactor, 1);
  assert.equal(s.ambientFactor, 1);
  assert.equal(s.ambientColor.getHex(), 0xffffff);
  assert.equal(s.skyColor.getHex(), 0x5a7a8f);
  assert.equal(s.fogSky.getHex(), 0x3a4a52);
  assert.equal(s.hemiSky.getHex(), 0xffe9c8);
});

test('the slider moves the sun east to west through a southern noon, never below the horizon', () => {
  let prevAz = -1;
  for (let i = 0; i <= 100; i++) {
    const d = sunDirection(i / 100);
    assert.ok(Math.abs(d.length() - 1) < 1e-9);
    assert.ok(el(d) >= SUN_CONFIG.minElevationDeg - 0.05, `no night at t=${i / 100}: ${el(d)}`);
    assert.ok(az(d) > prevAz, 'azimuth increases monotonically (east to west)');
    prevAz = az(d);
  }
  assert.ok(az(sunDirection(0)) < 120 && az(sunDirection(1)) > 240, 'dawn in the east, dusk in the west');
  const noon = sunDirection(0.5);
  assert.ok(Math.abs(az(noon) - 180) < 0.5, 'solar noon due south');
  assert.ok(el(noon) > 25 && el(noon) < 32, `late-October noon elevation ${el(noon)}`);
  for (let i = 1; i <= 100; i++) {
    assert.ok(sunDirection(i / 100).angleTo(sunDirection((i - 1) / 100)) < 3 * DEG, 'continuous');
  }
});

test('angle, colour and quality of light change across the day', () => {
  const dawn = sunState(0), noon = sunState(0.5), dusk = sunState(1);
  assert.ok(dawn.direction.angleTo(noon.direction) > 20 * DEG);
  assert.ok(dawn.direction.angleTo(dusk.direction) > 90 * DEG);
  // Low sun is warmer (less blue relative to red) and weaker than noon.
  assert.ok(dawn.sunColor.b / dawn.sunColor.r < noon.sunColor.b / noon.sunColor.r - 0.2);
  assert.ok(dusk.sunColor.b / dusk.sunColor.r < noon.sunColor.b / noon.sunColor.r - 0.2);
  assert.ok(dawn.sunFactor < noon.sunFactor && dusk.sunFactor < noon.sunFactor);
  // A high sun dominates its fill (so midday shadows read); a low one does not.
  const ratio = s => s.sunFactor / (s.ambientFactor + s.hemiFactor);
  assert.ok(ratio(noon) > 2 * ratio(sunState(DEFAULT_SUN_TIME)) && ratio(dawn) < ratio(sunState(DEFAULT_SUN_TIME)));
  assert.notEqual(dawn.skyColor.getHex(), noon.skyColor.getHex());
  assert.notEqual(dawn.sunColor.getHex(), dusk.sunColor.getHex(), 'dusk is not a mirror of dawn');
  // Pure: the same t always gives the same state.
  assert.deepEqual(sunState(0.37).direction.toArray(), sunState(0.37).direction.toArray());
});

test('air weight is exactly zero below the surface and when submerged', () => {
  for (const h of [-5000, -1, -1e-6, 0]) assert.equal(airWeightFor({ heightAboveSurface: h }), 0);
  assert.equal(airWeightFor({ heightAboveSurface: NaN }), 0);
  assert.equal(airWeightFor({ heightAboveSurface: 500, submergedBlend: 1 }), 0);
  assert.equal(airWeightFor({ heightAboveSurface: 500 }), 1);
  assert.ok(airWeightFor({ heightAboveSurface: 6 }) > 0 && airWeightFor({ heightAboveSurface: 6 }) < 1);
  assert.equal(shadowAltitudeFade(100), 1);
  assert.equal(shadowAltitudeFade(25000), 0, 'no shadows at the overview');
});

function snapshotLights(lights, scene) {
  const dir = lights.sun.position.clone().sub(lights.sun.target.position).normalize();
  return JSON.stringify({
    dir: dir.toArray().map(v => v.toFixed(12)),
    sun: [lights.sun.color.getHex(), lights.sun.intensity],
    ambient: [lights.ambient.color.getHex(), lights.ambient.intensity],
    hemi: [lights.hemi.color.getHex(), lights.hemi.intensity],
    under: lights.underground.intensity,
    fog: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
  });
}

test('underground and submerged lighting is invariant to the slider and equals legacy', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 1, 2);
  const lights = createAtmosphere(scene);
  const camera = new THREE.PerspectiveCamera();
  const renderer = { setClearColor(c) { this.bg = c.getHex(); } };
  const regimes = [
    { y: -150, opts: { clayLift: 1 } },                        // shallow clay (clay clarity lift)
    { y: -320, opts: { chalkBlend: 1, clayLift: 0, chalkClarity: 1 } },
    { y: 5, opts: { submergedBlend: 1 } },
  ];
  for (const { y, opts } of regimes) {
    camera.position.set(100, y, 100);
    setAirSun({ weight: 0, state: null });
    updateEnvironment(camera, scene, null, renderer, opts);
    updateLighting(camera, lights, opts);
    const legacy = snapshotLights(lights, scene) + renderer.bg;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const w = airWeightFor({ heightAboveSurface: y - 75, submergedBlend: opts.submergedBlend ?? 0 });
      setAirSun({ weight: w, state: sunState(t) });
      updateEnvironment(camera, scene, null, renderer, opts);
      updateLighting(camera, lights, opts);
      assert.equal(snapshotLights(lights, scene) + renderer.bg, legacy, `regime y=${y} t=${t}`);
    }
  }
});

test('in the air the slider drives the lights, and the default equals legacy', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 1, 2);
  const lights = createAtmosphere(scene);
  const camera = new THREE.PerspectiveCamera();
  const renderer = { setClearColor(c) { this.bg = c.getHex(); } };
  camera.position.set(0, 900, 0);
  setAirSun({ weight: 0, state: null });
  updateEnvironment(camera, scene, null, renderer); updateLighting(camera, lights);
  const legacy = snapshotLights(lights, scene) + renderer.bg;
  setAirSun({ weight: 1, state: sunState(DEFAULT_SUN_TIME) });
  updateEnvironment(camera, scene, null, renderer); updateLighting(camera, lights);
  assert.equal(snapshotLights(lights, scene) + renderer.bg, legacy);
  setAirSun({ weight: 1, state: sunState(0.02) });
  updateEnvironment(camera, scene, null, renderer); updateLighting(camera, lights);
  const dawn = snapshotLights(lights, scene) + renderer.bg;
  assert.notEqual(dawn, legacy);
  setAirSun({ weight: 0, state: null });
});

test('shadow fit covers the 3km square, is azimuth-aligned and texel-snapped', () => {
  for (const t of [0, 0.2, 0.5, 0.9, 1]) {
    const direction = sunDirection(t);
    const focus = new THREE.Vector3(1234.5, 0, -987.25);
    const fit = fitShadowFrustum({ focus, groundY: 80, direction });
    assert.equal(fit.halfWidth, SUN_CONFIG.shadowHalfExtent, 'no wasted width: aligned to the sun azimuth');
    // Every corner of the ground square, at the ground and at the top of the
    // tallest structure, projects inside the light-space box and depth range.
    const lightPos = fit.target.clone().addScaledVector(direction, fit.distance);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const h of [80 - 500, 80 + 2000]) {
      const along = new THREE.Vector3(direction.x, 0, direction.z).normalize();
      const right = fit.right;
      const p = new THREE.Vector3(focus.x, h, focus.z)
        .addScaledVector(along, sx * SUN_CONFIG.shadowHalfExtent * 0.999)
        .addScaledVector(right, sz * SUN_CONFIG.shadowHalfExtent * 0.999);
      const rel = p.clone().sub(fit.target);
      assert.ok(Math.abs(rel.dot(fit.right)) <= fit.halfWidth + 1e-6, `x t=${t}`);
      assert.ok(Math.abs(rel.dot(fit.up)) <= fit.halfHeight + fit.texelY, `y t=${t}`);
      const depth = p.clone().sub(lightPos).dot(direction.clone().negate());
      assert.ok(depth > fit.near && depth < fit.far, `depth t=${t}`);
    }
    // Texel snap: moving the focus by a fraction of a texel never moves the
    // target by a non-integer number of texels.
    const moved = fitShadowFrustum({ focus: focus.clone().add(new THREE.Vector3(0.37, 0, 0.21)), groundY: 80, direction });
    const dx = moved.target.clone().sub(fit.target);
    const kx = dx.dot(fit.right) / fit.texelX, ky = dx.dot(fit.up) / fit.texelY;
    assert.ok(Math.abs(kx - Math.round(kx)) < 1e-6 && Math.abs(ky - Math.round(ky)) < 1e-6);
  }
});

test('shadow chunk wrapper installs once and keeps the original body', () => {
  assert.equal(patchShadowChunk(), true);
  assert.equal(patchShadowChunk(), true);
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  assert.equal(chunk.split('float getShadowRawUG(').length, 3, 'prototype + definition, once');
  assert.match(chunk, /strengthUG <= 0\.0 \) return 1\.0/);
});

test('shadow policy: buildings, landmarks and bridges cast; terrain receives; underground never', () => {
  const surface = new THREE.Group(); surface.name = 'surfaceGeometry';
  const baked = new THREE.InstancedMesh(new THREE.BoxGeometry(), getBuildingMaterial(), 1);
  baked.name = 'baked-buildings-3'; surface.add(baked);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  terrain.name = 'terrainMesh';
  const crossrail = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  crossrail.castShadow = true; crossrail.receiveShadow = true;
  const landmarks = new THREE.Group(); landmarks.name = 'landmarks';
  const lm = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); landmarks.add(lm);
  for (const root of [surface, terrain, crossrail, landmarks]) applyShadowPolicy(root);
  assert.deepEqual([baked.castShadow, baked.receiveShadow], [true, true]);
  assert.equal(baked.customDepthMaterial, buildingDepthMaterial, 'shadow pass honours the D-023 height scale');
  assert.deepEqual([terrain.castShadow, terrain.receiveShadow], [false, true]);
  assert.deepEqual([crossrail.castShadow, crossrail.receiveShadow], [false, false]);
  assert.deepEqual([lm.castShadow, lm.receiveShadow], [true, true]);
});

test('Automatic ladder thins the clouds, then drops shadows, before any resolution or smoothing', () => {
  // D-040 (Jordan's answer (c), 26Sep26s): clouds thin before shadows go.
  assert.deepEqual(QUALITY_LEVELS[0], { scale: 1, samples: 4, shadows: true, clouds: 'full' });
  assert.deepEqual(QUALITY_LEVELS[1], { scale: 1, samples: 4, shadows: true, clouds: 'thin' });
  assert.deepEqual(QUALITY_LEVELS[2], { scale: 1, samples: 4, shadows: false, clouds: 'thin' });
  assert.ok(QUALITY_LEVELS.slice(2).every(l => l.shadows === false), 'no lower rung restores shadows');
  // Moderate overload (25ms frames): clouds thin, then shadows go, resolution untouched.
  let now = 0; const changes = [];
  const c = createAdaptiveQuality({ apply: q => changes.push({ ...q }) });
  c.start(now);
  while (changes.length < 3) { now += 25; c.update(25, now); }
  assert.deepEqual(changes[1], { scale: 1, samples: 4, shadows: true, clouds: 'thin' });
  assert.deepEqual(changes[2], { scale: 1, samples: 4, shadows: false, clouds: 'thin' });
  assert.equal(c.get().level, 2);
});
