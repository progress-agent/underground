// figure.js: the player's body, a skinned library character (sprint 14Oct26w, lane P, D-053 item 2, D-045
// item 7). A dropped-in GLB with a skeleton and named clips, described by a manifest (mannequin-manifest.js):
// GLTFLoader and AnimationMixer from three r161, no retargeting, no controller package.
//
// HIERARCHY (the names the tests and the cost measurement look for)
//   player            top-level scene group (index.js); its `visible` is never written by this code
//     player-figure   matrixAutoUpdate = false: its matrix is the figure's pose, composed by
//                     composeTrueProportionMatrix, so the figure keeps its REAL size at any Master
//       player-pose   real metres: the swim lift
//         <glTF scene> scaled to the manifest height, feet on y = 0, facing +Z
//
// TRUE PROPORTIONS (D-039). The root matrix is T(feet) . S_y(5 / Master) . R(heading): the vertical unscale is
// applied outermost in canonical axes, so the skinned mesh is never sheared and the figure is exactly
// `heightM` tall on screen at every Master. Original glTF materials are untouched (original colours, D-049).
//
// ANIMATION. A clip is chosen from the state (ground speed bands, air, swim), cross-faded, and time-scaled to
// the ground speed so the feet do not skate. Procedural poses (the flying pose here, lane D's stance and push)
// are registered with registerPose and blend in over the clip after the mixer has run.
import { composeTrueProportionMatrix } from '../true-proportion.js';
import { registerFlyPose } from './fly-pose.js';

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Pick the clip for a state. Pure. state: 'ground' | 'air' | 'swim'; speed in m/s (horizontal on the ground). */
export function chooseClip(manifest, { state, speed }) {
  const c = manifest.clips;
  if (state === 'air') return { name: c.air, timeScale: 1 };
  if (state === 'swim') return { name: speed > 0.3 ? c.swim : c.swimIdle, timeScale: 1 };
  if (speed < manifest.idleBelow) return { name: c.idle, timeScale: 1 };
  if (speed < manifest.walkBelow) return { name: c.walk, timeScale: clamp(speed / manifest.walkSpeed, 0.5, 1.7) };
  if (speed > manifest.sprintAbove) return { name: c.sprint, timeScale: clamp(speed / manifest.sprintSpeed, 0.7, 1.6) };
  return { name: c.run, timeScale: clamp(speed / manifest.runSpeed, 0.7, 1.6) };
}

