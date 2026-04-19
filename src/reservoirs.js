// London Reservoirs visualization module
// Flat blue polygons at terrain surface height

import * as THREE from 'three';

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
  
  // Material for water - similar to Thames but flatter
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x3b82f6, // Blue
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  
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
    const SURFACE_LIFT = 5; // scene units above highest terrain point
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
    
    const mesh = new THREE.Mesh(shapeGeometry, waterMaterial);
    mesh.userData = { 
      type: 'reservoir', 
      name: feature.name, 
      area: feature.area_ha 
    };
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
