// sky.test.mjs: Lane S (sprint 24Sep26h, D-038). Pure checks of the analytic
// sky, the sun disc parameters and the fog coupling. Run: node --test tests/sky.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SUN_APPARENT_DIAMETER_DEG, SUN_ANGULAR_RADIUS, SKY_CEILING, computeSkyParams, skyRadianceAt,
  horizonColorToward, createSkySystem, softCeiling, displaySunDirection,
  GLOW_CEILING, BLOOM_THRESHOLD, DISC_HORIZON_FRACTION, glowCeiling, aureoleWeight, skyWithAureoleAt,
} from '../src/sky.js';
import { createVerticalScaleController } from '../src/vertical-scale.js';
import { readFileSync } from 'node:fs';
import { SKY_LOOKS, DEFAULT_SKY_LOOK, CLEAR_SKY, skyLookNames } from '../src/sky-looks.js';
import { sunState, DEFAULT_SUN_TIME, airWeightFor } from '../src/sun.js';
import { updateEnvironment, setAirSun, attachSky, resolveSunDirection } from '../src/environment.js';

const DEG = Math.PI / 180;
const luma = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const TIMES = [0, 0.05, DEFAULT_SUN_TIME, 0.35, 0.5, 0.75, 1];

function directions() {
  const out = [];
  for (let el = -10; el <= 90; el += 5) for (let az = 0; az < 360; az += 15) {
    const e = el * DEG, a = az * DEG;
    out.push(new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)));
  }
  return out;
}

test('the disc is the true apparent size of the sun', () => {
  assert.equal(SUN_APPARENT_DIAMETER_DEG, 0.53);
  assert.ok(Math.abs(SUN_ANGULAR_RADIUS / DEG - 0.265) < 1e-12);
  for (const look of skyLookNames()) {
    assert.equal(computeSkyParams(look, sunState(DEFAULT_SUN_TIME)).discRadius, SUN_ANGULAR_RADIUS);
  }
});

// 25Sep26f (Lane L, D-039): Jordan chose Clear; Haze, Steel, Flat, the Sky row
// and ?sky= are retired. This replaces the 24Sep26h "2 to 3 looks" test.
test('Clear is the only sky; any old look name gives the same sky', () => {
  assert.deepEqual(skyLookNames(), ['clear']);
  assert.equal(DEFAULT_SKY_LOOK, 'clear');
  assert.equal(SKY_LOOKS.clear, CLEAR_SKY);
  const s = sunState(DEFAULT_SUN_TIME);
  const ref = computeSkyParams('clear', s);
  for (const name of ['haze', 'steel', 'flat', 'nonsense', undefined]) {
    const p = computeSkyParams(name, s);
    assert.equal(p.look, 'clear');
    assert.ok(p.illum.equals(ref.illum) && p.tauM === ref.tauM && p.exposure === ref.exposure && p.keyMix === ref.keyMix);
  }
  const sys = createSkySystem({});
  assert.equal(sys.look, 'clear');
  assert.deepEqual(sys.looks, ['clear']);
  assert.equal(sys.setLook, undefined);
  assert.equal(sys.mountControls, undefined);
  // Nothing in the sky reads the URL any more.
  const src = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /location\.search|searchParams|skyLookRow/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /skySystem\.mountControls/);
});

test('sky radiance is finite, non-negative and never reaches the bloom threshold', () => {
  const dirs = directions();
  for (const look of skyLookNames()) for (const t of TIMES) {
    const p = computeSkyParams(look, sunState(t));
    const c = new THREE.Color();
    for (const d of [...dirs, p.sunDir.clone()]) {
      skyRadianceAt(d, p, c);
      for (const v of c.toArray()) assert.ok(Number.isFinite(v) && v >= 0, `${look} t=${t} ${v}`);
      assert.ok(luma(c) < SKY_CEILING + 1e-9, `${look} t=${t} luma ${luma(c)}`);
    }
    // The disc is the only thing meant to bloom (threshold 0.88), and only a
    // little: a modest level over the threshold, never the old ~38x (D-039).
    assert.ok(luma(p.discColor) > BLOOM_THRESHOLD * 1.5, `${look} t=${t} disc luma ${luma(p.discColor)}`);
    assert.ok(luma(p.discColor) <= CLEAR_SKY.discLuminance + 1e-9, `${look} t=${t} disc luma ${luma(p.discColor)}`);
  }
  assert.equal(softCeiling(0.3), 0.3);
  assert.ok(softCeiling(3) < SKY_CEILING && softCeiling(100) <= SKY_CEILING);
});

