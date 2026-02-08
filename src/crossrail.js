// Crossrail (Elizabeth Line) visualization module
// Crossrail is a 118km railway with 42km of new tunnels beneath London
// Deepest point: Liverpool Street at ~41m below ground
// Diameter: 6.2m (larger than tube tunnels at 3.6m)
// Route splits at Whitechapel: south-east to Abbey Wood, north-east to Shenfield

import * as THREE from 'three';

let crossrailData = null;

export async function loadCrossrailData() {
  try {
    const response = await fetch('/data/crossrail_depths.csv');
    if (!response.ok) throw new Error('Crossrail data not found');
    const csv = await response.text();
    crossrailData = parseCrossrailCSV(csv);
    console.log(`Loaded ${crossrailData.points.length} Crossrail points (${Object.keys(crossrailData.branches).length} branches)`);
    return crossrailData;
  } catch (e) {
    console.warn('Could not load Crossrail data:', e.message);
    return null;
  }
}

function parseCrossrailCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const points = [];
  const branches = {};

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 6) {
      const point = {
        id: parts[0],
        name: parts[1],
        depth: parseFloat(parts[2]),
        lat: parseFloat(parts[3]),
        lon: parseFloat(parts[4]),
        branch: parts[5].trim(),
        notes: parts[7] || ''
      };
      points.push(point);
      if (!branches[point.branch]) branches[point.branch] = [];
      branches[point.branch].push(point);
    }
  }

  return { points, branches };
}

export function createCrossrailTunnel(data, latLonToXZ, verticalScale = 3.0) {
  if (!data || !data.points.length) return null;

  const group = new THREE.Group();
  group.name = 'crossrail-tunnel';

  const tunnelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffd300,
    transparent: true,
    opacity: 0.75,
    roughness: 0.3,
    metalness: 0.4,
    side: THREE.DoubleSide
  });

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.2
  });

  // Convert a point to 3D position
  const toVec3 = (p) => {
    const xz = latLonToXZ(p.lat, p.lon);
    return new THREE.Vector3(xz.x, -(p.depth * verticalScale), xz.z);
  };

  // Build a tube for an array of points
  const buildTube = (pts, radius, segments, opacity) => {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts.map(toVec3));
    const geo = new THREE.TubeGeometry(curve, segments, radius, 12, false);
    const mat = tunnelMaterial.clone();
    mat.opacity = opacity;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Glow for deep sections
    if (opacity >= 0.7) {
      const glowGeo = new THREE.TubeGeometry(curve, Math.floor(segments * 0.7), radius + 1, 12, false);
      group.add(new THREE.Mesh(glowGeo, glowMaterial.clone()));
    }
  };

  const mainPts = data.branches['main'] || [];
  const abbeyWoodPts = data.branches['abbey-wood'] || [];
  const shenfieldPts = data.branches['shenfield'] || [];

  // Main trunk: Heathrow to Whitechapel (full diameter tunnel)
  if (mainPts.length >= 2) {
    buildTube(mainPts, 9.0, 150, 0.75);
  }

  // Get Whitechapel (last main trunk point) as branch junction
  const junction = mainPts.length > 0 ? mainPts[mainPts.length - 1] : null;

  // Abbey Wood branch: prepend junction point for visual continuity
  if (abbeyWoodPts.length >= 1 && junction) {
    buildTube([junction, ...abbeyWoodPts], 9.0, 60, 0.75);
  }

  // Shenfield branch: surface railway, slightly thinner & more transparent
  if (shenfieldPts.length >= 1 && junction) {
    buildTube([junction, ...shenfieldPts], 7.0, 100, 0.5);
  }

  // Station markers at deep points (depth >= 25m)
  const deepStations = data.points.filter(p => p.depth >= 25);
  for (const p of deepStations) {
    const pos = toVec3(p);
    const markerGeo = new THREE.SphereGeometry(2, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffd300,
      transparent: true,
      opacity: 0.7
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(pos);
    marker.userData = { name: p.name, depth: p.depth, type: 'crossrail' };
    group.add(marker);
  }

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
