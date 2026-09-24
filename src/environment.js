import * as THREE from 'three';
import { setInfraHazeStrength } from './infra-materials.js';
import { ABYSS_HAZE_GLSL } from './sky.js';

// Environment configuration for above/below ground differentiation
export const ENV_CONFIG = {
  // Altitude thresholds (in scene units/metres)
  surfaceY: 0,           // Ground level
  skyStartY: 200,        // Where sky becomes visible (raised for VE=5: central London ground ≈ Y=75)
  fogDepthY: -50,        // Where underground fog thickens

  // Colors
  skyColor: 0x5a7a8f,    // Muted steel-blue (clear colour behind geometry)
  groundColor: 0x1f1a15, // Dark warm brown-black (underground)
  fogColorSky: 0x3a4a52, // Dark warm-grey fog — blends with terrain, not sky
  fogColorGround: 0x191817, // Airy clay (D4.1): neutral graphite, faintest warm cast

  // Fog distances - wider range for clearer visibility
  fogNear: 200,
  fogFar: 25000,

  // Lighting intensities
  ambientAbove: 0.6,
  ambientBelow: 0.25,
  sunIntensity: 1.5,

  // ── Chalk white-out (D3.3) ──────────────────────────────────────────────
  // The signature "bright clouding" when crossing into the chalk stratum.
  // Blended in by chalkBlend (0 in clay/air → 1 well inside chalk).
  chalkFogColor: 0xded6c4, // dusty warm white
  chalkFogNear: 40,        // very tight — nearby lines/tubes stay legible, rest dissolves
  chalkFogFar: 2200,       // clouded visibility ceiling
  chalkAmbient: 0.35,      // raise toward bright white-tinted (NOT darkness)

  // ── Clay clarity gradient + inside-chalk clarity (Item B, 10Jul26f) ────────
  // clayLift keys underground brightness/fog on camera height ABOVE the local
  // chalk surface (getChalkSurfaceY), not on absolute Y: daylight-like clarity
  // at the top of the clay column, today's darkness at the chalk boundary.
  // chalkClarity releases fog for a camera INSIDE the chalk so every
  // subterranean feature is visible at any distance looking up. Both are
  // computed in main.js's tick; ramps are tunable at runtime via window.__ug.
  clayClarityRamp: 300,      // scene units above chalk surface to full daylight
  chalkClarityRamp: 40,      // scene units below chalk surface to full clarity
  chalkClarityAmbient: 0.55, // ambient inside chalk — up-view features lit, not just unfogged
  clarityFogNear: 20000,     // fog effectively off for anything the camera can see
  clarityFogFar: 60000,      // > scene diagonal

  // ── Submerged regime (Thames water volume, 12Jul26u) ────────────────────
  // Applied LAST in updateEnvironment/updateLighting so it overrides every
  // other regime while the camera is inside the river volume. Short murky
  // green-brown fog gives the enclosed underwater feel; tunnels/infrastructure
  // emerge only within waterFogFar. Driven by submergedBlend (0..1), a short
  // spatial smoothstep below the rendered water top computed in main.js.
  waterFogColor: 0x44665d,  // clearer green water, retaining a Thames identity
  waterBgColor: 0x314e46,
  waterFogNear: 35,
  waterFogFar: 1100,
  waterAmbient: 0.65,
  waterSun: 0.65,

  // ── Street-level fill (D7) ──────────────────────────────────────────────
  // Hemisphere light (warm sky / cool-earth ground bounce) that lifts building
  // faces at eye level. Gated to low altitude so the overview is untouched.
  hemiSky: 0xffe9c8,       // warm daylight from above
  hemiGround: 0x40453f,    // cool-earth bounce from below
  hemiStreet: 1.15,        // peak intensity at street level
  hemiFadeLow: 1500,       // scene units — full strength below this camera Y
  hemiFadeHigh: 8000,      // faded to zero by this camera Y (overview preserved)
  // Lighting reaches full day by rooftop height (not skyStartY=200). Street
  // level is Y≈60-80; ramping key+ambient over 0→lightFullY lifts eye-level
  // legibility (D7) while leaving altitude views (already at full day) untouched.
  lightFullY: 90,
};

