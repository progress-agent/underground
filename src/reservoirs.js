// London Reservoirs visualization module
// Flat blue polygons at terrain surface height

import * as THREE from 'three';

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
    side: THREE.DoubleSide
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
    
    // First point (note: z is used as y in the 2D shape plane)
    shape.moveTo(sceneCoords[0].x, sceneCoords[0].z);
    
    // Remaining points
    for (let i = 1; i < sceneCoords.length; i++) {
      shape.lineTo(sceneCoords[i].x, sceneCoords[i].z);
    }
    
    shape.closePath();
    
    // Create flat geometry at surface height
    const shapeGeometry = new THREE.ShapeGeometry(shape);
    
    // Rotate to lie flat on XZ plane at surfaceY
    // ShapeGeometry creates geometry in XY plane, we need to rotate -90° around X
    shapeGeometry.rotateX(-Math.PI / 2);
    shapeGeometry.translate(0, surfaceY + 0.5, 0); // +0.5m to avoid z-fighting with terrain
    
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
