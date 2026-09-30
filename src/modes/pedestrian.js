// pedestrian.js: Pedestrian conveyance mode (sprint 23Sep26w, D-037, lane A2).
//
// Jordan: "as close as we can get to the perspective and motion affordances of
// a to-scale human running around our map, and flying with a jetpack. Going
// underground only at stations, and then only moving within tunnels whilst
// underground. Or you can jump in the river, resulting in controls like Mario
// swimming levels, though with first-person pov."
//
// PHASES
//   enter   ~1s: the HUD Master slider eases to real scale (Master 1; structures
//           are always true since D-039, pedestrian-scale.js) while the camera settles from wherever Deity
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
//
// UNDERGROUND VIEW (sprint 25Sep26f, Lane P, Jordan's note 10): in the shaft
// passage and the tunnel the walker sees the inside of their bore
// (ctx.tubeInterior, src/tube-interior.js: a lining, faint rings, the line's
// colour along the crown), the crown ribbons, station markers and shafts that
// would hang inside the bore are hidden, and the camera's near plane drops to
// UNDERGROUND_NEAR (below ground only) so the walls of a 3.56 m bore are not
// cut. Leaving the tunnel, or the mode, restores all of it.
//
// THE TUNNEL WALK (sprint 30Sep26w, D-041, Lane P; Jordan, D-040 item 5: "the
// speed of transit in tunnels should be 10x faster automatically, and it needs
// to be visually clear when you reach the next station, and can exit. Also
// when first descending, it needs to be possible to choose a platform"):
//   * W walks the tunnel at `tunnelWalk` (60 m/s, 10x the 6 m/s run), Shift at
//     `tunnelSprint` (200 m/s); both on the Physics panel.
//   * E at a station opens the platform chooser (platform-chooser.js): one
//     row per platform, "Line · towards X" from TfL's ordered routes
//     (tube-routes.js); a number key or a click picks it.
//   * Arrival is the CROSSING of a platform's position along the tunnel,
//     found inside the move (pedestrian-tunnels.js advance), so it fires at
//     any speed: the station's name shows on screen, the bore opens into the
//     lit platform tunnel (tube-interior.js, platform-tunnel.js), and coming to
//     rest there (or E) opens the card: "Up to the street" and, at an
//     interchange, a change of line without surfacing.
//   * The walker's own line's trains pass THROUGH the walker (tunnel-trains.js):
//     lit windows streaming past, an air rush and rumble (mode-sfx.js) and a
//     short shake of the view. Nothing about a train touches the walk.
//   * Where a line leaves its tunnel (a portal, found geometrically), the walk
//     ends and the card offers the street.

import { PEDESTRIAN_TUNABLES, BODY, createBody, stepBody } from './pedestrian-body.js';
import { createScaleEase } from './pedestrian-scale.js';
import {
  buildTunnelNetwork, pointAt, advance, nearestEntrance, chooseStop, nearestStopOnPath, travelDir,
  headingAt, markOpenSections,
} from './pedestrian-tunnels.js';
// ── s30:P ──
import { platformRows, cleanStationName } from './tube-routes.js';
import { createPlatformChooser } from './platform-chooser.js';
import { createTunnelTrains } from '../tunnel-trains.js';
import { INTERIOR_LAYER } from '../tube-interior.js';
import { PLATFORM } from '../platform-tunnel.js';
// ── /s30:P ──

export { PEDESTRIAN_TUNABLES };

export const ENTRANCE_RADIUS_M = 35;   // how close to a station you must stand to go down
export const PLATFORM_RADIUS_M = 30;   // how close along the tunnel to a platform to go up
const ALIGN_S = 0.35;                  // shaft: slide onto the shaft axis before descending
const PASSAGE_S = 0.6;                 // shaft foot <-> bore: the cross passage at platform level
const PITCH_LIMIT = 1.45;              // display pitch clamp (about 83 degrees)
const NETWORK_RETRY_S = 2;
export const UNDERGROUND_NEAR = 0.1;   // camera near plane while below ground (m)
// ── s30:P ──
export const PLATFORM_ZONE_M = PLATFORM.lengthM / 2 + 10;  // on the platform: its half length plus a margin
// After an arrival the card still opens if the walker comes to rest this close to
// the platform: stopping from 200 m/s takes 50 m, and a person needs a moment to
// let go of W once the name shows.
export const ARRIVAL_HOLD_M = 250;
const REST_MPS = 0.5;                  // at rest on a platform, the arrival card opens
const TRANSFER_S = 1.2;                // a change of line: through the cross passage to the other platform
const SHAKE_RAD = 0.012;               // peak view shake while a train passes through (about 0.7 degrees)
const SHAKE_DECAY_S = 0.25;
const PORTAL_CLEAR_M = 25;             // walk this far back from a portal before it can offer the street again
// ── /s30:P ──

