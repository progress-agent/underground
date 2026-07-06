// London Canals visualization module
// Flat terrain-following ribbons (same approach as Thames volume)

import * as THREE from 'three';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { RENDER_ORDER, WATER_LIFT } from './render-layers.js';
import { createWaterMaterial } from './water-material.js';

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
  const VE = VERTICAL_EXAGGERATION;

  // Shared living-water family, tuned nearly still for canals.
  const canalMaterial = createWaterMaterial('canal');

  const SURFACE_LIFT = WATER_LIFT; // scene units above terrain (shared with Thames — render-layers.js)
  const HALF_WIDTH = 5;      // scene units — canals ~10m wide visually
  const SAMPLES_PER_POINT = 4; // interpolation density along the curve

  // Filter to significant canals only (>0.5km to avoid clutter)
  const significantCanals = data.features.filter(f => f.length_km > 0.5);

  for (const feature of significantCanals) {
    if (!feature.coords || feature.coords.length < 2) continue;

    // Convert lat/lon to scene coordinates with terrain height
    const rawPoints = feature.coords.map(([lat, lon]) => {
      const xz = latLonToXZ(lat, lon);
      const y = getTerrainSurfaceY({ x: xz.x, z: xz.z });
      return { x: xz.x, z: xz.z, y: y !== null ? y : 0 };
    });

    if (rawPoints.length < 2) continue;

    // Build CatmullRom spline through the centreline (XZ only for direction)
    const splineControlPoints = rawPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
    const spline = new THREE.CatmullRomCurve3(splineControlPoints);
    spline.curveType = 'catmullrom';
    spline.tension = 0.3;

    // Assign each raw point a u value based on cumulative distance (for height interpolation)
    let cumDist = 0;
    const cumDists = [0];
    for (let i = 1; i < rawPoints.length; i++) {
      const dx = rawPoints[i].x - rawPoints[i - 1].x;
      const dz = rawPoints[i].z - rawPoints[i - 1].z;
      cumDist += Math.sqrt(dx * dx + dz * dz);
      cumDists.push(cumDist);
    }
    const heightProfiles = rawPoints.map((p, i) => ({
      u: cumDist > 0 ? cumDists[i] / cumDist : 0,
      y: p.y,
    }));

    // Interpolate terrain height at any u along the canal
    function lerpHeight(u) {
      if (u <= heightProfiles[0].u) return heightProfiles[0].y;
      if (u >= heightProfiles[heightProfiles.length - 1].u) return heightProfiles[heightProfiles.length - 1].y;
      let lo = 0, hi = heightProfiles.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (heightProfiles[mid].u <= u) lo = mid;
        else hi = mid;
      }
      const t = (u - heightProfiles[lo].u) / (heightProfiles[hi].u - heightProfiles[lo].u || 1);
      return heightProfiles[lo].y + t * (heightProfiles[hi].y - heightProfiles[lo].y);
    }

    // Sample cross-sections along the spline — flat ribbon (2 verts per section)
    const sampleCount = Math.min(rawPoints.length * SAMPLES_PER_POINT, 200);
    const vertCount = (sampleCount + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const waterDepths = new Float32Array(vertCount);
    const waterEdges = new Float32Array(vertCount);

    for (let i = 0; i <= sampleCount; i++) {
      const u = i / sampleCount;
      const pos = spline.getPointAt(u);
      const tangent = spline.getTangentAt(u);

      // Perpendicular normal in XZ plane
      const nx = -tangent.z;
      const nz = tangent.x;
      const nLen = Math.sqrt(nx * nx + nz * nz) || 1;
      const normX = nx / nLen;
      const normZ = nz / nLen;

      // Terrain-following Y + small lift to prevent z-fighting
      const terrainY = lerpHeight(u);
      const topY = terrainY + SURFACE_LIFT;

      const base = i * 2 * 3;
      // Left edge
      positions[base]     = pos.x + normX * HALF_WIDTH;
      positions[base + 1] = topY;
      positions[base + 2] = pos.z + normZ * HALF_WIDTH;
      // Right edge
      positions[base + 3] = pos.x - normX * HALF_WIDTH;
      positions[base + 4] = topY;
      positions[base + 5] = pos.z - normZ * HALF_WIDTH;

      const vBase = i * 2;
      waterDepths[vBase] = 1.5;
      waterDepths[vBase + 1] = 1.5;
      waterEdges[vBase] = -1.0;
      waterEdges[vBase + 1] = 1.0;
    }

    // Build index buffer — triangle strip as indexed triangles
    const triCount = sampleCount * 2;
    const indices = new Uint32Array(triCount * 3);
    let idx = 0;
    for (let i = 0; i < sampleCount; i++) {
      const b = i * 2;      // base section
      const n = (i + 1) * 2; // next section
      // Left triangle
      indices[idx++] = b;     indices[idx++] = n;     indices[idx++] = b + 1;
      // Right triangle
      indices[idx++] = b + 1; indices[idx++] = n;     indices[idx++] = n + 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepths, 1));
    geometry.setAttribute('waterEdge', new THREE.BufferAttribute(waterEdges, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, canalMaterial);
    mesh.renderOrder = RENDER_ORDER.SURFACE_WATER; // render after terrain to prevent z-fighting
    mesh.userData = {
      type: 'canal',
      name: feature.name,
      length: feature.length_km
    };
    group.add(mesh);
  }

  console.log(`Created ${group.children.length} canal meshes from ${significantCanals.length} significant canals (${data.features.length} total)`);
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
