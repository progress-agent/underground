import * as THREE from 'three';

// Terrain configuration for London full coverage heightmap
// Processed by Wisdom on MacBook M5, transferred to VPS
// File: london_full_height_u16.png (14183×11499 pixels, 10m resolution, EPSG:27700)
// Bounds: 468733–610563 E, 122779–237769 N (British National Grid)
export const TERRAIN_CONFIG = {
  // Source files
  metaPath: '/data/terrain/london_full_height.json',
  fallbackMetaPath: '/data/terrain/victoria_dtm_u16.json',
  
  // Geographic bounds (EPSG:27700 - British National Grid)
  bounds: {
    xmin: 468733,  // Easting min
    ymin: 122779,  // Northing min
    xmax: 610563,  // Easting max
    ymax: 237769,  // Northing max
  },
  
  // Scene configuration
  size: 28000,           // Visual size in scene units (metres) - covers central London
  segments: 256,         // Plane geometry segments
  baseY: -6.0,           // Base elevation offset
  
  // Material/displacement settings
  displacementScale: 120,
  displacementBias: -60,
  opacity: 1.0,

  // Color theming - bright, distinct from background
  color: 0x5a6a7a,
  roughness: 0.8,
  metalness: 0.1,
};

export async function tryCreateTerrainMesh({ opacity = TERRAIN_CONFIG.opacity, wireframe = false } = {}) {
  // Looks for generated outputs from scripts/build-heightmap.mjs
  // Expected files (served from /public/data):
  // - /data/terrain/london_full_height_u16.png (full London coverage, 10m res)
  // - /data/terrain/london_full_height.json
  // Fallback:
  // - /data/terrain/victoria_dtm_u16.png (Victoria AOI only)
  // - /data/terrain/victoria_dtm_u16.json
  try {
    // Prefer full London heightmap if available
    let metaRes = await fetch('/data/terrain/london_full_height.json', { cache: 'no-store' });
    if (!metaRes.ok) {
      // Fallback to Victoria AOI
      metaRes = await fetch('/data/terrain/victoria_dtm_u16.json', { cache: 'no-store' });
    }
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();

    const tex = await new THREE.TextureLoader().loadAsync(`/data/terrain/${meta.heightmap}`);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const [xmin, ymin, xmax, ymax] = meta.bounds_m;
    const widthM = xmax - xmin;
    const heightM = ymax - ymin;

    // Our scene x/z are in local metres from ORIGIN (WGS84 tangent plane-ish).
    // The heightmap is in EPSG:27700 metres. We'll use it *visually* for now:
    // render a displaced plane roughly under the network.

    const size = TERRAIN_CONFIG.size;
    const segments = TERRAIN_CONFIG.segments;

    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: TERRAIN_CONFIG.color,
      roughness: TERRAIN_CONFIG.roughness,
      metalness: TERRAIN_CONFIG.metalness,
      transparent: false,
      opacity: 1.0,
      displacementMap: tex,
      displacementScale: TERRAIN_CONFIG.displacementScale,
      displacementBias: TERRAIN_CONFIG.displacementBias,
      wireframe: !!wireframe,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = TERRAIN_CONFIG.baseY;
    mesh.name = 'terrainMesh';
    console.log('Terrain mesh created:', { 
      position: mesh.position, 
      opacity: mat.opacity, 
      visible: mesh.visible,
      color: mat.color.getHexString(),
      displacementScale: mat.displacementScale
    });

    // Convenience sampler: read "height" from the displacement map by sampling the same
    // texture used by the terrain material. This is approximate (no geo alignment yet)
    // but good enough to drive surface markers.
    // Returns a value in [0..1] where 0 is black and 1 is white.
    let heightSampler = null;
    try {
      const img = tex.image;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      heightSampler = (u, v) => {
        const uu = Math.min(1, Math.max(0, u));
        const vv = Math.min(1, Math.max(0, v));
        const x = Math.round(uu * (canvas.width - 1));
        const y = Math.round((1 - vv) * (canvas.height - 1)); // flip v (canvas origin top-left)
        const i = (y * canvas.width + x) * 4;
        return data[i] / 255; // red channel
      };
    } catch {
      // ignore
    }

    return { mesh, meta, widthM, heightM, heightSampler };
  } catch {
    return null;
  }
}

