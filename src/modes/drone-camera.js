// drone-camera.js: camera attitude helpers shared by the Drone and Balloon
// modes (sprint 23Sep26w, D-037, lane A3). Pure maths, no THREE import, so
// node tests can pin it.
//
// HEIGHT CONTRACT. The modes think in REAL space (metres on every axis). The
// scene is canonical VE5 space (Y = metres x VE), and vertical-scale.js turns
// the canonical camera into the displayed one by scaling the Y component of
// its forward and up vectors by Master / 5. So a real-space look direction
// (fx, fy, fz) must be written to the camera as the canonical direction
// (fx, fy * VE, fz): the display then shows (fx, fy * Master, fz), which is
// the real direction at Master 1 and the same exaggeration as the rest of the
// scene at any other Master. The same holds for travel: a real displacement
// (dx, dy, dz) is the canonical (dx, dy * VE, dz). Travel and view therefore
// stay aligned at every Master value, and no layer is ever rescaled.

const clampAbs = (v, m) => Math.max(-m, Math.min(m, v));

/**
 * Real-space basis for a yaw / pitch / roll attitude.
 * yaw: radians, 0 looks north (-Z), positive turns LEFT (counter-clockwise
 * seen from above, as Object3D.rotation.y). pitch: radians, positive looks up.
 * roll: radians, positive banks LEFT (the up vector leans towards -right).
 */
export function attitudeBasis(yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [-sy * cp, sp, -cy * cp];
  const r = [cy, 0, -sy];
  // up0 = r x f
  const u0 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const u = [u0[0] * cr - r[0] * sr, u0[1] * cr - r[1] * sr, u0[2] * cr - r[2] * sr];
  const rr = [r[0] * cr + u0[0] * sr, r[1] * cr + u0[1] * sr, r[2] * cr + u0[2] * sr];
  return { forward: f, up: u, right: rr };
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Canonical camera quaternion [x, y, z, w] for a real-space attitude.
 * The camera looks down its local -Z, so local +Z = -forward.
 */
export function attitudeQuaternion(yaw, pitch, roll, VE = 5) {
  const { forward, up } = attitudeBasis(yaw, pitch, roll);
  const z = norm([-forward[0], -forward[1] * VE, -forward[2]]);
  let x = cross([up[0], up[1] * VE, up[2]], z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-9) x = [Math.cos(yaw), 0, -Math.sin(yaw)];
  x = norm(x);
  const y = cross(z, x);
  // Rotation matrix columns x, y, z -> quaternion (Shepperd).
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    qw = 0.25 / s; qx = (m21 - m12) * s; qy = (m02 - m20) * s; qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}

/**
 * Real-space yaw and pitch of a canonical camera quaternion (the inverse of
 * attitudeQuaternion with roll ignored). Used to pick up wherever Deity left
 * the view, so entering a mode never jumps the heading.
 */
export function yawPitchFromQuaternion([x, y, z, w], VE = 5) {
  // Canonical forward = rotate (0, 0, -1).
  const fx = -(2 * (x * z + w * y));
  const fy = -(2 * (y * z - w * x));
  const fz = -(1 - 2 * (x * x + y * y));
  const rx = fx, ry = fy / VE, rz = fz;
  const h = Math.hypot(rx, rz);
  const yaw = h > 1e-9 ? Math.atan2(-rx, -rz) : 0;
  return { yaw, pitch: Math.atan2(ry, h) };
}

/** Write a real-space attitude to a THREE camera. */
export function applyAttitude(camera, yaw, pitch, roll, VE = 5) {
  const [x, y, z, w] = attitudeQuaternion(yaw, pitch, roll, VE);
  camera.quaternion.set(x, y, z, w);
}

/**
 * THREE's camera.fov is VERTICAL. FPV cameras are quoted by their horizontal
 * field of view, so the Drone tunable is horizontal and converted per aspect.
 */
export function verticalFovFromHorizontal(hfovDeg, aspect) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const h = Math.min(170, Math.max(1, hfovDeg)) * Math.PI / 180;
  return 2 * Math.atan(Math.tan(h / 2) / a) * 180 / Math.PI;
}

/** Keep an angle within [-pi, pi] of a reference, for continuous spring targets. */
export function wrapNear(angle, ref) {
  let a = angle;
  while (a - ref > Math.PI) a -= 2 * Math.PI;
  while (a - ref < -Math.PI) a += 2 * Math.PI;
  return a;
}

export { clampAbs };
