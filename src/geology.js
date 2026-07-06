// Geological strata visualization for London
// The chalk floor — the unsmooth white lower bound of London's subterranean
// half. A solid, terraced, M25-clipped disc at the clay/chalk boundary
// (~60m below sea level, mOD datum). Its analytic surface (getChalkSurfaceY)
// is the shared truth for the atmosphere blend and the HUD substrate readout.

import * as THREE from 'three';
import { fbmNoise, smoothNoise } from './noise.js';
import {
  generateChalkGrainTexture,
  generateChalkRoughnessTexture,
  generateUndersideNormalMap,
} from './textures.js';
import { RENDER_ORDER } from './render-layers.js';
import { VERTICAL_EXAGGERATION } from './terrain.js';

// ── Datum ───────────────────────────────────────────────────────────────
// Chalk top is ABSOLUTE mOD: nominal clay/chalk boundary at 60m below sea
// level, exaggerated by VE. -60 * 5 = -300 scene units. Exported so later
// steps (atmosphere blend, HUD) key off the same constant.
export const CHALK_TOP_Y = -60 * VERTICAL_EXAGGERATION;

// ── Terrain scene extent ────────────────────────────────────────────────
// Mirrors terrain.js BNG bounds + m25.js TERRAIN_BNG. The chalk plane shares
// the terrain's UV→world mapping exactly (same PlaneGeometry construction,
// same centre), so the M25 mask — indexed in terrain-UV space — lines up 1:1
// when applyM25Mask() is called on the chalk material.
const BNG_REF_E = 530000, BNG_REF_N = 180400;
const TB = { minE: 490000, maxE: 560000, minN: 155000, maxN: 205000 };
const SW_X = TB.minE - BNG_REF_E;     // -40000 (west)
const NE_X = TB.maxE - BNG_REF_E;     //  30000 (east)
const SW_Z = -(TB.minN - BNG_REF_N);  //  25400 (south, +Z)
const NE_Z = -(TB.maxN - BNG_REF_N);  // -24600 (north, -Z)
const TERRAIN_W = NE_X - SW_X;        // 70000
const TERRAIN_H = SW_Z - NE_Z;        // 50000
const CENTER_X = (SW_X + NE_X) / 2;   // -5000
const CENTER_Z = (SW_Z + NE_Z) / 2;   //   400

// ── Relief bands (shared by the mesh build and the analytic re-eval) ─────
// Two-band noise + terraced ledges + micro-grain. Amplitudes chosen so the
// combined peak-to-peak clears the 120-unit (24m real) floor with room to
// spare — troughs and ledges must read on approach.
const BASIN_LAMBDA = 2400, BASIN_AMP = 82;   // broad basins
const LEDGE_LAMBDA = 620,  LEDGE_AMP = 56;   // mid-scale ledges
const LEDGE_STEP = 30, LEDGE_SOFT = 0.08;     // terrace quantum + edge-softening
const MICRO_LAMBDA = 55,  MICRO_AMP = 7;      // micro-grain
const RIM_FLATTEN_DIST = 800;                 // scene units inside M25 rim → displacement fades to 0

// Decimated M25 ring in scene coords, [x0,z0,x1,z1,...] closed. Stored at
// build time; used by rim-flatten (build) and getChalkSurfaceY (per frame).
let _m25Poly = null;

