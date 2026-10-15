// player/index.js: the player, assembled (sprint 14Oct26w, lane P, D-053 items 2 to 4). One object holds the
// figure (loaded after the opening), its flames, its planar shadow and its screen rectangle; the camera rig,
// the view rules and the Pedestrian binding live in their own modules (camera-rig.js, view-rules.js,
// third-person.js, on-foot.js). Lane D reuses all of it for the skateboard, the Drone and the Balloon.
//
// TEST SURFACE (dev handle window.__ug.player): debug(), loaded, figure, screenRect, setShadowEnabled(b),
// group (the top-level `player` scene group, whose `visible` this code never writes).
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { composeTrueProportionMatrix } from '../true-proportion.js';
import { MANNEQUIN } from './mannequin-manifest.js';
import { createFigureLoader } from './figure-loader.js';
import { createFlames } from './flames.js';
import { createFigureShadow, shadowOpacity, shadowLight, clampSlope, SHADOW } from './figure-shadow.js';
import { displayedNdc } from './label-cover.js';

const SCREEN_BONES = ['Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'pelvis', 'neck_01'];
const BONE_PAD_M = 0.15;
const RECT_PAD_PX = 6;

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {object} o.scene
 * @param {{ ratio: number }} o.masterHeight
 * @param {object} [o.collision]  standHeightAt for the shadow's plane
 * @param {() => ({ direction, strengthRatio, elevationDeg })} [o.sunInfo]  canonical direction towards the sun
 * @param {(x:number,y:number)=>{x:number,y:number}} [o.distortNdc]  lens.js distortNdc
 * @param {(x:number,y:number,z:number)=>boolean} [o.isSubmergedAt]
 */
export function createPlayer({
  THREE, scene, masterHeight, collision = null, sunInfo = null, distortNdc = (x, y) => ({ x, y }),
  isSubmergedAt = () => false, manifest = MANNEQUIN,
}) {
  const group = new THREE.Group();
  group.name = 'player';
  scene.add(group);
  const loader = createFigureLoader({ THREE, parent: group, manifest });
  const flames = createFlames({ THREE, mergeGeometries, composeMatrix: composeTrueProportionMatrix, parent: group, isSubmergedAt });
  let shadow = null, shadowEnabled = true, flyHold = false;
  let visible = false;
  let rect = null;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const shadowDir = new THREE.Vector3();
  const ratio = () => masterHeight?.ratio ?? 1;

  function ensureShadow() {
    if (!shadow && loader.figure) { shadow = createFigureShadow({ THREE, figure: loader.figure }); shadow.setEnabled(shadowEnabled); }
    return shadow;
  }

  /**
   * Draw the figure for a frame. st: { x, y, z (canonical feet), heading, state ('ground'|'air'|'swim'), speed,
   * vx, vz (m/s), jet, jetLevel, clock }. show=false hides everything (first person, underground).
   */
  function update(dt, st, show = true) {
    const fig = loader.figure;
    if (!fig) { visible = false; rect = null; return; }
    if (!show) {
      if (visible) { fig.setVisible(false); fig.clearPoses(); flyHold = false; flames.update({ level: 0 }, fig, false); shadow?.hide(); }
      visible = false; rect = null;
      return;
    }
    visible = true;
    fig.setVisible(true);
    ensureShadow();
    // The flying pose: held while the jetpack fires and while the body is still in the air after it.
    if (st.state !== 'air') flyHold = false;
    if (st.jet) flyHold = true;
    fig.setPoseOverride('fly', (st.jet || (flyHold && st.state === 'air')) ? 1 : 0);
    fig.update(dt, st);
    flames.update({ clock: st.clock, level: st.jetLevel ?? (st.jet ? 1 : 0), state: st.state, vx: st.vx, vz: st.vz }, fig, true);
    updateShadow(st);
  }

  function updateShadow(st) {
    if (!shadow) return;
    const sun = sunInfo?.();
    if (!sun) { shadow.update({ light: null, planeY: 0, liftCanon: 0, opacity: 0 }); return; }
    const rat = ratio();
    const plane = collision ? collision.standHeightAt(st.x, st.z, st.y + 0.01, 0) : st.y;
    const planeY = Number.isFinite(plane) ? plane : st.y;
    const heightM = Math.max(0, (st.y - planeY) * rat);
    const opacity = shadowOpacity({
      strengthRatio: sun.strengthRatio, heightM, elevationDeg: sun.elevationDeg, swimming: st.state === 'swim',
    });
    // The thrown direction is the sun's, shortened (a 6 degree displayed sun would throw 16 m), and the plane is
    // tilted to the ground's slope under the feet (the ground, not a roof the body stands on).
    shadowLight(sun.direction, rat, shadowDir);
    let slopeX = 0, slopeZ = 0;
    const g0 = collision?.groundHeightAt ? collision.groundHeightAt(st.x, st.z) : null;
    if (g0 !== null && Math.abs(planeY - g0) < 0.05 / Math.max(1e-3, rat)) {
      const d = SHADOW.slopeProbeM;
      const gxp = collision.groundHeightAt(st.x + d, st.z), gxm = collision.groundHeightAt(st.x - d, st.z);
      const gzp = collision.groundHeightAt(st.x, st.z + d), gzm = collision.groundHeightAt(st.x, st.z - d);
      if (gxp !== null && gxm !== null) slopeX = (gxp - gxm) / (2 * d);
      if (gzp !== null && gzm !== null) slopeZ = (gzp - gzm) / (2 * d);
      const c = clampSlope(slopeX, slopeZ, shadowDir);
      slopeX = c.gx; slopeZ = c.gz;
    }
    shadow.update({ light: shadowDir, planeY, x: st.x, z: st.z, slopeX, slopeZ, liftCanon: SHADOW.liftM / Math.max(1e-3, rat), opacity });
  }

  /** The figure's rectangle on screen (CSS px, as the lens pass draws it), or null. Call after the camera is placed. */
  function project(camera, w = globalThis.innerWidth || 1440, h = globalThis.innerHeight || 900) {
    const fig = loader.figure;
    if (!fig || !visible) { rect = null; return null; }
    const rat = ratio();
    const focalPx = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    camera.updateMatrixWorld(true);
    for (const name of SCREEN_BONES) {
      if (!fig.boneWorldPosition(name, tmp)) continue;
      tmp2.copy(tmp);
      tmp2.project(camera);
      if (!(tmp2.z < 1)) continue;
      const d = displayedNdc({ x: tmp2.x, y: tmp2.y }, distortNdc);
      const px = (d.x * 0.5 + 0.5) * w, py = (1 - (d.y * 0.5 + 0.5)) * h;
      // metres of display distance (canonical y x ratio) set the pad's pixel size
      const dist = Math.hypot(tmp.x - camera.position.x, (tmp.y - camera.position.y) * rat, tmp.z - camera.position.z);
      const pad = BONE_PAD_M * focalPx / Math.max(0.3, dist);
      x0 = Math.min(x0, px - pad); x1 = Math.max(x1, px + pad); y0 = Math.min(y0, py - pad); y1 = Math.max(y1, py + pad);
      n++;
    }
    if (!n) { rect = null; return null; }
    x0 -= RECT_PAD_PX; y0 -= RECT_PAD_PX; x1 += RECT_PAD_PX; y1 += RECT_PAD_PX;
    if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) { rect = null; return null; }
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return rect;
  }

  return {
    group, flames,
    load: () => loader.load(),
    get loaded() { return loader.loaded; },
    get status() { return loader.status; },
    get figure() { return loader.figure; },
    get shadow() { return shadow; },
    get visible() { return visible; },
    get screenRect() { return rect; },
    update, project,
    setShadowEnabled(on) { shadowEnabled = !!on; shadow?.setEnabled(shadowEnabled); },
    debug() {
      const fig = loader.figure;
      const fd = fig?.debug();
      return {
        loaded: loader.loaded, visible: !!(fig && fig.visible && visible), clip: fd?.clip ?? null, heading: fig?.heading ?? 0,
        poseWeights: { fly: fig?.poseWeight('fly') ?? 0 },
        flames: flames.debug(),
        shadow: shadow ? shadow.debug() : { visible: false, opacity: 0, planeY: 0 },
      };
    },
  };
}
