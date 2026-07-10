// Unified shaft system — one frosted glass cylinder per physical station,
// sized by interchange complexity (line count).

import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';

const BASE_RADIUS = 9;        // ~2x tunnel width for single-line stations
const PLATFORM_CLEARANCE = 5;  // metres below deepest platform

// Shared frosted glass material for all shafts.
// DoubleSide + depthWrite:false stays (the camera can be INSIDE a shaft, and
// the stable 2-layer composite at this low alpha is fine) but transmission is
// gone (10Jul26f transparency pass): it was fresnel view-angle dependent and
// its pass samples only the opaque scene, so shafts flipped between glassy and
// milky with camera angle. Opacity 0.27 -> 0.33 compensates the lost
// transmitted light. emissiveIntensity must stay <= 0.05 (CLAUDE.md trap).
const frostedGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.33,
  roughness: 0.55,
  metalness: 0.0,
  clearcoat: 0.15,
  clearcoatRoughness: 0.7,
  emissive: 0xffffff,
  emissiveIntensity: 0.03,
  side: THREE.DoubleSide,
  depthWrite: false,
  envMapIntensity: 0.3,
});

// Unit cylinder — scaled per station via mesh.scale
const unitCylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 16);

/**
 * Create one frosted glass cylinder per unique station from the shaft registry.
 *
 * @param {Object} opts
 * @param {THREE.Scene} opts.scene
 * @param {Map} opts.registry - from getShaftRegistry()
 * @param {Function} opts.getTerrainMeshSurfaceY - ({ x, z }) => number | null
 * @param {number} opts.verticalScale - VE multiplier
 * @returns Unified shaft layer with update/filter/dispose methods
 */
export function createUnifiedShafts({ scene, registry, getTerrainMeshSurfaceY, verticalScale }) {
  const group = new THREE.Group();
  group.userData.kind = 'unified-shafts';
  group.renderOrder = RENDER_ORDER.SHAFT;

  // naptanId -> { mesh, groundY, platformY, radius, entry }
  const byId = new Map();

  for (const [naptanId, entry] of registry) {
    const lineCount = Math.max(entry.lineCount, entry.lines.size);
    const radius = BASE_RADIUS * (1 + 0.25 * (lineCount - 1));

    // Initial ground Y from terrain if available, else 0
    let groundY = 0;
    if (getTerrainMeshSurfaceY) {
      const surfY = getTerrainMeshSurfaceY({ x: entry.x, z: entry.z });
      if (Number.isFinite(surfY)) groundY = surfY;
    }

    // Platform Y: deepest depth below ground surface
    const platformY = groundY - (entry.deepestDepthM * verticalScale) - PLATFORM_CLEARANCE;
    const height = Math.max(0.01, Math.abs(groundY - platformY));
    const midY = (groundY + platformY) / 2;

    const mesh = new THREE.Mesh(unitCylinderGeo, frostedGlassMat);
    mesh.scale.set(radius, height, radius);
    mesh.position.set(entry.x, midY, entry.z);
    mesh.renderOrder = RENDER_ORDER.SHAFT;

    // userData drives infra-hover tooltips. naptanId is the registry key for
    // per-station meta lookup in src/infra-meta.js (matches Prog stations.csv
    // 'naptan' column). Lines array carries the line ids; main.js's
    // formatInfraTooltip merges per-station depth/installed with per-line
    // diameter/engineer for Wave 3 station-shaft tooltips.
    mesh.userData = {
      type: 'station-shaft',
      naptanId,
      name: entry.name,
      lines: [...entry.lines],
      lineCount,
      deepestDepthM: entry.deepestDepthM,
    };

    group.add(mesh);
    byId.set(naptanId, { mesh, groundY, platformY, radius, entry });
  }

  scene.add(group);

  function recalcShaftGeometry(parts) {
    const height = Math.max(0.01, Math.abs(parts.groundY - parts.platformY));
    const midY = (parts.groundY + parts.platformY) / 2;
    parts.mesh.scale.y = height;
    parts.mesh.position.y = midY;
  }

  return {
    group,
    byId,

    /**
     * Update ground (surface) Y positions from terrain heightmap.
     * Called after terrain loads or if terrain updates.
     */
    updateGroundYPositions(getTerrainSurfaceYFn) {
      for (const [naptanId, parts] of byId) {
        const surfY = getTerrainSurfaceYFn({ x: parts.entry.x, z: parts.entry.z });
        if (!Number.isFinite(surfY)) continue;
        parts.groundY = surfY;
        recalcShaftGeometry(parts);
      }
    },

    /**
     * Update platform (bottom) Y positions from tube centerline data.
     * For each shaft, finds the lowest centerline Y across all lines serving that station.
     * Called after tubes snap to terrain-relative depth.
     *
     * @param {Map<string, Array<{x,y,z}>>} lineCenterPoints
     */
    updatePlatformYPositions(lineCenterPoints) {
      for (const [naptanId, parts] of byId) {
        const entry = parts.entry;
        let deepestY = Infinity;

        for (const lineId of entry.lines) {
          const centerPts = lineCenterPoints.get(lineId);
          if (!centerPts?.length) continue;

          // Find nearest centerline point by XZ distance
          let bestY = Infinity;
          let bestD2 = Infinity;
          for (const p of centerPts) {
            const dx = p.x - entry.x;
            const dz = p.z - entry.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestY = p.y;
            }
          }

          if (bestY < deepestY) deepestY = bestY;
        }

        if (Number.isFinite(deepestY)) {
          parts.platformY = deepestY - PLATFORM_CLEARANCE;
          recalcShaftGeometry(parts);
        }
      }
    },

    /**
     * Solo mode: show only shafts serving at least one line in the set.
     * Pass null or empty to show all.
     */
    setFilteredLines(lineIds) {
      if (!lineIds || lineIds.size === 0) {
        // Show all
        for (const parts of byId.values()) parts.mesh.visible = true;
        return;
      }
      for (const [, parts] of byId) {
        let visible = false;
        for (const lid of parts.entry.lines) {
          if (lineIds.has(lid)) { visible = true; break; }
        }
        parts.mesh.visible = visible;
      }
    },

    dispose() {
      scene.remove(group);
      // unitCylinderGeo and frostedGlassMat are module-level singletons —
      // don't dispose them here as they may be reused on hot-reload.
      group.clear();
    },
  };
}
