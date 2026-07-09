// surface-geometry.js — 3D buildings (per-tile InstancedMesh)
//
// Creates one InstancedMesh of boxes per loaded tile. Tiles are loaded
// progressively by surface-loader.js; this module handles building
// placement and disposal for individual tiles.
//
// Parks and roads are handled by surface-texture.js (terrain shader).
// All Y coordinates come from getTerrainMeshSurfaceY, already VE-scaled.
// Building heights are VE-scaled here (height * VE).

import * as THREE from 'three';

// -- Shared material (single instance across all tiles) -----------------------

const buildingMat = new THREE.MeshStandardMaterial({
  color: 0x8a8580,
  roughness: 0.85,
  metalness: 0.1,
});

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

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
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

    dummy.position.set(b.cx, baseY + h / 2, b.cz);
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
