// pedestrian.js: Pedestrian conveyance mode (sprint 23Sep26w, D-037, lane A2).
//
// Jordan: "as close as we can get to the perspective and motion affordances of
// a to-scale human running around our map, and flying with a jetpack. Going
// underground only at stations, and then only moving within tunnels whilst
// underground. Or you can jump in the river, resulting in controls like Mario
// swimming levels, though with first-person pov."
//
// PHASES
//   enter   ~1s: the HUD sliders ease to real scale (Master 1 / Structure 5,
//           pedestrian-scale.js) while the camera settles from wherever Deity
//           left it onto the ground (or a roof, or the river) below.
//   body    on the surface: ground / air (jump, jetpack) / swim
//           (pedestrian-body.js), colliding with building footprints through
//           the shared collision service, walkable roofs included.
//   shaft   E near a station: straight down the shaft to the platform at its
//           true modelled depth, then through a short cross passage into the
//           bore whose trains run the way you face; E on a platform: back
//           through the passage and up to the street.
//   tunnel  below ground the body is a point on the centreline of the rendered
//           bore it is in (pedestrian-tunnels.js; main.js draws twin bores 6m
//           either side of the line's shared centreline, which is solid ground):
//           W/S along it, free look, facing picks the branch at junctions,
//           Shift is a superhuman ~20 m/s sprint.
//
// Leaving the mode puts the sliders back as they were before entry (the
// registry has already silenced the mode SFX and released pointer lock).
//
// HEIGHT CONTRACT: all physics is canonical VE5 space (X/Z metres, Y metres x
// VE). Master only rescales the camera display, so mouse look is kept in
// DISPLAY pitch and converted per frame: canonical pitch = atan(tan(display) /
// ratio). That keeps "look 30 degrees down" looking 30 degrees down at every
// Master value, including real scale.
//
// DETERMINISM: every motion is integrated from the frame dt the registry
// passes; nothing here is random.

import { PEDESTRIAN_TUNABLES, BODY, createBody, stepBody } from './pedestrian-body.js';
import { createScaleEase } from './pedestrian-scale.js';
import {
  buildTunnelNetwork, pointAt, advance, nearestEntrance, chooseStop, nearestStopOnPath, travelDir,
} from './pedestrian-tunnels.js';

export { PEDESTRIAN_TUNABLES };

export const ENTRANCE_RADIUS_M = 35;   // how close to a station you must stand to go down
export const PLATFORM_RADIUS_M = 30;   // how close along the tunnel to a platform to go up
const ALIGN_S = 0.35;                  // shaft: slide onto the shaft axis before descending
const PASSAGE_S = 0.6;                 // shaft foot <-> bore: the cross passage at platform level
const PITCH_LIMIT = 1.45;              // display pitch clamp (about 83 degrees)
const NETWORK_RETRY_S = 2;

const HINT = 'WASD run · Space jump, hold to jetpack · E at a station goes down';

const easeOutCubic = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function isFormInput(target) {
  return target?.matches?.('input, select, textarea') || target?.isContentEditable;
}

/**
 * @param {object} ctx shared mode context (see src/modes/index.js)
 * @returns {object} a mode object (see src/modes/registry.js)
 */
