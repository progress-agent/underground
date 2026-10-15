// balloon.js: Balloon conveyance mode (sprint 23Sep26w, D-037, lane A3).
//
//   E / Space burner · Q vent · drag to look (the cursor stays free)
//   T time warp (x10 by default; T again for real time)
//
// No direct steering: the basket drifts with the shared world wind
// (src/wind.js) at its altitude, and altitude is chosen with the burner and
// the vent through a multi-second thermal lag. The flight model is
// balloon-physics.js (pure, node-tested); this file wires it to the shared
// mode context (src/modes/index.js).
//
// T was unbound before this lane (main.js binds WASDQE, arrows, Shift; lane
// A1 binds the digits). The mode listens for it only while Balloon is active.

import {
  BALLOON_TUNABLES, BALLOON_DEFAULTS, BASKET_EYE_M, createBalloonState, stepBalloon, windVector,
} from './balloon-physics.js';
import { applyAttitude, yawPitchFromQuaternion } from './drone-camera.js';
import { isFormInput, modeClaimsSpace } from './space-key.js';
// ── s14:D ── the Balloon seen from outside, the figure in its basket (D-053 items 2 and 3): its over-the-shoulder view
import { createVehicleView } from '../vehicles/vehicle-view.js';
// ── /s14:D ──

const DEG = Math.PI / 180;
const PITCH_LIMIT = 85 * DEG;
export const WARP_KEY = 't';
// ── s14:D ──
const FIGURE_TURN_RATE = 3;        // /s, the figure in the basket turns to look where the camera looks
const BASKET_FLOOR_TOP_M = 0.06;   // the standing surface above the basket floor's underside (the model's floor thickness)
/** The pivot's height above the basket floor (display metres) for the camera's distance: scrolling in brings the camera
 *  down from the envelope (10.5 m at 26 m and beyond) to the figure's chest (1.3 m at 6 m and closer). */
export const balloonPivotH = (d) => 1.3 + 9.2 * Math.min(1, Math.max(0, (d - 6) / 20));
const THIRD_WARP_HINT = (warpOn, warp) => `E/Space burner · Q vent · drag to look · scroll to zoom · V first person · ${warpOn ? `T time warp ×${warp} ON (T for real time)` : `T time warp ×${warp}`}`;
const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
// ── /s14:D ──

/**
 * @param {object} ctx shared mode context (see src/modes/index.js)
 * @returns {object} a mode object (see src/modes/registry.js)
 */
