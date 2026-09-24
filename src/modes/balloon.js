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

const DEG = Math.PI / 180;
const PITCH_LIMIT = 85 * DEG;
export const WARP_KEY = 't';

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
  // A tuned warp factor shows in the hint at once.
  ctx?.physics?.onChange?.((id) => { if (id === 'balloon') activeCtx?.setHint?.(null); });

  const world = (c) => ({
    VE: c.VE ?? 5,
    wind: (alt, t) => c.wind.getWindAt(alt, t),
    groundY: (x, z) => c.collision?.groundHeightAt?.(x, z) ?? c.getTerrainY?.(x, z) ?? null,
    collision: c.collision,
    waterSurfaceY: (x, z) => c.waterSurfaceAt?.(x, z) ?? null,
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
    },

    deactivate(c) {
      listen(false);
      warpOn = false;
      applyAttitude(c.camera, yaw, pitch, 0, c.VE ?? 5); // level for Deity
      activeCtx = null;
    },

    onLook(dx, dy) {
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
      cam.position.set(state.pos.x, state.pos.y, state.pos.z);
      applyAttitude(cam, yaw, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + state.swayPitch)),
        state.swayRoll, c.VE ?? 5);
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
      };
    },
  };
  return mode;
}
