import * as THREE from 'three';
import UPNG from 'upng-js';

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
  // The heightmap values (0-255 in 16-bit container) are normalised to 0..1 floats.
  // displacementScale of 120 with bias -60 gives terrain displacement from -60 to +60
  // scene units, centred around the base plane. London's elevation range (~0-130m)
  // maps well to this with the normalised data.
  displacementScale: 120,
  displacementBias: -60,
  opacity: 1.0,

  // Color theming - bright, distinct from background
  color: 0x5a6a7a,
  roughness: 0.8,
  metalness: 0.1,
};

/**
 * Decode a 16-bit PNG heightmap properly, bypassing the browser's <img> element
 * which destroys 16-bit precision by quantising to 8-bit.
 *
 * Returns { floats: Float32Array (normalised 0..1), width, height }.
 */
async function load16bitHeightmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch heightmap: ${res.status}`);
  const buf = await res.arrayBuffer();
  const png = UPNG.decode(buf);

  const w = png.width;
  const h = png.height;
  const depth = png.depth;   // bits per channel
  const ctype = png.ctype;   // 0 = greyscale

  // UPNG.toRGBA8 always converts to 8-bit RGBA — useless for 16-bit data.
  // Instead, read the raw decoded buffer directly.
  // For 16-bit greyscale (ctype 0, depth 16): each pixel is 2 bytes big-endian.
  const raw = new Uint8Array(png.data);

  let floats;
  let maxVal;

  if (depth === 16) {
    // 16-bit greyscale: 2 bytes per pixel, big-endian
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    // Find the actual data range first for optimal normalisation
    let minRaw = 65535, maxRaw = 0;
    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      if (val < minRaw) minRaw = val;
      if (val > maxRaw) maxRaw = val;
    }
    maxVal = maxRaw;
    const range = maxRaw - minRaw || 1;
    console.log(`Heightmap 16-bit: ${w}x${h}, raw range ${minRaw}–${maxRaw}, normalising to 0..1`);

    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      floats[i] = (val - minRaw) / range;
    }
  } else {
    // 8-bit fallback
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    let minRaw = 255, maxRaw = 0;
    for (let i = 0; i < pixelCount; i++) {
      if (raw[i] < minRaw) minRaw = raw[i];
      if (raw[i] > maxRaw) maxRaw = raw[i];
    }
    maxVal = maxRaw;
    const range = maxRaw - minRaw || 1;
    console.log(`Heightmap 8-bit: ${w}x${h}, raw range ${minRaw}–${maxRaw}, normalising to 0..1`);
    for (let i = 0; i < pixelCount; i++) {
      floats[i] = (raw[i] - minRaw) / range;
    }
  }

  return { floats, width: w, height: h, maxVal };
}

export async function tryCreateTerrainMesh({ opacity = TERRAIN_CONFIG.opacity, wireframe = false } = {}) {
  // Looks for generated outputs from scripts/build-heightmap.mjs
  // Expected files (served from /public/data):
  // - /data/terrain/london_full_height_u16.png (full London coverage, 10m res)
  // - /data/terrain/london_full_height.json
  // Fallback:
  // - /data/terrain/victoria_dtm_u16.png (Victoria AOI only)
  // - /data/terrain/victoria_dtm_u16.json
  try {
    // Try each metadata file in order. Vite's dev server returns 200 + HTML for
    // missing files (SPA fallback), so we must also catch JSON parse errors.
    let meta = null;
    for (const path of ['/data/terrain/london_full_height.json', '/data/terrain/victoria_dtm_u16.json']) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;  // Skip HTML fallback responses
        meta = await res.json();
        break;
      } catch { /* not valid JSON, try next */ }
    }
    if (!meta) return null;

    // Decode 16-bit PNG properly — browser <img> destroys 16-bit precision
    const hm = await load16bitHeightmap(`/data/terrain/${meta.heightmap}`);

    const [xmin, ymin, xmax, ymax] = meta.bounds_m;
    const widthM = xmax - xmin;
    const heightM = ymax - ymin;

    const size = TERRAIN_CONFIG.size;
    const segments = TERRAIN_CONFIG.segments;
    const scale = TERRAIN_CONFIG.displacementScale;
    const bias = TERRAIN_CONFIG.displacementBias;

    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    // CPU-side vertex displacement — more reliable than GPU displacementMap
    // which requires float texture support in the vertex shader.
    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      // Sample heightmap at this vertex's UV coordinate
      const px = Math.min(hm.width - 1, Math.round(u * (hm.width - 1)));
      const py = Math.min(hm.height - 1, Math.round((1 - v) * (hm.height - 1)));
      const h01 = hm.floats[py * hm.width + px];
      // Displace along Y (up) — geometry already rotated to face up
      pos.setY(i, pos.getY(i) + h01 * scale + bias);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals(); // Recompute normals for proper lighting

    console.log('Terrain: CPU displacement applied to', pos.count, 'vertices');

    const mat = new THREE.MeshStandardMaterial({
      color: TERRAIN_CONFIG.color,
      roughness: TERRAIN_CONFIG.roughness,
      metalness: TERRAIN_CONFIG.metalness,
      transparent: false,
      opacity: opacity,
      depthWrite: true,
      wireframe: !!wireframe,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = TERRAIN_CONFIG.baseY;
    mesh.name = 'terrainMesh';
    console.log('Terrain mesh created:', {
      position: mesh.position,
      opacity: mat.opacity,
      transparent: mat.transparent,
      visible: mesh.visible,
      vertexCount: pos.count,
      cpuDisplacement: { scale, bias },
    });

    // Convenience sampler: read normalised height (0..1) from the decoded float data.
    // Used to snap station shafts to terrain surface.
    let heightSampler = null;
    try {
      const { floats, width: tw, height: th } = hm;
      heightSampler = (u, v) => {
        const uu = Math.min(1, Math.max(0, u));
        const vv = Math.min(1, Math.max(0, v));
        const x = Math.round(uu * (tw - 1));
        const y = Math.round((1 - vv) * (th - 1)); // flip v (texture origin top-left)
        return floats[y * tw + x];
      };
    } catch {
      // ignore
    }

    return { mesh, meta, widthM, heightM, heightSampler };
  } catch (err) {
    console.error('Terrain mesh creation failed:', err);
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
