// skate-pose.js: the mannequin's stance and push on the skateboard (sprint 14Oct26w, lane D, D-053 item 2: "No free
// mannequin skateboarding clip exists, so the stance and push are posed procedurally"). Registered on the figure as the
// pose `skate` (figure.js registerPose), run after the mixer, weighted 0 to 1 over 0.2 s.
//
// THE BASE IS Idle_Loop, NOT Crouch_Idle_Loop. Measured on the source GLB (frame 0): Crouch_Idle_Loop bends the knee
// 94.5 degrees (a deep squat, legs parallel and facing forward); Idle_Loop bends it 21.4 degrees with the pelvis 0.88 m
// up. A cruising stance wants 30 to 50 degrees and every leg bone is re-placed sideways anyway, so the clip underneath
// is Idle_Loop (the figure is handed state 'ground', speed 0 while it rides).
//
// THE FRAME. Every number below is in the figure's POSE frame: real metres, the glTF model's own space before the
// heading and the true-proportion matrix, so Master never bends the pose. The model faces +Z, its left is +X, its feet
// stand on y = 0, which the figure module lifts to the deck top (liftM). The board runs along the figure's X (regular
// stance: the left foot towards the nose), so the figure stands sideways to the way it rides.
//
// THE POSE, top down:
//   root     the whole skeleton drops (knees bend) and is recentred over the board
//   spine_03, neck_01, Head   turned about the up axis towards the nose, so the rider looks where it goes
//   arms     aimed (upper to lower, lower to hand): the front arm out ahead, the back arm trailing
//   legs     two-bone IK from the hip to the ankle target, the knee bending forward (+Z); the foot aimed flat
// The push is the back foot swinging down to the ground beside the board, sliding back, and returning in an arc.
//
// PLANTED (s21:T, sprint 21Oct26w). Until then the slide was a fixed stroke in a fixed time (0.44 m back along the board over
// 0.495 s, 0.889 m/s whatever the speed), so the foot "on the ground" moved at the board's speed minus 0.889 m/s: about 0.47 m
// forward over the first full stroke from rest, and metres per stroke near top speed. A planted foot must go back along the board
// at the board's own speed. stepPlant() follows the ground: while in contact the ankle target moves back by exactly the board's
// travel since touchdown; contact ends when that travel reaches the leg's reach (0.44 m) or at phase slideShare (a slow board),
// whichever comes first; the return arc then runs from where the foot lifted back to its touchdown point over the rest of the
// stroke. Cadence (0.9 s), speed and every other pose are unchanged; with no `plant` every function below is exactly as it was.
import { solveTwoBone } from './two-bone-ik.js';

export const SKATE_POSE = Object.freeze({
  ankleM: 0.103,                    // the ankle bone's height above the sole
  groundSoleLiftM: 0.015,           // the toe of a foot at the ankle's height dips this far below its ankle target: lifted so the sole rests on the ground
  deckTopM: 0.157,                  // the deck's height above the ground
  footAlongM: 0.22,                 // the feet stand at x = +-0.22 (0.44 m apart along the board)
  footAcrossM: 0.03,                // and slightly ahead of the hips (+Z)
  stanceDropM: 0.05,                // the whole body lowers this much (knees bend about 50 degrees)
  pushDropM: 0.11,                  // and this much more over a kick (the back foot's ground is 0.157 m below the deck)
  pushShiftM: 0.15,                 // and the body leans this far over the front foot, so the back foot can reach the ground
  tuckDropM: 0.06,                  // and this much more in the air
  tuckLiftM: 0.06,                  // the feet come up this much in the air
  frontFootYaw: 15 * Math.PI / 180, // the front toes point a little towards the nose
  pushFootYaw: Math.PI / 2,         // and straight at it while the other foot kicks
  footPitchRad: -30.6 * Math.PI / 180, // foot to ball, below horizontal, when the sole is flat (measured on Idle_Loop)
  groundSlideFrom: [0.12, 0.20], groundSlideTo: [-0.32, 0.20],   // the kick, x and z: as far as the leg reaches (measured)
  slideShare: 0.55,                 // of the 0.9 s stroke is the slide on the ground; the rest the return
  reachM: 0.12 + 0.32,              // s21:T the leg's reach: groundSlideFrom[0] - groundSlideTo[0] (0.44 m), the same two numbers
  returnLiftM: 0.12,                // the return arcs this far above the ankle's standing height
  spineTurn: 0.25, neckTurn: 0.5, headTurn: 0.5, spinePushTurn: 0.6,
  armDirs: Object.freeze({
    upperarm_l: [0.75, -0.65, 0.10], lowerarm_l: [0.65, -0.75, 0.20],
    upperarm_r: [-0.55, -0.80, 0.20], lowerarm_r: [-0.40, -0.85, 0.35],
  }),
  riseS: 0.2, fallS: 0.2,
});

