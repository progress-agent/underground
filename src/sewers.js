// London Sewer Infrastructure visualization module
// Victorian Bazalgette system (Lee Tunnel now handled by tideway.js)
// Includes: Northern/Southern Outfall Sewers, 8 Victorian interceptor sewers

import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';
import { createTunnelMaterial, createGlowMaterial, injectInfraHaze } from './infra-materials.js';

// Infra haze band (see infra-materials.js) — coherence with Crossrail/Tideway.
const HAZE_BAND = { near: 2500, far: 9000 };

let sewerData = null;

export async function loadSewerData() {
  try {
    const response = await fetch('/data/sewer_depths.csv');
    if (!response.ok) throw new Error('Sewer data not found');
    const csv = await response.text();
    sewerData = parseSewerCSV(csv);
    console.log(`Loaded ${sewerData.points.length} sewer tunnel points across ${Object.keys(sewerData.tunnels).length} tunnels`);
    return sewerData;
  } catch (e) {
    console.warn('Could not load sewer data:', e.message);
    return null;
  }
}

function parseSewerCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const points = [];
  const tunnels = {}; // Group by tunnel_id
  
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 6) {
      const point = {
        id: parts[0],
        name: parts[1],
        depth: parseFloat(parts[2]),
        lat: parseFloat(parts[3]),
        lon: parseFloat(parts[4]),
        tunnelId: parts[5],
        notes: parts[7] || ''
      };
      points.push(point);
      
      if (!tunnels[point.tunnelId]) {
        tunnels[point.tunnelId] = [];
      }
      tunnels[point.tunnelId].push(point);
    }
  }
  
  return { points, tunnels };
}

// Color scheme for different sewer types
const SEWER_COLORS = {
  // Victorian outfall sewers (surface)
  'northern-outfall': { base: 0x5c4033, glow: 0x8b6914, name: 'Northern Outfall Sewer (1868)' },
  'southern-outfall': { base: 0x654321, glow: 0xa0522d, name: 'Southern Outfall Sewer (1865)' },
  // Victorian interceptors - north bank
  'northern-high-level': { base: 0x8b7355, glow: 0xcd853f, name: 'Northern High Level Sewer' },
  'northern-middle-1': { base: 0x8b7355, glow: 0xd2b48c, name: 'Northern Middle Level No.1' },
  'northern-middle-2': { base: 0x8b7355, glow: 0xdeb887, name: 'Northern Middle Level No.2' },
  'northern-low-1': { base: 0xa0522d, glow: 0xf4a460, name: 'Northern Low Level Branch 1' },
  'northern-low-2': { base: 0xa0522d, glow: 0xdaa520, name: 'Northern Low Level Branch 2' },
  // Victorian interceptors - south bank
  'southern-high-level': { base: 0x6b4423, glow: 0xbc8f8f, name: 'Southern High Level Sewer' },
  'southern-middle': { base: 0x6b4423, glow: 0xc0c0c0, name: 'Southern Middle Level Sewer' },
  'southern-low': { base: 0x6b4423, glow: 0xd3d3d3, name: 'Southern Low Level Sewer' }
};

