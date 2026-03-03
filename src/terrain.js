import * as THREE from 'three';
import UPNG from 'upng-js';
import {
  generateTerrainGrainTexture,
  generateTerrainRoughnessTexture,
  generateTerrainNormalMap,
  generateUndersideGrainTexture,
  generateUndersideNormalMap,
} from './textures.js';

// BNG reference point for the scene ORIGIN (51.5074°N, 0.1278°W)
// Trafalgar Square ≈ TQ 300 804 ≈ E 530000, N 180400 in British National Grid
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Unified vertical exaggeration for terrain AND underground depth.
// VE=5 splits the difference: terrain hills pronounced, underground depth visible,
// no "diving" artefacts at hilly areas like Hampstead.
export const VERTICAL_EXAGGERATION = 5;

// Terrain configuration
export const TERRAIN_CONFIG = {
  // Source files (tried in order)
  metaPath: '/data/terrain/london_full_height.json',
  fallbackMetaPath: '/data/terrain/victoria_dtm_u16.json',

  // Geometry resolution — 512 segments gives ~27m per vertex on a 14km tile
  segments: 512,

  // Vertical exaggeration for terrain elevation.
  // London's real relief (~0–130m) is invisible at 1:1 on a 14km plane.
  // VE=5 makes hills clearly visible and matches underground depth scaling.
  verticalExaggeration: VERTICAL_EXAGGERATION,

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

/**
 * Carve a river valley into the terrain elevation array.
 * Uses signed-distance-field approach: each vertex checks distance to nearest
 * Thames polyline segment. Within the river width → full carve. Within falloff → smoothstep blend.
 *
 * @param {Float32Array} elevations   Elevation in metres OD, mutated in place
 * @param {number}       vertexCols   Grid columns (segments + 1)
 * @param {number}       vertexRows   Grid rows (segments + 1)
 * @param {number}       swSceneX     West edge scene X
 * @param {number}       neSceneX     East edge scene X
 * @param {number}       swSceneZ     South edge scene Z (positive)
 * @param {number}       neSceneZ     North edge scene Z (negative)
 * @param {Array}        riverSegments [{x, z, halfW}, ...] in scene coords
 * @param {object}       [options]
 */
export function carveRiverChannel(
  elevations, vertexCols, vertexRows,
  swSceneX, neSceneX, swSceneZ, neSceneZ,
  riverSegments,
  options = {}
) {
  const {
    riverLevelM = 2,      // water surface in metres OD
    falloffM = 250,       // bank slope width in metres
    channelDepthM = 3,    // depth below water level to carve
  } = options;

  const carveElev = riverLevelM - channelDepthM; // target elevation at channel bottom
  const terrainW = neSceneX - swSceneX;
  const terrainH = swSceneZ - neSceneZ;

  // ── Spatial bucketing: group segments by X-range for O(1) lookup ──
  const BUCKET_SIZE = 500; // metres
  const minX = swSceneX - falloffM;
  const maxX = neSceneX + falloffM;
  const bucketCount = Math.ceil((maxX - minX) / BUCKET_SIZE) + 1;
  const buckets = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) buckets[i] = [];

  // Each segment spans two consecutive river points
  for (let s = 0; s < riverSegments.length - 1; s++) {
    const a = riverSegments[s];
    const b = riverSegments[s + 1];
    const segMinX = Math.min(a.x, b.x) - Math.max(a.halfW, b.halfW) - falloffM;
    const segMaxX = Math.max(a.x, b.x) + Math.max(a.halfW, b.halfW) + falloffM;
    const b0 = Math.max(0, Math.floor((segMinX - minX) / BUCKET_SIZE));
    const b1 = Math.min(bucketCount - 1, Math.floor((segMaxX - minX) / BUCKET_SIZE));
    for (let bi = b0; bi <= b1; bi++) {
      buckets[bi].push(s);
    }
  }

  // Smoothstep: 0→1 over [0,1]
  function smoothstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  // ── Per-vertex carving ──
  let carved = 0;
  for (let row = 0; row < vertexRows; row++) {
    const vFrac = row / (vertexRows - 1);
    const vZ = neSceneZ + vFrac * terrainH; // north → south

    for (let col = 0; col < vertexCols; col++) {
      const uFrac = col / (vertexCols - 1);
      const vX = swSceneX + uFrac * terrainW; // west → east

      // Find closest distance to any river segment
      const bi = Math.floor((vX - minX) / BUCKET_SIZE);
      const segs = (bi >= 0 && bi < bucketCount) ? buckets[bi] : [];
      if (segs.length === 0) continue;

      let bestDist = Infinity;
      let bestHalfW = 0;

      for (let si = 0; si < segs.length; si++) {
        const s = segs[si];
        const a = riverSegments[s];
        const b = riverSegments[s + 1];

        // Project vertex onto segment a→b, clamp t to [0,1]
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const abLenSq = abx * abx + abz * abz;
        if (abLenSq < 1e-6) continue;

        let t = ((vX - a.x) * abx + (vZ - a.z) * abz) / abLenSq;
        t = Math.max(0, Math.min(1, t));

        const projX = a.x + t * abx;
        const projZ = a.z + t * abz;
        const dx = vX - projX;
        const dz = vZ - projZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Interpolate halfW at projection point
        const hw = a.halfW + t * (b.halfW - a.halfW);

        if (dist < bestDist) {
          bestDist = dist;
          bestHalfW = hw;
        }
      }

      const idx = row * vertexCols + col;
      const orig = elevations[idx];

      if (bestDist <= bestHalfW) {
        // Inside river channel: full carve
        elevations[idx] = Math.min(orig, carveElev);
        carved++;
      } else if (bestDist < bestHalfW + falloffM) {
        // Falloff zone: blend from carveElev to original
        const blend = smoothstep((bestDist - bestHalfW) / falloffM);
        const blended = carveElev + blend * (orig - carveElev);
        elevations[idx] = Math.min(orig, blended);
        carved++;
      }
    }
  }

  console.log(`River channel: carved ${carved} vertices (${(carved / (vertexCols * vertexRows) * 100).toFixed(1)}% of terrain)`);
}

