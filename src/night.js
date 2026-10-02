// night.js: a THROWAWAY research proof (sprint 02Oct26f, lane R, round "night").
// Never merged, never deployed. Switched on by ?night=1 and absent otherwise: with
// no flag every hook below returns at once and no shader is touched.
//
// WHAT IT PROVES (D-048 item 11): can the city read as lit from within, under
// moonlight and a star canopy, inside "maximal economy"? Four terms, each its
// own letter so the cost of each can be measured alone:
//
//   w  lit windows: one term in the shared building material (surface-geometry.js),
//      a procedural window grid on the walls. Variety comes from a hash of the
//      instance matrix's translation in the shader. NEVER instanceColor or
//      setColorAt (the M5 driver renders those buildings black). The baked and
//      the live building paths share the material, so both get it.
//   g  streetlight glow: a warm emissive tint along the roads of the baked
//      ground mask (UGG1 ground.bin, the B channel the ground shader already
//      samples). No new geometry, no new texture.
//   s  a star canopy in the analytic sky (sky.js): hashed stars above the
//      horizon, no texture download, fading out with the night level.
//   m  moonlight: the sun state retinted and dimmed (cool, low), the ambient and
//      hemisphere fills set for night, the sun disc shown as the moon, the sky
//      itself darkened. The directional light and its shadow path are the
//      existing ones: shadows are kept or dropped with the existing toggle.
//
// URL FLAGS
//   ?night=1            night level 0..1 (1 = full night; 0.5 = twilight blend)
//   &nparts=wgsm        which terms to build (default all four; ablation: drop letters)
//   &nlit=0.55          fraction of windows lit, 0..1 (the "time of night" knob:
//                       about 0.8 at 22:00, 0.2 before dawn)
//   &nshadow=0          moonlight shadows off (default on, like the day toggle)
//   &nwin=1.5           lit-window emission gain; &nglow=0.3 street glow gain
//
// DETERMINISM. Nothing here uses randomness: every pattern is a hash of
// position, and the lit fraction is a plain uniform.
//
// NaN GUARD. Bloom smears one NaN pixel across the whole frame, so every term
// is built from max()/clamp()/smoothstep() of finite values; no pow() of a
// possibly-negative base, no division by a quantity that can reach zero.

import * as THREE from 'three';

const params = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams('');
const num = (key, fallback) => {
  if (!params.has(key)) return fallback;
  const n = Number(params.get(key));
  return Number.isFinite(n) ? n : fallback;
};

const level0 = params.has('night') ? Math.min(1, Math.max(0, num('night', 1))) : 0;
const partsRaw = (params.get('nparts') ?? 'wgsm').toLowerCase();

export const NIGHT = {
  enabled: level0 > 0,
  level: level0,
  parts: {
    windows: partsRaw.includes('w'),
    glow: partsRaw.includes('g'),
    stars: partsRaw.includes('s'),
    moon: partsRaw.includes('m'),
  },
  lit: Math.min(1, Math.max(0, num('nlit', 0.55))),
  winGain: Math.max(0, num('nwin', 1.5)),
  glowGain: Math.max(0, num('nglow', 0.3)),
  shadows: num('nshadow', 1) !== 0,
};

/** Shared uniforms: one object each, referenced by every material that uses it. */
export const nightUniforms = {
  uNightAmt: { value: 0 },        // night level x air weight (0 underground)
  uNightLit: { value: NIGHT.lit },
  uNightWinGain: { value: NIGHT.winGain },
  uNightGlowGain: { value: NIGHT.glowGain },
  uNightSize: { value: new THREE.Vector2(1, 1) },   // ground bbox in metres (lamp noise)
};

// ── Sun state: the moon ──────────────────────────────────────────────────────
// sun.js builds a sunState each time the slider moves; the proof overrides the
// air-side numbers every frame (cheap: a dozen assignments), so the existing
// light, shadow, fog, sky and cloud plumbing all follow with no further edits.
const MOON_ELEVATION_DEG = 38;
const MOON_AZIMUTH_DEG = 235;   // compass degrees, clockwise from north: south-west
const _moonDir = (() => {
  const el = MOON_ELEVATION_DEG * Math.PI / 180, az = MOON_AZIMUTH_DEG * Math.PI / 180;
  // scene axes: x east, y up, z south
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
})();
const C = {
  sun: new THREE.Color(0x9fb4f0),
  ambient: new THREE.Color(0x6e84d8),
  hemi: new THREE.Color(0x5a6fb8),
  sky: new THREE.Color(0x05080f),
  fog: new THREE.Color(0x0a0f1e),
};
const K = { sun: 0.17, ambient: 0.16, hemi: 0.2 };

