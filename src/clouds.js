// clouds.js: fair-weather cumulus (sprint 25Sep26f, Lane C, D-039).
//
// Jordan's cloud-scope answers (24Sep26h), as built here:
//   - a permanent fair-weather cumulus sky at 2 to 3 oktas, structured as
//     presets (clouds-presets.js) so other weathers can be added later;
//   - clouds move with the shared wind (wind.js) as one field (clouds-field.js);
//   - above the clouds the layer thins to about a third;
//   - cloud shadows move across the whole city (clouds-shadow.js);
//   - altitude follows Master like the landscape, while the cloud BODIES keep
//     true proportions like every structure (Lane S rule): a puff is a round
//     view-space sprite of its real size, placed at base x Master + its real
//     height within the cloud;
//   - the Dawn to Dusk slider changes only the light on the clouds: colours
//     come from the sun and sky each frame, positions never read the slider;
//   - clouds fade out towards the M25 edge;
//   - nothing is drawn underground or underwater (sun.js air weight).
//
// DRAWING (scope: sprite clusters). Each cloud is 7 to 16 soft puff sprites;
// all puffs are one instanced draw. A small generated atlas holds four puff
// shapes with their surface direction, and the fragment shader lights them
// live: wrapped sunlight, darker towards the flat base, a silver rim towards
// the sun, sky fill, the scene fog, and brightness held under the bloom
// threshold. Puffs are sorted back to front by cloud a few times a second
// (distance order does not change as the camera turns), and within a cloud
// bottom-up or top-down depending on which side the camera is.
//
// COST. One draw call. Per frame: a drift lookup (memoised integral), a few
// uniform writes and the shadow parameters; twice a second the visible clouds
// are re-sorted and their puffs re-packed (about 18k puffs, well under a
// millisecond). Puffs of clouds faded out at the edge, beyond the fog, or
// dropped by thinning/quality collapse to nothing in the vertex shader.

import * as THREE from 'three';
import {
  CLOUD_FIELD, buildCloudLayout, cloudDrift, cloudPosition, sampleEdgeFade,
  shadowStrengthFor, updraftAt as fieldUpdraftAt, cloudSunFactor, shadowPlaneY, mulberry32,
} from './clouds-field.js';
import { resolveCloudPreset, DEFAULT_CLOUD_PRESET } from './clouds-presets.js';
import {
  cloudEdgeTexture, setCloudShadowLayout, updateCloudShadow, patchCloudShadowChunks,
} from './clouds-shadow.js';
import { resolveSunDirection } from './environment.js';

const VE = 5;
const DEG = Math.PI / 180;
const FLOATS = 12; // per puff: aPuff(4) aCloud(4) aMisc(4)

export const CLOUD_CONFIG = {
  resortSeconds: 1,
  resortJumpM: 1500,        // a camera jump this large re-sorts at once
  // Distance (display metres): far clouds keep only their largest puffs, then
  // fade out into the haze and are not drawn at all. Clouds stack deeply
  // towards the horizon, which is where the fill cost goes.
  lodM: [5000, 15000],
  farKeep: 0.3,
  fadeM: [15000, 24000],
  maxLum: 0.8,              // under the bloom threshold (0.88)
  renderOrder: 50,
  // Per-puff opacity above the layer, with 60% of the puffs kept. Calibrated
  // by measurement (scripts/measure-cloud-thinning.mjs) so that the layer's
  // visible effect from above is about a third of the unthinned layer's.
  thinAlpha: 0.12,
  thinKeep: 0.35,
};

// ── Puff atlas ──────────────────────────────────────────────────────────────

/**
 * Four puff shapes in a 2x2 RGBA atlas: RG = surface direction (x, y) in the
 * sprite's plane, B = its z (towards the viewer), A = density. Seeded value
 * noise, so the atlas is identical on every visit.
 */
