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
  applyAttitude, yawPitchFromQuaternion, verticalFovFromHorizontal,
} from './drone-camera.js';

const ARROW_RATE = 90;           // °/s of look target from the arrow keys
const ENTRY_CLEARANCE_M = 30;    // entering from underground or the river surfaces here

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
    hint: 'W thrust · mouse steer · S reverse · A/D strafe · E/Q rise/sink · Shift boost',
    look: 'lock',
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
    },

    deactivate(c) {
      const cam = c.camera;
      if (state) {
        const a = droneCameraAttitude(state);
        applyAttitude(cam, a.yaw, a.pitch, 0, c.VE ?? 5); // level the horizon for Deity
      }
      if (saved) { cam.fov = saved.fov; cam.updateProjectionMatrix(); }
      saved = null;
    },

    onLook(dx, dy) {
      if (state) droneLook(state, dx, dy, params);
    },

    update(dt, c) {
      if (!state) this.activate(c);
      const input = readInput(c.keys);
      if (input.arrowYaw || input.arrowPitch) {
        const px = ARROW_RATE * dt / Math.max(1e-6, params.sensitivity);
        droneLook(state, -input.arrowYaw * px, -input.arrowPitch * px, params);
      }
      stepDrone(state, input, dt, params, world(c));
      const cam = c.camera;
      cam.position.set(state.pos.x, state.pos.y, state.pos.z);
      const a = droneCameraAttitude(state);
      applyAttitude(cam, a.yaw, a.pitch, a.roll, c.VE ?? 5);
      applyFov(cam, state.speed);
      c.sfx?.droneWhine?.(state.speed);
      return true;
    },

    /** Test / console hook: put the drone at a pose (canonical position, real yaw / pitch), at rest. */
    place({ x, y, z, yaw, pitch }) {
      if (!state) return;
      const next = createDroneState({ x, y, z, yaw: yaw ?? state.yaw, pitch: pitch ?? state.pitch });
      Object.assign(state, next);
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
      };
    },
  };
}
