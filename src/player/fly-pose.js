// fly-pose.js: the held flying pose (sprint 14Oct26w, lane P, D-053 item 4). Jordan: "a held flying pose (arms
// down, palms to the ground) while it fires". No clip in the Quaternius pack has one, so it is posed in code
// on top of whatever clip is playing (the `air` clip, Jump_Loop, keeps running beneath it).
//
// Every aim works in the figure's POSE frame (the glTF model's own space, before the heading and the
// true-proportion matrix of the figure root), so Master never bends the pose. Bones are rotated top-down, each
// in its parent's frame by slerp(identity, aim, weight), so weight 0 leaves the clip untouched and weight 1 is
// the pose:
//   arms     upperarm to lowerarm, lowerarm to hand: straight down, 14 degrees outward
//   hands    held flat: the rest (T-pose, palms down) orientation, turned 10 degrees so the fingers point a
//            little forward; palms to the ground, which is where the flames go
//   legs     thigh to calf: down, 4 degrees outward; calf to foot: down
//   feet     foot to ball: 58 degrees below horizontal, forward (pointed toes)

export const FLY = Object.freeze({
  armOutRad: 14 * Math.PI / 180,
  legOutRad: 4 * Math.PI / 180,
  handForwardRad: 10 * Math.PI / 180,
  toeDownRad: 58 * Math.PI / 180,
  riseS: 0.25,
  fallS: 0.30,
});

const SIDES = ['l', 'r'];

/**
 * Register the pose `fly` on a figure (figure.js registerPose). Safe when a bone is missing: that bone is skipped.
 */
export function registerFlyPose(figure, THREE) {
  const IDENT = new THREE.Quaternion();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(), qpInv = new THREE.Quaternion();
  const cur = new THREE.Vector3(), tgt = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  const bone = (n) => figure.bone(n);

  /** The matrix of obj in the pose group's frame, from the local matrices alone. */
  function frame(obj, out) {
    out.identity();
    const chain = [];
    for (let o = obj; o && o !== figure.poseGroup; o = o.parent) chain.push(o);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].matrix);
    return out;
  }
  const rotationOf = (obj, out) => { frame(obj, m).decompose(p, out, s); return out; };

  function aim(b, child, dir, w) {
    frame(b, m); pa.setFromMatrixPosition(m);
    frame(child, m); pb.setFromMatrixPosition(m);
    cur.subVectors(pb, pa);
    if (cur.lengthSq() < 1e-12) return;
    cur.normalize();
    qa.setFromUnitVectors(cur, dir);
    qw.copy(IDENT).slerp(qa, w);
    rotationOf(b.parent, qp);
    qpInv.copy(qp).invert();
    // local' = P^-1 W P local, with P the parent's rotation in the pose frame and W the aim in that frame
    b.quaternion.premultiply(qp).premultiply(qw).premultiply(qpInv);
    b.updateMatrix();
  }

  function hold(b, restQ, yaw, w) {
    qb.setFromAxisAngle(yAxis, yaw).multiply(restQ);          // target orientation in the pose frame
    rotationOf(b.parent, qp);
    qpInv.copy(qp).invert();
    qb.premultiply(qpInv);                                    // ... as a local rotation
    b.quaternion.slerp(qb, w);
    b.updateMatrix();
  }

  const down = new THREE.Vector3(0, -1, 0);
  const dirs = {};
  const rest = {};
  const sideOf = {};
  for (const sd of SIDES) {
    const hand = bone(`hand_${sd}`), pel = bone('pelvis');
    if (hand) {
      figure.model.updateMatrixWorld(true);
      rest[sd] = rotationOf(hand, new THREE.Quaternion());
      const hp = pa.setFromMatrixPosition(frame(hand, m)).x;
      const pp = pb.setFromMatrixPosition(frame(pel ?? hand, m)).x;
      sideOf[sd] = hp >= pp ? 1 : -1;
    } else sideOf[sd] = sd === 'l' ? 1 : -1;
    const sgn = sideOf[sd];
    dirs[`arm_${sd}`] = new THREE.Vector3(sgn * Math.sin(FLY.armOutRad), -Math.cos(FLY.armOutRad), 0);
    dirs[`leg_${sd}`] = new THREE.Vector3(sgn * Math.sin(FLY.legOutRad), -Math.cos(FLY.legOutRad), 0);
    dirs[`toe_${sd}`] = new THREE.Vector3(0, -Math.sin(FLY.toeDownRad), Math.cos(FLY.toeDownRad));
  }

  figure.registerPose('fly', (fig, w) => {
    fig.model.updateMatrixWorld(true);   // local matrices current after the mixer
    for (const sd of SIDES) {
      const ua = bone(`upperarm_${sd}`), la = bone(`lowerarm_${sd}`), hd = bone(`hand_${sd}`);
      if (ua && la) aim(ua, la, dirs[`arm_${sd}`], w);
      if (la && hd) aim(la, hd, dirs[`arm_${sd}`], w);
      if (hd && rest[sd]) hold(hd, rest[sd], -sideOf[sd] * FLY.handForwardRad, w);
    }
    for (const sd of SIDES) {
      const th = bone(`thigh_${sd}`), ca = bone(`calf_${sd}`), ft = bone(`foot_${sd}`), ba = bone(`ball_${sd}`);
      if (th && ca) aim(th, ca, dirs[`leg_${sd}`], w);
      if (ca && ft) aim(ca, ft, down, w);
      if (ft && ba) aim(ft, ba, dirs[`toe_${sd}`], w);
    }
  }, { riseS: FLY.riseS, fallS: FLY.fallS });
}
