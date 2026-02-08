// Geological strata visualization for London
// Shows Chalk bedrock layer where deep infrastructure (Crossrail, Tideway) anchors

import * as THREE from 'three';

export function createGeologicalStrata(bounds, verticalScale = 3.0) {
  const group = new THREE.Group();
  group.name = 'geological-strata';
  
  // Define strata boundaries (in real-world metres below ground)
  const CHALK_TOP = -60;         // Crossrail/Tideway punch into chalk
  const CHALK_BASE = -150;       // Visual bottom

  // Scale to world coordinates
  const chalkTopY = CHALK_TOP * verticalScale;
  const chalkBaseY = CHALK_BASE * verticalScale;

  // Create large plane for chalk stratum
  const planeSize = 40000; // 40km x 40km covers Greater London
  const segments = 64;
  
  // --- Chalk Bedrock (where deep infrastructure anchors) ---
  // Color: White/cream, the stable bedrock
  const chalkGeometry = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments);
  chalkGeometry.rotateX(-Math.PI / 2);
  
  const chalkMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf7fafc,      // White chalk color
    transparent: true,
    opacity: 0.30,
    roughness: 0.7,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  
  const chalkMesh = new THREE.Mesh(chalkGeometry, chalkMaterial);
  chalkMesh.position.y = (chalkTopY + chalkBaseY) / 2;
  chalkMesh.userData = {
    name: 'Chalk Group',
    depth: '60-150m+',
    description: 'White chalk bedrock - Crossrail and Tideway tunnel through this'
  };
  group.add(chalkMesh);
  
  // --- Boundary lines between strata ---
  const createBoundaryLine = (y, color, label) => {
    const lineGeometry = new THREE.BufferGeometry();
    const linePoints = [];
    
    // Create a grid of boundary lines
    const gridSize = 20000;
    const step = 5000;
    
    // Horizontal lines
    for (let x = -gridSize; x <= gridSize; x += step) {
      linePoints.push(new THREE.Vector3(x, y, -gridSize));
      linePoints.push(new THREE.Vector3(x, y, gridSize));
    }
    
    // Vertical lines
    for (let z = -gridSize; z <= gridSize; z += step) {
      linePoints.push(new THREE.Vector3(-gridSize, y, z));
      linePoints.push(new THREE.Vector3(gridSize, y, z));
    }
    
    lineGeometry.setFromPoints(linePoints);
    
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15
    });
    
    return new THREE.LineSegments(lineGeometry, lineMaterial);
  };
  
  // Chalk top boundary
  group.add(createBoundaryLine(chalkTopY, 0xe2e8f0, 'Chalk top'));
  
  // --- Depth labels (floating markers) ---
  const createDepthLabel = (y, text, color) => {
    // Create small marker sphere
    const markerGeometry = new THREE.SphereGeometry(5, 8, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(18000, y, 18000); // Corner of the scene
    marker.userData = { isStrataMarker: true, label: text };
    return marker;
  };
  
  group.add(createDepthLabel(chalkTopY, '60m - Chalk bedrock', 0xe2e8f0));
  group.add(createDepthLabel(chalkBaseY, '150m+', 0xf7fafc));
  
  return group;
}

export function addGeologyToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  const separator = document.createElement('div');
  separator.style.cssText = 'height: 1px; background: var(--border); margin: 8px 0;';
  legend.appendChild(separator);
  
  const header = document.createElement('div');
  header.className = 'legend-item';
  header.innerHTML = `<span class="legend-label" style="color: var(--fg-muted); font-size: 10px; text-transform: uppercase;">Geology</span>`;
  legend.appendChild(header);
  
  // Chalk
  const chalkItem = document.createElement('div');
  chalkItem.className = 'legend-item';
  chalkItem.innerHTML = `
    <div class="legend-line" style="background: #f7fafc; opacity: 0.5;"></div>
    <span class="legend-label">Chalk Bedrock (60m+)</span>
  `;
  legend.appendChild(chalkItem);
}

export function toggleGeologyVisibility(group, visible) {
  if (group) {
    group.visible = visible;
  }
}