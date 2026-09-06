// surface-geometry.js — 3D buildings (per-tile InstancedMesh)
//
// Creates one InstancedMesh of boxes per loaded tile. Tiles are loaded
// progressively by surface-loader.js; this module handles building
// placement and disposal for individual tiles.
//
// Parks and roads are handled by surface-texture.js (terrain shader).
// All Y coordinates come from getTerrainMeshSurfaceY, already VE-scaled.
//
// BUILDING HEIGHT IS ITS OWN MULTIPLIER (06Sep26u, D-023). Buildings are the
// one class of scene object that never crosses the ground plane — each sits
// entirely above its own terrain point — so they can carry a vertical scale
// independent of the global VE without any of the datum warping that a
// ground-referenced VE split would inflict on the chalk floor (mOD) or the
// water level (mOD). Terrain, tube depths, chalk, water, shafts, bridges and
// the Overground all keep VE=5.
//
// The scale is applied in the SHADER, not the instance matrix: the box is
// pivoted at its base (translate(0, 0.5, 0)) and the vertex shader multiplies
// local y by uHeightScale, so each building grows and shrinks about its own
// footprint. That makes the slider free — no instance-matrix rewrite across
// 1.35M buildings, no re-parse, no reallocation.
//
// Measured 06Sep26u, and the reason this exists: 84.9% of the tile set's
// heights are exactly 10.0m (a pipeline fallback where OSM carries no height)
// and 12.3% are 6.4m. Real median aspect (height / sqrt(area)) is 1.04; at
// VE=5 it renders as 5.21, so every terrace in London was being drawn as a
// five-storey slab on a house-sized footprint.

import * as THREE from 'three';

// -- Shared material (single instance across all tiles) -----------------------

// Default 1.0 = heights exactly as authored by the caller's VE argument, i.e.
// the pre-06Sep26u look. The HUD slider drives it down toward true scale.
const heightScaleUniform = { value: 1.0 };

const buildingMat = new THREE.MeshStandardMaterial({
  color: 0x8a8580,
  roughness: 0.85,
  metalness: 0.1,
});

// Scale local y (0..1, base-pivoted) before the instance matrix applies its own
// y scale. Injected once on the shared material — every tile's InstancedMesh
// uses this same material instance, so one uniform drives the whole city.
buildingMat.onBeforeCompile = (shader) => {
  shader.uniforms.uHeightScale = heightScaleUniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uHeightScale;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed.y *= uHeightScale;',
    );
};
// Distinct cache key so this material never shares a compiled program with an
// un-injected MeshStandardMaterial.
buildingMat.customProgramCacheKey = () => 'building-height-scale';

/**
 * Live building-height multiplier. 1.0 = as built (VE-scaled); 0.2 with VE=5
 * gives true real-world height. Free — one uniform, no geometry touched.
 */
export function setBuildingHeightScale(v) {
  // Capped at 1.0 deliberately. The InstancedMesh bounding sphere is computed
  // from the instance matrices, which encode the UNSCALED height, so a value
  // above 1 would push roofs outside the culling volume and pop buildings out
  // of view at grazing angles. Raising the cap means inflating the bounds too.
  heightScaleUniform.value = Math.max(0.05, Math.min(1, v));
}

export function getBuildingHeightScale() {
  return heightScaleUniform.value;
}

/**
 * The single shared building material. Exported so the baked path
 * (baked-buildings.js) renders through the same material instance and is
 * therefore driven by the same D-023 height uniform — one slider, both paths,
 * no second uniform to keep in step.
 */
export function getBuildingMaterial() {
  return buildingMat;
}

// NOTE: buildings use a single flat colour, NOT per-instance `setColorAt`.
// The old height-graded instanceColor tint (COLOR_LOW..COLOR_HIGH) triggered
// the `USE_INSTANCING_COLOR` shader path, which Apple's newer Metal/ANGLE
// driver (M5-era) mis-binds — it reads `instanceColor` as ~0 and multiplies
// every building to solid black (huge black boxes at altitude). The M2 Max
// driver binds it correctly, so the bug was machine-specific and invisible on
// the dev machine. Proven live on M5: dropping instanceColor renders buildings
// correctly on both GPUs. Do NOT reintroduce setColorAt without a per-tile
// vertex-colour bake instead. (Diagnosed 09Jul26h — see project CLAUDE.md.)

// -- Per-tile building creation -----------------------------------------------

/**
 * Create an InstancedMesh of boxes for a single tile's buildings.
 *
 * @param {Array}    buildings              Array of { cx, cz, height, area }
 * @param {Function} getTerrainMeshSurfaceY ({x, z}) => Y on terrain (VE-scaled), or null
 * @param {number}   VE                     Vertical exaggeration factor (5)
 * @param {Function} [isDuplicateFn]        (building) => boolean — boundary dedup filter
 * @returns {THREE.InstancedMesh|null}
 */
export function createTileBuildings(buildings, getTerrainMeshSurfaceY, VE, isDuplicateFn) {
  if (!buildings || buildings.length === 0) return null;

  // Filter boundary duplicates before allocating the InstancedMesh buffer
  const unique = isDuplicateFn ? buildings.filter(b => !isDuplicateFn(b)) : buildings;
  if (unique.length === 0) return null;

  // Base-pivoted: local y runs 0..1 from footprint to roof, so the shader's
  // uHeightScale grows/shrinks each building about its own base rather than
  // its centre. Instance position is therefore baseY, NOT baseY + h/2.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(boxGeo, buildingMat, unique.length);

  const dummy = new THREE.Object3D();
  let idx = 0;

  for (const b of unique) {
    const baseY = getTerrainMeshSurfaceY({ x: b.cx, z: b.cz });
    if (baseY === null || baseY === undefined || Number.isNaN(baseY)) continue;

    // Guard against degenerate OSM data: a zero-length scale axis (zero area
    // OR zero/negative height — 76 zero-height + 1 negative-height buildings
    // exist in the tile set) makes the instance normal matrix divide by zero
    // → NaN normal. One NaN fragment in view poisons the whole frame through
    // UnrealBloom's blur on some drivers (M5 headless ANGLE: full black frame
    // at altitude), so these guards are load-bearing, not cosmetic.
    if (!Number.isFinite(b.height) || !Number.isFinite(b.area)) continue;
    const side = Math.max(Math.sqrt(b.area), 0.1);
    const h = Math.max(b.height, 0.5) * VE;

    dummy.position.set(b.cx, baseY, b.cz); // base-pivoted geometry
    dummy.scale.set(side, h, side);
    dummy.updateMatrix();
    mesh.setMatrixAt(idx, dummy.matrix);

    idx++;
  }

  mesh.count = idx; // trim to actual placed instances
  if (idx === 0) { boxGeo.dispose(); return null; } // no placed instances → don't add an empty mesh
  mesh.instanceMatrix.needsUpdate = true;

  return mesh;
}

// -- Tile disposal ------------------------------------------------------------

/**
 * Dispose a tile's building InstancedMesh (geometry only — material is shared).
 */
export function disposeTileGeometry(mesh) {
  if (!mesh) return;
  mesh.geometry.dispose();
}

// -- Group visibility toggle --------------------------------------------------

/**
 * Toggle visibility of the surface geometry group (parent of all tile meshes).
 */
export function setSurfaceGeometryVisible(group, visible) {
  if (group) group.visible = visible;
}
