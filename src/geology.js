// Geological strata visualization for London
// The chalk floor — the unsmooth white lower bound of London's subterranean
// half. A solid, terraced, M25-clipped disc at the clay/chalk boundary
// (~60m below sea level, mOD datum). Its analytic surface (getChalkSurfaceY)
// is the shared truth for the atmosphere blend and the HUD substrate readout.

import * as THREE from 'three';
import { chalkDisplacement, chalkRingFromPoints, setChalkRing } from './chalk-field.js'; // s21:L
import {
  generateChalkGrainTexture,
  generateChalkRoughnessTexture,
  generateUndersideNormalMap,
  chalkGrainTextureFrom,
  chalkRoughnessTextureFrom,
  undersideNormalTextureFrom,
} from './textures.js';
import { RENDER_ORDER } from './render-layers.js';
import { VERTICAL_EXAGGERATION, getTerrainBounds } from './terrain.js';

// ── Datum ───────────────────────────────────────────────────────────────
// Chalk top is ABSOLUTE mOD: nominal clay/chalk boundary at 60m below sea
// level, exaggerated by VE. -60 * 5 = -300 scene units. Exported so later
// steps (atmosphere blend, HUD) key off the same constant.
export const CHALK_TOP_Y = -60 * VERTICAL_EXAGGERATION;

// ── Terrain scene extent ────────────────────────────────────────────────
// Reads the loaded terrain bounds, including source extensions. The chalk plane shares
// the terrain's UV→world mapping exactly (same PlaneGeometry construction,
// same centre), so the M25 mask — indexed in terrain-UV space — lines up 1:1
// when applyM25Mask() is called on the chalk material.

// ── Relief bands ────────────────────────────────────────────────────────
// s21:L: the displacement field (relief bands, the M25 rim-flatten and the decimated ring) moved verbatim to
// chalk-field.js so a worker can evaluate it; this module keeps the mesh, the material and the analytic surface.

/**
 * Analytic chalk surface Y at world (x, z). Re-evaluates the SAME noise the
 * mesh is built from, so it matches the rendered floor within a vertex-spacing
 * tolerance. Allocation-free and cheap — safe to call per frame (atmosphere
 * blend, HUD substrate). Positional args (unlike getTerrainMeshSurfaceY).
 */
export function getChalkSurfaceY(x, z) {
  return CHALK_TOP_Y + chalkDisplacement(x, z);
}

// ── Inside-chalk clarity (Item B) ──────────────────────────────────────────
// From INSIDE the chalk (camera below the chalk surface) the 0.92-opacity
// sheet is a near-opaque ceiling AND — because it draws at renderOrder GEOLOGY
// with depthWrite:true, before INFRA_TUNNEL — it depth-culls every transparent
// tunnel behind it. "Perfect clarity of all subterranean features looking up"
// therefore needs the sheet itself released, not just the fog. Gated on
// chalkClarity, which is 0 for any camera at/above the chalk surface, so the
// from-above white-out look (opacity 0.92, depthWrite:true) is byte-identical.
const CHALK_BASE_OPACITY = 0.92;
const CHALK_CLARITY_OPACITY = 0.12; // faint membrane — boundary still reads
let _chalkClarityMat = null;

export function updateGeologyClarity(chalkClarity = 0) {
  if (!_chalkClarityMat) return;
  const t = Math.max(0, Math.min(1, chalkClarity));
  const opacity = CHALK_BASE_OPACITY + (CHALK_CLARITY_OPACITY - CHALK_BASE_OPACITY) * t;
  if (opacity !== _chalkClarityMat.opacity) {
    _chalkClarityMat.opacity = opacity;
    // Depth write must release with the fade or the sheet still depth-culls
    // the tube network behind it (no shader recompile — cheap per-frame flip).
    _chalkClarityMat.depthWrite = t < 0.5;
  }
}

// --- Main strata creation ---

/**
 * s21:L (approach F). The chalk floor's plane, built as createGeologicalStrata builds it, so a worker can be handed
 * its vertex coordinates before the rest of the opening needs the mesh. `bounds` is getTerrainBounds()'s shape
 * (minX, maxX, widthM, heightM are read). Returns the geometry (flat, Y unset), the float32 X and Z of every
 * vertex and the plane's world centre.
 */
