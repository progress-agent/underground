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
//     brief shake of the view, all driven by the MOTION of the pass (a train
//     standing round a walker at rest passes nothing; fix round 2). Nothing
//     about a train touches the walk.
//   * (Sprint 30Sep26w: where a line left its tunnel the walk ended and a card
//     offered the street. Superseded by sprint 01Oct26h, below.)
//
// TO THE ENDS OF THE LINES (sprint 01Oct26h, D-042 item 1, D-043 item 4, Lane
// P). Jordan: "we should stop and be offered the street at stations only, not
// when a line leaves its tunnel. not even when leaving its tunnel for good. it
// should be possible to keep traveling in the same way to the ends of the
// lines even above ground and only possible to exit them at stations."
//   * The walk's state stays on the station-chord network (topology, branches,
//     arrivals, "towards X" unchanged). Where the line runs in the open the
//     walker is SHOWN on the drawn surface track (open-air-walk.js, the regime
//     'open'), in the lane of its bore, at the same speeds measured along the
//     drawn track, in first person; everywhere else in the bore ('bore').
//   * A tunnel mouth is a cut: leaving the bore, a 0.35 s daylight flare and
//     the view turns by the difference between the drawn track's heading and
//     the chord's; entering one, a 0.25 s dip from black. The tunnel path is
//     drawn underground and up to hundreds of metres from the visible track,
//     so the camera jumps there, hidden by the cut.
//   * Surface trains pass through the walker in the open as tunnel trains do.
//   * Every Tube and DLR station is a stop, surface ones included. "Up to the
//     street" at a surface stop steps aside to the street (0.8 s, 12 to 30 m
//     from the track, on ground, out of the water and from under roofs); from
//     the street, E and a surface platform's row eases onto the track.
//   * Branch choice in the open compares the drawn track's headings. Where no
//     track is drawn (or the mapping refused it) the walker stays in the bore.
//   * The walk holds at the M25 map edge: "The map ends here · S walks back".
//   * Small fixes: no line's labels in the bore (main.js); after an arrival
//     at speed a 0.6 s glide back to the stop, then the card; every ease is
//     clamped above the terrain. The portal card is gone.
//   * The street at the station only (fix round 1, D-042 item 1: "only
//     possible to exit them at stations"): the arrival card is on offer on
//     the station's platform and closes when the walker walks off it; off the
//     platform after an arrival, E brings the walker back (brake to rest, the
//     glide, then the card); on the platform at speed (fix round 2), E stops
//     the walker at the station (brake to rest, then the card, after the glide
//     back where the braking carried it off the platform), and at rest it
//     opens the card at once. "Up to the street" is taken from the station, not
//     from where the walker stands, and where the station is shown in the
//     other regime (a covered box with open air inside its platform zone, or
//     the reverse) a cut takes the walker there first. A W or S held as a
//     halt, a glide or the card begins is ignored until it is let go.