export function createFigure({ THREE, gltf, manifest }) {
  const root = new THREE.Group();
  root.name = 'player-figure';
  root.matrixAutoUpdate = false;
  const poseGroup = new THREE.Group();
  poseGroup.name = 'player-pose';
  root.add(poseGroup);
  const model = gltf.scene;
  poseGroup.add(model);

  const bones = new Map();
  const meshes = [];
  model.traverse((o) => {
    if (o.isBone) bones.set(o.name, o);
    if (o.isMesh) { o.frustumCulled = false; meshes.push(o); }
  });
  const skinned = meshes.filter((m) => m.isSkinnedMesh);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));

  const poses = new Map();     // name -> { apply(figure, w, dt), w, target, riseS, fallS }
  const quat = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  // ── s14:D ── the roll into a turn (the board), about the figure's own +X
  const s14dRoll = new THREE.Quaternion(), s14dX = new THREE.Vector3(1, 0, 0);
  // ── /s14:D ──
  const tmpBox = new THREE.Box3();
  let current = null, currentName = null, lift = 0, heading = 0;
  const feet = new THREE.Vector3();

  const figure = {
    group: root, model, poseGroup, mixer, manifest,
    get meshes() { return meshes; },
    get currentClip() { return currentName; },
    clipNames: [...actions.keys()],
    bone: (name) => bones.get(name) ?? null,

    /** Canonical world position of a bone (after the last update). Returns out, or null for an unknown bone. */
    boneWorldPosition(name, out) {
      const b = bones.get(name);
      if (!b) return null;
      return out.setFromMatrixPosition(b.matrixWorld);
    },

    setVisible(on) { root.visible = !!on; },
    get visible() { return root.visible; },

    /** Register a procedural pose: apply(figure, weight, dt) runs after the mixer while weight > 0. */
    registerPose(name, apply, { riseS = 0.25, fallS = 0.3 } = {}) {
      poses.set(name, { apply, w: 0, target: 0, riseS, fallS });
    },
    /** The weight the pose is heading for (0 to 1); it moves there linearly at the pose's own rates. */
    setPoseOverride(name, target) {
      const p = poses.get(name);
      if (p) p.target = clamp(target, 0, 1);
    },
    poseWeight(name) { return poses.get(name)?.w ?? 0; },
    /** Drop every procedural pose at once (the figure was hidden; it must not reappear mid-pose). */
    clearPoses() { for (const p of poses.values()) { p.w = 0; p.target = 0; } },

    /** Precise world bounding box of the skinned meshes into out (Box3). */
    box(out = tmpBox) {
      out.makeEmpty();
      for (const m of skinned) out.expandByObject(m, true);
      return out;
    },

    /**
     * One frame. st: { x, y, z (canonical feet), heading (yaw convention), state, speed, clock }.
     * Poses the skeleton, then composes the root matrix and refreshes every world matrix under it.
     */
    update(dt, st) {
      const sel = chooseClip(manifest, st);
      const next = actions.get(sel.name);
      if (next && next !== current) {
        next.reset();
        next.setLoop(THREE.LoopRepeat, Infinity);
        next.fadeIn(manifest.crossfadeS).play();
        if (current) current.fadeOut(manifest.crossfadeS);
        current = next; currentName = sel.name;
      }
      if (current) current.timeScale = sel.timeScale;
      if (dt > 0) mixer.update(dt);
      for (const p of poses.values()) {
        const step = dt / (p.target > p.w ? p.riseS : p.fallS);
        p.w = p.target > p.w ? Math.min(p.target, p.w + step) : Math.max(p.target, p.w - step);
        if (p.w > 1e-4) p.apply(figure, p.w, dt);
      }
      lift = damp(lift, st.state === 'swim' ? manifest.swimLiftM : 0, 10, dt);
      poseGroup.position.y = lift;
      // ── s14:D ── the board lifts the figure to the deck top: st.liftM, real metres (default 0)
      if (st.liftM) poseGroup.position.y += st.liftM;
      // ── /s14:D ──
      heading = st.heading ?? heading;
      feet.set(st.x, st.y, st.z);
      // glTF faces +Z; the walker's yaw 0 looks down -Z, so the figure turns by heading + PI about Y.
      quat.setFromAxisAngle(yAxis, heading + Math.PI);
      // ── s14:D ── st.rootRoll (default 0): a lean into a turn, about the figure's local +X (the way the board runs)
      if (st.rootRoll) quat.multiply(s14dRoll.setFromAxisAngle(s14dX, st.rootRoll));
      // ── /s14:D ──
      composeTrueProportionMatrix(root.matrix, feet, quat);
      root.matrixWorldNeedsUpdate = true;
      root.updateWorldMatrix(true, true);
    },
    get heading() { return heading; },
    debug: () => ({ clip: currentName, lift, poseWeights: Object.fromEntries([...poses].map(([n, p]) => [n, p.w])) }),
  };

  // The flying pose reads the bind pose (the hands' rest orientation), so it registers before anything poses.
  registerFlyPose(figure, THREE);

  // Stand it in its idle pose, measure it, scale it to a person and put its feet on y = 0 (as the mock does).
  const idle = actions.get(manifest.clips.idle);
  if (idle) { idle.play(); mixer.update(0); }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of skinned.length ? skinned : meshes) box.expandByObject(m, true);
  const h = Math.max(1e-6, box.max.y - box.min.y);
  const s = manifest.heightM / h;
  model.scale.multiplyScalar(s);
  model.position.y = -box.min.y * s;
  current = idle ?? null;
  currentName = idle ? manifest.clips.idle : null;
  root.visible = false;
  return figure;
}
