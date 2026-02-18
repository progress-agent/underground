import * as THREE from 'three';
import UPNG from 'upng-js';

// BNG reference point for the scene ORIGIN (51.5074°N, 0.1278°W)
// Trafalgar Square ≈ TQ 300 804 ≈ E 530000, N 180400 in British National Grid
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Terrain configuration
export const TERRAIN_CONFIG = {
  // Source files (tried in order)
  metaPath: '/data/terrain/london_full_height.json',
  fallbackMetaPath: '/data/terrain/victoria_dtm_u16.json',

  // Geometry resolution — 512 segments gives ~27m per vertex on a 14km tile
  segments: 512,

  // Vertical exaggeration for terrain elevation.
  // London's real relief (~0–130m) is invisible at 1:1 on a 14km plane.
  // 3× makes hills clearly visible without overwhelming the scene.
  verticalExaggeration: 3,

  // Material
  opacity: 1.0,
  roughness: 0.8,
  metalness: 0.1,

  // Legacy — kept so old callers don't break; no longer used for displacement
  size: 28000,
  baseY: -6.0,
  displacementScale: 120,
  displacementBias: -60,
};

// Module-level terrain state — set by tryCreateTerrainMesh, read by helper functions
let terrainState = null;

/**
 * Decode a 16-bit PNG heightmap properly, bypassing the browser's <img> element
 * which destroys 16-bit precision by quantising to 8-bit.
 *
 * Returns { floats: Float32Array (normalised 0..1), width, height, minRaw, rawRange }.
 */