// ── Time-of-day sun in the air substrate (sprint 23Sep26w, Lane D) ─────────
// The sun that shipped before the slider: a fixed directional light at this
// position (direction only matters). sun.js anchors the slider's default here.
export const LEGACY_SUN_POSITION = [2000, 600, 1500];
const _legacyDir = new THREE.Vector3(...LEGACY_SUN_POSITION).normalize();
const _legacyDistance = new THREE.Vector3(...LEGACY_SUN_POSITION).length();
const _cWhite = new THREE.Color(0xffffff);
const _cHemiSky = new THREE.Color(ENV_CONFIG.hemiSky);
// weight: 0..1 air-substrate weight (exactly 0 underground or submerged, so
// every regime below is byte-identical to the legacy lighting there).
// state: sun.js sunState(t). distance: shadow-fitted light distance.
const _air = { weight: 0, state: null, distance: undefined };

/** Set by sun.js each frame, before updateEnvironment/updateLighting. */
export function setAirSun({ weight = 0, state = null, distance } = {}) {
  _air.weight = state && Number.isFinite(weight) ? THREE.MathUtils.clamp(weight, 0, 1) : 0;
  _air.state = state;
  _air.distance = distance;
}

/** The sun direction (towards the sun) that updateLighting will apply. */
export function resolveSunDirection(out = new THREE.Vector3()) {
  const w = _air.weight;
  if (w <= 0) return out.copy(_legacyDir);
  if (w >= 1) return out.copy(_air.state.direction);
  return out.copy(_legacyDir).lerp(_air.state.direction, w).normalize();
}

// ── Analytic sky and sun disc (sprint 24Sep26h, Lane S) ────────────────────
// sky.js draws the sky; this module decides how much of it shows and couples
// the air fog to it. Registered by main.js; absent (as in the node tests), the
// environment behaves exactly as before.
let _skySystem = null;
const _cSkyHorizon = new THREE.Color();
let _skyHazeWeight = 0;

/** Register the sky system that updateEnvironment drives each frame. */
export function attachSky(skySystem) { _skySystem = skySystem ?? null; }

/** Read-only view of the current air sun blend (tests, tuning). */
export function getAirSun() {
  return { weight: _air.weight, t: _air.state?.t ?? null, distance: _air.distance };
}