export function applyNightToSunState(state) {
  const n = NIGHT.level;
  if (!NIGHT.enabled || !NIGHT.parts.moon || !state) return;
  state.direction.lerp(_moonDir, n).normalize();
  state.elevationDeg = Math.asin(THREE.MathUtils.clamp(state.direction.y, -1, 1)) * 180 / Math.PI;
  state.sunColor.lerp(C.sun, n);
  state.sunFactor = THREE.MathUtils.lerp(state.sunFactor, K.sun, n);
  state.ambientFactor = THREE.MathUtils.lerp(state.ambientFactor, K.ambient, n);
  state.hemiFactor = THREE.MathUtils.lerp(state.hemiFactor, K.hemi, n);
  state.ambientColor.lerp(C.ambient, n);
  state.hemiSky.lerp(C.hemi, n);
  state.skyColor.lerp(C.sky, n);
  state.fogSky.lerp(C.fog, n);
}

// ── Sky parameters: night sky, moon disc, glow ───────────────────────────────
// Called at the end of computeSkyParams (sky.js). The fog coupling reads the
// same parameters through the CPU mirror, so the fog follows the night sky.
const NIGHT_AMBIENT = new THREE.Color(0.0055, 0.0095, 0.026);
const NIGHT_ILLUM = new THREE.Color(0.010, 0.0075, 0.0055);   // faint warm city glow
export function applyNightToSkyParams(p) {
  const n = NIGHT.level;
  if (!NIGHT.enabled || !NIGHT.parts.moon) return;
  const k = 1 - 0.985 * n;
  p.illum.multiplyScalar(k).lerp(NIGHT_ILLUM, n);
  p.ambient.multiplyScalar(k).lerp(NIGHT_AMBIENT, n);
  p.horizonGlow = THREE.MathUtils.lerp(p.horizonGlow, 0.9, n);
  p.horizonGlowPow = THREE.MathUtils.lerp(p.horizonGlowPow, 0.35, n);   // city glow all round the horizon
  // Moon disc: cool white, only just over the bloom threshold, with a small halo.
  p.discColor.lerp(new THREE.Color(1.05, 1.08, 1.2), n);
  p.aureoleColor.lerp(new THREE.Color(0.45, 0.55, 0.9), n);
  p.aureoleCore *= (1 - 0.8 * n);
  p.aureoleSkirt *= (1 - 0.85 * n);
}

/** Star weight for the sky shader: 0 by day, 1 at full night; fades with the level. */
export function starWeight() {
  if (!NIGHT.enabled || !NIGHT.parts.stars) return 0;
  const n = NIGHT.level;
  return n * n * (3 - 2 * n);
}

// ── Per-frame ────────────────────────────────────────────────────────────────
/** Call once a frame with the air weight (sun.js's status.airWeight). */
export function updateNight(airWeight) {
  nightUniforms.uNightAmt.value = NIGHT.enabled ? NIGHT.level * THREE.MathUtils.clamp(airWeight, 0, 1) : 0;
}

// ── GLSL shared by the windows ───────────────────────────────────────────────
const HASH_GLSL = /* glsl */`
float ngHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float ngHash11( float p ) {
  p = fract( p * 0.1031 );
  p *= p + 33.33;
  p *= p + p;
  return fract( p );
}`;

/**
 * Window term for the shared building material. `shader` is the object three
 * hands to onBeforeCompile; the caller has already declared uHeightScale in the
 * vertex stage. One term: a window grid on the walls, per-building variety from a
 * hash of the instance translation, emission added to totalEmissiveRadiance.
 */
