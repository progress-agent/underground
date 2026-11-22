// Test-only reference frames from actual drawn instance matrices. This does not
// import the production collision service's oriented slab or containment code.
export function installDrawnBuildingFrames() {
  window.__drawnBuildingFrames = boxes => {
    const keyed = new Map();
    const key = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
    const out = boxes.map(b => ({ ...b }));
    for (const b of out) {
      const k = key((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      if (!keyed.has(k)) keyed.set(k, []);
      keyed.get(k).push(b);
    }
    window.__ug.scene.traverse(mesh => {
      if (!mesh.isInstancedMesh || !/^(baked-)?buildings-/.test(mesh.name)) return;
      const m = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16, x = m[o + 12], z = m[o + 14];
        const candidates = keyed.get(key(x, z));
        if (!candidates) continue;
        const hx = (Math.abs(m[o]) + Math.abs(m[o + 8])) / 2;
        const hz = (Math.abs(m[o + 2]) + Math.abs(m[o + 10])) / 2;
        const width = Math.hypot(m[o], m[o + 2]);
        const depth = Math.hypot(m[o + 8], m[o + 10]);
        for (const b of candidates) {
          if (Math.abs(x - (b.minX + b.maxX) / 2) > .01
            || Math.abs(z - (b.minZ + b.maxZ) / 2) > .01
            || Math.abs(m[o + 13] - b.baseY) > .01
            || Math.abs(2 * hx - (b.maxX - b.minX)) > .01
            || Math.abs(2 * hz - (b.maxZ - b.minZ)) > .01) continue;
          const frame = { cx: x, cz: z, width, depth, ux: m[o] / width, uz: m[o + 2] / width };
          if (Number.isFinite(b.ux) && ['width', 'depth', 'ux', 'uz'].some(k => Math.abs(b[k] - frame[k]) > .001)) {
            throw Error('broad collision candidate matches different drawn rectangles');
          }
          Object.assign(b, frame);
        }
      }
    });
    if (out.some(b => !Number.isFinite(b.ux))) throw Error('collision candidate has no matching drawn building');
    return out;
  };

  window.__drawnBoxContains = (b, p, closed = false) => {
    const dx = p.x - b.cx, dz = p.z - b.cz;
    const x = Math.abs(dx * b.ux + dz * b.uz);
    const z = Math.abs(-dx * b.uz + dz * b.ux);
    return closed
      ? x <= b.width / 2 && z <= b.depth / 2 && p.y >= b.baseY && p.y <= b.roofY
      : x < b.width / 2 && z < b.depth / 2 && p.y > b.baseY && p.y < b.roofY;
  };

  window.__drawnBoxSegment = (box, a, b, closed = false) => {
    const ax = a.x - box.cx, az = a.z - box.cz;
    const dx = b.x - a.x, dz = b.z - a.z;
    const p = [ax * box.ux + az * box.uz, a.y, -ax * box.uz + az * box.ux];
    const d = [dx * box.ux + dz * box.uz, b.y - a.y, -dx * box.uz + dz * box.ux];
    const lo = [-box.width / 2, box.baseY, -box.depth / 2];
    const hi = [box.width / 2, box.roofY, box.depth / 2];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (p[k] < lo[k] || p[k] > hi[k]) return false;
        continue;
      }
      let near = (lo[k] - p[k]) / d[k], far = (hi[k] - p[k]) / d[k];
      if (near > far) [near, far] = [far, near];
      t0 = Math.max(t0, near); t1 = Math.min(t1, far);
      if (closed ? t0 > t1 : t0 >= t1) return false;
    }
    return true;
  };
}
