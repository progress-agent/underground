// clouds-shadow.js: cloud shadows across the whole city (sprint 25Sep26f, Lane C).
//
// Two texture reads in every lit material dim the direct sunlight (and a share
// of the sky light) where a cloud stands between the point and the sun. It is
// not a shadow map: the cloud
// field's coverage grid (clouds-field.js), shifted by the wind drift, is
// looked up where the sun ray from the shaded point meets the cloud plane.
// So it covers the entire map, keeps working above 2.4 km where the building
// shadows switch off, and every shadow belongs to a cloud that is drawn.
//
// HOW IT REACHES EVERY MATERIAL WITHOUT TOUCHING THEM. The built-in lit
// shaders (standard, physical, lambert, phong, toon) are patched once, at
// import, before anything compiles:
//   - lights_pars_begin gains the uniforms and ugCloudSunFactor();
//   - lights_fragment_begin evaluates it once per fragment and multiplies the
//     FIRST directional light (the sun: shadow-casting lights sort first, and
//     the sun is also added to the scene before the underground fill light);
//   - lights_fragment_end takes a share of the same shade off the indirect
//     diffuse light. Under a real cumulus the ground loses the direct sun AND
//     the bright sky around it; here the ambient and hemisphere lights stand in
//     for much of the daylight on flat ground (at Master 1.1 the displayed sun
//     is only about 7 degrees up, so direct light on flat ground is small and
//     a direct-only shade barely showed: measured on the first build).
// The uniforms are added to those ShaderLib entries. three clones ShaderLib
// uniforms per material (UniformsUtils.clone); the Matrix4 and Texture values
// here override clone() to return themselves, so every material holds the
// SAME objects and one write per frame reaches them all. A material that does
// not get the uniforms (a custom ShaderMaterial that includes these chunks)
// reads zeros, and a zero strength returns 1.0 before anything is sampled.
//
// UNDERGROUND AND UNDERWATER: the strength carries sun.js's air weight, so it
// is exactly 0 for any camera below the surface or in the river and the
// shader returns before sampling (no cost, byte-identical lighting).
//
// GEOMETRY. vViewPosition is the fragment in view space. The camera's display
// matrixWorld (vertical-scale.js) maps it back to CANONICAL world space. The
// sun ray from a point at canonical height y meets the cloud plane (canonical
// planeY) after a horizontal run of (planeY - y) * sun.xz / sun.y. Master
// scales both the heights and the sun's displayed elevation by the same ratio,
// so the ratio cancels: the shadow lands where the displayed cloud, lit by the
// displayed sun, throws it, at every Master height.

import * as THREE from 'three';

const selfClone = o => { o.clone = function () { return this; }; return o; };

/**
 * Packed parameters (Matrix4 elements, column-major; GLSL ugCloudA[col][row]):
 *   col 0: drift.x, drift.z, field originX, field originZ
 *   col 1: field size, edge minX, edge minZ, edge size
 *   col 2: sun.x, sun.y, sun.z (canonical, towards the sun), strength
 *   col 3: cloud plane (canonical y), sky-light share, 0, 0
 */
export const cloudShadowParams = selfClone(new THREE.Matrix4().set(
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
/** The viewing camera's display matrixWorld (inverse of its view matrix). */
export const cloudShadowCamera = selfClone(new THREE.Matrix4());

function makeTexture(data, size, wrap) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = wrap;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return selfClone(tex);
}

/** Coverage in field space (wraps), and the world-fixed edge fade (clamps). */
export const cloudCoverTexture = makeTexture(new Uint8Array(4), 2, THREE.RepeatWrapping);
export const cloudEdgeTexture = makeTexture(new Uint8Array(4), 2, THREE.ClampToEdgeWrapping);

function fill(tex, grid, size) {
  const bytes = new Uint8Array(size * size);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, grid[i])) * 255);
  // A resize needs fresh GPU storage (three allocates immutable storage once).
  tex.dispose();
  tex.image = { data: bytes, width: size, height: size };
  tex.needsUpdate = true;
}

/** Load a layout's grids into the shared textures (once, at boot). */
export function setCloudShadowLayout(layout, field) {
  fill(cloudCoverTexture, layout.cover, layout.coverSize);
  fill(cloudEdgeTexture, layout.edge.fade, layout.edge.size);
  const e = cloudShadowParams.elements;
  e[2] = field.originX; e[3] = field.originZ;
  e[4] = field.size;
  e[5] = field.originX; e[6] = field.originZ; e[7] = field.size;
}

