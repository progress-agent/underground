// skate-glue.js: the skateboard in the Pedestrian (sprint 14Oct26w, lane D, D-053 item 2). pedestrian.js gives this
// controller a few closures over its own state (the camera, the station contact, the hint, the sound, the card) and
// calls three things: frame() at the top of updateBody, the B key, and off() / afterPlace() at the mode's seams. All of
// the board's rules live here and in skate-body.js; pedestrian.js carries only the s14:D blocks that call this file.
//
// WHEN THE BOARD IS REFUSED OR DROPPED (skate-body.js canBoard has the reasons):
//   B to get on   water (standing in it or swimming), air, below (any phase but the street), card (a station card is
//                 open), unavailable (no vehicles module)
//   riding        B in the air is refused (air) and the board stays under the walker; rolling in deeper than wading drops
//                 it (water: it floats where it fell); a contact that opens a station card drops it (card); E drops it
//                 (use) and the on-foot frame then handles E the same frame; a mode switch, a new activation, or a tunnel
//                 placement drops it (mode, phase); place() keeps it on dry ground and drops it into water.
//
// FIRST USE. The board's model is fetched the first time B is pressed (a cold load fetches no extra model): B then sets
// `pending`, and the board goes on when it has arrived, if the walker is still eligible.
import { SKATE, createSkate, stepSkate, canBoard } from './skate-body.js';
import { registerSkatePose } from '../vehicles/skate-pose.js';
import { BODY } from './pedestrian-body.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export const BOARD_HINT = 'Skateboard · W push · S brake · A/D steer · Space ollie · Shift faster · B steps off';
const REFUSAL_TEXT = Object.freeze({
  water: 'No skateboarding in the water',
  air: 'Land first, then B',
  below: 'The skateboard is for the street',
  card: 'Close the station card first',
  unavailable: 'No skateboard in this build',
});
const REFUSAL_HINT_S = 2;
const FLOAT_HIDE_M = 60;            // a board left floating is hidden once the walker is this far from it
const FACING_RATE = 14;             // /s, how fast the figure turns to stand across the board
const FOLLOW_AFTER_S = 1.6;         // the camera eases behind the travel after this long without a drag ...
const FOLLOW_MIN_MPS = 1.5;         // ... above this speed ...
const FOLLOW_RATE = 1.1;            // ... at this rate (/s)

/**
 * @param {object} o
 * @param {object} o.ctx    the shared mode context (vehicles, player, physics, keys, collision)
 * @param {object} o.body   the walker's body
 * @param {object} o.P      the pedestrian tunables
 * @param {number} o.VE
 * @param {object} o.K      the board's tunables (the Physics panel's "Skateboard" section)
 * @param {object} o.world  the pedestrian's world (moveAndSlide, standHeightAt, waterAt)
 * @param {object} o.hooks  closures over pedestrian.js: placeCamera(x, y, z), contactStep(px, pz), hint(text), sound(v),
 *                          setEvents(array), card(), phase(), holdBox(), setHeld(bool), figureHeading(), lookYaw(), onFoot
 */
