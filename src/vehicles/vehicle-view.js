// vehicle-view.js: the over-the-shoulder view of the Drone and of the Balloon (sprint 14Oct26w, lane D, D-053 item 3:
// "One third-person camera: over the shoulder only, adjusted by mouse drag and by scroll or pinch ... One key still
// switches to first person above ground"). It is lane P's on-foot view (src/player/on-foot.js) for a body that is not
// the Pedestrian's, built from the same parts: the view rules (view-rules.js), the camera rig (camera-rig.js), the V
// key and the wheel (third-person.js).
//
// THE FLOW, once a frame (the mode calls three hooks):
//   preUpdate(dt)   the view rules are applied (the figure arriving, V, setView)
//   (the mode steps its own flight model and, in first person, places the camera as it always did)
//   apply(camera, dt, { pivot, snap, firstPerson })
//                   in third person the rig follows `pivot` and overwrites the camera; in first person `firstPerson`
//                   places it (today's camera, untouched); a view change blends between the two, easeOutCubic
//
// THE LOOK INPUT. Third person uses 'drag' (the cursor stays free; a drag orbits the rig). First person keeps the mode's
// own look (the Drone's pointer lock, the Balloon's drag). The lens is 22 mm in third person and the player's own (the
// HUD slider's value) in first person, set through ctx.lens, which keeps the camera where it is.
//
// WHICH VIEW. view-rules.js: the choice is first or third person (V flips it), what is SEEN is the choice filtered by
// whether the body is `loaded` (a Balloon needs the figure in its basket; the Drone is built in code, so it is always
// loaded). A Balloon opens in first person until the figure arrives, then changes once to third.
import { createViewRules } from '../player/view-rules.js';
import { createCameraRig } from '../player/camera-rig.js';
import { LENS_THIRD_MM, BLEND_S, easeOutCubic, installViewKey, installWheelZoom } from '../player/third-person.js';

/**
 * @param {object} o
 * @param {object} o.ctx            the shared mode context
 * @param {string} o.row            the rig row ('drone' | 'balloon')
 * @param {() => boolean} o.loaded  whether the body can be seen from outside yet
 * @param {'lock'|'drag'} o.firstLook   the look mode of first person
 * @param {number} o.transitionS    the activation blend (0.6 s Drone, 1.0 s Balloon)
 * @param {(info: { effective: string, rig: object }) => void} [o.onChange]  called when the effective view changes
 * @param {() => (number|null)} [o.firstFov]  the first-person camera's own vertical fov in degrees (the Drone's 110 degree
 *        horizontal), or null when first person uses the lens; the blend mixes it with the lens's
 */
