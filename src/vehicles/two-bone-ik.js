// two-bone-ik.js: the law-of-cosines solve for a two-bone limb (sprint 14Oct26w, lane D, D-053 item 2). Pure: plain
// [x, y, z] arrays, no THREE, so node tests pin it. The skateboard stance puts each foot where it belongs and this
// finds the knee that gets the leg there, bending towards the pole (the knee points forward, +Z in the figure's own
// frame).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a, fallback = [0, -1, 0]) => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : fallback.slice(); };

/**
 * Where the middle joint (the knee) goes so a limb of two bones, l1 from the root (the hip) and l2 on to the end (the
 * ankle), reaches the target.
 * @param {number[]} hip     [x, y, z]
 * @param {number[]} target  [x, y, z]
 * @param {number} l1        upper bone length
 * @param {number} l2        lower bone length
 * @param {number[]} pole    the direction the knee bends towards
 * @returns {{ knee: number[], end: number[], reached: boolean, bend: number }}
 *   end is where the limb ends up (the target when reachable, else the straight limb pointing at it);
 *   bend is the knee's flexion in radians (0 = straight, the angle between the two bones' directions)
 */
export function solveTwoBone(hip, target, l1, l2, pole = [0, 0, 1]) {
  const d = sub(target, hip);
  const dist = len(d);
  const dir = norm(d, [0, -1, 0]);
  const maxReach = l1 + l2;
  if (!(dist < maxReach - 1e-9)) {
    // out of reach (or exactly straight): a straight limb pointing at the target
    return { knee: add(hip, mul(dir, l1)), end: add(hip, mul(dir, maxReach)), reached: dist <= maxReach + 1e-9, bend: 0 };
  }
  const minReach = Math.abs(l1 - l2);
  const dd = Math.max(dist, minReach + 1e-9, 1e-9);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // the pole, made perpendicular to the hip-to-target line
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-9) {
    const other = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    p = sub(other, mul(dir, dot(other, dir)));
  }
  p = norm(p);
  const knee = add(add(hip, mul(dir, a)), mul(p, h));
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - dd * dd) / (2 * l1 * l2))));
  return { knee, end: add(hip, mul(dir, dist)), reached: dist >= minReach, bend };
}