test('the sky follows the Dawn-to-Dusk slider', () => {
  for (const look of skyLookNames()) {
    const at = t => {
      const p = computeSkyParams(look, sunState(t));
      return [skyRadianceAt(new THREE.Vector3(0, 1, 0), p), skyRadianceAt(new THREE.Vector3(0.3, 0.05, 0.95).normalize(), p)];
    };
    const dawn = at(0), morning = at(DEFAULT_SUN_TIME), dusk = at(1);
    // The analytic looks darken towards the ends; Steel follows the 23Sep26w
    // keyframes, whose dawn sky is a light grey-mauve, so it only has to change.
    if (SKY_LOOKS[look].keyMix < 0.5) assert.ok(luma(morning[0]) > luma(dawn[0]) * 1.3, `${look}: morning zenith brighter than dawn`);
    else assert.ok(!morning[0].equals(dawn[0]), `${look}: zenith follows the slider`);
    assert.ok(!dawn[1].equals(dusk[1]), `${look}: dawn and dusk differ`);
    // Warm light at the ends: the horizon under a low sun is redder than blue.
    const d = sunState(0).direction, h = Math.hypot(d.x, d.z);
    const under = skyRadianceAt(new THREE.Vector3(d.x / h, 0, d.z / h), computeSkyParams(look, sunState(0)));
    assert.ok(under.r > under.b, `${look}: dawn horizon under the sun is warm`);
  }
});

test('disc colour is the slider sun colour', () => {
  for (const t of [0, DEFAULT_SUN_TIME, 1]) {
    const s = sunState(t), p = computeSkyParams(DEFAULT_SKY_LOOK, s);
    const k = p.discColor.r / s.sunColor.r;
    assert.ok(Math.abs(p.discColor.g - s.sunColor.g * k) < 1e-9 && Math.abs(p.discColor.b - s.sunColor.b * k) < 1e-9);
  }
});

test('fog target is the sky on the horizon the camera faces', () => {
  for (const look of skyLookNames()) for (const t of TIMES) {
    const p = computeSkyParams(look, sunState(t));
    for (const az of [0, 60, 120, 200, 300]) {
      const f = new THREE.Vector3(Math.sin(az * DEG), -0.4, -Math.cos(az * DEG));
      const fog = horizonColorToward(f, p);
      const sky = skyRadianceAt(new THREE.Vector3(f.x, 0, f.z).normalize(), p);
      if (luma(sky) * p.fogGain <= p.fogMaxLum) {
        for (const i of [0, 1, 2]) assert.ok(Math.abs(fog.toArray()[i] - sky.toArray()[i] * p.fogGain) < 1e-9);
      } else {
        assert.ok(Math.abs(luma(fog) - p.fogMaxLum) < 1e-9, 'glare-capped fog keeps the cap');
      }
    }
  }
});

function envRig() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 1, 2);
  const camera = new THREE.PerspectiveCamera(55, 1.6, 1, 50000);
  const renderer = { setClearColor(c) { this.bg = c.getHex(); } };
  return { scene, camera, renderer };
}