export function createChalkPlane(bounds) {
  const TERRAIN_W = bounds.widthM, TERRAIN_H = bounds.heightM;
  const CENTER_X = (bounds.minX + bounds.maxX) / 2, CENTER_Z = (bounds.minZ + bounds.maxZ) / 2;
  const geom = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_H, CHALK_SEGMENTS, CHALK_SEGMENTS);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  const x = new Float32Array(pos.count), z = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { x[i] = pos.getX(i); z[i] = pos.getZ(i); }
  return { geom, x, z, centerX: CENTER_X, centerZ: CENTER_Z };
}
const CHALK_SEGMENTS = 512;

/**
 * Build the chalk floor group.
 * @param {Array<{e:number,n:number}>|null} m25Points  M25 BNG ring — enables
 *        rim-flatten during the build. Pass null for an unbounded floor.
 * @param {number} verticalScale  (kept for call-site compat; datum uses the
 *        module VE constant so the analytic surface stays consistent)
 */
export function createGeologicalStrata(m25Points = null, verticalScale = VERTICAL_EXAGGERATION, { textures = null, plane = null } = {}) { // s21:L: textures = { grain, roughness, normal } pixels from a worker; plane = { geom, disp } from createChalkPlane and a worker
  const group = new THREE.Group();
  group.name = 'geological-strata';

  const chalkTopY = CHALK_TOP_Y;

  // Store a decimated M25 ring (scene coords, closed) for rim-flatten + the
  // per-frame analytic. Decimation keeps the O(vertices × segments) build cost
  // bounded; 800m flatten tolerance dwarfs the decimation error.
  const ring = chalkRingFromPoints(m25Points); // s21:L
  if (ring) setChalkRing(ring);

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ── Chalk floor mesh: 512×512 over the terrain extent ──────────────────
  const bounds=getTerrainBounds();
  if(!bounds)throw new Error('Geology requires loaded terrain bounds');
  const TERRAIN_W=bounds.widthM,TERRAIN_H=bounds.heightM;
  const CENTER_X=(bounds.minX+bounds.maxX)/2,CENTER_Z=(bounds.minZ+bounds.maxZ)/2;
  const segments = CHALK_SEGMENTS;
  // ── s21:L ── a prebuilt plane and the worker's displacement (the same numbers, computed elsewhere) replace the
  // in-line loop; without them, or if the sizes disagree, the loop below runs exactly as it always did.
  const usePlane = !!(plane && plane.geom && plane.disp && plane.disp.length === plane.geom.attributes.position.count);
  const geom = usePlane ? plane.geom : new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_H, segments, segments);
  if (!usePlane) geom.rotateX(-Math.PI / 2);
  // ── /s21:L ──

  // CPU vertex displacement — evaluated in WORLD XZ (local + centre) so the
  // baked mesh matches getChalkSurfaceY(worldX, worldZ) exactly.
  const pos = geom.attributes.position;
  const count = pos.count;
  const dispArr = usePlane ? plane.disp : new Float32Array(count); // s21:L
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < count; i++) {
    let d;
    if (usePlane) {
      d = dispArr[i];
    } else {
      const wx = pos.getX(i) + CENTER_X;
      const wz = pos.getZ(i) + CENTER_Z;
      d = chalkDisplacement(wx, wz);
      dispArr[i] = d;
    }
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
  // ── s21:L ── pixels from a worker when given (identical bytes, the same canvas path)
  const chalkGrainTex = textures ? chalkGrainTextureFrom(textures.grain) : generateChalkGrainTexture();
  const chalkRoughTex = textures ? chalkRoughnessTextureFrom(textures.roughness) : generateChalkRoughnessTexture();
  const chalkNormalTex = textures ? undersideNormalTextureFrom(textures.normal) : generateUndersideNormalMap(chalkGrainTex); // reuse underside machinery
  // ── /s21:L ──
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
  _chalkClarityMat = mat; // registered for the inside-chalk clarity release

  const buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  console.log(
    `Chalk floor: ${segments}×${segments} @ Y=${chalkTopY}, relief p2p=${(dMax - dMin).toFixed(0)} units ` +
    `(${((dMax - dMin) / VERTICAL_EXAGGERATION).toFixed(0)}m), rim-flatten=${ring ? 'on' : 'off'}, build=${buildMs.toFixed(0)}ms`
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
