// Physical water membership uses the very same cross-sections as the visible
// volume. The narrower building-exclusion mask is deliberately unrelated.
export function createThamesNavigation(positions, getBedY, topY) {
  const cells = new Map(), triangles = [], bucketSize = 256;
  const add = (a, b, c) => {
    const tri = [a, b, c];
    const i = triangles.push(tri) - 1;
    const xs = tri.map(p => p.x), zs = tri.map(p => p.z);
    for (let x = Math.floor(Math.min(...xs) / bucketSize); x <= Math.floor(Math.max(...xs) / bucketSize); x++) {
      for (let z = Math.floor(Math.min(...zs) / bucketSize); z <= Math.floor(Math.max(...zs) / bucketSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  };
  const point = i => ({ x: positions[i * 3], z: positions[i * 3 + 2] });
  for (let i = 0; i < positions.length / 12 - 1; i++) {
    const b = i * 4, n = b + 4;
    add(point(b), point(n), point(b + 1));
    add(point(b + 1), point(n), point(n + 1));
  }
  function containsXZ(x, z) {
    const list = cells.get(`${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`);
    if (!list) return false;
    for (const index of list) {
      const [a, b, c] = triangles[index];
      const abx = b.x - a.x, abz = b.z - a.z, acx = c.x - a.x, acz = c.z - a.z;
      const det = abx * acz - abz * acx;
      if (Math.abs(det) < 1e-8) continue;
      const u = ((x - a.x) * acz - (z - a.z) * acx) / det;
      const v = (abx * (z - a.z) - abz * (x - a.x)) / det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) return true;
    }
    return false;
  }
  function bedAt(x, z) { return getBedY?.({ x, z }) ?? null; }
  function contains(p) {
    if (p.y >= topY || !containsXZ(p.x, p.z)) return false;
    const bed = bedAt(p.x, p.z);
    // Missing terrain is unknown, never an invented infinitely deep river.
    return bed !== null && p.y >= bed;
  }
  const banks = [];
  for (let i = 0; i < positions.length / 12 - 1; i++) {
    for (const side of [0, 1]) banks.push([point(i * 4 + side), point((i + 1) * 4 + side)]);
  }
  banks.push([point(0), point(1)]);
  const last = positions.length / 3 - 4;
  banks.push([point(last), point(last + 1)]);
  function outwardNormal(p, movement) {
    const bed = bedAt(p.x, p.z);
    let dist = Math.abs(p.y - topY), normal = { x: 0, y: 1, z: 0 };
    if (bed !== null && Math.abs(p.y - bed) < dist) {
      dist = Math.abs(p.y - bed);
      const east = bedAt(p.x + 0.25, p.z), west = bedAt(p.x - 0.25, p.z);
      const south = bedAt(p.x, p.z + 0.25), north = bedAt(p.x, p.z - 0.25);
      normal = { x: east !== null && west !== null ? (east - west) / 0.5 : 0,
        y: -1, z: south !== null && north !== null ? (south - north) / 0.5 : 0 };
    }
    for (const [a, b] of banks) {
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len2 || 1)));
      const ex = p.x - a.x - t * dx, ez = p.z - a.z - t * dz;
      const d = Math.hypot(ex, ez);
      if (d >= dist) continue;
      dist = d;
      const len = Math.sqrt(len2) || 1;
      normal = { x: -dz / len, y: 0, z: dx / len };
      if (containsXZ(p.x + normal.x * 0.1, p.z + normal.z * 0.1)) {
        normal.x *= -1; normal.z *= -1;
      }
    }
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    normal.x /= length; normal.y /= length; normal.z /= length;
    // At a corner either neighbouring face may be nearest; choose the face
    // orientation consistent with an outward crossing, never pull into soil.
    if (movement && normal.x * movement.x + normal.y * movement.y + normal.z * movement.z < 0) {
      normal.x *= -1; normal.y *= -1; normal.z *= -1;
    }
    return normal;
  }
  return { contains, containsXZ, bedAt, outwardNormal, topY, triangles };
}