export function createSewerTunnels(data, latLonToXZ, verticalScale = 5.0) {
  if (!data || !data.points.length) return null;
  
  const group = new THREE.Group();
  group.name = 'sewer-tunnels';
  
  // Create a tunnel for each tunnel_id group
  for (const [tunnelId, points] of Object.entries(data.tunnels)) {
    if (points.length < 2) continue; // Need at least 2 points for a line
    
    const colorScheme = SEWER_COLORS[tunnelId] || { base: 0x8b7355, glow: 0xcd853f, name: tunnelId };
    
    // Sort points by their order in the CSV (which is route sequence)
    const orderedPoints = points; // Already in order from parsing
    
    // Create curve through points
    const curvePoints = orderedPoints.map(p => {
      const xz = latLonToXZ(p.lat, p.lon);
      const y = -(p.depth * verticalScale);
      return new THREE.Vector3(xz.x, y, xz.z);
    });
    
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    curve.curveType = 'catmullrom';
    curve.tension = 0.5;
    
    // Victorian sewers are ~4m diameter
    const radius = 2.0;
    
    const tubeGeometry = new THREE.TubeGeometry(curve, 100, radius, 10, false);
    
    // Angle-stable factory material (infra-materials.js). emissiveIntensity
    // 0.25 is the contrast floor against the dark terrain underside, where the
    // old unlit 0.55-alpha brown vanished broadside (judge via AgX screenshots,
    // not hex — diag sewer2-A vs sewer2-C).
    const tunnelMaterial = injectInfraHaze(createTunnelMaterial({
      color: colorScheme.base,
      opacity: 0.6,
      emissiveIntensity: 0.25,
      roughness: 0.5,
      metalness: 0.1,
    }), HAZE_BAND);


    const tunnelMesh = new THREE.Mesh(tubeGeometry, tunnelMaterial);
    tunnelMesh.castShadow = true;
    tunnelMesh.receiveShadow = true;
    tunnelMesh.renderOrder = RENDER_ORDER.SEWER;
    tunnelMesh.userData = {
      type: 'sewer',
      tunnelId,
      name: colorScheme.name,
      // No diameter on userData. The 4m render geometry (radius * 2) is a uniform
      // simplification, not authoritative — real Bazalgette sections vary 1.5-4.5m
      // and are mostly egg-shaped. If per-tunnel verified diameters are sourced
      // (Halliday print appendices / Thames Water heritage), add them to
      // infra-meta.js keyed by tunnelId — registry-merge will pick them up.
    };
    group.add(tunnelMesh);
    
    // Glow effect for visibility
    const glowGeometry = new THREE.TubeGeometry(curve, 80, radius * 1.3, 10, false);
    const glowMaterial = injectInfraHaze(
      createGlowMaterial({ color: colorScheme.glow, opacity: 0.12 }), HAZE_BAND);
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.renderOrder = RENDER_ORDER.SEWER;
    group.add(glowMesh);
    
    // Add depth markers at key points (start, end, and some intermediates)
    orderedPoints.forEach((p, i) => {
      if (i === 0 || i === orderedPoints.length - 1 || i % 3 === 0) {
        const xz = latLonToXZ(p.lat, p.lon);
        const y = -(p.depth * verticalScale);
        
        const markerGeometry = new THREE.SphereGeometry(0.8, 10, 10);
        const markerMaterial = new THREE.MeshBasicMaterial({
          color: colorScheme.glow,
          transparent: true,
          opacity: 0.5,
          // Markers sit ON the tunnel wall — depth-writing 0.5-alpha spheres
          // punch angle-dependent holes in the tube behind them.
          depthWrite: false,
        });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(xz.x, y, xz.z);
        marker.renderOrder = RENDER_ORDER.SEWER;
        group.add(marker);
      }
    });
  }
  
  return group;
}

export function addSewersToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;
  
  // Add separator
  const separator = document.createElement('div');
  separator.style.cssText = 'height: 1px; background: var(--border); margin: 8px 0;';
  legend.appendChild(separator);
  
  // Add section header
  const header = document.createElement('div');
  header.className = 'legend-item';
  header.innerHTML = `<span class="legend-label" style="color: var(--fg-muted); font-size: 10px; text-transform: uppercase;">Sewers</span>`;
  legend.appendChild(header);
  
  // Add legend items for each major sewer type
  const legendItems = [
    { color: '#5c4033', glow: '#8b6914', label: 'Victorian Outfall Sewers (1865)' },
    { color: '#8b7355', glow: '#cd853f', label: 'Northern Victorian Interceptors' },
    { color: '#6b4423', glow: '#bc8f8f', label: 'Southern Victorian Interceptors' }
  ];
  
  for (const item of legendItems) {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-line" style="background: linear-gradient(to right, ${item.color}, ${item.glow});"></div>
      <span class="legend-label">${item.label}</span>
    `;
    legend.appendChild(legendItem);
  }
}
