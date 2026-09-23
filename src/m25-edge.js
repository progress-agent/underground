// Map edge (sprint 23Sep26w, D-037 Lane B).
//
// Jordan: "the edge of the motorway actually defining the edge of the map,
// rather than the edge being this squiggly border a little way beyond the road."
//
// The world now ends at the OUTER FACE OF THE OUTER CARRIAGEWAY'S BARRIER. The
// ring is derived from the same mapped circuit and the same rendered road width
// (`widthFor` in m25-motorway.js) that draw the road, so the cliff lip and the
// barrier coincide by construction rather than by a tuned buffer.
//
// Two consumers need more than the ring:
//  - the terrain mask: a 2048-texel binary mask over 70km puts ~34m texels
//    under a bilinear filter, which is exactly the wavy border Jordan saw. The
//    mask now stores a clamped SIGNED DISTANCE, so the unchanged `< 0.5`
//    discard lands on the true edge to well under a metre.
//  - the cliff: the clay skirt follows the ring densely enough to track the
//    terrain lip (see geology-exterior.js).
//
// The ring is used for rendering only. Membership (isInsideM25), the bake and
// its verifier keep m25.json's support ring, whose contract is unchanged.

import { MOTORWAY_DATA, motorwayRoadWidth } from './m25-motorway.js';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';

/** Barrier outer face beyond the road half-width (m25-motorway.js: barrier
 * strip centred at half+0.3, 0.13 either side). */
export const MAP_EDGE_BARRIER_OUTSET_M = 0.43;
/** Signed-distance band encoded in the mask: 0 → -band, 255 → +band. */
export const MAP_EDGE_SDF_BAND_M = 64;

const mod = (a, b) => (a % b + b) % b;

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Remove the small loops an outward offset creates at sharp concave joins.
 * Mirrors getMotorwayBoundary's repair: polygon-offset tidying only. */
function removeSmallLoops(ring, maxSpan = 40) {
  const out = ring.slice();
  for (let pass = 0; pass < 64; pass++) {
    let repaired = false;
    const n = out.length;
    outer: for (let i = 1; i < n; i++) {
      for (let j = i + 2; j < Math.min(n, i + maxSpan); j++) {
        const a = out[i - 1], b = out[i], c = out[j - 1], d = out[j];
        const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) {
          out.splice(i, j - i, [a[0] + t * rx, a[1] + t * rz]);
          repaired = true;
          break outer;
        }
      }
    }
    if (!repaired) break;
  }
  return out;
}

let _ring = null;

/**
 * The map edge ring in scene XZ metres, OPEN (first point not repeated),
 * wound consistently. Offset outward from the outer carriageway centreline by
 * each way's rendered half-width plus the barrier.
 */
export function getMapEdgeRing() {
  if (_ring) return _ring;
  const routeId = MOTORWAY_DATA.boundary?.routeId;
  const route = MOTORWAY_DATA.routes.find(r => r.id === routeId);
  if (!route) throw new Error('Map edge needs the outer motorway circuit');
  const byId = new Map(MOTORWAY_DATA.roads.map(w => [w.id, w]));
  // Centreline vertices, each segment tagged with its own offset.
  const pts = [], offs = [];
  for (const id of route.wayIds) {
    const w = byId.get(id), off = motorwayRoadWidth(w) / 2 + MAP_EDGE_BARRIER_OUTSET_M;
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i], b = w.points[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
      pts.push(a); offs.push(off);
    }
  }
  const n = pts.length;
  // Outward = away from the enclosed area. For a ring with positive signed
  // area (x east, z south) the left normal (-dz, dx) points inward.
  const sign = signedArea(pts) > 0 ? -1 : 1;
  const seg = pts.map((a, i) => {
    const b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return { dx: dx / l, dz: dz / l, nx: sign * -dz / l, nz: sign * dx / l, o: offs[i] };
  });
  const ring = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], s1 = seg[mod(i - 1, n)], s2 = seg[i];
    const ax = p[0] + s1.nx * s1.o, az = p[1] + s1.nz * s1.o;
    const bx = p[0] + s2.nx * s2.o, bz = p[1] + s2.nz * s2.o;
    const cross = s1.dx * s2.dz - s1.dz * s2.dx;
    // A width change, a straight continuation or a sharp corner keeps both
    // offset points (a short step or bevel). Only a same-width bend takes
    // the miter: near-parallel lines at different offsets would otherwise
    // meet far away and fold the ring.
    let miter = null;
    if (Math.abs(s1.o - s2.o) < 0.01 && Math.abs(cross) >= 1e-3) {
      const t = ((bx - ax) * s2.dz - (bz - az) * s2.dx) / cross;
      const mx = ax + s1.dx * t, mz = az + s1.dz * t;
      if (Math.hypot(mx - p[0], mz - p[1]) <= 3 * s1.o) miter = [mx, mz];
    }
    if (miter) { ring.push(miter); continue; }
    if (Math.hypot(ax - bx, az - bz) > 0.01) ring.push([ax, az]);
    ring.push([bx, bz]);
  }
  _ring = removeSmallLoops(ring);
  return _ring;
}