const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * A fresh plant record (s21:T): { contact, dx, dz, liftPhase, liftX, liftZ, lastPhase, lastPush }. dx, dz are the board's travel since touchdown
 * in the POSE frame (x along the board towards the nose, z across it), liftPhase the stroke phase at which the foot left the ground
 * and liftX, liftZ where it was then. Before the first step it describes the old fixed stroke's end (no contact).
 */
export function createPlant() {
  const S = SKATE_POSE;
  return { contact: false, dx: 0, dz: 0, liftPhase: S.slideShare, liftX: S.groundSlideTo[0], liftZ: S.groundSlideTo[1], lastPhase: 0, lastPush: 0 };
}

/**
 * Advance the plant by one frame (s21:T). Pure and allocation-free: it updates and returns `plant`.
 * @param {object} plant   from createPlant()
 * @param {{ push: number, pushPhase: number, travelX: number, travelZ: number }} f  the stroke weight and phase this frame, and the
 *        board's displacement this frame in the POSE frame (metres; the caller rotates the world displacement by the figure's facing)
 * A new stroke starts when the phase wrapped (pushPhase below last frame's), or the push weight is 0 now or was last frame; the touchdown is placed inside
 * the frame by the phase's own fraction, and so is the lift, so a long frame at speed plants and lifts where a short one would.
 */
export function stepPlant(plant, { push, pushPhase, travelX, travelZ }) {
  const S = SKATE_POSE, ph = pushPhase;
  const wrapped = push > 0 && plant.lastPush > 0 && ph < plant.lastPhase;
  let p0 = plant.lastPhase, tx = travelX, tz = travelZ;
  if (wrapped || !(push > 0) || !(plant.lastPush > 0)) {
    // a stroke begins: the share of this frame after the wrap (the phase advanced from lastPhase through 1 to ph), or all of it
    // when the stroke begins from no push at all (the phase advanced from 0 to ph)
    const share = wrapped ? Math.min(1, ph / Math.max(1e-12, ph + 1 - plant.lastPhase)) : 1;
    plant.contact = true; plant.dx = 0; plant.dz = 0; plant.liftPhase = S.slideShare;
    plant.liftX = S.groundSlideTo[0]; plant.liftZ = S.groundSlideTo[1];
    p0 = 0; tx *= share; tz *= share;
  }
  if (plant.contact) {
    const dx0 = plant.dx, dz0 = plant.dz, dp = ph - p0;
    let f = 2;                                                   // the fraction of the post-touchdown part of the frame at which contact ends
    if (dx0 + tx >= S.reachM) f = tx > 1e-12 ? Math.min(1, Math.max(0, (S.reachM - dx0) / tx)) : 0;
    if (ph >= S.slideShare) f = Math.min(f, dp > 1e-12 ? Math.min(1, Math.max(0, (S.slideShare - p0) / dp)) : 0);
    if (f <= 1) {
      plant.contact = false;
      plant.liftPhase = p0 + f * dp;
      plant.dx = Math.min(dx0 + tx * f, S.reachM); plant.dz = dz0 + tz * f;
      plant.liftX = S.groundSlideFrom[0] - plant.dx; plant.liftZ = S.groundSlideFrom[1] - plant.dz;
    } else { plant.dx = dx0 + tx; plant.dz = dz0 + tz; }
  }
  plant.lastPhase = ph; plant.lastPush = push;
  return plant;
}