// Create sky dome — a camera-following "abyss cap" (D1.4).
//
// IMPORTANT geometry note: the camera far plane is 50000, so an 80000-radius
// dome fixed at the origin is almost entirely FRUSTUM-CLIPPED — the sky/void
// the viewer actually sees is the renderer CLEAR COLOUR, not the dome. That is
// why darkening the dome texture alone did nothing to the below-horizon void.
//
// This dome therefore (a) has radius 45000 (< far plane) and (b) is recentred
// on the camera every frame in updateEnvironment, so it always renders and its
// equator always sits on the viewer's true horizon. Its job is ONLY the abyss:
//   • ABOVE the horizon (v > 0.5) the texture alpha is 0 → fully transparent →
//     the existing clear-colour sky shows through UNCHANGED (the good overview
//     look is preserved; we deliberately do not re-tint the upper sky).
//   • BELOW the horizon (v < 0.5) the texture ramps to an OPAQUE deep slate →
//     near-black at nadir, hiding the bright steel-blue clear colour so the
//     white chalk shaft + warm clay disc read against a dark abyss.
// depthWrite:false + a very negative renderOrder make it a pure background: all
// scene geometry (opaque or transparent) draws over it, so it never occludes
// the terrain/city/column. Master fade (altitude/underground/chalk) rides on
// material.opacity in updateEnvironment, so it vanishes underground and in the
// chalk white-out, leaving those regimes' clear-colour handling untouched.
export function createSkyDome(scene) {
  const geometry = new THREE.SphereGeometry(45000, 32, 32);

  // Texture row 0 → top pole (CanvasTexture flipY=true → sphere v=1); row 512 →
  // bottom pole (nadir). So canvas t: 0 = zenith, 0.5 = horizon, 1 = nadir.
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  // AgX tone-mapping lifts shadows, so the slate is pushed dark and the ramp
  // reaches near-black quickly below the horizon — otherwise the visible abyss
  // reads as mid-grey.
  grad.addColorStop(0.00, 'rgba(120,132,146,0.00)'); // zenith — transparent (sky = clear colour)
  grad.addColorStop(0.49, 'rgba(120,132,146,0.00)'); // just above horizon — still transparent
  grad.addColorStop(0.50, 'rgba(70,78,88,0.00)');    // horizon line — transparent
  grad.addColorStop(0.52, 'rgba(40,46,54,1.00)');    // just below horizon — OPAQUE slate (abyss begins)
  grad.addColorStop(0.57, 'rgba(18,21,27,1.00)');    // darkening fast
  grad.addColorStop(0.64, 'rgba(9,11,15,1.00)');     // deep slate
  grad.addColorStop(1.00, 'rgba(4,5,8,1.00)');       // near-black (nadir abyss)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.0,        // Start invisible; master fade driven in updateEnvironment
    depthWrite: false,   // pure background — never occlude scene geometry
    fog: false,
  });
  // The ordinary dome is an abyss cap: its upper half is transparent because
  // the exterior clear colour supplies sky. Underwater the clear colour must
  // stay green, so reveal the same steel-blue sky in the upper hemisphere of
  // this existing draw. Opaque banks/bed still win depth; the lower hemisphere
  // stays transparent underwater. No extra city render or sky mesh is needed.
  const submergedSky = { value: 0 };
  // Lane S (24Sep26h): with the analytic sky, the abyss is hazed like the
  // ground it replaces (sky.js ABYSS_HAZE_GLSL: the scene fog at the depth
  // where the ray would meet Ordnance Datum), so the band between the map's
  // edge and the horizon reads as distant haze rather than a dark slot, at
  // every Master height. Weight 0 (no sky, flat look, underground) leaves the
  // abyss exactly as before.
  const horizonHaze = { value: new THREE.Color() };
  const horizonHazeWeight = { value: 0 };
  const horizonHazeNear = { value: 1 };
  const horizonHazeFar = { value: 2 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uHorizonHaze = horizonHaze;
    shader.uniforms.uHorizonHazeWeight = horizonHazeWeight;
    shader.uniforms.uHorizonHazeNear = horizonHazeNear;
    shader.uniforms.uHorizonHazeFar = horizonHazeFar;
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
varying vec3 vDomeDir;
void main() {`).replace('#include <begin_vertex>', `#include <begin_vertex>
vDomeDir = position;`);
    shader.uniforms.uSubmergedSky = submergedSky;
    shader.uniforms.uSubmergedSkyColor = { value: new THREE.Color(ENV_CONFIG.skyColor) };
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
uniform float uSubmergedSky;
uniform vec3 uSubmergedSkyColor;
uniform vec3 uHorizonHaze;
uniform float uHorizonHazeWeight;
uniform float uHorizonHazeNear;
uniform float uHorizonHazeFar;
varying vec3 vDomeDir;
${ABYSS_HAZE_GLSL}
void main() {`).replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb=mix(diffuseColor.rgb,uHorizonHaze,abyssHaze(normalize(vDomeDir),uHorizonHazeNear,uHorizonHazeFar)*uHorizonHazeWeight);
float aboveWaterHorizon=smoothstep(0.5,0.51,vMapUv.y);
diffuseColor.rgb=mix(diffuseColor.rgb,uSubmergedSkyColor,aboveWaterHorizon*uSubmergedSky);
diffuseColor.a=mix(diffuseColor.a,aboveWaterHorizon*opacity,uSubmergedSky);
`);
  };
  const sky = new THREE.Mesh(geometry, material);
  sky.userData.submergedSky = submergedSky;
  sky.userData.horizonHaze = horizonHaze;
  sky.userData.horizonHazeWeight = horizonHazeWeight;
  sky.userData.horizonHazeNear = horizonHazeNear;
  sky.userData.horizonHazeFar = horizonHazeFar;
  sky.renderOrder = -1000; // draw first in the transparent queue (background)
  sky.name = 'skyDome';
  scene.add(sky);
  return sky;
}

// Scratch colours — module-level to avoid per-frame allocation in the tick.
const _fogColor = new THREE.Color();
const _bgColor = new THREE.Color();
const _cGround = new THREE.Color(ENV_CONFIG.fogColorGround);
const _cSky = new THREE.Color(ENV_CONFIG.fogColorSky);
const _cBgGround = new THREE.Color(ENV_CONFIG.groundColor);
const _cBgSky = new THREE.Color(ENV_CONFIG.skyColor);
const _cChalk = new THREE.Color(ENV_CONFIG.chalkFogColor);
const _cWaterFog = new THREE.Color(ENV_CONFIG.waterFogColor);
const _cWaterBg = new THREE.Color(ENV_CONFIG.waterBgColor);
const _cSkyAir = new THREE.Color();
const _cBgSkyAir = new THREE.Color();
const _sunDir = new THREE.Vector3();

/**
 * Update environment based on camera height.
 * @param insideness  Continuous M25 membership [0,1] — replaces the old binary
 *   insideM25 switch (D5). 1 = deep inside the disc, 0 = outside; blended over a
 *   ~1500m band so the disc edge is a seam-free gradient, not a render cliff.
 * @param chalkBlend  Chalk stratum membership [0,1] (D3.2) — 0 in clay/air, 1
 *   well inside the chalk. Drives the dusty white-out. Already gated by
 *   insideness upstream, so it is naturally 0 outside the disc.
 * @param clayLift    Clay clarity gradient [0,1] (Item B) — camera height above
 *   the local chalk surface / clayClarityRamp. 1 = top of the clay column
 *   (daylight-like), 0 = at the chalk boundary (today's darkness). Above ground
 *   it is 1 by construction, so the surface regime is seamless.
 * @param chalkClarity Inside-chalk clarity [0,1] (Item B) — 0 at/above the
 *   chalk surface (the from-above white-out is untouched by construction),
 *   1 by chalkClarityRamp units below it. Releases fog distances so everything
 *   the camera can see looking up is unfogged; colour/bg stay chalk white.
 * @param submergedBlend Thames water-volume membership [0,1] (12Jul26u) — 0
 *   outside the river volume, 1 just below the rendered water top. Applied
 *   LAST so the murky underwater regime overrides all others; 0 by
 *   construction for any camera outside the river, so every existing regime
 *   is byte-identical when not submerged.
 */
export function updateEnvironment(camera, scene, sky, renderer, { insideness = 1, chalkBlend = 0, clayLift = 1, chalkClarity = 0, submergedBlend = 0 } = {}) {
  const y = camera.position.y;

  // Vertical blend (0 = below ground, 1 = above ground/sky). Outside the disc
  // (insideness→0) we force above-ground appearance, exactly as the old binary
  // switch did — but now continuously, so the M25 edge blends instead of snaps.
  const verticalBlend = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / (ENV_CONFIG.skyStartY * 0.6)));
  // Clay clarity lift (Item B): the fog/bg regime rides the LIFTED blend so the
  // clay column is a chalk-relative gradient up to the daylight endpoint. The
  // sky dome stays on the UN-lifted blend below — otherwise the camera-following
  // abyss dome renders underground.
  const verticalBlendLifted = Math.max(verticalBlend, clayLift);
  const surfaceBlend = THREE.MathUtils.lerp(1.0, verticalBlendLifted, insideness);
  const skyBlend = THREE.MathUtils.lerp(1.0, verticalBlend, insideness);

  // Time of day (Lane D) tints only the sky-side endpoints, and only by the
  // air weight, which is exactly 0 for any camera below the surface.
  _cSkyAir.copy(_cSky);
  _cBgSkyAir.copy(_cBgSky);
  if (_air.weight > 0) {
    _cSkyAir.lerp(_air.state.fogSky, _air.weight);
    _cBgSkyAir.lerp(_air.state.skyColor, _air.weight);
  }

  // Analytic sky (Lane S): the sky and disc show by the air weight (0 below
  // the surface and in the river), and the air fog is pulled towards the
  // sky's own horizon colour so distance and sky read as one atmosphere.
  if (_skySystem) {
    const skyWeight = _air.weight * (1 - chalkBlend) * (1 - submergedBlend);
    resolveSunDirection(_sunDir);
    const coupling = _skySystem.update({ camera, state: _air.state, direction: _sunDir,
      weight: skyWeight, discWeight: skyWeight, fogOut: _cSkyHorizon });
    if (coupling > 0) _cSkyAir.lerp(_cSkyHorizon, coupling * _air.weight);
    _skyHazeWeight = coupling * skyWeight;
  } else {
    _skyHazeWeight = 0;
  }

  // Base fog colour: airy-clay graphite underground → warm-grey toward sky.
  _fogColor.copy(_cGround).lerp(_cSkyAir, surfaceBlend);

  if (scene.fog) {
    // Fog near: push far out above ground, keep tight underground.
    const altFactor = Math.min(1, Math.max(0, y / 1000));
    let fogNear = ENV_CONFIG.fogNear * (0.5 + surfaceBlend * (24 + altFactor * 25));

    // Dynamic fog.far: extend for both macro pullback AND altitude. The old
    // 0.5× underground tightening is REMOVED (D4.1) — clay reads open, not murk.
    // Underground far is now the full base (25000 = 2× the old tightened value),
    // safely under the 50000 far plane.
    const camDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
    const baseFar = ENV_CONFIG.fogFar;
    const macroFar = 60000;
    const fogFarBlend = Math.min(1, Math.max(0, (camDist - 10000) / 10000));
    const altBlend = Math.min(1, Math.max(0, y / 1500));
    const altFar = baseFar + (macroFar - baseFar) * altBlend;
    let fogFar = Math.max(baseFar + (macroFar - baseFar) * fogFarBlend, altFar);

    // Chalk white-out (D3.3): lerp fog toward dusty warm white + clamp visibility.
    if (chalkBlend > 0) {
      _fogColor.lerp(_cChalk, chalkBlend);
      fogNear = THREE.MathUtils.lerp(fogNear, ENV_CONFIG.chalkFogNear, chalkBlend);
      fogFar = THREE.MathUtils.lerp(fogFar, ENV_CONFIG.chalkFogFar, chalkBlend);
    }

    // Inside-chalk perfect clarity (Item B): release fog DISTANCES only, after
    // the white-out lerp. Colour stays chalk white and the bg stays 0xded6c4,
    // so the void below still reads chalky while every up-view feature is
    // unfogged at any distance. chalkClarity is 0 for any camera above the
    // chalk surface, so the from-above (clay-side) white-out is byte-identical.
    if (chalkClarity > 0) {
      fogNear = THREE.MathUtils.lerp(fogNear, ENV_CONFIG.clarityFogNear, chalkClarity);
      fogFar = THREE.MathUtils.lerp(fogFar, ENV_CONFIG.clarityFogFar, chalkClarity);
    }

    // Submerged (12Jul26u): murky green-brown short fog. LAST lerp — inside
    // the Thames volume this overrides surface/chalk/clarity entirely.
    if (submergedBlend > 0) {
      _fogColor.lerp(_cWaterFog, submergedBlend);
      fogNear = THREE.MathUtils.lerp(fogNear, ENV_CONFIG.waterFogNear, submergedBlend);
      fogFar = THREE.MathUtils.lerp(fogFar, ENV_CONFIG.waterFogFar, submergedBlend);
    }

    scene.fog.color.copy(_fogColor);
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
  }

  // Infra haze strength (one uniform, one owner — see infra-materials.js).
  // Active only for underground cameras inside the disc and outside the chalk:
  // that is the clay regime, whose wide fog.far (25000) is what let distant
  // edge-on Crossrail composite into the yellow horizon band (D4.3). Uses the
  // UN-lifted verticalBlend deliberately — clayLift brightens the shallow clay
  // column, but the band mechanism (long sightlines underground) is unchanged
  // there. Zero in chalk by BOTH gates, so the atmosphere pass's inside-chalk
  // perfect-clarity ("visible at ANY distance") holds with no extra wiring;
  // a future chalk-look-up mode can force 0 through this same call.
  setInfraHazeStrength(
    (1 - verticalBlend) * insideness * (1 - chalkBlend) * (1 - chalkClarity) * (1 - submergedBlend)
  );

  // Update sky visibility — hidden underground and inside the chalk clouding.
  // The 0.45 above-horizon blend is now baked into the texture alpha (see
  // createSkyDome), so the master opacity is just the altitude/underground/chalk
  // fade. Above ground it saturates to ~surfaceBlend, letting the baked
  // per-hemisphere alpha decide the actual coverage: ~0.45 above the horizon
  // (unchanged blue sky) and ~1.0 at the nadir (opaque dark abyss, D1.4).
  if (sky) {
    // Recentre the abyss-cap on the camera so its equator tracks the true
    // horizon and it always renders within the 50000 far plane (see createSkyDome).
    // UN-lifted skyBlend here (not surfaceBlend): clayLift must brighten
    // fog/lights only — the abyss dome has no business rendering underground.
    sky.position.copy(camera.position);
    const ordinarySkyOpacity=skyBlend * (1 - chalkBlend) * (1 - submergedBlend);
    sky.material.opacity = Math.max(ordinarySkyOpacity,submergedBlend);
    sky.visible = (skyBlend > 0.01 && chalkBlend < 0.99 && submergedBlend < 0.99) || submergedBlend > 0.001;
    if(sky.userData.submergedSky)sky.userData.submergedSky.value=submergedBlend;
    if (sky.userData.horizonHazeWeight) {
      sky.userData.horizonHaze.value.copy(_fogColor);
      sky.userData.horizonHazeWeight.value = _skyHazeWeight;
      sky.userData.horizonHazeNear.value = scene.fog?.near ?? 1;
      sky.userData.horizonHazeFar.value = Math.max(scene.fog?.far ?? 2, (scene.fog?.near ?? 1) + 1);
    }
  }

  // Background colour: clay graphite → sky; then flooded dusty white in chalk so
  // gaps between geometry read as clouding, not void.
  _bgColor.copy(_cBgGround).lerp(_cBgSkyAir, surfaceBlend);
  if (chalkBlend > 0) _bgColor.lerp(_cChalk, chalkBlend);
  if (submergedBlend > 0) _bgColor.lerp(_cWaterBg, submergedBlend);

  // Update renderer background
  if (renderer) {
    renderer.setClearColor(_bgColor, 1);
  }
  if (_skySystem) {
    _skySystem.setHaze(_fogColor, scene.fog?.near ?? 1, scene.fog?.far ?? 2, _skyHazeWeight);
    _skySystem.setClear(_bgColor);
  }

  return {
    surfaceBlend,
    chalkBlend,
    bgColor: _bgColor,
    isAboveGround: y > ENV_CONFIG.surfaceY
  };
}

// Create atmospheric lighting
export function createAtmosphere(scene) {
  // Ambient light - base illumination
  const ambient = new THREE.AmbientLight(0xffffff, ENV_CONFIG.ambientAbove);
  ambient.name = 'ambientLight';
  scene.add(ambient);

  // Directional "sun" light - only affects above-ground areas primarily
  const sun = new THREE.DirectionalLight(0xfff4e6, ENV_CONFIG.sunIntensity);
  sun.name = 'sunLight';
  sun.position.set(2000, 600, 1500);
  // Shadows are configured by sun.js (near-camera, toggleable); without it the
  // light casts nothing, as before.
  sun.castShadow = false;
  scene.add(sun);

  // Underground fill light - warm brown from below (complements rock face)
  const underground = new THREE.DirectionalLight(0x7a6a55, 0.3);
  underground.name = 'undergroundLight';
  underground.position.set(0, -500, 0);
  scene.add(underground);

  // Street-level hemisphere fill (D7) — warm sky above, cool-earth bounce below.
  // Intensity is driven per-frame in updateLighting: strong at eye level, fully
  // faded by altitude so the overview keeps its dusk mood. Starts at 0.
  const hemi = new THREE.HemisphereLight(ENV_CONFIG.hemiSky, ENV_CONFIG.hemiGround, 0.0);
  hemi.name = 'hemiFill';
  scene.add(hemi);

  return { ambient, sun, underground, hemi };
}

// Update lighting based on camera position.
// insideness (D5) + chalkBlend (D3.3) + clayLift/chalkClarity (Item B) mirror
// updateEnvironment's params.
export function updateLighting(camera, lights, { insideness = 1, chalkBlend = 0, clayLift = 1, chalkClarity = 0, submergedBlend = 0 } = {}) {
  if (!lights) return;

  const y = camera.position.y;
  // Lighting "above-ground-ness" saturates by rooftop height, NOT skyStartY.
  // Street level (Y≈60-80) previously sat at ~30% of day light — the D7 near-
  // black. This ramp reaches full day by lightFullY so eye level is legible;
  // altitude views are already at 1 either way, so the overview is unchanged.
  const groundRamp = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / ENV_CONFIG.lightFullY));
  const lightBlend = THREE.MathUtils.lerp(1.0, groundRamp, insideness);
  // Clay clarity lift (Item B): ambient/sun/fill ride the lifted blend so the
  // clay column brightens toward the daylight endpoint near street depth.
  // The HEMISPHERE light stays on the ORIGINAL groundRamp-based blend — hemi
  // is a street-level building-face device; a warm sky-bounce on tunnel
  // ceilings would read wrong.
  const lightBlendLifted = Math.max(lightBlend, clayLift * insideness);

  // Adjust ambient light intensity, then raise toward the bright white-tinted
  // chalk clouding (D3.3) — chalk is a BRIGHT clouding, opposite of clay's dark.
  let ambient = THREE.MathUtils.lerp(ENV_CONFIG.ambientBelow, ENV_CONFIG.ambientAbove, lightBlendLifted);
  ambient = THREE.MathUtils.lerp(ambient, ENV_CONFIG.chalkAmbient, chalkBlend);
  // Inside chalk (Item B): lift ambient further so up-view features are
  // actually LIT, not just unfogged. 0 above the chalk surface by construction.
  ambient = THREE.MathUtils.lerp(ambient, ENV_CONFIG.chalkClarityAmbient, chalkClarity);
  // Submerged (12Jul26u): LAST lerp — dim, even underwater ambient.
  ambient = THREE.MathUtils.lerp(ambient, ENV_CONFIG.waterAmbient, submergedBlend);
  // Time of day (Lane D): scale and tint by the air weight (0 underground).
  const airW = _air.weight;
  lights.ambient.intensity = airW > 0 ? ambient * THREE.MathUtils.lerp(1, _air.state.ambientFactor, airW) : ambient;
  lights.ambient.color.copy(_cWhite);
  if (airW > 0) lights.ambient.color.lerp(_air.state.ambientColor, airW);

  // Sun becomes stronger above ground; dimmed underwater (submerged LAST).
  let sun = THREE.MathUtils.lerp(0.2, ENV_CONFIG.sunIntensity, lightBlendLifted);
  sun = THREE.MathUtils.lerp(sun, ENV_CONFIG.waterSun, submergedBlend);
  lights.sun.intensity = airW > 0 ? sun * THREE.MathUtils.lerp(1, _air.state.sunFactor, airW) : sun;
  lights.sun.color.set(0xfff4e6);
  if (airW > 0) lights.sun.color.lerp(_air.state.sunColor, airW);
  // Direction: legacy underground; the slider's sun in the air. The light sits
  // up-sun of its target (sun.js moves the target to the shadow square).
  resolveSunDirection(_sunDir);
  if (airW <= 0 && _air.distance === undefined && lights.sun.target.position.lengthSq() === 0) {
    lights.sun.position.set(...LEGACY_SUN_POSITION);
  } else {
    lights.sun.position.copy(lights.sun.target.position)
      .addScaledVector(_sunDir, _air.distance ?? _legacyDistance);
  }

  // Underground light fades as we go up
  lights.underground.intensity = THREE.MathUtils.lerp(0.15, 0, lightBlendLifted);

  // Street-level hemisphere fill (D7): full at eye level, faded out by altitude
  // so the overview is untouched. Zeroed underground via groundRamp.
  if (lights.hemi) {
    const eyeFactor = 1 - THREE.MathUtils.smoothstep(y, ENV_CONFIG.hemiFadeLow, ENV_CONFIG.hemiFadeHigh);
    // Warm sky-bounce reads wrong underwater — same rationale as the clayLift
    // exclusion above, so the hemi is multiplied out by submergedBlend.
    lights.hemi.intensity = ENV_CONFIG.hemiStreet * eyeFactor * lightBlend * (1 - submergedBlend);
    if (airW > 0) lights.hemi.intensity *= THREE.MathUtils.lerp(1, _air.state.hemiFactor, airW);
    lights.hemi.color.copy(_cHemiSky);
    if (airW > 0) lights.hemi.color.lerp(_air.state.hemiSky, airW);
  }
}
