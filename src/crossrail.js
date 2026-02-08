// Crossrail (Elizabeth Line) visualization module
// Crossrail is a 118km railway with 42km of new tunnels beneath London
// Deepest point: Liverpool Street at ~41m below ground
// Diameter: 6.2m (larger than tube tunnels at 3.6m)

import * as THREE from 'three';

let crossrailData = null;

export async function loadCrossrailData() {
  try {
    const response = await fetch('/data/crossrail_depths.csv');
    if (!response.ok) throw new Error('Crossrail data not found');
    const csv = await response.text();
    crossrailData = parseCrossrailCSV(csv);
    console.log(`Loaded ${crossrailData.points.length} Crossrail points`);
    return crossrailData;
  } catch (e) {
    console.warn('Could not load Crossrail data:', e.message);
    return null;
  }
}

function parseCrossrailCSV(csv) {
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

export function createCrossrailTunnel(data, latLonToXZ, verticalScale = 3.0) {
  if (!data || !data.points.length) return null;
  
  const group = new THREE.Group();
  group.name = 'crossrail-tunnel';
  
  // Sort points from west to east
  const sortedPoints = [...data.points].sort((a, b) => a.lon - b.lon);
  
  // Split into sections: west (surface), central (tunnel), east (surface)
  const westSection = sortedPoints.filter(p => p.lon < -0.2);
  const centralSection = sortedPoints.filter(p => p.lon >= -0.2 && p.lon <= 0.05);
  const eastSection = sortedPoints.filter(p => p.lon > 0.05);
  
  // Create curves for each section
  const createSectionCurve = (sectionPoints) => {
    if (sectionPoints.length < 2) return null;
    const curvePoints = sectionPoints.map(p => {
      const xz = latLonToXZ(p.lat, p.lon);
      const y = -(p.depth * verticalScale);
      return new THREE.Vector3(xz.x, y, xz.z);
    });
    return new THREE.CatmullRomCurve3(curvePoints);
  };
  
  // Create tunnel material (yellow - Elizabeth Line TfL colour)
  const tunnelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffd300, // Elizabeth Line yellow
    transparent: true,
    opacity: 0.75,
    roughness: 0.3,
    metalness: 0.4,
    side: THREE.DoubleSide
  });
  
  // Build central tunnel section (the deep part)
  const centralCurve = createSectionCurve(centralSection);
  if (centralCurve) {
    const tubeGeometry = new THREE.TubeGeometry(centralCurve, 150, 9.0, 12, false);
    const tunnelMesh = new THREE.Mesh(tubeGeometry, tunnelMaterial);
    tunnelMesh.castShadow = true;
    tunnelMesh.receiveShadow = true;
    group.add(tunnelMesh);

    // Add glow
    const glowGeometry = new THREE.TubeGeometry(centralCurve, 100, 10.0, 12, false);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.2
    });
    group.add(new THREE.Mesh(glowGeometry, glowMaterial));
  }
  
  // Build western section
  const westCurve = createSectionCurve(westSection);
  if (westCurve) {
    const westGeometry = new THREE.TubeGeometry(westCurve, 80, 7.0, 10, false);
    const westMaterial = tunnelMaterial.clone();
    westMaterial.opacity = 0.5; // More transparent for surface sections
    group.add(new THREE.Mesh(westGeometry, westMaterial));
  }
  
  // Build eastern section
  const eastCurve = createSectionCurve(eastSection);
  if (eastCurve) {
    const eastGeometry = new THREE.TubeGeometry(eastCurve, 100, 7.0, 10, false);
    const eastMaterial = tunnelMaterial.clone();
    eastMaterial.opacity = 0.5;
    group.add(new THREE.Mesh(eastGeometry, eastMaterial));
  }
  
  // Add markers at key deep stations
  const deepStations = sortedPoints.filter(p => p.depth >= 25);
  deepStations.forEach(p => {
    const xz = latLonToXZ(p.lat, p.lon);
    const y = -(p.depth * verticalScale);
    
    const markerGeometry = new THREE.SphereGeometry(2, 12, 12);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd300,
      transparent: true,
      opacity: 0.7
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(xz.x, y, xz.z);
    marker.userData = { name: p.name, depth: p.depth, type: 'crossrail' };
    group.add(marker);
  });
  
  return group;
}

export function createCrossrailLegendItem() {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `
    <div class="legend-line" style="background: linear-gradient(to right, #ffd300, #ffe066);"></div>
    <span class="legend-label">Crossrail/Elizabeth Line (18-41m)</span>
  `;
  return item;
}

export function addCrossrailToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  const existingItems = legend.querySelectorAll('.legend-item');
  let infrastructureHeader = null;
  
  // Find Infrastructure header or add one
  for (const item of existingItems) {
    if (item.textContent.includes('Infrastructure')) {
      infrastructureHeader = item;
      break;
    }
  }
  
  if (!infrastructureHeader) {
    const separator = document.createElement('div');
    separator.style.cssText = 'height: 1px; background: var(--border); margin: 8px 0;';
    legend.appendChild(separator);
    
    const header = document.createElement('div');
    header.className = 'legend-item';
    header.innerHTML = `<span class="legend-label" style="color: var(--fg-muted); font-size: 10px; text-transform: uppercase;">Infrastructure</span>`;
    legend.appendChild(header);
  }
  
  legend.appendChild(createCrossrailLegendItem());
}