export function injectBuildingWindows(shader) {
  shader.uniforms.uNightAmt = nightUniforms.uNightAmt;
  shader.uniforms.uNightLit = nightUniforms.uNightLit;
  shader.uniforms.uNightWinGain = nightUniforms.uNightWinGain;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vNW;      // wall coordinate across (m), up (local units), wall flag
varying vec4 vNB;      // building hash, face id, side (m), height (local units)
${HASH_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
	{
		vec3 nInst = vec3( 1.0 );
		vec3 nT = vec3( 0.0 );
		#ifdef USE_INSTANCING
			nInst = vec3( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ), length( instanceMatrix[2].xyz ) );
			nT = instanceMatrix[3].xyz;
		#endif
		float nWall = 1.0 - step( 0.5, abs( normal.y ) );
		float nAcrossX = step( 0.5, abs( normal.z ) );
		float nAcross = mix( position.z * nInst.z, position.x * nInst.x, nAcrossX );
		vNW = vec3( nAcross, position.y * nInst.y * uHeightScale, nWall );
		// Per-building hash from the instance translation: no instanceColor.
		float nBh = ngHash12( floor( nT.xz * 0.5 ) + 0.5 );
		vNB = vec4( nBh, sign( normal.x ) + 2.0 * sign( normal.z ) + 4.0 * nAcrossX, nInst.x, nInst.y * uHeightScale );
	}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uNightAmt;
uniform float uNightLit;
uniform float uNightWinGain;
uniform float uHeightScale;
varying vec3 vNW;
varying vec4 vNB;
${HASH_GLSL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	if ( uNightAmt > 0.001 && vNW.z > 0.5 ) {
		// Bay 2.6 m wide, floor 3.2 m (canonical VE5 units x uHeightScale, which is
		// 1 / Master: a floor is a true 3.2 m at every Master).
		float nFloor = 16.0 * max( uHeightScale, 0.05 );
		vec2 nCell = vec2( vNW.x / 2.6, vNW.y / nFloor );
		vec2 nId = floor( nCell );
		vec2 nF = fract( nCell );
		vec2 nFw = max( fwidth( nCell ), vec2( 1e-4 ) );
		float nShape = ( smoothstep( 0.2 - nFw.x, 0.2 + nFw.x, nF.x ) * ( 1.0 - smoothstep( 0.8 - nFw.x, 0.8 + nFw.x, nF.x ) ) )
			* ( smoothstep( 0.22 - nFw.y, 0.22 + nFw.y, nF.y ) * ( 1.0 - smoothstep( 0.72 - nFw.y, 0.72 + nFw.y, nF.y ) ) );
		// Windows too small to resolve melt into their mean emission (no moire).
		float nRes = 1.0 - smoothstep( 0.22, 0.6, max( nFw.x, nFw.y ) );
		float nCover = mix( 0.22, nShape, nRes );
		float nBh = vNB.x;
		float nBh2 = ngHash11( nBh * 91.7 + 3.1 );
		float nWh = ngHash12( nId + vec2( nBh * 173.1, vNB.y * 7.7 ) );
		float nWh2 = ngHash12( nId.yx * 1.37 + vec2( nBh * 59.3, vNB.y * 3.9 ) );
		// Each building has its own appetite for light; some stand dark.
		float nFrac = clamp( uNightLit * ( 0.2 + 1.6 * nBh2 ), 0.0, 1.0 );
		float nOn = step( nWh, nFrac );
		// Palette without instanceColor: warm tungsten, warm white, a few cool screens.
		vec3 nCol = mix( vec3( 1.0, 0.62, 0.3 ), vec3( 1.0, 0.84, 0.6 ), step( 0.4, nWh2 ) );
		nCol = mix( nCol, vec3( 0.62, 0.78, 1.0 ), step( 0.88, nWh2 ) );
		float nGain = 0.55 + 0.9 * ngHash11( nWh * 37.0 + nBh * 11.0 );
		float nTall = smoothstep( 0.7 * nFloor, 1.1 * nFloor, vNB.w );   // no lit windows on a shed
		// Away from resolved windows the mean fraction stands in for the pattern.
		float nMean = mix( nFrac, nOn, nRes );
		totalEmissiveRadiance += nCol * ( nCover * nMean * nGain * nTall * uNightWinGain * uNightAmt );
	}`);
}

// ── Ground: streetlight glow ─────────────────────────────────────────────────
/**
 * Wrap the terrain material's onBeforeCompile (after applySurfaceTexture has set
 * its chain) with the streetlight term. It reads the road bit the ground shader
 * already samples (surfaceTex.b), so no texture and no geometry are added.
 */
export function installGroundGlow(material, bbox) {
  if (!NIGHT.enabled || !NIGHT.parts.glow || !material) return;
  nightUniforms.uNightSize.value.set(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    if (previous) previous.call(this, shader, renderer);
    shader.uniforms.uNightAmt = nightUniforms.uNightAmt;
    shader.uniforms.uNightGlowGain = nightUniforms.uNightGlowGain;
    shader.uniforms.uNightSize = nightUniforms.uNightSize;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uNightAmt;
uniform float uNightGlowGain;
uniform vec2 uNightSize;
${HASH_GLSL}
float ngNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( ngHash12( i ), ngHash12( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( ngHash12( i + vec2( 0.0, 1.0 ) ), ngHash12( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	if ( uNightAmt > 0.001 && surfaceEnabled > 0.5 ) {
		vec2 nSuv = ( vM25Uv - surfaceBoundsMin ) / ( surfaceBoundsMax - surfaceBoundsMin );
		if ( nSuv.x >= 0.0 && nSuv.x <= 1.0 && nSuv.y >= 0.0 && nSuv.y <= 1.0 ) {
			float nRoad = texture2D( surfaceTex, nSuv ).b;
			// Two cheap taps either side give the lamp light a skirt on the pavement.
			vec2 nPx = vec2( 2.5 / 4096.0 );
			float nHalo = 0.5 * ( texture2D( surfaceTex, nSuv + nPx ).b + texture2D( surfaceTex, nSuv - nPx ).b );
			vec2 nWp = nSuv * uNightSize;           // metres across the map
			// Lamp pools: value noise on a ~34 m cell, melting to its mean when the
			// cells are smaller than a pixel (no shimmer at altitude).
			float nCellFw = max( fwidth( nWp.x ), fwidth( nWp.y ) ) / 34.0;
			float nLampRes = 1.0 - smoothstep( 0.35, 0.9, nCellFw );
			float nLamp = mix( 0.55, 0.12 + 1.6 * smoothstep( 0.45, 0.85, ngNoise( nWp / 34.0 ) ), nLampRes );
			float nG = smoothstep( 0.35, 0.95, nRoad ) * nLamp + 0.3 * nHalo * ( 1.0 - nRoad ) * nLamp;
			vec3 nSodium = vec3( 1.0, 0.6, 0.26 );
			totalEmissiveRadiance += nSodium * ( nG * uNightGlowGain * uNightAmt );
		}
	}`);
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|night-glow`;
  material.needsUpdate = true;
}

// ── Sky: stars ───────────────────────────────────────────────────────────────
const STARS_FRAGMENT_UNIFORMS_ON = /* glsl */`
uniform float uStarWeight;`;

// Called from the sky fragment shader on the display-space unit direction `dd`
// and the on-screen angular size of a pixel `aa` (radians, half a pixel).
const STARS_FRAGMENT_FUNCTION_ON = /* glsl */`
vec3 ngHash33( vec3 p3 ) {
  p3 = fract( p3 * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yxz + 33.33 );
  return fract( ( p3.xxy + p3.yxx ) * p3.zyx );
}
// Hashed star lattice: one jittered star candidate per cell of a 3-D grid over
// the unit sphere. About 490 stars drawn over the sphere, roughly 260 above the
// horizon; a few bright, most dim. No texture, no time term (deterministic).
vec3 nightStars( vec3 dd, float aa ) {
  const float N = 90.0;
  vec3 p = dd * N;
  vec3 cell = floor( p );
  vec3 h = ngHash33( cell );
  if ( h.x > 0.03 ) return vec3( 0.0 );
  vec3 centre = cell + 0.25 + 0.5 * ngHash33( cell + 17.0 );
  // Distance on the sphere, in cell units (1 unit = 1/N rad).
  float d = length( p - centre );
  float px = max( aa * 2.0 * N, 1e-4 );               // one pixel, in cell units
  float rPhys = 0.05 + 0.06 * h.y;
  float r = max( rPhys, 0.8 * px );                    // never thinner than a pixel
  float cover = 1.0 - smoothstep( r - px, r + px, d );
  float dim = min( 1.0, ( rPhys * rPhys ) / ( r * r ) ); // sub-pixel stars dim, not flicker
  float b = h.z * h.z * h.z;
  vec3 tint = mix( vec3( 0.78, 0.88, 1.0 ), vec3( 1.0, 0.9, 0.78 ), step( 0.55, ngHash33( cell + 41.0 ).x ) );
  return tint * ( cover * dim * ( 0.05 + 0.75 * b ) );
}`;

const STARS_FRAGMENT_USE_ON = /* glsl */`
  if ( uStarWeight > 0.001 && dd.y > 0.0 ) {
    // City light thins the sky near the horizon.
    float horizonFade = smoothstep( 0.03, 0.3, dd.y );
    sky += nightStars( dd, aa ) * ( uStarWeight * horizonFade );
  }`;

// Empty strings when the proof is off or the star term is dropped: the sky shader
// is then byte-identical to the shipped one.
const starsOn = NIGHT.enabled && NIGHT.parts.stars;
export const STARS_FRAGMENT_UNIFORMS = starsOn ? STARS_FRAGMENT_UNIFORMS_ON : '';
export const STARS_FRAGMENT_FUNCTION = starsOn ? STARS_FRAGMENT_FUNCTION_ON : '';
export const STARS_FRAGMENT_USE = starsOn ? STARS_FRAGMENT_USE_ON : '';