/**
 * The back foot's ankle target in the pose frame (y = 0 is the deck top) for the stroke phase 0..1. Pure.
 * With a `plant` (s21:T, see the header) the foot is planted: in contact it goes back by the board's travel, then returns in an arc
 * from where it lifted; without one it is the fixed stroke of 14Oct26w, number for number.
 */
export function backFootPath(phase, plant = null) {
  const S = SKATE_POSE;
  const groundY = S.ankleM + S.groundSoleLiftM - S.deckTopM;   // the ankle with the sole on the ground
  const from = [S.groundSlideFrom[0], groundY, S.groundSlideFrom[1]];
  const ph = ((phase % 1) + 1) % 1;
  if (plant) {   // s21:T
    if (plant.contact) return [from[0] - plant.dx, groundY, from[2] - plant.dz];
    const u = clamp01((ph - plant.liftPhase) / (1 - plant.liftPhase));
    const p = lerp3([plant.liftX, groundY, plant.liftZ], from, u);
    p[1] = groundY + (S.ankleM + S.returnLiftM - groundY) * Math.sin(Math.PI * u);
    return p;
  }
  const to = [S.groundSlideTo[0], groundY, S.groundSlideTo[1]];
  if (ph < S.slideShare) return lerp3(from, to, ph / S.slideShare);
  const u = (ph - S.slideShare) / (1 - S.slideShare);
  const p = lerp3(to, from, u);
  p[1] = groundY + (S.ankleM + S.returnLiftM - groundY) * Math.sin(Math.PI * u);
  return p;
}

/**
 * How far the body is lowered over the front foot for the stroke phase: 1 while the back foot is on the ground (it
 * is 0.157 m lower than the deck, so the body must be too), easing up to 0.4 as the foot swings back through the air.
 * Continuous round the loop. Pure.
 */
export function kickDepth(phase, liftPhase = SKATE_POSE.slideShare) {   // s21:T liftPhase: where the planted foot left the ground (default: today's)
  const ph = ((phase % 1) + 1) % 1;
  if (ph < liftPhase) return 1;
  const u = (ph - liftPhase) / (1 - liftPhase);
  return 1 - 0.6 * Math.sin(Math.PI * u);
}

/**
 * Everything the pose is made of for a state, in the pose frame. Pure; the node test pins it.
 * @param {{ push: number, pushPhase: number, tuck: number, plant?: object|null }} s   plant (s21:T): see stepPlant; absent, the fixed stroke
 */
export function skateTargets({ push = 0, pushPhase = 0, tuck = 0, plant = null }) {
  const S = SKATE_POSE;
  const pw = clamp01(push), tk = clamp01(tuck);
  const wave = plant ? kickDepth(pushPhase, plant.liftPhase) : kickDepth(pushPhase);
  const drop = S.stanceDropM + S.pushDropM * pw * wave + S.tuckDropM * tk;
  const lift = S.tuckLiftM * tk;
  const stanceL = [S.footAlongM, S.ankleM + lift, S.footAcrossM];
  const stanceR = [-S.footAlongM, S.ankleM + lift, S.footAcrossM];
  const pushL = [0.20, S.ankleM, 0];
  const footL = lerp3(stanceL, pushL, pw);
  const footR = lerp3(stanceR, backFootPath(pushPhase, plant), pw);
  return {
    drop, shift: S.pushShiftM * pw * wave, footL, footR,
    yawL: lerp(S.frontFootYaw, S.pushFootYaw, pw), yawR: 0,
    spine: S.spineTurn + S.spinePushTurn * pw, neck: S.neckTurn, head: S.headTurn,
  };
}

