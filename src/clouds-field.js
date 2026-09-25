// clouds-field.js: the pure cloud model (sprint 25Sep26f, Lane C, D-039).
//
// Everything here is a pure, deterministic function of (preset, time): no
// THREE, no DOM, no clock, no unseeded randomness. clouds.js draws what this
// module decides and the node tests pin it (tests/clouds.test.mjs).
//
// ONE CLOUD MAP, ONE WIND (cloud scope). A seeded layout places the clouds on
// a wrap-around square field a little larger than the map. The same layout is
// rasterised once into a coverage grid (the "cover"), so the sprites a viewer
// sees and the shadows on the city come from the same clouds by construction.
// Every cloud drifts as one body on the shared wind (wind.js) at the preset's
// wind altitude, so the whole field moves by ONE offset, drift(t). The cover
// grid therefore never changes: the shadow lookup simply subtracts drift(t).
// drift(t) is the time integral of the wind, evaluated by fixed-step Simpson
// quadrature on 10-second knots that are memoised as they are first reached:
// the value depends on t alone, never on the frame history.
//
// FADE AT THE M25. A world-fixed fade (1 well inside the map, 0 near and
// beyond the edge) multiplies the sprites and the shadows, so clouds thin out
// towards the M25 and none hang over the cliff at the map's edge. It is a
// smoothstep of the signed distance to the map edge ring (m25-edge.js).
//
// UNITS. x, z are scene metres. Altitudes are REAL metres (the system converts
// to canonical VE5 and to display space for Master).

import { getWindAt } from './wind.js';
import { resolveCloudPreset, oktasToFraction } from './clouds-presets.js';
import { getMapEdgeRing } from './m25-edge.js';

// The field: a 72 km square around the map (the map edge ring spans about
// x -28.5..28.9 km, z -23..28 km). Its wrap seam sits at least 7 km outside the
// edge, beyond the fade, so a cloud crossing the seam is never seen.
export const CLOUD_FIELD = Object.freeze({
  originX: -36000,
  originZ: -33500,
  size: 72000,
  coverSize: 512,  // 140 m texels: soft shadows, one byte each
  edgeSize: 96,    // 750 m texels, bilinear (the fade spans 6.4 km)
});

const TAU = Math.PI * 2;

// ── Seeded randomness ──────────────────────────────────────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
const wrap = (v, n) => ((v % n) + n) % n;

// ── Layout ─────────────────────────────────────────────────────────────────

/**
 * One cumulus: a flat base, a cauliflower dome. Puff centres are in real
 * metres relative to the cloud's base centre; dy is height above the base.
 */
function makeCloud(rand, P, cx, cz) {
  const width = lerp(P.widthM[0], P.widthM[1], Math.pow(rand(), P.widthSkew));
  const height = width * lerp(P.aspect[0], P.aspect[1], rand());
  const depth = width * lerp(P.elongation[0], P.elongation[1], rand());
  const heading = rand() * TAU;
  const base = lerp(P.baseM[0], P.baseM[1], rand());
  const n = Math.round(lerp(P.puffs[0], P.puffs[1], (width - P.widthM[0]) / (P.widthM[1] - P.widthM[0])));
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const puffs = [];
  const nBase = Math.max(3, Math.round(n * 0.45));
  for (let k = 0; k < n; k++) {
    const isBase = k < nBase;
    // Base puffs are wide and low; the dome's are rounder and smaller towards the top.
    const r = width * (isBase ? lerp(0.2, 0.3, rand()) : lerp(0.15, 0.26, rand()));
    let h, spread;
    if (isBase) {
      h = r * 0.55;
      spread = 1;
    } else {
      const f = Math.pow(rand(), 0.8);
      h = r * 0.55 + f * Math.max(0, height - r * 1.5);
      spread = Math.sqrt(Math.max(0, 1 - f * f)) * 0.8 + 0.1;
    }
    const a = rand() * TAU, q = Math.sqrt(rand()) * spread;
    const lx = Math.cos(a) * q * Math.max(0, width / 2 - r * 0.8);
    const lz = Math.sin(a) * q * Math.max(0, depth / 2 - r * 0.8);
    puffs.push({
      dx: lx * ch - lz * sh, dz: lx * sh + lz * ch, dy: h, r,
      variant: Math.floor(rand() * 4), rot: rand() * TAU, rank: 0,
    });
  }
  // Rank 0 is the largest puff: thinning and quality drop the smallest first.
  const order = puffs.map((p, i) => i).sort((i, j) => puffs[j].r - puffs[i].r);
  order.forEach((i, k) => { puffs[i].rank = n > 1 ? k / (n - 1) : 0; });
  // Draw order inside a cloud: bottom to top (reversed when viewed from below).
  puffs.sort((p, q) => p.dy - q.dy);
  return { cx, cz, base, width, height, depth, puffs };
}

