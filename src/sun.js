// sun.js: time-of-day sun and near-camera shadows (sprint 23Sep26w, Lane D, D-037).
//
// One slider, labelled Dawn at one end and Dusk at the other, moves the sun
// along a representative London sun path. It changes the sun's angle, colour
// and strength, the cool ambient fill, the street-level sky bounce, the sky
// tint and the air haze. It is lighting only: nothing here reads or drives
// simulation time, so traffic, trains and planes are untouched.
//
// THE AIR SUBSTRATE ONLY. Every slider effect is multiplied by an air weight
// that is exactly 0 for any camera below the local surface or inside the river
// (see airWeightFor). environment.js blends the legacy lighting toward the
// slider's lighting by that weight, so an underground or submerged camera sees
// byte-identical lights, fog and clear colour whatever the slider says, and
// shadows are switched off there (strength 0, no shadow-map render).
//
// THE DEFAULT IS TODAY'S LOOK. Before this lane the sun was a fixed light at
// (2000, 600, 1500): azimuth 126.9 degrees (south-east), elevation 13.5 degrees.
// That direction lies within 0.4 degrees of the real London sun path at solar
// declination -10 degrees (late October or mid February), at about 08:30
// solar time. So the path uses that declination, the default slider position
// is that morning moment, a small correction (fading to zero by noon) lands
// the default exactly on the legacy vector, and the quality keyframes pass
// through the legacy colour and strengths at the legacy elevation. A fresh
// visit therefore lights exactly as before; shadows are the only new default.
//
// NO NIGHT. Both ends of the slider stop with the sun 1.5 degrees above the
// horizon: long, low, warm light, never darkness.
//
// SHADOWS. A single fitted directional shadow (not cascades), 2048 texels over
// a 3km square around the camera's ground point, aligned to the sun's azimuth
// so the map is spent on that square and nowhere else. The square is snapped
// to whole texels in light space so it does not shimmer as the camera moves.
// Shadows fade out towards the square's edges and with altitude, are drawn
// only by buildings, landmarks, bridges and airport architecture, and are
// received by those plus the terrain, the Overground, the M25 and airfields.
// Underground layers never take part. The toggle defaults ON and persists.
// Automatic quality drops shadows before anything else (adaptive-quality.js
// level 1 is level 0 without shadows).
//
// Switching shadows off, by toggle, by the Automatic ladder, by altitude or by
// going underground, never recompiles a shader: the map simply stops being
// rendered and a per-light strength (carried in the shadow radius uniform,
// which PCFSoftShadowMap does not otherwise read) makes the shader return
// "fully lit" before it samples anything. See patchShadowChunk.

import * as THREE from 'three';
import { getBuildingMaterial, getBuildingHeightScale } from './surface-geometry.js';
import { setAirSun, resolveSunDirection, LEGACY_SUN_POSITION } from './environment.js';

const DEG = Math.PI / 180;

export const SUN_CONFIG = {
  latitudeDeg: 51.5074,     // scene origin, Trafalgar Square
  declinationDeg: -10,      // the day whose path passes through the legacy sun
  minElevationDeg: 1.5,     // both slider ends: just above the horizon, never night
  // Air weight ramps over the first 12 scene units (2.4 real metres) above the
  // local surface. Below the surface it is exactly zero.
  airRamp: 12,
  // Shadow coverage: half-width of the fitted square, in scene units (metres
  // horizontally). 1500 gives the 3km near-camera square.
  shadowHalfExtent: 1500,
  shadowMapSize: 2048,
  // How far ahead of the camera, along its horizontal view direction, the
  // square is centred (fraction of the half extent): more shadow where you look.
  shadowLead: 0.5,
  // Vertical range the fit must enclose, relative to the ground under the
  // camera (canonical VE5 scene units): the tallest structures reach ~1700.
  shadowBelow: 600,
  shadowAbove: 2200,
  // Casters up to this far towards the sun outside the square still land their
  // shadows in it (a low sun throws a 100m tower's shadow ~4km).
  shadowUpsunReach: 5000,
  // Shadow strength fades with camera height above the ground (scene units):
  // full to 4000 (800m real), gone by 12000 (2.4km real). The overview has none.
  shadowAltitudeFull: 4000,
  shadowAltitudeNone: 12000,
  shadowBias: -0.0001,
  // Shadow darkness at full strength (the shadowed fraction of direct sun).
  shadowStrength: 1,
};

