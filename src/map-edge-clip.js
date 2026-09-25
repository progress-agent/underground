// Water and contours beyond the map edge (sprint 25Sep26f, D-039 Lane E).
//
// Jordan: reservoirs, lakes and canals spill past the M25 cliff (Wraysbury
// Reservoir, Sawyers Lake, about 25 canal features including the Basingstoke
// Canal, Broadmead Cut, the River Wey and part of the Slough Arm), floating
// over the void where the ground has already ended.
//
// The map edge is the ring from m25-edge.js (outer face of the outer
// carriageway's barrier). This module clips the SOURCE features to that ring at
// load, before any mesh is built, so reservoirs.js and canals.js stay unchanged:
//  - polygons (reservoirs, lakes) are intersected with the ring exactly
//    (Weiler-Atherton for two simple polygons of matching winding): a body
//    wholly outside is dropped, one that straddles keeps only its on-map part,
//    whose cut follows the ring vertex for vertex;
//  - polylines (canals) are split where they cross the ring and only on-map
//    runs are kept. A canal is drawn as a ribbon 10 m wide whose ends are
//    square to the line, so a cut end is pulled back `endInsetM` along the line
//    to keep the ribbon's corners off the cliff.
//
// Output coordinates are scene [x, z]; pass SCENE_XZ as the projector to the
// existing builders.

/** Identity projector for features already in scene [x, z]. */
export const SCENE_XZ = (x, z) => ({ x, z });

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function openRing(ring) {
  const closed = ring.length > 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  return closed ? ring.slice(0, -1) : ring;
}

const _ctx = new WeakMap();
/** Per-ring cache: orientation and a coarse grid of segment indices. */
function ringContext(ring) {
  let c = _ctx.get(ring);
  if (c) return c;
  const pts = openRing(ring);
  const CELL = 2000;
  const grid = new Map();
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j], b = pts[(j + 1) % pts.length];
    const c0 = Math.floor(Math.min(a[0], b[0]) / CELL), c1 = Math.floor(Math.max(a[0], b[0]) / CELL);
    const r0 = Math.floor(Math.min(a[1], b[1]) / CELL), r1 = Math.floor(Math.max(a[1], b[1]) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) {
      const k = cx + ',' + cz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(j);
    }
  }
  c = { pts, ccw: signedArea(pts) > 0, grid, CELL };
  _ctx.set(ring, c);
  return c;
}

function candidateSegments(ctx, minX, minZ, maxX, maxZ) {
  const out = new Set();
  const { CELL, grid } = ctx;
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      const l = grid.get(cx + ',' + cz);
      if (l) for (const j of l) out.add(j);
    }
  return [...out];
}