/** The edge ring as closed BNG {e,n} points, the shape every existing
 * boundary consumer (mask, waterfalls, crossings, exterior) already takes. */
export function getMapEdgePointsBNG() {
  const ring = getMapEdgeRing();
  const out = ring.map(([x, z]) => ({ e: x + BNG_REF_E, n: BNG_REF_N - z }));
  out.push({ ...out[0] });
  return out;
}

/** Signed distance (positive inside) from scene (x,z) to a closed/open ring. */
export function signedDistanceToRing(x, z, ring) {
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
  const d = Math.sqrt(best);
  return inside ? d : -d;
}

/**
 * Rasterise a ring into a clamped signed-distance mask. Pure (no DOM), so the
 * edge contract is testable in Node.
 *
 * @param {Array<[number,number]>} ring   scene XZ ring (open or closed)
 * @param {number} size                    texels per side
 * @param {(p:{x,z})=>{u,v}} toUV          scene -> mask UV (xzToTerrainUV);
 *                                         must be axis-aligned and linear
 * @param {number} [band]                  metres mapped to the byte range
 * @returns {Uint8ClampedArray} size*size, row r holds v=(r+.5)/size (canvas order)
 */
export function rasterSignedDistanceMask(ring, size, toUV, band = MAP_EDGE_SDF_BAND_M) {
  const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const pts = closed ? ring.slice(0, -1) : ring;
  const n = pts.length;
  const a0 = toUV({ x: 0, z: 0 }), a1 = toUV({ x: 1000, z: 1000 });
  const dudx = (a1.u - a0.u) / 1000, dvdz = (a1.v - a0.v) / 1000;
  if (!(dudx > 0 && dvdz > 0)) throw new Error('Mask UV must increase with scene x and z');
  // Texel centre (c, r) -> scene.
  const stepX = 1 / (size * dudx), stepZ = 1 / (size * dvdz);
  const ox = (0.5 / size - a0.u) / dudx, oz = (0.5 / size - a0.v) / dvdz;
  const out = new Uint8ClampedArray(size * size);
  // 1. Even-odd scanline fill: inside = 255, outside = 0.
  const xs = [];
  for (let r = 0; r < size; r++) {
    const z = oz + stepZ * r;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = pts[i][1], zj = pts[j][1];
      if ((zi > z) !== (zj > z)) xs.push(pts[i][0] + (pts[j][0] - pts[i][0]) * (z - zi) / (zj - zi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - ox) / stepX));
      const c1 = Math.min(size - 1, Math.floor((xs[k + 1] - ox) / stepX));
      for (let c = c0; c <= c1; c++) out[r * size + c] = 255;
    }
  }
  // 2. Exact distance for every texel within the band of an edge segment.
  const dist = new Float32Array(size * size).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - band - ox) / stepX));
    const c1 = Math.min(size - 1, Math.ceil((Math.max(a[0], b[0]) + band - ox) / stepX));
    const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - band - oz) / stepZ));
    const r1 = Math.min(size - 1, Math.ceil((Math.max(a[1], b[1]) + band - oz) / stepZ));
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    for (let r = r0; r <= r1; r++) {
      const z = oz + stepZ * r;
      for (let c = c0; c <= c1; c++) {
        const x = ox + stepX * c;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (a[0] + t * dx), ez = z - (a[1] + t * dz), d = ex * ex + ez * ez;
        const k = r * size + c;
        if (d < dist[k]) dist[k] = d;
      }
    }
  }
  const b2 = band * band;
  for (let k = 0; k < out.length; k++) {
    if (dist[k] >= b2) continue;
    const d = Math.sqrt(dist[k]);
    out[k] = Math.round(127.5 + 127.5 * (out[k] ? d : -d) / band);
  }
  return out;
}

/** Bilinear read of a mask produced above, in [0,1], matching a GPU
 * LinearFilter sample at scene (x,z). The shader discards below 0.5. */
export function sampleMaskBilinear(mask, size, toUV, x, z) {
  const { u, v } = toUV({ x, z });
  const fx = u * size - 0.5, fz = v * size - 0.5;
  const c = Math.max(0, Math.min(size - 2, Math.floor(fx))), r = Math.max(0, Math.min(size - 2, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - c)), tz = Math.min(1, Math.max(0, fz - r));
  const m = (rr, cc) => mask[rr * size + cc] / 255;
  const top = m(r, c) + (m(r, c + 1) - m(r, c)) * tx, bot = m(r + 1, c) + (m(r + 1, c + 1) - m(r + 1, c)) * tx;
  return top + (bot - top) * tz;
}