// ── Sun path ──────────────────────────────────────────────────────────────────

const _lat = SUN_CONFIG.latitudeDeg * DEG;
const _dec = SUN_CONFIG.declinationDeg * DEG;
// Hour angle at which the sun stands at minElevation: the slider's two ends.
const _hourLimit = Math.acos(
  (Math.sin(SUN_CONFIG.minElevationDeg * DEG) - Math.sin(_lat) * Math.sin(_dec)) /
  (Math.cos(_lat) * Math.cos(_dec)),
);

/**
 * Uncorrected sun direction on the London path, as a unit vector pointing
 * FROM the ground TOWARDS the sun, in scene axes (x east, y up, z south).
 * t = 0 is dawn, 1 is dusk, 0.5 is solar noon.
 */
export function pathDirection(t, out = new THREE.Vector3()) {
  const h = (THREE.MathUtils.clamp(t, 0, 1) * 2 - 1) * _hourLimit;
  // Horizontal (east, north, up) components of the solar vector.
  const east = -Math.cos(_dec) * Math.sin(h);
  const north = Math.cos(_lat) * Math.sin(_dec) - Math.sin(_lat) * Math.cos(_dec) * Math.cos(h);
  const up = Math.sin(_lat) * Math.sin(_dec) + Math.cos(_lat) * Math.cos(_dec) * Math.cos(h);
  return out.set(east, up, -north).normalize();
}

export const LEGACY_SUN_DIRECTION = new THREE.Vector3(...LEGACY_SUN_POSITION).normalize();
export const LEGACY_ELEVATION_DEG = Math.asin(LEGACY_SUN_DIRECTION.y) / DEG;

// Default slider position: the path point nearest the legacy sun (golden
// section search on the morning half; the angle is unimodal there).
export const DEFAULT_SUN_TIME = (() => {
  const v = new THREE.Vector3();
  const cost = t => pathDirection(t, v).angleTo(LEGACY_SUN_DIRECTION);
  let a = 0, b = 0.5;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (cost(c) < cost(d)) b = d; else a = c;
  }
  return (a + b) / 2;
})();
const _legacyCorrection = LEGACY_SUN_DIRECTION.clone().sub(pathDirection(DEFAULT_SUN_TIME));
export const PATH_RESIDUAL_DEG = pathDirection(DEFAULT_SUN_TIME).angleTo(LEGACY_SUN_DIRECTION) / DEG;

/**
 * Sun direction for slider position t, with the legacy correction applied:
 * full at the default, ramping to zero at dawn and by solar noon, zero after.
 */
export function sunDirection(t, out = new THREE.Vector3()) {
  t = THREE.MathUtils.clamp(Number.isFinite(t) ? t : DEFAULT_SUN_TIME, 0, 1);
  if (t === DEFAULT_SUN_TIME) return out.copy(LEGACY_SUN_DIRECTION);
  pathDirection(t, out);
  const w = t <= DEFAULT_SUN_TIME
    ? t / DEFAULT_SUN_TIME
    : Math.max(0, 1 - (t - DEFAULT_SUN_TIME) / (0.5 - DEFAULT_SUN_TIME));
  return out.addScaledVector(_legacyCorrection, w).normalize();
}

// ── Quality of light ─────────────────────────────────────────────────────────
// Keyframed on solar ELEVATION (degrees), which is what actually sets the
// colour and strength of daylight, with a separate warmer, rosier low end for
// the evening. The legacy elevation key reproduces today's values exactly.

const NOON_ELEVATION_DEG = Math.asin(pathDirection(0.5).y) / DEG;
const ELEVATION_KEYS = [SUN_CONFIG.minElevationDeg, 6, LEGACY_ELEVATION_DEG, NOON_ELEVATION_DEG];

