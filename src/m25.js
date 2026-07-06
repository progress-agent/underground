import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';

// BNG reference — must match terrain.js
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Terrain BNG bounds (from london_full_height.json)
const TERRAIN_BNG = {
  minE: 490000, maxE: 560000,
  minN: 155000, maxN: 205000,
  widthE: 70000,  // 560000 - 490000
  heightN: 50000, // 205000 - 155000
};

/**
 * Fetch M25 route data from public/data/m25.json.
 * Format matches thames.json convention: { name, crs, points: [{ e, n }, ...] }
 */
export async function loadM25Data() {
  try {
    const res = await fetch('/data/m25.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await res.json();
  } catch (err) {
    console.warn('Failed to load M25 data:', err);
    return null;
  }
}

/**
 * Convert BNG easting/northing to scene XZ coordinates.
 * Matches terrain.js / thames.js convention.
 */
function bngToScene(e, n) {
  return {
    x: e - BNG_REF_E,
    z: -(n - BNG_REF_N),
  };
}

/**
 * Convert BNG coordinates to mask UV [0,1].
 * u=0 at west edge (minE), u=1 at east edge (maxE).
 * v=0 at north edge (maxN), v=1 at south edge (minN).
 * This matches the terrain mesh UV convention (v=0 → north, v=1 → south).
 */
function bngToMaskUV(e, n) {
  return {
    u: (e - TERRAIN_BNG.minE) / TERRAIN_BNG.widthE,
    v: 1.0 - (n - TERRAIN_BNG.minN) / TERRAIN_BNG.heightN,
  };
}

/**
 * Render M25 polygon to a canvas mask (white inside, black outside).
 * Used as a discard mask in terrain material shaders.
 *
 * @param {Array<{e:number,n:number}>} points  M25 BNG waypoints (closed ring)
 * @param {number} [size]   Output texture resolution
 * @param {number} [feather] Edge feather in pixels
 * @returns {THREE.CanvasTexture}
 */
export function generateM25Mask(points, size = 2048, feather = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Black background (outside M25 = discard)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Draw M25 polygon in white (inside = keep)
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const { u, v } = bngToMaskUV(points[i].e, points[i].n);
    const px = u * size;
    const py = v * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Feathered edge: draw a slightly smaller polygon with blur
  // to soften the disc boundary
  if (feather > 0) {
    // Stroke the boundary in grey with blur for soft edge
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.filter = `blur(${feather}px)`;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const { u, v } = bngToMaskUV(points[i].e, points[i].n);
      const px = u * size;
      const py = v * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Inject M25 mask discard into a MeshStandardMaterial via onBeforeCompile.
 * Fragments outside the M25 polygon are discarded.
 *
 * @param {THREE.MeshStandardMaterial} material  Material to modify
 * @param {THREE.Texture} maskTexture            M25 mask texture
 */
export function applyM25Mask(material, maskTexture) {
  material.userData.m25Mask = maskTexture;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.m25Mask = { value: maskTexture };

    // Inject custom varying in VERTEX shader to pass raw UV (no texture transforms).
    // vMapUv includes map.repeat (16× for grain, 24× for underside) — unusable for 1:1 mask.
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `varying vec2 vM25Uv;
void main() {`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
  vM25Uv = uv;`
    );

    // Inject mask sampling in FRAGMENT shader using the raw UV varying
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform sampler2D m25Mask;
varying vec2 vM25Uv;
void main() {`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  float m25Alpha = texture2D(m25Mask, vM25Uv).r;
  if (m25Alpha < 0.5) discard;`
    );
  };

  // Force recompilation
  material.needsUpdate = true;
}

/**
 * Create the M25 road surface — a dark ribbon snapped to terrain.
 *
 * @param {Array<{e:number,n:number}>} points          M25 BNG waypoints
 * @param {function}                   getSurfaceY     (x,z) → world Y
 * @param {object}                     [options]
 * @returns {THREE.Mesh}
 */
export function createM25Road(points, getSurfaceY, options = {}) {
  const {
    width = 30,        // road width in scene units (metres)
    color = 0x1a1a1a,  // dark asphalt
  } = options;

  // Convert BNG points to scene coordinates
  const scenePts = points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return new THREE.Vector3(x, y !== null ? y + 2 : 0, z);
  });

  // Build road ribbon geometry
  const halfW = width / 2;
  const vertCount = scenePts.length * 2;
  const positions = new Float32Array(vertCount * 3);

  for (let i = 0; i < scenePts.length; i++) {
    const p = scenePts[i];
    const prev = scenePts[Math.max(0, i - 1)];
    const next = scenePts[Math.min(scenePts.length - 1, i + 1)];

    // Tangent direction
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const tLen = Math.sqrt(tx * tx + tz * tz) || 1;

    // Perpendicular in XZ plane
    const nx = -tz / tLen;
    const nz = tx / tLen;

    const base = i * 2 * 3;
    // Left vertex
    positions[base]     = p.x + nx * halfW;
    positions[base + 1] = p.y;
    positions[base + 2] = p.z + nz * halfW;
    // Right vertex
    positions[base + 3] = p.x - nx * halfW;
    positions[base + 4] = p.y;
    positions[base + 5] = p.z - nz * halfW;
  }

  // Index buffer: triangle strip as indexed triangles
  const triCount = (scenePts.length - 1) * 2;
  const indices = new Uint32Array(triCount * 3);
  let idx = 0;
  for (let i = 0; i < scenePts.length - 1; i++) {
    const b = i * 2;
    // Two triangles per segment
    indices[idx++] = b;     indices[idx++] = b + 2; indices[idx++] = b + 1;
    indices[idx++] = b + 1; indices[idx++] = b + 2; indices[idx++] = b + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'm25Road';
  mesh.renderOrder = RENDER_ORDER.SURFACE_ROAD;

  console.log(`M25 road: ${scenePts.length} points, ${triCount} triangles, ${width}m wide`);
  return mesh;
}

/**
 * Find where a ray from a point in a direction intersects the M25 polygon boundary.
 * Returns { x, z, surfaceY } in scene coordinates, or null.
 */
function findRayM25Intersection(originX, originZ, dirX, dirZ, m25ScenePts) {
  let bestT = Infinity;
  let bestPt = null;

  for (let i = 0; i < m25ScenePts.length - 1; i++) {
    const p0 = m25ScenePts[i];
    const p1 = m25ScenePts[i + 1];

    // Line segment: p0 + s * (p1 - p0), s ∈ [0,1]
    // Ray: origin + t * dir, t > 0
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;

    const denom = dirX * dz - dirZ * dx;
    if (Math.abs(denom) < 1e-10) continue;

    const t = ((p0.x - originX) * dz - (p0.z - originZ) * dx) / denom;
    const s = ((p0.x - originX) * dirZ - (p0.z - originZ) * dirX) / denom;

    if (t > 0 && s >= 0 && s <= 1 && t < bestT) {
      bestT = t;
      bestPt = {
        x: originX + t * dirX,
        z: originZ + t * dirZ,
        surfaceY: p0.surfaceY + s * (p1.surfaceY - p0.surfaceY),
      };
    }
  }

  return bestPt;
}

/**
 * Robust fallback for a Thames endpoint whose directed flow ray misses every
 * M25 segment. The west endpoint sits almost tangent to the ring, so its
 * outward ray slips past the polygon and `findRayM25Intersection` returns null
 * — that's why only the east ribbon used to render. Here we instead take the
 * nearest point on the M25 polyline to the endpoint and derive an OUTWARD flow
 * direction (segment normal, signed away from the polygon centroid).
 *
 * @returns {{x,z,surfaceY,dirX,dirZ}|null}
 */
function nearestM25Boundary(px, pz, m25Scene, centroid) {
  let best = Infinity;
  let out = null;
  for (let i = 0; i < m25Scene.length - 1; i++) {
    const p0 = m25Scene[i];
    const p1 = m25Scene[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((px - p0.x) * dx + (pz - p0.z) * dz) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = p0.x + t * dx, qz = p0.z + t * dz;
    const ex = px - qx, ez = pz - qz;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      // Outward-facing segment normal (perpendicular to the edge tangent),
      // flipped if it points toward the centroid.
      let nx = -dz, nz = dx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      if (nx * (qx - centroid.x) + nz * (qz - centroid.z) < 0) { nx = -nx; nz = -nz; }
      out = {
        x: qx, z: qz,
        surfaceY: p0.surfaceY + t * (p1.surfaceY - p0.surfaceY),
        dirX: nx, dirZ: nz,
      };
    }
  }
  return out;
}

/** Mean XZ of a scene-space point list (M25 polygon centroid). */
function sceneCentroid(pts) {
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  const n = pts.length || 1;
  return { x: cx / n, z: cz / n };
}

/**
 * Compute where the Thames crosses the M25 boundary (west + east ends) in
 * scene coordinates. Shared by the waterfall builder and the clay disc skirt
 * (geology-exterior.js) so the skirt can leave a clean notch exactly where
 * each ribbon spills over the edge. Returns [{ x, z, surfaceY, dirX, dirZ,
 * width, side }, ...] — same crossing points the waterfalls arc through.
 *
 * @param {Array<{e,n,w,d}>} thamesPoints  Thames BNG waypoints
 * @param {Array<{e,n}>}     m25Points     M25 BNG waypoints
 * @param {function}         getSurfaceY   (x,z) → world Y
 * @returns {Array<object>}
 */
export function computeThamesCrossings(thamesPoints, m25Points, getSurfaceY) {
  const crossings = [];
  if (!thamesPoints?.length || !m25Points?.length) return crossings;

  const m25Scene = m25Points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return { x, z, surfaceY: y !== null ? y : 50 };
  });
  const centroid = sceneCentroid(m25Scene);

  const endpoints = [
    { pt: thamesPoints[0], next: thamesPoints[1],
      dirSign: -1, width: thamesPoints[0].w || 100 },
    { pt: thamesPoints[thamesPoints.length - 1], prev: thamesPoints[thamesPoints.length - 2],
      dirSign: 1, width: thamesPoints[thamesPoints.length - 1].w || 300 },
  ];

  for (const ep of endpoints) {
    const { x: epX, z: epZ } = bngToScene(ep.pt.e, ep.pt.n);
    let dirX, dirZ;
    if (ep.next) {
      const { x: nx, z: nz } = bngToScene(ep.next.e, ep.next.n);
      dirX = epX - nx; dirZ = epZ - nz;
    } else {
      const { x: px, z: pz } = bngToScene(ep.prev.e, ep.prev.n);
      dirX = epX - px; dirZ = epZ - pz;
    }
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    dirX /= dirLen; dirZ /= dirLen;

    let cross = findRayM25Intersection(epX, epZ, dirX, dirZ, m25Scene);
    let cdirX = dirX, cdirZ = dirZ;
    if (!cross) {
      // Directed ray missed (west endpoint) — fall back to nearest boundary.
      const fb = nearestM25Boundary(epX, epZ, m25Scene, centroid);
      if (!fb) continue;
      cross = fb; cdirX = fb.dirX; cdirZ = fb.dirZ;
    }
    crossings.push({
      x: cross.x, z: cross.z, surfaceY: cross.surfaceY,
      dirX: cdirX, dirZ: cdirZ, width: ep.width, side: ep.dirSign > 0 ? 'east' : 'west',
    });
  }
  return crossings;
}

/**
 * Create Thames waterfall geometry at the disc edge.
 * The Thames flows off the M25 boundary at two points (east and west).
 * Each waterfall is a ribbon that arcs from horizontal to vertical, fading out.
 *
 * @param {Array<{e:number,n:number,w:number,d:number}>} thamesPoints  Thames BNG waypoints
 * @param {Array<{e:number,n:number}>}                   m25Points     M25 BNG waypoints
 * @param {function}                                     getSurfaceY   (x,z) → world Y
 * @returns {THREE.Group}
 */
export function createThamesWaterfalls(thamesPoints, m25Points, getSurfaceY) {
  const group = new THREE.Group();
  group.name = 'thamesWaterfalls';

  if (!thamesPoints?.length || !m25Points?.length) return group;

  // Convert M25 points to scene coordinates with surface Y
  const m25Scene = m25Points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return { x, z, surfaceY: y !== null ? y : 50 };
  });
  const centroid = sceneCentroid(m25Scene);

  // Thames endpoints and flow directions
  const endpoints = [
    { // West end (first point in Thames data)
      pt: thamesPoints[0],
      next: thamesPoints[1],
      dirSign: -1, // flowing westward off the edge
      width: thamesPoints[0].w || 100,
    },
    { // East end (last point in Thames data)
      pt: thamesPoints[thamesPoints.length - 1],
      prev: thamesPoints[thamesPoints.length - 2],
      dirSign: 1,  // flowing eastward off the edge
      width: thamesPoints[thamesPoints.length - 1].w || 300,
    },
  ];

  for (const ep of endpoints) {
    const { x: epX, z: epZ } = bngToScene(ep.pt.e, ep.pt.n);

    // Flow direction from Thames data
    let dirX, dirZ;
    if (ep.next) {
      const { x: nx, z: nz } = bngToScene(ep.next.e, ep.next.n);
      dirX = epX - nx; // reverse: flowing away from next
      dirZ = epZ - nz;
    } else {
      const { x: px, z: pz } = bngToScene(ep.prev.e, ep.prev.n);
      dirX = epX - px; // forward: flowing away from prev
      dirZ = epZ - pz;
    }
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

    // Find where the flow direction ray hits the M25 boundary. If the directed
    // ray misses (the west endpoint sits near-tangent to the ring), fall back
    // to the nearest boundary point with an outward flow direction — so BOTH
    // ribbons render, not just the east one.
    let intersection = findRayM25Intersection(epX, epZ, dirX, dirZ, m25Scene);
    if (!intersection) {
      const fb = nearestM25Boundary(epX, epZ, m25Scene, centroid);
      if (!fb) continue;
      intersection = { x: fb.x, z: fb.z, surfaceY: fb.surfaceY };
      dirX = fb.dirX; dirZ = fb.dirZ;
    }

    // Build waterfall arc: horizontal approach → 90° curve → vertical fall
    const surfaceY = intersection.surfaceY;
    const halfW = ep.width / 2;
    const arcRadius = Math.max(150, halfW * 0.4);
    const fallLength = 8000; // vertical fall — extends deep into void

    // Perpendicular direction for ribbon width
    const perpX = -dirZ;
    const perpZ = dirX;

    // Arc samples: 0° = horizontal approach, 90° = vertical fall
    const ARC_SAMPLES = 12;
    const FALL_SAMPLES = 40;
    const totalSamples = ARC_SAMPLES + FALL_SAMPLES;

    const positions = new Float32Array((totalSamples + 1) * 2 * 3);
    const alphas = new Float32Array((totalSamples + 1) * 2);

    for (let i = 0; i <= totalSamples; i++) {
      let px, py, pz, alpha;

      if (i <= ARC_SAMPLES) {
        // Arc section: 0 → 90 degrees
        const angle = (i / ARC_SAMPLES) * (Math.PI / 2);
        // Arc center is at intersection point, offset upward by arcRadius
        const arcOffsetX = Math.sin(angle) * arcRadius;
        const arcOffsetY = (1 - Math.cos(angle)) * arcRadius;

        px = intersection.x + dirX * arcOffsetX;
        pz = intersection.z + dirZ * arcOffsetX;
        py = surfaceY + 2 - arcOffsetY;
        alpha = 1.0;
      } else {
        // Vertical fall section — fades out down the outside of the disc.
        const fallT = (i - ARC_SAMPLES) / FALL_SAMPLES;
        px = intersection.x + dirX * arcRadius;
        pz = intersection.z + dirZ * arcRadius;
        py = surfaceY + 2 - arcRadius - fallT * fallLength;
        alpha = Math.pow(1 - fallT, 1.5); // lingers near the lip, dissolves deep
      }

      // Taper width during fall
      const taperT = i / totalSamples;
      const taperW = halfW; // constant width — no taper

      const vi = i * 2;
      // Left vertex
      positions[vi * 3]     = px + perpX * taperW;
      positions[vi * 3 + 1] = py;
      positions[vi * 3 + 2] = pz + perpZ * taperW;
      alphas[vi] = alpha;
      // Right vertex
      positions[(vi + 1) * 3]     = px - perpX * taperW;
      positions[(vi + 1) * 3 + 1] = py;
      positions[(vi + 1) * 3 + 2] = pz - perpZ * taperW;
      alphas[vi + 1] = alpha;
    }

    // Index buffer
    const triCount = totalSamples * 2;
    const indices = new Uint32Array(triCount * 3);
    let idx = 0;
    for (let i = 0; i < totalSamples; i++) {
      const b = i * 2;
      indices[idx++] = b;     indices[idx++] = b + 2; indices[idx++] = b + 1;
      indices[idx++] = b + 1; indices[idx++] = b + 2; indices[idx++] = b + 3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    // Custom material with vertex alpha for fade-out
    const material = new THREE.MeshStandardMaterial({
      color: 0x1a3d5c,
      emissive: 0x0a1e3d,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.05,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Inject vertex alpha into the shader
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `attribute float alpha;
varying float vAlpha;
void main() {`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  vAlpha = alpha;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `varying float vAlpha;
void main() {`
      );
      // r161 chunk is <opaque_fragment> (was <output_fragment> in older three);
      // the old name silently no-ops the injection, so the fall never faded.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
  gl_FragColor.a *= vAlpha;`
      );
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `thamesWaterfall_${ep.dirSign > 0 ? 'east' : 'west'}`;
    mesh.renderOrder = RENDER_ORDER.SURFACE_WATER;
    group.add(mesh);
  }

  console.log(`Thames waterfalls: ${group.children.length} created`);
  return group;
}

// ---------- Point-in-polygon boundary test ----------

/** Cached M25 polygon in scene coordinates (array of {x, z}) */
let _m25ScenePolygon = null;

/**
 * Convert BNG M25 points to scene coordinates and cache for hit-testing.
 * Call once after M25 data loads.
 *
 * @param {Array<{e:number,n:number}>} points  M25 BNG waypoints
 */
export function initM25Boundary(points) {
  if (!points?.length) return;
  _m25ScenePolygon = points.map(p => bngToScene(p.e, p.n));
  buildM25EdgeField();
}

// ── M25 signed-distance edge field (D5) ────────────────────────────────────
// A coarse grid of SIGNED distance (positive inside the disc, negative outside)
// from the M25 polygon, precomputed once. The atmosphere blend samples it per
// frame (bilinear) to turn the old binary inside/outside switch into a smooth
// ~1500m gradient — killing the hard render-mode seam at the disc edge.
//
// The grid spans the terrain scene extent (same bounds terrain.js/geology.js
// use). 256² cells brute-forced against ~270 polygon segments is a one-off
// ~18M-op build at boot — trivially fast and never touched again.
const SDF_MIN_X = TERRAIN_BNG.minE - BNG_REF_E;   // -40000
const SDF_MAX_X = TERRAIN_BNG.maxE - BNG_REF_E;   //  30000
const SDF_MIN_Z = -(TERRAIN_BNG.maxN - BNG_REF_N); // -24600 (north)
const SDF_MAX_Z = -(TERRAIN_BNG.minN - BNG_REF_N); //  25400 (south)
const SDF_EDGE_BAND = 1500; // scene units — full inside↔outside blend width

let _m25Sdf = null;   // Float32Array(N*N) signed distance
let _sdfN = 0;

function buildM25EdgeField(gridN = 256) {
  const poly = _m25ScenePolygon;
  if (!poly || poly.length < 3) return;
  _sdfN = gridN;
  _m25Sdf = new Float32Array(gridN * gridN);
  const n = poly.length;
  for (let gz = 0; gz < gridN; gz++) {
    const z = SDF_MIN_Z + (SDF_MAX_Z - SDF_MIN_Z) * (gz / (gridN - 1));
    for (let gx = 0; gx < gridN; gx++) {
      const x = SDF_MIN_X + (SDF_MAX_X - SDF_MIN_X) * (gx / (gridN - 1));
      // Unsigned min distance to any polygon edge.
      let best = Infinity;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x, zi = poly[i].z;
        const xj = poly[j].x, zj = poly[j].z;
        // even-odd inside test
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
          inside = !inside;
        }
        // point-to-segment distance
        const dx = xj - xi, dz = zj - zi;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - xi) * dx + (z - zi) * dz) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const ex = x - (xi + t * dx), ez = z - (zi + t * dz);
        const d2 = ex * ex + ez * ez;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      _m25Sdf[gz * gridN + gx] = inside ? d : -d;
    }
  }
}

