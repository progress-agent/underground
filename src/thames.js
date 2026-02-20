import * as THREE from 'three';
import { VERTICAL_EXAGGERATION } from './terrain.js';

// River Thames data and 3D volume rendering
// Coordinates are in EPSG:27700 (British National Grid)
// Converted to scene coordinates matching terrain.js origin

// BNG reference — must match terrain.js (Trafalgar Square ≈ TQ 300 804)
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

export async function loadThamesData() {
  try {
    const res = await fetch('/data/thames.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Failed to load Thames data:', err);
    return null;
  }
}

// Convert BNG coordinates to scene coordinates (matches terrain.js convention)
export function bngToScene(easting, northing) {
  return {
    x: easting - BNG_REF_E,
    z: -(northing - BNG_REF_N),
  };
}

/**
 * Build a terrain-snapped 3D Thames volume from waypoint data.
 *
 * The geometry has a top face (water surface), bottom face, two side walls,
 * and endcaps — a proper 3D trough visible from any camera angle.
 *
 * @param {object}   thamesData              Parsed thames.json
 * @param {function} getTerrainMeshSurfaceY  (x,z) → world Y | null
 * @param {object}   [options]
 * @returns {THREE.Mesh|null}
 */
export function createThamesVolume(thamesData, getTerrainMeshSurfaceY, options = {}) {
  if (!thamesData?.points?.length) return null;

  const {
    color = 0x1a3d5c,
    opacity = 0.45,
  } = options;

  const VE = VERTICAL_EXAGGERATION;
  const SURFACE_LIFT = 5; // scene units ABOVE terrain surface (terrain mesh too coarse for river valley)

  // ── 1. Convert & filter ──────────────────────────────────────────────
  const validPoints = [];
  for (const pt of thamesData.points) {
    const pos = bngToScene(pt.e, pt.n);
    const surfaceY = getTerrainMeshSurfaceY({ x: pos.x, z: pos.z });
    if (surfaceY === null) continue;
    validPoints.push({ x: pos.x, z: pos.z, surfaceY, w: pt.w, d: pt.d });
  }

  if (validPoints.length < 2) {
    console.warn('Thames: fewer than 2 points inside terrain bounds');
    return null;
  }

  // ── 2. Build centreline spline ───────────────────────────────────────
  const splineControlPoints = validPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
  const spline = new THREE.CatmullRomCurve3(splineControlPoints);
  spline.curveType = 'catmullrom';
  spline.tension = 0.5;

  // ── 3. Build width / depth / surfaceY profiles ───────────────────────
  // Assign each data point a u value based on cumulative polyline distance.
  let cumDist = 0;
  const cumDists = [0];
  for (let i = 1; i < validPoints.length; i++) {
    const dx = validPoints[i].x - validPoints[i - 1].x;
    const dz = validPoints[i].z - validPoints[i - 1].z;
    cumDist += Math.sqrt(dx * dx + dz * dz);
    cumDists.push(cumDist);
  }

  const profiles = validPoints.map((p, i) => ({
    u: cumDist > 0 ? cumDists[i] / cumDist : 0,
    w: p.w,
    d: p.d,
    surfaceY: p.surfaceY,
  }));

  // Linear interpolation between bracketing profiles
  function lerpProfile(u) {
    if (u <= profiles[0].u) return profiles[0];
    if (u >= profiles[profiles.length - 1].u) return profiles[profiles.length - 1];

    // Binary search for bracketing pair
    let lo = 0;
    let hi = profiles.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (profiles[mid].u <= u) lo = mid;
      else hi = mid;
    }

    const t = (u - profiles[lo].u) / (profiles[hi].u - profiles[lo].u || 1);
    return {
      w: profiles[lo].w + t * (profiles[hi].w - profiles[lo].w),
      d: profiles[lo].d + t * (profiles[hi].d - profiles[lo].d),
      surfaceY: profiles[lo].surfaceY + t * (profiles[hi].surfaceY - profiles[lo].surfaceY),
    };
  }

  // ── 4. Sample cross-sections along the spline ────────────────────────
  const SAMPLES = 600;
  // 4 vertices per cross-section: topLeft, topRight, bottomLeft, bottomRight
  const vertCount = (SAMPLES + 1) * 4;
  const positions = new Float32Array(vertCount * 3);

  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    const pos = spline.getPointAt(u);
    const tangent = spline.getTangentAt(u);

    // Perpendicular normal in XZ plane
    const nx = -tangent.z;
    const nz = tangent.x;
    const nLen = Math.sqrt(nx * nx + nz * nz) || 1;
    const normX = nx / nLen;
    const normZ = nz / nLen;

    // Interpolate width, depth, surface from profiles
    const prof = lerpProfile(u);
    const halfW = prof.w / 2;

    // Sample terrain at centreline AND both edges, take the max so river
    // always clears the coarse terrain mesh across its full width
    const leftX  = pos.x + normX * halfW;
    const leftZ  = pos.z + normZ * halfW;
    const rightX = pos.x - normX * halfW;
    const rightZ = pos.z - normZ * halfW;

    const yC = getTerrainMeshSurfaceY({ x: pos.x, z: pos.z });
    const yL = getTerrainMeshSurfaceY({ x: leftX,  z: leftZ });
    const yR = getTerrainMeshSurfaceY({ x: rightX, z: rightZ });
    const surfY = Math.max(yC ?? -Infinity, yL ?? -Infinity, yR ?? -Infinity);
    const fallback = surfY === -Infinity;
    const effectiveSurfY = fallback ? prof.surfaceY : surfY;

    const topY = effectiveSurfY + SURFACE_LIFT;
    const bottomY = effectiveSurfY - prof.d * VE;

    const base = i * 4 * 3;
    // topLeft
    positions[base]     = leftX;
    positions[base + 1] = topY;
    positions[base + 2] = leftZ;
    // topRight
    positions[base + 3] = rightX;
    positions[base + 4] = topY;
    positions[base + 5] = rightZ;
    // bottomLeft
    positions[base + 6] = leftX;
    positions[base + 7] = bottomY;
    positions[base + 8] = leftZ;
    // bottomRight
    positions[base + 9]  = rightX;
    positions[base + 10] = bottomY;
    positions[base + 11] = rightZ;
  }

  // ── 5. Build index buffer ────────────────────────────────────────────
  // 8 triangles per segment (top, bottom, left wall, right wall)
  // + 4 endcap triangles (2 per cap)
  const triCount = SAMPLES * 8 + 4;
  const indices = new Uint32Array(triCount * 3);
  let idx = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const b = i * 4;      // base section
    const n = (i + 1) * 4; // next section

    // Vertex layout per section:  0=TL  1=TR  2=BL  3=BR

    // Top face
    indices[idx++] = b;     indices[idx++] = n;     indices[idx++] = b + 1;
    indices[idx++] = b + 1; indices[idx++] = n;     indices[idx++] = n + 1;

    // Bottom face (reversed winding for downward normals)
    indices[idx++] = b + 2; indices[idx++] = b + 3; indices[idx++] = n + 2;
    indices[idx++] = b + 3; indices[idx++] = n + 3; indices[idx++] = n + 2;

    // Left wall (TL → BL side)
    indices[idx++] = b;     indices[idx++] = b + 2; indices[idx++] = n;
    indices[idx++] = b + 2; indices[idx++] = n + 2; indices[idx++] = n;

    // Right wall (TR → BR side)
    indices[idx++] = b + 1; indices[idx++] = n + 1; indices[idx++] = b + 3;
    indices[idx++] = n + 1; indices[idx++] = n + 3; indices[idx++] = b + 3;
  }

  // Start endcap (section 0)
  indices[idx++] = 0; indices[idx++] = 1; indices[idx++] = 2;
  indices[idx++] = 1; indices[idx++] = 3; indices[idx++] = 2;

  // End endcap (last section)
  const last = SAMPLES * 4;
  indices[idx++] = last;     indices[idx++] = last + 2; indices[idx++] = last + 1;
  indices[idx++] = last + 1; indices[idx++] = last + 2; indices[idx++] = last + 3;

  // ── 6. Assemble geometry ─────────────────────────────────────────────
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // ── 7. Material ──────────────────────────────────────────────────────
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.3,
    metalness: 0.05,
    emissive: 0x0a1e3d,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'thamesRiver';
  mesh.renderOrder = 1; // draw after terrain so top face wins depth test at boundaries

  console.log(`Thames volume: ${validPoints.length} data points → ${vertCount} vertices, ${triCount} triangles`);

  return mesh;
}