// Colours are sRGB hex, converted to linear once (THREE.Color handles it).
const QUALITY = {
  sunColorMorning: [0xff9f5a, 0xffc88a, 0xfff4e6, 0xfffaf2],
  sunColorEvening: [0xff7c48, 0xffb277, 0xfff4e6, 0xfffaf2],
  // Sun against fill: a low sun is weak and the sky does most of the lighting;
  // a high sun dominates, so its shadows read. Legacy (1, 1, 1) at 13.5 deg.
  sunFactor: [0.55, 0.8, 1, 1.8],
  ambientFactor: [0.8, 0.9, 1, 0.65],
  hemiFactor: [0.9, 0.95, 1, 0.65],
  ambientColor: [0xc9cdf2, 0xe4e5f7, 0xffffff, 0xffffff],
  hemiSkyMorning: [0xffc497, 0xffd9b0, 0xffe9c8, 0xfff1dd],
  hemiSkyEvening: [0xffb48f, 0xffd0a8, 0xffe9c8, 0xfff1dd],
  // Clear colour (the visible sky above the horizon) and the air haze.
  skyMorning: [0x8c8a94, 0x7a8796, 0x5a7a8f, 0x5b82a0],
  skyEvening: [0x9a8088, 0x81808e, 0x5a7a8f, 0x5b82a0],
  fogMorning: [0x5c5250, 0x4a4c50, 0x3a4a52, 0x3b4d58],
  fogEvening: [0x624a4a, 0x4e484d, 0x3a4a52, 0x3b4d58],
};
const QUALITY_COLORS = Object.fromEntries(Object.entries(QUALITY)
  .filter(([name]) => !name.endsWith('Factor'))
  .map(([name, keys]) => [name, keys.map(hex => new THREE.Color(hex))]));

function keyed(e) {
  const k = ELEVATION_KEYS;
  if (e <= k[0]) return [0, 0];
  for (let i = 1; i < k.length; i++) {
    if (e <= k[i]) return [i - 1, (e - k[i - 1]) / (k[i] - k[i - 1])];
  }
  return [k.length - 2, 1];
}
function sampleNumber(keys, [i, f]) { return keys[i] + (keys[i + 1] - keys[i]) * f; }
function sampleColor(keys, [i, f], out) { return out.copy(keys[i]).lerp(keys[i + 1], f); }

const _tmpA = new THREE.Color(), _tmpB = new THREE.Color();
function sampleDayColor(morning, evening, at, evening01, out) {
  sampleColor(QUALITY_COLORS[morning], at, _tmpA);
  sampleColor(QUALITY_COLORS[evening], at, _tmpB);
  return out.copy(_tmpA).lerp(_tmpB, evening01);
}

/**
 * Complete lighting state for slider position t. Pure: same t, same state.
 * Colours are THREE.Color (linear working space), factors multiply the legacy
 * intensities in environment.js.
 */
export function sunState(t, out = createSunState()) {
  t = THREE.MathUtils.clamp(Number.isFinite(t) ? t : DEFAULT_SUN_TIME, 0, 1);
  out.t = t;
  sunDirection(t, out.direction);
  out.elevationDeg = Math.asin(THREE.MathUtils.clamp(out.direction.y, -1, 1)) / DEG;
  // Compass azimuth, clockwise from north (x east, z south).
  out.azimuthDeg = (Math.atan2(out.direction.x, -out.direction.z) / DEG + 360) % 360;
  const at = t === DEFAULT_SUN_TIME ? [1, 1] : keyed(out.elevationDeg);
  const evening01 = THREE.MathUtils.smoothstep(t, 0.35, 0.65);
  sampleDayColor('sunColorMorning', 'sunColorEvening', at, evening01, out.sunColor);
  out.sunFactor = sampleNumber(QUALITY.sunFactor, at);
  out.ambientFactor = sampleNumber(QUALITY.ambientFactor, at);
  out.hemiFactor = sampleNumber(QUALITY.hemiFactor, at);
  sampleColor(QUALITY_COLORS.ambientColor, at, out.ambientColor);
  sampleDayColor('hemiSkyMorning', 'hemiSkyEvening', at, evening01, out.hemiSky);
  sampleDayColor('skyMorning', 'skyEvening', at, evening01, out.skyColor);
  sampleDayColor('fogMorning', 'fogEvening', at, evening01, out.fogSky);
  return out;
}