/** Unit direction foot to ball for a foot turned `yaw` from straight across the board (+Z) towards the nose (+X). Pure. */
export function footAim(yaw) {
  const e = SKATE_POSE.footPitchRad, c = Math.cos(e);
  return [Math.sin(yaw) * c, Math.sin(e), Math.cos(yaw) * c];
}

/** The bones the pose writes to. */
const POSED = ['root', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];

/**
 * Register the pose `skate` on a figure. `params` is the shared mutable object the board controller writes each
 * frame: { push, pushPhase, tuck }. Safe when a bone is missing: that bone is skipped. Returns { restore() }.
 *
 * WHY EACH BONE IS REMEMBERED. The animation mixer writes a bone's property only when the clip's value changed since
 * its last write, so a bone whose track is constant (the root's position in Idle_Loop, for one) is NOT rewritten each
 * frame, and a pose that edits it on top would add its edit again every frame. So the pose remembers, per bone and per
 * property, the value it found (`clean`) and the value it left (`mine`): a property still equal to `mine` has not been
 * touched by the mixer, so it is put back to `clean` before the pose edits it again; a property that differs was written
 * by the mixer, and that is the new `clean`. restore() puts every property back once the pose has faded out (the
 * figure does not call a pose whose weight is 0).
 */
export function registerSkatePose(figure, THREE, params) {
  const S = SKATE_POSE;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(), qpInv = new THREE.Quaternion();
  const IDENT = new THREE.Quaternion();
  const cur = new THREE.Vector3(), dir = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const bone = (n) => figure.bone(n);

  /** The matrix of obj in the pose group's frame, from the local matrices alone. */
  function frame(obj, out) {
    out.identity();
    const chain = [];
    for (let o = obj; o && o !== figure.poseGroup; o = o.parent) chain.push(o);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].matrix);
    return out;
  }
  const positionOf = (obj, out) => out.setFromMatrixPosition(frame(obj, m));
  const rotationOf = (obj, out) => { frame(obj, m).decompose(p, out, sc); return out; };

  /** Rotate bone b, in its parent's frame, by the pose-frame rotation `world` (a Quaternion): local' = P^-1 W P local. */
  function rotateInPoseFrame(b, world) {
    rotationOf(b.parent, qp);
    qpInv.copy(qp).invert();
    b.quaternion.premultiply(qp).premultiply(world).premultiply(qpInv);
    b.updateMatrix();
  }

  /** Aim the bone b so the vector b -> child points along `to` (unit, pose frame), by weight w. */
  function aim(b, child, to, w) {
    positionOf(b, pa); positionOf(child, pb);
    cur.subVectors(pb, pa);
    if (cur.lengthSq() < 1e-12) return;
    cur.normalize();
    qa.setFromUnitVectors(cur, to);
    qw.copy(IDENT).slerp(qa, w);
    rotateInPoseFrame(b, qw);
  }

  function twist(b, angle) {
    if (!b || Math.abs(angle) < 1e-9) return;
    qw.setFromAxisAngle(yAxis, angle);
    rotateInPoseFrame(b, qw);
  }

  const root = bone('root'), pelvis = bone('pelvis');
  const posed = POSED.map((n) => bone(n)).filter(Boolean);
  const memo = new Map();       // bone -> { cq, cp, mq, mp }
  const same = (a, b) => !!a && a.equals(b);
  function begin() {
    for (const b of posed) {
      let r = memo.get(b);
      if (!r) { r = { cq: b.quaternion.clone(), cp: b.position.clone(), mq: null, mp: null }; memo.set(b, r); continue; }
      if (same(r.mq, b.quaternion)) b.quaternion.copy(r.cq); else r.cq.copy(b.quaternion);
      if (same(r.mp, b.position)) b.position.copy(r.cp); else r.cp.copy(b.position);
      b.updateMatrix();
    }
  }
  function end() {
    for (const b of posed) {
      const r = memo.get(b);
      if (!r) continue;
      (r.mq ??= b.quaternion.clone()).copy(b.quaternion);
      (r.mp ??= b.position.clone()).copy(b.position);
    }
  }
  function restore() {
    for (const [b, r] of memo) {
      if (same(r.mq, b.quaternion)) b.quaternion.copy(r.cq);
      if (same(r.mp, b.position)) b.position.copy(r.cp);
      r.mq = null; r.mp = null;
      b.updateMatrix();
    }
  }
  const armDirs = {};
  for (const [k, v] of Object.entries(S.armDirs)) armDirs[k] = new THREE.Vector3(...v).normalize();
  const pole = [0, 0, 1];
  const hipP = new THREE.Vector3(), kneeP = new THREE.Vector3(), ankleP = new THREE.Vector3();

  /** Two-bone IK for one leg towards `target` (pose frame), blended by w from where the clip has the ankle. */
  function leg(side, target, footYaw, w) {
    const th = bone(`thigh_${side}`), ca = bone(`calf_${side}`), ft = bone(`foot_${side}`), ba = bone(`ball_${side}`);
    if (!th || !ca || !ft) return;
    positionOf(th, hipP); positionOf(ca, kneeP); positionOf(ft, ankleP);
    const l1 = hipP.distanceTo(kneeP), l2 = kneeP.distanceTo(ankleP);
    const goal = [lerp(ankleP.x, target[0], w), lerp(ankleP.y, target[1], w), lerp(ankleP.z, target[2], w)];
    const r = solveTwoBone([hipP.x, hipP.y, hipP.z], goal, l1, l2, pole);
    dir.set(r.knee[0] - hipP.x, r.knee[1] - hipP.y, r.knee[2] - hipP.z).normalize();
    aim(th, ca, dir, 1);
    positionOf(ca, kneeP);                       // the knee as the rotated thigh now has it
    dir.set(goal[0] - kneeP.x, goal[1] - kneeP.y, goal[2] - kneeP.z).normalize();
    aim(ca, ft, dir, 1);
    if (ba) {
      const a = footAim(footYaw);
      dir.set(a[0], a[1], a[2]);
      aim(ft, ba, dir, w);
    }
  }

  figure.registerPose('skate', (fig, w) => {
    fig.model.updateMatrixWorld(true);
    begin();
    const t = skateTargets(params);
    // 1. The body drops and is recentred over the board (the whole skeleton moves with the root bone).
    if (root && pelvis) {
      positionOf(pelvis, pc);
      frame(root.parent, m).decompose(pa, qp, sc);
      const s = Math.max(1e-6, sc.x);
      qpInv.copy(qp).invert();
      dir.set((-pc.x + t.shift) * w, -t.drop * w, -pc.z * w).applyQuaternion(qpInv).multiplyScalar(1 / s);
      root.position.add(dir);
      root.updateMatrix();
    }
    // 2. The look along the travel.
    twist(bone('spine_03'), t.spine * w);
    twist(bone('neck_01'), t.neck * w);
    twist(bone('Head'), t.head * w);
    // 3. The arms.
    for (const side of ['l', 'r']) {
      const ua = bone(`upperarm_${side}`), la = bone(`lowerarm_${side}`), hd = bone(`hand_${side}`);
      if (ua && la) aim(ua, la, armDirs[`upperarm_${side}`], w);
      if (la && hd) aim(la, hd, armDirs[`lowerarm_${side}`], w);
    }
    // 4. The legs.
    leg('l', t.footL, t.yawL, w);
    leg('r', t.footR, t.yawR, w);
    end();
  }, { riseS: S.riseS, fallS: S.fallS });
  return { restore };
}