test('in the air the fog is pulled to the sky horizon; underground nothing changes', () => {
  const { scene, camera, renderer } = envRig();
  const sky = createSkySystem({ scene });
  try {
    // Underground reference with no sky attached.
    camera.position.set(0, -100, 0); camera.lookAt(0, -100, 500); camera.updateMatrixWorld();
    const opts = { insideness: 1, clayLift: 0.6 };
    setAirSun({ weight: 0, state: null });
    updateEnvironment(camera, scene, null, renderer, opts);
    const before = [scene.fog.color.getHex(), scene.fog.near, scene.fog.far, renderer.bg];
    attachSky(sky);
    for (const t of [0, DEFAULT_SUN_TIME, 1]) {
      setAirSun({ weight: airWeightFor({ heightAboveSurface: -175 }), state: sunState(t) });
      updateEnvironment(camera, scene, null, renderer, opts);
      assert.deepEqual([scene.fog.color.getHex(), scene.fog.near, scene.fog.far, renderer.bg], before, `t=${t}`);
      assert.equal(sky.mesh.visible, false);
      assert.equal(sky.status.discWeight, 0);
    }
    // In the air, facing south: the fog is the sky's horizon colour.
    camera.position.set(0, 900, 0); camera.lookAt(0, 800, 5000); camera.updateMatrixWorld();
    for (const t of [0, DEFAULT_SUN_TIME, 0.5, 1]) {
      const state = sunState(t);
      setAirSun({ weight: 1, state });
      updateEnvironment(camera, scene, null, renderer);
      assert.equal(sky.mesh.visible, true);
      const p = computeSkyParams(DEFAULT_SKY_LOOK, state, { direction: resolveSunDirection() });
      const expected = horizonColorToward(new THREE.Vector3(0, 0, 1), p);
      const got = scene.fog.color;
      const coupling = SKY_LOOKS[DEFAULT_SKY_LOOK].fogCoupling;
      const target = state.fogSky.clone().lerp(expected, coupling);
      for (const i of [0, 1, 2]) assert.ok(Math.abs(got.toArray()[i] - target.toArray()[i]) < 1e-6, `t=${t}`);
      // The disc sits exactly on the light direction.
      assert.ok(sky.mesh.material.uniforms.uSunDir.value.angleTo(state.direction) < 1e-9);
    }
    // (The 24Sep26h Flat look, which left the fog to the slider keyframes, is
    // retired with the Sky row, 25Sep26f D-039.)
    assert.equal(sky.mesh.material.uniforms.uWeight.value, 1);
    assert.equal(sky.mesh.material.uniforms.uDiscWeight.value, 1);
  } finally {
    attachSky(null);
    setAirSun({ weight: 0, state: null });
  }
});

// Fix round 1 (height contract, CLAUDE.md and the sprint's hard rules): Master
// scales the scene through the camera only. The sky's rays are canonical, the
// disc is centred where the camera displays the light direction, and no layer
// (the abyss dome included) is rescaled for Master height.
test('height contract: the displayed disc sits where the camera displays the light', () => {
  const state = sunState(DEFAULT_SUN_TIME);
  const p = computeSkyParams(DEFAULT_SKY_LOOK, state);
  for (const ratio of [1.1 / 5, 1, 2]) {
    const d = displaySunDirection(p, ratio, new THREE.Vector3());
    // The display transform is diag(1, ratio, 1) applied to canonical points.
    const expected = state.direction.clone().multiply(new THREE.Vector3(1, ratio, 1)).normalize();
    assert.ok(d.angleTo(expected) < 1e-12, `ratio ${ratio}`);
    const shadowElev = Math.atan(ratio * Math.tan(Math.asin(state.direction.y))) / DEG;
    assert.ok(Math.abs(Math.asin(d.y) / DEG - shadowElev) < 1e-9, `ratio ${ratio}`);
  }
  // Fresh-visit Master 1.1: the default morning sun is seen about 3 degrees up.
  const d = displaySunDirection(p, 1.1 / 5, new THREE.Vector3());
  assert.ok(Math.abs(Math.asin(d.y) / DEG - 3.02) < 0.01, `${Math.asin(d.y) / DEG}`);
});

