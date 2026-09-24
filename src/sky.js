// sky.js: visible sun disc and analytic sky (sprint 24Sep26h, Lane S, D-038).
//
// Before this lane the visible sky was the renderer's flat clear colour
// (0x5a7a8f at the default morning, tinted by the 23Sep26w slider) plus fog.
// The camera-following dome in environment.js only paints the abyss below the
// horizon. This module draws what is above it.
//
// ONE FULL-SCREEN TRIANGLE AT THE FAR PLANE, DRAWN LAST OF THE OPAQUES. The
// sky is not a dome. A dome is a piece of world geometry: it can be clipped by
// the far plane (the original 80000 dome was), squashed by the Master height
// transform, or cut by a wide field of view. Instead a single triangle covers
// the screen in clip space, the vertex shader turns each corner back into a
// view ray, and the fragment shader evaluates the sky along that ray. It cannot
// be clipped at any altitude, Master height or FOV (drone 110).
//
// It sits exactly on the far plane (depth 1.0, the cleared value), is
// depth-tested and writes no depth, and it is ordered after every other opaque
// object. So it only shades pixels that no opaque surface has claimed: the
// early depth test discards the rest. Drawn first instead, it would write every
// pixel of the 4x multisampled half-float target only to be overdrawn, which
// measured about 2.5 to 3 ms at 2880x1800 on the M5; the cost is fill, not
// maths. Transparent layers still draw after it and blend over the sky, as
// they blended over the clear colour. The one opaque surface that does not
// write depth, the terrain's underside, is only visible from below ground,
// where the sky is not drawn.
//
// THE SKY OBEYS THE HEIGHT CONTRACT. The scene is canonical VE5 and Master
// height scales it vertically through the camera's view matrix alone
// (vertical-scale.js). The sky is part of that scene: its rays are the
// canonical world rays (the inverse of the full view rotation-and-scale), so
// the camera squashes or stretches the sky exactly as it does the city, and
// nothing here removes or counters the Master scale. The sun therefore stands
// in the sky where the city's lighting and shadows say it is at every Master
// height: at the fresh-visit Master 1.1 the default morning sun, 13.5 degrees
// up in canonical space, is seen 3.0 degrees above the horizon, which is the
// angle its shadows imply. (Fix round 1 of this lane: the first build took
// rays in true angles instead, which put the disc above the light.)
//
// THE SUN DISC is centred exactly on the light direction (environment.js's
// resolveSunDirection, the vector the sun light and its shadows use), seen
// through the same camera, so on screen it sits where that direction lands.
// Its SIZE is the sun's true apparent diameter, 0.53 degrees, measured on
// screen (the angle between the displayed ray and the displayed light
// direction): an apparent size is a property of the picture, so the disc stays
// round and 0.53 degrees across at every Master height. Coloured by the
// Dawn-to-Dusk slider's sun colour. It is written as HDR light far above the bloom
// threshold, so the existing UnrealBloom pass paints its halo; nothing extra is
// rendered for it. Because the scene draws over the sky, hills, towers and the
// map's own edge hide the disc when they stand in front of it, and the
// below-horizon abyss hides everything under 0 degrees.
//
// AIR ONLY. The sky's weight is sun.js's air weight, exactly 0 for any camera
// below the local surface or in the river. At weight 0 the mesh is not drawn at
// all, so underground and underwater views are byte-identical to before. In the
// short ramp just above the surface the sky blends with the legacy clear colour.
//
// FOG IS PART OF THE SAME ATMOSPHERE. environment.js asks this module for the
// sky's colour on the horizon in the direction the camera faces and pulls the
// air fog towards it, so distant terrain fades into exactly the colour the sky
// has where it meets the land (tests/sky.spec.js pins the match).
//
// CLOUDS LATER (cloud scope, 23Sep26w Lane G). The scope puts cirrus on the
// sky and lights clouds from the slider's keyframes. This shader keeps a
// highCloud() hook (identity today) after the sky radiance and before the sun
// disc, so a painted cirrus layer can sit in this sky and still be crossed by
// the disc correctly; and getSkyParams() exposes the zenith, horizon and
// sunlight colours a cloud shader needs to light its tops and bases.
//
// COST. One triangle, one draw call, no textures, a dozen transcendental
// operations per pixel. Nothing is allocated per frame.