export async function tryCreateTerrainMesh({ opacity = TERRAIN_CONFIG.opacity, wireframe = false, thamesData = null } = {}) {
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
    //   UV (0,0) → (X=-w/2, Z=+h/2) → south-west in scene (positive Z = south)
    //   UV (1,1) → (X=+w/2, Z=-h/2) → north-east in scene
    //   UV v=0 → Z=+h/2 (south),  UV v=1 → Z=-h/2 (north)
    //
    // Heightmap image convention (top-left origin):
    //   pixel (0,0) = NW = (bngXmin, bngYmax)
    //   pixel (w-1,h-1) = SE = (bngXmax, bngYmin)
    //
    // Correct sampling: UV v → py = (1-v) * (h-1)
    //   v=0 (south) → py=h-1 (bottom of image = south) ✓
    //   v=1 (north) → py=0 (top of image = north) ✓

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
      const py = Math.min(hm.height - 1, Math.round((1 - v) * (hm.height - 1)));
      const h01 = hm.floats[py * hm.width + px];
      const elevM = h01 * elevRange + elevMin;
      elevations[i] = elevM;
      elevSum += elevM;
    }
    const meanElev = elevSum / pos.count;

    // ── Pass 1.5: Carve river channel into elevation data ─────────────
    // Must happen BEFORE vertex displacement so contours, vertex colours,
    // and normals all incorporate the carved valley.
    if (thamesData?.points?.length) {
      const riverSegments = thamesData.points.map(pt => ({
        x: pt.e - BNG_REF_E,
        z: -(pt.n - BNG_REF_N),
        halfW: (pt.w || 100) / 2,
      }));
      carveRiverChannel(
        elevations, segments + 1, segments + 1,
        swSceneX, neSceneX, swSceneZ, neSceneZ,
        riverSegments
      );
    }

    // ── Second pass: displace vertices with vertical exaggeration ─────
    // Reference to sea level (0m AOD) so Y=0 = Ordnance Datum.
    // Central London (~10-15m) sits at Y=30-45, matching the camera start (Y=30).
    // Thames (~0m) at Y=0, hills rise above. Physically intuitive.
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, elevations[i] * VE);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // Store module-level state for helper functions (xzToTerrainUV, terrainHeightToWorldY, getTerrainMeshSurfaceY)
    terrainState = {
      swSceneX, swSceneZ, neSceneX, neSceneZ,
      terrainW, terrainH, centerX, centerZ,
      VE,
      elevMin: meta.elev_min_m ?? hm.minRaw,
      elevRange: (meta.elev_max_m ?? (hm.minRaw + hm.rawRange)) - (meta.elev_min_m ?? hm.minRaw),
      segments,   // grid resolution (for mesh vertex sampling)
    };

    // ── Vertex colours by elevation ───────────────────────────────────
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const yRange = maxY - minY || 1;
    // 5-stop elevation gradient: wider luminance range for visible topographic contrast
    const elevStops = [
      { t: 0.00, color: new THREE.Color(0x3d2e1f) }, // Deep umber (river valleys)
      { t: 0.25, color: new THREE.Color(0x5c4a3a) }, // Warm brown (low areas)
      { t: 0.50, color: new THREE.Color(0x7a6b55) }, // Dusty mid (London clay)
      { t: 0.75, color: new THREE.Color(0x96886e) }, // Sandy tan (exposed earth)
      { t: 1.00, color: new THREE.Color(0xa89e80) }, // Grey-green (hilltops)
    ];
    const colArr = new Float32Array(pos.count * 3);
    const tmpCol = new THREE.Color();
    const normals = geom.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / yRange;
      // Sample 5-stop gradient
      let stopIdx = 0;
      for (let s = 1; s < elevStops.length; s++) {
        if (t >= elevStops[s].t) stopIdx = s;
        else break;
      }
      const s0 = elevStops[stopIdx];
      const s1 = elevStops[Math.min(stopIdx + 1, elevStops.length - 1)];
      const localT = s0.t === s1.t ? 0 : (t - s0.t) / (s1.t - s0.t);
      tmpCol.copy(s0.color).lerp(s1.color, localT);
      // Slope-dependent darkening: steep normals (low Y) get darker
      const ny = Math.abs(normals.getY(i));
      const slopeDarken = 1.0 - (1.0 - ny) * 0.4;
      tmpCol.multiplyScalar(slopeDarken);
      colArr[i * 3] = tmpCol.r;
      colArr[i * 3 + 1] = tmpCol.g;
      colArr[i * 3 + 2] = tmpCol.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    console.log(`Terrain: ${pos.count} vertices, VE=${VE}×, Y range: ${minY.toFixed(1)}–${maxY.toFixed(1)}, mean elev: ${meanElev.toFixed(1)}m`);

    // ── Generate procedural textures ──────────────────────────────────
    const grainTex = generateTerrainGrainTexture();
    const roughnessTex = generateTerrainRoughnessTexture();
    const terrainNormalTex = generateTerrainNormalMap(hm.floats, hm.width, hm.height);
    const undersideGrainTex = generateUndersideGrainTexture();
    const undersideNormalTex = generateUndersideNormalMap(undersideGrainTex);

    // ── Topside material (warm earth, viewed from above) ────────────
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: grainTex,
      normalMap: terrainNormalTex,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: roughnessTex,
      roughness: 0.85,
      metalness: 0.05,
      transparent: false,
      opacity: opacity,
      depthWrite: true,
      wireframe: !!wireframe,
      side: THREE.FrontSide,
    });

    // ── Underside geometry + vertex colours (rock face, viewed from below) ─
    const undersideGeom = geom.clone();
    const undersideLowCol = new THREE.Color(0x7a6044);
    const undersideMidCol = new THREE.Color(0x8d7456);
    const undersideHighCol = new THREE.Color(0x9e8868);
    const usColArr = new Float32Array(pos.count * 3);
    const usTmpCol = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / yRange;
      if (t < 0.5) {
        usTmpCol.copy(undersideLowCol).lerp(undersideMidCol, t * 2);
      } else {
        usTmpCol.copy(undersideMidCol).lerp(undersideHighCol, (t - 0.5) * 2);
      }
      usColArr[i * 3] = usTmpCol.r;
      usColArr[i * 3 + 1] = usTmpCol.g;
      usColArr[i * 3 + 2] = usTmpCol.b;
    }
    undersideGeom.setAttribute('color', new THREE.BufferAttribute(usColArr, 3));

    // ── Underside material (rock face with normal map for relief) ────
    const undersideMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: undersideGrainTex,
      normalMap: undersideNormalTex,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.92,
      metalness: 0.0,
      transparent: false,
      opacity: opacity,
      depthWrite: false,
      wireframe: !!wireframe,
      side: THREE.BackSide,
    });

    // ── Two meshes sharing position, topside renders first ──────────
    const mesh = new THREE.Mesh(geom, topMat);
    mesh.position.set(centerX, 0, centerZ);
    mesh.name = 'terrainMesh';
    mesh.renderOrder = -1;

    const undersideMesh = new THREE.Mesh(undersideGeom, undersideMat);
    undersideMesh.position.set(centerX, 0, centerZ);
    undersideMesh.name = 'terrainUnderside';
    undersideMesh.renderOrder = -1;

    terrainState.mesh = mesh; // for vertex sampling in getTerrainMeshSurfaceY
    terrainState.undersideMesh = undersideMesh;
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

    return { mesh, undersideMesh, topMat, undersideMat, meta, widthM, heightM, heightSampler, contourLines };
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