export function createBoardController({ ctx, body, P, VE, K, world, hooks }) {
  const sk = createSkate();
  const poseParams = { push: 0, pushPhase: 0, tuck: 0 };
  let floating = null;                    // { x, y, z, heading } a board dropped into the water
  let refusedAt = -Infinity, refusedText = null;
  let poseFigure = null;
  const state = { on: false, facing: 0, liftM: 0, rootRoll: 0, lean: 0, push: 0, pushPhase: 0, heading: 0 };

  const vehicles = () => ctx.vehicles ?? null;
  const clock = () => ctx.time ?? 0;

  function refuse(reason) {
    sk.refused = reason;
    refusedAt = clock();
    refusedText = REFUSAL_TEXT[reason] ?? reason;
    hooks.hint(refusedText);
  }

  function ensurePose() {
    const fig = ctx.player?.figure ?? null;
    if (fig && poseFigure !== fig) {
      registerSkatePose(fig, ctx.THREE, poseParams);
      poseFigure = fig;
    }
    return fig;
  }
  function setPoseTarget(w) {
    const fig = ctx.player?.figure ?? null;
    if (fig && poseFigure === fig) fig.setPoseOverride('skate', w);
  }

  function inWater() { return !!ctx.collision.waterAt(body.x, body.z) || body.state === 'swim'; }
  function eligibility() {
    return canBoard({
      phase: hooks.phase(), state: body.state, inWater: inWater(), cardOpen: !!hooks.card(), unavailable: !vehicles(),
    });
  }

  function placeModel() {
    const b = vehicles()?.board;
    if (!b) return;
    b.update({ x: body.x, y: body.y, z: body.z, heading: sk.heading, lean: sk.lean, airT: sk.airT });
    b.setVisible(true);
  }
  function hideModel() { vehicles()?.board?.setVisible(false); }

  function stepOn() {
    const h0 = hooks.figureHeading();      // read before the board is on: it answers with the board's facing once it is
    sk.on = true; sk.pending = false; sk.refused = null; sk.lastDrop = null;
    sk.heading = h0;
    const fx = -Math.sin(sk.heading), fz = -Math.cos(sk.heading);
    sk.v = Math.max(0, body.vx * fx + body.vz * fz);
    sk.lean = 0; sk.push = 0; sk.pushT = 0; sk.pushPhase = 0; sk.tuck = 0; sk.airT = 0;
    sk.facing = h0;
    floating = null;
    ensurePose();
    setPoseTarget(1);
    placeModel();
  }

  function tryOn() {
    const reason = eligibility();
    if (reason) { refuse(reason); return reason; }
    sk.refused = null;
    if (!vehicles().boardLoaded) {
      if (vehicles().boardStatus === 'failed') { refuse('unavailable'); return 'unavailable'; }
      sk.pending = true;
      vehicles().loadBoard();
      return null;
    }
    stepOn();
    return null;
  }

  /** Step off (or drop) the board. `reason` is kept in lastDrop. */
  function off(reason) {
    sk.pending = false;
    if (!sk.on) return;
    sk.on = false;
    finishOff(reason);
  }

  /** What follows the board coming off (sk.on is already false): the walker's pace, the pose, the model. */
  function finishOff(reason) {
    sk.lastDrop = reason;
    // the walker keeps the way it was going, at no more than a run
    const hs = Math.hypot(body.vx, body.vz);
    if (hs > P.speed) { body.vx *= P.speed / hs; body.vz *= P.speed / hs; }
    sk.v = 0; sk.push = 0; sk.pushT = 0; sk.pushPhase = 0; sk.tuck = 0; sk.lean = 0; sk.airT = 0;
    setPoseTarget(0);
    if (reason === 'water') {
      const w = ctx.collision.waterAt(body.x, body.z);
      const surface = Number.isFinite(w?.surfaceY) ? w.surfaceY : body.y;
      floating = { x: body.x, y: surface, z: body.z, heading: sk.heading };
      const b = vehicles()?.board;
      if (b) { b.update({ x: floating.x, y: floating.y, z: floating.z, heading: floating.heading, lean: 0, airT: 0 }); b.setVisible(true); }
    } else hideModel();
  }

  function figureView() {
    state.on = sk.on;
    state.facing = sk.facing;
    state.liftM = sk.on ? SKATE.deckTopM : 0;
    state.rootRoll = -sk.lean;
    state.lean = sk.lean;
    state.push = sk.push;
    state.pushPhase = sk.pushPhase;
    state.heading = sk.heading;
    return state;
  }

  function followCamera(dt) {
    const f = hooks.onFoot;
    if (!f?.isThirdPerson?.()) return;
    const speed = Math.hypot(body.vx, body.vz);
    if (speed < FOLLOW_MIN_MPS || f.sinceOrbit() < FOLLOW_AFTER_S) return;
    const rig = f.rig;
    rig.yaw += wrap(sk.heading - rig.yaw) * (1 - Math.exp(-FOLLOW_RATE * dt));
  }

  function tickFloating() {
    if (!floating) return;
    if (Math.hypot(body.x - floating.x, body.z - floating.z) > FLOAT_HIDE_M) { floating = null; hideModel(); }
  }

  const api = {
    /** The B key (pedestrian.js binds it while the mode is active). */
    press() {
      if (sk.on) {
        if (body.state !== 'ground') { refuse('air'); return 'air'; }
        off('key');
        return null;
      }
      return tryOn();
    },
    /** The test surface: put the board on or off. Returns the reason it was refused, or null. */
    set(on) {
      if (on) { if (sk.on) return null; return tryOn(); }
      off('set');
      return null;
    },
    off,

    /**
     * Once per body frame, at the top of updateBody. Returns true when the board handled the frame (the on-foot step is
     * skipped); false leaves the frame to the on-foot code.
     */
    frame(dt, use, jump) {
      ensurePose();
      if (sk.pending) {
        if (vehicles()?.boardLoaded) {
          const reason = eligibility();
          if (reason) { sk.pending = false; refuse(reason); } else stepOn();
        } else if (vehicles()?.boardStatus === 'failed') { sk.pending = false; refuse('unavailable'); }
      }
      if (!sk.on) { tickFloating(); return false; }
      if (use) { off('use'); return false; }

      const k = ctx.keys;
      const px = body.x, pz = body.z;
      const input = {
        forward: (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0),
        steer: (k.has('a') || k.has('arrowleft') ? 1 : 0) - (k.has('d') || k.has('arrowright') ? 1 : 0),
        shift: k.has('shift'),
        ollie: !!jump,
      };
      const events = [];
      stepSkate(sk, body, input, dt, world, P, VE, events, K);
      hooks.setEvents(events);
      // the soft hold at the walk bounds, as the on-foot frame has it
      let held = false;
      const box = hooks.holdBox();
      if (box) {
        if (body.x < box.minX) { body.x = box.minX; if (body.vx < 0) body.vx = 0; held = true; }
        else if (body.x > box.maxX) { body.x = box.maxX; if (body.vx > 0) body.vx = 0; held = true; }
        if (body.z < box.minZ) { body.z = box.minZ; if (body.vz < 0) body.vz = 0; held = true; }
        else if (body.z > box.maxZ) { body.z = box.maxZ; if (body.vz > 0) body.vz = 0; held = true; }
      }
      hooks.setHeld(held);

      if (!sk.on) {
        // the river took the board (stepSkate says so): it floats where it fell, the walker swims
        finishOff('water');
        hooks.placeCamera(body.x, body.y + P.eye * VE, body.z);
        hooks.sound(0);
        return true;
      }

      const faceTo = sk.heading - Math.PI / 2;
      sk.facing = faceTo + wrap(sk.facing - faceTo) * Math.exp(-FACING_RATE * dt);
      hooks.placeCamera(body.x, body.y + (P.eye + SKATE.deckTopM) * VE, body.z);
      // ── s14:I ── the rider is held to the on-foot frame's rules from lane S: a deck's or a tower's underside is a
      // ceiling (an ollie stops under it), and on a station roof the touch rule (push, card) does not apply, because
      // the rider is above the wall, not at it. Without the guard the rider was pushed 14 m out of King's Cross's
      // footprint and dropped off the roof.
      const ceil = ctx.collision.ceilingAt ? ctx.collision.ceilingAt(body.x, body.z, body.y) : null;
      if (ceil !== null && body.vy > 0 && body.y + (P.eye + SKATE.deckTopM + BODY.headroom) * VE > ceil) {
        body.y = ceil - (P.eye + SKATE.deckTopM + BODY.headroom) * VE; body.vy = 0;
      }
      const onRoof = !!(ctx.collision.onStationRoof && ctx.collision.onStationRoof(body.x, body.z, body.y));
      // ── /s14:I ──
      if (!onRoof) hooks.contactStep(px, pz); // s14:I (roof guard)
      if (hooks.card()) { off('card'); return true; }

      // the figure's pose reads these
      poseParams.push = sk.push; poseParams.pushPhase = sk.pushPhase; poseParams.tuck = sk.tuck;
      setPoseTarget(1);
      placeModel();
      followCamera(dt);
      hooks.hint(BOARD_HINT);
      hooks.sound(body.state === 'ground' ? Math.hypot(body.vx, body.vz) : 0);
      return true;
    },

    /** After the frame's phase code: a refusal's hint stays for REFUSAL_HINT_S (the on-foot hint would erase it). */
    post() {
      if (refusedText && clock() - refusedAt < REFUSAL_HINT_S) hooks.hint(refusedText);
      else if (refusedText) refusedText = null;
    },

    /** place() teleported the walker: the board stays on dry ground, at rest, and is dropped into the water. */
    afterPlace() {
      if (!sk.on) return;
      if (body.state === 'swim') { off('water'); return; }
      sk.heading = hooks.lookYaw();
      sk.facing = sk.heading - Math.PI / 2;
      sk.v = 0; sk.lean = 0; sk.push = 0; sk.pushT = 0; sk.tuck = 0; sk.airT = 0;
      placeModel();
    },

    figureState: figureView,
    get on() { return sk.on; },
    get pending() { return sk.pending; },
    debug() {
      return {
        on: sk.on, pending: sk.pending, v: sk.v, heading: sk.heading, lean: sk.lean, push: sk.push, pushPhase: sk.pushPhase,
        tuck: sk.tuck, airT: sk.airT, refused: sk.refused, lastDrop: sk.lastDrop, floating: floating ? { ...floating } : null,
      };
    },
  };
  return api;
}
