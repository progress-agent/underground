// Plain 2D geometry for the orientation study. Points are [x, z] arrays in scene metres.

export function cleanRing(fp) {
  const r = [];
  for (const p of fp) { const q = r[r.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) r.push(p); }
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

export function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
  return a / 2;
}

export function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up); // CCW
}

// Minimum-area bounding rectangle by rotating the frame to each hull edge.
// Returns { theta (radians, [0, pi/2)), w (along theta), h, cx, cz, area }.
export function minRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    let th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    th = ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const r = frameRect(h, th);
    if (!best || r.area < best.area - 1e-9) best = r;
  }
  return best;
}

// Bounding rectangle of points in a frame rotated by theta.
export function frameRect(pts, th) {
  const c = Math.cos(th), s = Math.sin(th);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of pts) {
    const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { theta: th, w: u1 - u0, h: v1 - v0, cx: uc * c - vc * s, cz: uc * s + vc * c, area: (u1 - u0) * (v1 - v0) };
}

// Rectangle corners, CCW.
export function rectPoly(cx, cz, w, h, th) {
  const c = Math.cos(th), s = Math.sin(th), hw = w / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}

// Sutherland-Hodgman: subject (any simple polygon) clipped by a convex CCW polygon. Area is exact.
export function clipArea(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out.length >= 3 ? Math.abs(signedArea(out)) : 0;
}

export function iou(poly, polyArea, rect, rectArea) {
  const i = clipArea(poly, rect);
  return i / (polyArea + rectArea - i);
}

// Douglas-Peucker on a closed ring (anchored on vertex 0 and its farthest vertex).
export function simplifyRing(r, tol) {
  if (r.length <= 4) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(r.length); keep[0] = keep[far] = 1;
  const pts = r.concat([r[0]]);
  const stack = [[0, far], [far, r.length]];
  while (stack.length) {
    const [a, b] = stack.pop(); const A = pts[a], B = pts[b];
    const dx = B[0] - A[0], dz = B[1] - A[1], L = dx * dx + dz * dz;
    let max = tol * tol, at = -1;
    for (let i = a + 1; i < b; i++) {
      const t = L ? Math.max(0, Math.min(1, ((pts[i][0] - A[0]) * dx + (pts[i][1] - A[1]) * dz) / L)) : 0;
      const d = (pts[i][0] - A[0] - dx * t) ** 2 + (pts[i][1] - A[1] - dz * t) ** 2;
      if (d > max) { max = d; at = i; }
    }
    if (at >= 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : r;
}

export function pointInPoly(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function ptSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function segsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
// Distance from segment AB to a polygon (0 if it touches or enters it).
export function segPolyDist(ax, az, bx, bz, r) {
  if (pointInPoly(r, ax, az) || pointInPoly(r, bx, bz)) return 0;
  let d = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const p = r[j], q = r[i];
    if (segsCross(ax, az, bx, bz, p[0], p[1], q[0], q[1])) return 0;
    d = Math.min(d, ptSeg(p[0], p[1], ax, az, bx, bz), ptSeg(q[0], q[1], ax, az, bx, bz), ptSeg(ax, az, p[0], p[1], q[0], q[1]), ptSeg(bx, bz, p[0], p[1], q[0], q[1]));
  }
  return d;
}
export { ptSeg };