/**
 * Convenience: world (x, z) → terrain surface Y in one call.
 * Composes xzToTerrainUV + heightSampler + terrainHeightToWorldY.
 */
export function getTerrainSurfaceY({ x, z, heightSampler }) {
  if (!heightSampler || !terrainState) return null;
  const { u, v } = xzToTerrainUV({ x, z });
  const h01 = heightSampler(u, v);
  return terrainHeightToWorldY({ h01 });
}

/**
 * Sample the actual terrain mesh vertex Y at a world (x, z) position.
 * Uses bilinear interpolation across the four nearest PlaneGeometry vertices,
 * so the returned Y matches exactly what the GPU renders — no heightmap/mesh
 * resolution mismatch.
 *
 * Returns world Y (number) or null if (x, z) is outside the mesh bounds.
 * O(1), no allocation — safe for per-frame use.
 */
export function getTerrainMeshSurfaceY({ x, z } = {}) {
  if (!terrainState?.mesh) return null;
  const { mesh, segments, centerX, centerZ, terrainW, terrainH } = terrainState;
  const pos = mesh.geometry.attributes.position;

  // World → mesh-local coordinates
  const localX = x - centerX;
  const localZ = z - centerZ;

  // Map to continuous grid coordinates [0, segments]
  const gridCol = (localX + terrainW / 2) / terrainW * segments;
  const gridRow = (localZ + terrainH / 2) / terrainH * segments;

  // Bounds check (allow a tiny epsilon for floating-point edge cases)
  if (gridCol < -0.001 || gridCol > segments + 0.001 ||
      gridRow < -0.001 || gridRow > segments + 0.001) {
    return null;
  }

  // Integer cell indices (clamp to valid range)
  const col0 = Math.min(Math.max(0, Math.floor(gridCol)), segments - 1);
  const row0 = Math.min(Math.max(0, Math.floor(gridRow)), segments - 1);
  const col1 = col0 + 1;
  const row1 = row0 + 1;

  // Fractional position within the cell [0, 1]
  const u = gridCol - col0;
  const v = gridRow - row0;

  // Row-major vertex indices: index = row * (segments + 1) + col
  const stride = segments + 1;
  const i00 = row0 * stride + col0;
  const i10 = row0 * stride + col1;
  const i01 = row1 * stride + col0;
  const i11 = row1 * stride + col1;

  // Bilinear interpolation of vertex Y values
  const y00 = pos.getY(i00);
  const y10 = pos.getY(i10);
  const y01 = pos.getY(i01);
  const y11 = pos.getY(i11);

  return y00 * (1 - u) * (1 - v)
       + y10 * u * (1 - v)
       + y01 * (1 - u) * v
       + y11 * u * v;
}