export function createSunState() {
  return {
    t: DEFAULT_SUN_TIME, direction: new THREE.Vector3(), elevationDeg: 0, azimuthDeg: 0,
    sunColor: new THREE.Color(), sunFactor: 1, ambientFactor: 1, hemiFactor: 1, ambientColor: new THREE.Color(),
    hemiSky: new THREE.Color(), skyColor: new THREE.Color(), fogSky: new THREE.Color(),
  };
}

/** Human phase name for a slider position (aria-valuetext). */
export function sunPhaseLabel(t) {
  if (t < 0.06) return 'Dawn';
  if (t < 0.3) return 'Morning';
  if (t < 0.42) return 'Late morning';
  if (t <= 0.58) return 'Midday';
  if (t <= 0.7) return 'Early afternoon';
  if (t <= 0.94) return 'Afternoon';
  return 'Dusk';
}

// ── Air weight ───────────────────────────────────────────────────────────────

/**
 * How much of the slider applies: 1 in open air, exactly 0 for any camera
 * below the local surface (clay, chalk, tunnels) or fully inside the river.
 * heightAboveSurface is camera y minus the local surface y (scene units).
 */
export function airWeightFor({ heightAboveSurface, submergedBlend = 0 }) {
  if (!Number.isFinite(heightAboveSurface) || heightAboveSurface <= 0) return 0;
  const ramp = THREE.MathUtils.smoothstep(heightAboveSurface, 0, SUN_CONFIG.airRamp);
  return ramp * (1 - THREE.MathUtils.clamp(submergedBlend, 0, 1));
}

/** Shadow strength from camera height above the ground (scene units). */
export function shadowAltitudeFade(heightAboveSurface) {
  if (!Number.isFinite(heightAboveSurface)) return 0;
  return 1 - THREE.MathUtils.smoothstep(heightAboveSurface,
    SUN_CONFIG.shadowAltitudeFull, SUN_CONFIG.shadowAltitudeNone);
}

// ── Shadow frustum fit ───────────────────────────────────────────────────────

/**
 * Fit an orthographic shadow camera to the ground square around `focus`,
 * aligned to the sun's azimuth, enclosing groundY-below .. groundY+above.
 * Pure. Returns light-space extents and the world-space target (snapped to
 * whole texels along the light's right/up axes, so the map does not shimmer).
 */
