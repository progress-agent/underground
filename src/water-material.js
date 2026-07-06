import * as THREE from 'three';
import { generateWaterNormalMap } from './textures.js';

const DEFAULTS = {
  baseColor: '#061725',
  opacity: 0.58,
  roughness: 0.16,
  metalness: 0.02,
  emissive: '#020a12',
  emissiveIntensity: 0.08,
  fresnelTint: '#8fb4c1',
  fresnelStrength: 0.34,
  fresnelPower: 3.2,
  normalStrength: 0.105,
  normalBlend: 0.86,
  scrollScaleA: 560.0,
  scrollSpeedA: [0.018, 0.006],
  scrollScaleB: 155.0,
  scrollSpeedB: [-0.009, 0.013],
  depthTintStrength: 0.22,
  depthTintNearM: 2.0,
  depthTintFarM: 11.0,
  edgeFadeStrength: 0.30,
  edgeDarkenStrength: 0.15,
};

const PRESETS = {
  thames: {},
  reservoir: {
    opacity: 0.52,
    roughness: 0.13,
    fresnelStrength: 0.24,
    fresnelPower: 3.8,
    normalStrength: 0.035,
    normalBlend: 0.42,
    scrollScaleA: 780.0,
    scrollSpeedA: [0.004, 0.002],
    scrollScaleB: 260.0,
    scrollSpeedB: [-0.002, 0.003],
    depthTintStrength: 0.05,
    edgeFadeStrength: 0.20,
    edgeDarkenStrength: 0.08,
  },
  canal: {
    opacity: 0.54,
    roughness: 0.18,
    fresnelStrength: 0.20,
    fresnelPower: 3.7,
    normalStrength: 0.045,
    normalBlend: 0.50,
    scrollScaleA: 420.0,
    scrollSpeedA: [0.006, 0.002],
    scrollScaleB: 180.0,
    scrollSpeedB: [-0.003, 0.004],
    depthTintStrength: 0.04,
    edgeFadeStrength: 0.26,
    edgeDarkenStrength: 0.10,
  },
};

const WATER_MATERIALS = new Set();
let waterNormalMap = null;
let elapsed = 0;

export const waterParams = { ...DEFAULTS };

function normaliseValue(key, value) {
  if (key === 'fresnelTint' || key === 'baseColor' || key === 'emissive') return value;
  if (key === 'scrollSpeedA' || key === 'scrollSpeedB') return Array.isArray(value) ? value : [value.x, value.y];
  return Number(value);
}

function setUniform(uniforms, key, value) {
  if (!uniforms) return;
  if (key === 'fresnelTint') uniforms.uFresnelTint.value.set(value);
  else if (key === 'scrollSpeedA') uniforms.uScrollSpeedA.value.set(value[0], value[1]);
  else if (key === 'scrollSpeedB') uniforms.uScrollSpeedB.value.set(value[0], value[1]);
  else if (key === 'scrollScaleA') uniforms.uScrollScaleA.value = value;
  else if (key === 'scrollScaleB') uniforms.uScrollScaleB.value = value;
  else if (key === 'fresnelStrength') uniforms.uFresnelStrength.value = value;
  else if (key === 'fresnelPower') uniforms.uFresnelPower.value = value;
  else if (key === 'normalStrength') uniforms.uNormalStrength.value = value;
  else if (key === 'normalBlend') uniforms.uNormalBlend.value = value;
  else if (key === 'depthTintStrength') uniforms.uDepthTintStrength.value = value;
  else if (key === 'depthTintNearM') uniforms.uDepthTintNearM.value = value;
  else if (key === 'depthTintFarM') uniforms.uDepthTintFarM.value = value;
  else if (key === 'edgeFadeStrength') uniforms.uEdgeFadeStrength.value = value;
  else if (key === 'edgeDarkenStrength') uniforms.uEdgeDarkenStrength.value = value;
}

function applyMaterialParam(material, key, value) {
  if (key === 'baseColor') material.color.set(value);
  else if (key === 'opacity') material.opacity = value;
  else if (key === 'roughness') material.roughness = value;
  else if (key === 'metalness') material.metalness = value;
  else if (key === 'emissive') material.emissive.set(value);
  else if (key === 'emissiveIntensity') material.emissiveIntensity = value;
  setUniform(material.userData.waterUniforms, key, value);
  material.needsUpdate = key === 'baseColor' || key === 'emissive';
}

export function setWaterParams(next = {}) {
  for (const [key, raw] of Object.entries(next)) {
    if (!(key in waterParams)) continue;
    const value = normaliseValue(key, raw);
    waterParams[key] = value;
    for (const material of WATER_MATERIALS) applyMaterialParam(material, key, value);
  }
}

export function updateWater(dt) {
  elapsed += dt;
  for (const material of WATER_MATERIALS) {
    const uniforms = material.userData.waterUniforms;
    if (uniforms) uniforms.uTime.value = elapsed;
  }
}

export function getWaterTuningSurface() {
  return {
    params: waterParams,
    setWaterParams,
    presets: PRESETS,
    materials: WATER_MATERIALS,
  };
}

function getWaterNormalMap() {
  if (!waterNormalMap) waterNormalMap = generateWaterNormalMap();
  return waterNormalMap;
}