const HINT = 'WASD run · Space jump, hold to jetpack · E at a station chooses a platform';

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
  let savedNear = null;                   // the camera's near plane before we changed it
  let lastBore = null;                    // { path, s, dir, side } of the last tunnel frame
  // ── s30:P ──
  const chooser = createPlatformChooser({ document: globalThis.document, look: ctx.look, canvas: ctx.canvas });
  let card = null;                        // { kind: 'shaft' | 'arrival' | 'portal', ... } while the chooser is ours
  const trains = createTunnelTrains({ trainSystem: () => ctx.trainSystem, layer: INTERIOR_LAYER });
  let arrived = null;                     // { stop, dismissed } the platform last arrived at
  let portalAt = null;                    // { path, s, x, z, lineId, dismissed } the portal the walk ended at
  let transfer = null;                    // { from, to, t, row, bore }
  const arrivals = [];                    // test log: { name, lineId, speed, at }
  let shake = 0, lastPass = null;
  let trackYaw = null;                    // the track's heading last frame, while moving (the view turns with the tunnel)
  // ── /s30:P ──

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
    if (!force && net && net.paths.length) { markPortals(net); return net; }
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
    markPortals(net);
    return net;
  }

  // ── s30:P ── portals: where a line's track reaches the surface (retried until the ground is there)
  function markPortals(n) {
    if (!n || n.openMarked) return;
    const ground = ctx.getStructuralY || ctx.getTerrainY;
    if (typeof ground !== 'function') return;
    try {
      markOpenSections(n, {
        groundY: (x, z) => ground(x, z),
        waterY: (x, z) => { const w = ctx.waterSurfaceAt?.(x, z); return Number.isFinite(w) ? w : null; },
        VE,
      });
    } catch (err) { console.warn('[pedestrian] portals', err); }
  }
  // ── /s30:P ──

  function hint(text) {
    if (text === lastHint) return;
    lastHint = text;
    ctx.setHint?.(text);
  }

  function facing() { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
  /** Yaw that faces a horizontal heading {x, z}. */
  function yawFor(h) { return Math.atan2(-h.x, -h.z); }

  function cameraQuaternion(out) {
    const ratio = ctx.masterHeight?.ratio ?? 1;
    const canon = Math.atan(Math.tan(pitch) / Math.max(1e-3, ratio));
    euler.set(canon, yaw, 0, 'YXZ');
    return out.setFromEuler(euler);
  }

  function placeCamera(x, y, z) {
    ctx.camera.position.set(x, y, z);
    cameraQuaternion(ctx.camera.quaternion);
    // s30:P a train passing through shakes the view (rotation only: the walker
    // stays exactly on the bore axis). A deterministic function of the clock.
    if (shake > 1e-5) {
      euler.set(shake * (Math.sin(clock * 71) + 0.5 * Math.sin(clock * 113 + 1.3)) / 1.5,
        shake * 0.6 * Math.sin(clock * 89 + 0.4), shake * 0.8 * Math.sin(clock * 53 + 2.1), 'YXZ');
      ctx.camera.quaternion.multiply(qTarget.setFromEuler(euler));
    }
    ctx.camera.updateMatrixWorld(true);
  }

  function setNear(value) {
    const cam = ctx.camera;
    if (cam.near === value) return;
    cam.near = value;
    cam.updateProjectionMatrix();
  }

  /**
   * Which bore the walker is in or entering, or null when above ground: the
   * tunnel itself, and the cross passage at platform level either way.
   */
  function currentBore() {
    if (phase === 'tunnel' && tunnel) return { path: tunnel.path, s: tunnel.s, dir: tunnel.dir, side: tunnel.side };
    if (phase === 'transfer' && transfer) return { ...transfer.bore };
    if (phase === 'shaft' && shaft && shaft.passage && !shaft.passage.done) {
      if (shaft.dir === 'down') return { path: shaft.stop.path, s: shaft.stop.s, dir: shaft.tunnelDir || 1, side: shaft.side || 0 };
      if (lastBore && lastBore.path === shaft.stop.path) return { ...lastBore, s: shaft.stop.s };
    }
    return null;
  }

  /** The underground view: interior, ribbons and near plane follow the phase. */
  function syncUndergroundView() {
    const bore = currentBore();
    const below = phase === 'tunnel' || phase === 'transfer' || (phase === 'shaft' && shaft
      && ctx.camera.position.y < (shaft.stop?.surfaceY ?? shaft.groundY ?? Infinity));
    if (bore && net) {
      if (phase === 'tunnel') lastBore = bore;
      // Only in the tunnel is the camera surely inside the lining; in the cross
      // passage it is partly outside, where drawing the lining alone would blank the view.
      ctx.tubeInterior?.show(net, bore, { isolate: phase === 'tunnel' });
      // s30:P the walker's own line's trains are drawn inside the bore.
      trains.show(net.paths[bore.path]?.lineId ?? null);
    } else {
      ctx.tubeInterior?.hide();
      trains.hide();
    }
    setNear(below ? UNDERGROUND_NEAR : savedNear);
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

  function sound(groundSpeed, pass = null) {
    const s = ctx.sfx;
    if (!s) return;
    s.footsteps(groundSpeed);
    s.tunnelTrain?.(pass?.rush ?? 0, pass?.rumble ?? 0); // s30:P
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

  function startDescent(entrance, chosen = null) {
    const n = chosen ? network() : network(true);
    const e = n ? nearestEntrance(n, entrance.x, entrance.z, ENTRANCE_RADIUS_M) : null;
    // s30:P the platform picked on the chooser card; the facing pick stays as the fallback.
    const pick = chosen && n?.paths[chosen.stop.path] ? chosen : (e ? chooseStop(n, e, facing()) : null);
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
    arrived = null; portalAt = null; // s30:P
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
        // s30:P E opens the platform chooser; E again (or Esc) closes it.
        text = card?.kind === 'shaft' ? `${cleanLabel(ent.name)}: choose a platform (1-9 or click) · E or Esc to stay`
          : `E: choose a platform at ${cleanLabel(ent.name)}`;
        if (use) {
          if (card?.kind === 'shaft') closeCard();
          else openShaftCard(ent);
        }
      } else if (card?.kind === 'shaft') {
        closeCard(); // walked away from the station
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
    // s30:P on the chosen platform, facing the way its trains run; no card until E or the next station.
    arrived = null;
    portalAt = null;
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
    // s30:P the tunnel walk (10x the run) and Shift sprint, both Physics tunables.
    const target = m.forward === 0 ? 0 : (m.sprint ? P.tunnelSprint : P.tunnelWalk);
    // Reach the walk or the sprint in about half a second, and stop from the
    // walk in half a second (from the sprint in under a second).
    const accel = Math.max(P.accel, 2 * Math.max(P.tunnelWalk, target, tunnelSpeed));
    // Speed along the tunnel eases toward the target (inertia), in real m/s.
    const dv = target - tunnelSpeed;
    tunnelSpeed += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);
    let crossed = [], portal = null;
    if (tunnelSpeed > 0.001) {
      const dirWant = m.forward >= 0 ? want : { x: -want.x, z: -want.z };
      // Keep the last intent while coasting to a stop.
      tunnel.want = m.forward !== 0 ? dirWant : (tunnel.want || dirWant);
      const r = advance(n, tunnel, tunnelSpeed * dt, tunnel.want);
      crossed = r.crossed || [];
      portal = r.portal;
      if (r.stopped) tunnelSpeed = 0;
    } else {
      tunnelSpeed = 0;
      tunnel.dir = travelDir(n.paths[tunnel.path], tunnel.s, want, tunnel.dir);
    }
    // s30:P arrival: every platform crossed inside this move, whatever the speed.
    for (const c of crossed) arrive(c.stop, tunnelSpeed);
    // s30:P the view turns with the tunnel: at 60 to 200 m/s a bend comes and
    // goes in a second, faster than anyone steers a mouse. The look offset the
    // walker has set is kept; only the track's own turning is added.
    if (tunnelSpeed > 0.001) {
      const hm = headingAt(n.paths[tunnel.path], tunnel.s, tunnel.dir);
      const th = Math.atan2(-hm.x, -hm.z);
      if (trackYaw !== null) {
        let d = th - trackYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) < 0.6) yaw += d;   // a turn-round or a branch swap is not a bend
      }
      trackYaw = th;
    } else {
      trackYaw = null;
    }
    const p = pointAt(n.paths[tunnel.path], tunnel.s, {}, tunnel.side);
    // s30:P trains passing through the walker: sound and a short shake, never a stop.
    const pass = trains.update(ctx.tubeInterior?.windowPoints ?? null, p, dt, { VE });
    lastPass = pass;
    const k = Math.exp(-dt / SHAKE_DECAY_S);
    const goal = pass.inside ? SHAKE_RAD : SHAKE_RAD * 0.5 * Math.max(0, pass.rush - 0.35);
    shake = Math.max(goal, shake * k);
    placeCamera(p.x, p.y, p.z);
    lastEvents = [];
    sound(tunnelSpeed, pass);

    const lineName = routesOf(n.paths[tunnel.path].lineId)?.lineName || n.paths[tunnel.path].lineId;
    // s30:P the mouth of the tunnel: the walk ends here and offers the street.
    if (portal && !(portalAt && portalAt.path === portal.path && Math.abs(portalAt.s - portal.s) < 1e-6)) {
      portalAt = { path: portal.path, s: portal.s, x: p.x, z: p.z, lineId: n.paths[portal.path].lineId, dismissed: false };
    }
    if (portalAt && (portalAt.path !== tunnel.path || Math.abs(portalAt.s - tunnel.s) > PORTAL_CLEAR_M)) {
      if (card?.kind === 'portal') closeCard();
      portalAt = null;
    }
    if (portalAt) {
      hint(`The ${lineName} leaves its tunnel here · E: up to the street · S walks back`);
      if (use) { if (card?.kind === 'portal') closeCard(); else openPortalCard(); }
      else if (!card && !portalAt.dismissed && tunnelSpeed < REST_MPS) openPortalCard();
      return;
    }

    const onPlatform = nearestStopOnPath(n, tunnel.path, tunnel.s, PLATFORM_ZONE_M);
    // Well past the station arrived at (or on another's platform): forget the arrival and close its card.
    if (arrived && ((onPlatform && !sameStation(onPlatform, arrived.stop))
      || Math.hypot(p.x - arrived.stop.x, p.z - arrived.stop.z) > ARRIVAL_HOLD_M)) {
      if (card?.kind === 'arrival') closeCard();
      arrived = null;
    }
    const stop = onPlatform ?? arrived?.stop ?? null;
    if (stop) {
      if (card?.kind === 'arrival') hint(`${cleanLabel(stop.name)}: choose (1-9 or click) · W/S walk on · Esc to stay`);
      else hint(`E: exits and changes at ${cleanLabel(stop.name)} · W/S walk · Shift sprint`);
      if (use) {
        if (card?.kind === 'arrival') closeCard();
        else openArrivalCard(stop);
      } else if (!card && arrived && !arrived.dismissed && tunnelSpeed < REST_MPS) {
        openArrivalCard(stop);
      }
    } else {
      hint(`${lineName} · W/S walk · Shift sprint · face a branch to take it`);
    }
  }

  // ── s30:P arrival, cards, changes of line, portals ─────────────────────────

  const routesOf = (lineId) => ctx.tubeRoutes?.get?.(lineId) ?? null;
  const colourOf = (lineId) => ctx.lineColour?.(lineId) ?? null;
  function sameStation(a, b) {
    return !!a && !!b && (a === b || (a.lineId === b.lineId && cleanLabel(a.name) === cleanLabel(b.name)));
  }

  function arrive(stop, speed) {
    arrivals.push({ name: cleanLabel(stop.name), lineId: stop.lineId, path: stop.path, s: stop.s, speed, at: clock });
    if (arrivals.length > 64) arrivals.shift();
    if (card?.kind === 'arrival') closeCard();
    arrived = { stop, dismissed: false };
    chooser.banner(cleanLabel(stop.name), { colour: colourOf(stop.lineId) });
  }

  function closeCard() {
    card = null;
    chooser.close();
  }

  function openCard(kind, { kicker, title, rows, extra = {} }) {
    card = { kind, ...extra };
    chooser.open({
      kicker, title, rows,
      onPick: (row) => { card = null; pickRow(kind, row, extra); },
      onCancel: () => {
        card = null;
        if (kind === 'arrival' && arrived) arrived.dismissed = true;
        if (kind === 'portal' && portalAt) portalAt.dismissed = true;
      },
    });
  }

  function openShaftCard(near) {
    // Rebuilt first, as the descent always did: a terrain resnap replaces the centrelines.
    const n = network(true);
    const entrance = n ? nearestEntrance(n, near.x, near.z, ENTRANCE_RADIUS_M) : null;
    if (!entrance) return false;
    const rows = platformRows(n, entrance, { tubeRoutes: ctx.tubeRoutes ?? new Map(), lineColour: colourOf })
      .map(r => ({ ...r, kind: 'platform' }));
    if (!rows.length) return false;
    openCard('shaft', { kicker: 'Down to the platforms', title: cleanLabel(entrance.name), rows, extra: { entrance } });
    return true;
  }

  function entranceOf(stop) {
    return net?.entrances.find(e => e.stops.includes(stop)) ?? null;
  }

  function openArrivalCard(stop) {
    const n = net;
    const ent = entranceOf(stop);
    const here = n.paths[tunnel.path];
    // Rows the walker already has by walking this bore either way are not changes.
    const own = new Set(platformRows(n, { stops: here.stops.filter(x => sameStation(x.stop, stop)).map(x => x.stop) },
      { tubeRoutes: ctx.tubeRoutes ?? new Map() }).map(r => r.key));
    const changes = ent ? platformRows(n, ent, { tubeRoutes: ctx.tubeRoutes ?? new Map(), lineColour: colourOf,
      exclude: (st, dir, row) => own.has(row.key) }) : [];
    const rows = [{ label: 'Up to the street', kind: 'street', colour: null, stop }]
      .concat(changes.map(r => ({ ...r, kind: 'change', section: 'Change without surfacing' })));
    openCard('arrival', { kicker: 'Arrived', title: cleanLabel(stop.name), rows, extra: { stop } });
    if (arrived) arrived.dismissed = true; // once shown, it does not reopen until the next arrival
    return true;
  }

  function openPortalCard() {
    if (!portalAt) return false;
    const lineName = routesOf(portalAt.lineId)?.lineName || portalAt.lineId;
    openCard('portal', {
      kicker: 'Tunnel mouth', title: `The ${lineName} leaves its tunnel`,
      rows: [{ label: 'Up to the street', kind: 'street', colour: null }, { label: 'Back into the tunnel', kind: 'back', colour: null }],
    });
    portalAt.dismissed = true;
    return true;
  }

  function pickRow(kind, row, extra) {
    if (kind === 'shaft' && row.kind === 'platform') {
      yaw = yawFor(row.heading);
      startDescent(extra.entrance, { stop: row.stop, dir: row.dir });
    } else if (kind === 'arrival' && row.kind === 'street') {
      startAscent(extra.stop);
    } else if (kind === 'arrival' && row.kind === 'change') {
      startTransfer(row);
    } else if (kind === 'portal' && row.kind === 'street') {
      startPortalExit();
    } else if (kind === 'portal' && row.kind === 'back') {
      yaw += Math.PI;
    }
  }

  function startTransfer(row) {
    const n = net;
    const path = n?.paths[row.stop.path];
    if (!path) return false;
    const side = n.halfSpacing > 0 ? row.dir : 0;
    const to = pointAt(path, row.stop.s, {}, side);
    transfer = { from: ctx.camera.position.clone(), to, t: 0, row,
      bore: { path: row.stop.path, s: row.stop.s, dir: row.dir, side } };
    phase = 'transfer';
    tunnel = null;
    tunnelSpeed = 0;
    hint(`Changing to the ${row.lineName}, ${row.label.replace(/^.*?·\s*/, '')}`);
    return true;
  }

  function updateTransfer(dt) {
    sound(0);
    transfer.t += dt;
    const k = Math.min(1, transfer.t / TRANSFER_S);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in and out
    const f = transfer.from, t = transfer.to;
    placeCamera(f.x + (t.x - f.x) * e, f.y + (t.y - f.y) * e, f.z + (t.z - f.z) * e);
    if (k >= 1) {
      const row = transfer.row;
      tunnel = { path: row.stop.path, s: row.stop.s, dir: row.dir, side: transfer.bore.side };
      yaw = yawFor(row.heading);
      arrived = null;   // on the new platform: E for its card, no card by itself
      phase = 'tunnel';
      transfer = null;
      hint(null);
      chooser.banner(cleanLabel(row.stop.name), { colour: colourOf(row.stop.lineId) });
    }
  }

  function startPortalExit() {
    if (!portalAt) return false;
    const x = portalAt.x, z = portalAt.z;
    const ground = ctx.collision.groundHeightAt(x, z) ?? ctx.camera.position.y;
    const c = ctx.camera.position;
    // Out of the mouth and up the slope to the street, as the shaft ascent does.
    shaft = { dir: 'up', x0: x, z0: z, x1: x, z1: z, y: c.y, targetY: ground + P.eye * VE, t: ALIGN_S,
      stop: { name: 'the tunnel mouth', surfaceY: ground }, groundY: ground, passage: null };
    phase = 'shaft';
    tunnel = null;
    portalAt = null;
    hint('Out to the street');
    return true;
  }
  // ── /s30:P ──

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
      savedNear = ctx.camera.near;
      lastBore = null;
      // s30:P
      card = null; chooser.close(); arrived = null; portalAt = null; transfer = null; shake = 0; lastPass = null;
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
      ctx.tubeInterior?.hide();
      // s30:P the card, the banner and the trains' interior layer go with the mode.
      card = null; chooser.close(); chooser.hideBanner(); trains.hide();
      arrived = null; portalAt = null; transfer = null; shake = 0;
      if (savedNear !== null) setNear(savedNear);
      savedNear = null;
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
      else if (phase === 'transfer') updateTransfer(dt); // s30:P
      syncUndergroundView();
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
        near: ctx.camera.near, savedNear,
        interior: ctx.tubeInterior?.debug() ?? null,
        // ── s30:P ──
        speeds: { walk: P.tunnelWalk, sprint: P.tunnelSprint },
        card: card ? { kind: card.kind } : null,
        chooser: { ...chooser.debug(), detail: chooser.rows.map(r => ({ label: r.label, kind: r.kind, lineId: r.lineId ?? null,
          dir: r.dir ?? null, path: r.stop?.path ?? null, s: r.stop?.s ?? null, name: r.stop ? cleanLabel(r.stop.name) : null,
          towards: r.towards ?? null, next: r.next ?? null })) },
        arrivals: arrivals.map(a => ({ ...a })),
        arrived: arrived ? { name: cleanLabel(arrived.stop.name), lineId: arrived.stop.lineId, dismissed: arrived.dismissed } : null,
        portal: portalAt ? { ...portalAt } : null,
        transfer: transfer ? { t: transfer.t, lineId: transfer.row.lineId, label: transfer.row.label } : null,
        trains: trains.debug(),
        shake,
        // ── /s30:P ──
      };
    },
    /** Place the body on the surface at (x, z), skipping the entry ease (tests). */
    place(x, z, { yaw: y = yaw, pitch: p = 0 } = {}) {
      if (!active) return false;
      yaw = y; pitch = p;
      enter = null; shaft = null; tunnel = null;
      card = null; chooser.close(); arrived = null; portalAt = null; transfer = null; // s30:P
      settleAt(x, z, Infinity);
      phase = 'body';
      placeCamera(body.x, body.y + P.eye * VE, body.z);
      return true;
    },
    press(which) { if (which === 'jump') jumpLatch = true; else if (which === 'use') useLatch = true; },
    // ── s30:P ── test surface
    /** Put the walker in a bore at arc s of a path, facing dir, at rest (tests). */
    placeInTunnel({ path, s, dir = 1, side = null } = {}) {
      const n = network();
      if (!active || !n?.paths[path]) return false;
      enter = null; shaft = null; transfer = null;
      card = null; chooser.close(); arrived = null; portalAt = null;
      const sd = side ?? (n.halfSpacing > 0 ? dir : 0);
      tunnel = { path, s, dir, side: sd };
      tunnelSpeed = 0;
      yaw = yawFor(headingAt(n.paths[path], s, dir)); pitch = 0;
      phase = 'tunnel';
      const q = pointAt(n.paths[path], s, {}, sd);
      placeCamera(q.x, q.y, q.z);
      return true;
    },
    chooseRow(i) { return chooser.pick(i); },
    get chooser() { return chooser; },
    get tunnelTrains() { return trains; },
    // ── /s30:P ──
    turn(dxRad, dyRad) { yaw += dxRad; pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch + dyRad)); },
    get network() { return network(); },
    rebuildNetwork() { return network(true); },
    body,
  };
}

function cleanLabel(name) {
  return String(name || 'station').replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
}