import { PEDESTRIAN_TUNABLES, BODY, createBody, stepBody } from './pedestrian-body.js';
import { createScaleEase } from './pedestrian-scale.js';
import {
  buildTunnelNetwork, pointAt, advance, nearestEntrance, chooseStop, nearestStopOnPath, travelDir,
  headingAt, markOpenSections,
} from './pedestrian-tunnels.js';
// ── s30:integrate ── portals from the drawn railway (Lane R's data), preferred to the ground test
import { markOpenSectionsFromTrack } from './pedestrian-tunnels.js';
import { buildOpenTrackIndex } from './open-track.js';
// ── /s30:integrate ──
// ── s01:P ──
import { createOpenAirWalk } from './open-air-walk.js';
// ── /s01:P ──
// ── s30:P ──
import { platformRows, cleanStationName } from './tube-routes.js';
import { createPlatformChooser } from './platform-chooser.js';
import { createTunnelTrains, stepShake } from '../tunnel-trains.js';
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
// ── /s30:P ──
// ── s01:P ──
export const GLIDE_S = 0.6;            // after an arrival at speed: the glide back to the stop, then the card
export const STEP_S = 0.8;             // a surface stop: aside to the street, or from it onto the track
export const STEP_ASIDE_M = [12, 20, 30];
export const TERRAIN_CLEAR_M = 1;      // every ease and the open-air camera stay this far above the terrain
const EDGE_HINT = 'The map ends here · S walks back';
// ── /s01:P ──

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
  let card = null;                        // { kind: 'shaft' | 'arrival', ... } while the chooser is ours
  const trains = createTunnelTrains({ trainSystem: () => ctx.trainSystem, layer: INTERIOR_LAYER });
  let arrived = null;                     // { stop, dismissed } the platform last arrived at
  let transfer = null;                    // { from, to, t, row, bore, open }
  const arrivals = [];                    // test log: { name, lineId, speed, at, seq }
  // ── s02:F ── a running arrival number: tests count rides by it, never by an index into the 64-entry log
  let arrivalSeq = 0;
  // ── /s02:F ──
  let shake = 0, passT = null, lastPass = null;  // the view shake of a pass (tunnel-trains.js stepShake)
  let trackYaw = null;                    // the track's heading last frame, while moving (the view turns with the tunnel)
  // ── /s30:P ──
  // ── s01:P ──
  const openAir = createOpenAirWalk({
    surfaceTrains: () => (typeof ctx.surfaceTrains === 'function' ? ctx.surfaceTrains() : ctx.surfaceTrains) ?? null,
    surfaceRail: () => (typeof ctx.surfaceRail === 'function' ? ctx.surfaceRail() : null),
    trainSystem: () => ctx.trainSystem ?? null,
    getStructuralY: (x, z) => (ctx.getStructuralY || ctx.getTerrainY)(x, z),
    getTerrainY: (x, z) => ctx.getTerrainY(x, z),
    isInsideM25: (x, z) => (typeof ctx.insideWalkBounds === 'function' ? ctx.insideWalkBounds(x, z) : true), // s02:T: the walk's edge is the terrain grid's walk bounds, not the M25 (D-048 item 7)
    VE, document: globalThis.document,
    overground: () => (typeof ctx.overground === 'function' ? ctx.overground() : null),   // s02:O the Overground's trains through the walker
  });
  let regime = 'bore';                    // where the walker in a line is shown: 'bore' or 'open' (the drawn track)
  const shown = {};                       // the point shown in the open (open-air-map.js presentAt)
  let glide = null;                       // { from, to, t, stop } back to the stop after an arrival at speed
  let step = null;                        // { kind: 'exit' | 'entry', from, to, fromYaw, toYaw, t, ... } a surface stop's ease
  let atEdge = false;                     // held at the map edge
  // ── s02:T ──
  let s02Held = false;                    // surface walking held at the terrain grid's walk bounds (soft hold)
  // ── /s02:T ──
  let brakeFrom = null;                   // the speed braking began at (the rate is held at its start)
  // Fix round 1: the street is on offer at the station only. Off the platform after an arrival, E brings
  // the walker back (`halt`: brake to rest, then the glide, then the card); fix round 2: so does E on the
  // platform at speed (brake to rest, then the card, after the glide if the braking left the platform).
  // A W or S held when a halt, a glide or the card began does not walk on (`latch`); a fresh press does.
  let halt = null;                        // { holdM } braking to rest, for the card or the glide back to the stop
  let latch = null;                       // the held W/S (+1 / -1) that is ignored until released
  let lastForward = 0;                    // W/S as read this frame (the latch takes it)
  // ── /s01:P ──

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
    // ── s02:O ── a network built before the Overground existed gains it as soon as it does.
    if (net && !net.ogReady && ctx.tubeNetwork?.overground) force = true;
    // ── /s02:O ──
    if (!force && net && net.paths.length) { markPortals(net); openAir.sync(net); return net; }
    if (!force && net && clock - netTriedAt < NETWORK_RETRY_S) return net;
    netTriedAt = clock;
    const src = ctx.tubeNetwork;
    if (!src) return net;
    try {
      // ── s02:O ── the Overground's branches and stations join those of the Tube and DLR (appended, so
      // every earlier path keeps its id); lineBranchCenterPts and the station markers never see them.
      const og = src.overground ?? null;
      const branches = og ? new Map([...src.branches, ...og.branches]) : src.branches;
      const stationLayers = og ? new Map([...src.stationLayers, ...og.stationLayers]) : src.stationLayers;
      // ── /s02:O ──
      net = buildTunnelNetwork({ THREE, branchesByLine: branches, stationLayers, VE,
        halfSpacing: src.halfSpacing ?? 0 });
      // ── s02:O ──
      net.ogReady = !!og;
      // ── /s02:O ──
    } catch (err) {
      console.warn('[pedestrian] tunnel network', err);
    }
    markPortals(net);
    // s01:P path.open is the drawn track the walker is shown on (open-air-walk.js); the edge of the map.
    openAir.attach(net);
    return net;
  }

  // ── s30:integrate ── Portals where the drawn railway leaves its tunnel. Lane R's
  // surface railway carries each line's open-air classes; the ground test below
  // found no portal on six lines, because the depth model draws most open-air
  // Tube 7 to 32 m underground (the Lane P verifier's blocking finding). The
  // railway is built during the opening; until it exists (and for at most
  // SURFACE_RAIL_WAIT_S of the mode's time) nothing is marked, and a marking
  // made from the ground is replaced as soon as the railway is there.
  const SURFACE_RAIL_WAIT_S = 20;
  let trackIndex = null, trackIndexFor = null;
  function openTrack() {
    const rail = typeof ctx.surfaceRail === 'function' ? ctx.surfaceRail() : null;
    if (!rail?.data || !rail.paths) return null;
    if (trackIndexFor !== rail) {
      trackIndex = buildOpenTrackIndex({ data: rail.data, ownerPaths: rail.paths, overgroundPaths: ctx.overgroundLinePaths?.() ?? null });
      trackIndexFor = rail;
    }
    return trackIndex;
  }
  // ── /s30:integrate ──
  // ── s30:P ── portals: where a line's track reaches the surface (retried until the ground is there)
  function markPortals(n) {
    // ── s30:integrate ──
    if (!n || n.openSource === 'track') return;
    try {
      const idx = openTrack();
      if (idx) { markOpenSectionsFromTrack(n, { classAt: idx.classAt }); return; }
    } catch (err) { console.warn('[pedestrian] portals from the railway', err); }
    if (n.openMarked || (typeof ctx.surfaceRail === 'function' && clock < SURFACE_RAIL_WAIT_S)) return;
    // ── /s30:integrate ──
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
    if (phase === 'tunnel' && tunnel) return regime === 'open' ? null : { path: tunnel.path, s: tunnel.s, dir: tunnel.dir, side: tunnel.side };
    if (phase === 'transfer' && transfer) return transfer.open ? null : { ...transfer.bore };
    if (phase === 'shaft' && shaft && shaft.passage && !shaft.passage.done) {
      if (shaft.dir === 'down') return { path: shaft.stop.path, s: shaft.stop.s, dir: shaft.tunnelDir || 1, side: shaft.side || 0 };
      if (lastBore && lastBore.path === shaft.stop.path) return { ...lastBore, s: shaft.stop.s };
    }
    return null;
  }

  /** The underground view: interior, ribbons and near plane follow the phase. */
  function syncUndergroundView() {
    const bore = currentBore();
    // s01:P in the open (on the drawn track, a change between surface platforms, a step to or from the
    // street) the camera is above ground: no lining, no tunnel trains, the normal near plane.
    const open = (phase === 'tunnel' && regime === 'open') || (phase === 'transfer' && !!transfer?.open) || phase === 'step';
    const below = !open && (phase === 'tunnel' || phase === 'transfer' || (phase === 'shaft' && shaft
      && ctx.camera.position.y < (shaft.stop?.surfaceY ?? shaft.groundY ?? Infinity)));
    if (bore && net) {
      if (phase === 'tunnel') lastBore = bore;
      // Only in the tunnel is the camera surely inside the lining; in the cross
      // passage it is partly outside, where drawing the lining alone would blank the view.
      ctx.tubeInterior?.show(net, bore, { isolate: phase === 'tunnel' });
      // s30:P the walker's own line's trains are drawn inside the bore.
      trains.show(net.paths[bore.path]?.lineId ?? null);
    } else if (open && ctx.tubeInterior?.hideDevicesOnly) {
      // s01:P on the drawn track, the station markers and shafts sized for the sky are hidden as in the bore.
      ctx.tubeInterior.hideDevicesOnly();
      trains.hide();
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
    openAir.ensureLine(n, pick.stop.lineId); // s01:P the walker's line is mapped before it walks
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
    arrived = null; glide = null; halt = null; latch = null; // s30:P s01:P
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
    // ── s02:T ── beyond the M25 the walker may walk the hidden ground (D-048 item 7); the only hold is a
    // soft one at the terrain grid's bounds inset 200 m (ctx.walkHoldBox): clamped back in, the outward
    // velocity dropped, and the hint says so.
    s02Held = false;
    const s02Box = ctx.walkHoldBox;
    if (s02Box) {
      if (body.x < s02Box.minX) { body.x = s02Box.minX; if (body.vx < 0) body.vx = 0; s02Held = true; }
      else if (body.x > s02Box.maxX) { body.x = s02Box.maxX; if (body.vx > 0) body.vx = 0; s02Held = true; }
      if (body.z < s02Box.minZ) { body.z = s02Box.minZ; if (body.vz < 0) body.vz = 0; s02Held = true; }
      else if (body.z > s02Box.maxZ) { body.z = s02Box.maxZ; if (body.vz > 0) body.vz = 0; s02Held = true; }
    }
    // ── /s02:T ──
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
    // ── s02:T ──
    if (s02Held && text === null) text = EDGE_HINT;
    // ── /s02:T ──
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
    glide = null; trackYaw = null; halt = null; latch = null;
    regime = 'bore'; // s01:P a shaft leads to a platform in the bore; a cut follows if the stop is shown in the open
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

  // ── s01:P the walker shown: in its bore, or on the drawn track in the open ──
  const surfaceRatio = () => {
    const st = typeof ctx.surfaceTrains === 'function' ? ctx.surfaceTrains() : null;
    return st?.ratio ?? 1;
  };
  /** Keep a canonical eye point at least TERRAIN_CLEAR_M above the terrain mesh. */
  function aboveTerrain(x, y, z) {
    const g = ctx.getTerrainY?.(x, z);
    return Number.isFinite(g) ? Math.max(y, g + TERRAIN_CLEAR_M * VE * surfaceRatio()) : y;
  }
  /** The walker's lane in the open: its bore's (+1 runs the path's way), else its travel sense. */
  const laneOf = (pos) => pos.side || pos.dir || 1;
  /** Where the camera is for a tunnel state in a regime (writes `shown` in the open). */
  function walkerPoint(pos, reg = regime) {
    const path = net.paths[pos.path];
    if (reg === 'open') {
      const q = openAir.present(path, pos.s, laneOf(pos), shown);
      if (q.mapped) return { x: q.x, y: aboveTerrain(q.x, q.y + P.eye * VE * surfaceRatio(), q.z), z: q.z };
    }
    return pointAt(path, pos.s, {}, pos.side);
  }
  const angleOf = (h) => Math.atan2(-h.x, -h.z);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  /** The mouth's daylight mixed toward white, as CSS (the flare). */
  function flareColour() {
    const d = ctx.tubeInterior?.debug?.()?.daylight;
    if (!Array.isArray(d)) return null;
    const c = new THREE.Color().fromArray(d).lerp(new THREE.Color(1, 1, 1), 0.6);
    return `#${c.getHexString()}`;
  }
  /**
   * The cut: the walk crossed the edge of path.open. Leaving the bore the view
   * turns by the drawn heading less the chord's (the walker keeps looking along
   * the railway) and daylight flares; entering a tunnel, the reverse and a dip.
   */
  function cutTo(open, why = 'walk') {
    const path = net.paths[tunnel.path];
    const chord = headingAt(path, tunnel.s, tunnel.dir);
    const drawn = openAir.mappingOf(path)?.drawnHeading(tunnel.s, tunnel.dir) ?? chord;
    yaw += wrap(open ? angleOf(drawn) - angleOf(chord) : angleOf(chord) - angleOf(drawn));
    trackYaw = null;
    regime = open ? 'open' : 'bore';
    openAir.resetPasses();
    shake = 0; passT = null;
    openAir.startCut(open ? 'flare' : 'dip', { colour: open ? flareColour() : null, at: clock,
      where: { lineId: path.lineId, path: tunnel.path, s: tunnel.s, why } });
  }

  function updateTunnel(dt, use) {
    const n = net;
    if (!n || !n.paths[tunnel.path]) { phase = 'body'; settleAt(ctx.camera.position.x, ctx.camera.position.z, -Infinity); return; }
    const m = readMove();
    // s01:P fix round 1: a W or S held since a halt, a glide or the card began is ignored until let go.
    lastForward = m.forward;
    if (latch !== null && m.forward !== latch) latch = null;
    const fwd = latch !== null ? 0 : m.forward;
    const want = facing();
    const headingOf = openAir.headingOf;
    let crossed = [];
    atEdge = false;
    if (fwd !== 0) { glide = null; halt = null; }   // W or S cancels the glide back, or the halt before it
    if (glide) {
      // s01:P back to the stop after an arrival at speed, then the card.
      glide.t += dt;
      const k = Math.min(1, glide.t / GLIDE_S);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      tunnel.s = glide.from + (glide.to - glide.from) * e;
      tunnelSpeed = 0;
      if (k >= 1) { const stop = glide.stop; glide = null; if (!card) openArrivalCard(stop); }
    } else {
      // s30:P the tunnel walk (10x the run) and Shift sprint, both Physics tunables.
      const target = fwd === 0 ? 0 : (m.sprint ? P.tunnelSprint : P.tunnelWalk);
      // Reach the walk or the sprint in about half a second, and stop from either
      // in half a second: s01:P the braking rate is held at the one it began at
      // (from 200 m/s, 0.5 s and 50 m, as the overshoot fix assumes), where it
      // used to ease off with the speed and took 1.1 s and 85 m from the sprint.
      if (target < tunnelSpeed - 1e-9) brakeFrom = Math.max(brakeFrom ?? 0, tunnelSpeed);
      else brakeFrom = null;
      const accel = Math.max(P.accel, 2 * Math.max(P.tunnelWalk, target, brakeFrom ?? tunnelSpeed));
      // Speed along what is shown eases toward the target (inertia), in real m/s.
      const dv = target - tunnelSpeed;
      tunnelSpeed += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);
      const path0 = n.paths[tunnel.path];
      if (tunnelSpeed > 0.001) {
        const dirWant = fwd >= 0 ? want : { x: -want.x, z: -want.z };
        // Keep the last intent while coasting to a stop.
        tunnel.want = fwd !== 0 ? dirWant : (tunnel.want || dirWant);
        // s01:P the direction first, so the distance is measured the way the walker goes: in the open
        // along the drawn track (60 and 200 m/s are track speeds), in the bore along the chord.
        tunnel.dir = travelDir(path0, tunnel.s, tunnel.want, tunnel.dir, headingOf);
        const d = openAir.chordDistance(path0, tunnel.s, tunnel.dir, tunnelSpeed * dt);
        const r = advance(n, tunnel, d, tunnel.want, { holdAtPortals: false, headingOf, branchHeadingOf: openAir.branchHeadingOf });
        crossed = r.crossed || [];
        atEdge = !!r.edge;
        if (r.stopped) tunnelSpeed = 0;
      } else {
        tunnelSpeed = 0;
        tunnel.dir = travelDir(path0, tunnel.s, want, tunnel.dir, headingOf);
      }
    }
    // s01:P the cut, where the walk crosses the edge of the drawn track in the open.
    const pathNow = n.paths[tunnel.path];
    const openNow = openAir.isOpen(pathNow, tunnel.s);
    if (openNow !== (regime === 'open')) cutTo(openNow);
    if (!atEdge) atEdge = (pathNow.edge || []).some(([a, b]) => Math.abs(tunnel.s - a) < 0.5 || Math.abs(tunnel.s - b) < 0.5);
    // s30:P arrival: every platform crossed inside this move, whatever the speed.
    for (const c of crossed) arrive(c.stop, tunnelSpeed);
    // s30:P the view turns with the track: at 60 to 200 m/s a bend comes and
    // goes in a second, faster than anyone steers a mouse. The look offset the
    // walker has set is kept; only the track's own turning is added. (s01:P in
    // the open, the drawn track's.)
    if (tunnelSpeed > 0.001) {
      const hm = headingOf(pathNow, tunnel.s, tunnel.dir);
      const th = Math.atan2(-hm.x, -hm.z);
      if (trackYaw !== null) {
        const d = wrap(th - trackYaw);
        if (Math.abs(d) < 0.6) yaw += d;   // a turn-round or a branch swap is not a bend
      }
      trackYaw = th;
    } else {
      trackYaw = null;
    }
    const p = walkerPoint(tunnel);
    // Trains passing through the walker: sound and a short shake, never a stop.
    // s30:P in the bore its own line's tunnel trains; s01:P in the open its line's surface trains, in its lane.
    const pass = regime === 'open'
      ? openAir.surfacePass(pathNow, shown, laneOf(tunnel), dt)
      : trains.update(ctx.tubeInterior?.windowPoints ?? null, p, dt, { VE });
    lastPass = pass;
    // Brief whatever the speeds, and none at all from a train standing round a
    // walker at rest (fix round 2: it shook for the whole dwell).
    ({ shake, passT } = stepShake({ shake, passT }, pass, dt));
    placeCamera(p.x, p.y, p.z);
    lastEvents = [];
    sound(tunnelSpeed, pass);

    const lineName = routesOf(pathNow.lineId)?.lineName || pathNow.lineId;
    const onPlatform = nearestStopOnPath(n, tunnel.path, tunnel.s, PLATFORM_ZONE_M);
    // s01:P fix round 1: off the platform, the stop arrived at as it lies on the walker's own path (a
    // junction station is a stop of each of its branches); if it is not on it, it cannot be walked back to.
    let back = null;
    if (arrived && !onPlatform) {
      back = arrived.stop.path === tunnel.path ? arrived.stop
        : pathNow.stops.find(x => sameStation(x.stop, arrived.stop))?.stop ?? null;
    }
    // Well past the station arrived at (or on another's platform, or off its path): forget the arrival and close its card.
    if (arrived && ((onPlatform && !sameStation(onPlatform, arrived.stop)) || (!onPlatform && !back)
      || arrivalDistance(back ?? arrived.stop) > (halt ? halt.holdM : ARRIVAL_HOLD_M))) {
      if (card?.kind === 'arrival') closeCard();
      arrived = null; back = null;
      glide = null;
    }
    // s01:P fix round 1 (D-042 item 1, "only possible to exit them at stations"): the card, and with it the
    // street, is on offer at the station only. Walking off the platform closes it.
    if (card?.kind === 'arrival' && !onPlatform && !glide) closeCard();
    const stop = onPlatform ?? back;
    if (stop) {
      const name = cleanLabel(stop.name);
      if (card?.kind === 'arrival') hint(`${name}: choose (1-9 or click) · W/S walk on · Esc to stay`);
      else if (onPlatform && halt) hint(`Stopping at ${name} · W/S walk on`);   // s01:P fix round 2
      else if (onPlatform) hint(`E: exits and changes at ${name} · W/S walk · Shift sprint`);
      else if (glide || halt) hint(`Back to ${name} · W/S walk on`);
      else hint(`E: back to ${name} · W/S walk on · Shift sprint`);
      if (use) {
        if (card?.kind === 'arrival') closeCard();
        else if (onPlatform && tunnelSpeed < REST_MPS) { glide = null; halt = null; openArrivalCard(onPlatform); }
        else if (onPlatform) {
          // s01:P fix round 2: E on the platform at speed (the natural press, in reaction to the arrival
          // banner) stops the walker at this station: brake to rest, then the card where it stands on the
          // platform, or, where the braking carried it off the platform, the glide back and then the card.
          // The card used to open at once and was closed again as the braking took the walker out of the
          // zone, leaving it at rest past the station with no card and the arrival marked as seen.
          glide = null;
          if (!arrived) arrived = { stop: onPlatform, dismissed: false };   // on approach, or after a change
          halt = { holdM: Math.max(ARRIVAL_HOLD_M, arrivalDistance(onPlatform) + tunnelSpeed * 0.3 + 5) };
          latch = lastForward !== 0 ? lastForward : null;
          arrived.dismissed = false;
        } else if (!glide && !halt) {
          // s01:P off the platform E brings the walker back: brake to rest, glide back to the stop, then
          // the card there (the street is never offered away from the station). The arrival is kept for
          // as long as the braking takes.
          halt = { holdM: Math.max(ARRIVAL_HOLD_M, arrivalDistance(back) + tunnelSpeed * 0.3 + 5) };
          latch = lastForward !== 0 ? lastForward : null;
          arrived.dismissed = false;
        }
      } else if (!card && !glide && arrived && (halt || !arrived.dismissed) && tunnelSpeed < REST_MPS) {
        // s01:P at rest past the platform after an arrival at speed (or after E there): glide back to the
        // stop, then the card; on the platform, the card.
        if (!onPlatform) {
          glide = { from: tunnel.s, to: back.s, t: 0, stop: back };
          latch = lastForward !== 0 ? lastForward : null;
        } else {
          openArrivalCard(stop);
        }
        halt = null;
      }
      // ── s02:F ── (D-047 walk-stopping-hint) the hint was chosen above, before the card opened in this very
      // frame, so "Stopping at X" showed for one frame after the card was up: re-issue the card's own hint.
      if (card?.kind === 'arrival') hint(`${name}: choose (1-9 or click) · W/S walk on · Esc to stay`);
      // ── /s02:F ──
    } else if (atEdge) {
      hint(EDGE_HINT); // s01:P
    } else {
      hint(`${lineName} · W/S walk · Shift sprint · face a branch to take it`);
    }
    if (halt && !arrived && tunnelSpeed < REST_MPS) halt = null;   // at rest with nothing to go back to
  }

  /** How far the walker is from a stop it arrived at: along the path when on it, else in plan (s01:P). */
  function arrivalDistance(stop) {
    if (stop.path === tunnel.path) return Math.abs(tunnel.s - stop.s);
    const q = pointAt(net.paths[tunnel.path], tunnel.s, {}, 0);
    return Math.hypot(q.x - stop.x, q.z - stop.z);
  }

  // ── s30:P arrival, cards, changes of line ─────────────────────────────────

  const routesOf = (lineId) => ctx.tubeRoutes?.get?.(lineId) ?? null;
  const colourOf = (lineId) => ctx.lineColour?.(lineId) ?? null;
  function sameStation(a, b) {
    return !!a && !!b && (a === b || (a.lineId === b.lineId && cleanLabel(a.name) === cleanLabel(b.name)));
  }

  function arrive(stop, speed) {
    arrivals.push({ name: cleanLabel(stop.name), lineId: stop.lineId, path: stop.path, s: stop.s, speed, at: clock,
      regime }); // s01:P where it was shown
    if (arrivals.length > 64) arrivals.shift();
    // ── s02:F ──
    arrivals[arrivals.length - 1].seq = ++arrivalSeq;
    // ── /s02:F ──
    if (card?.kind === 'arrival') closeCard();
    arrived = { stop, dismissed: false };
    glide = null;
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
      },
    });
  }

  /** s01:P a stop is at the surface when the walk there is shown on the drawn track (checked at the moment of use). */
  function surfaceStop(stop) {
    const path = net?.paths[stop.path];
    return !!path && openAir.isOpen(path, stop.s);
  }

  function openShaftCard(near) {
    // Rebuilt first, as the descent always did: a terrain resnap replaces the centrelines.
    const n = network(true);
    const entrance = n ? nearestEntrance(n, near.x, near.z, ENTRANCE_RADIUS_M) : null;
    if (!entrance) return false;
    // s01:P every line here is mapped now, so a surface platform is known as one.
    for (const lineId of new Set(entrance.stops.map(st => st.lineId))) openAir.ensureLine(n, lineId);
    const rows = platformRows(n, entrance, { tubeRoutes: ctx.tubeRoutes ?? new Map(), lineColour: colourOf })
      .map(r => {
        const surface = surfaceStop(r.stop);
        // In the open a platform faces the way its drawn track leaves it.
        const heading = surface ? openAir.headingOf(n.paths[r.stop.path], r.stop.s, r.dir) : r.heading;
        return { ...r, kind: 'platform', surface, heading };
      });
    if (!rows.length) return false;
    const kicker = rows.every(r => r.surface) ? 'To the platforms' : 'Down to the platforms';
    openCard('shaft', { kicker, title: cleanLabel(entrance.name), rows, extra: { entrance } });
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
    latch = lastForward !== 0 ? lastForward : null; // s01:P a W held as it opens does not walk the walker off it
    return true;
  }

  function pickRow(kind, row, extra) {
    if (kind === 'shaft' && row.kind === 'platform') {
      if (row.surface) startSurfaceEntry(row);   // s01:P from the street onto the track
      else {
        yaw = yawFor(row.heading);
        startDescent(extra.entrance, { stop: row.stop, dir: row.dir });
      }
    } else if (kind === 'arrival' && row.kind === 'street') {
      exitAt(extra.stop); // s01:P
    } else if (kind === 'arrival' && row.kind === 'change') {
      startTransfer(row);
    }
  }

  function startTransfer(row) {
    const n = net;
    const path = n?.paths[row.stop.path];
    if (!path) return false;
    openAir.ensureLine(n, row.stop.lineId); // s01:P
    const side = n.halfSpacing > 0 ? row.dir : 0;
    const bore = { path: row.stop.path, s: row.stop.s, dir: row.dir, side };
    // s01:P the other platform may be in the open: shown on its drawn track, facing along it.
    const toOpen = openAir.isOpen(path, row.stop.s), fromOpen = regime === 'open';
    const to = walkerPoint(bore, toOpen ? 'open' : 'bore');
    const heading = toOpen ? openAir.headingOf(path, row.stop.s, row.dir) : row.heading;
    if (toOpen !== fromOpen) {
      // A change between the bore and the open air is a cut, never an ease through the ground.
      tunnel = { path: row.stop.path, s: row.stop.s, dir: row.dir, side };
      tunnelSpeed = 0;
      yaw = yawFor(heading); trackYaw = null;
      arrived = null; glide = null; halt = null; latch = null;
      regime = toOpen ? 'open' : 'bore';
      openAir.resetPasses();
      openAir.startCut(toOpen ? 'flare' : 'dip', { colour: toOpen ? flareColour() : null, at: clock,
        where: { lineId: row.lineId, path: row.stop.path, s: row.stop.s, why: 'change' } });
      phase = 'tunnel';
      transfer = null;
      placeCamera(to.x, to.y, to.z);
      hint(null);
      chooser.banner(cleanLabel(row.stop.name), { colour: colourOf(row.stop.lineId) });
      return true;
    }
    transfer = { from: ctx.camera.position.clone(), to, t: 0, row, open: toOpen, heading, bore };
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
    const x = f.x + (t.x - f.x) * e, z = f.z + (t.z - f.z) * e;
    const y = f.y + (t.y - f.y) * e;
    // s01:P between two surface platforms the ease stays above the ground.
    placeCamera(x, transfer.open ? aboveTerrain(x, y, z) : y, z);
    if (k >= 1) {
      const row = transfer.row;
      tunnel = { path: row.stop.path, s: row.stop.s, dir: row.dir, side: transfer.bore.side };
      yaw = yawFor(transfer.heading ?? row.heading);
      trackYaw = null;
      regime = transfer.open ? 'open' : 'bore';
      arrived = null;   // on the new platform: E for its card, no card by itself
      phase = 'tunnel';
      transfer = null;
      hint(null);
      chooser.banner(cleanLabel(row.stop.name), { colour: colourOf(row.stop.lineId) });
    }
  }
  // ── /s30:P ──

  // ── s01:P a surface stop: aside to the street, or from the street onto the track ──
  /**
   * "Up to the street": from the station arrived at, wherever on its platform
   * the walker stands (fix round 1: it was taken from the walker's own point,
   * up to 250 m past the station). A surface stop steps aside, a stop in the
   * bore goes up its shaft; where the station is shown in the other regime
   * from the walker (a covered box with the open air inside its platform zone,
   * or the reverse), a cut takes the walker there first, never an ease through
   * the ground.
   */
  function exitAt(stop) {
    const surface = surfaceStop(stop);
    if (tunnel && net?.paths[stop.path] && surface !== (regime === 'open')) {
      tunnel = { ...tunnel, path: stop.path, s: stop.s };
      tunnelSpeed = 0;
      cutTo(surface, 'exit');
      const p = walkerPoint(tunnel);
      placeCamera(p.x, p.y, p.z);
      if (!surface) lastBore = { path: tunnel.path, s: tunnel.s, dir: tunnel.dir, side: tunnel.side };
    }
    if (surface) startSurfaceExit(stop);
    else startAscent(stop);
  }

  /**
   * "Up to the street" at a surface stop: a STEP_S ease to the station's point
   * on the drawn track, offset STEP_ASIDE_M to either side of it; the first
   * offset on the ground, out of the water and not under a roof wins (the
   * walker ends on the ground, never in a shaft or on a roof). At each offset
   * the side toward the station's entrance is tried first.
   */
  function startSurfaceExit(stop) {
    const path = net.paths[stop.path];
    const q = path ? openAir.present(path, stop.s, 0, {}) : { mapped: false };
    if (!q.mapped) { startAscent(stop); return false; }
    const nx = -q.hz, nz = q.hx;   // across the track
    const ent = entranceOf(stop) ?? stop;
    const toward = Math.sign(nx * (ent.x - q.x) + nz * (ent.z - q.z)) || 1;
    let best = null;
    for (const off of STEP_ASIDE_M) {
      for (const sg of [toward, -toward]) {
        const x = q.x + nx * off * sg, z = q.z + nz * off * sg;
        const g = ctx.collision.groundHeightAt(x, z);
        if (g === null || g === undefined) continue;
        if (ctx.collision.waterAt(x, z)) continue;
        const top = ctx.collision.standHeightAt(x, z, Infinity, 0);
        if (top !== null && top !== undefined && top > g + 0.5 * VE) continue;   // a roof over it
        best = { x, z, g, off: off * sg };
        break;
      }
      if (best) break;
    }
    if (!best) {
      // Nowhere clear within 30 m: the nearest ground beside the track.
      const x = q.x + nx * STEP_ASIDE_M[0] * toward, z = q.z + nz * STEP_ASIDE_M[0] * toward;
      best = { x, z, g: ctx.collision.groundHeightAt(x, z) ?? ctx.getTerrainY(x, z) ?? ctx.camera.position.y - P.eye * VE, off: STEP_ASIDE_M[0] * toward, fallback: true };
    }
    step = { kind: 'exit', from: ctx.camera.position.clone(), to: { x: best.x, y: best.g + P.eye * VE, z: best.z },
      fromYaw: yaw, toYaw: yaw, t: 0, stop, ground: best.g, off: best.off, fallback: !!best.fallback,
      station: { x: q.x, z: q.z } };   // the station's point on the drawn track (tests)
    phase = 'step';
    tunnel = null; arrived = null; glide = null; halt = null; latch = null;
    regime = 'bore';
    hint(`Out to the street at ${cleanLabel(stop.name)}`);
    return true;
  }

  /** From the street, E and a surface platform's row: a STEP_S ease onto the track, facing along it. */
  function startSurfaceEntry(row) {
    const n = net;
    const path = n?.paths[row.stop.path];
    if (!path) return false;
    openAir.ensureLine(n, row.stop.lineId);
    const side = n.halfSpacing > 0 ? row.dir : 0;
    const pos = { path: row.stop.path, s: row.stop.s, dir: row.dir, side };
    const to = walkerPoint(pos, 'open');
    const heading = openAir.headingOf(path, row.stop.s, row.dir);
    step = { kind: 'entry', from: ctx.camera.position.clone(), to, fromYaw: yaw, toYaw: yaw + wrap(yawFor(heading) - yaw),
      t: 0, row, pos };
    phase = 'step';
    body.vx = body.vy = body.vz = 0; body.jet = false;
    hint(`${row.label}`);
    return true;
  }

  function updateStep(dt) {
    sound(0);
    step.t += dt;
    const k = Math.min(1, step.t / STEP_S);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const f = step.from, t = step.to;
    const x = f.x + (t.x - f.x) * e, z = f.z + (t.z - f.z) * e;
    yaw = step.fromYaw + (step.toYaw - step.fromYaw) * e;
    placeCamera(x, aboveTerrain(x, f.y + (t.y - f.y) * e, z), z);
    if (k < 1) return;
    if (step.kind === 'exit') {
      body.x = t.x; body.z = t.z; body.y = step.ground;
      body.vx = body.vy = body.vz = 0; body.state = 'ground';
      phase = 'body';
      hint(null);
    } else {
      tunnel = { ...step.pos };
      tunnelSpeed = 0; trackYaw = null; arrived = null;
      regime = 'open';
      phase = 'tunnel';
      hint(null);
      chooser.banner(cleanLabel(step.row.stop.name), { colour: colourOf(step.row.stop.lineId) });
    }
    step = null;
  }
  // ── /s01:P ──

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
      card = null; chooser.close(); arrived = null; transfer = null; shake = 0; passT = null; lastPass = null;
      glide = null; halt = null; latch = null; step = null; regime = 'bore'; atEdge = false; openAir.clearCut(); openAir.resetPasses(); // s01:P
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
      arrived = null; transfer = null; shake = 0; passT = null;
      glide = null; halt = null; latch = null; step = null; regime = 'bore'; openAir.clearCut(); openAir.resetPasses(); // s01:P
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
      // s30:P out of the bore (a transfer, the shaft, the street) a shake only dies away.
      if (phase !== 'tunnel' && shake > 0) ({ shake, passT } = stepShake({ shake, passT }, null, dt));
      // s01:P every other line is mapped onto its drawn track lazily, within a budget a frame; not while
      // the entry eases Master to real scale (the DLR's drawn deck follows Master, so its mapping would be
      // rebuilt at every step of the ease: 146 ms of it, measured).
      if (net && !ease.running) openAir.pump(net);
      if (phase === 'enter') updateEnter(dt);
      else if (phase === 'body') updateBody(dt, use, jump);
      else if (phase === 'shaft') updateShaft(dt);
      else if (phase === 'tunnel') updateTunnel(dt, use);
      else if (phase === 'transfer') updateTransfer(dt); // s30:P
      else if (phase === 'step') updateStep(dt); // s01:P
      openAir.stepCut(dt); // s01:P the flare or the dip, on the mode clock
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
        transfer: transfer ? { t: transfer.t, lineId: transfer.row.lineId, label: transfer.row.label, open: !!transfer.open } : null,
        trains: trains.debug(),
        shake, passT,
        // ── /s30:P ──
        // ── s01:P ──
        clock, regime,
        shown: tunnel && regime === 'open' ? { x: shown.x, y: shown.y, z: shown.z, hx: shown.hx, hz: shown.hz, open: shown.open,
          extra: shown.extra, lane: shown.lane, ts: shown.ts } : null,
        open: n && tunnel ? (n.paths[tunnel.path]?.open || []).map(iv => iv.slice()) : null,
        edge: n && tunnel ? (n.paths[tunnel.path]?.edge || []).map(iv => iv.slice()) : null,
        atEdge,
        glide: glide ? { from: glide.from, to: glide.to, t: glide.t } : null,
        halt: !!halt, latch,
        step: step ? { kind: step.kind, t: step.t, to: { ...step.to }, off: step.off ?? null, fallback: !!step.fallback,
          station: step.station ? { ...step.station } : null, stop: step.stop ? { name: cleanLabel(step.stop.name), path: step.stop.path, s: step.stop.s } : null } : null,
        openAir: openAir.debug(),
        lastPass: lastPass ? { inside: !!lastPass.inside, insideSpeed: lastPass.insideSpeed ?? 0, rush: lastPass.rush ?? 0, rumble: lastPass.rumble ?? 0 } : null,
        // ── /s01:P ──
      };
    },
    /** Place the body on the surface at (x, z), skipping the entry ease (tests). */
    place(x, z, { yaw: y = yaw, pitch: p = 0 } = {}) {
      if (!active) return false;
      yaw = y; pitch = p;
      enter = null; shaft = null; tunnel = null;
      card = null; chooser.close(); arrived = null; transfer = null; // s30:P
      glide = null; halt = null; latch = null; step = null; regime = 'bore'; openAir.clearCut(); // s01:P
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
      card = null; chooser.close(); arrived = null;
      shake = 0; passT = null;   // at rest, and no pass carried over from where the walker was
      // s01:P the walker's line is mapped now; shown on the drawn track where that is open.
      openAir.ensureLine(n, n.paths[path].lineId);
      glide = null; halt = null; latch = null; step = null; trackYaw = null; openAir.clearCut(); openAir.resetPasses();
      const sd = side ?? (n.halfSpacing > 0 ? dir : 0);
      tunnel = { path, s, dir, side: sd };
      tunnelSpeed = 0;
      regime = openAir.isOpen(n.paths[path], s) ? 'open' : 'bore';
      yaw = yawFor(openAir.headingOf(n.paths[path], s, dir)); pitch = 0;
      phase = 'tunnel';
      const q = walkerPoint(tunnel);
      placeCamera(q.x, q.y, q.z);
      return true;
    },
    // ── s01:P ── test surface
    get openAir() { return openAir; },
    /** Per line: paths, mapped, open metres, build ms, refused stretches and Lane T's refusal counts (the brief's report). */
    openAirReport() { return openAir.debug(network()); },
    // ── s02:O ── per Overground line: stations, stops, joins, gaps, stubs and the stations that are not stops, with reasons
    overgroundReport() { return ctx.tubeNetwork?.overgroundReport?.() ?? null; },
    // ── /s02:O ──
    /** The point shown for a tunnel state (tests): { x, y, z } and the regime it is shown in. */
    presentAt(pos) { if (!net?.paths[pos.path]) return null; const reg = openAir.isOpen(net.paths[pos.path], pos.s) ? 'open' : 'bore';
      return { ...walkerPoint(pos, reg), regime: reg }; },
    // ── /s01:P ──
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
