import * as THREE from 'three';

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

// Create sky dome (simple gradient hemisphere)
export function createSkyDome(scene) {
  const geometry = new THREE.SphereGeometry(80000, 32, 32);

  // Create a simple gradient texture for the sky
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#4a90d9'); // Deep blue at top
  gradient.addColorStop(0.5, '#87CEEB'); // Sky blue at middle
  gradient.addColorStop(1, '#e8f4f8'); // Light near horizon
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.0, // Start invisible, fade in based on camera
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
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

/**
 * Update environment based on camera height.
 * @param insideness  Continuous M25 membership [0,1] — replaces the old binary
 *   insideM25 switch (D5). 1 = deep inside the disc, 0 = outside; blended over a
 *   ~1500m band so the disc edge is a seam-free gradient, not a render cliff.
 * @param chalkBlend  Chalk stratum membership [0,1] (D3.2) — 0 in clay/air, 1
 *   well inside the chalk. Drives the dusty white-out. Already gated by
 *   insideness upstream, so it is naturally 0 outside the disc.
 */
export function updateEnvironment(camera, scene, sky, renderer, { insideness = 1, chalkBlend = 0 } = {}) {
  const y = camera.position.y;

  // Vertical blend (0 = below ground, 1 = above ground/sky). Outside the disc
  // (insideness→0) we force above-ground appearance, exactly as the old binary
  // switch did — but now continuously, so the M25 edge blends instead of snaps.
  const verticalBlend = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / (ENV_CONFIG.skyStartY * 0.6)));
  const surfaceBlend = THREE.MathUtils.lerp(1.0, verticalBlend, insideness);

  // Base fog colour: airy-clay graphite underground → warm-grey toward sky.
  _fogColor.copy(_cGround).lerp(_cSky, surfaceBlend);

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

    scene.fog.color.copy(_fogColor);
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
  }

  // Update sky visibility — hidden underground and inside the chalk clouding.
  if (sky) {
    sky.material.opacity = surfaceBlend * 0.45 * (1 - chalkBlend);
    sky.visible = surfaceBlend > 0.01 && chalkBlend < 0.99;
  }

  // Background colour: clay graphite → sky; then flooded dusty white in chalk so
  // gaps between geometry read as clouding, not void.
  _bgColor.copy(_cBgGround).lerp(_cBgSky, surfaceBlend);
  if (chalkBlend > 0) _bgColor.lerp(_cChalk, chalkBlend);

  // Update renderer background
  if (renderer) {
    renderer.setClearColor(_bgColor, 1);
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
  sun.castShadow = false; // Keep it simple, no shadows
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
// insideness (D5) + chalkBlend (D3.3) mirror updateEnvironment's params.
export function updateLighting(camera, lights, { insideness = 1, chalkBlend = 0 } = {}) {
  if (!lights) return;

  const y = camera.position.y;
  // Lighting "above-ground-ness" saturates by rooftop height, NOT skyStartY.
  // Street level (Y≈60-80) previously sat at ~30% of day light — the D7 near-
  // black. This ramp reaches full day by lightFullY so eye level is legible;
  // altitude views are already at 1 either way, so the overview is unchanged.
  const groundRamp = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / ENV_CONFIG.lightFullY));
  const lightBlend = THREE.MathUtils.lerp(1.0, groundRamp, insideness);

  // Adjust ambient light intensity, then raise toward the bright white-tinted
  // chalk clouding (D3.3) — chalk is a BRIGHT clouding, opposite of clay's dark.
  let ambient = THREE.MathUtils.lerp(ENV_CONFIG.ambientBelow, ENV_CONFIG.ambientAbove, lightBlend);
  ambient = THREE.MathUtils.lerp(ambient, ENV_CONFIG.chalkAmbient, chalkBlend);
  lights.ambient.intensity = ambient;

  // Sun becomes stronger above ground
  lights.sun.intensity = THREE.MathUtils.lerp(0.2, ENV_CONFIG.sunIntensity, lightBlend);

  // Underground light fades as we go up
  lights.underground.intensity = THREE.MathUtils.lerp(0.15, 0, lightBlend);

  // Street-level hemisphere fill (D7): full at eye level, faded out by altitude
  // so the overview is untouched. Zeroed underground via groundRamp.
  if (lights.hemi) {
    const eyeFactor = 1 - THREE.MathUtils.smoothstep(y, ENV_CONFIG.hemiFadeLow, ENV_CONFIG.hemiFadeHigh);
    lights.hemi.intensity = ENV_CONFIG.hemiStreet * eyeFactor * lightBlend;
  }
}