export function buildPuffAtlas(size = 128) {
  const N = size * 2;
  const data = new Uint8Array(N * N * 4);
  const rand = mulberry32(7702);
  const G = 16, lattice = new Float32Array(G * G * 4);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const noise = (v, x, y) => {
    const fx = ((x % G) + G) % G, fy = ((y % G) + G) % G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const L = (i, j) => lattice[(((j % G) * G) + (i % G)) * 4 + v];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
    const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (v, x, y) => 0.55 * noise(v, x, y) + 0.3 * noise(v, x * 2.1, y * 2.1) + 0.15 * noise(v, x * 4.3, y * 4.3);
  const h = new Float32Array(size * size);
  const ANG = 256, rim = new Float32Array(ANG);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * size, oy = Math.floor(v / 2) * size;
    // Lumpy outline: the radius wobbles with angle (tabulated once per shape).
    for (let a = 0; a < ANG; a++) {
      const ang = a / ANG * Math.PI * 2;
      rim[a] = 0.8 + 0.16 * (fbm(v, Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 + 3) - 0.5) * 2;
    }
    // Surface relief, sampled once per texel; its gradient roughens the normal.
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const px = (i + 0.5) / size * 2 - 1, py = (j + 0.5) / size * 2 - 1;
        h[j * size + i] = fbm(v, px * 6, py * 6);
      }
    }
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const px = (i + 0.5) / size * 2 - 1, py = (j + 0.5) / size * 2 - 1;
        const a = Math.floor(((Math.atan2(py, px) / (Math.PI * 2)) + 1) % 1 * ANG) % ANG;
        const rr = rim[a];
        const d = Math.hypot(px, py) / rr;
        const hh = h[j * size + i];
        let alpha = (1 - smooth(0.45, 1.0, d)) * (0.8 + 0.2 * hh);
        const gx = h[j * size + Math.min(size - 1, i + 1)] - h[j * size + Math.max(0, i - 1)];
        const gy = h[Math.min(size - 1, j + 1) * size + i] - h[Math.max(0, j - 1) * size + i];
        let nx = px / rr - gx * 2.6, ny = py / rr - gy * 2.6;
        let nz = Math.sqrt(Math.max(0.04, 1 - Math.min(1, d * d)));
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const k = ((oy + j) * N + ox + i) * 4;
        data[k] = Math.round((nx * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round(nz * 255);
        data[k + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      }
    }
  }
  return { data, size: N };
}
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// ── Shaders ────────────────────────────────────────────────────────────────

