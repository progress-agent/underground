// Geological strata visualization for London
// Shows the clay-to-chalk boundary surface (~60m depth) where deep infrastructure anchors

import * as THREE from 'three';

// --- Procedural noise for geological undulation ---

function hash2d(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2d(ix, iz);
  const b = hash2d(ix + 1, iz);
  const c = hash2d(ix, iz + 1);
  const d = hash2d(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbmNoise(x, z, octaves = 3) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxAmp;
}

// --- Main strata creation ---

export function createGeologicalStrata(bounds, verticalScale = 3.0) {
  const group = new THREE.Group();
  group.name = 'geological-strata';

  const CHALK_TOP = -60; // metres below ground — clay/chalk boundary
  const chalkTopY = CHALK_TOP * verticalScale;

  const planeSize = 40000; // 40km covers Greater London
  const segments = 128;

  // --- Chalk boundary surface (clay-to-chalk transition) ---
  const geom = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments);
  geom.rotateX(-Math.PI / 2);

  // Procedural displacement — geological undulation
  const chalkPos = geom.attributes.position;
  const noiseFreq = 1 / 6000;
  const displacementAmp = 40; // ±20 scene units (±2m real with 10x vscale)

  for (let i = 0; i < chalkPos.count; i++) {
    const x = chalkPos.getX(i);
    const z = chalkPos.getZ(i);
    const n = fbmNoise(x * noiseFreq, z * noiseFreq, 3);
    chalkPos.setY(i, chalkPos.getY(i) + (n - 0.5) * displacementAmp);
  }
  chalkPos.needsUpdate = true;
  geom.computeVertexNormals();

  // Vertex colours — warm chalk tones varying with displacement
  let cMinY = Infinity, cMaxY = -Infinity;
  for (let i = 0; i < chalkPos.count; i++) {
    const y = chalkPos.getY(i);
    if (y < cMinY) cMinY = y;
    if (y > cMaxY) cMaxY = y;
  }
  const cRange = cMaxY - cMinY || 1;
  const chalkLow = new THREE.Color(0x8a7e6e);   // Weathered chalk — warm grey-brown
  const chalkHigh = new THREE.Color(0xd4cbb8);  // Fresh chalk — light cream
  const colArr = new Float32Array(chalkPos.count * 3);
  const tc = new THREE.Color();
  for (let i = 0; i < chalkPos.count; i++) {
    const t = (chalkPos.getY(i) - cMinY) / cRange;
    tc.copy(chalkLow).lerp(chalkHigh, t);
    colArr[i * 3] = tc.r;
    colArr[i * 3 + 1] = tc.g;
    colArr[i * 3 + 2] = tc.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const chalkMesh = new THREE.Mesh(geom, mat);
  chalkMesh.position.y = chalkTopY;
  chalkMesh.userData = {
    name: 'Chalk Boundary',
    depth: '~60m',
    description: 'Clay-to-chalk transition — deep infrastructure anchors here',
  };
  group.add(chalkMesh);

  // Wireframe overlay for structural definition
  const wireGeom = geom.clone();
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xb0a898,
    wireframe: true,
    transparent: true,
    opacity: 0.06,
  });
  const wireMesh = new THREE.Mesh(wireGeom, wireMat);
  wireMesh.position.y = chalkTopY + 0.5; // Slight offset to reduce z-fighting
  group.add(wireMesh);

  // Depth label marker
  const markerGeometry = new THREE.SphereGeometry(5, 8, 8);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0xe2e8f0,
    transparent: true,
    opacity: 0.3,
  });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.position.set(18000, chalkTopY, 18000);
  marker.userData = { isStrataMarker: true, label: '60m — Chalk bedrock boundary' };
  group.add(marker);

  console.log('Chalk boundary surface created: Y =', chalkTopY, ', segments =', segments, ', displacement ±', displacementAmp / 2);
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

  const chalkItem = document.createElement('div');
  chalkItem.className = 'legend-item';
  chalkItem.innerHTML = `
    <div class="legend-line" style="background: #d4cbb8; opacity: 0.6;"></div>
    <span class="legend-label">Chalk Boundary (~60m)</span>
  `;
  legend.appendChild(chalkItem);
}

export function toggleGeologyVisibility(group, visible) {
  if (group) {
    group.visible = visible;
  }
}
