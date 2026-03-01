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

// -- Height-dependent building colour palette ---------------------------------

const COLOR_LOW  = new THREE.Color(0x706b66);  // darker at ground level
const COLOR_HIGH = new THREE.Color(0xb0aaa4);  // lighter for tall buildings

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
  const color = new THREE.Color();
  let idx = 0;

  for (const b of unique) {
    const baseY = getTerrainMeshSurfaceY({ x: b.cx, z: b.cz });
    if (baseY === null || baseY === undefined) continue;

    const side = Math.sqrt(b.area);
    const h = b.height * VE;

    dummy.position.set(b.cx, baseY + h / 2, b.cz);
    dummy.scale.set(side, h, side);
    dummy.updateMatrix();
    mesh.setMatrixAt(idx, dummy.matrix);

    // Height-based colour: normalise against 80m real-world range
    const t = Math.min(b.height / 80, 1);
    color.lerpColors(COLOR_LOW, COLOR_HIGH, t);
    mesh.setColorAt(idx, color);

    idx++;
  }

  mesh.count = idx; // trim to actual placed instances
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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
