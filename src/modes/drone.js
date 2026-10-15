// drone.js: Drone conveyance mode (sprint 23Sep26w, D-037, lane A3).
//
// The FPV drone PERSPECTIVE on keyboard and mouse/trackpad (Jordan: "no
// gamepad ... reproducing the perspective of an fpv drone, with whatever
// controls are most intuitive for keyboard and trackpad/mouse"):
//
//   W thrust along the view · S reverse · A/D strafe · E/Space rise · Q sink
//   Shift boost · mouse steers through pointer lock (click the view; Esc frees)
//   arrows nudge the look for a trackpad without a lock.
//
// ~110° horizontal FOV (widening a little with speed), bank into turns and
// forward pitch with speed derived from the motion, momentum with overshoot,
// gravity-free hover when idle, bounce-and-wobble off buildings, rotor whine
// from speed. The flight model is drone-physics.js (pure, node-tested); this
// file only wires it to the shared mode context (src/modes/index.js).

import {
  DRONE_TUNABLES, DRONE_DEFAULTS, createDroneState, stepDrone, droneLook,
  droneHorizontalFov, droneCameraAttitude,
} from './drone-physics.js';
import {
  applyAttitude, yawPitchFromQuaternion, verticalFovFromHorizontal, wrapNear,
} from './drone-camera.js';
import { createSpaceGuard } from './space-key.js';
// ── s14:D ── the Drone seen from outside (D-053 items 2 and 3): its over-the-shoulder view (vehicle-view.js)
import { createVehicleView } from '../vehicles/vehicle-view.js';
// ── /s14:D ──

const ARROW_RATE = 90;           // °/s of look target from the arrow keys
const ENTRY_CLEARANCE_M = 30;    // entering from underground or the river surfaces here
// ── s14:D ──
const ARROW_ORBIT_PX_S = 314;    // the arrows turn the third-person view at 90 degrees a second (rig.orbit's 0.005 rad a px)
const THIRD_HINT = 'W thrust · drag to turn the view · scroll to zoom · S reverse · A/D strafe · E/Q rise/sink · Shift boost · V first person';
// ── /s14:D ──

function readInput(keys) {
  const has = (k) => keys?.has(k);
  return {
    thrust: (has('w') ? 1 : 0) - (has('s') ? 1 : 0),
    strafe: (has('d') ? 1 : 0) - (has('a') ? 1 : 0),
    lift: (has('e') || has(' ') ? 1 : 0) - (has('q') ? 1 : 0),
    boost: has('shift'),
    arrowYaw: (has('arrowleft') ? 1 : 0) - (has('arrowright') ? 1 : 0),
    arrowPitch: (has('arrowup') ? 1 : 0) - (has('arrowdown') ? 1 : 0),
  };
}

/**
 * @param {object} ctx shared mode context (see src/modes/index.js)
 * @returns {object} a mode object (see src/modes/registry.js)
 */