/** Footprint of one puff seen from straight above: soft disc. */
function puffFootprint(d, rf) {
  return smoothstep(1, 0.5, d / rf);
}

/** Splat a cloud's puff footprints (max-combined); returns texels newly over 0.5. */
function splatCloud(cover, N, texel, F, cloud) {
  let crossed = 0;
  for (const p of cloud.puffs) {
    const rf = p.r * 0.9, rt = rf / texel, rt2 = rt * rt;
    const gx = (cloud.cx + p.dx - F.originX) / texel - 0.5;
    const gz = (cloud.cz + p.dz - F.originZ) / texel - 0.5;
    const j0 = Math.ceil(gz - rt), j1 = Math.floor(gz + rt);
    const i0 = Math.ceil(gx - rt), i1 = Math.floor(gx + rt);
    for (let j = j0; j <= j1; j++) {
      const row = (((j % N) + N) % N) * N, dz = j - gz;
      for (let i = i0; i <= i1; i++) {
        const dx = i - gx, d2 = dx * dx + dz * dz;
        if (d2 >= rt2) continue;
        const v = puffFootprint(Math.sqrt(d2), rt);
        const idx = row + (((i % N) + N) % N);
        const old = cover[idx];
        if (v > old) {
          if (old < 0.5 && v >= 0.5) crossed++;
          cover[idx] = v;
        }
      }
    }
  }
  return crossed;
}

function blur3(src, N) {
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const w = (a === 0 ? 2 : 1) * (b === 0 ? 2 : 1);
        s += w * src[wrap(j + b, N) * N + wrap(i + a, N)];
      }
      out[j * N + i] = s / 16;
    }
  }
  return out;
}

const _layouts = new Map();

/**
 * The seeded layout for a preset: clouds placed at random until the target
 * coverage (oktas) is reached, and the coverage grid they produce. Memoised
 * per preset id; pure (same preset, same layout).
 */
export function buildCloudLayout(presetOrId) {
  const P = typeof presetOrId === 'string' || !presetOrId ? resolveCloudPreset(presetOrId) : presetOrId;
  const key = `${P.id}:${P.seed}:${P.oktas}`;
  if (_layouts.has(key)) return _layouts.get(key);
  const F = CLOUD_FIELD, N = F.coverSize, texel = F.size / N;
  const rand = mulberry32(P.seed);
  const raw = new Float32Array(N * N);
  const target = oktasToFraction(P.oktas) * N * N;
  let covered = 0;
  const clouds = [];
  for (let guard = 0; covered < target && guard < 20000; guard++) {
    const cloud = makeCloud(rand, P, F.originX + rand() * F.size, F.originZ + rand() * F.size);
    clouds.push(cloud);
    covered += splatCloud(raw, N, texel, F, cloud);
  }
  const cover = blur3(raw, N);
  let puffCount = 0, maxTop = 0, sumBase = 0, sumHalf = 0;
  for (const c of clouds) {
    puffCount += c.puffs.length;
    maxTop = Math.max(maxTop, c.base + c.height);
    sumBase += c.base;
    sumHalf += c.height / 2;
  }
  const nC = Math.max(1, clouds.length);
  const layout = {
    preset: P, clouds, cover, coverSize: N, puffCount,
    // The shadow lookup projects onto one plane at the mean mid-cloud height:
    // mean base (follows Master) plus mean half-height (true size). See
    // shadowPlaneY.
    meanBaseM: sumBase / nC,
    meanHalfHeightM: sumHalf / nC,
    maxTopM: maxTop,
    edge: buildEdgeFade(P),
  };
  _layouts.set(key, layout);
  return layout;
}

// ── Coverage (oktas) ───────────────────────────────────────────────────────

/**
 * Fraction of the field's footprint under cloud (cover >= threshold), over
 * the whole field or only where the edge fade is at least `minEdge`.
 */