import * as THREE from 'three';
import { SKY_LOOKS, DEFAULT_SKY_LOOK, FLAT_SKY, resolveSkyLookName, skyLookNames } from './sky-looks.js';

const DEG = Math.PI / 180;

/** True apparent diameter of the sun, in degrees. */
export const SUN_APPARENT_DIAMETER_DEG = 0.53;
/** Angular radius of the disc, radians. */
export const SUN_ANGULAR_RADIUS = (SUN_APPARENT_DIAMETER_DEG / 2) * DEG;

// Zenith Rayleigh optical depth at ~680, 550 and 440 nm (red, green, blue).
export const TAU_RAYLEIGH = [0.043, 0.098, 0.26];
// Airmass along a view ray: 1 / (sin(elevation) + K). About 1 at the zenith and
// 28.6 at the horizon: enough to saturate every channel there, which is what
// makes a real horizon pale.
export const VIEW_AIRMASS_K = 0.035;
// The sun's own airmass is softened: this world has no night and its low sun
// must still light the city (sun.js keeps it bright), so the sky must not go
// dark red at the slider ends either.
export const SUN_AIRMASS_K = 0.08;
// Horizon brightening under the sun: falloff with elevation (per unit sine).
export const HORIZON_BAND = 14;
// Sky is not drawn beyond this Mie phase value (keeps the aureole under the
// disc's own brightness; the disc is what blooms).
export const MIE_PHASE_CAP = 5;
// The sky never reaches UnrealBloom's threshold (0.88 luminance): above
// SKY_KNEE its luminance rolls off smoothly towards SKY_CEILING. Only the sun
// disc is brighter than that, so only the disc blooms, and its halo is the
// bloom's own; a glowing sky would otherwise bloom into a white sheet.
export const SKY_KNEE = 0.5;
export const SKY_CEILING = 0.8;

const LUMA = [0.2126, 0.7152, 0.0722];

// ── Below the horizon ───────────────────────────────────────────────────────
// environment.js's abyss dome paints everything more than a few degrees below
// the horizon (opaque from ABYSS_OPAQUE_DEG down). It is scene geometry, so at
// a high Master height the camera stretches it past the far plane and loses
// its nadir. The sky carries the same ramp (the dome's canvas stops, degrees
// below the canonical horizon, sRGB), so a clipped dome shows the abyss rather
// than daylight. Above ABYSS_OPAQUE_DEG the dome is translucent and the sky
// underneath is left exactly as it was. The dome's canvas texture carries no
// colour space, so three.js samples its bytes as linear values: so do these.
export const ABYSS_OPAQUE_DEG = 3.6;
const ABYSS_STOPS = [[3.6, [40, 46, 54]], [12.6, [18, 21, 27]], [25.2, [9, 11, 15]], [90, [4, 5, 8]]]
  .map(([deg, rgb]) => [deg, new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)]);

/** The abyss colour `deg` degrees below the horizon (linear). */
export function abyssColorAt(deg, out = new THREE.Color()) {
  if (deg <= ABYSS_STOPS[0][0]) return out.copy(ABYSS_STOPS[0][1]);
  for (let i = 1; i < ABYSS_STOPS.length; i++) {
    const [d1, c1] = ABYSS_STOPS[i], [d0, c0] = ABYSS_STOPS[i - 1];
    if (deg <= d1) return out.copy(c0).lerp(c1, (deg - d0) / (d1 - d0));
  }
  return out.copy(ABYSS_STOPS[ABYSS_STOPS.length - 1][1]);
}
// THE ABYSS IS HAZED LIKE THE GROUND. Beyond the map's edge there is no land,
// only the abyss, but the eye expects the land to carry on into the haze. So
// a ray below the horizon is fogged exactly as three.js's linear fog would fog
// a point of ground at Ordnance Datum where that ray meets it: its view-space
// depth, taken through the camera's own view matrix (Master scale included,
// like every fogged surface), against the scene fog's near and far. The haze
// reaches the fog colour at the horizon and thins as the view steepens, so
// the land's fogged edge, the abyss beyond it and the sky's horizon read as
// one atmosphere at every Master height and altitude. Used by the abyss dome
// (environment.js) and by the sky below the dome's opaque line.
export const ABYSS_HAZE_GLSL = /* glsl */`
float abyssHaze( vec3 dir, float near, float far ) {
  if ( dir.y > -1e-6 ) return 1.0;
  float t = min( max( cameraPosition.y, 1.0 ) / -dir.y, 1e8 );
  float depth = -( mat3( viewMatrix ) * ( dir * t ) ).z;
  return smoothstep( near, far, depth );
}`;

