// on-foot.js: the Pedestrian's third-person view (sprint 14Oct26w, lane P, D-053 items 2 to 4). The binding
// between pedestrian.js and src/player/: it decides the view (view-rules.js), steers the camera rig
// (camera-rig.js), draws the figure (index.js) and keeps the lens, the look input and the HUD in step.
//
// THE FLOW, once a frame (pedestrian.js calls the four hooks from `update`):
//   preUpdate   V is applied; in third person the walker's yaw/pitch are the RIG's, so W/A/S/D move relative
//               to the camera (and a swimmer follows the view)
//   (the mode's own phase update runs; it places the FIRST-PERSON camera)
//   postUpdate  in third person the rig overwrites the camera, the figure is posed and drawn, flames, shadow
//               and the screen rectangle are updated; in first person the figure is hidden
//
// THE VIEW (view-rules.js): third person above ground once the figure has loaded; first person before, in
// shafts, tunnels, transfers, steps and the whole open-air ride, whatever V says. Every change of view blends
// the camera (and the lens) from the pose it had to the live target, easeOutCubic.
//
// LOOK: third person uses ctx.look 'drag' (the cursor is free, a drag orbits); first person keeps pointer
// lock. The lens is 22 mm in third person and the player's own (the HUD slider's value) otherwise; it is set
// through ctx.lens, which keeps the camera where it is (lens.js setFocalLength dollies it towards a stale
// OrbitControls target, hundreds of metres away from a walker).
import { createViewRules, allowsThirdIn } from './view-rules.js';
import { createCameraRig } from './camera-rig.js';
import { LENS_THIRD_MM, BLEND_S, easeOutCubic, installViewKey, installWheelZoom } from './third-person.js';
// ── s16:T ── a camera against a wall lowers its near plane for those frames only (near-clearance.js)
import { createClearanceProbe, cornerFactor, nearForWall, NEAR_FLOOR, NEAR_FLOOR_CAMERA, CAMERA_PROBE_RADIUS_M } from './near-clearance.js';
import { BODY } from '../modes/pedestrian-body.js';
// ── /s16:T ──

