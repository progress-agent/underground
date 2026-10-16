// near-clearance.js: a camera that stands against a wall must not see the inside of it (sprint 16Oct26f, lane T,
// T-near; D-054). Pure maths and one collision probe, node-testable; on-foot.js applies the result.
//
// THE PROBLEM. The player's near plane is 1.0 scene unit, and the walker stops 0.35 m short of a facade (BODY.radius).
// A near plane is a rectangle, so its four corners sit `near x cf` from the eye, where
//   cf = sqrt(1 + t^2 (1 + aspect^2)),  t = tan(vfov / 2),
// 1.225 at the default lens in a 1440 x 900 window and 1.46 at 16:9 with the 55 degree lens. A wall nearer than
// that is cut open: the frame shows the inside of the wall.
//
// THE FIX, settled in the design: lower the near plane ONLY while something solid is within reach of the eye,
// never globally. A fixed low near would cost depth precision on every street view for nothing (24-bit depth
// resolves z^2 / (near x 2^24): 0.06 m at 1 km for near 1, 0.23 m for near 0.257). So eight probes go out from the
// eye; when none hits within PROBE_REACH_M the near stays what pedestrian.js set (1.0); when one does, the near keeps the
// corners 0.9 of (the wall distance less PROUD_M) from the eye, clamped to [NEAR_FLOOR, 1].
//
// The probe is `collision.moveAndSlide` with step 0: it sees the same boxes, bridge decks and station prisms the
// walker's own body hits. It reports the nearest wall by the distance along the blocked axis, which is the
// perpendicular distance to an axis-aligned facade whatever direction the probe took.

export const PROBE_REACH_M = 1.5;       // how far from the eye a wall can matter
export const NEAR_FLOOR = 0.1;          // the floor the bores already use (pedestrian.js UNDERGROUND_NEAR)
export const NEAR_CEIL = 1.0;           // the on-foot near plane
export const CLEARANCE_FRACTION = 0.9;  // the corners reach this share of the wall distance...
export const PROUD_M = 0.05;            // ...less this: what is drawn stands a few cm proud of the footprint the collision knows (a station's
                                        // roundel board, a parapet cap, a window ledge). Measured at King's Cross, where the drawn wall was 4.5 cm
                                        // nearer the eye than the collision ring and a bare 10% margin left the corner 3 mm inside it.
export const PROBE_AZIMUTHS = 8;

/** How far the near plane's corners reach per unit of `near`: sqrt(1 + t^2 (1 + aspect^2)), t = tan(vfov / 2). */
export function cornerFactor(fovDeg, aspect) {
  const t = Math.tan(fovDeg * Math.PI / 360);
  return Math.sqrt(1 + t * t * (1 + aspect * aspect));
}

/** The near plane that keeps a camera `wallM` metres from a wall clear of it. */
export function nearForWall(wallM, cf, { floor = NEAR_FLOOR, ceil = NEAR_CEIL } = {}) {
  if (!Number.isFinite(wallM) || wallM < 0 || !(cf > 0)) return ceil;
  return Math.min(ceil, Math.max(floor, CLEARANCE_FRACTION * (wallM - PROUD_M) / cf));
}

const COS = [], SIN = [];
for (let i = 0; i < PROBE_AZIMUTHS; i++) {
  const a = (i / PROBE_AZIMUTHS) * Math.PI * 2;
  COS.push(Math.cos(a)); SIN.push(Math.sin(a));
}
const start = { x: 0, y: 0, z: 0 };
const delta = { x: 0, y: 0, z: 0 };
const bodyOpts = { radius: 0.33, height: 9, step: 0 };

/**
 * The distance from (x, z) to the nearest solid wall within PROBE_REACH_M in the band [feetY, feetY + height],
 * or null when there is none. `radius` is the probe's own footprint: the result adds it back, so it is the
 * distance to the wall face itself. Canonical units for y and height, metres for the rest.
 */
export function wallDistance(collision, x, z, feetY, height, radius) {
  if (!collision || typeof collision.moveAndSlide !== 'function') return null;
  start.x = x; start.y = feetY; start.z = z;
  bodyOpts.radius = radius; bodyOpts.height = height;
  let least = null;
  for (let i = 0; i < PROBE_AZIMUTHS; i++) {
    delta.x = PROBE_REACH_M * COS[i]; delta.z = PROBE_REACH_M * SIN[i];
    const r = collision.moveAndSlide(start, delta, bodyOpts);
    if (!r.hit) continue;
    const mx = r.x - x, mz = r.z - z;
    let d = Math.hypot(mx, mz);
    // The last facade's outward normal: the move along it is exactly the way to that wall (a diagonal probe slides
    // along the first wall and would otherwise report the slide as well).
    const nl = Math.hypot(r.normalX, r.normalZ);
    if (nl > 0.5) d = Math.min(d, Math.abs(mx * r.normalX + mz * r.normalZ) / nl);
    d += radius;
    if (least === null || d < least) least = d;
  }
  return least;
}

/**
 * The distance from (x, z) to the nearest face of a station's host box (`hosts`: [{ x, z, side }], the squares of
 * station-buildings.js), or null beyond PROBE_REACH_M. A raised host (Fulham Broadway's stands 2.85 m above its north face)
 * is not in the collision's band at eye height, because the walker passes under it, and its plinth wall is drawn there:
 * moveAndSlide cannot see it, the square can.
 */
export function hostDistance(hosts, x, z) {
  let least = null;
  for (const h of hosts || []) {
    const half = h.side / 2, ox = Math.abs(x - h.x) - half, oz = Math.abs(z - h.z) - half;
    const d = ox <= 0 && oz <= 0 ? 0 : Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
    if (d <= PROBE_REACH_M && (least === null || d < least)) least = d;
  }
  return least;
}

/**
 * A cached probe. `measure(x, y, z, band)` returns the wall distance (metres) or null, probing again only when the
 * point moved at least MOVE_M (metres in the plane, MOVE_M x VE vertically) since the last probe, when the band
 * changed, or after MAX_AGE frames: a walker standing still costs nothing.
 */
export function createClearanceProbe({ collision, VE = 5 }) {
  const MOVE_M = 0.02, MAX_AGE = 30;
  let lx = NaN, ly = NaN, lz = NaN, lr = NaN, lh = NaN, age = 0, last = null, probes = 0;
  return {
    measure(x, y, z, { feetY, height, radius, hosts = null }) {
      const moved = !(Math.hypot(x - lx, z - lz) < MOVE_M && Math.abs(y - ly) < MOVE_M * VE)
        || radius !== lr || height !== lh;
      if (moved || age >= MAX_AGE) {
        last = wallDistance(collision, x, z, feetY, height, radius);
        const hd = hostDistance(hosts, x, z);
        if (hd !== null && (last === null || hd < last)) last = hd;
        lx = x; ly = y; lz = z; lr = radius; lh = height; age = 0; probes++;
      } else age++;
      return last;
    },
    reset() { lx = ly = lz = NaN; age = 0; last = null; },
    get probes() { return probes; },
  };
}