/** Weight of the abyss in the sky along a ray `deg` below the horizon. */
export function abyssWeight(deg) {
  const t = Math.min(1, Math.max(0, (deg - (ABYSS_OPAQUE_DEG - 0.2)) / 0.2));
  return t * t * (3 - 2 * t);
}

// ── Parameters (pure) ───────────────────────────────────────────────────────

export function createSkyParams() {
  return {
    look: DEFAULT_SKY_LOOK,
    sunDir: new THREE.Vector3(0, 1, 0),
    illum: new THREE.Color(),
    tauR: new THREE.Vector3(),
    tauM: 0, mieG: 0.76, mieGain: 1,
    airmassK: VIEW_AIRMASS_K,
    ambient: new THREE.Color(),
    horizonGlow: 0, horizonGlowPow: 4,
    exposure: 1, saturation: 1,
    keySky: new THREE.Color(), keyMix: 0,
    discColor: new THREE.Color(),
    discRadius: SUN_ANGULAR_RADIUS,
    // Master height ratio of the viewing camera (display y = canonical y x
    // ratio) and the light direction as that camera displays it: only the
    // disc's on-screen size uses them.
    masterRatio: 1,
    sunDirDisplay: new THREE.Vector3(0, 1, 0),
    fogCoupling: 1, fogGain: 1, fogMaxLum: 0.6,
    // Mixing weights. weight 0 = the legacy clear colour, 1 = this sky.
    weight: 0, discWeight: 0,
    clear: new THREE.Color(),
    // Abyss haze (below the dome's opaque line): the fog colour, distances and
    // weight environment.js gives the abyss dome.
    haze: new THREE.Color(), hazeNear: 1, hazeFar: 2, hazeWeight: 0,
  };
}

function smooth01(x) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

/**
 * Fill `out` for a look and a sun.js sunState. `direction` is the light's
 * direction towards the sun (defaults to the state's). Pure.
 */
export function computeSkyParams(lookName, state, { direction = null, out = createSkyParams() } = {}) {
  const name = resolveSkyLookName(lookName);
  const look = SKY_LOOKS[name] ?? SKY_LOOKS[DEFAULT_SKY_LOOK];
  out.look = name;
  out.sunDir.copy(direction ?? state.direction).normalize();
  const sinE = Math.max(out.sunDir.y, 0);
  const elevDeg = Math.asin(Math.min(1, sinE)) / DEG;

  out.tauR.set(TAU_RAYLEIGH[0], TAU_RAYLEIGH[1], TAU_RAYLEIGH[2]).multiplyScalar(look.rayleigh);
  out.tauM = look.mie;
  out.mieG = look.mieG;
  out.mieGain = look.mieGain;
  out.airmassK = look.airmassK ?? VIEW_AIRMASS_K;

  // Sunlight reaching the air: the analytic transmittance through the sun's
  // airmass, blended with the slider's sun colour and strength.
  const mSun = 1 / (sinE + SUN_AIRMASS_K);
  const ar = Math.exp(-(out.tauR.x + out.tauM) * mSun);
  const ag = Math.exp(-(out.tauR.y + out.tauM) * mSun);
  const ab = Math.exp(-(out.tauR.z + out.tauM) * mSun);
  const strength = Math.min(1.25, Math.max(0.5, state.sunFactor ?? 1));
  const k = look.keyIllum;
  out.illum.setRGB(
    (ar * (1 - k) + state.sunColor.r * strength * k) * look.sunIllum,
    (ag * (1 - k) + state.sunColor.g * strength * k) * look.sunIllum,
    (ab * (1 - k) + state.sunColor.b * strength * k) * look.sunIllum,
  );
  // Multiple-scattering fill: a sky-blue light that stays blue at the slider
  // ends (the twilight zenith), dimming only a little as the sun gets low.
  const level = look.sunIllum * (0.8 + 0.2 * smooth01(elevDeg / 15));
  const hue = look.ambientHue;
  out.ambient.setRGB(look.ambient * level * hue[0], look.ambient * level * hue[1], look.ambient * level * hue[2]);
  // The warm band under a low sun is the signature of dawn and dusk.
  const lowSun = 1 - smooth01(elevDeg / 12);
  out.horizonGlow = look.horizonGlow * (1 + (look.lowSunGlow ?? 0) * lowSun);
  out.horizonGlowPow = look.horizonGlowPow;
  out.exposure = look.exposure;
  out.saturation = look.saturation;
  out.keySky.copy(state.skyColor);
  out.keyMix = look.keyMix;
  out.fogCoupling = look.fogCoupling;
  out.fogGain = look.fogGain;
  out.fogMaxLum = look.fogMaxLum;
  // Disc: the slider's sun colour, dimmer as it nears the horizon.
  const discScale = look.discIntensity * (0.35 + 0.65 * smooth01(elevDeg / 20));
  out.discColor.copy(state.sunColor).multiplyScalar(discScale);
  out.discRadius = SUN_ANGULAR_RADIUS;
  return out;
}

