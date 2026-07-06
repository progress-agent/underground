// Exterior tapered column (Geology Vision D1).
//
// Viewed from OUTSIDE the M25, London reads as a slim disc of clay on a slender
// pale shaft of chalk receding down into abstraction. This module builds that
// silhouette:
//
//   1. Clay disc skirt   — a vertical wall on the M25 boundary polyline, from
//      the local terrain surface down to the chalk top (CHALK_TOP_Y). London-
//      clay brown, matte, faint horizontal strata banding. FrontSide (outward)
//      so it is invisible from inside the disc. Notched where the two Thames
//      waterfall ribbons spill over the edge.
//
//   2. Chalk column     — a gently tapering ring wall from CHALK_TOP_Y down to
//      ~-15000, following the smoothed M25 footprint at the top and narrowing
//      to ~60% radius at the fade-out depth. Chalk white, subtle vertical
//      striation, fog:true, vertex-alpha ramp opaque→0 with depth. FrontSide.
//      "Receding into abstraction" = taper + alpha fade + fog.
//
// NOT a pool cue — no tip geometry, no ferrule banding. An indicator of shape
// and tip-depth only (Jordan's 06Jul26m correction).
//
// Both are FrontSide with outward-facing winding, so from within the M25 the
// backfaces are culled and the interior experience (D2/D3 chalk floor + dusty
// white-out) is untouched.

import * as THREE from 'three';
import { fbmNoise } from './noise.js';
import { RENDER_ORDER } from './render-layers.js';

const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

function bngToScene(e, n) {
  return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) };
}

