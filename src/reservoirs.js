// London Reservoirs visualization module
// Flat blue polygons at terrain surface height

import * as THREE from 'three';
import { RENDER_ORDER, RESERVOIR_LIFT, RESERVOIR_EDGE_LIFT } from './render-layers.js';
import { createWaterMaterial } from './water-material.js';

// Ray-cast point-in-polygon test (even-odd rule) on the XZ plane.
function pointInPolygon(x, z, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].x, zi = coords[i].z;
    const xj = coords[j].x, zj = coords[j].z;
    const intersect = ((zi > z) !== (zj > z)) &&
      (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

let reservoirData = null;

export async function loadReservoirData() {
  try {
    const response = await fetch('/data/reservoirs.json');
    if (!response.ok) throw new Error('Reservoir data not found');
    reservoirData = await response.json();
    console.log(`Loaded ${reservoirData.features?.length || 0} reservoirs`);
    return reservoirData;
  } catch (e) {
    console.warn('Could not load reservoir data:', e.message);
    return null;
  }
}

export function createReservoirs(data, latLonToXZ, getTerrainSurfaceY) {
  if (!data || !data.features || data.features.length === 0) return null;
  
  const group = new THREE.Group();
  group.name = 'reservoirs';
  
  // Shared living-water family, tuned mirror-calm for reservoirs.
  const waterMaterial = createWaterMaterial('reservoir');
  
  for (const feature of data.features) {
    if (!feature.coords || feature.coords.length < 3) continue;
    
    // Convert lat/lon to scene coordinates
    const sceneCoords = feature.coords.map(([lat, lon]) => latLonToXZ(lat, lon));
    
    // Get average Y position from terrain at centroid
    let centroidX = 0, centroidZ = 0;
    for (const c of sceneCoords) {
      centroidX += c.x;
      centroidZ += c.z;
    }
    centroidX /= sceneCoords.length;
    centroidZ /= sceneCoords.length;
    
    const surfaceY = getTerrainSurfaceY({ x: centroidX, z: centroidZ });
    if (surfaceY === null || surfaceY === undefined) continue;

    // Create shape from coordinates
    const shape = new THREE.Shape();

    // First point (negate Z to compensate for rotateX(-PI/2) which negates Y→Z)
    shape.moveTo(sceneCoords[0].x, -sceneCoords[0].z);

    // Remaining points
    for (let i = 1; i < sceneCoords.length; i++) {
      shape.lineTo(sceneCoords[i].x, -sceneCoords[i].z);
    }

    shape.closePath();

    // Create geometry and rotate to XZ plane
    const shapeGeometry = new THREE.ShapeGeometry(shape);
    shapeGeometry.rotateX(-Math.PI / 2);

    // Reservoirs are flat water surfaces at dam/spillway level.
    // Find the maximum terrain height across all vertices — the polygon must
    // clear every terrain peak within the basin to avoid z-fighting.
    // ShapeGeometry interior triangles are too sparse to drape per-vertex.
    const SURFACE_LIFT = RESERVOIR_LIFT; // scene units above highest terrain point (render-layers.js)
    const pos = shapeGeometry.attributes.position;
    let maxY = surfaceY;
    for (let i = 0; i < pos.count; i++) {
      const localY = getTerrainSurfaceY({ x: pos.getX(i), z: pos.getZ(i) });
      if (localY !== null && localY > maxY) maxY = localY;
    }
    // Sample a grid inside the bounding box, but skip samples outside the
    // reservoir polygon — otherwise nearby hills drag the water surface up.
    shapeGeometry.computeBoundingBox();
    const bb = shapeGeometry.boundingBox;
    const GRID_STEP = 200;
    for (let gx = bb.min.x; gx <= bb.max.x; gx += GRID_STEP) {
      for (let gz = bb.min.z; gz <= bb.max.z; gz += GRID_STEP) {
        if (!pointInPolygon(gx, gz, sceneCoords)) continue;
        const gy = getTerrainSurfaceY({ x: gx, z: gz });
        if (gy !== null && gy > maxY) maxY = gy;
      }
    }
    const waterY = maxY + SURFACE_LIFT;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, waterY);
    }
    pos.needsUpdate = true;

    let maxRadius = 1;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - centroidX;
      const dz = pos.getZ(i) - centroidZ;
      maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dz * dz));
    }
    const waterDepths = new Float32Array(pos.count);
    const waterEdges = new Float32Array(pos.count);
    const reservoirDepth = THREE.MathUtils.clamp((feature.area_ha || 25) / 40, 1.5, 8);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - centroidX;
      const dz = pos.getZ(i) - centroidZ;
      waterDepths[i] = reservoirDepth;
      waterEdges[i] = THREE.MathUtils.clamp(Math.sqrt(dx * dx + dz * dz) / maxRadius, 0, 1);
    }
    shapeGeometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepths, 1));
    shapeGeometry.setAttribute('waterEdge', new THREE.BufferAttribute(waterEdges, 1));
    
    const mesh = new THREE.Mesh(shapeGeometry, waterMaterial);
    mesh.userData = {
      type: 'reservoir',
      name: feature.name,
      area: feature.area_ha
    };
    // Distinct tier from the M25 road (SURFACE_ROAD) and drawn strictly
    // before its own edge outline below — see WATER_EDGE.
    mesh.renderOrder = RENDER_ORDER.SURFACE_WATER;
    group.add(mesh);

    // Add subtle edge highlight for larger reservoirs
    if (feature.area_ha > 50) {
      const edges = new THREE.EdgesGeometry(shapeGeometry);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.4
      });
      const edgeLines = new THREE.LineSegments(edges, lineMaterial);
      // Reservoir flicker fix: the outline previously shared the reservoir
      // mesh's exact Y and had no renderOrder, so the two coplanar
      // transparent surfaces flipped distance-sort order every frame.
      // Give the outline both a deliberately later tier AND a small extra
      // lift so it's unambiguously above the water polygon on both axes.
      edgeLines.renderOrder = RENDER_ORDER.WATER_EDGE;
      edgeLines.position.y = RESERVOIR_EDGE_LIFT;
      group.add(edgeLines);
    }
  }
  
  return group;
}

export function addReservoirsToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  const legendItem = document.createElement('div');
  legendItem.className = 'legend-item';
  legendItem.innerHTML = `
    <div class="legend-line" style="background: #3b82f6; opacity: 0.6;"></div>
    <span class="legend-label">Reservoirs</span>
  `;
  legend.appendChild(legendItem);
}