export function createPedestrianMode(ctx) {
  const P = ctx.physics.register('pedestrian', 'Pedestrian', PEDESTRIAN_TUNABLES);
  const { THREE, VE } = ctx;
  const ease = createScaleEase({ sliders: ctx.sliders });
  const body = createBody();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const qTarget = new THREE.Quaternion();
  const vTarget = new THREE.Vector3();

  let active = false;
  let phase = 'off';
  let yaw = 0, pitch = 0;                 // pitch is DISPLAY pitch
  let enter = null;                       // { from: Vector3, fromQ: Quaternion, t }
  let shaft = null;                       // { dir, x0, z0, x1, z1, y, targetY, t, stop, tunnelDir, side, passage }
  let tunnel = null;                      // { path, s, dir, side }  side: +1 / -1 bore, 0 centreline
  let net = null, netTriedAt = -Infinity, clock = 0;
  let lastHint = undefined;
  let jumpLatch = false, useLatch = false;
  let lastEvents = [];
  let tunnelSpeed = 0;

  // Edge-triggered keys are latched from keydown, so a tap shorter than a
  // frame is never lost. Held state comes from the shared ctx.keys set.
  globalThis.addEventListener?.('keydown', (e) => {
    if (!active || e.metaKey || e.ctrlKey || e.altKey || isFormInput(e.target)) return;
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) jumpLatch = true; }
    else if (!e.repeat && e.key.toLowerCase() === 'e') useLatch = true;
  }, { passive: false });

  const world = {
    moveAndSlide: (pos, delta, opts) => ctx.collision.moveAndSlide(pos, delta, opts),
    standHeightAt: (x, z, feetY, step) => ctx.collision.standHeightAt(x, z, feetY, step),
    waterAt: (x, z) => ctx.collision.waterAt(x, z),
  };

  function network(force = false) {
    if (!force && net && net.paths.length) return net;
    if (!force && net && clock - netTriedAt < NETWORK_RETRY_S) return net;
    netTriedAt = clock;
    const src = ctx.tubeNetwork;
    if (!src) return net;
    try {
      net = buildTunnelNetwork({ THREE, branchesByLine: src.branches, stationLayers: src.stationLayers, VE,
        halfSpacing: src.halfSpacing ?? 0 });
    } catch (err) {
      console.warn('[pedestrian] tunnel network', err);
    }
    return net;
  }

  function hint(text) {
    if (text === lastHint) return;
    lastHint = text;
    ctx.setHint?.(text);
  }

  function facing() { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }

  function cameraQuaternion(out) {
    const ratio = ctx.masterHeight?.ratio ?? 1;
    const canon = Math.atan(Math.tan(pitch) / Math.max(1e-3, ratio));
    euler.set(canon, yaw, 0, 'YXZ');
    return out.setFromEuler(euler);
  }

  function placeCamera(x, y, z) {
    ctx.camera.position.set(x, y, z);
    cameraQuaternion(ctx.camera.quaternion);
    ctx.camera.updateMatrixWorld(true);
  }

  /** Put the body on whatever is under (x, z): water, a roof or the ground. */
  function settleAt(x, z, fromY = Infinity) {
    body.x = x; body.z = z; body.vx = body.vy = body.vz = 0; body.jet = false; body.airTime = 0;
    const ground = ctx.collision.groundHeightAt(x, z);
    // From above, land on the highest surface below; from underground, the street.
    const stand = fromY === Infinity || (ground !== null && fromY >= ground)
      ? ctx.collision.standHeightAt(x, z, fromY === Infinity ? Infinity : fromY, 0)
      : ground;
    const water = ctx.collision.waterAt(x, z);
    if (water && (stand === null || stand < water.surfaceY - BODY.wade * VE)) {
      body.state = 'swim';
      body.y = water.surfaceY + (BODY.headOut - P.eye) * VE;
    } else if (stand !== null) {
      body.state = 'ground';
      body.y = stand;
    } else {
      body.state = 'ground';
      body.y = (Number.isFinite(fromY) ? fromY : ctx.camera.position.y) - P.eye * VE;
    }
  }

  function readMove() {
    const k = ctx.keys;
    return {
      forward: (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0),
      right: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0),
      sprint: k.has('shift'),
      jumpHeld: k.has(' '),
    };
  }

  function sound(groundSpeed) {
    const s = ctx.sfx;
    if (!s) return;
    s.footsteps(groundSpeed);
    s.jetpack(phase === 'body' && body.jet ? Math.min(1, 0.55 + Math.max(0, body.vy) / (P.jetMaxRise * 2)) : 0);
    for (const e of lastEvents) {
      if (e.type === 'splash') s.splash(e.intensity);
      else if (e.type === 'stroke') s.strokes(1);
      else if (e.type === 'climb') s.splash(0.25);
      else if (e.type === 'land' && e.speed > 4) s.footsteps(0); // reset cadence; the next step sounds at once
    }
    lastEvents = []; // one-shots play once, whichever phase runs next
  }

  // ── phases ────────────────────────────────────────────────────────────────

  function startDescent(entrance) {
    const n = network(true);
    const e = n ? nearestEntrance(n, entrance.x, entrance.z, ENTRANCE_RADIUS_M) : null;
    const pick = e ? chooseStop(n, e, facing()) : null;
    if (!pick) return false;
    const eye = body.y + P.eye * VE;
    // The bore whose trains run the way you face (main.js runs +u trains on
    // its leftCurve, side +1), so side = travel direction along the path.
    const side = n.halfSpacing > 0 ? pick.dir : 0;
    shaft = { dir: 'down', x0: body.x, z0: body.z, x1: pick.stop.x, z1: pick.stop.z, y: eye,
      targetY: pick.stop.platformY, t: 0, stop: pick.stop, tunnelDir: pick.dir, side, passage: null };
    phase = 'shaft';
    body.vx = body.vy = body.vz = 0; body.jet = false;
    hint(`Descending to ${pick.stop.name ? `${cleanLabel(pick.stop.name)} ` : ''}platform, ${pick.stop.depthM.toFixed(0)} m down`);
    return true;
  }

  function startAscent(stop) {
    const ground = ctx.collision.groundHeightAt(stop.x, stop.z) ?? stop.surfaceY ?? ctx.camera.position.y;
    const c = ctx.camera.position;
    // Back through the cross passage from the bore to the foot of the shaft, then up.
    shaft = { dir: 'up', x0: stop.x, z0: stop.z, x1: stop.x, z1: stop.z, y: stop.platformY,
      targetY: ground + P.eye * VE, t: ALIGN_S, stop, groundY: ground,
      passage: { x0: c.x, y0: c.y, z0: c.z, x1: stop.x, y1: stop.platformY, z1: stop.z, t: 0 } };
    phase = 'shaft';
    tunnel = null;
    hint(`Up to the street at ${cleanLabel(stop.name)}`);
  }

  function updateEnter(dt) {
    enter.t += dt;
    const k = P.easeTime > 0 ? Math.min(1, enter.t / P.easeTime) : 1;
    const e = easeOutCubic(k);
    vTarget.set(body.x, body.y + P.eye * VE, body.z);
    ctx.camera.position.lerpVectors(enter.from, vTarget, e);
    cameraQuaternion(qTarget);
    ctx.camera.quaternion.slerpQuaternions(enter.fromQ, qTarget, e);
    ctx.camera.updateMatrixWorld(true);
    if (k >= 1) { phase = 'body'; enter = null; }
    sound(0);
  }

  function updateBody(dt, use, jump) {
    const m = readMove();
    lastEvents = [];
    stepBody(body, { forward: m.forward, right: m.right, yaw, pitch, jumpPressed: jump, jumpHeld: m.jumpHeld },
      dt, world, P, VE, lastEvents);
    placeCamera(body.x, body.y + P.eye * VE, body.z);

    let text = null;
    if (body.state === 'ground') {
      const n = network();
      const ent = n ? nearestEntrance(n, body.x, body.z, ENTRANCE_RADIUS_M) : null;
      if (ent) {
        text = `E: down to the ${cleanLabel(ent.name)} platforms`;
        if (use && startDescent(ent)) text = undefined;
      }
    } else if (body.state === 'swim') {
      text = 'Swimming · Space strokes up · W swims where you look · climb out at a bank';
    } else if (body.jet) {
      text = 'Jetpack';
    }
    if (text !== undefined) hint(text);
    sound(body.state === 'ground' ? Math.hypot(body.vx, body.vz) : 0);
  }

  /** Advance the cross passage; true once it has arrived. */
  function stepPassage(dt) {
    const g = shaft.passage;
    g.t += dt;
    const k = PASSAGE_S > 0 ? Math.min(1, g.t / PASSAGE_S) : 1;
    const e = easeOutCubic(k);
    placeCamera(g.x0 + (g.x1 - g.x0) * e, g.y0 + (g.y1 - g.y0) * e, g.z0 + (g.z1 - g.z0) * e);
    return k >= 1;
  }

  function enterTunnel() {
    tunnel = { path: shaft.stop.path, s: shaft.stop.s, dir: shaft.tunnelDir, side: shaft.side || 0 };
    tunnelSpeed = 0;
    phase = 'tunnel';
    hint(null);
    shaft = { ...shaft, done: true };
  }

  function updateShaft(dt) {
    sound(0);
    // Up: the passage from the bore to the shaft foot comes first.
    if (shaft.dir === 'up' && shaft.passage && !shaft.passage.done) {
      if (stepPassage(dt)) shaft.passage.done = true;
      else return;
    }
    // Down: the passage from the shaft foot into the bore comes last.
    if (shaft.dir === 'down' && shaft.passage) {
      if (stepPassage(dt)) enterTunnel();
      return;
    }
    shaft.t += dt;
    const a = Math.min(1, shaft.t / ALIGN_S);
    const x = shaft.x0 + (shaft.x1 - shaft.x0) * easeOutCubic(a);
    const z = shaft.z0 + (shaft.z1 - shaft.z0) * easeOutCubic(a);
    if (a >= 1) {
      const step = P.shaftSpeed * VE * dt;
      const d = shaft.targetY - shaft.y;
      shaft.y = Math.abs(d) <= step ? shaft.targetY : shaft.y + Math.sign(d) * step;
    }
    placeCamera(x, shaft.y, z);
    if (a >= 1 && shaft.y === shaft.targetY) {
      if (shaft.dir === 'down') {
        const bore = pointAt(net.paths[shaft.stop.path], shaft.stop.s, {}, shaft.side || 0);
        shaft.passage = { x0: x, y0: shaft.y, z0: z, x1: bore.x, y1: bore.y, z1: bore.z, t: 0 };
        return;
      } else {
        body.x = shaft.x1; body.z = shaft.z1; body.y = shaft.groundY;
        body.vx = body.vy = body.vz = 0; body.state = 'ground';
        phase = 'body';
        hint(null);
      }
      shaft = { ...shaft, done: true };
    }
  }

  function updateTunnel(dt, use) {
    const n = net;
    if (!n || !n.paths[tunnel.path]) { phase = 'body'; settleAt(ctx.camera.position.x, ctx.camera.position.z, -Infinity); return; }
    const m = readMove();
    const want = facing();
    const target = m.forward === 0 ? 0 : (m.sprint ? P.tunnelSprint : P.speed);
    const accel = m.sprint ? Math.max(P.accel, P.tunnelSprint * 2) : P.accel;
    // Speed along the tunnel eases toward the target (inertia), in real m/s.
    const dv = target - tunnelSpeed;
    tunnelSpeed += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);
    if (tunnelSpeed > 0.001) {
      const dirWant = m.forward >= 0 ? want : { x: -want.x, z: -want.z };
      // Keep the last intent while coasting to a stop.
      tunnel.want = m.forward !== 0 ? dirWant : (tunnel.want || dirWant);
      const r = advance(n, tunnel, tunnelSpeed * dt, tunnel.want);
      if (r.stopped) tunnelSpeed = 0;
    } else {
      tunnelSpeed = 0;
      tunnel.dir = travelDir(n.paths[tunnel.path], tunnel.s, want, tunnel.dir);
    }
    const p = pointAt(n.paths[tunnel.path], tunnel.s, {}, tunnel.side);
    placeCamera(p.x, p.y, p.z);
    lastEvents = [];
    sound(tunnelSpeed);

    const stop = nearestStopOnPath(n, tunnel.path, tunnel.s, PLATFORM_RADIUS_M);
    if (stop) {
      hint(`E: up to the street at ${cleanLabel(stop.name)} · W/S walk the tunnel · Shift sprint`);
      if (use) startAscent(stop);
    } else {
      hint(`${n.paths[tunnel.path].lineId} tunnel · W/S walk · Shift sprint · face a branch to take it`);
    }
  }

  // ── mode object ───────────────────────────────────────────────────────────

  return {
    id: 'pedestrian',
    label: 'Pedestrian',
    key: '2',
    hint: HINT,
    look: 'lock',
    solid: true,
    stub: false,

    activate(c) {
      active = true;
      jumpLatch = useLatch = false;
      lastHint = undefined;
      ctx.collision.sync();
      ease.begin();
      const cam = ctx.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      yaw = Math.atan2(-fwd.x, -fwd.z);
      pitch = 0;
      tunnel = null; shaft = null;
      // Underground or in the air: come up / down to the surface below.
      const ground = ctx.collision.groundHeightAt(cam.position.x, cam.position.z);
      const fromY = ground !== null && cam.position.y < ground ? -Infinity : Infinity;
      settleAt(cam.position.x, cam.position.z, fromY);
      enter = { from: cam.position.clone(), fromQ: cam.quaternion.clone(), t: 0 };
      phase = 'enter';
      network();
      c?.setHint?.(null);
    },

    deactivate(c) {
      active = false;
      phase = 'off';
      ease.restore();
      body.jet = false;
      jumpLatch = useLatch = false;
      c?.setHint?.(null);
    },

    onLook(dx, dy) {
      const k = P.look / 1000;
      yaw -= dx * k;
      pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch - dy * k));
    },

    update(dt) {
      if (!active) return false;
      clock += dt;
      ease.update(dt, P.easeTime);
      const jump = jumpLatch, use = useLatch;
      jumpLatch = useLatch = false;
      if (phase === 'enter') updateEnter(dt);
      else if (phase === 'body') updateBody(dt, use, jump);
      else if (phase === 'shaft') updateShaft(dt);
      else if (phase === 'tunnel') updateTunnel(dt, use);
      return true;
    },

    // ── test / tuning surface (dev specs read and drive these) ──
    debug() {
      const n = net;
      return {
        phase, state: body.state, x: body.x, y: body.y, z: body.z, vx: body.vx, vy: body.vy, vz: body.vz,
        jet: body.jet, yaw, pitch, eyeY: ctx.camera.position.y,
        ease: { running: ease.running, saved: ease.saved, held: ease.held },
        tunnel: tunnel && n ? { path: tunnel.path, s: tunnel.s, dir: tunnel.dir, side: tunnel.side,
          lineId: n.paths[tunnel.path]?.lineId,
          speed: tunnelSpeed } : null,
        shaft: shaft ? { dir: shaft.dir, y: shaft.y, targetY: shaft.targetY, done: !!shaft.done,
          stop: { name: shaft.stop.name, lineId: shaft.stop.lineId, platformY: shaft.stop.platformY,
            surfaceY: shaft.stop.surfaceY, depthM: shaft.stop.depthM } } : null,
        network: n ? n.stats : null,
      };
    },
    /** Place the body on the surface at (x, z), skipping the entry ease (tests). */
    place(x, z, { yaw: y = yaw, pitch: p = 0 } = {}) {
      if (!active) return false;
      yaw = y; pitch = p;
      enter = null; shaft = null; tunnel = null;
      settleAt(x, z, Infinity);
      phase = 'body';
      placeCamera(body.x, body.y + P.eye * VE, body.z);
      return true;
    },
    press(which) { if (which === 'jump') jumpLatch = true; else if (which === 'use') useLatch = true; },
    turn(dxRad, dyRad) { yaw += dxRad; pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch + dyRad)); },
    get network() { return network(); },
    rebuildNetwork() { return network(true); },
    body,
  };
}

function cleanLabel(name) {
  return String(name || 'station').replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
}