export function coverageFraction(layout, { threshold = 0.5, minEdge = 0 } = {}) {
  const N = layout.coverSize, F = CLOUD_FIELD, texel = F.size / N;
  let n = 0, c = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (minEdge > 0) {
        const x = F.originX + (i + 0.5) * texel, z = F.originZ + (j + 0.5) * texel;
        if (sampleEdgeFade(layout, x, z) < minEdge) continue;
      }
      n++;
      if (layout.cover[j * N + i] >= threshold) c++;
    }
  }
  return n ? c / n : 0;
}

export const fractionToOktas = f => f * 8;

// ── Drift on the shared wind ───────────────────────────────────────────────

const KNOT_S = 10;
const _drift = new Map(); // windAltitude -> { x: number[], z: number[] }

function windVelocity(alt, t) {
  const w = getWindAt(alt, t);
  return [-Math.sin(w.dirRad) * w.speedMps, Math.cos(w.dirRad) * w.speedMps];
}

function simpson(alt, a, b) {
  const va = windVelocity(alt, a), vm = windVelocity(alt, (a + b) / 2), vb = windVelocity(alt, b);
  const h = (b - a) / 6;
  return [h * (va[0] + 4 * vm[0] + vb[0]), h * (va[1] + 4 * vm[1] + vb[1])];
}

/**
 * Horizontal offset (scene metres) the whole cloud field has drifted by time
 * t (seconds on the shared world clock): the integral of the wind at the
 * preset's wind altitude. Pure in t; negative t clamps to 0.
 */
export function cloudDrift(t, presetOrId = null, out = { x: 0, z: 0 }) {
  const P = typeof presetOrId === 'string' || !presetOrId ? resolveCloudPreset(presetOrId) : presetOrId;
  const alt = P.windAltitudeM;
  const time = Number.isFinite(t) ? Math.max(0, t) : 0;
  let memo = _drift.get(alt);
  if (!memo) { memo = { x: [0], z: [0] }; _drift.set(alt, memo); }
  const k = Math.floor(time / KNOT_S);
  while (memo.x.length <= k) {
    const i = memo.x.length - 1;
    const [dx, dz] = simpson(alt, i * KNOT_S, (i + 1) * KNOT_S);
    memo.x.push(memo.x[i] + dx);
    memo.z.push(memo.z[i] + dz);
  }
  const rem = time - k * KNOT_S;
  let x = memo.x[k], z = memo.z[k];
  if (rem > 0) { const [dx, dz] = simpson(alt, k * KNOT_S, time); x += dx; z += dz; }
  out.x = x; out.z = z;
  return out;
}

/** A cloud's base-centre position at drift d, wrapped as one body. */
export function cloudPosition(cloud, drift, out = { x: 0, z: 0 }) {
  const F = CLOUD_FIELD;
  out.x = F.originX + wrap(cloud.cx + drift.x - F.originX, F.size);
  out.z = F.originZ + wrap(cloud.cz + drift.z - F.originZ, F.size);
  return out;
}

/** Every cloud's (x, z) at time t, as a flat Float32Array [x0, z0, x1, z1...]. */
export function cloudPositionsAt(layout, t) {
  const d = cloudDrift(t, layout.preset);
  const out = new Float32Array(layout.clouds.length * 2);
  const p = { x: 0, z: 0 };
  layout.clouds.forEach((c, i) => { cloudPosition(c, d, p); out[2 * i] = p.x; out[2 * i + 1] = p.z; });
  return out;
}

// ── Edge fade (world-fixed) ────────────────────────────────────────────────

function signedDistance(x, z, ring) {
  let best = Infinity, inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, l2 = dx * dx + dz * dz || 1;
    let t = ((x - xi) * dx + (z - zi) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (xi + t * dx), ez = z - (zi + t * dz), d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
}

/** The map edge ring thinned to about one point per `step` metres. */
export function coarseEdgeRing(step = 600) {
  const ring = getMapEdgeRing();
  const out = [ring[0]];
  let last = ring[0];
  for (const p of ring) {
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= step) { out.push(p); last = p; }
  }
  return out;
}

function buildEdgeFade(P) {
  const F = CLOUD_FIELD, N = F.edgeSize, texel = F.size / N;
  const ring = coarseEdgeRing();
  const fade = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = F.originX + (i + 0.5) * texel, z = F.originZ + (j + 0.5) * texel;
      fade[j * N + i] = smoothstep(P.edgeFadeM[0], P.edgeFadeM[1], signedDistance(x, z, ring));
    }
  }
  return { fade, size: N, texel };
}