test('height contract: the sky shader does not remove the Master scale, and no layer is counter-scaled', () => {
  const src = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');
  // The ray is the inverse of the whole view transform; nothing divides by its scale.
  assert.match(src, /vDir = inverse\( mat3\( viewMatrix \) \)/);
  assert.doesNotMatch(src, /length\( m\[ 1 \] \)/);
  const env = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(env, /masterRatio|masterHeightController/);

  // Behaviour: with the camera at Master 1.1, updateEnvironment leaves a dome at unit scale
  // and the sky's disc uniforms carry the camera's own ratio.
  const { scene, camera, renderer } = envRig();
  camera.position.set(0, 900, 0); camera.lookAt(0, 800, 5000); camera.updateMatrixWorld();
  const mh = createVerticalScaleController({ camera, value: 1.1 });
  const sky = createSkySystem({ scene });
  const dome = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  try {
    attachSky(sky);
    const state = sunState(DEFAULT_SUN_TIME);
    setAirSun({ weight: 1, state });
    updateEnvironment(camera, scene, dome, renderer);
    assert.deepEqual(dome.scale.toArray(), [1, 1, 1]);
    const u = sky.mesh.material.uniforms;
    assert.ok(Math.abs(u.uMasterRatio.value - 0.22) < 1e-12);
    assert.ok(u.uSunDir.value.angleTo(state.direction) < 1e-9);
    const expected = state.direction.clone().multiply(new THREE.Vector3(1, 0.22, 1)).normalize();
    assert.ok(u.uSunDirDisplay.value.angleTo(expected) < 1e-9);
  } finally {
    attachSky(null);
    setAirSun({ weight: 0, state: null });
    mh.dispose();
  }
});

test('below the dome\'s opaque line the sky is the abyss ramp; above it the sky is unchanged', async () => {
  const { abyssColorAt, abyssWeight, ABYSS_OPAQUE_DEG } = await import('../src/sky.js');
  const p = computeSkyParams(DEFAULT_SKY_LOOK, sunState(DEFAULT_SUN_TIME));
  const at = deg => skyRadianceAt(new THREE.Vector3(0, -Math.sin(deg * DEG), Math.cos(deg * DEG)), p);
  const horizon = skyRadianceAt(new THREE.Vector3(0, 0, 1), p);
  // Where the dome is translucent (above its opaque line) the sky underneath is untouched.
  assert.equal(abyssWeight(ABYSS_OPAQUE_DEG - 0.21), 0);
  assert.equal(abyssWeight(ABYSS_OPAQUE_DEG), 1);
  assert.ok(Math.abs(luma(at(ABYSS_OPAQUE_DEG - 0.3)) / luma(horizon) - 1) < 0.05, 'translucent band keeps the horizon sky');
  for (const deg of [4, 12.6, 30, 60, 90]) {
    const c = at(deg), a = abyssColorAt(deg);
    for (const i of [0, 1, 2]) assert.ok(Math.abs(c.toArray()[i] - a.toArray()[i]) < 1e-9, `${deg}`);
  }
  assert.ok(luma(at(60)) < 0.1 * luma(horizon), "the deep abyss is dark");
});

// ── s25:L ── sun glare and the blue line (sprint 25Sep26f, Lane L, D-039) ──

test('disc luminance is bounded: modest over the bloom threshold at every sun position', () => {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const s = sunState(t), p = computeSkyParams('clear', s);
    const l = luma(p.discColor);
    assert.ok(l >= CLEAR_SKY.discLuminance * DISC_HORIZON_FRACTION - 1e-9, `t=${t} ${l}`);
    assert.ok(l <= CLEAR_SKY.discLuminance + 1e-9, `t=${t} ${l}`);
    assert.ok(l < 4 * BLOOM_THRESHOLD, `t=${t} ${l}`);
    // Even at the rim (limb darkening 0.55) the disc still clears the sky.
    assert.ok(l * 0.55 + GLOW_CEILING > 1.2 + 0.4, `t=${t}`);
    // The disc keeps the slider's sun colour.
    const k = p.discColor.r / s.sunColor.r;
    assert.ok(Math.abs(p.discColor.b - s.sunColor.b * k) < 1e-9);
  }
});