export function createBalloonMode(ctx) {
  const params = ctx?.physics?.register
    ? ctx.physics.register('balloon', 'Balloon', BALLOON_TUNABLES)
    : { ...BALLOON_DEFAULTS };
  let state = null;
  let yaw = 0, pitch = 0;
  let warpOn = false;
  let activeCtx = null;
  let listening = false;
  // ── s14:D ── the view: over the shoulder (the figure arrives, then it opens in third person) or the basket's own eye (V)
  let view = null, figYaw = 0;
  function ensureView(c) {
    if (!view && c?.vehicles) {
      view = createVehicleView({
        ctx: c, row: 'balloon', loaded: () => !!c.playerView?.figureLoaded?.(), firstLook: 'drag', transitionS: 1.0,
        onChange: ({ effective, rig, why }) => {
          // entering: the view takes the heading the camera had and the row's own pitch; V and the figure's arrival keep both
          if (effective === 'third') rig.reset(why === 'activate' ? { yaw } : { yaw, pitch: Math.max(-0.5, Math.min(0.9, pitch)) });
          else { yaw = rig.yaw; pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rig.pitch)); }
        },
      });
    }
    return view;
  }
  function basketOrigin(c) { return { x: state.pos.x, y: state.pos.y - BASKET_EYE_M * (c.VE ?? 5), z: state.pos.z }; }
  /** The figure and the balloon for the frame: drawn in third person, gone in first. */
  function drawModels(c, dt) {
    const V = c.vehicles;
    if (!V || !state) return;
    const third = !!view?.isThirdPerson();
    const rat = Math.max(1e-3, c.masterHeight?.ratio ?? 1);
    const o = basketOrigin(c);
    if (third) {
      const m = V.getBalloon();
      m.setVisible(true);
      m.update({ x: o.x, y: o.y, z: o.z, swayRoll: state.swayRoll, swayPitch: state.swayPitch, burner: state.burner }, c.time ?? 0);
      figYaw += wrapAngle(view.rig.yaw - figYaw) * (1 - Math.exp(-FIGURE_TURN_RATE * dt));
      c.player?.update(dt, {
        x: o.x, y: o.y + BASKET_FLOOR_TOP_M / rat, z: o.z, heading: figYaw, state: 'ground', speed: 0, vx: 0, vz: 0,
        jet: false, jetLevel: 0, clock: c.time ?? 0,
      }, true);
      c.player?.shadow?.hide?.();
      V.updateScreenRect(c.camera, 'balloon', o, 0);
    } else {
      V.balloon?.setVisible(false);
      if (c.player?.visible) c.player.update(0, { x: o.x, y: o.y, z: o.z, heading: figYaw, state: 'ground', speed: 0 }, false);
      V.clearScreenRect?.();
    }
  }
  function playerStateOf(c) {
    if (!state) return null;
    const o = basketOrigin(c ?? activeCtx ?? {});
    return {
      x: o.x, y: o.y + BASKET_FLOOR_TOP_M * (c?.VE ?? 5), z: o.z, heading: figYaw, state: 'basket', speed: Math.hypot(state.vel.x, state.vel.z),
      jet: false, jetLevel: 0, underwater: false, thirdPerson: !!view?.isThirdPerson(), board: false, lean: 0, push: 0,
    };
  }
  // ── /s14:D ──
  // A tuned warp factor shows in the hint at once.
  ctx?.physics?.onChange?.((id) => { if (id === 'balloon') activeCtx?.setHint?.(null); });

  const world = (c) => ({
    VE: c.VE ?? 5,
    wind: (alt, t) => c.wind.getWindAt(alt, t),
    groundY: (x, z) => c.collision?.groundHeightAt?.(x, z) ?? c.getTerrainY?.(x, z) ?? null,
    collision: c.collision,
    waterSurfaceY: (x, z) => c.waterSurfaceAt?.(x, z) ?? null,
    // s25:C: thermal lift under cumulus, on the world clock the clouds use.
    updraft: (x, z, altM) => c.clouds?.updraftAt?.(x, z, altM, c.time) ?? 0,
  });

  function setWarp(on) {
    warpOn = !!on;
    activeCtx?.setHint?.(null); // re-render the hint with the new warp state
  }

  // Warp toggle and Space (which would otherwise press a focused HUD button).
  // Space inside the Physics panel stays the panel's own (space-key.js).
  const onKeyDown = (e) => {
    if (modeClaimsSpace(e)) e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.altKey || isFormInput(e.target)) return;
    const k = e.key?.toLowerCase?.();
    if (k === WARP_KEY && !e.repeat) { e.preventDefault(); setWarp(!warpOn); }
  };
  function listen(on) {
    if (on === listening || !globalThis.addEventListener) return;
    listening = on;
    if (on) globalThis.addEventListener('keydown', onKeyDown, true);
    else globalThis.removeEventListener('keydown', onKeyDown, true);
  }

  const mode = {
    id: 'balloon',
    label: 'Balloon',
    key: '4',
    get hint() {
      // ── s14:D ──
      if (view?.isThirdPerson()) return THIRD_WARP_HINT(warpOn, params.warp);
      // ── /s14:D ──
      const warp = warpOn ? `T time warp ×${params.warp} ON (T for real time)` : `T time warp ×${params.warp}`;
      return `E/Space burner · Q vent · drag to look · ${warp}`;
    },
    look: 'drag',
    solid: true,
    stub: false,
    params,

    activate(c) {
      activeCtx = c;
      const cam = c.camera;
      const VE = c.VE ?? 5;
      const q = cam.quaternion;
      ({ yaw, pitch } = yawPitchFromQuaternion([q.x, q.y, q.z, q.w], VE));
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      const p = cam.position;
      state = createBalloonState({ x: p.x, y: p.y, z: p.z, windTime: c.time || 0 });
      // A balloon floats in the air: surface from the ground, clay or the river.
      const w = world(c);
      const ground = w.groundY(p.x, p.z);
      const water = w.waterSurfaceY(p.x, p.z);
      const top = Math.max(Number.isFinite(ground) ? ground : -Infinity, Number.isFinite(water) ? water : -Infinity);
      if (Number.isFinite(top) && p.y < top + BASKET_EYE_M * VE) state.pos.y = top + BASKET_EYE_M * VE;
      // Aloft, a balloon already moves with the air: no lurch on entry.
      const alt = Number.isFinite(ground) ? Math.max(0, (state.pos.y - ground) / VE - BASKET_EYE_M) : 0;
      const v = windVector(w.wind(alt, state.windTime));
      state.vel.x = v.x; state.vel.z = v.z;
      cam.position.set(state.pos.x, state.pos.y, state.pos.z);
      warpOn = false;
      listen(true);
      // ── s14:D ──
      figYaw = yaw;
      if (ensureView(c)) view.activate();
      // ── /s14:D ──
    },

    deactivate(c) {
      listen(false);
      warpOn = false;
      // ── s14:D ── the view gives the lens back; the figure and the balloon go
      view?.deactivate();
      c.vehicles?.balloon?.setVisible(false);
      c.vehicles?.clearScreenRect?.();
      if (c.player?.visible) c.player.update(0, { x: 0, y: 0, z: 0, heading: figYaw, state: 'ground', speed: 0 }, false);
      // ── /s14:D ──
      applyAttitude(c.camera, yaw, pitch, 0, c.VE ?? 5); // level for Deity
      activeCtx = null;
    },

    onLook(dx, dy) {
      // ── s14:D ── third person: the drag orbits the view
      if (view?.onLook(dx, dy)) return;
      // ── /s14:D ──
      // Drag-to-look grabs the world, as Deity's orbit drag does.
      const s = params.sensitivity * DEG;
      yaw += dx * s;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * s));
    },

    update(dt, c) {
      if (!state) mode.activate(c);
      const keys = c.keys;
      const input = {
        burner: !!(keys?.has('e') || keys?.has(' ')),
        vent: !!keys?.has('q'),
        warp: warpOn ? params.warp : 1,
      };
      stepBalloon(state, input, dt, params, world(c));
      const cam = c.camera;
      // ── s14:D ── over the shoulder, or the basket's own eye (placed by the callback, today's camera)
      const firstPerson = (camera) => {
        camera.position.set(state.pos.x, state.pos.y, state.pos.z);
        applyAttitude(camera, yaw, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + state.swayPitch)),
          state.swayRoll, c.VE ?? 5);
      };
      if (view) {
        view.preUpdate();
        const rat = Math.max(1e-3, c.masterHeight?.ratio ?? 1);
        const o = basketOrigin(c);
        const pivot = { x: o.x, y: o.y + (BASKET_FLOOR_TOP_M + balloonPivotH(view.rig.wantedDistance)) / rat, z: o.z };
        view.apply(cam, dt, { pivot, snap: true, firstPerson });
        drawModels(c, dt);
      } else firstPerson(cam);
      // ── /s14:D ──
      c.sfx?.burner?.(state.burner ? 1 : 0);
      return true;
    },

    /** Test / console hooks. */
    setWarp,
    place({ x, y, z, dT, vy = 0 }) {
      if (!state) return;
      state.pos.x = x ?? state.pos.x; state.pos.y = y ?? state.pos.y; state.pos.z = z ?? state.pos.z;
      if (Number.isFinite(dT)) state.dT = dT;
      state.vy = vy; state.grounded = false;
    },
    get warp() { return warpOn; },
    debug() {
      if (!state) return null;
      return {
        pos: { ...state.pos }, vel: { ...state.vel }, vy: state.vy, heat: state.heat, dT: state.dT,
        burner: state.burner, vent: state.vent, grounded: state.grounded, scraping: state.scraping,
        windTime: state.windTime, simTime: state.simTime, altitude: state.altitude, bumps: state.bumps,
        warp: warpOn, yaw, pitch,
        // ── s14:D ──
        view: view ? view.debug() : null,
        // ── /s14:D ──
      };
    },
    // ── s14:D ── the view's test surface (lane P's names)
    isThirdPerson: () => !!view?.isThirdPerson(),
    setView: (v) => view?.setView(v),
    playerState: () => playerStateOf(activeCtx),
    get view() { return view; },
    // ── /s14:D ──
  };
  return mode;
}