function bbox(pts) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Proper crossings of segment a->b with ring segments; t along a->b, u along ring seg. */
function segmentCrossings(a, b, ctx, segs) {
  const out = [];
  const rx = b[0] - a[0], rz = b[1] - a[1];
  for (const j of segs) {
    const c = ctx.pts[j], d = ctx.pts[(j + 1) % ctx.pts.length];
    const sx = d[0] - c[0], sz = d[1] - c[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const qx = c[0] - a[0], qz = c[1] - a[1];
    const t = (qx * sz - qz * sx) / den;
    const u = (qx * rz - qz * rx) / den;
    if (t > 0 && t <= 1 && u >= 0 && u < 1) out.push({ t, j, u, pt: [a[0] + t * rx, a[1] + t * rz] });
  }
  return out;
}

/**
 * Intersect a simple polygon with the map edge ring.
 * @param {Array<[number,number]>} poly  scene [x,z], open or closed
 * @param {Array<[number,number]>} ring  map edge ring (getMapEdgeRing())
 * @returns {Array<Array<[number,number]>>} zero or more open polygons on the map
 */
export function clipPolygonToRing(poly, ring) {
  const ctx = ringContext(ring);
  let P = openRing(poly).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (P.length < 3) return [];
  if ((signedArea(P) > 0) !== ctx.ccw) P = P.slice().reverse();
  const bb = bbox(P);
  const segs = candidateSegments(ctx, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
  const X = [];
  if (segs.length) {
    for (let i = 0; i < P.length; i++) {
      for (const c of segmentCrossings(P[i], P[(i + 1) % P.length], ctx, segs)) X.push({ ...c, i });
    }
  }
  if (!X.length) return pointInRing(P[0][0], P[0][1], ctx.pts) ? [P] : [];
  if (X.length % 2) {
    // Degenerate touch; fall back to whole-or-nothing by the vertex majority.
    const inside = P.filter(p => pointInRing(p[0], p[1], ctx.pts)).length;
    return inside * 2 >= P.length ? [P] : [];
  }
  // Order along the subject and along the ring.
  X.sort((p, q) => p.i - q.i || p.t - q.t);
  X.forEach((x, k) => { x.sIdx = k; });
  const byRing = X.slice().sort((p, q) => p.j - q.j || p.u - q.u);
  byRing.forEach((x, k) => { x.rIdx = k; });
  // Entry/exit alternate along the subject; the first crossing is an exit when
  // the subject's first vertex is on the map.
  const startInside = pointInRing(P[0][0], P[0][1], ctx.pts);
  X.forEach((x, k) => { x.entry = (k % 2 === 0) !== startInside; });

  const n = P.length, m = ctx.pts.length, out = [];
  const visited = new Set();
  for (const start of X) {
    if (!start.entry || visited.has(start)) continue;
    const poly = [];
    let cur = start, guard = 0;
    do {
      visited.add(cur);
      poly.push(cur.pt);
      // Along the subject to the next crossing (an exit).
      const nx = X[(cur.sIdx + 1) % X.length];
      let i = cur.i;
      const wraps = nx.i < cur.i || (nx.i === cur.i && nx.t <= cur.t);
      if (nx.i !== cur.i || wraps) {
        const steps = ((nx.i - cur.i) % n + n) % n || n;
        for (let s = 1; s <= steps; s++) poly.push(P[(i + s) % n]);
      }
      poly.push(nx.pt);
      // Along the ring (forward, same winding) to the next crossing (an entry).
      const ne = byRing[(nx.rIdx + 1) % byRing.length];
      const rWraps = ne.j < nx.j || (ne.j === nx.j && ne.u <= nx.u);
      if (ne.j !== nx.j || rWraps) {
        const steps = ((ne.j - nx.j) % m + m) % m || m;
        for (let s = 1; s <= steps; s++) poly.push(ctx.pts[(nx.j + s) % m]);
      }
      cur = ne;
      if (++guard > X.length + 2) break;
    } while (cur !== start);
    if (poly.length >= 3 && Math.abs(signedArea(poly)) > 1) out.push(poly);
  }
  return out;
}

function trimStart(line, d) {
  let rem = d;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > rem) {
      const t = rem / l;
      return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...line.slice(i + 1)];
    }
    rem -= l;
  }
  return [];
}

function lineLength(line) {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return s;
}

/**
 * Split a polyline at the ring and keep the on-map runs.
 * @param {number} [endInsetM=0] pull each CUT end back this far along the line
 * @returns {Array<Array<[number,number]>>}
 */
export function clipPolylineToRing(line, ring, endInsetM = 0) {
  const ctx = ringContext(ring);
  if (line.length < 2) return [];
  const bb = bbox(line);
  const segs = candidateSegments(ctx, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
  let inside = pointInRing(line[0][0], line[0][1], ctx.pts);
  if (!segs.length) return inside ? [line] : [];
  const runs = [];
  let cur = inside ? { pts: [line[0]], cutStart: false } : null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const xs = segmentCrossings(a, b, ctx, segs).sort((p, q) => p.t - q.t);
    for (const x of xs) {
      if (inside) { cur.pts.push(x.pt); cur.cutEnd = true; runs.push(cur); cur = null; }
      else cur = { pts: [x.pt], cutStart: true };
      inside = !inside;
    }
    if (inside) cur.pts.push(b);
  }
  if (cur) runs.push(cur);
  const out = [];
  for (const r of runs) {
    let pts = r.pts;
    if (endInsetM > 0 && r.cutStart) pts = trimStart(pts, endInsetM);
    if (endInsetM > 0 && r.cutEnd && pts.length) pts = trimStart(pts.slice().reverse(), endInsetM).reverse();
    if (pts.length >= 2 && lineLength(pts) > 1) out.push(pts);
  }
  return out;
}

