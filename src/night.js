// Procedural night emission, adapted from the measured October proof. No real lamps.
import * as THREE from 'three';
export const nightUniforms = {
 uNightAmt: {value:0}, uNightLit:{value:0.55}, uNightWinGain:{value:1.0},
 uNightGlowGain:{value:0.3}, uNightSize:{value:new THREE.Vector2(1,1)},
 uWindowBlend:{value:1.7},
};
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
const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const K = { sun: luminance(new THREE.Color(0xfff4e6)) / (12 * luminance(C.sun)), ambient: 0.16, hemi: 0.2 };

export function applyNightToSunState(state) {
  if (!state) return;
  const n = state.night ?? 0;
  if (!n) return;
  state.direction.lerp(_moonDir, n).normalize();
  state.elevationDeg = Math.asin(THREE.MathUtils.clamp(state.direction.y, -1, 1)) * 180 / Math.PI;
  state.azimuthDeg = (Math.atan2(state.direction.x, -state.direction.z) * 180 / Math.PI + 360) % 360;
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
const MOON_DISC = new THREE.Color(1.05, 1.08, 1.2);
const MOON_AUREOLE = new THREE.Color(0.45, 0.55, 0.9);
export function applyNightToSkyParams(p, n = 0) {
  if (!n) return;
  const k = 1 - 0.985 * n;
  p.illum.multiplyScalar(k).lerp(NIGHT_ILLUM, n);
  p.ambient.multiplyScalar(k).lerp(NIGHT_AMBIENT, n);
  p.horizonGlow = THREE.MathUtils.lerp(p.horizonGlow, 0.9, n);
  p.horizonGlowPow = THREE.MathUtils.lerp(p.horizonGlowPow, 0.35, n);   // city glow all round the horizon
  // Moon disc: cool white, only just over the bloom threshold, with a small halo.
  p.discColor.lerp(MOON_DISC, n);
  p.aureoleColor.lerp(MOON_AUREOLE, n);
  p.aureoleCore *= (1 - 0.8 * n);
  p.aureoleSkirt *= (1 - 0.85 * n);
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
  shader.uniforms.uWindowBlend = nightUniforms.uWindowBlend;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vNW;      // wall coordinate across (m), up (local units), wall flag
varying vec3 vNB;      // building hash, face id, height (local units)
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
		vNB = vec3( nBh, sign( normal.x ) + 2.0 * sign( normal.z ) + 4.0 * nAcrossX, nInst.y * uHeightScale );
	}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uNightAmt;
uniform float uNightLit;
uniform float uNightWinGain;
uniform float uWindowBlend;
uniform float uHeightScale;
varying vec3 vNW;
varying vec3 vNB;
${HASH_GLSL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	vec2 nCell = vec2( vNW.x / 2.6, vNW.y / (16.0 * max( uHeightScale, 0.05 )) );
 vec2 nFw = max( fwidth( nCell ), vec2( 1e-4 ) ) * uWindowBlend;
 if ( uNightAmt > 0.001 && vNW.z > 0.5 ) {
		// Bay 2.6 m wide, floor 3.2 m (canonical VE5 units x uHeightScale, which is
		// 1 / Master: a floor is a true 3.2 m at every Master).
		float nFloor = 16.0 * max( uHeightScale, 0.05 );

		vec2 nId = floor( nCell );
		vec2 nF = fract( nCell );

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
		float nFrac = clamp( uNightLit * ( 0.2 + 1.6 * nBh2 ), 0.0, 1.0 ) * step( 0.12, nBh2 );
		float floorOn = step(0.12, ngHash12(vec2(nId.y, nBh * 91.0)));
 float nOn = step( nWh, nFrac ) * floorOn;
 nFrac *= 0.88;
		// Palette without instanceColor: warm tungsten, warm white, a few cool screens.
		vec3 nCol = mix( vec3( 1.0, 0.62, 0.3 ), vec3( 1.0, 0.84, 0.6 ), step( 0.4, nWh2 ) );
		nCol = mix( nCol, vec3( 0.62, 0.78, 1.0 ), step( 0.88, nWh2 ) );
		float nGain = 0.55 + 0.9 * ngHash11( nWh * 37.0 + nBh * 11.0 );
		float nTall = smoothstep( 0.7 * nFloor, 1.1 * nFloor, vNB.z );   // no lit windows on a shed
		// Away from resolved windows the mean fraction stands in for the pattern.
		float nMean = mix( nFrac, nOn, nRes );
		vec3 emission = mix(vec3(1.0, 0.73, 0.46) * 0.22 * nFrac, nCol * nCover * nMean * nGain, nRes);
 totalEmissiveRadiance += emission * ( nTall * uNightWinGain * uNightAmt );
	}`);
}

// ── Ground: streetlight glow ─────────────────────────────────────────────────
/**
 * Wrap the terrain material's onBeforeCompile (after applySurfaceTexture has set
 * its chain) with the streetlight term. It reads the road bit the ground shader
 * already samples (surfaceTex.b), so no texture and no geometry are added.
 */
export function installGroundGlow(material, bbox) {
  if (!material) return;
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
	vec2 nWp0 = ( vM25Uv - surfaceBoundsMin ) / ( surfaceBoundsMax - surfaceBoundsMin ) * uNightSize;
 float nCellFw = max( fwidth( nWp0.x ), fwidth( nWp0.y ) ) / 34.0;
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
