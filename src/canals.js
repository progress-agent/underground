// London Canals visualization module
// Narrow water ribbons on the surface

import * as THREE from 'three';

let canalData = null;

export async function loadCanalData() {
  try {
    const response = await fetch('/data/canals.json');
    if (!response.ok) throw new Error('Canal data not found');
    canalData = await response.json();
    console.log(`Loaded ${canalData.features?.length || 0} canals`);
    return canalData;
  } catch (e) {
    console.warn('Could not load canal data:', e.message);
    return null;
  }
}

export function createCanals(data, latLonToXZ, getTerrainSurfaceY) {
  if (!data || !data.features || data.features.length === 0) return null;
  
  const group = new THREE.Group();
  group.name = 'canals';
  
  // Material for canals - slightly darker than reservoirs
  const canalMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x2563eb, // Darker blue
    transparent: true,
    opacity: 0.7,
    roughness: 0.3,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  
  // Filter to significant canals only (>0.5km to avoid clutter)
  const significantCanals = data.features.filter(f => f.length_km > 0.5);
  
  for (const feature of significantCanals) {
    if (!feature.coords || feature.coords.length < 2) continue;
    
    // Convert lat/lon to scene coordinates
    const sceneCoords = feature.coords.map(([lat, lon]) => {
      const xz = latLonToXZ(lat, lon);
      const y = getTerrainSurfaceY({ x: xz.x, z: xz.z });
      return new THREE.Vector3(xz.x, (y !== null ? y : 0) + 0.5, xz.z);
    });
    
    // Remove any points where terrain lookup failed
    const validCoords = sceneCoords.filter(v => v.y !== 0.5);
    if (validCoords.length < 2) continue;
    
    // Create curve through the canal route
    const curve = new THREE.CatmullRomCurve3(validCoords);
    curve.curveType = 'catmullrom';
    curve.tension = 0.3;
    
    // Create tube geometry - narrow ribbon (4m radius for visibility, actual canals 4-14m)
    const tubeGeometry = new THREE.TubeGeometry(curve, Math.min(validCoords.length * 4, 200), 3.5, 8, false);
    
    const mesh = new THREE.Mesh(tubeGeometry, canalMaterial);
    mesh.userData = { 
      type: 'canal', 
      name: feature.name, 
      length: feature.length_km 
    };
    group.add(mesh);
  }
  
  return group;
}

export function addCanalsToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  const legendItem = document.createElement('div');
  legendItem.className = 'legend-item';
  legendItem.innerHTML = `
    <div class="legend-line" style="background: #2563eb; opacity: 0.7;"></div>
    <span class="legend-label">Canals</span>
  `;
  legend.appendChild(legendItem);
}
