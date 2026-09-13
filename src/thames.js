import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import * as THREE from 'three';
import { VERTICAL_EXAGGERATION, getTerrainRiverBed } from './terrain.js';
import { RENDER_ORDER, WATER_LIFT } from './render-layers.js';
import { buildThamesCrossSections } from './thames-profile.js';
import { createWaterMaterial, updateWater } from './water-material.js';
import { createThamesNavigation } from './thames-navigation.js';
import { createRiverBankMaterial, initialiseRiverBedMask, configureRiverMaterialReach } from './river-materials.js';

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

  // Shared exact cross-sections also define the locally refined terrain bed.
  const SAMPLES = 1500;
  const {positions,totalChain} = buildThamesCrossSections(validPoints,
    {samples:SAMPLES,VE,waterLevelM:WATER_LEVEL_M,topY:WATER_TOP_Y});
  const vertCount=(SAMPLES+1)*4;
  const waterDepths=new Float32Array(vertCount),waterEdges=new Float32Array(vertCount);
  for(let i=0;i<=SAMPLES;i++){
    const base=i*12,depth=(WATER_LEVEL_M*VE-positions[base+7])/VE;
    for(let side=0;side<2;side++){
      const b=base+6+side*3;
      // Connect banks to the same final floor, including retained deeper pockets.
      const actual=getTerrainMeshSurfaceY?.({x:positions[b],z:positions[b+2]});
      if(actual!==null&&actual!==undefined)positions[b+1]=Math.min(positions[b+1],actual);
    }
    waterDepths.fill(depth,i*4,i*4+4);
    waterEdges.set([-1,1,-1,1],i*4);
  }
  const bed=getTerrainRiverBed();
  if(bed)for(let i=0;i<SAMPLES;i++)for(const side of[0,1]){
    const a=i*12+6+side*3,b=a+12;
    const minimum=bed.segmentMinimum({x:positions[a],z:positions[a+2]},
      {x:positions[b],z:positions[b+2]});
    // Foundations extend to the deepest actual triangle along this bank
    // segment. Any excess is behind the opaque floor, preventing local gaps.
    if(Number.isFinite(minimum)){positions[a+1]=Math.min(positions[a+1],minimum);positions[b+1]=Math.min(positions[b+1],minimum);}
  }

  // ── 5. Build index buffer ────────────────────────────────────────────
  // Top and banks only. Refined terrain is the bed; a second flat water
  // bottom would cover retained deeper pockets.
  // + 4 endcap triangles (2 per cap)
  const triCount = SAMPLES * 6 + 4;
  const indices = new Uint32Array(triCount * 3);
  let idx = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const b = i * 4;      // base section
    const n = (i + 1) * 4; // next section

    // Vertex layout per section:  0=TL  1=TR  2=BL  3=BR

    // Top face
    indices[idx++] = b;     indices[idx++] = n;     indices[idx++] = b + 1;
    indices[idx++] = b + 1; indices[idx++] = n;     indices[idx++] = n + 1;

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
  mesh.userData.navigation = createThamesNavigation(positions, getTerrainMeshSurfaceY, WATER_TOP_Y);
  mesh.userData.materialReach=configureRiverMaterialReach(thamesData.points);
  initialiseRiverBedMask(positions, totalChain);

  // The distortion mask draws only the water surface, not the volume's sides
  // or underside. It shares exact triangles with the visible mesh.
  const surfaceIndices = new Uint32Array(SAMPLES * 6);
  for (let i = 0; i < SAMPLES; i++) {
    const b = i * 4, n = b + 4;
    surfaceIndices.set([b, n, b + 1, b + 1, n, n + 1], i * 6);
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', geometry.getAttribute('position'));
  surfaceGeometry.setIndex(new THREE.BufferAttribute(surfaceIndices, 1));
  mesh.userData.surfaceGeometry = surfaceGeometry;

  // ── 8. Interior shell (submerged regime, 12Jul26u) ───────────────────
  // A separate opaque BackSide mesh supplies both banks and endcaps.
  // The upward surface stays translucent for the refracted city view.
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

  // Masonry/mud banks remain opaque, but the ceiling is now the translucent
  // living-water surface itself. Keep the actual carved terrain as the floor.
  const shellTriCount = SAMPLES * 4 + 4;
  const shellIndices = new Uint32Array(shellTriCount * 3);
  let sIdx = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const b = i * 4;
    const n = (i + 1) * 4;
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
  const chainages = new Float32Array(vertCount);
  for (let i = 0; i < vertCount; i++) chainages[i] = Math.floor(i / 4) / SAMPLES * totalChain;
  shellGeometry.setAttribute('riverChain', new THREE.BufferAttribute(chainages, 1));
  shellGeometry.computeVertexNormals();

  // Opaque dark water body. Emissive lift keeps it from reading void-black
  // under low ambient (same pattern as the terrain underside emissive,
  // terrain.js). The submerged fog regime (environment.js) does the murk —
  // walls dissolve into green-brown within the short waterFogFar.
  const shellMaterial = createRiverBankMaterial();

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