export function createWaterMaterial(kind = 'thames', overrides = {}) {
  const params = { ...DEFAULTS, ...(PRESETS[kind] || {}), ...overrides };
  const material = new THREE.MeshStandardMaterial({
    color: params.baseColor,
    transparent: true,
    opacity: params.opacity,
    roughness: params.roughness,
    metalness: params.metalness,
    emissive: params.emissive,
    emissiveIntensity: params.emissiveIntensity,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });

  material.userData.waterKind = kind;
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previousCompile) previousCompile(shader, renderer);

    shader.uniforms.uWaterNormalMap = { value: getWaterNormalMap() };
    shader.uniforms.uTime = { value: elapsed };
    shader.uniforms.uFresnelTint = { value: new THREE.Color(params.fresnelTint) };
    shader.uniforms.uFresnelStrength = { value: params.fresnelStrength };
    shader.uniforms.uFresnelPower = { value: params.fresnelPower };
    shader.uniforms.uNormalStrength = { value: params.normalStrength };
    shader.uniforms.uNormalBlend = { value: params.normalBlend };
    shader.uniforms.uScrollScaleA = { value: params.scrollScaleA };
    shader.uniforms.uScrollSpeedA = { value: new THREE.Vector2(...params.scrollSpeedA) };
    shader.uniforms.uScrollScaleB = { value: params.scrollScaleB };
    shader.uniforms.uScrollSpeedB = { value: new THREE.Vector2(...params.scrollSpeedB) };
    shader.uniforms.uDepthTintStrength = { value: params.depthTintStrength };
    shader.uniforms.uDepthTintNearM = { value: params.depthTintNearM };
    shader.uniforms.uDepthTintFarM = { value: params.depthTintFarM };
    shader.uniforms.uEdgeFadeStrength = { value: params.edgeFadeStrength };
    shader.uniforms.uEdgeDarkenStrength = { value: params.edgeDarkenStrength };
    material.userData.waterUniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `attribute float waterDepth;
attribute float waterEdge;
varying vec3 vWaterWorldPosition;
varying vec3 vWaterWorldNormal;
varying float vWaterDepth;
varying float vWaterEdge;
varying float vWaterUpness;
void main() {`
    ).replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
  vWaterWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
  vWaterUpness = clamp( vWaterWorldNormal.y, 0.0, 1.0 );`
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vec4 waterWorldPosition = modelMatrix * vec4( transformed, 1.0 );
  vWaterWorldPosition = waterWorldPosition.xyz;
  vWaterDepth = waterDepth;
  vWaterEdge = waterEdge;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform sampler2D uWaterNormalMap;
uniform float uTime;
uniform vec3 uFresnelTint;
uniform float uFresnelStrength;
uniform float uFresnelPower;
uniform float uNormalStrength;
uniform float uNormalBlend;
uniform float uScrollScaleA;
uniform vec2 uScrollSpeedA;
uniform float uScrollScaleB;
uniform vec2 uScrollSpeedB;
uniform float uDepthTintStrength;
uniform float uDepthTintNearM;
uniform float uDepthTintFarM;
uniform float uEdgeFadeStrength;
uniform float uEdgeDarkenStrength;
varying vec3 vWaterWorldPosition;
varying vec3 vWaterWorldNormal;
varying float vWaterDepth;
varying float vWaterEdge;
varying float vWaterUpness;
void main() {`
    ).replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  vec2 waterUvA = vWaterWorldPosition.xz / uScrollScaleA + uTime * uScrollSpeedA;
  vec2 waterUvB = vWaterWorldPosition.xz / uScrollScaleB + uTime * uScrollSpeedB;
  vec3 waterNormalA = texture2D( uWaterNormalMap, waterUvA ).xyz * 2.0 - 1.0;
  vec3 waterNormalB = texture2D( uWaterNormalMap, waterUvB ).xyz * 2.0 - 1.0;
  vec2 waterRipple = (waterNormalA.xy * 0.62 + waterNormalB.xy * 0.38) * uNormalStrength;
  vec3 waterViewX = normalize( ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
  vec3 waterViewY = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vec3 waterViewZ = normalize( ( viewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz );
  vec3 waterRippleNormal = normalize( waterViewX * waterRipple.x + waterViewZ * waterRipple.y + waterViewY );
  normal = normalize( mix( normal, waterRippleNormal, uNormalBlend * vWaterUpness ) );`
    ).replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
  float depthTint = smoothstep( uDepthTintNearM, uDepthTintFarM, vWaterDepth ) * uDepthTintStrength;
  gl_FragColor.rgb *= 1.0 - depthTint;
  vec3 waterViewDir = normalize( cameraPosition - vWaterWorldPosition );
  float waterFresnel = pow( 1.0 - clamp( dot( normalize( vWaterWorldNormal ), waterViewDir ), 0.0, 1.0 ), uFresnelPower );
  waterFresnel *= uFresnelStrength * ( 0.30 + 0.70 * vWaterUpness );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uFresnelTint, waterFresnel );
  float shoreline = smoothstep( 0.82, 1.0, abs( vWaterEdge ) ) * vWaterUpness;
  gl_FragColor.rgb *= 1.0 - shoreline * uEdgeDarkenStrength;
  gl_FragColor.a *= 1.0 - shoreline * uEdgeFadeStrength;`
    );
  };

  WATER_MATERIALS.add(material);
  return material;
}