function bilinear(grid, N, gx, gz, wrapAround) {
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const tx = gx - x0, tz = gz - z0;
  let xa, xb, za, zb;
  if (wrapAround) {
    xa = ((x0 % N) + N) % N; xb = (xa + 1) % N;
    za = ((z0 % N) + N) % N; zb = (za + 1) % N;
  } else {
    const M = N - 1;
    xa = x0 < 0 ? 0 : x0 > M ? M : x0; xb = x0 + 1 < 0 ? 0 : x0 + 1 > M ? M : x0 + 1;
    za = z0 < 0 ? 0 : z0 > M ? M : z0; zb = z0 + 1 < 0 ? 0 : z0 + 1 > M ? M : z0 + 1;
  }
  const a = grid[za * N + xa], b = grid[za * N + xb], c = grid[zb * N + xa], d = grid[zb * N + xb];
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return top + (bot - top) * tz;
}

/** Edge fade at a world point: 1 well inside the map, 0 at and beyond its edge. */
export function sampleEdgeFade(layout, x, z) {
  const e = layout.edge, F = CLOUD_FIELD;
  return bilinear(e.fade, e.size, (x - F.originX) / e.texel - 0.5, (z - F.originZ) / e.texel - 0.5, false);
}

/** Cloud cover directly above a world point at drift d (0..1, no edge fade). */
export function sampleCover(layout, x, z, drift) {
  const F = CLOUD_FIELD, N = layout.coverSize, texel = F.size / N;
  return bilinear(layout.cover, N, (x - drift.x - F.originX) / texel - 0.5, (z - drift.z - F.originZ) / texel - 0.5, true);
}

// ── Shadows (CPU mirror of the shader in clouds-shadow.js) ─────────────────

/**
 * Canonical height of the shadow plane: the mean cloud base follows Master
 * (canonical base x VE), the mean half-height is true size (display metres,
 * so canonical half / ratio). ratio = Master / VE.
 */
export function shadowPlaneY(layout, ratio, VE = 5) {
  return layout.meanBaseM * VE + layout.meanHalfHeightM / ratio;
}

/**
 * Fraction of direct sunlight reaching a canonical scene point (x, y, z):
 * 1 in full sun, 1 - strength under a full cloud. The lookup follows the sun
 * back up to the cloud plane (planeY, canonical), so a shadow lands where the
 * displayed cloud, lit by the displayed sun, throws it (the Master ratio
 * cancels in the run: see clouds-shadow.js).
 * sunDir: unit vector towards the sun (canonical). strength: 0..1.
 */
export function cloudSunFactor(layout, x, y, z, { drift, sunDir, strength, planeY }) {
  if (!(strength > 0)) return 1;
  if (y >= planeY) return 1;
  const k = (planeY - y) / Math.max(sunDir.y, 0.05);
  const px = x + sunDir.x * k, pz = z + sunDir.z * k;
  const cover = sampleCover(layout, px, pz, drift);
  return 1 - strength * cover * sampleEdgeFade(layout, px, pz);
}

/** Shadow strength for a preset, air weight and solar elevation (degrees). */
export function shadowStrengthFor(preset, { airWeight = 0, elevationDeg = 90, enabled = true } = {}) {
  if (!enabled || !(airWeight > 0)) return 0;
  const [a, b] = preset.shadowSunFadeDeg;
  return preset.shadowStrength * Math.min(1, airWeight) * smoothstep(a, b, elevationDeg);
}

// ── Balloon lift under cumulus ─────────────────────────────────────────────

/**
 * Thermal updraft (real m/s) at a real altitude above ground, below the
 * clouds: strongest under full cover, easing in over the first 250 m and
 * dying away at the lowest cloud base. Zero elsewhere.
 */
export function updraftAt(layout, x, z, altM, drift) {
  const P = layout.preset;
  if (!(P.updraftMps > 0) || !Number.isFinite(altM)) return 0;
  const base = P.baseM[0];
  const band = smoothstep(20, 250, altM) * (1 - smoothstep(base - 150, base, altM));
  if (band <= 0) return 0;
  return P.updraftMps * band * sampleCover(layout, x, z, drift) * sampleEdgeFade(layout, x, z);
}