// Environment configuration for above/below ground differentiation
export const ENV_CONFIG = {
  // Altitude thresholds (in scene units/metres)
  surfaceY: 0,           // Ground level
  skyStartY: 200,        // Where sky becomes visible (raised for VE=5: central London ground ≈ Y=75)
  fogDepthY: -50,        // Where underground fog thickens

  // Colors - lighter for better visibility
  skyColor: 0x87CEEB,    // Sky blue (above)
  groundColor: 0x1f1a15, // Dark warm brown-black (underground)
  fogColorSky: 0xbdd4e6, // Desaturated blue-grey fog above ground
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
    // Fog near: push out with both surface blend and altitude
    // Underground (surfaceBlend=0): 100m. Ground (alt=0): ~700m. Altitude 1000m+: ~1700m.
    const altFactor = Math.min(1, Math.max(0, y / 1000));
    scene.fog.near = ENV_CONFIG.fogNear * (0.5 + surfaceBlend * (3 + altFactor * 5));

    // Dynamic fog.far: extend for both macro pullback AND altitude
    const camDist = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
    const baseFar = ENV_CONFIG.fogFar;
    const macroFar = 60000;
    const fogFarBlend = Math.min(1, Math.max(0, (camDist - 10000) / 10000));
    const altBlend = Math.min(1, Math.max(0, y / 3000));
    const altFar = baseFar + (macroFar - baseFar) * altBlend;
    scene.fog.far = Math.max(baseFar + (macroFar - baseFar) * fogFarBlend, altFar);

    // Underground: tighten fog for atmospheric depth
    if (surfaceBlend < 0.3) {
      scene.fog.far *= (0.5 + surfaceBlend * 1.67);
    }
  }

  // Update sky visibility — hidden underground to avoid wash-out over BackSide terrain
  if (sky) {
    sky.material.opacity = surfaceBlend * 0.9;
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