export function terrainHeightToWorldY({ 
  h01, 
  displacementScale = TERRAIN_CONFIG.displacementScale, 
  displacementBias = TERRAIN_CONFIG.displacementBias, 
  baseY = TERRAIN_CONFIG.baseY 
} = {}) {
  // MeshStandardMaterial displacement: y += h * scale + bias
  // Our plane is centered at baseY.
  const h = Number.isFinite(h01) ? h01 : 0;
  return baseY + (h * displacementScale + displacementBias);
}

export function xzToTerrainUV({
  x,
  z,
  terrainSize = TERRAIN_CONFIG.size,
} = {}) {
  // PlaneGeometry(size,size) is centered at origin.
  // Convert world x/z -> UV [0..1]
  const u = (x + terrainSize / 2) / terrainSize;
  const v = (z + terrainSize / 2) / terrainSize;
  return { u, v };
}

// Environment configuration for above/below ground differentiation
export const ENV_CONFIG = {
  // Altitude thresholds (in scene units/metres)
  surfaceY: 0,           // Ground level
  skyStartY: 100,        // Where sky becomes visible (lowered for earlier visibility)
  fogDepthY: -50,        // Where underground fog thickens

  // Colors - lighter for better visibility
  skyColor: 0x87CEEB,    // Sky blue (above)
  groundColor: 0x1a2a3a, // Lighter dark underground (below)
  fogColorSky: 0xa0d0f0, // Lighter fog when above ground
  fogColorGround: 0x1a2a3a, // Match ground color when below

  // Fog distances - wider range for clearer visibility
  fogNear: 200,
  fogFar: 25000,

  // Lighting intensities
  ambientAbove: 0.6,
  ambientBelow: 0.25,
  sunIntensity: 1.2,
};

// Create sky dome (simple gradient hemisphere)
export function createSkyDome(scene) {
  const geometry = new THREE.SphereGeometry(20000, 32, 32);
  
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
export function updateEnvironment(camera, scene, sky, renderer) {
  const y = camera.position.y;
  
  // Calculate blend factor (0 = below ground, 1 = above ground/sky)
  // Lower threshold so sky becomes visible earlier when ascending
  const surfaceBlend = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / (ENV_CONFIG.skyStartY * 0.6)));
  
  // Update fog color and density
  const fogColor = new THREE.Color().lerpColors(
    new THREE.Color(ENV_CONFIG.fogColorGround),
    new THREE.Color(ENV_CONFIG.fogColorSky),
    surfaceBlend
  );
  
  if (scene.fog) {
    scene.fog.color.copy(fogColor);
    // Underground: denser fog for mystery; Above: lighter fog for clarity
    scene.fog.near = ENV_CONFIG.fogNear * (0.5 + 0.5 * surfaceBlend);
  }
  
  // Update sky visibility - visible even from underground (dimly) to show "up"
  if (sky) {
    // Minimum 15% opacity even underground so you can see the sky direction
    // Full 90% opacity when above ground
    sky.material.opacity = 0.15 + (surfaceBlend * 0.75);
    sky.visible = true; // Always visible
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
  sun.position.set(1000, 2000, 1000);
  sun.castShadow = false; // Keep it simple, no shadows
  scene.add(sun);
  
  // Underground fill light - subtle blue from below
  const underground = new THREE.DirectionalLight(0x4a6fa5, 0.3);
  underground.name = 'undergroundLight';
  underground.position.set(0, -500, 0);
  scene.add(underground);
  
  return { ambient, sun, underground };
}

// Update lighting based on camera position
export function updateLighting(camera, lights) {
  if (!lights) return;
  
  const y = camera.position.y;
  const surfaceBlend = Math.max(0, Math.min(1, (y - ENV_CONFIG.surfaceY) / ENV_CONFIG.skyStartY));
  
  // Adjust ambient light intensity
  lights.ambient.intensity = THREE.MathUtils.lerp(
    ENV_CONFIG.ambientBelow,
    ENV_CONFIG.ambientAbove,
    surfaceBlend
  );
  
  // Sun becomes stronger above ground
  lights.sun.intensity = THREE.MathUtils.lerp(0.2, ENV_CONFIG.sunIntensity, surfaceBlend);
  
  // Underground light fades as we go up
  lights.underground.intensity = THREE.MathUtils.lerp(0.4, 0, surfaceBlend);
}
