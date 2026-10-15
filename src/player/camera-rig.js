// camera-rig.js: the over-the-shoulder camera (sprint 14Oct26w, lane P, D-053 item 3). Mode-independent:
// the Pedestrian uses it now and lane D's Drone and Balloon use it for their bodies (per-body rows in
// RIG_TABLE, appended by D).
//
// REAL METRES, CONVERTED ONCE. The rig is worked out in display metres (what the viewer sees), then written
// to the camera in canonical space, where Y is stretched: a display height h is the canonical h / ratio
// (ratio = Master / 5, `masterHeight.ratio`), and the camera's pitch is atan(tan(displayPitch) / ratio), the
// same conversion the first-person camera uses (pedestrian.js cameraQuaternion). Nothing here uses VE: that is
// Master 5's ratio, not the live one. A shoulder offset written in canonical space would look different at
// Master 1.5 (drone-camera.js explains the same contract for the vehicles).
//
// THE RIG. A pivot a little above the body's feet; the camera orbits an origin shifted `shoulder` metres to the
// pivot's right, at `distance` metres behind it along the look direction, so the figure stands left of centre.
// Drag orbits (yaw, pitch), scroll or pinch scales the distance (one zoom factor, clamped per row), and a line
// of sight from the origin to the camera pulls the camera in rather than sit behind a facade.

/** Per-body rows (display metres and radians). D appends rows; never edit another lane's row. */
export const RIG_TABLE = Object.freeze({
  foot: Object.freeze({
    pivot: 1.45, shoulder: 0.45, distance: 4.2, min: 1.8, max: 12, pitch: -0.16, pitchMin: -1.20, pitchMax: 0.70,
  }),
  swim: Object.freeze({
    pivot: 1.60, shoulder: 0.35, distance: 4.6, min: 2.0, max: 12, pitch: -0.22, pitchMin: -1.20, pitchMax: 0.50,
  }),
});

// ── s14:D ── lane D's rows (sprint 14Oct26w, D-053 items 2 and 3), appended: the skateboard, the Drone and the Balloon.
// RIG_TABLE is frozen, so the three rows live in RIG_TABLE_D (a copy of P's rows plus D's); createCameraRig below takes
// RIG_TABLE_D whenever it is given the default table. Display metres and radians.
//   skate    pivot 1.50 above the wheels' contact point (the rider's chest on the deck), distance 5.0
//   drone    pivot 0.15 above the drone's centre, 2.2 m behind it (min 1.4 keeps the 0.54 m drone clear of the near plane)
//   balloon  pivot 0 (the mode passes a pivot that rises with the distance), 40 m behind the basket
export const RIG_TABLE_D = Object.freeze({
  ...RIG_TABLE,
  skate: Object.freeze({
    pivot: 1.50, shoulder: 0.45, distance: 5.0, min: 2.0, max: 12, pitch: -0.18, pitchMin: -1.20, pitchMax: 0.70,
  }),
  drone: Object.freeze({
    pivot: 0.15, shoulder: 0, distance: 2.2, min: 1.4, max: 12, pitch: -0.20, pitchMin: -1.20, pitchMax: 0.90,
  }),
  balloon: Object.freeze({
    pivot: 0, shoulder: 0, distance: 40, min: 4.5, max: 120, pitch: -0.12, pitchMin: -0.50, pitchMax: 0.90,
  }),
});
// ── /s14:D ──
export const RIG = Object.freeze({
  dragRadPerPx: 0.005,
  pivotRateXZ: 18,       // /s, how fast the pivot catches the body horizontally
  pivotRateY: 9,         // /s, vertically (and the row's pivot height)
  maxLagXZ: 0.9,         // m, the pivot never trails the body by more than this horizontally (a jetpack at 15 m/s)
  maxLagY: 0.5,          // m (display), nor vertically: a climb at 18 m/s would otherwise lift the head out of frame
  snapJumpM: 5,          // a body jump larger than this snaps the pivot
  losPad: 0.25,          // m, clearance kept from a facade
  losMinDistance: 0.5,   // m, the closest the camera is pulled
  releaseRate: 4,        // /s, how fast a pulled-in camera eases back out
  groundClearM: 0.3,     // m, the camera never sits lower than this above the ground (or the water)
  zoomMin: 0.05, zoomMax: 8,
});

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {number|(() => number)} o.ratio  Master / 5, live
 * @param {(from: object, to: object, opts: object) => object} [o.lineOfSight]  collision.lineOfSight (canonical points)
 * @param {(x: number, z: number) => number|null} [o.groundY]  canonical ground Y
 * @param {(x: number, z: number) => number|null} [o.waterY]   canonical water-top Y where there is water
 * @param {object} [o.table]
 */
