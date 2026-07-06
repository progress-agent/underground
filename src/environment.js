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
  fogColorGround: 0x1a1510, // Darker warm fog underground

  // Fog distances - wider range for clearer visibility
  fogNear: 200,
  fogFar: 25000,

  // Lighting intensities
  ambientAbove: 0.6,
  ambientBelow: 0.25,
  sunIntensity: 1.5,
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

// Update environment based on camera height
export function updateEnvironment(camera, scene, sky, renderer, { insideM25 = true } = {}) {
  const y = camera.position.y;

  // Calculate blend factor (0 = below ground, 1 = above ground/sky)
  // Lower threshold so sky becomes visible earlier when ascending
  // When outside M25, force above-ground appearance (surfaceBlend = 1)
  const surfaceBlend = insideM25
    ? Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / (ENV_CONFIG.skyStartY * 0.6)))
    : 1.0;

  // Update fog color and density
  const fogColor = new THREE.Color().lerpColors(
    new THREE.Color(ENV_CONFIG.fogColorGround),
    new THREE.Color(ENV_CONFIG.fogColorSky),
    surfaceBlend
  );

  if (scene.fog) {
    scene.fog.color.copy(fogColor);
    // Fog near: push far out above ground, keep tight underground
    // Underground (surfaceBlend=0): 100m. Ground (alt=0): ~5000m. Altitude 1000m+: ~10000m.
    const altFactor = Math.min(1, Math.max(0, y / 1000));
    scene.fog.near = ENV_CONFIG.fogNear * (0.5 + surfaceBlend * (24 + altFactor * 25));

    // Dynamic fog.far: extend for both macro pullback AND altitude
    const camDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
    const baseFar = ENV_CONFIG.fogFar;
    const macroFar = 60000;
    const fogFarBlend = Math.min(1, Math.max(0, (camDist - 10000) / 10000));
    const altBlend = Math.min(1, Math.max(0, y / 1500));
    const altFar = baseFar + (macroFar - baseFar) * altBlend;
    scene.fog.far = Math.max(baseFar + (macroFar - baseFar) * fogFarBlend, altFar);

    // Underground: tighten fog for atmospheric depth
    if (surfaceBlend < 0.3) {
      scene.fog.far *= (0.5 + surfaceBlend * 1.67);
    }
  }

  // Update sky visibility — hidden underground to avoid wash-out over BackSide terrain
  if (sky) {
    sky.material.opacity = surfaceBlend * 0.45;
    sky.visible = surfaceBlend > 0.01;
  }

  // Update background color
  const bgColor = new THREE.Color().lerpColors(
    new THREE.Color(ENV_CONFIG.groundColor),
    new THREE.Color(ENV_CONFIG.skyColor),
    surfaceBlend
  );

  // Update renderer background
  if (renderer) {
    renderer.setClearColor(bgColor, 1);
  }

  return {
    surfaceBlend,
    bgColor,
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

  return { ambient, sun, underground };
}

// Update lighting based on camera position
export function updateLighting(camera, lights, { insideM25 = true } = {}) {
  if (!lights) return;

  const y = camera.position.y;
  // When outside M25, force above-ground lighting (surfaceBlend = 1)
  const surfaceBlend = insideM25
    ? Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / ENV_CONFIG.skyStartY))
    : 1.0;

  // Adjust ambient light intensity
  lights.ambient.intensity = THREE.MathUtils.lerp(
    ENV_CONFIG.ambientBelow,
    ENV_CONFIG.ambientAbove,
    surfaceBlend
  );

  // Sun becomes stronger above ground
  lights.sun.intensity = THREE.MathUtils.lerp(0.2, ENV_CONFIG.sunIntensity, surfaceBlend);

  // Underground light fades as we go up
  lights.underground.intensity = THREE.MathUtils.lerp(0.15, 0, surfaceBlend);
}
