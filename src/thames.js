import * as THREE from 'three';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { RENDER_ORDER, WATER_LIFT } from './render-layers.js';
import { buildThamesProfiles, lerpThamesProfile } from './thames-profile.js';
import { createWaterMaterial, updateWater } from './water-material.js';

// River Thames data and 3D volume rendering
// Coordinates are in EPSG:27700 (British National Grid)
// Converted to scene coordinates matching terrain.js origin

// Water surface level in metres OD — flat water surface
export const WATER_LEVEL_M = 2;
// Rendered water top in scene units (2*5 + 2 = 12 → effective 2.4m OD).
// Single source of truth for "is the camera below the water surface" —
// shared by the submerged predicate in main.js and the volume top face here.
export const WATER_TOP_Y = WATER_LEVEL_M * VERTICAL_EXAGGERATION + WATER_LIFT;
export { updateWater };

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
export function createThamesVolume(thamesData, getTerrainMeshSurfaceY = null, options = {}) {
  if (!thamesData?.points?.length) return null;

  const {
    color,
    opacity,
  } = options;

  const VE = VERTICAL_EXAGGERATION;
  // Top face sits at WATER_TOP_Y = WATER_LEVEL_M*VE + WATER_LIFT (render-layers.js)
  // — the WATER_LIFT term keeps it above the carved terrain shelf (no z-fighting).

  // ── 1. Convert all points (no terrain filtering needed) ───────────────
  const validPoints = [];
  for (const pt of thamesData.points) {
    const pos = bngToScene(pt.e, pt.n);
    validPoints.push({ x: pos.x, z: pos.z, w: pt.w, d: pt.d });
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
  const profiles = buildThamesProfiles(validPoints);

  // ── 4. Sample cross-sections along the spline ────────────────────────
  // 1500 samples over the ~95km course ≈ 64m cross-section spacing — well under
  // the 250m data spacing. At 600 (159m spacing) the spline cut sharp west-of-Kew
  // corners by up to 27m, more than the old 21m half-width: the volume missed its
  // own centreline at 7 bends (12Jul26u forensics, raycast-audit).
  const SAMPLES = 1500;
  // 4 vertices per cross-section: topLeft, topRight, bottomLeft, bottomRight
  const vertCount = (SAMPLES + 1) * 4;
  const positions = new Float32Array(vertCount * 3);
  const waterDepths = new Float32Array(vertCount);
  const waterEdges = new Float32Array(vertCount);

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

    // Interpolate width, depth from profiles
    const prof = lerpThamesProfile(profiles, u);
    const halfW = prof.w / 2;

    const leftX  = pos.x + normX * halfW;
    const leftZ  = pos.z + normZ * halfW;
    const rightX = pos.x - normX * halfW;
    const rightZ = pos.z - normZ * halfW;

    // Flat water surface at constant level (terrain is carved to match)
    const topY = WATER_TOP_Y;
    const bottomY = WATER_LEVEL_M * VE - prof.d * VE;

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

    const depth = prof.d;
    const vBase = i * 4;
    waterDepths[vBase] = depth;
    waterDepths[vBase + 1] = depth;
    waterDepths[vBase + 2] = depth;
    waterDepths[vBase + 3] = depth;
    // Across-water coordinate: -1/1 at banks, interpolating through 0 mid-river.
    waterEdges[vBase] = -1.0;
    waterEdges[vBase + 1] = 1.0;
    waterEdges[vBase + 2] = -1.0;
    waterEdges[vBase + 3] = 1.0;
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
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepths, 1));
  geometry.setAttribute('waterEdge', new THREE.BufferAttribute(waterEdges, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // ── 7. Material ──────────────────────────────────────────────────────
  const material = createWaterMaterial('thames', {
    ...(color ? { baseColor: color } : {}),
    ...(opacity ? { opacity } : {}),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'thamesRiver';
  mesh.userData = { type: 'thames', name: 'River Thames' };
  mesh.renderOrder = RENDER_ORDER.SURFACE_WATER; // draw after terrain so top face wins depth test at boundaries

  // ── 8. Interior shell (submerged regime, 12Jul26u) ───────────────────
  // A separate OPAQUE BackSide mesh giving the inside of the water volume
  // solid bounds: underside of the surface above + both side walls + endcaps.
  // No bottom face — the carved terrain bed (FrontSide topMat) is the floor
  // and already reads correctly from inside; a shell bottom would z-fight it
  // and occlude bathymetry pockets where the DEM carved deeper than the
  // profile. BackSide means only interior-facing surfaces rasterise, and the
  // mesh is additionally visibility-gated in main.js by the shared
  // isSubmergedAt predicate — so the OUTSIDE view is pixel-identical to the
  // shell-less build (it simply never renders for an exterior camera).
  //
  // The shell top sits SHELL_TOP_DROP below the translucent top face so the
  // two are never coplanar (the DoubleSide water top still composites its
  // underside ripple over the shell from within).
  const SHELL_TOP_DROP = 0.05;
  const shellPositions = positions.slice();
  for (let i = 0; i <= SAMPLES; i++) {
    const base = i * 4 * 3;
    shellPositions[base + 1] -= SHELL_TOP_DROP; // topLeft y
    shellPositions[base + 4] -= SHELL_TOP_DROP; // topRight y
  }

  // 6 triangles per segment (top + left wall + right wall) + 4 endcap tris.
  const shellTriCount = SAMPLES * 6 + 4;
  const shellIndices = new Uint32Array(shellTriCount * 3);
  let sIdx = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const b = i * 4;
    const n = (i + 1) * 4;
    // Top face (same outward winding as the volume; BackSide renders its underside)
    shellIndices[sIdx++] = b;     shellIndices[sIdx++] = n;     shellIndices[sIdx++] = b + 1;
    shellIndices[sIdx++] = b + 1; shellIndices[sIdx++] = n;     shellIndices[sIdx++] = n + 1;
    // Left wall
    shellIndices[sIdx++] = b;     shellIndices[sIdx++] = b + 2; shellIndices[sIdx++] = n;
    shellIndices[sIdx++] = b + 2; shellIndices[sIdx++] = n + 2; shellIndices[sIdx++] = n;
    // Right wall
    shellIndices[sIdx++] = b + 1; shellIndices[sIdx++] = n + 1; shellIndices[sIdx++] = b + 3;
    shellIndices[sIdx++] = n + 1; shellIndices[sIdx++] = n + 3; shellIndices[sIdx++] = b + 3;
  }
  // Start endcap
  shellIndices[sIdx++] = 0; shellIndices[sIdx++] = 1; shellIndices[sIdx++] = 2;
  shellIndices[sIdx++] = 1; shellIndices[sIdx++] = 3; shellIndices[sIdx++] = 2;
  // End endcap
  const sLast = SAMPLES * 4;
  shellIndices[sIdx++] = sLast;     shellIndices[sIdx++] = sLast + 2; shellIndices[sIdx++] = sLast + 1;
  shellIndices[sIdx++] = sLast + 1; shellIndices[sIdx++] = sLast + 2; shellIndices[sIdx++] = sLast + 3;

  const shellGeometry = new THREE.BufferGeometry();
  shellGeometry.setAttribute('position', new THREE.BufferAttribute(shellPositions, 3));
  shellGeometry.setIndex(new THREE.BufferAttribute(shellIndices, 1));
  shellGeometry.computeVertexNormals();

  // Opaque dark water body. Emissive lift keeps it from reading void-black
  // under low ambient (same pattern as the terrain underside emissive,
  // terrain.js). The submerged fog regime (environment.js) does the murk —
  // walls dissolve into green-brown within the short waterFogFar.
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c1712,   // dark green-brown water body — sits with the submerged
    emissive: 0x152016, // fog regime (waterFogColor 0x2a3d2f), not the exterior blue
    emissiveIntensity: 0.55,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true,
  });

  const interiorShell = new THREE.Mesh(shellGeometry, shellMaterial);
  interiorShell.name = 'thamesInteriorShell';
  // Draw with the opaque pass BEFORE the transparent water surface so the
  // translucent top blends over it and solid depth occludes geometry beyond
  // the walls (tubes, buildings, far-bank terrain).
  interiorShell.renderOrder = RENDER_ORDER.TERRAIN;
  interiorShell.visible = false; // toggled per-frame by isSubmergedAt in main.js
  interiorShell.raycast = () => {}; // never a hover/tooltip target
  mesh.add(interiorShell);
  mesh.userData.interiorShell = interiorShell;

  console.log(`Thames volume: ${validPoints.length} data points → ${vertCount} vertices, ${triCount} triangles (+ interior shell ${shellTriCount} tris)`);

  return mesh;
}