function _smoothstep01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * Continuous M25 membership at scene (x, z): 1 deep inside the disc, 0 well
 * outside, smoothly graded over SDF_EDGE_BAND around the boundary. Returns 1
 * when the field is not yet built (graceful — matches isInsideM25's fallback,
 * so early frames render as above-ground/inside exactly as before).
 * Allocation-free, bilinear — safe per frame.
 */
export function sampleM25Insideness(x, z) {
  const N = _sdfN;
  if (!_m25Sdf || N === 0) return 1;
  const fx = ((x - SDF_MIN_X) / (SDF_MAX_X - SDF_MIN_X)) * (N - 1);
  const fz = ((z - SDF_MIN_Z) / (SDF_MAX_Z - SDF_MIN_Z)) * (N - 1);
  let x0 = Math.floor(fx), z0 = Math.floor(fz);
  if (x0 < 0) x0 = 0; else if (x0 > N - 2) x0 = N - 2;
  if (z0 < 0) z0 = 0; else if (z0 > N - 2) z0 = N - 2;
  const tx = Math.min(1, Math.max(0, fx - x0));
  const tz = Math.min(1, Math.max(0, fz - z0));
  const s = _m25Sdf;
  const d00 = s[z0 * N + x0], d10 = s[z0 * N + x0 + 1];
  const d01 = s[(z0 + 1) * N + x0], d11 = s[(z0 + 1) * N + x0 + 1];
  const dTop = d00 + (d10 - d00) * tx;
  const dBot = d01 + (d11 - d01) * tx;
  const signedDist = dTop + (dBot - dTop) * tz;
  // Map signed distance (± band/2) → [0,1].
  return _smoothstep01(signedDist / SDF_EDGE_BAND + 0.5);
}

/**
 * Test whether a scene-space (x, z) point is inside the M25 polygon.
 * Uses ray-casting even-odd rule (~136 edges, sub-microsecond).
 *
 * Returns true if boundary not yet loaded (graceful degradation —
 * existing underground behaviour preserved until M25 data arrives).
 *
 * @param {number} x  Scene X coordinate
 * @param {number} z  Scene Z coordinate
 * @returns {boolean}
 */
export function isInsideM25(x, z) {
  if (!_m25ScenePolygon) return true; // fallback: assume inside

  let inside = false;
  const poly = _m25ScenePolygon;
  const n = poly.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;

    if ((zi > z) !== (zj > z) &&
        x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}