async function load16bitHeightmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch heightmap: ${res.status}`);
  const buf = await res.arrayBuffer();
  const png = UPNG.decode(buf);

  const w = png.width;
  const h = png.height;
  const depth = png.depth;   // bits per channel

  // UPNG.toRGBA8 always converts to 8-bit RGBA — useless for 16-bit data.
  // Instead, read the raw decoded buffer directly.
  // For 16-bit greyscale (ctype 0, depth 16): each pixel is 2 bytes big-endian.
  const raw = new Uint8Array(png.data);

  let floats;
  let minRaw, rawRange;

  if (depth === 16) {
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    let minR = 65535, maxR = 0;
    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      if (val < minR) minR = val;
      if (val > maxR) maxR = val;
    }
    minRaw = minR;
    rawRange = maxR - minR || 1;
    console.log(`Heightmap 16-bit: ${w}x${h}, raw range ${minR}–${maxR}, normalising to 0..1`);

    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      floats[i] = (val - minR) / rawRange;
    }
  } else {
    // 8-bit fallback
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    let minR = 255, maxR = 0;
    for (let i = 0; i < pixelCount; i++) {
      if (raw[i] < minR) minR = raw[i];
      if (raw[i] > maxR) maxR = raw[i];
    }
    minRaw = minR;
    rawRange = maxR - minR || 1;
    console.log(`Heightmap 8-bit: ${w}x${h}, raw range ${minR}–${maxR}, normalising to 0..1`);
    for (let i = 0; i < pixelCount; i++) {
      floats[i] = (raw[i] - minR) / rawRange;
    }
  }

  return { floats, width: w, height: h, minRaw, rawRange };
}

/**
 * Extract contour lines from displaced terrain geometry.
 * Marches through each triangle to find edges that cross contour Y-intervals,
 * then interpolates the crossing points to form line segments.
 */
function generateContourLines(geometry, intervalCount = 12) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!idx) return null;

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const step = (maxY - minY) / (intervalCount + 1);
  const intervals = [];
  for (let n = 1; n <= intervalCount; n++) intervals.push(minY + step * n);

  const points = [];
  for (const targetY of intervals) {
    for (let f = 0; f < idx.count; f += 3) {
      const i0 = idx.getX(f), i1 = idx.getX(f + 1), i2 = idx.getX(f + 2);
      const verts = [
        [pos.getX(i0), pos.getY(i0), pos.getZ(i0)],
        [pos.getX(i1), pos.getY(i1), pos.getZ(i1)],
        [pos.getX(i2), pos.getY(i2), pos.getZ(i2)],
      ];
      const crossings = [];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const ya = verts[a][1], yb = verts[b][1];
        if ((ya - targetY) * (yb - targetY) < 0) {
          const t = (targetY - ya) / (yb - ya);
          crossings.push(new THREE.Vector3(
            verts[a][0] + t * (verts[b][0] - verts[a][0]),
            targetY,
            verts[a][2] + t * (verts[b][2] - verts[a][2]),
          ));
        }
      }
      if (crossings.length === 2) points.push(crossings[0], crossings[1]);
    }
  }

  if (points.length === 0) return null;

  const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x8899aa,
    transparent: true,
    opacity: 0.25,
  });
  const lines = new THREE.LineSegments(lineGeom, lineMat);
  lines.name = 'terrainContours';
  console.log('Terrain contours:', points.length / 2, 'segments across', intervals.length, 'levels');
  return lines;
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

    // ── Geographic alignment ──────────────────────────────────────────
    // Convert BNG bounds from metadata to scene XZ coordinates.
    // Scene uses the same coordinate system as main.js llToXZ():
    //   x = (easting - BNG_REF_E)    [metres east from origin]
    //   z = -(northing - BNG_REF_N)  [metres south from origin]
    const [bngXmin, bngYmin, bngXmax, bngYmax] = meta.bounds_m;

    const swSceneX = bngXmin - BNG_REF_E;                 // west edge
    const swSceneZ = -(bngYmin - BNG_REF_N);              // south edge (positive Z)
    const neSceneX = bngXmax - BNG_REF_E;                 // east edge
    const neSceneZ = -(bngYmax - BNG_REF_N);              // north edge (negative Z)

    const terrainW = neSceneX - swSceneX;                  // east-west extent
    const terrainH = swSceneZ - neSceneZ;                  // north-south extent
    const centerX = (swSceneX + neSceneX) / 2;
    const centerZ = (swSceneZ + neSceneZ) / 2;

    const widthM = bngXmax - bngXmin;
    const heightM = bngYmax - bngYmin;

    console.log(`Terrain: BNG [${bngXmin},${bngYmin}]–[${bngXmax},${bngYmax}] → scene center (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), ${terrainW.toFixed(0)}×${terrainH.toFixed(0)}m`);

    // ── Geometry ──────────────────────────────────────────────────────
    const segments = TERRAIN_CONFIG.segments;
    const VE = TERRAIN_CONFIG.verticalExaggeration;

    const geom = new THREE.PlaneGeometry(terrainW, terrainH, segments, segments);
    geom.rotateX(-Math.PI / 2);
    // After rotation: X spans [-terrainW/2, +terrainW/2], Z spans [-terrainH/2, +terrainH/2]
    // PlaneGeometry UV mapping after rotateX(-PI/2):
    //   UV (0,0) → (X=-w/2, Z=-h/2) → north-west in scene (negative Z = north)
    //   UV (1,1) → (X=+w/2, Z=+h/2) → south-east in scene
    //   UV v=0 → Z=-h/2 (north),  UV v=1 → Z=+h/2 (south)
    //
    // Heightmap image convention (top-left origin):
    //   pixel (0,0) = NW = (bngXmin, bngYmax)
    //   pixel (w-1,h-1) = SE = (bngXmax, bngYmin)
    //
    // Correct sampling: UV v → py = v * (h-1)
    //   v=0 (north) → py=0 (top of image = NW = north) ✓
    //   v=1 (south) → py=h-1 (bottom of image = SW = south) ✓

    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;

    // ── First pass: compute physical elevation at each vertex ─────────
    // Use metadata bounds when available (properly encoded heightmaps);
    // fall back to raw pixel range for legacy heightmaps without metadata.
    const elevMin = meta.elev_min_m ?? hm.minRaw;
    const elevMax = meta.elev_max_m ?? (hm.minRaw + hm.rawRange);
    const elevRange = elevMax - elevMin;

    const elevations = new Float32Array(pos.count);
    let elevSum = 0;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const px = Math.min(hm.width - 1, Math.round(u * (hm.width - 1)));
      const py = Math.min(hm.height - 1, Math.round(v * (hm.height - 1)));
      const h01 = hm.floats[py * hm.width + px];
      const elevM = h01 * elevRange + elevMin;
      elevations[i] = elevM;
      elevSum += elevM;
    }
    const meanElev = elevSum / pos.count;

    // ── Second pass: displace vertices with vertical exaggeration ─────
    // Reference to sea level (0m AOD) so Y=0 = Ordnance Datum.
    // Central London (~10-15m) sits at Y=30-45, matching the camera start (Y=30).
    // Thames (~0m) at Y=0, hills rise above. Physically intuitive.
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, elevations[i] * VE);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // Store module-level state for helper functions (xzToTerrainUV, terrainHeightToWorldY)
    terrainState = {
      swSceneX, swSceneZ, neSceneX, neSceneZ,
      terrainW, terrainH, centerX, centerZ,
      VE,
      elevMin: meta.elev_min_m ?? hm.minRaw,
      elevRange: (meta.elev_max_m ?? (hm.minRaw + hm.rawRange)) - (meta.elev_min_m ?? hm.minRaw),
    };

    // ── Vertex colours by elevation ───────────────────────────────────
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const yRange = maxY - minY || 1;
    const lowCol = new THREE.Color(0x2d3d47);  // Dark slate (valleys/Thames)
    const midCol = new THREE.Color(0x4a5b52);  // Grey-green (mid-elevation)
    const highCol = new THREE.Color(0x6b7b6a); // Sage (hilltops)
    const colArr = new Float32Array(pos.count * 3);
    const tmpCol = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / yRange;
      if (t < 0.5) {
        tmpCol.copy(lowCol).lerp(midCol, t * 2);
      } else {
        tmpCol.copy(midCol).lerp(highCol, (t - 0.5) * 2);
      }
      colArr[i * 3] = tmpCol.r;
      colArr[i * 3 + 1] = tmpCol.g;
      colArr[i * 3 + 2] = tmpCol.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    console.log(`Terrain: ${pos.count} vertices, VE=${VE}×, Y range: ${minY.toFixed(1)}–${maxY.toFixed(1)}, mean elev: ${meanElev.toFixed(1)}m`);

    // ── Material ──────────────────────────────────────────────────────
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: TERRAIN_CONFIG.roughness,
      metalness: TERRAIN_CONFIG.metalness,
      transparent: false,
      opacity: opacity,
      depthWrite: true,
      wireframe: !!wireframe,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(centerX, 0, centerZ);
    mesh.name = 'terrainMesh';
    console.log('Terrain mesh created:', {
      position: `(${centerX.toFixed(0)}, 0, ${centerZ.toFixed(0)})`,
      extent: `${terrainW.toFixed(0)}×${terrainH.toFixed(0)}m`,
      vertexCount: pos.count,
      verticalExaggeration: VE,
    });

    // ── Height sampler ────────────────────────────────────────────────
    // Returns normalised height (0..1) from the decoded float data.
    // Used by shaft snapping and altimeter.
    let heightSampler = null;
    try {
      const { floats, width: tw, height: th } = hm;
      heightSampler = (u, v) => {
        const uu = Math.max(0, Math.min(1, u));
        const vv = Math.max(0, Math.min(1, v));
        const x = Math.round(uu * (tw - 1));
        const y = Math.round(vv * (th - 1));  // v=0→top (north), v=1→bottom (south)
        return floats[y * tw + x];
      };
    } catch {
      // ignore
    }

    // ── Contour lines ─────────────────────────────────────────────────
    const contourLines = generateContourLines(geom);
    if (contourLines) contourLines.position.set(centerX, 0, centerZ);

    return { mesh, meta, widthM, heightM, heightSampler, contourLines };
  } catch (err) {
    console.error('Terrain mesh creation failed:', err);
    return null;
  }
}

/**
 * Convert a normalised height (0..1) to world Y coordinate,
 * matching the displacement applied in tryCreateTerrainMesh.
 */
export function terrainHeightToWorldY({ h01 } = {}) {
  if (!terrainState) {
    // Fallback to legacy calculation if terrain hasn't loaded yet
    const h = Number.isFinite(h01) ? h01 : 0;
    return TERRAIN_CONFIG.baseY + (h * TERRAIN_CONFIG.displacementScale + TERRAIN_CONFIG.displacementBias);
  }
  const { VE, elevMin, elevRange } = terrainState;
  const h = Number.isFinite(h01) ? h01 : 0;
  const elevM = h * elevRange + elevMin;
  // Sea-level reference: Y = elevation_metres × vertical_exaggeration
  return elevM * VE;
}

/**
 * Convert world (x, z) to terrain UV coordinates [0..1].
 * Uses the actual terrain bounds computed from BNG metadata.
 */
export function xzToTerrainUV({ x, z } = {}) {
  if (!terrainState) {
    // Fallback to legacy centred-at-origin calculation
    const size = TERRAIN_CONFIG.size;
    const u = (x + size / 2) / size;
    const v = (z + size / 2) / size;
    return { u, v };
  }
  const { swSceneX, neSceneZ, terrainW, terrainH } = terrainState;
  // u: 0 at west edge (swSceneX), 1 at east edge (neSceneX)
  const u = (x - swSceneX) / terrainW;
  // v: 0 at north edge (neSceneZ, negative), 1 at south edge (swSceneZ, positive)
  const v = (z - neSceneZ) / terrainH;
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
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