/** The light direction `p.sunDir` as a camera with Master ratio `ratio` shows it. */
export function displaySunDirection(p, ratio = 1, out = p.sunDirDisplay) {
  p.masterRatio = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  return out.set(p.sunDir.x, p.sunDir.y * p.masterRatio, p.sunDir.z).normalize();
}

/**
 * The sky's radiance along a unit canonical (world) direction, before the weight
 * blend and without the disc. Linear working space. This is the CPU mirror of
 * skyRadiance() in the fragment shader: keep the two in lockstep.
 */
export function skyRadianceAt(dir, p, out = new THREE.Color()) {
  const el = Math.max(dir.y, 0);
  const mu = dir.x * p.sunDir.x + dir.y * p.sunDir.y + dir.z * p.sunDir.z;
  const m = 1 / (el + p.airmassK);
  const g = p.mieG;
  const denom = Math.max(1 + g * g - 2 * g * mu, 1e-4);
  const phaseM = Math.min((1 - g * g) / (denom * Math.sqrt(denom)), MIE_PHASE_CAP);
  const phaseR = 0.75 * (1 + mu * mu);
  const lh = Math.hypot(dir.x, dir.z), ls = Math.hypot(p.sunDir.x, p.sunDir.z);
  const az = lh > 1e-5 && ls > 1e-5 ? (dir.x * p.sunDir.x + dir.z * p.sunDir.z) / (lh * ls) : 0;
  const glow = p.horizonGlow * Math.pow(0.5 + 0.5 * az, p.horizonGlowPow) * Math.exp(-el * HORIZON_BAND);
  const tau = [p.tauR.x, p.tauR.y, p.tauR.z];
  const illum = [p.illum.r, p.illum.g, p.illum.b];
  const amb = [p.ambient.r, p.ambient.g, p.ambient.b];
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tauE = tau[i] + p.tauM;
    const inscatter = 1 - Math.exp(-tauE * m);
    const scat = (tau[i] * phaseR + p.tauM * phaseM * p.mieGain) / tauE;
    c[i] = (illum[i] * scat * inscatter + amb[i] * inscatter + illum[i] * glow) * p.exposure;
  }
  const l = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const keyLift = 0.8 + 0.5 * Math.exp(-el * 6);
  const key = [p.keySky.r * keyLift, p.keySky.g * keyLift, p.keySky.b * keyLift];
  for (let i = 0; i < 3; i++) {
    const sat = l + (c[i] - l) * p.saturation;
    c[i] = Math.max(0, sat + (key[i] - sat) * p.keyMix);
  }
  const l2 = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const k = softCeiling(l2) / Math.max(l2, 1e-6);
  out.setRGB(c[0] * k, c[1] * k, c[2] * k);
  if (dir.y < 0) {
    const below = Math.asin(Math.min(1, -dir.y / Math.hypot(dir.x, dir.y, dir.z))) / DEG;
    const w = abyssWeight(below);
    if (w > 0) out.lerp(abyssColorAt(below, _abyss), w);
  }
  return out;
}
const _abyss = new THREE.Color();

