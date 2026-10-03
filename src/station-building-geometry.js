// station-building-geometry.js: pure plan geometry for the station buildings (sprint 02Oct26f, lane B).
//
// No THREE, no DOM: the builder script (scripts/prepare-station-buildings.mjs),
// the runtime index (src/station-buildings.js) and the node tests all use it.
//
// COORDINATES. Scene metres: x east, z south. A ring is [[x, z], ...], unclosed.
// ORIENTATION. A ring is "counter-clockwise seen from above" when north is up
// on the screen, which in (x, z) is a NEGATIVE shoelace sum (z points down the
// screen). For such a ring the outward normal of the edge (dx, dz) is
// (-dz, dx) / length. Every ring this module returns is in that orientation.
// PAVILIONS. { cx, cz, w, d, yaw }: w runs along the local axis u = (cos yaw, -sin yaw)
// and d along v = (sin yaw, cos yaw) (the rotation.y of a THREE object).

export const EPS = 1e-9;

/** Shoelace sum of a ring in (x, z); negative for the orientation described above. */
export function shoelace(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}
export const ringArea = (ring) => Math.abs(shoelace(ring)) / 2;

/** The ring in the module's orientation (reversed if need be), unclosed, as a new array. */
export function orient(ring) {
  const r = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  return shoelace(r) > 0 ? r.reverse() : r;
}

export function centroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < EPS) { // degenerate: the mean of the vertices
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bounds(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < xi + (z - zi) * (xj - xi) / (zj - zi)) inside = !inside;
  }
  return inside;
}

/** Nearest point of segment a-b to p: { x, z, d, t }. */
export function nearestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L > EPS ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const x = ax + t * dx, z = az + t * dz;
  return { x, z, d: Math.hypot(px - x, pz - z), t };
}

/**
 * Nearest boundary point of a ring to (x, z): { x, z, d, inside, nx, nz, edge }.
 * d is the distance to the boundary; `inside` says which side the point is on;
 * (nx, nz) is the outward unit normal there: the direction from the boundary
 * point to an outside query point (so a corner gives a radial normal), the
 * edge's own outward normal for an inside point.
 */
export function nearestOnRing(x, z, ring) {
  let best = null;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const q = nearestOnSegment(x, z, a[0], a[1], b[0], b[1]);
    if (!best || q.d < best.d) best = { ...q, edge: i };
  }
  const inside = pointInRing(x, z, ring);
  const a = ring[best.edge], b = ring[(best.edge + 1) % ring.length];
  const el = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const en = [-(b[1] - a[1]) / el, (b[0] - a[0]) / el];
  let nx = en[0], nz = en[1];
  if (!inside && best.d > 1e-6) { nx = (x - best.x) / best.d; nz = (z - best.z) / best.d; }
  return { x: best.x, z: best.z, d: best.d, inside, nx, nz, edge: best.edge };
}

/** Distance from (x, z) to the filled ring: 0 inside. */
export function distToRing(x, z, ring) {
  if (pointInRing(x, z, ring)) return 0;
  return nearestOnRing(x, z, ring).d;
}

/**
 * Drop vertices closer than minEdge to the previous one, then merge edges that
 * turn less than minTurnDeg, provided the dropped vertex lies within maxDev of
 * the merged edge (so a gentle curve is not flattened into a long chord).
 */
export function simplifyRing(ring, { minTurnDeg = 10, minEdge = 0.5, maxDev = 0.75 } = {}) {
  let r = [];
  for (const p of ring) { const q = r.at(-1); if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minEdge) r.push(p); }
  while (r.length > 3 && Math.hypot(r[0][0] - r.at(-1)[0], r[0][1] - r.at(-1)[1]) < minEdge) r.pop();
  const cosMin = Math.cos(minTurnDeg * Math.PI / 180);
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < EPS || lv < EPS) { r.splice(i, 1); changed = true; i--; continue; }
      const cos = (ux * vx + uz * vz) / (lu * lv);
      if (cos < cosMin) continue;
      const dev = nearestOnSegment(b[0], b[1], a[0], a[1], c[0], c[1]).d;
      if (dev > maxDev) continue;
      r.splice(i, 1); changed = true; i--;
    }
  }
  return r;
}