const TAU = Math.PI * 2;
const HEADING_RATE = 14;       // /s, how fast the figure turns towards its velocity
const HEADING_MIN_MPS = 0.4;   // below this the figure keeps its heading
const BLEND_CUT_M = 8;         // a view change that moves the camera farther than this is a cut, not a blend
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createOnFoot({ ctx, body, P, VE, getPhase, getRegime, look }) {
  const { THREE } = ctx;
  void VE; void getRegime;
  const rules = createViewRules();
  const ratio = () => ctx.masterHeight?.ratio ?? 1;
  const rig = createCameraRig({
    THREE, ratio,
    lineOfSight: (a, b, o) => (typeof ctx.collision?.lineOfSight === 'function' ? ctx.collision.lineOfSight(a, b, o) : null),
    groundY: (x, z) => ctx.collision?.groundHeightAt(x, z) ?? null,
    waterY: (x, z) => ctx.collision?.waterAt(x, z)?.surfaceY ?? null,
  });

  // ── s16:T ── T-near (D-054): the wall distance round the eye (first person) or round the pulled-in camera (third)
  const s16tColl = { moveAndSlide: (pos, delta, o) => ctx.collision.moveAndSlide(pos, delta, o) };   // ctx.collision is wired after this is built
  const s16tProbe = createClearanceProbe({ collision: s16tColl, VE });
  const s16tCam = createClearanceProbe({ collision: s16tColl, VE });
  const s16tBandEye = { feetY: 0, height: 0, radius: 0, hosts: null }, s16tBandCam = { feetY: 0, height: 0, radius: 0, hosts: null };   // reused every frame
  /** The near plane a wall within reach of `cam` allows, or null when nothing is within reach. */
  let s16tHostsOf = null, s16tHosts = null, s16tHostsAt = -1e9;   // the station hosts' squares (raised boxes the collision band passes under), per index
  function s16tClearNear(cam, probe, band, floor = NEAR_FLOOR) {
    if (typeof ctx.collision?.moveAndSlide !== 'function') return null;
    // the getter builds a small facade object per call, so ask for the data index only until it exists and then every 5 s (a swap is still seen)
    if (s16tHostsOf === null || (ctx.time ?? 0) - s16tHostsAt > 5) {
      s16tHostsAt = ctx.time ?? 0;
      const idx = ctx.stationBuildings?.()?.index;   // station-buildings.js: the data index (the facade also holds the meshes)
      if (idx && idx !== s16tHostsOf) { s16tHostsOf = idx; s16tHosts = (idx.buildings || []).filter((b) => b.host).map((b) => b.host); }
    }
    band.hosts = s16tHosts;
    const wall = probe.measure(cam.position.x, cam.position.y, cam.position.z, band);
    if (wall === null) return null;
    return nearForWall(wall, cornerFactor(cam.fov, cam.aspect), { floor });
  }
  // ── /s16:T ──

  let active = false;
  let effective = 'first';
  let heading = 0;
  let blend = null;                       // { t, dur, fromPos, fromQuat, fromMm, toMm }
  let snapPending = false;
  const sync = { yaw: 0, pitch: 0 };      // what the rig last wrote into the walker's yaw/pitch
  const lastFinal = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), mm: null };
  const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion();

  // ── s14:D ── the skateboard (lane D, D-053 item 2): a source of { on, facing, liftM, rootRoll, lean, push, ... } the
  // Pedestrian's board controller supplies; null until it does. While it says `on` the rig has its own row, the figure
  // stands sideways on the deck, and the camera eases round behind the travel (the controller drives that).
  let s14dBoardSource = null, s14dLastOrbitT = -1e9;
  // ── /s14:D ──
  const lens = () => ctx.lens ?? null;
  const preferredMm = () => lens()?.preferred?.() ?? 30;
  const targetMm = (view) => (view === 'third' ? LENS_THIRD_MM : preferredMm());

  function captureFinal() {
    lastFinal.pos.copy(ctx.camera.position);
    lastFinal.quat.copy(ctx.camera.quaternion);
    lastFinal.mm = lens()?.get?.() ?? null;
  }

  function startBlend(dur, view, cut = true) {
    blend = { t: 0, dur: Math.max(1e-3, dur), fromPos: lastFinal.pos.clone(), fromQuat: lastFinal.quat.clone(),
      fromMm: lastFinal.mm, toMm: targetMm(view), cut };
  }

  function applyLook() {
    ctx.look?.setMode?.(effective === 'third' ? 'drag' : 'lock');
    ctx.refreshHud?.();
  }

  function playerLoaded() { return !!ctx.player?.loaded; }

  /** Recompute the effective view; on a change start the blend and switch the look input. */
  function evaluate(why = null) {
    const phase = getPhase();
    const r = rules.update({ loaded: playerLoaded(), allowsThird: allowsThirdIn(phase) });
    if (r.effective === effective) return;
    effective = r.effective;
    const dur = why === 'activate' ? Math.max(0.1, P.easeTime ?? 1) : r.auto ? BLEND_S.auto : (why === 'key' ? BLEND_S.key : BLEND_S.forced);
    if (effective === 'third' && why !== 'activate') {
      // from first person: the rig takes the view the walker had
      const cur = look.get();
      rig.reset({ yaw: cur.yaw, pitch: clamp(cur.pitch, -1.2, 0.7) });
      snapPending = true;
    }
    if (why === 'instant') {
      // the test surface (setView): no blend, the lens at once
      blend = null;
      const l = lens();
      if (l && Math.abs((l.get() ?? 0) - targetMm(effective)) > 1e-6) l.set(targetMm(effective));
    } else startBlend(dur, effective, why !== 'activate');
    applyLook();
  }

  const offKey = installViewKey({ isActive: () => active, onPress: () => { rules.press(); evaluate('key'); } });
  const offWheel = installWheelZoom({
    canvas: ctx.canvas, isActive: () => active, isThird: () => active && effective === 'third', zoom: (f) => rig.zoom(f),
  });
  void offKey; void offWheel;

  function figureState() {
    // ── s14:D ── on the board: the figure stands sideways on the deck, at rest as far as its clip is concerned
    const s14dB = s14dBoardSource?.();
    if (s14dB?.on) {
      return {
        x: body.x, y: body.y, z: body.z, heading: s14dB.facing, state: 'ground', speed: 0, vx: 0, vz: 0,
        jet: false, jetLevel: 0, clock: ctx.time ?? 0, liftM: s14dB.liftM, rootRoll: s14dB.rootRoll,
      };
    }
    // ── /s14:D ──
    // the clip follows the HORIZONTAL speed: a swimmer at rest sinks slowly, and that is still "idle"
    return {
      x: body.x, y: body.y, z: body.z, heading, state: body.state, speed: Math.hypot(body.vx, body.vz), vx: body.vx, vz: body.vz,
      jet: !!body.jet, jetLevel: body.jetLevel ?? (body.jet ? 1 : 0), clock: ctx.time ?? 0,
    };
  }

  function underwater() {
    return !!ctx.isSubmergedAt?.(body.x, body.y + 1.6 / Math.max(1e-3, ratio()), body.z);
  }

  function stepHeading(dt) {
    if (effective === 'third') {
      const hs = Math.hypot(body.vx, body.vz);
      if (hs > HEADING_MIN_MPS) {
        const target = Math.atan2(-body.vx, -body.vz);
        heading = wrap(heading + wrap(target - heading) * (1 - Math.exp(-HEADING_RATE * dt)));
      }
    } else {
      heading = look.get().yaw;
    }
  }

  const api = {
    activate() {
      active = true;
      effective = 'first';
      blend = null;
      const cur = look.get();
      heading = cur.yaw;
      rules.reset(playerLoaded());
      rig.reset({ yaw: cur.yaw });
      snapPending = true;
      sync.yaw = cur.yaw; sync.pitch = cur.pitch;
      captureFinal();
      evaluate('activate');
      if (effective === 'third') { look.set(rig.yaw, rig.pitch); sync.yaw = rig.yaw; sync.pitch = rig.pitch; }
      applyLook();
    },

    deactivate() {
      active = false;
      effective = 'first';
      blend = null;
      ctx.player?.update(0, figureState(), false);
      const l = lens();
      if (l && Math.abs((l.get() ?? 0) - preferredMm()) > 1e-6) l.set(preferredMm());
    },

    /** A look delta from the pointer. True when the rig took it (third person). */
    onLook(dx, dy) {
      if (!active || effective !== 'third') return false;
      rig.orbit(dx, dy);
      return true;
    },

    preUpdate(dt) {
      void dt;
      if (!active) return;
      evaluate();
      if (effective !== 'third') return;
      const cur = look.get();
      if (cur.yaw !== sync.yaw) rig.yaw = cur.yaw;           // placed or turned from outside (tests, place())
      if (cur.pitch !== sync.pitch) rig.pitch = cur.pitch;
      look.set(rig.yaw, rig.pitch);
      sync.yaw = rig.yaw; sync.pitch = rig.pitch;
    },

    postUpdate(dt) {
      if (!active) return;
      evaluate();
      const cam = ctx.camera;
      stepHeading(dt);
      const st = figureState();
      const phase = getPhase();
      const show = effective === 'third' && allowsThirdIn(phase);
      if (show) {
        rig.setBody(body.state === 'swim' ? 'swim' : 'foot');
        // ── s14:D ── riding: the board's own camera row
        if (s14dBoardSource?.()?.on) rig.setBody('skate');
        // ── /s14:D ──
        rig.follow(body, dt, { snap: snapPending, underwater: underwater() });
        snapPending = false;
        rig.pose(tPos, tQuat);
      } else {
        tPos.copy(cam.position); tQuat.copy(cam.quaternion);   // the first-person pose the mode just placed
      }
      let mm = null;
      // A teleport (placeInTunnel, place, a cut at a tunnel mouth) is not blended: a camera that jumped farther
      // than BLEND_CUT_M from where the view had it is cut to, never swept through the ground. The activation
      // blend (from wherever Deity left the camera) is the one blend that is long by design.
      if (blend && blend.cut && blend.t === 0) {
        const dx = tPos.x - blend.fromPos.x, dz = tPos.z - blend.fromPos.z, dy = (tPos.y - blend.fromPos.y) * ratio();
        if (Math.hypot(dx, dy, dz) > BLEND_CUT_M) {
          const toMm = blend.toMm;
          blend = null;
          if (lens() && Math.abs((lens().get() ?? 0) - toMm) > 1e-4) lens().set(toMm);
        }
      }
      if (blend) {
        blend.t += dt;
        const k = Math.min(1, blend.t / blend.dur), e = easeOutCubic(k);
        tPos.lerpVectors(blend.fromPos, tPos, e);
        tQuat.slerpQuaternions(blend.fromQuat, tQuat, e);
        if (blend.fromMm !== null) mm = blend.fromMm + (blend.toMm - blend.fromMm) * e;
        else mm = blend.toMm;
        if (k >= 1) { mm = blend.toMm; blend = null; }
      }
      if (mm !== null && lens() && Math.abs((lens().get() ?? 0) - mm) > 1e-4) lens().set(mm);
      if (show || blend) {
        cam.position.copy(tPos);
        cam.quaternion.copy(tQuat);
        cam.updateMatrixWorld(true);
      }
      ctx.player?.update(dt, st, show);
      if (show) {
        // Pulled in against a facade the figure is closer than the on-foot near plane (1 m): lower it for those frames
        // only. pedestrian.js puts its own near back at the start of every frame it does not hold.
        let wantNear = rig.suggestedNear;
        // ── s16:T ── also clear of any wall within 1.5 m of the camera, pulled in or not (an alley's wall beside the camera
        // was cut the same way); never nearer than the rig asked, and the camera itself is not moved
        {
          s16tBandCam.feetY = cam.position.y - 0.3 * VE; s16tBandCam.height = 0.6 * VE; s16tBandCam.radius = CAMERA_PROBE_RADIUS_M;
          const clear = s16tClearNear(cam, s16tCam, s16tBandCam, NEAR_FLOOR_CAMERA);
          if (clear !== null && (wantNear === null || clear < wantNear)) wantNear = clear;
        }
        // ── /s16:T ──
        if (wantNear !== null && cam.near !== wantNear) { cam.near = wantNear; cam.updateProjectionMatrix(); }
        ctx.player?.project(cam);
      } else if (phase === 'body') {
        // ── s16:T ── first person on foot or on the board: a wall within 1.5 m of the eye lowers the near plane so the
        // frame's corners stay clear of it (pressed against a facade the eye is 0.35 m away; near 1.0 reaches 1.2 m).
        // Only ever lowers it: above 20 km view-range.js owns a larger near.
        s16tBandEye.feetY = body.y; s16tBandEye.height = (P.eye + BODY.headroom) * VE; s16tBandEye.radius = BODY.radius - 0.02;
        const clear = s16tClearNear(cam, s16tProbe, s16tBandEye);
        if (clear !== null && clear < cam.near) { cam.near = clear; cam.updateProjectionMatrix(); }
        // ── /s16:T ──
      }
      captureFinal();
    },

    /** The walker was placed (a teleport): the rig snaps to it, no blend. */
    snap() {
      if (!active) return;
      const cur = look.get();
      heading = cur.yaw;
      rig.reset({ yaw: cur.yaw });
      snapPending = true;
      blend = null;
      if (effective === 'third') { look.set(rig.yaw, rig.pitch); sync.yaw = rig.yaw; sync.pitch = rig.pitch; }
      captureFinal();
    },

    lookMode() { return active && effective === 'third' ? 'drag' : 'lock'; },
    isThirdPerson() { return active && effective === 'third'; },
    /** The test surface: choose a view and have it at once, with no blend. */
    setView(v) { rules.set(v); evaluate('instant'); },

    playerState() {
      const f = figureState();
      return {
        x: body.x, y: body.y, z: body.z, heading: active && effective === 'third' ? heading : look.get().yaw,
        state: !active ? 'off' : (getPhase() === 'enter' || getPhase() === 'body' ? body.state : getPhase()),
        speed: body.state === 'swim' ? Math.hypot(body.vx, body.vy, body.vz) : f.speed, jet: f.jet, jetLevel: f.jetLevel, underwater: active ? underwater() : false,
        thirdPerson: active && effective === 'third',
      };
    },

    debug() {
      return {
        chosen: rules.chosen, effective, pressed: rules.pressed,
        transition: blend ? { t: blend.t, dur: blend.dur } : null,
        focal: lens()?.get?.() ?? null,
        rig: { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, pulled: rig.pulled, zoom: rig.zoomFactor },
      };
    },
    get rig() { return rig; },
    get rules() { return rules; },
  };
  // ── s14:D ── lane D's additions to the binding, as wrappers so P's lines stay as they are
  {
    const baseState = api.playerState, baseLook = api.onLook;
    api.setBoardSource = (fn) => { s14dBoardSource = typeof fn === 'function' ? fn : null; };
    /** A drag that orbits the rig stamps the mode clock: the board camera eases behind the travel only when it has been quiet. */
    api.onLook = (dx, dy) => { const took = baseLook(dx, dy); if (took) s14dLastOrbitT = ctx.time ?? 0; return took; };
    api.sinceOrbit = () => (ctx.time ?? 0) - s14dLastOrbitT;
    api.playerState = () => {
      const st = baseState();
      const b = s14dBoardSource?.();
      const on = !!b?.on;
      return {
        ...st, ...(on ? { heading: b.facing, speed: Math.hypot(body.vx, body.vz) } : {}),
        board: on, lean: on ? b.lean : 0, push: on ? b.push : 0,
        pushPhase: on ? b.pushPhase : 0, boardHeading: on ? b.heading : 0, liftM: on ? b.liftM : 0, rootRoll: on ? b.rootRoll : 0,
      };
    };
  }
  // ── /s14:D ──
  return api;
}