const VERTEX = /* glsl */`
attribute vec4 aPuff;   // dx, dy (above base), dz, radius: real metres
attribute vec4 aCloud;  // cloud centre x, z at t=0 (scene), base altitude, height: real metres
attribute vec4 aMisc;   // rank (0 = largest), variant, rotation, 0
uniform vec4 uField;    // originX, originZ, size, VE
uniform vec4 uEdgeXf;   // originX, originZ, size, 0
uniform sampler2D uEdge;
uniform vec2 uDrift;
uniform float uRatio;   // Master / VE: display y = canonical y x ratio
uniform float uKeep;    // quality: largest fraction of puffs kept
uniform float uThinAlpha; // per-puff opacity above the layer (the layer reads as a third)
uniform float uThinOn;  // 1, or 0 to measure the unthinned layer
uniform float uThinKeep; // fraction of puffs (largest first) kept above the layer
uniform vec2 uLod;      // display distance where far detail starts and ends
uniform float uFarKeep; // fraction of puffs kept at and beyond uLod.y
uniform vec2 uFade;     // display distance over which clouds fade out
uniform float uOpacity; // air weight x enabled
uniform vec3 uSunDir;   // canonical, towards the sun
varying vec2 vUv;       // sprite coordinates, -1..1 across the puff
varying vec2 vTile;     // atlas tile of this puff's shape
varying vec2 vRot;
varying float vAlpha;
varying float vRel;     // display metres above the cloud base
varying float vHeight;
varying vec3 vViewPos;
varying vec3 vSunView;
#include <fog_pars_vertex>
void main() {
  vec2 c = uField.xy + mod( aCloud.xy + uDrift - uField.xy, uField.z );
  float edge = texture2D( uEdge, ( c - uEdgeXf.xy ) / uEdgeXf.z ).r;
  float master = uRatio * uField.w;
  // Thinning: how far the camera is above this cloud's top (display metres).
  float above = cameraPosition.y * uRatio - ( aCloud.z * master + aCloud.w );
  float thin = smoothstep( 0.0, 400.0, above ) * uThinOn;
  float keepThin = mix( 1.0, uThinKeep, thin );
  // Distance detail: far clouds keep only their largest puffs (they are a few
  // pixels across and stack deeply towards the horizon, where fill is spent).
  float dist = length( ( modelViewMatrix * vec4( c.x, ( aCloud.z * master ) / uRatio, c.y, 1.0 ) ).xyz );
  float lodKeep = mix( 1.0, uFarKeep, smoothstep( uLod.x, uLod.y, dist ) );
  float far = 1.0 - smoothstep( uFade.x, uFade.y, dist );
  float keep = min( min( uKeep, keepThin ), lodKeep );
  if ( uOpacity <= 0.0 || edge < 0.004 || far <= 0.0 || aMisc.x > keep + 1e-4 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); // collapsed: no fragments
    return;
  }
  // Canonical centre: base follows Master, the body keeps true size.
  vec3 centre = vec3( c.x + aPuff.x, ( aCloud.z * master + aPuff.y ) / uRatio, c.y + aPuff.z );
  vec4 mvC = modelViewMatrix * vec4( centre, 1.0 );
  float r = aPuff.w;
  float cr = cos( aMisc.z ), sr = sin( aMisc.z );
  vec2 corner = position.xy;
  vec2 rc = vec2( corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr ) * r;
  vec4 mv = mvC + vec4( rc, 0.0, 0.0 );
  // Display height of this corner above the cloud base.
  float offY = ( transpose( mat3( viewMatrix ) ) * vec3( rc, 0.0 ) ).y / uRatio;
  vRel = aPuff.y + offY;
  vHeight = aCloud.w;
  // Dissolve a puff the camera is inside or about to enter.
  float near = smoothstep( r * 0.6, r * 2.2, length( mvC.xyz ) );
  vAlpha = uOpacity * edge * far * near * mix( 1.0, uThinAlpha, thin ) * ( 1.0 + 0.6 * ( 1.0 - lodKeep ) );
  float variant = aMisc.y;
  vUv = corner;
  vTile = vec2( mod( variant, 2.0 ), floor( variant / 2.0 ) ) * 0.5;
  vRot = vec2( cr, sr );
  vViewPos = mv.xyz;
  vSunView = normalize( mat3( viewMatrix ) * uSunDir );
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */`
uniform sampler2D uPuff;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBase;
uniform float uMaxLum;
varying vec2 vUv;
varying vec2 vTile;
varying vec2 vRot;
varying float vAlpha;
varying float vRel;
varying float vHeight;
varying vec3 vViewPos;
varying vec3 vSunView;
#include <fog_pars_fragment>
void main() {
  // The octagon reaches just past the unit circle; stay inside this tile.
  vec4 s = texture2D( uPuff, ( clamp( vUv, -0.995, 0.995 ) * 0.5 + 0.5 ) * 0.5 + vTile );
  // Flat base: fade out what hangs below the cloud base.
  float a = s.a * vAlpha * smoothstep( -30.0, 40.0, vRel );
  if ( a < 0.004 ) discard;
  vec3 n = vec3( s.rg * 2.0 - 1.0, s.b );
  n.xy = vec2( n.x * vRot.x - n.y * vRot.y, n.x * vRot.y + n.y * vRot.x );
  n = normalize( n );
  vec3 L = normalize( vSunView );
  float h01 = clamp( vRel / max( vHeight, 1.0 ), 0.0, 1.0 );
  // Wrapped sunlight. Half of it follows the puff's surface, half the heap as
  // a whole (brighter up the cloud), so a puff seen from below does not read
  // as a lit ring round a dark centre.
  float surf = clamp( ( dot( n, L ) + 0.6 ) / 1.6, 0.0, 1.0 );
  float diffuse = mix( surf, mix( 0.45, 0.95, h01 ), 0.5 );
  float occl = mix( 0.42, 1.0, smoothstep( 0.0, 0.75, h01 ) );
  // Silver rim: looking towards the sun through the thin edges.
  vec3 toCam = normalize( -vViewPos );
  float towards = max( dot( -toCam, L ), 0.0 );
  float rim = pow( towards, 8.0 ) * ( 1.0 - s.a ) * 1.6;
  vec3 fill = mix( uAmbBase, uAmbTop, clamp( h01 * 0.6 + n.y * 0.25 + 0.25, 0.0, 1.0 ) );
  vec3 col = uSunCol * ( diffuse * occl + rim ) + fill;
  // Hold the brightest tops under the bloom threshold, keeping their hue.
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( l > uMaxLum * 0.8 ) col *= ( uMaxLum * 0.8 + ( uMaxLum * 0.2 ) * ( 1.0 - exp( -( l - uMaxLum * 0.8 ) / ( uMaxLum * 0.2 ) ) ) ) / l;
  gl_FragColor = vec4( col, a );
  #include <fog_fragment>
}`;

// ── System ─────────────────────────────────────────────────────────────────

function readCloudsParam() {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('clouds');
    return v === null ? null : !(v === '0' || v === 'off' || v === 'false');
  } catch { return null; }
}

/**
 * Add the cloud layer. `sunSystem` is sun.js's system (air weight, sun state),
 * `skySystem` sky.js's (the sunlight and fill colours the sky itself uses).
 */
export function createCloudSystem({ scene, sunSystem = null, skySystem = null, preset = DEFAULT_CLOUD_PRESET, enabled = null } = {}) {
  const P = resolveCloudPreset(preset);
  const layout = buildCloudLayout(P);
  const shadowsOk = patchCloudShadowChunks();
  setCloudShadowLayout(layout, CLOUD_FIELD);
  let on = enabled ?? readCloudsParam() ?? true;
  let shadowsOn = true;

  // Static per-cloud puff data, packed once.
  const packed = layout.clouds.map(c => {
    const a = new Float32Array(c.puffs.length * FLOATS);
    c.puffs.forEach((p, i) => {
      a.set([p.dx, p.dy, p.dz, p.r, c.cx, c.cz, c.base, c.height, p.rank, p.variant, p.rot, 0], i * FLOATS);
    });
    // The same puffs top-down, for a camera below the cloud.
    const rev = new Float32Array(a.length);
    for (let i = 0, n = c.puffs.length; i < n; i++) rev.set(a.subarray((n - 1 - i) * FLOATS, (n - i) * FLOATS), i * FLOATS);
    return { up: a, down: rev };
  });

  // An octagon around the round puff: 17% less fill than a square quad.
  const quad = new THREE.CircleGeometry(1 / Math.cos(Math.PI / 8), 8);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const buffer = new Float32Array(layout.puffCount * FLOATS);
  const inter = new THREE.InstancedInterleavedBuffer(buffer, FLOATS, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPuff', new THREE.InterleavedBufferAttribute(inter, 4, 0));
  geometry.setAttribute('aCloud', new THREE.InterleavedBufferAttribute(inter, 4, 4));
  geometry.setAttribute('aMisc', new THREE.InterleavedBufferAttribute(inter, 4, 8));
  geometry.instanceCount = 0;

  const atlas = buildPuffAtlas();
  const puffTex = new THREE.DataTexture(atlas.data, atlas.size, atlas.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  puffTex.magFilter = THREE.LinearFilter;
  puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  puffTex.generateMipmaps = true;
  puffTex.colorSpace = THREE.NoColorSpace;
  puffTex.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uField: { value: new THREE.Vector4(CLOUD_FIELD.originX, CLOUD_FIELD.originZ, CLOUD_FIELD.size, VE) },
    uEdgeXf: { value: new THREE.Vector4(CLOUD_FIELD.originX, CLOUD_FIELD.originZ, CLOUD_FIELD.size, 0) },
    uEdge: { value: null },
    uPuff: { value: null },
    uDrift: { value: new THREE.Vector2() },
    uRatio: { value: 1.1 / VE },
    uKeep: { value: 1 },
    uThinAlpha: { value: CLOUD_CONFIG.thinAlpha },
    uThinOn: { value: 1 },
    uThinKeep: { value: CLOUD_CONFIG.thinKeep },
    uLod: { value: new THREE.Vector2(...CLOUD_CONFIG.lodM) },
    uFarKeep: { value: CLOUD_CONFIG.farKeep },
    uFade: { value: new THREE.Vector2(...CLOUD_CONFIG.fadeM) },
    uOpacity: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmbTop: { value: new THREE.Color(0.3, 0.35, 0.42) },
    uAmbBase: { value: new THREE.Color(0.2, 0.22, 0.26) },
    uMaxLum: { value: CLOUD_CONFIG.maxLum },
  }]);
  uniforms.uEdge.value = cloudEdgeTexture;
  uniforms.uPuff.value = puffTex;
  const material = new THREE.ShaderMaterial({
    name: 'clouds', uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true, fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = CLOUD_CONFIG.renderOrder;
  mesh.visible = false;
  mesh.userData.noShadow = true;
  if (scene) scene.add(mesh);

  const drift = { x: 0, z: 0 };
  const pos = { x: 0, z: 0 };
  const sunDir = new THREE.Vector3(0, 1, 0);
  const lastSortCam = new THREE.Vector3(Infinity, 0, 0);
  let lastSortTime = -Infinity, time = 0, timeOverride = null;
  // Sort scratch, allocated once: candidate cloud ids, their keys, and the
  // order last written to the buffer (id * 2 + below) so an unchanged order
  // skips the rewrite and upload.
  const nClouds = layout.clouds.length;
  const cand = [], keys = new Float64Array(nClouds), below = new Uint8Array(nClouds);
  let written = new Int32Array(0);
  const byKey = (a, b) => keys[b] - keys[a];
  const status = {
    enabled: on, visible: false, opacity: 0, time: 0, drift, clouds: layout.clouds.length,
    visibleClouds: 0, instances: 0, sorts: 0, shadowStrength: 0, shadowsPatched: shadowsOk,
    preset: P.id, ratio: 1.1 / VE, keep: 1, planeY: 0,
  };

  function resort(camera, ratio) {
    const master = ratio * VE, cx = camera.position.x, cz = camera.position.z;
    const camDispY = camera.position.y * ratio;
    const cull2 = (CLOUD_CONFIG.fadeM[1] + 1500) ** 2; // + a cloud's reach
    cand.length = 0;
    for (let i = 0; i < nClouds; i++) {
      const c = layout.clouds[i];
      cloudPosition(c, drift, pos);
      const dx = pos.x - cx, dz = pos.z - cz;
      const dy = c.base * master + c.height / 2 - camDispY; // display metres
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > cull2 || sampleEdgeFade(layout, pos.x, pos.z) < 0.004) continue;
      keys[i] = d2; below[i] = dy > 0 ? 1 : 0;
      cand.push(i);
    }
    cand.sort(byKey); // far first
    lastSortCam.copy(camera.position);
    lastSortTime = time;
    status.sorts++;
    let same = written.length === cand.length;
    for (let k = 0; same && k < cand.length; k++) same = written[k] === cand[k] * 2 + below[cand[k]];
    if (same) return;
    if (written.length !== cand.length) written = new Int32Array(cand.length);
    let n = 0;
    for (let k = 0; k < cand.length; k++) {
      const i = cand[k];
      written[k] = i * 2 + below[i];
      const src = below[i] ? packed[i].down : packed[i].up;
      buffer.set(src, n * FLOATS);
      n += src.length / FLOATS;
    }
    geometry.instanceCount = n;
    inter.clearUpdateRanges?.();
    inter.addUpdateRange(0, n * FLOATS);
    inter.needsUpdate = true;
    status.visibleClouds = cand.length;
    status.instances = n;
    status.rewrites = (status.rewrites || 0) + 1;
  }

  const _c = new THREE.Color();
  function light(state) {
    const sky = skySystem?.params;
    if (sky && sky.weight > 0) {
      uniforms.uSunCol.value.copy(sky.illum).multiplyScalar(0.85);
      _c.copy(sky.ambient);
      uniforms.uAmbTop.value.copy(_c).multiplyScalar(0.55).add(state ? _c.copy(state.hemiSky).multiplyScalar(0.06) : _c.setRGB(0, 0, 0));
      uniforms.uAmbBase.value.copy(sky.ambient).multiplyScalar(0.32);
    } else if (state) {
      uniforms.uSunCol.value.copy(state.sunColor).multiplyScalar(0.6 * state.sunFactor);
      uniforms.uAmbTop.value.copy(state.skyColor).multiplyScalar(0.5);
      uniforms.uAmbBase.value.copy(state.skyColor).multiplyScalar(0.3);
    }
  }

  /**
   * Per frame, after the sun, sky and environment updates. `time` is the
   * shared world clock (the mode registry's, which the wind consumers read).
   * `quality` is Automatic's current level ({ samples }), or null in Manual.
   */
  function update({ camera, time: t = 0, airWeight = null, quality = null } = {}) {
    time = timeOverride ?? (Number.isFinite(t) ? t : 0);
    status.time = time;
    cloudDrift(time, P, drift);
    const w = airWeight ?? sunSystem?.status?.airWeight ?? 0;
    const opacity = on ? Math.min(1, Math.max(0, w)) : 0;
    status.opacity = opacity;
    const ratio = camera?.userData?.masterHeightController?.ratio ?? 1;
    status.ratio = ratio;

    resolveSunDirection(sunDir);
    const elevationDeg = Math.asin(Math.min(1, Math.max(-1, sunDir.y))) / DEG;
    const strength = shadowsOk ? shadowStrengthFor(P, { airWeight: w, elevationDeg, enabled: on && shadowsOn }) : 0;
    status.shadowStrength = strength;
    const planeY = shadowPlaneY(layout, ratio, VE);
    status.planeY = planeY;
    if (camera) camera.updateMatrixWorld();
    updateCloudShadow({ drift, sunDir, strength, planeY, skyShare: P.shadowSkyShare ?? 0, camera });

    mesh.visible = opacity > 0;
    status.visible = mesh.visible;
    if (!mesh.visible || !camera) return;
    uniforms.uOpacity.value = opacity;
    uniforms.uDrift.value.set(drift.x, drift.z);
    uniforms.uRatio.value = ratio;
    uniforms.uSunDir.value.copy(sunDir);
    const samples = quality?.samples;
    status.keep = uniforms.uKeep.value = samples === undefined || samples >= 4 ? 1 : samples >= 2 ? 0.75 : 0.55;
    light(sunSystem?.state ?? null);
    if (time - lastSortTime >= CLOUD_CONFIG.resortSeconds || time < lastSortTime
      || camera.position.distanceToSquared(lastSortCam) > CLOUD_CONFIG.resortJumpM ** 2) {
      resort(camera, ratio);
    }
  }

  function setEnabled(v) { on = !!v; status.enabled = on; return on; }
  /** Cloud shadows on the city (on by default; off for comparisons). */
  function setShadowsEnabled(v) { shadowsOn = !!v; return shadowsOn; }
  /** Measurement only: switch the above-the-layer thinning off and on. */
  function setThinning(v) { uniforms.uThinOn.value = v ? 1 : 0; }

  const api = {
    mesh, material, layout, preset: P, status,
    update, setEnabled, setShadowsEnabled, setThinning,
    get enabled() { return on; },
    /** Force a time (tests, captures); null returns to the world clock. */
    setTimeOverride(t) { timeOverride = Number.isFinite(t) ? t : null; lastSortTime = -Infinity; },
    /** Each cloud's (x, z) at time t: pure, as the field model computes it. */
    positionsAt(t) {
      const d = cloudDrift(t, P), p = { x: 0, z: 0 };
      return layout.clouds.map(c => { cloudPosition(c, d, p); return [p.x, p.z]; });
    },
    /** Direct-sun factor at a canonical point with the current shadow state (CPU mirror). */
    sunFactorAt(x, y, z) {
      return cloudSunFactor(layout, x, y, z, { drift, sunDir, strength: status.shadowStrength, planeY: status.planeY });
    },
    edgeFadeAt: (x, z) => sampleEdgeFade(layout, x, z),
    /** Balloon lift: thermal updraft (real m/s) at (x, z) and a real altitude above ground. */
    updraftAt(x, z, altM, t = time) {
      if (!on) return 0;
      return fieldUpdraftAt(layout, x, z, altM, cloudDrift(t, P));
    },
  };
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__ugClouds = api;
  return api;
}