/**
 * Clip a reservoirs.json / canals.json style collection ({features:[{coords:[[lat,lon]...]}]})
 * to the map edge. Returns a new collection whose coords are scene [x, z] (build
 * it with SCENE_XZ) and a report of what was dropped or cut.
 *
 * @param {object} data
 * @param {(lat:number, lon:number)=>{x:number,z:number}} project
 * @param {Array<[number,number]>} ring
 * @param {{kind:'polygon'|'polyline', endInsetM?:number}} opts
 */
export function clipWaterToMapEdge(data, project, ring, { kind, endInsetM = 0 }) {
  const report = { kind, kept: 0, clipped: [], dropped: [] };
  if (!data?.features) return { data, report };
  const features = [];
  for (const f of data.features) {
    if (!f.coords || f.coords.length < (kind === 'polygon' ? 3 : 2)) continue;
    const pts = f.coords.map(([lat, lon]) => { const p = project(lat, lon); return [p.x, p.z]; });
    const parts = kind === 'polygon' ? clipPolygonToRing(pts, ring) : clipPolylineToRing(pts, ring, endInsetM);
    const label = f.name || f.id;
    if (!parts.length) { report.dropped.push(label); continue; }
    const measure = kind === 'polygon' ? (q) => Math.abs(signedArea(openRing(q))) : lineLength;
    const before = measure(pts), after = parts.reduce((s, q) => s + measure(q), 0);
    const cut = parts.length > 1 || after < before * 0.999 - (kind === 'polygon' ? 0 : endInsetM);
    if (cut) report.clipped.push(label); else report.kept++;
    // Unchanged features keep their source geometry exactly.
    const out = cut ? parts : [pts];
    out.forEach((coords, k) => features.push({ ...f, id: out.length > 1 ? `${f.id}#${k}` : f.id, coords, clippedToMapEdge: cut }));
  }
  return { data: { ...data, features, clippedToMapEdge: true }, report };
}

/**
 * Drop terrain contour segments beyond the map edge (Jordan: contour lines ran
 * on past the cliff, over the void). The contours are a LineSegments pair list
 * built from the full terrain grid, which extends past the ring and is only
 * discarded in the terrain shader. A segment wholly off the map is removed; one
 * crossing the edge is cut at it (bisection on the same off-map field the
 * baked buildings use, sub-metre at the edge). The geometry is rebuilt in
 * place, so the caller's object and material are kept.
 *
 * @param {THREE.BufferGeometry} geometry  LineSegments geometry (non-indexed)
 * @param {number} ox  world X of the geometry's local origin (lines.position.x)
 * @param {number} oz  world Z of the geometry's local origin
 * @param {(p:{x:number,z:number})=>boolean} isOff  off-map test (isOffMapEdge)
 * @returns {{before:number, after:number, cut:number}} segment counts
 */
export function clipLineSegmentsToMapEdge(geometry, ox, oz, isOff) {
  const pos = geometry?.getAttribute?.('position');
  if (!pos) return { before: 0, after: 0, cut: 0 };
  const a = pos.array, segs = pos.count / 2;
  const out = new Float32Array(a.length);
  let w = 0, cut = 0;
  const off = (x, z) => isOff({ x: x + ox, z: z + oz });
  for (let s = 0; s < segs; s++) {
    const i = s * 6;
    const x0 = a[i], y0 = a[i + 1], z0 = a[i + 2], x1 = a[i + 3], y1 = a[i + 4], z1 = a[i + 5];
    const o0 = off(x0, z0), o1 = off(x1, z1);
    if (o0 && o1) continue;
    out[w] = x0; out[w + 1] = y0; out[w + 2] = z0; out[w + 3] = x1; out[w + 4] = y1; out[w + 5] = z1;
    if (o0 !== o1) {
      // Bisect for the edge between the on-map end (lo) and the off-map end (hi).
      let lo = 0, hi = 1;
      const px = t => o0 ? x1 + (x0 - x1) * t : x0 + (x1 - x0) * t;
      const pz = t => o0 ? z1 + (z0 - z1) * t : z0 + (z1 - z0) * t;
      for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (off(px(m), pz(m))) hi = m; else lo = m; }
      const k = o0 ? w : w + 3;             // overwrite the off-map end
      out[k] = px(lo); out[k + 2] = pz(lo);
      cut++;
    }
    w += 6;
  }
  const before = segs, after = w / 6;
  if (after !== before) {
    geometry.setAttribute('position', new pos.constructor(out.slice(0, w), 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { before, after, cut };
}