/** Outward unit normal of the edge i of an oriented ring. */
export function edgeNormal(ring, i) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
}

export function convexHull(points) {
  const p = points.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/** Minimum-area bounding rectangle: { w, d, angle } with w >= d. */
export function minAreaRect(ring) {
  const hull = convexHull(ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of hull) {
      const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const w = u1 - u0, d = v1 - v0;
    if (!best || w * d < best.area) best = { w: Math.max(w, d), d: Math.min(w, d), angle: w >= d ? ang : ang + Math.PI / 2, area: w * d };
  }
  return best ?? { w: 0, d: 0, angle: 0, area: 0 };
}

/** A point well inside the ring (grid search for the deepest point), deterministic. */
export function labelPoint(ring) {
  const b = bounds(ring);
  const span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  let step = Math.max(0.5, span / 48);
  let best = null;
  const scan = (x0, x1, z0, z1, st) => {
    for (let x = x0; x <= x1 + 1e-9; x += st) for (let z = z0; z <= z1 + 1e-9; z += st) {
      if (!pointInRing(x, z, ring)) continue;
      const d = nearestOnRing(x, z, ring).d;
      if (!best || d > best.d + 1e-9) best = { x, z, d };
    }
  };
  scan(b.x0, b.x1, b.z0, b.z1, step);
  for (let k = 0; k < 3 && best; k++) {
    const c = best; step /= 4;
    scan(c.x - step * 4, c.x + step * 4, c.z - step * 4, c.z + step * 4, step);
  }
  if (!best) { const c = centroid(ring); return { x: c[0], z: c[1], d: 0 }; }
  return best;
}

// ── Rectangles (pavilions) ────────────────────────────────────────────────

/** The four corners of a pavilion, in the module's orientation, inflated by `grow` on every side. */
export function rectRing({ cx, cz, w, d, yaw }, grow = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ux = c, uz = -s, vx = s, vz = c;
  const hw = w / 2 + grow, hd = d / 2 + grow;
  const corner = (a, b) => [cx + ux * a * hw + vx * b * hd, cz + uz * a * hw + vz * b * hd];
  return orient([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
}

/** Do two convex polygons overlap (separating axis test, touching is not overlap)? */
export function convexOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const nx = -(b[1] - a[1]), nz = b[0] - a[0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of A) { const t = q[0] * nx + q[1] * nz; if (t < a0) a0 = t; if (t > a1) a1 = t; }
      for (const q of B) { const t = q[0] * nx + q[1] * nz; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

/** The square a baked box draws: centre (x, z), side = sqrt(area), grown by `grow`. */
export function boxRing(x, z, side, grow = 0) {
  const h = side / 2 + grow;
  return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
}

/** The footprint ring of a building record from the JSON ({ outline } or { pavilion }). */
export function footprintOf(b, grow = 0) {
  return b.outline ? b.outline : rectRing(b.pavilion, grow);
}

/** Yaw (the Pedestrian's convention: facing (-sin yaw, -cos yaw)) that faces the horizontal heading (hx, hz). */
export const yawFacing = (hx, hz) => Math.atan2(-hx, -hz);

/** Sample count helper: a small deterministic spatial hash over rings' bounds. */
export function createFootprintGrid(items, cell = 32) {
  // items: [{ ring, ...payload }]; returns { near(x0, z0, x1, z1) -> items[], at(x, z) -> items[] }
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  items.forEach((it, idx) => {
    const b = it.bounds ?? bounds(it.ring);
    it.bounds = b;
    for (let i = Math.floor(b.x0 / cell); i <= Math.floor(b.x1 / cell); i++) {
      for (let j = Math.floor(b.z0 / cell); j <= Math.floor(b.z1 / cell); j++) {
        const k = key(i, j);
        let a = grid.get(k); if (!a) grid.set(k, a = []);
        a.push(idx);
      }
    }
  });
  return {
    items,
    at(x, z) {
      const a = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
      return a ? a.map(i => items[i]) : [];
    },
    near(x0, z0, x1, z1) {
      const seen = new Set(), out = [];
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
        for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
          const a = grid.get(key(i, j));
          if (a) for (const idx of a) if (!seen.has(idx)) { seen.add(idx); out.push(items[idx]); }
        }
      }
      return out;
    },
  };
}
