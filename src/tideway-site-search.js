// Nearest dry footprint search for land shafts.
export function findNearest(ok, x, z, maxR = 120, step = 4) {
  if (ok(x, z)) return { x, z, moved: 0 };
  for (let r = step; r <= maxR; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) { best = { x: px, z: pz, moved: r }; break; }
    }
    if (best) return best;
  }
  return null;
}
