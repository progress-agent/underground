// chalk-field.js — the chalk floor's displacement field, moved out of geology.js so a worker can evaluate it
// (sprint 21Oct26w, lane L, approach F). The functions are the ones that lived in geology.js, verbatim except that
// the decimated M25 ring is module state set by setChalkRing (the main thread's copy and the worker's each hold
// their own). Pure: no DOM, no three.js.

import { fbmNoise, smoothNoise } from './noise.js';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';

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

/**
 * The decimated closed ring (scene x, z pairs) of an M25 point list in BNG, or null for fewer than 4 points.
 * Decimation keeps the O(vertices x segments) build cost bounded; 800 m flatten tolerance dwarfs the decimation error.
 */
export function chalkRingFromPoints(m25Points) {
  if (!(m25Points && m25Points.length > 3)) return null;
  const STEP = 2;
  const pts = [];
  for (let i = 0; i < m25Points.length; i += STEP) {
    const p = m25Points[i];
    pts.push(p.e - BNG_REF_E, -(p.n - BNG_REF_N));
  }
  // Close the ring
  pts.push(pts[0], pts[1]);
  return new Float32Array(pts);
}

/** Install the ring (a Float32Array from chalkRingFromPoints) used by the rim-flatten. */
export function setChalkRing(ring) { _m25Poly = ring || null; }

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

export function chalkDisplacement(x, z) {
  return chalkDisplacementRaw(x, z) * rimFactor(x, z);
}

/**
 * The displacement at every vertex of the chalk plane, as the Float32Array the mesh build stores
 * (dispArr[i] = chalkDisplacement(x[i] + centreX, z[i] + centreZ)). x and z are the plane's own float32
 * vertex coordinates, so the numbers are the ones the in-line loop computed.
 */
export function chalkDisplacementField(x, z, centerX, centerZ) {
  const count = x.length;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = chalkDisplacement(x[i] + centerX, z[i] + centerZ);
  return out;
}
