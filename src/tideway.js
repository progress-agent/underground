// Tideway Tunnel (Super Sewer) visualization module
// The Thames Tideway Tunnel is a 25km super sewer running beneath the Thames
// Depth: 30m (Acton) to 65m (Blackfriars) - deeper than tube tunnels

import * as THREE from 'three';

let tidewayData = null;

export async function loadTidewayData() {
  try {
    const response = await fetch('/data/tideway_depths.csv');
    if (!response.ok) throw new Error('Tideway data not found');
    const csv = await response.text();
    tidewayData = parseTidewayCSV(csv);
    console.log(`Loaded ${tidewayData.points.length} Tideway tunnel points`);
    return tidewayData;
  } catch (e) {
    console.warn('Could not load Tideway data:', e.message);
    return null;
  }
}

function parseTidewayCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const points = [];
  
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 5) {
      points.push({
        id: parts[0],
        name: parts[1],
        depth: parseFloat(parts[2]),
        lat: parseFloat(parts[3]),
        lon: parseFloat(parts[4]),
        notes: parts[6] || ''
      });
    }
  }
  
  return { points };
}

export function createTidewayTunnel(data, latLonToXZ, verticalScale = 3.0) {
  if (!data || !data.points.length) return null;
  
  const group = new THREE.Group();
  group.name = 'tideway-tunnel';
  
  // Use CSV file order directly (pre-sorted west→east route sequence)
  const orderedPoints = data.points;

  // Create curve through all points
  const curvePoints = orderedPoints.map(p => {
    const xz = latLonToXZ(p.lat, p.lon);
    // Depth is negative Y (below ground)
    const y = -(p.depth * verticalScale);
    return new THREE.Vector3(xz.x, y, xz.z);
  });
  
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  curve.curveType = 'catmullrom';
  curve.tension = 0.5;
  
  // Create tunnel geometry
  const tubeGeometry = new THREE.TubeGeometry(curve, 200, 3.6, 12, false);
  
  // Tideway is larger than tube tunnels (7.2m diameter vs 3.6m)
  // but we exaggerate less for visibility
  const tunnelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8, // Thames-matching blue
    transparent: true,
    opacity: 0.5,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide
  });
  
  const tunnelMesh = new THREE.Mesh(tubeGeometry, tunnelMaterial);
  tunnelMesh.castShadow = true;
  tunnelMesh.receiveShadow = true;
  group.add(tunnelMesh);
  
  // Add glow effect to show it's deeper/bigger
  const glowGeometry = new THREE.TubeGeometry(curve, 100, 4.0, 12, false);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.15
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  group.add(glowMesh);
  
  // Add depth markers at key points
  orderedPoints.forEach((p, i) => {
    if (i % 3 === 0) { // Every 3rd point to avoid clutter
      const xz = latLonToXZ(p.lat, p.lon);
      const y = -(p.depth * verticalScale);
      
      const markerGeometry = new THREE.SphereGeometry(1.5, 12, 12);
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.6
      });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(xz.x, y, xz.z);
      group.add(marker);
    }
  });
  
  return group;
}

export function createTidewayLegendItem() {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `
    <div class="legend-line" style="background: linear-gradient(to right, #1d4ed8, #3b82f6);"></div>
    <span class="legend-label">Tideway Tunnel (30-65m)</span>
  `;
  return item;
}

export function addTidewayToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  // Add separator
  const separator = document.createElement('div');
  separator.style.cssText = 'height: 1px; background: var(--border); margin: 8px 0;';
  legend.appendChild(separator);
  
  // Add infrastructure section header
  const header = document.createElement('div');
  header.className = 'legend-item';
  header.innerHTML = `<span class="legend-label" style="color: var(--fg-muted); font-size: 10px; text-transform: uppercase;">Infrastructure</span>`;
  legend.appendChild(header);
  
  // Add Tideway
  legend.appendChild(createTidewayLegendItem());
}