/** Luminance roll-off: identity to SKY_KNEE, then asymptotic to SKY_CEILING. */
export function softCeiling(l) {
  if (l <= SKY_KNEE) return l;
  const span = SKY_CEILING - SKY_KNEE;
  return SKY_KNEE + span * (1 - Math.exp(-(l - SKY_KNEE) / span));
}

/**
 * Sky colour on the horizon, facing `forward`'s compass direction (its
 * vertical part is ignored). What the air fog is pulled towards.
 */
const _h = new THREE.Vector3();
export function horizonColorToward(forward, p, out = new THREE.Color()) {
  _h.set(forward.x, 0, forward.z);
  if (_h.lengthSq() < 1e-10) _h.set(0, 0, -1);
  _h.normalize();
  skyRadianceAt(_h, p, out).multiplyScalar(p.fogGain);
  // Towards a low sun the horizon is glare; the fog that covers the whole
  // city keeps its hue but not its full brightness.
  const l = out.r * LUMA[0] + out.g * LUMA[1] + out.b * LUMA[2];
  if (l > p.fogMaxLum) out.multiplyScalar(p.fogMaxLum / l);
  return out;
}

// ── Shader ──────────────────────────────────────────────────────────────────

const f = v => Number(v).toFixed(6);
const v3 = c => `vec3( ${f(c.r)}, ${f(c.g)}, ${f(c.b)} )`;

const VERTEX = /* glsl */`
varying vec3 vDir;
void main() {
  // position.xy is a clip-space corner of one screen-covering triangle.
  vec4 view = inverse( projectionMatrix ) * vec4( position.xy, 1.0, 1.0 );
  // The canonical world ray through this corner: the inverse of the camera's
  // whole view transform (rotation and Master scale alike), as for any
  // other point of the scene. Linear in view space, so it interpolates.
  vDir = inverse( mat3( viewMatrix ) ) * ( view.xyz / view.w );
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}`;

const FRAGMENT = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uIllum;
uniform vec3 uTauR;
uniform float uTauM;
uniform float uMieG;
uniform float uMieGain;
uniform float uAirmassK;
uniform vec3 uAmbient;
uniform float uHorizonGlow;
uniform float uHorizonGlowPow;
uniform float uExposure;
uniform float uSaturation;
uniform vec3 uKeySky;
uniform float uKeyMix;
uniform vec3 uDiscColor;
uniform float uDiscRadius;
uniform float uMasterRatio;
uniform vec3 uSunDirDisplay;
uniform float uWeight;
uniform float uDiscWeight;
uniform vec3 uClear;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uHazeWeight;
varying vec3 vDir;
${ABYSS_HAZE_GLSL}