export function createCameraRig({ THREE, ratio = 1, lineOfSight = null, groundY = null, waterY = null, table = RIG_TABLE }) {
  // ── s14:D ── the default table gains lane D's rows
  if (table === RIG_TABLE) table = RIG_TABLE_D;
  // ── /s14:D ──
  const getRatio = typeof ratio === 'function' ? ratio : () => ratio;
  let bodyName = 'foot';
  let yaw = 0, pitch = RIG_TABLE.foot.pitch, zoomF = 1;
  let curDist = null;                 // the distance after the line of sight (display metres)
  let pulled = false;
  const pivot = { x: 0, y: 0, z: 0, h: table.foot.pivot, has: false };   // canonical feet point, row pivot height
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), origin = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const from = { x: 0, y: 0, z: 0 }, to = { x: 0, y: 0, z: 0 };
  let lastRow = table.foot;

  const row = () => table[bodyName] ?? table.foot;
  const rowDistance = () => { const r = row(); return clamp(r.distance * zoomF, r.min, r.max); };

  function setBody(name) {
    if (!table[name]) throw new RangeError(`rig row "${name}"`);
    bodyName = name;
    const r = row();
    pitch = clamp(pitch, r.pitchMin, r.pitchMax);
    zoomF = clamp(zoomF, r.min / r.distance, r.max / r.distance);
  }

  function reset({ yaw: y = yaw, pitch: p = null, zoom = 1 } = {}) {
    const r = row();
    yaw = y;
    pitch = clamp(p === null ? r.pitch : p, r.pitchMin, r.pitchMax);
    zoomF = zoom;
    curDist = null;
    pulled = false;
    pivot.has = false;
  }

  function orbit(dxPx, dyPx) {
    const r = row();
    yaw -= dxPx * RIG.dragRadPerPx;
    pitch = clamp(pitch - dyPx * RIG.dragRadPerPx, r.pitchMin, r.pitchMax);
  }

  /** Multiply the distance by f (>1 moves the camera away). Returns the new distance in display metres. */
  function zoom(f) {
    const r = row();
    zoomF = clamp(zoomF * f, r.min / r.distance, r.max / r.distance);
    return rowDistance();
  }

  /**
   * Advance one frame: the pivot follows `feet` (canonical {x, y, z}), the line of sight is tested, and the
   * pose is computed (read it with pose() or place()).
   */
  function follow(feet, dt, { snap = false, underwater = false } = {}) {
    const r = row();
    lastRow = r;
    const rat = Math.max(1e-3, getRatio());
    const jump = Math.hypot(feet.x - pivot.x, feet.z - pivot.z, (feet.y - pivot.y) / 5);
    if (snap || !pivot.has || jump > RIG.snapJumpM) {
      pivot.x = feet.x; pivot.y = feet.y; pivot.z = feet.z; pivot.h = r.pivot; pivot.has = true;
    } else if (dt > 0) {
      pivot.x = damp(pivot.x, feet.x, RIG.pivotRateXZ, dt);
      pivot.z = damp(pivot.z, feet.z, RIG.pivotRateXZ, dt);
      pivot.y = damp(pivot.y, feet.y, RIG.pivotRateY, dt);
      pivot.h = damp(pivot.h, r.pivot, RIG.pivotRateY, dt);
      // a smooth follow, but a bounded one
      const lx = pivot.x - feet.x, lz = pivot.z - feet.z, lh = Math.hypot(lx, lz);
      if (lh > RIG.maxLagXZ) { pivot.x = feet.x + lx * RIG.maxLagXZ / lh; pivot.z = feet.z + lz * RIG.maxLagXZ / lh; }
      const limY = RIG.maxLagY / rat;
      pivot.y = clamp(pivot.y, feet.y - limY, feet.y + limY);
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    // The look direction in display space, and the origin the camera orbits (pivot plus the shoulder offset).
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const px = pivot.x, py = pivot.y + pivot.h / rat, pz = pivot.z;
    // A wall on the walker's right shortens the shoulder offset rather than put the origin inside it.
    let shoulder = r.shoulder;
    if (lineOfSight && shoulder > 0) {
      from.x = px; from.y = py; from.z = pz;
      to.x = px + cy * shoulder; to.y = py; to.z = pz - sy * shoulder;
      const res = lineOfSight(from, to, { pad: RIG.losPad });
      if (res && res.clear === false) shoulder = Math.max(0, res.t * shoulder);
    }
    origin.set(px + cy * shoulder, py, pz - sy * shoulder);
    const want = rowDistance();
    let dist = want;
    pulled = false;
    if (lineOfSight) {
      to.x = origin.x - fx * want; to.y = origin.y - fy * want / rat; to.z = origin.z - fz * want;
      // Two rays: from the shoulder origin and from the pivot itself (the figure's neck), so the camera
      // neither sits behind a facade nor sees the figure through a corner.
      for (let k = 0; k < 2; k++) {
        if (k === 0) { from.x = origin.x; from.y = origin.y; from.z = origin.z; } else { from.x = px; from.y = py; from.z = pz; }
        const res = lineOfSight(from, to, { pad: RIG.losPad });
        if (res && res.clear === false) {
          const d = Math.max(RIG.losMinDistance, res.t * want - RIG.losPad);
          if (d < dist) dist = d;
        }
      }
      pulled = dist < want - 1e-6;
    }
    // A pull-in is instant, the release eases out.
    if (curDist === null || dist < curDist || dt <= 0) curDist = dist;
    else curDist = damp(curDist, dist, RIG.releaseRate, dt);
    pos.set(origin.x - fx * curDist, origin.y - fy * curDist / rat, origin.z - fz * curDist);
    // Never below the ground (or the water top, unless the walker is under it).
    let floor = null;
    if (groundY) { const g = groundY(pos.x, pos.z); if (Number.isFinite(g)) floor = g; }
    if (waterY && !underwater) { const w = waterY(pos.x, pos.z); if (Number.isFinite(w) && (floor === null || w > floor)) floor = w; }
    if (floor !== null && pos.y < floor + RIG.groundClearM / rat) pos.y = floor + RIG.groundClearM / rat;
    euler.set(Math.atan(Math.tan(pitch) / rat), yaw, 0, 'YXZ');
    quat.setFromEuler(euler);
    return { position: pos, quaternion: quat };
  }

  /** The last computed pose, written into outPos (Vector3) and outQuat (Quaternion). */
  function pose(outPos, outQuat) {
    if (outPos) outPos.copy(pos);
    if (outQuat) outQuat.copy(quat);
    return { position: outPos, quaternion: outQuat };
  }

  /** Write the last pose to a camera and refresh its matrices. */
  function place(camera) {
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.updateMatrixWorld(true);
  }

  return {
    setBody, reset, orbit, zoom, follow, pose, place,
    get body() { return bodyName; },
    get yaw() { return yaw; }, set yaw(v) { yaw = v; },
    get pitch() { return pitch; }, set pitch(v) { const r = row(); pitch = clamp(v, r.pitchMin, r.pitchMax); },
    get distance() { return curDist ?? rowDistance(); },
    get wantedDistance() { return rowDistance(); },
    get zoomFactor() { return zoomF; },
    get pulled() { return pulled; },
    /**
     * The near plane (canonical, X/Z metres along the view axis) that keeps the figure whole when the camera is pulled
     * in: 1 m is the game's own near plane on foot (a body less than 1 m from the camera would be cut by it), so
     * below 2.5 m of distance it follows the distance, never under 0.12 m. Null when the default is fine.
     */
    get suggestedNear() { const d = curDist ?? rowDistance(); return d < 2.5 ? Math.max(0.12, 0.4 * d) : null; },
    get origin() { return origin; },
    get row() { return lastRow; },
  };
}