function smoothstep(edge0, edge1, x) {
  let t = (x - edge0) / (edge1 - edge0);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// Min distance from world (x,z) to the stored M25 ring, in scene units.
// Allocation-free. Returns Infinity when no ring is loaded (→ no flatten).
function distToM25(x, z) {
  const p = _m25Poly;
  if (!p) return Infinity;
  let best = Infinity;
  for (let i = 0; i < p.length - 2; i += 2) {
    const ax = p[i], az = p[i + 1];
    const dx = p[i + 2] - ax, dz = p[i + 3] - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = x - (ax + t * dx), ez = z - (az + t * dz);
    const d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// Rim-flatten factor: 0 at the M25 boundary, ramping to 1 by RIM_FLATTEN_DIST
// inside — so the floor meets the (later) chalk shaft flat and clean.
function rimFactor(x, z) {
  if (!_m25Poly) return 1;
  return smoothstep(0, RIM_FLATTEN_DIST, distToM25(x, z));
}

// Raw two-band displacement (no rim flatten) as a pure function of world XZ.
function chalkDisplacementRaw(x, z) {
  const basin = (fbmNoise(x / BASIN_LAMBDA, z / BASIN_LAMBDA, 2) - 0.5) * 2 * BASIN_AMP;
  const ln = (fbmNoise(x / LEDGE_LAMBDA + 100, z / LEDGE_LAMBDA + 100, 2) - 0.5) * 2 * LEDGE_AMP;
  const q = Math.round(ln / LEDGE_STEP) * LEDGE_STEP;     // quantise to terraces
  const ledge = q + (ln - q) * LEDGE_SOFT;                // soften the terrace edges slightly
  const micro = (smoothNoise(x / MICRO_LAMBDA, z / MICRO_LAMBDA) - 0.5) * 2 * MICRO_AMP;
  return basin + ledge + micro;
}

function chalkDisplacement(x, z) {
  return chalkDisplacementRaw(x, z) * rimFactor(x, z);
}

/**
 * Analytic chalk surface Y at world (x, z). Re-evaluates the SAME noise the
 * mesh is built from, so it matches the rendered floor within a vertex-spacing
 * tolerance. Allocation-free and cheap — safe to call per frame (atmosphere
 * blend, HUD substrate). Positional args (unlike getTerrainMeshSurfaceY).
 */
export function getChalkSurfaceY(x, z) {
  return CHALK_TOP_Y + chalkDisplacement(x, z);
}

// --- Main strata creation ---

/**
 * Build the chalk floor group.
 * @param {Array<{e:number,n:number}>|null} m25Points  M25 BNG ring — enables
 *        rim-flatten during the build. Pass null for an unbounded floor.
 * @param {number} verticalScale  (kept for call-site compat; datum uses the
 *        module VE constant so the analytic surface stays consistent)
 */
export function createGeologicalStrata(m25Points = null, verticalScale = VERTICAL_EXAGGERATION) {
  const group = new THREE.Group();
  group.name = 'geological-strata';

  const chalkTopY = CHALK_TOP_Y;

  // Store a decimated M25 ring (scene coords, closed) for rim-flatten + the
  // per-frame analytic. Decimation keeps the O(vertices × segments) build cost
  // bounded; 800m flatten tolerance dwarfs the decimation error.
  if (m25Points && m25Points.length > 3) {
    const STEP = 2;
    const pts = [];
    for (let i = 0; i < m25Points.length; i += STEP) {
      const p = m25Points[i];
      pts.push(p.e - BNG_REF_E, -(p.n - BNG_REF_N));
    }
    // Close the ring
    pts.push(pts[0], pts[1]);
    _m25Poly = new Float32Array(pts);
  }

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ── Chalk floor mesh: 512×512 over the terrain extent ──────────────────
  const segments = 512;
  const geom = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_H, segments, segments);
  geom.rotateX(-Math.PI / 2);

  // CPU vertex displacement — evaluated in WORLD XZ (local + centre) so the
  // baked mesh matches getChalkSurfaceY(worldX, worldZ) exactly.
  const pos = geom.attributes.position;
  const count = pos.count;
  const dispArr = new Float32Array(count);
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const wx = pos.getX(i) + CENTER_X;
    const wz = pos.getZ(i) + CENTER_Z;
    const d = chalkDisplacement(wx, wz);
    dispArr[i] = d;
    pos.setY(i, d);
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  // ── Vertex-colour height ramp ──────────────────────────────────────────
  // Warm chalk white 0xf2ead8. Mapped over a FIXED absolute range (± COLOR_HALF
  // scene units around the datum), NOT the plane's global min/max — a global
  // ramp washes out because any near patch spans only a fraction of the 70km
  // relief, leaving the floor a flat sheet. A fixed range gives strong LOCAL
  // contrast everywhere, and the terrace quantisation reads as discrete
  // colour bands (the "ledges"). Troughs go markedly darker, crests near-white.
  const COLOR_HALF = 80;
  const chalkLow = new THREE.Color(0xf2ead8).multiplyScalar(0.62);
  const chalkHigh = new THREE.Color(0xfefdf8);
  // Slope-darkening: the floor is self-lit (emissive) with no directional
  // light, so height alone barely reads at grazing angle. Baking a normal-based
  // darkening — as terrain.js does — makes the near-vertical terrace RISERS
  // draw as dark edges, so ledges and trough walls read as relief regardless
  // of view angle. This is what carries the "unsmooth white floor, troughs and
  // ledges clearly visible" brief.
  const SLOPE_DARKEN = 0.85;
  const normals = geom.attributes.normal;
  const colArr = new Float32Array(count * 3);
  const tc = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let t = dispArr[i] / (2 * COLOR_HALF) + 0.5;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    tc.copy(chalkLow).lerp(chalkHigh, t);
    const ny = Math.abs(normals.getY(i));           // 1 on flat, →0 on a riser
    const shade = 1 - (1 - ny) * SLOPE_DARKEN;
    tc.multiplyScalar(shade);
    colArr[i * 3] = tc.r;
    colArr[i * 3 + 1] = tc.g;
    colArr[i * 3 + 2] = tc.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

  // ── Textures: chalk grain map + grain-derived normal map ───────────────
  const chalkGrainTex = generateChalkGrainTexture();
  const chalkRoughTex = generateChalkRoughnessTexture();
  const chalkNormalTex = generateUndersideNormalMap(chalkGrainTex); // reuse underside machinery
  // Retile to a floor-walking scale over the 70×50km plane (~500m per tile).
  for (const tex of [chalkGrainTex, chalkRoughTex, chalkNormalTex]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(140, 100);
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: chalkGrainTex,
    roughnessMap: chalkRoughTex,
    normalMap: chalkNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true,
    opacity: 0.92,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    // Solid floor — write depth so relief self-occludes correctly. The chalk
    // sits below opaque terrain, so this cannot re-open the tube glow-through
    // bug (that is the transmission material's problem, not this one).
    depthWrite: true,
    // Load-bearing mitigation: transparent materials sample dark fog through
    // alpha underground, and fog would gray-out the floor at depth. Self-lit +
    // fog:false keeps chalk bright.
    emissive: new THREE.Color(0xf2ead8),
    emissiveIntensity: 0.20,
    fog: false,
  });

  const chalkMesh = new THREE.Mesh(geom, mat);
  chalkMesh.position.set(CENTER_X, chalkTopY, CENTER_Z);
  // Tier 1 (GEOLOGY): infra tunnels (tier 2) draw AFTER so deep infra below
  // the chalk (e.g. Lee Tunnel at 98m) is never hidden by a distance-sort tie.
  chalkMesh.renderOrder = RENDER_ORDER.GEOLOGY;
  chalkMesh.name = 'chalkFloor';
  chalkMesh.userData = {
    type: 'chalk',
    name: 'Chalk Boundary',
    depth: '~60m below sea level (mOD)',
    description: 'Clay-to-chalk transition — the lower bound of subterranean London',
  };
  group.add(chalkMesh);

  // Depth label marker (kept — pickable strata legend anchor; hover tests
  // expect a 'chalk-marker'). Sits on the floor near central London.
  const markerGeometry = new THREE.SphereGeometry(5, 8, 8);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0xe2e8f0, transparent: true, opacity: 0.3,
  });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.position.set(0, getChalkSurfaceY(0, 0), 0);
  marker.renderOrder = RENDER_ORDER.GEOLOGY;
  marker.userData = { type: 'chalk-marker', isStrataMarker: true, label: '60m below sea level — Chalk bedrock boundary' };
  group.add(marker);

  // Expose the material so main.js can apply the M25 mask the same way it does
  // for terrain (applyM25Mask), keeping the clip in one place.
  group.userData.chalkMat = mat;

  const buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  console.log(
    `Chalk floor: ${segments}×${segments} @ Y=${chalkTopY}, relief p2p=${(dMax - dMin).toFixed(0)} units ` +
    `(${((dMax - dMin) / VERTICAL_EXAGGERATION).toFixed(0)}m), rim-flatten=${_m25Poly ? 'on' : 'off'}, build=${buildMs.toFixed(0)}ms`
  );
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
    <div class="legend-line" style="background: #f2ead8; opacity: 0.8;"></div>
    <span class="legend-label">Chalk Floor (~60m mOD)</span>
  `;
  legend.appendChild(chalkItem);
}