// Mirror of skyRadianceAt() in sky.js.
vec3 skyRadiance( vec3 d ) {
  float el = max( d.y, 0.0 );
  float mu = dot( d, uSunDir );
  float m = 1.0 / ( el + uAirmassK );
  float g = uMieG;
  float denom = max( 1.0 + g * g - 2.0 * g * mu, 1e-4 );
  float phaseM = min( ( 1.0 - g * g ) / ( denom * sqrt( denom ) ), ${f(MIE_PHASE_CAP)} );
  float phaseR = 0.75 * ( 1.0 + mu * mu );
  float lh = length( d.xz ), ls = length( uSunDir.xz );
  float az = ( lh > 1e-5 && ls > 1e-5 ) ? dot( d.xz, uSunDir.xz ) / ( lh * ls ) : 0.0;
  float glow = uHorizonGlow * pow( 0.5 + 0.5 * az, uHorizonGlowPow ) * exp( -el * ${f(HORIZON_BAND)} );
  vec3 tauE = uTauR + vec3( uTauM );
  vec3 inscatter = 1.0 - exp( -tauE * m );
  vec3 scat = ( uTauR * phaseR + vec3( uTauM * phaseM * uMieGain ) ) / tauE;
  vec3 c = ( uIllum * scat * inscatter + uAmbient * inscatter + uIllum * glow ) * uExposure;
  float l = dot( c, vec3( ${LUMA.map(f).join(', ')} ) );
  vec3 key = uKeySky * ( 0.8 + 0.5 * exp( -el * 6.0 ) );
  c = max( mix( vec3( l ) + ( c - vec3( l ) ) * uSaturation, key, uKeyMix ), vec3( 0.0 ) );
  float l2 = dot( c, vec3( ${LUMA.map(f).join(', ')} ) );
  float soft = l2 <= ${f(SKY_KNEE)} ? l2
    : ${f(SKY_KNEE)} + ${f(SKY_CEILING - SKY_KNEE)} * ( 1.0 - exp( -( l2 - ${f(SKY_KNEE)} ) / ${f(SKY_CEILING - SKY_KNEE)} ) );
  return c * ( soft / max( l2, 1e-6 ) );
}

// Mirror of abyssColorAt() / abyssWeight() in sky.js.
vec3 abyss( float deg ) {
  if ( deg <= ${f(ABYSS_STOPS[1][0])} ) return mix( ${v3(ABYSS_STOPS[0][1])}, ${v3(ABYSS_STOPS[1][1])}, max( deg - ${f(ABYSS_STOPS[0][0])}, 0.0 ) / ${f(ABYSS_STOPS[1][0] - ABYSS_STOPS[0][0])} );
  if ( deg <= ${f(ABYSS_STOPS[2][0])} ) return mix( ${v3(ABYSS_STOPS[1][1])}, ${v3(ABYSS_STOPS[2][1])}, ( deg - ${f(ABYSS_STOPS[1][0])} ) / ${f(ABYSS_STOPS[2][0] - ABYSS_STOPS[1][0])} );
  return mix( ${v3(ABYSS_STOPS[2][1])}, ${v3(ABYSS_STOPS[3][1])}, min( ( deg - ${f(ABYSS_STOPS[2][0])} ) / ${f(ABYSS_STOPS[3][0] - ABYSS_STOPS[2][0])}, 1.0 ) );
}

// Cloud hook (cloud scope, 23Sep26w): a later cirrus layer composites here,
// over the sky and under the sun disc. Identity today.
vec3 highCloud( vec3 c, vec3 d ) { return c; }