// Inject a per-vertex alpha attribute → varying → gl_FragColor.a multiply.
// Same pattern the Thames waterfalls use (m25.js), so the fade composites
// identically. Kept local so the column material owns its own shader patch.
function injectVertexAlpha(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `attribute float alpha;
varying float vAlpha;
void main() {`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
  vAlpha = alpha;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `varying float vAlpha;
void main() {`
    );
    // r161 chunk is <opaque_fragment> (was <output_fragment> in older three) —
    // the multiply goes AFTER it so gl_FragColor is assigned first.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
  gl_FragColor.a *= vAlpha;`
    );
  };
}

// Decide whether a ring-wall built with a fixed winding faces outward. We emit
// every quad in the same local order, so a consistently-ordered ring produces
// consistently-facing normals — one global test + flip suffices. Returns true
// if the FIRST segment's front-face normal points AWAY from the centroid.
function firstSegmentFacesOutward(ringXZ, centroid) {
  const a = ringXZ[0], b = ringXZ[1 % ringXZ.length];
  const dx = b.x - a.x, dz = b.z - a.z;
  // Front-face normal of a vertical wall emitted (TL,BL,TR) with +Y up:
  // for the corner order we use, the outward test reduces to the sign of the
  // 2D cross product of the segment tangent with the centroid→midpoint vector.
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const ox = mx - centroid.x, oz = mz - centroid.z;
  // Wall normal candidate (-dz, dx); outward if it aligns with (ox, oz).
  return (-dz * ox + dx * oz) > 0;
}

/**
 * Build the clay disc skirt: a vertical wall following the M25 boundary from
 * the local terrain surface down to CHALK_TOP_Y, notched at the Thames
 * crossings so the waterfalls spill over the edge cleanly.
 *
 * @param {Array<{e,n}>} m25Points        M25 BNG ring
 * @param {function}     getSurfaceY      (x,z) → world Y
 * @param {number}       chalkTopY        bottom of the skirt (scene units)
 * @param {Array<object>} crossings       Thames boundary crossings (scene coords)
 * @returns {THREE.Mesh}
 */
function buildClaySkirt(m25Points, getSurfaceY, chalkTopY, crossings) {
  // Ring vertices in scene coords + their local surface Y (skirt top).
  const ring = [];
  for (const p of m25Points) {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    ring.push({ x, z, topY: y !== null ? y + 2 : 60 });
  }
  const N = ring.length;
  if (N < 3) return null;

  // Centroid for outward-winding decision.
  let cx = 0, cz = 0;
  for (const r of ring) { cx += r.x; cz += r.z; }
  cx /= N; cz /= N;

  // Notch: skip any segment whose midpoint is within (ribbon half-width +
  // margin) of a Thames crossing, so the wall opens where water spills over.
  const NOTCH_MARGIN = 90;
  function inNotch(mx, mz) {
    for (const c of crossings) {
      const half = c.width / 2 + NOTCH_MARGIN;
      const dx = mx - c.x, dz = mz - c.z;
      if (dx * dx + dz * dz < half * half) return true;
    }
    return false;
  }

  const ROWS = 8;               // vertical subdivisions → carry strata banding
  const BAND_LAMBDA = 34;       // horizontal-band wavelength (in scene Y units)
  const positions = [];
  const colors = [];
  const indices = [];

  // London clay — warm brown, matte, a touch darker than terrain topsoil.
  const clayBase = new THREE.Color(0x6a5540);
  const tc = new THREE.Color();

  // Emit a vertical strip of vertices per ring point (ROWS+1 levels), then
  // quads per segment (skipping notch segments).
  const rowVert = (ri, row) => ri * (ROWS + 1) + row;
  for (let ri = 0; ri < N; ri++) {
    const r = ring[ri];
    for (let row = 0; row <= ROWS; row++) {
      const t = row / ROWS;                    // 0 = top (surface), 1 = chalk top
      const y = THREE.MathUtils.lerp(r.topY, chalkTopY, t);
      positions.push(r.x, y, r.z);
      // Horizontal strata: band factor varies mostly with Y (→ horizontal
      // bands) with a gentle lateral wander from the XZ term. Subtle: ±10%.
      const band = fbmNoise(y / BAND_LAMBDA, (r.x + r.z) / 900, 2);
      const shade = 0.86 + band * 0.22;        // 0.86 .. 1.08
      tc.copy(clayBase).multiplyScalar(shade);
      colors.push(tc.r, tc.g, tc.b);
    }
  }

  for (let ri = 0; ri < N; ri++) {
    const a = ring[ri];
    const b = ring[(ri + 1) % N];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (inNotch(mx, mz)) continue;             // leave the passage for the water
    const ni = (ri + 1) % N;
    for (let row = 0; row < ROWS; row++) {
      const TL = rowVert(ri, row),     BL = rowVert(ri, row + 1);
      const TR = rowVert(ni, row),     BR = rowVert(ni, row + 1);
      // Winding chosen so front faces outward (flipped globally below if not).
      indices.push(TL, BL, TR,  TR, BL, BR);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);

  // Global winding flip if the fixed emit order faced inward.
  if (!firstSegmentFacesOutward(ring, { x: cx, z: cz })) {
    const idx = geom.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
    geom.index.needsUpdate = true;
  }
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.FrontSide,      // outward only — invisible from inside the disc
    fog: true,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'clayDiscSkirt';
  mesh.renderOrder = RENDER_ORDER.EXTERIOR_SKIRT;
  return mesh;
}

// Arc-length resample a scene-coord ring to `count` evenly-spaced points, then
// smooth with a couple of moving-average passes so the raw ~270-vertex M25
// jaggedness becomes a clean column footprint.
function smoothRing(ringXZ, count = 128, smoothPasses = 2) {
  // Cumulative arc length.
  const n = ringXZ.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = ringXZ[i], b = ringXZ[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(total);
    total += d;
  }
  seg.push(total);

  const out = [];
  let si = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (si < n - 1 && seg[si + 1] < target) si++;
    const a = ringXZ[si], b = ringXZ[(si + 1) % n];
    const segLen = seg[si + 1] - seg[si] || 1;
    const f = (target - seg[si]) / segLen;
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }

  for (let pass = 0; pass < smoothPasses; pass++) {
    const src = out.map(p => ({ ...p }));
    for (let k = 0; k < count; k++) {
      const p0 = src[(k - 1 + count) % count];
      const p1 = src[k];
      const p2 = src[(k + 1) % count];
      out[k].x = (p0.x + 2 * p1.x + p2.x) / 4;
      out[k].z = (p0.z + 2 * p1.z + p2.z) / 4;
    }
  }
  return out;
}

/**
 * Build the fading chalk column below the disc.
 *
 * @param {Array<{e,n}>} m25Points   M25 BNG ring
 * @param {number}       chalkTopY   top of the column (scene units, -300)
 * @param {object}       [opts]
 * @returns {THREE.Mesh}
 */
function buildChalkColumn(m25Points, chalkTopY, opts = {}) {
  const {
    bottomY = -15000,       // geometry extent (fades out well above this)
    levels = 56,            // vertical divisions
    bottomTaper = 0.58,     // radius at the bottom (fraction of the top ring)
    ringCount = 128,        // smoothed footprint resolution
    fadeTop = -1200,        // opaque above this depth (just below the disc)
    fadeBottom = -6000,     // fully dissolved by this depth
  } = opts;

  const rawRing = m25Points.map(p => bngToScene(p.e, p.n));
  const ring = smoothRing(rawRing, ringCount);
  const M = ring.length;
  if (M < 3) return null;

  let cx = 0, cz = 0;
  for (const r of ring) { cx += r.x; cz += r.z; }
  cx /= M; cz /= M;

  const positions = [];
  const colors = [];
  const alphas = [];
  const indices = [];

  // Chalk white; vertical striation = a subtle around-the-ring colour wander
  // (constant with depth → reads as vertical stripes down the column).
  const chalkBase = new THREE.Color(0xf2ead8);
  const tc = new THREE.Color();

  const vAt = (ri, lj) => ri * (levels + 1) + lj;

  for (let ri = 0; ri < M; ri++) {
    const r = ring[ri];
    // Around-ring striation factor (independent of depth).
    const stri = fbmNoise(ri / 5.5, 17.0, 2);   // 0..1
    const striShade = 0.90 + stri * 0.14;        // 0.90 .. 1.04
    for (let lj = 0; lj <= levels; lj++) {
      const t = lj / levels;                     // 0 top, 1 bottom
      const y = THREE.MathUtils.lerp(chalkTopY, bottomY, t);
      const taper = THREE.MathUtils.lerp(1.0, bottomTaper, t); // gentle, linear
      const x = cx + (r.x - cx) * taper;
      const z = cz + (r.z - cz) * taper;
      positions.push(x, y, z);
      tc.copy(chalkBase).multiplyScalar(striShade);
      colors.push(tc.r, tc.g, tc.b);
      // Depth-based alpha ramp (absolute Y, not level fraction): opaque just
      // below the disc, dissolving to 0 by fadeBottom. This is what makes the
      // shaft read as "receding into abstraction" (a downward gradient across
      // the frame) rather than a solid full-height wall. Fog does the rest.
      const a = THREE.MathUtils.smoothstep(y, fadeBottom, fadeTop);
      alphas.push(a);
    }
  }

  for (let ri = 0; ri < M; ri++) {
    const ni = (ri + 1) % M;
    for (let lj = 0; lj < levels; lj++) {
      const TL = vAt(ri, lj),     BL = vAt(ri, lj + 1);
      const TR = vAt(ni, lj),     BR = vAt(ni, lj + 1);
      indices.push(TL, BL, TR,  TR, BL, BR);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));
  geom.setIndex(indices);

  if (!firstSegmentFacesOutward(ring, { x: cx, z: cz })) {
    const idx = geom.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
    geom.index.needsUpdate = true;
  }
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,          // transparent — no self-occlusion writes
    // A mild self-lit chalk cast keeps the shaft PALE against the dark abyss
    // even under the weak below-horizon light. Fog:true still fades it toward
    // the fog colour with distance — that IS the "receding into abstraction".
    emissive: new THREE.Color(0xf2ead8),
    emissiveIntensity: 0.06,
    fog: true,
  });
  injectVertexAlpha(mat);

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'chalkColumn';
  mesh.renderOrder = RENDER_ORDER.EXTERIOR_COLUMN;
  return mesh;
}

/**
 * Build the full exterior geology group: clay disc skirt + fading chalk column.
 *
 * @param {Array<{e,n}>}  m25Points     M25 BNG ring
 * @param {number}        chalkTopY     chalk top / clay bottom (CHALK_TOP_Y)
 * @param {function}      getSurfaceY   (x,z) → world Y
 * @param {Array<object>} crossings     Thames boundary crossings (computeThamesCrossings)
 * @returns {THREE.Group}
 */
export function createGeologyExterior(m25Points, chalkTopY, getSurfaceY, crossings = []) {
  const group = new THREE.Group();
  group.name = 'geology-exterior';
  if (!m25Points?.length) return group;

  const skirt = buildClaySkirt(m25Points, getSurfaceY, chalkTopY, crossings);
  if (skirt) group.add(skirt);

  const column = buildChalkColumn(m25Points, chalkTopY);
  if (column) group.add(column);

  console.log(
    `Geology exterior: skirt ${skirt ? 'on' : 'off'} (${crossings.length} notches), ` +
    `chalk column ${column ? 'on' : 'off'} → -15000`
  );
  return group;
}