test('the painted aureole is round, falls off with angle and never reaches the bloom threshold', () => {
  const dirs = directions();
  for (const t of TIMES) {
    const p = computeSkyParams('clear', sunState(t));
    assert.ok(p.aureoleCore > 0 && p.aureoleSkirt > 0);
    let prev = Infinity;
    for (let a = 0; a <= 40 * DEG; a += 0.05 * DEG) {
      const w = aureoleWeight(a, p);
      assert.ok(Number.isFinite(w) && w >= 0 && w <= prev + 1e-12, `t=${t} a=${a / DEG}`);
      prev = w;
    }
    // The glow is a function of angle only (so round on screen); with the sky
    // under it, it stays below the bloom threshold everywhere.
    const c = new THREE.Color();
    for (const d of [...dirs, p.sunDir.clone()]) for (const a of [0, 0.3 * DEG, 1 * DEG, 5 * DEG]) {
      p.discWeight = 1;
      skyWithAureoleAt(d, p, c, a);
      for (const v of c.toArray()) assert.ok(Number.isFinite(v) && v >= 0);
      assert.ok(luma(c) < GLOW_CEILING + 1e-9 && luma(c) < BLOOM_THRESHOLD, `t=${t} ${luma(c)}`);
    }
  }
  assert.equal(glowCeiling(0.5), 0.5);
  assert.ok(glowCeiling(50) <= GLOW_CEILING && glowCeiling(0.81) > SKY_CEILING);
});

test('the blue line: the horizon glow is finite exactly opposite the sun', () => {
  // The anti-solar compass direction, and rays a hair either side of it, at
  // several elevations: az rounds just below -1 there. It must be clamped.
  for (const t of TIMES) {
    const p = computeSkyParams('clear', sunState(t));
    const s = p.sunDir, h = Math.hypot(s.x, s.z);
    for (const el of [0, 0.5, 3, 20, 60]) for (const eps of [0, 1e-9, -1e-9, 1e-7]) {
      const e = el * DEG, ax = -s.x / h, az = -s.z / h;
      const d = new THREE.Vector3(ax * Math.cos(e) + eps, Math.sin(e), az * Math.cos(e) - eps).normalize();
      const c = skyRadianceAt(d, p);
      for (const v of c.toArray()) assert.ok(Number.isFinite(v) && v >= 0, `t=${t} el=${el} ${v}`);
    }
  }
  // The shader clamps the same cosine before pow() (GLSL pow of a negative
  // base is NaN on Metal: the dotted blue column Jordan saw, 25Sep26f).
  const src = readFileSync(new URL('../src/sky.js', import.meta.url), 'utf8');
  assert.match(src, /float az = \( lh > 1e-5 && ls > 1e-5 \) \? clamp\( dot\( d\.xz, uSunDir\.xz \) \/ \( lh \* ls \), -1\.0, 1\.0 \)/);
});

test('the water glint is clamped under the bloom threshold', async () => {
  const { WATER_GLINT_MAX_LUMINANCE } = await import('../src/water-material.js');
  const src = readFileSync(new URL('../src/water-material.js', import.meta.url), 'utf8');
  // The clamp is applied to every water material's output.
  assert.match(src, /if \( waterLum > \$\{WATER_GLINT_MAX_LUMINANCE\.toFixed\(4\)\} \) gl_FragColor\.rgb \*=/);
  assert.ok(WATER_GLINT_MAX_LUMINANCE >= 0.8, 'the glint still reads as bright');
  // Blended at the Thames' opacity (0.58) over a dark river, it stays under the threshold.
  assert.ok(WATER_GLINT_MAX_LUMINANCE * 0.58 + 0.2 * 0.42 < BLOOM_THRESHOLD);
});
// ── /s25:L ──