void main() {
  vec3 d = normalize( vDir );
  // The same ray as the camera displays it: only the disc's apparent size is
  // measured here, so the disc is round and 0.53 degrees on screen.
  vec3 dd = normalize( vec3( vDir.x, vDir.y * uMasterRatio, vDir.z ) );
  // Angular size of this pixel on screen (radians), in uniform control flow.
  float aa = max( 0.5 * length( fwidth( dd ) ), 1e-7 );
  vec3 sky = highCloud( skyRadiance( d ), d );
  if ( d.y < 0.0 ) {
    float below = degrees( asin( min( -d.y, 1.0 ) ) );
    vec3 abyssHazed = mix( abyss( below ), uHaze, abyssHaze( d, uHazeNear, uHazeFar ) * uHazeWeight );
    sky = mix( sky, abyssHazed, smoothstep( ${f(ABYSS_OPAQUE_DEG - 0.2)}, ${f(ABYSS_OPAQUE_DEG)}, below ) );
  }
  vec3 col = mix( uClear, sky, uWeight );
  // Sun disc, true size, anti-aliased over one pixel. |dd x s| is the sine of
  // the on-screen angle to the displayed light direction, which is exactly
  // where the canonical light direction lands: exact for tiny angles, where
  // 1 - dot() would lose most of its float precision. Only pixels near the
  // sun pay for it.
  if ( uDiscWeight > 0.0 && dot( dd, uSunDirDisplay ) > 0.99 ) {
    float s = length( cross( dd, uSunDirDisplay ) );
    float cover = 1.0 - smoothstep( uDiscRadius - aa, uDiscRadius + aa, s );
    float r = clamp( s / uDiscRadius, 0.0, 1.0 );
    float limb = 1.0 - 0.45 * ( 1.0 - sqrt( max( 1.0 - r * r, 0.0 ) ) );
    col += uDiscColor * ( limb * cover * uDiscWeight );
  }
  // Deterministic sub-quantum dither against banding in the smooth gradient.
  float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  col *= 1.0 + ( n - 0.5 ) * 0.008;
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createSkyMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uIllum: { value: new THREE.Color() },
    uTauR: { value: new THREE.Vector3() },
    uTauM: { value: 0 },
    uMieG: { value: 0.76 },
    uMieGain: { value: 1 },
    uAirmassK: { value: VIEW_AIRMASS_K },
    uAmbient: { value: new THREE.Color() },
    uHorizonGlow: { value: 0 },
    uHorizonGlowPow: { value: 4 },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uKeySky: { value: new THREE.Color() },
    uKeyMix: { value: 0 },
    uDiscColor: { value: new THREE.Color() },
    uDiscRadius: { value: SUN_ANGULAR_RADIUS },
    uMasterRatio: { value: 1 },
    uSunDirDisplay: { value: new THREE.Vector3(0, 1, 0) },
    uWeight: { value: 0 },
    uDiscWeight: { value: 0 },
    uClear: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uHazeNear: { value: 1 },
    uHazeFar: { value: 2 },
    uHazeWeight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'analyticSky',
    uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    depthTest: true, depthWrite: false, fog: false,
    depthFunc: THREE.LessEqualDepth,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'analyticSky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e9;        // last of the opaque queue: only unclaimed pixels shade
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};       // never a hover or pick target
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function writeUniforms(u, p) {
  u.uSunDir.value.copy(p.sunDir);
  u.uIllum.value.copy(p.illum);
  u.uTauR.value.copy(p.tauR);
  u.uTauM.value = p.tauM;
  u.uMieG.value = p.mieG;
  u.uMieGain.value = p.mieGain;
  u.uAirmassK.value = p.airmassK;
  u.uAmbient.value.copy(p.ambient);
  u.uHorizonGlow.value = p.horizonGlow;
  u.uHorizonGlowPow.value = p.horizonGlowPow;
  u.uExposure.value = p.exposure;
  u.uSaturation.value = p.saturation;
  u.uKeySky.value.copy(p.keySky);
  u.uKeyMix.value = p.keyMix;
  u.uDiscColor.value.copy(p.discColor);
  u.uDiscRadius.value = p.discRadius;
  u.uMasterRatio.value = p.masterRatio;
  u.uSunDirDisplay.value.copy(p.sunDirDisplay);
  u.uWeight.value = p.weight;
  u.uDiscWeight.value = p.discWeight;
  u.uClear.value.copy(p.clear);
  u.uHaze.value.copy(p.haze);
  u.uHazeNear.value = p.hazeNear;
  u.uHazeFar.value = p.hazeFar;
  u.uHazeWeight.value = p.hazeWeight;
}

// ── URL ─────────────────────────────────────────────────────────────────────

/** Look requested by ?sky=<name>; null when the parameter is absent. */
export function readSkyLookFromUrl(search = typeof location !== 'undefined' ? location.search : '') {
  const sp = new URLSearchParams(search);
  return sp.has('sky') ? resolveSkyLookName(sp.get('sky')) : null;
}

// ── System ──────────────────────────────────────────────────────────────────

/**
 * Add the sky to the scene. environment.js drives it each frame through
 * attachSky(); main.js only creates it and mounts the hidden control.
 */