export function fitShadowFrustum({
  focus, groundY, direction,
  halfExtent = SUN_CONFIG.shadowHalfExtent, mapSize = SUN_CONFIG.shadowMapSize,
  below = SUN_CONFIG.shadowBelow, above = SUN_CONFIG.shadowAbove,
  upsunReach = SUN_CONFIG.shadowUpsunReach,
}) {
  const d = direction.clone().normalize();
  // Light basis: camera looks along -d. right is horizontal, up completes it.
  const right = new THREE.Vector3(d.z, 0, -d.x);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();
  // Horizontal sun azimuth axis (towards the sun, on the ground).
  const along = new THREE.Vector3(d.x, 0, d.z);
  if (along.lengthSq() < 1e-10) along.set(0, 0, -1);
  along.normalize();

  const base = new THREE.Vector3(focus.x, groundY, focus.z);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const c = new THREE.Vector3();
  for (const sa of [-1, 1]) for (const sr of [-1, 1]) for (const h of [-below, above]) {
    c.set(0, h, 0).addScaledVector(along, sa * halfExtent).addScaledVector(right, sr * halfExtent);
    const x = c.dot(right), y = c.dot(up), z = c.dot(d);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  // Quantise extents so they only change when the sun or height band does.
  const step = v => Math.ceil(v / 50 - 1e-6) * 50; // tolerate float fuzz
  const halfWidth = step(Math.max(-minX, maxX));
  const halfHeight = step((maxY - minY) / 2);
  const midY = (maxY + minY) / 2;
  const target = base.clone().addScaledVector(up, midY);
  // Texel snap in absolute light space.
  const texelX = (2 * halfWidth) / mapSize, texelY = (2 * halfHeight) / mapSize;
  const sx = target.dot(right), sy = target.dot(up);
  target.addScaledVector(right, Math.round(sx / texelX) * texelX - sx);
  target.addScaledVector(up, Math.round(sy / texelY) * texelY - sy);
  // Camera sits up-sun of the target; the near plane reaches upsunReach
  // beyond the square so tall up-sun casters still land shadows inside it.
  const distance = maxZ + upsunReach;
  const near = 1;
  const far = distance - minZ + 100;
  return { target, distance, halfWidth, halfHeight, near, far, texelX, texelY, right, up };
}

// ── Shader chunk: strength + edge fade, no recompiles ───────────────────────

const SHADOW_SIGNATURE = 'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {';
let _chunkPatched = false;

/**
 * Wrap three's getShadow (r161) so that, under PCFSoftShadowMap, the light's
 * shadowRadius uniform carries a 0..1 strength: 0 returns fully lit before any
 * texture is sampled, and shadows fade out over the outer band of the map.
 * Idempotent. Returns false (and shadows stay off) if the anchor is missing.
 */
export function patchShadowChunk() {
  if (_chunkPatched) return true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (typeof chunk !== 'string' || chunk.split(SHADOW_SIGNATURE).length !== 2) {
    console.error('[sun] shadowmap_pars_fragment anchor not found; shadows disabled');
    return false;
  }
  const params = 'sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord';
  const wrapper = `float getShadowRawUG( ${params} );
	float getShadow( ${params} ) {
	#if defined( SHADOWMAP_TYPE_PCF_SOFT )
		float strengthUG = clamp( shadowRadius, 0.0, 1.0 );
		if ( strengthUG <= 0.0 ) return 1.0;
		vec2 edgeUG = abs( ( shadowCoord.xy / shadowCoord.w ) * 2.0 - 1.0 );
		float fadeUG = 1.0 - smoothstep( 0.72, 0.97, max( edgeUG.x, edgeUG.y ) );
		if ( fadeUG <= 0.0 ) return 1.0;
		return mix( 1.0, getShadowRawUG( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord ), strengthUG * fadeUG );
	#else
		return getShadowRawUG( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );
	#endif
	}
	float getShadowRawUG( ${params} ) {`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(SHADOW_SIGNATURE, wrapper);
  _chunkPatched = true;
  return true;
}
patchShadowChunk();

// ── Building depth material (D-023 height scale in the shadow pass) ─────────

// The building material shrinks each box in its vertex shader (uHeightScale).
// The default depth material would cast shadows from the UNSCALED boxes, so
// building meshes get this twin, driven by the same value every frame.
const buildingDepthHeight = { value: 1 };
export const buildingDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
buildingDepthMaterial.onBeforeCompile = shader => {
  shader.uniforms.uHeightScale = buildingDepthHeight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uHeightScale;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.y *= uHeightScale;');
};
buildingDepthMaterial.customProgramCacheKey = () => 'building-depth-height-scale';

// ── Shadow participation policy ─────────────────────────────────────────────

const CAST_AND_RECEIVE_GROUPS = new Set(['landmarks', 'bridges']);
const RECEIVE_GROUPS = new Set(['overground', 'm25Motorway', 'airports']);

/**
 * Decide castShadow/receiveShadow for one top-level scene child and its
 * subtree. Anything not named here is forced out of the shadow pass: several
 * underground layers (Crossrail, sewers) historically set both flags although
 * no shadow map existed, and they must not start taking part now.
 * Returns the number of objects whose flags changed.
 */
export function applyShadowPolicy(root) {
  let changed = 0;
  const set = (o, cast, receive) => {
    if (!o.isMesh) return;
    if (o.castShadow !== cast || o.receiveShadow !== receive) {
      o.castShadow = cast; o.receiveShadow = receive; changed++;
    }
    const wantsDepth = cast && (o.material === getBuildingMaterial());
    if (wantsDepth && o.customDepthMaterial !== buildingDepthMaterial) o.customDepthMaterial = buildingDepthMaterial;
  };
  const name = root.name || '';
  if (name === 'surfaceGeometry') {
    // Tiles stream in and out here; the landmark models live here too.
    for (const o of root.children) {
      const n = o.name || '';
      if (CAST_AND_RECEIVE_GROUPS.has(n)) { o.traverse(c => set(c, true, true)); continue; }
      const building = n.startsWith('buildings-') || n.startsWith('baked-buildings-');
      set(o, building, building);
    }
  } else if (name === 'terrainMesh') {
    set(root, false, true);
  } else if (CAST_AND_RECEIVE_GROUPS.has(name)) {
    root.traverse(o => set(o, true, true));
  } else if (RECEIVE_GROUPS.has(name)) {
    root.traverse(o => set(o, name === 'airports' && (o.name || '').startsWith('airport-architecture-'), true));
  } else {
    root.traverse(o => set(o, false, false));
  }
  return changed;
}

// ── System ───────────────────────────────────────────────────────────────────

const PREF_TIME = 'sunTime';
const PREF_SHADOWS = 'sunShadows';

/**
 * Wire the sun into the running app. `lights` are environment.js's lights;
 * `prefs`/`savePrefs` are main.js's persisted preference object and writer.
 */
export function createSunSystem({ renderer, scene, lights, prefs = {}, savePrefs = () => {} }) {
  const sun = lights.sun;
  const chunkOk = patchShadowChunk();
  let time = Number.isFinite(prefs[PREF_TIME]) ? THREE.MathUtils.clamp(prefs[PREF_TIME], 0, 1) : DEFAULT_SUN_TIME;
  let shadowsEnabled = prefs[PREF_SHADOWS] !== false;
  const state = sunState(time);

  renderer.shadowMap.enabled = chunkOk;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  sun.castShadow = chunkOk;
  sun.shadow.mapSize.set(SUN_CONFIG.shadowMapSize, SUN_CONFIG.shadowMapSize);
  sun.shadow.bias = SUN_CONFIG.shadowBias;
  sun.shadow.normalBias = 0; // a normal offset would turn any NaN normal into a NaN frame through bloom
  sun.shadow.radius = 0;     // strength, see patchShadowChunk
  if (!sun.target.parent) scene.add(sun.target);

  const listeners = new Set();
  const status = {
    airWeight: 0, strength: 0, active: false, rendered: 0, policyChanges: 0,
    adaptiveShadows: true, altitudeFade: 0, fit: null, chunkPatched: chunkOk,
  };
  const forward = new THREE.Vector3(), focus = new THREE.Vector3(), dir = new THREE.Vector3();
  let frame = 0;

  function notify() { for (const fn of listeners) fn(api); }

  function setTime(t, { persist = true } = {}) {
    const next = THREE.MathUtils.clamp(Number(t), 0, 1);
    if (!Number.isFinite(next)) return time;
    time = next;
    sunState(time, state);
    if (persist) { prefs[PREF_TIME] = time; savePrefs(prefs); }
    notify();
    return time;
  }

  function setShadowsEnabled(on, { persist = true } = {}) {
    shadowsEnabled = !!on;
    if (persist) { prefs[PREF_SHADOWS] = shadowsEnabled; savePrefs(prefs); }
    notify();
    return shadowsEnabled;
  }

  function runPolicy(full) {
    let changes = 0;
    for (const child of scene.children) {
      if (full || child.name === 'surfaceGeometry') changes += applyShadowPolicy(child);
    }
    status.policyChanges += changes;
  }

  /**
   * Per frame, BEFORE environment.js's updateEnvironment/updateLighting.
   * surfaceY: local surface under the camera (null outside the terrain).
   */
  function update({ camera, surfaceY = null, submergedBlend = 0, adaptiveShadows = true }) {
    frame++;
    // Buildings stream in and out, so their tile group is checked every frame;
    // everything else is loaded once and checked twice a second.
    runPolicy(frame % 30 === 1);

    const groundY = Number.isFinite(surfaceY) ? surfaceY : 0;
    const height = camera.position.y - groundY;
    const w = airWeightFor({ heightAboveSurface: height, submergedBlend });
    status.airWeight = w;
    status.adaptiveShadows = !!adaptiveShadows;

    // Shadow square: centred a little ahead of the camera's ground point.
    camera.getWorldDirection(forward);
    forward.y = 0;
    const len = forward.length();
    focus.set(camera.position.x, groundY, camera.position.z);
    if (len > 1e-6) focus.addScaledVector(forward, SUN_CONFIG.shadowLead * SUN_CONFIG.shadowHalfExtent / len);

    setAirSun({ weight: w, state });
    resolveSunDirection(dir);
    const fit = fitShadowFrustum({ focus, groundY, direction: dir });
    status.fit = fit;
    sun.target.position.copy(fit.target);
    sun.target.updateMatrixWorld();
    setAirSun({ weight: w, state, distance: fit.distance });
    const cam = sun.shadow.camera;
    if (cam.left !== -fit.halfWidth || cam.top !== fit.halfHeight || cam.far !== fit.far) {
      cam.left = -fit.halfWidth; cam.right = fit.halfWidth;
      cam.top = fit.halfHeight; cam.bottom = -fit.halfHeight;
      cam.near = fit.near; cam.far = fit.far;
      cam.updateProjectionMatrix();
    }

    status.altitudeFade = shadowAltitudeFade(height);
    const strength = chunkOk && shadowsEnabled && adaptiveShadows
      ? SUN_CONFIG.shadowStrength * w * status.altitudeFade : 0;
    status.strength = strength;
    status.active = strength > 0;
    sun.shadow.radius = strength;
    buildingDepthHeight.value = getBuildingHeightScale();
    if (status.active) {
      renderer.shadowMap.needsUpdate = true;
      status.rendered++;
    }
  }

  const api = {
    get time() { return time; },
    get shadowsEnabled() { return shadowsEnabled; },
    get state() { return state; },
    status,
    setTime, setShadowsEnabled, update,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    mountControls: anchor => mountSunControls(api, anchor),
    DEFAULT_SUN_TIME,
  };
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__ugSun = api;
  return api;
}

// ── HUD controls ─────────────────────────────────────────────────────────────

const BUTTON_STYLE = 'font-size:11px; padding:3px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.88); cursor:pointer;';

/**
 * Insert the Sun slider and Shadows toggle into the existing settings HUD,
 * before `anchor` (the Rendering row). Built here rather than in index.html so
 * the lane touches no shared markup.
 */
export function mountSunControls(system, anchor) {
  if (typeof document === 'undefined') return null;
  const parent = anchor?.parentNode ?? document.getElementById('hudDetails');
  if (!parent) return null;
  const row = document.createElement('p');
  row.className = 'small';
  row.id = 'sunControlRow';
  row.innerHTML = `<label for="sunTime">Sun:</label>
    <span style="opacity:0.7;">Dawn</span>
    <input id="sunTime" type="range" min="0" max="1000" step="1" style="vertical-align: middle; width: 130px;" />
    <span style="opacity:0.7;">Dusk</span>`;
  const toggleRow = document.createElement('p');
  toggleRow.className = 'small row';
  toggleRow.innerHTML = `<button id="sunShadows" type="button" aria-pressed="true" style="${BUTTON_STYLE}">Shadows: on</button>
    <span style="opacity:0.7;">Near the camera; first to go when Automatic needs speed.</span>`;
  parent.insertBefore(row, anchor ?? null);
  parent.insertBefore(toggleRow, anchor ?? null);

  const input = row.querySelector('#sunTime');
  const button = toggleRow.querySelector('#sunShadows');
  const render = () => {
    input.value = String(Math.round(system.time * 1000));
    input.setAttribute('aria-valuetext', sunPhaseLabel(system.time));
    const on = system.shadowsEnabled;
    button.textContent = `Shadows: ${on ? 'on' : 'off'}`;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.style.background = on ? 'rgba(201,184,150,0.22)' : 'rgba(255,255,255,0.06)';
    button.style.borderColor = on ? 'rgba(201,184,150,0.55)' : 'rgba(255,255,255,0.14)';
    button.style.color = on ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.88)';
  };
  input.addEventListener('input', () => system.setTime(Number(input.value) / 1000));
  button.addEventListener('click', () => system.setShadowsEnabled(!system.shadowsEnabled));
  system.onChange(render);
  render();
  return { row, toggleRow, input, button };
}