/** Per frame: drift, sun direction (canonical, towards the sun), strength, plane, camera. */
export function updateCloudShadow({ drift, sunDir, strength, planeY, skyShare = 0, camera }) {
  const e = cloudShadowParams.elements;
  e[0] = drift.x; e[1] = drift.z;
  e[8] = sunDir.x; e[9] = sunDir.y; e[10] = sunDir.z;
  e[11] = strength > 0 ? strength : 0;
  e[12] = planeY;
  e[13] = skyShare;
  if (camera) cloudShadowCamera.copy(camera.matrixWorld);
}

export const CLOUD_SHADOW_GLSL = /* glsl */`
uniform sampler2D ugCloudCover;
uniform sampler2D ugCloudEdge;
uniform mat4 ugCloudA;
uniform mat4 ugCloudCam;
float ugCloudSunFactor( vec3 viewPos ) {
	float strength = ugCloudA[ 2 ].w;
	if ( strength <= 0.0 ) return 1.0;
	vec3 w = ( ugCloudCam * vec4( viewPos, 1.0 ) ).xyz;
	float planeY = ugCloudA[ 3 ].x;
	if ( w.y >= planeY ) return 1.0;
	vec3 sunDir = ugCloudA[ 2 ].xyz;
	vec2 p = w.xz + sunDir.xz * ( ( planeY - w.y ) / max( sunDir.y, 0.05 ) );
	vec2 uvC = ( p - ugCloudA[ 0 ].xy - ugCloudA[ 0 ].zw ) / ugCloudA[ 1 ].x;
	vec2 uvE = ( p - ugCloudA[ 1 ].yz ) / ugCloudA[ 1 ].w;
	float cover = texture2D( ugCloudCover, uvC ).r;
	float edge = texture2D( ugCloudEdge, uvE ).r;
	return 1.0 - strength * cover * edge;
}
`;

const PARS_ANCHOR = 'uniform bool receiveShadow;';
const BEGIN_ANCHOR = 'vec3 geometryPosition = - vViewPosition;';
const DIR_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
const END_ANCHOR = '#if defined( RE_IndirectSpecular )';
const SHADER_IDS = ['standard', 'physical', 'lambert', 'phong', 'toon'];
let _patched = null;

/**
 * Patch the lit chunks and ShaderLib uniforms. Idempotent. Returns false (and
 * cloud shadows stay off, nothing else changes) if an anchor is missing.
 */
export function patchCloudShadowChunks() {
  if (_patched !== null) return _patched;
  const C = THREE.ShaderChunk;
  const pars = C.lights_pars_begin, begin = C.lights_fragment_begin, end = C.lights_fragment_end;
  const once = (s, a) => typeof s === 'string' && s.split(a).length === 2;
  if (!once(pars, PARS_ANCHOR) || !once(begin, BEGIN_ANCHOR) || !once(begin, DIR_ANCHOR) || !once(end, END_ANCHOR)) {
    console.error('[clouds] lights chunk anchors not found; cloud shadows disabled');
    _patched = false;
    return false;
  }
  C.lights_pars_begin = pars.replace(PARS_ANCHOR, `${PARS_ANCHOR}\n${CLOUD_SHADOW_GLSL}`);
  C.lights_fragment_begin = begin
    .replace(BEGIN_ANCHOR, `${BEGIN_ANCHOR}\nfloat ugCloudSun = ugCloudSunFactor( geometryPosition );`)
    .replace(DIR_ANCHOR, `${DIR_ANCHOR}\n\t\tif ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= ugCloudSun;`);
  C.lights_fragment_end = end.replace(END_ANCHOR,
    `reflectedLight.indirectDiffuse *= mix( 1.0, ugCloudSun, ugCloudA[ 3 ].y );\n${END_ANCHOR}`);
  for (const id of SHADER_IDS) {
    const u = THREE.ShaderLib[id]?.uniforms;
    if (!u) continue;
    u.ugCloudCover = { value: cloudCoverTexture };
    u.ugCloudEdge = { value: cloudEdgeTexture };
    u.ugCloudA = { value: cloudShadowParams };
    u.ugCloudCam = { value: cloudShadowCamera };
  }
  _patched = true;
  return true;
}
patchCloudShadowChunks();