export function createSkySystem({ scene, look = null } = {}) {
  const mesh = createSkyMesh();
  const params = createSkyParams();
  let lookName = resolveSkyLookName(look ?? readSkyLookFromUrl() ?? DEFAULT_SKY_LOOK);
  const listeners = new Set();
  const status = { weight: 0, discWeight: 0, visible: false, look: lookName, updates: 0 };
  const forward = new THREE.Vector3();
  if (scene) scene.add(mesh);

  function setLook(name, { syncUrl = true } = {}) {
    lookName = resolveSkyLookName(name);
    status.look = lookName;
    if (syncUrl && typeof history !== 'undefined' && typeof location !== 'undefined') {
      try {
        const url = new URL(location.href);
        url.searchParams.set('sky', lookName);
        history.replaceState(history.state, '', url.toString());
      } catch { /* a sandboxed frame may refuse; the look still changes */ }
    }
    for (const fn of listeners) fn(api);
    return lookName;
  }

  /**
   * Per frame, from updateEnvironment. `state` is sun.js's sunState (null when
   * there is no sun system), `direction` the resolved light direction,
   * `weight` the sky weight and `discWeight` the disc's (both 0 underground).
   * Writes the fog target into `fogOut` and returns the coupling to apply (0
   * when the sky should leave the fog alone).
   */
  function update({ camera, state, direction, weight = 0, discWeight = weight, fogOut = null }) {
    status.updates++;
    if (!state || !(weight > 0 || discWeight > 0)) {
      status.weight = 0; status.discWeight = 0; status.visible = false;
      mesh.visible = false;
      return 0;
    }
    const flat = lookName === FLAT_SKY;
    computeSkyParams(flat ? DEFAULT_SKY_LOOK : lookName, state, { direction, out: params });
    params.look = lookName;
    displaySunDirection(params, camera?.userData?.masterHeightController?.ratio ?? 1);
    params.weight = flat ? 0 : THREE.MathUtils.clamp(weight, 0, 1);
    params.discWeight = THREE.MathUtils.clamp(discWeight, 0, 1);
    status.weight = params.weight;
    status.discWeight = params.discWeight;
    status.visible = mesh.visible = true;
    if (flat || !fogOut || !camera) return 0;
    camera.getWorldDirection(forward);
    horizonColorToward(forward, params, fogOut);
    return params.fogCoupling;
  }

  /** The abyss haze: the fog colour and distances, and its weight. */
  function setHaze(color, near, far, weight) {
    params.haze.copy(color);
    params.hazeNear = near;
    params.hazeFar = Math.max(far, near + 1);
    params.hazeWeight = weight;
  }

  /** The legacy clear colour the sky blends with (set after it is computed). */
  function setClear(color) {
    params.clear.copy(color);
    writeUniforms(mesh.material.uniforms, params);
  }

  const api = {
    mesh, params, status,
    get look() { return lookName; },
    looks: [...skyLookNames()],
    setLook, update, setClear, setHaze,
    sample: (dir, out) => skyRadianceAt(dir, params, out),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    mountControls: anchor => mountSkyControls(api, anchor),
  };
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__ugSky = api;
  return api;
}

/** Colours a cloud layer needs to sit in this sky (cloud scope). Read-only. */
export function getSkyParams(system) { return system?.params ?? null; }

// ── Hidden settings row ─────────────────────────────────────────────────────

/**
 * A "Sky" look picker placed after `anchor` (the sun's rows) in the settings
 * HUD. Hidden unless the URL carries ?sky=, or until the "Sun:" label is
 * double-clicked: it exists for review, not for everyday use.
 */
export function mountSkyControls(system, anchor) {
  if (typeof document === 'undefined') return null;
  const parent = anchor?.parentNode ?? document.getElementById('hudDetails');
  if (!parent) return null;
  const row = document.createElement('p');
  row.className = 'small';
  row.id = 'skyLookRow';
  const options = [...system.looks.map(n => [n, SKY_LOOKS[n].label]), [FLAT_SKY, 'Flat (before)']]
    .map(([n, label]) => `<option value="${n}">${label}${n === DEFAULT_SKY_LOOK ? ' (default)' : ''}</option>`).join('');
  row.innerHTML = `<label for="skyLook">Sky:</label> <select id="skyLook">${options}</select>`;
  row.hidden = readSkyLookFromUrl() === null;
  parent.insertBefore(row, anchor?.nextSibling ?? null);
  const select = row.querySelector('#skyLook');
  const render = () => { select.value = system.look; };
  select.addEventListener('change', () => system.setLook(select.value));
  document.querySelector('label[for="sunTime"]')?.addEventListener('dblclick', () => { row.hidden = !row.hidden; });
  system.onChange(render);
  render();
  return { row, select };
}