/**
 * Trim a cross-section ribbon volume (the Thames: `perSample` vertices per
 * cross-section, in river order) to the map edge. Cross-sections beyond the
 * edge collapse onto a cut that follows the edge line exactly, so the water
 * ends at the cliff where its waterfall spills, instead of floating on past
 * the map. Vertex count, index and attributes are untouched (collapsed
 * triangles are degenerate), so every consumer keeps its layout; an endcap
 * built on the last cross-section closes the river at the cliff.
 *
 * @returns {{start:number,end:number}|null} first/last kept cross-section
 */
export function trimRibbonVolumeToRing(geometry, ring, perSample = 4) {
  const pos = geometry?.getAttribute?.('position');
  if (!pos || pos.count < perSample * 2) return null;
  const S = pos.count / perSample, a = pos.array;
  const sdCache = new Map();
  const sd = v => { if (!sdCache.has(v)) sdCache.set(v, signedDistanceToRing(a[v * 3], a[v * 3 + 2], ring)); return sdCache.get(v); };
  const centreInside = i => signedDistanceToRing((a[i * perSample * 3] + a[(i * perSample + 1) * 3]) / 2,
    (a[i * perSample * 3 + 2] + a[(i * perSample + 1) * 3 + 2]) / 2, ring) > 0;
  let first = -1, last = -1;
  for (let i = 0; i < S; i++) if (centreInside(i)) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;
  const P = (sec, k) => sec * perSample + k;
  // Per corner: the last section (walking outward) whose corner is on the
  // map, then a cut between it and the next; every section further out
  // collapses onto the cut. Corners are handled separately so a bank that
  // leaves the map a section before or after the centreline still ends on
  // the edge line.
  const trimEnd = (from, step) => {
    const endIndex = step > 0 ? S - 1 : 0;
    for (let k = 0; k < perSample; k++) {
      const innermost = step > 0 ? first : last;
      let keep = from;
      while (keep !== innermost && sd(P(keep, k)) <= 0) keep -= step;   // corner already off
      while (keep !== endIndex && sd(P(keep + step, k)) > 0) keep += step; // corner still on
      if (keep === endIndex) continue;
      const vi = P(keep, k), vo = P(keep + step, k), si = sd(vi), so = sd(vo);
      const cutAt = [0, 1, 2].map(c => a[vi * 3 + c]);
      if (si > 0 && so < 0) {
        const t = si / (si - so);
        for (let c = 0; c < 3; c++) cutAt[c] = a[vi * 3 + c] + (a[vo * 3 + c] - a[vi * 3 + c]) * t;
      }
      for (let sec = keep + step; step > 0 ? sec < S : sec >= 0; sec += step)
        for (let c = 0; c < 3; c++) a[P(sec, k) * 3 + c] = cutAt[c];
    }
  };
  if (first > 0) trimEnd(first, -1);
  if (last < S - 1) trimEnd(last, 1);
  pos.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { start: Math.max(0, first - 1), end: Math.min(S - 1, last + 1) };
}

let _offMap = null;
/**
 * True for a building footprint centre beyond the map edge. The baked city
 * was clipped to m25.json's support ring (40m beyond the outer carriageway
 * centreline, a contract the bake keeps), which leaves ~110 buildings in the
 * strip between the barrier and that ring; with the ground now ending at the
 * barrier they would stand over the void. O(1) per building: one bilinear
 * read of a signed-distance raster of the ring (its own bounds, ~28m texels,
 * sub-metre at the edge). Accepts {x,z} (baked) or {cx,cz} (live tiles).
 */
export function isOffMapEdge(b) {
  if (!_offMap) {
    const ring = getMapEdgeRing(), pad = 2 * MAP_EDGE_SDF_BAND_M;
    const minX = Math.min(...ring.map(p => p[0])) - pad, maxX = Math.max(...ring.map(p => p[0])) + pad;
    const minZ = Math.min(...ring.map(p => p[1])) - pad, maxZ = Math.max(...ring.map(p => p[1])) + pad;
    const toUV = ({ x, z }) => ({ u: (x - minX) / (maxX - minX), v: (z - minZ) / (maxZ - minZ) });
    const size = 2048, field = rasterSignedDistanceMask(ring, size, toUV);
    _offMap = (x, z) => {
      if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) return true;
      return sampleMaskBilinear(field, size, toUV, x, z) < 0.5;
    };
  }
  return _offMap(b.x ?? b.cx, b.z ?? b.cz);
}
