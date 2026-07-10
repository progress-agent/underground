// Crossrail (Elizabeth Line) visualization module
// Crossrail is a 118km railway with 42km of new tunnels beneath London
// Deepest point: Liverpool Street at ~41m below ground
// Diameter: 6.2m (larger than tube tunnels at 3.6m)
// Route splits at Whitechapel: south-east to Abbey Wood, north-east to Shenfield

import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';

let crossrailData = null;

// Fade a material's alpha to zero over a view-distance band [near, far], so
// distant edge-on crossrail tubes stop compositing into a yellow band along the
// clay-zone horizon (D4.3). A broadside close-up (task's 1-2km read) sits inside
// the near cutoff and is untouched; only the far, edge-on-converging part of the
// line fades. Injected in view space, so it's orientation-independent. Lowers
// alpha only — no emissive raised, so the glow-through-terrain mitigation stack
// is respected. onBeforeCompile survives Material.clone(), so per-tube clones
// keep the effect.
// Every distance-fade clone registers its shader uniforms here at
// onBeforeCompile time so updateCrossrailClarity can scale the fade thresholds
// live (Item B). onBeforeCompile stays per-clone — Material.clone() does not
// copy it — so each compiled clone contributes its own uniform set.
const _fadeUniformSets = [];
let _lastFadeScale = 1.0;

// Inside-chalk clarity (Item B): the D4.3 distance fade zeroes tunnel alpha by
// ~3200m regardless of fog, which would violate "perfect clarity at any
// distance" for a camera inside the chalk looking up. Scale both thresholds by
// 1 + 19*chalkClarity (fade lands at ~61km/22km — beyond the scene extent).
// From the clay side chalkClarity = 0, so the yellow-band kill is byte-identical.
export function updateCrossrailClarity(chalkClarity = 0) {
  const scale = 1 + 19 * Math.max(0, Math.min(1, chalkClarity));
  if (scale === _lastFadeScale) return;
  _lastFadeScale = scale;
  for (const uniforms of _fadeUniformSets) {
    if (uniforms.uFadeScale) uniforms.uFadeScale.value = scale;
  }
}

function makeDistanceFade(material, near, far) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeNear = { value: near };
    shader.uniforms.uFadeFar = { value: far };
    shader.uniforms.uFadeScale = { value: _lastFadeScale };
    _fadeUniformSets.push(shader.uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `varying float vFadeViewDepth;
void main() {`
    ).replace(
      '#include <begin_vertex>',
      // Euclidean camera distance, NOT view-space -z. An E-W tube at constant
      // north-distance has near-constant -z across the whole width, so a -z fade
      // dims it uniformly (the full-width band survives). Euclidean distance
      // makes the far left/right of the band recede and fade, collapsing it.
      `#include <begin_vertex>
  vFadeViewDepth = length( ( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz );`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform float uFadeNear;
uniform float uFadeFar;
uniform float uFadeScale;
varying float vFadeViewDepth;
void main() {`
    ).replace(
      // r161 chunk name — NOT <output_fragment>, which silently no-ops here.
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
  gl_FragColor.a *= 1.0 - smoothstep( uFadeNear * uFadeScale, uFadeFar * uFadeScale, vFadeViewDepth );`
    );
  };
  material.needsUpdate = true;
}

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
    opacity: 0.2,
    // Fog-aware so the underground fog dims the glow with distance. (Explicit
    // even though MeshBasicMaterial defaults fog:true.)
    fog: true,
  });

  // Convert a point to 3D position
  const toVec3 = (p) => {
    const xz = latLonToXZ(p.lat, p.lon);
    return new THREE.Vector3(xz.x, -(p.depth * verticalScale), xz.z);
  };

  // Build a tube for an array of points
  const buildTube = (pts, radius, segments, opacity, branchName) => {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts.map(toVec3));
    const geo = new THREE.TubeGeometry(curve, segments, radius, 12, false);
    const mat = tunnelMaterial.clone();
    mat.opacity = opacity;
    // The bright gold horizon band in clay-zone views is the tunnel tube seen
    // edge-on at range (fog.far is wide underground, so fog can't dim it). Fade
    // it out by euclidean camera distance so the far band collapses while a
    // segment viewed broadside from ~1-2km still reads full. Applied to the
    // CLONE — Material.clone() does NOT copy onBeforeCompile, so setting it on
    // the base tunnelMaterial would never reach the rendered tubes.
    makeDistanceFade(mat, 1100, 3200);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    mesh.userData = {
      type: 'crossrail',
      name: branchName || 'Crossrail / Elizabeth Line',
      depth: Math.round(pts.reduce((sum, p) => sum + (p.depth || 0), 0) / pts.length),
    };
    group.add(mesh);

    // Glow for deep sections
    if (opacity >= 0.7) {
      const glowGeo = new THREE.TubeGeometry(curve, Math.floor(segments * 0.7), radius + 1, 12, false);
      const glowMat = glowMaterial.clone();
      makeDistanceFade(glowMat, 900, 2600); // fade on the clone (see note above)
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
      group.add(glowMesh);
    }
  };

  const mainPts = data.branches['main'] || [];
  const abbeyWoodPts = data.branches['abbey-wood'] || [];
  const shenfieldPts = data.branches['shenfield'] || [];

  // Main trunk: Heathrow to Whitechapel (full diameter tunnel)
  if (mainPts.length >= 2) {
    buildTube(mainPts, 9.0, 150, 0.75, 'Crossrail — Main Tunnel');
  }

  // Get Whitechapel (last main trunk point) as branch junction
  const junction = mainPts.length > 0 ? mainPts[mainPts.length - 1] : null;

  // Abbey Wood branch: prepend junction point for visual continuity
  if (abbeyWoodPts.length >= 1 && junction) {
    buildTube([junction, ...abbeyWoodPts], 9.0, 60, 0.75, 'Crossrail — Abbey Wood Branch');
  }

  // Shenfield branch: surface railway, slightly thinner & more transparent
  if (shenfieldPts.length >= 1 && junction) {
    buildTube([junction, ...shenfieldPts], 7.0, 100, 0.5, 'Crossrail — Shenfield Branch');
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
    marker.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
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