export function createDroneMode(ctx) {
  const params = ctx?.physics?.register
    ? ctx.physics.register('drone', 'Drone', DRONE_TUNABLES)
    : { ...DRONE_DEFAULTS };
  let state = null;
  let saved = null;
  // ── s14:D ── the Drone is drawn from over its shoulder (default) or flown from its own camera (V). Without
  // ctx.vehicles (node tests, a build without the models) everything below is today's first person.
  let view = null;
  function ensureView(c) {
    if (!view && c?.vehicles) {
      view = createVehicleView({
        ctx: c, row: 'drone', loaded: () => true, firstLook: 'lock', transitionS: 0.6,
        firstFov: () => (state && c.camera ? verticalFovFromHorizontal(droneHorizontalFov(state.speed, params), c.camera.aspect) : null),
        onChange: ({ effective, rig }) => { if (effective === 'third' && state) rig.reset({ yaw: state.yaw }); },
      });
    }
    return view;
  }
  /** The drone's model for the frame (third person only), its attitude from the flight state, and the names' rectangle. */
  function drawModel(c) {
    const V = c.vehicles;
    if (!V || !state) return;
    if (!view?.isThirdPerson()) { V.drone?.setVisible(false); V.clearScreenRect?.(); return; }
    const m = V.getDrone();
    m.setVisible(true);
    m.update({ x: state.pos.x, y: state.pos.y, z: state.pos.z, yaw: state.yaw, pitch: -state.dip + state.wobPitch, roll: state.bank + state.wobRoll }, c.time ?? 0);
    V.updateScreenRect(c.camera, 'drone', state.pos, state.yaw);
  }
  /** Whether a canonical point is inside a building's box (footprint and height). */
  function insideBox(collision, p) {
    for (const b of collision.buildingsNear(p.x, p.z, 0.5)) {
      if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y > b.baseY && p.y < b.roofY) return true;
    }
    return false;
  }
  function playerStateOf() {
    if (!state) return null;
    return {
      x: state.pos.x, y: state.pos.y, z: state.pos.z, heading: state.yaw, state: 'drone', speed: state.speed,
      jet: false, jetLevel: 0, underwater: false, thirdPerson: !!view?.isThirdPerson(), board: false, lean: 0, push: 0,
    };
  }
  // ── /s14:D ──
  // Space is rise here: while Drone is active it must not also press the
  // button that kept focus after a click (sprint 24Sep26h, lane H).
  const spaceGuard = createSpaceGuard();

  const world = (c) => ({
    VE: c.VE ?? 5,
    collision: c.collision,
    waterSurfaceY: (x, z) => c.waterSurfaceAt?.(x, z) ?? null,
  });

  function applyFov(camera, speed) {
    const v = verticalFovFromHorizontal(droneHorizontalFov(speed, params), camera.aspect);
    if (Math.abs(camera.fov - v) > 1e-4) {
      camera.fov = v;
      camera.updateProjectionMatrix();
    }
  }

  return {
    id: 'drone',
    label: 'Drone',
    key: '3',
    // ── s14:D ── third person is a drag look; first person is today's pointer lock
    get hint() { return view?.isThirdPerson() ? THIRD_HINT : 'W thrust · mouse steer · S reverse · A/D strafe · E/Q rise/sink · Shift boost'; },
    get look() { return view ? view.lookMode() : (ctx?.vehicles ? 'drag' : 'lock'); },
    // ── /s14:D ──
    solid: true,
    stub: false,
    params,

    activate(c) {
      const cam = c.camera;
      const VE = c.VE ?? 5;
      saved = { fov: cam.fov };
      const q = cam.quaternion;
      const { yaw, pitch } = yawPitchFromQuaternion([q.x, q.y, q.z, q.w], VE);
      const p = cam.position;
      state = createDroneState({ x: p.x, y: p.y, z: p.z, yaw, pitch });
      // A drone flies in the air: surface from the ground, clay or the river.
      const ground = c.collision?.groundHeightAt?.(p.x, p.z) ?? c.getTerrainY?.(p.x, p.z) ?? null;
      const water = c.waterSurfaceAt?.(p.x, p.z);
      const top = Math.max(Number.isFinite(ground) ? ground : -Infinity, Number.isFinite(water) ? water : -Infinity);
      if (Number.isFinite(top) && p.y < top) state.pos.y = top + ENTRY_CLEARANCE_M * VE;
      cam.position.set(state.pos.x, state.pos.y, state.pos.z);
      spaceGuard.set(true);
      // ── s14:D ──
      if (ensureView(c)) view.activate();
      // ── /s14:D ──
    },

    deactivate(c) {
      spaceGuard.set(false);
      const cam = c.camera;
      // ── s14:D ── the view first (it gives the lens back), the model away
      view?.deactivate();
      c.vehicles?.drone?.setVisible(false);
      c.vehicles?.clearScreenRect?.();
      // ── /s14:D ──
      if (state) {
        const a = droneCameraAttitude(state);
        applyAttitude(cam, a.yaw, a.pitch, 0, c.VE ?? 5); // level the horizon for Deity
      }
      if (saved) { cam.fov = saved.fov; cam.updateProjectionMatrix(); }
      saved = null;
    },

    onLook(dx, dy) {
      // ── s14:D ── third person: the drag orbits the view
      if (view?.onLook(dx, dy)) return;
      // ── /s14:D ──
      if (state) droneLook(state, dx, dy, params);
    },

    update(dt, c) {
      if (!state) this.activate(c);
      const input = readInput(c.keys);
      // ── s14:D ── V, and in third person the view is the rig's: the arrows orbit it and the drone turns to fly where the
      // camera faces (one master for the view, as on foot), level (E/Space rise, Q sinks); the flight model is untouched.
      view?.preUpdate();
      const third = !!view?.isThirdPerson();
      if (third) {
        if (input.arrowYaw || input.arrowPitch) view.rig.orbit(-input.arrowYaw * ARROW_ORBIT_PX_S * dt, -input.arrowPitch * ARROW_ORBIT_PX_S * dt);
        state.targetYaw = wrapNear(view.rig.yaw, state.yaw);
        state.targetPitch = 0;
        input.arrowYaw = 0; input.arrowPitch = 0;      // the arrows turned the view, not the drone's look target
      }
      // ── /s14:D ──
      if (input.arrowYaw || input.arrowPitch) {
        const px = ARROW_RATE * dt / Math.max(1e-6, params.sensitivity);
        droneLook(state, -input.arrowYaw * px, -input.arrowPitch * px, params);
      }
      // ── s14:D ── never into a building the drone was not in. The flight model lets a body pass through a box whose
      // footprint (grown by the drone's 1.5 m radius) it starts inside, which a drone placed in a narrow street does; seen
      // from outside that is a drone, and a camera, inside a facade.
      const s14dPrev = { x: state.pos.x, y: state.pos.y, z: state.pos.z };
      // ── /s14:D ──
      stepDrone(state, input, dt, params, world(c));
      // ── s14:D ──
      if (c.collision?.buildingsNear && insideBox(c.collision, state.pos) && !insideBox(c.collision, s14dPrev)) {
        state.pos.x = s14dPrev.x; state.pos.z = s14dPrev.z; state.vel.x = 0; state.vel.z = 0;
      }
      // ── /s14:D ──
      const cam = c.camera;
      // ── s14:D ── the camera: over the shoulder, or today's drone camera (placed by the callback)
      const firstPerson = (camera) => {
        camera.position.set(state.pos.x, state.pos.y, state.pos.z);
        const a = droneCameraAttitude(state);
        applyAttitude(camera, a.yaw, a.pitch, a.roll, c.VE ?? 5);
        if (!view?.isThirdPerson() && !view?.debug().transition) applyFov(camera, state.speed);
      };
      if (view) {
        view.apply(cam, dt, { pivot: state.pos, snap: true, firstPerson });
        drawModel(c);
      } else firstPerson(cam);
      // ── /s14:D ──
      c.sfx?.droneWhine?.(state.speed);
      return true;
    },

    /** Test / console hook: put the drone at a pose (canonical position, real yaw / pitch), at rest. */
    place({ x, y, z, yaw, pitch }) {
      if (!state) return;
      const next = createDroneState({ x, y, z, yaw: yaw ?? state.yaw, pitch: pitch ?? state.pitch });
      Object.assign(state, next);
      // ── s14:D ── in third person the rig stands behind the new heading, with no blend
      if (view?.isThirdPerson()) view.reset({ yaw: state.yaw });
      // ── /s14:D ──
    },

    /** Test / console hook: a snapshot of the flight state. */
    debug() {
      if (!state) return null;
      const a = droneCameraAttitude(state);
      return {
        pos: { ...state.pos }, vel: { ...state.vel }, speed: state.speed,
        yaw: state.yaw, pitch: state.pitch, targetYaw: state.targetYaw, yawRate: state.yawRate,
        bank: state.bank, dip: state.dip, roll: a.roll, cameraPitch: a.pitch,
        hits: state.hits, lastImpact: state.lastImpact, wobRoll: state.wobRoll, wobPitch: state.wobPitch,
        // ── s14:D ──
        view: view ? view.debug() : null,
        // ── /s14:D ──
      };
    },
    // ── s14:D ── the view's test surface (lane P's names): third person, V, and the state the other modes read
    isThirdPerson: () => !!view?.isThirdPerson(),
    setView: (v) => view?.setView(v),
    playerState: () => playerStateOf(),
    get view() { return view; },
    // ── /s14:D ──
  };
}