export function createVehicleView({ ctx, row, loaded, firstLook = 'lock', transitionS = 0.6, onChange = null, firstFov = null }) {
  const { THREE } = ctx;
  const rules = createViewRules();
  const ratio = () => ctx.masterHeight?.ratio ?? 1;
  const rig = createCameraRig({
    THREE, ratio,
    lineOfSight: (a, b, o) => (typeof ctx.collision?.lineOfSight === 'function' ? ctx.collision.lineOfSight(a, b, o) : null),
    groundY: (x, z) => ctx.collision?.groundHeightAt(x, z) ?? null,
    waterY: (x, z) => ctx.collision?.waterAt(x, z)?.surfaceY ?? null,
  });

  let active = false;
  let effective = 'first';
  let blend = null;                       // { t, dur, fromPos, fromQuat, fromMm, toMm }
  let snapPending = false;
  const lastFinal = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), mm: null, fov: null };
  const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion();

  const lens = () => ctx.lens ?? null;
  const preferredMm = () => lens()?.preferred?.() ?? 30;
  const targetMm = (view) => (view === 'third' ? LENS_THIRD_MM : preferredMm());

  function captureFinal() {
    lastFinal.pos.copy(ctx.camera.position);
    lastFinal.quat.copy(ctx.camera.quaternion);
    lastFinal.mm = lens()?.get?.() ?? null;
    lastFinal.fov = ctx.camera.fov;
  }
  function startBlend(dur, view) {
    blend = { t: 0, dur: Math.max(1e-3, dur), fromPos: lastFinal.pos.clone(), fromQuat: lastFinal.quat.clone(), fromMm: lastFinal.mm, fromFov: lastFinal.fov, toMm: targetMm(view) };
  }
  function applyLook() {
    ctx.look?.setMode?.(active && effective === 'third' ? 'drag' : firstLook);
    ctx.refreshHud?.();
  }

  /** Recompute the effective view; on a change start the blend and switch the look input. */
  function evaluate(why = null) {
    const r = rules.update({ loaded: !!loaded(), allowsThird: true });
    if (r.effective === effective) return;
    effective = r.effective;
    const dur = why === 'activate' ? transitionS : r.auto ? BLEND_S.auto : (why === 'key' ? BLEND_S.key : BLEND_S.forced);
    if (why === 'instant') {
      blend = null;
      const l = lens();
      if (l && Math.abs((l.get() ?? 0) - targetMm(effective)) > 1e-6) l.set(targetMm(effective));
    } else startBlend(dur, effective);
    if (why !== 'activate') snapPending = snapPending || effective === 'third';
    try { onChange?.({ effective, rig, why }); } catch (err) { console.warn('[vehicle-view] onChange', err); }
    applyLook();
  }

  const offKey = installViewKey({ isActive: () => active, onPress: () => { rules.press(); evaluate('key'); } });
  const offWheel = installWheelZoom({
    canvas: ctx.canvas, isActive: () => active, isThird: () => active && effective === 'third', zoom: (f) => rig.zoom(f),
  });

  const api = {
    /** The mode was (re)activated: third person if the body is ready, else first and wait for it. */
    activate() {
      active = true;
      effective = 'first';
      blend = null;
      rules.reset(!!loaded());
      rig.setBody(row);
      snapPending = true;
      captureFinal();
      evaluate('activate');
      applyLook();
    },
    deactivate() {
      active = false;
      effective = 'first';
      blend = null;
      const l = lens();
      if (l && Math.abs((l.get() ?? 0) - preferredMm()) > 1e-6) l.set(preferredMm());
    },
    /** Put the rig behind a yaw/pitch (display pitch) with no blend: a placement from outside, or the start of a view. */
    reset({ yaw, pitch = null, zoom = 1 } = {}) {
      rig.setBody(row);
      rig.reset({ yaw, pitch, zoom });
      snapPending = true;
      // a blend cut short by a placement must still leave the lens where the view is going
      if (blend) {
        const l = lens();
        if (l && Math.abs((l.get() ?? 0) - blend.toMm) > 1e-4) l.set(blend.toMm);
        blend = null;
      }
      captureFinal();
    },
    /** A look delta from the pointer. True when the rig took it (third person). */
    onLook(dx, dy) {
      if (!active || effective !== 'third') return false;
      rig.orbit(dx, dy);
      return true;
    },
    preUpdate() {
      if (!active) return;
      evaluate();
    },
    /**
     * Place the camera for the frame. `pivot` is the canonical point the rig follows (the body's feet, or the point
     * above them the mode wants the camera to look at); `firstPerson(camera)` writes today's first-person pose.
     */
    apply(camera, dt, { pivot = null, snap = true, firstPerson = null } = {}) {
      if (!active) return;
      evaluate();
      const show = effective === 'third' && !!pivot;
      if (show) {
        rig.setBody(row);
        rig.follow(pivot, dt, { snap: snap || snapPending });
        snapPending = false;
        rig.pose(tPos, tQuat);
      } else {
        firstPerson?.(camera);
        tPos.copy(camera.position); tQuat.copy(camera.quaternion);
      }
      let mm = null, mix = null;
      if (blend) {
        blend.t += dt;
        const k = Math.min(1, blend.t / blend.dur), e = easeOutCubic(k);
        tPos.lerpVectors(blend.fromPos, tPos, e);
        tQuat.slerpQuaternions(blend.fromQuat, tQuat, e);
        mm = blend.fromMm !== null ? blend.fromMm + (blend.toMm - blend.fromMm) * e : blend.toMm;
        mix = { e, fromFov: blend.fromFov };
        if (k >= 1) { mm = blend.toMm; blend = null; }
      }
      if (mm !== null && lens() && Math.abs((lens().get() ?? 0) - mm) > 1e-4) lens().set(mm);
      // A first person with a field of view of its own (the Drone's) is mixed with the lens's across the blend.
      if (mix && firstFov) {
        const ff = firstFov();
        if (ff !== null && Number.isFinite(ff)) {
          const lensFov = camera.fov;
          camera.fov = effective === 'third'
            ? (mix.fromFov ?? ff) + (lensFov - (mix.fromFov ?? ff)) * mix.e
            : lensFov + (ff - lensFov) * mix.e;
          camera.updateProjectionMatrix();
        }
      }
      if (show || blend) {
        camera.position.copy(tPos);
        camera.quaternion.copy(tQuat);
        camera.updateMatrixWorld(true);
      }
      captureFinal();
    },
    lookMode() { return active ? (effective === 'third' ? 'drag' : firstLook) : (loaded() ? 'drag' : firstLook); },
    isThirdPerson() { return active && effective === 'third'; },
    /** The test surface: choose a view and have it at once, with no blend. */
    setView(v) { rules.set(v); evaluate('instant'); },
    debug() {
      return {
        chosen: rules.chosen, effective, pressed: rules.pressed,
        transition: blend ? { t: blend.t, dur: blend.dur } : null,
        focal: lens()?.get?.() ?? null,
        rig: { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, pulled: rig.pulled, zoom: rig.zoomFactor },
      };
    },
    dispose() { void offKey; void offWheel; },
    get rig() { return rig; },
    get rules() { return rules; },
    get active() { return active; },
  };
  return api;
}
