/**
 * trains.js — Interior-lit tube trains with authentic 1972 Stock window pattern
 *
 * Dark capsule bodies with procedural window textures: 6 carriages, each with
 * 4 door-pairs + 3 single passenger windows matching deep-tube stock rhythm.
 * Glow via MeshBasicMaterial (toneMapped: false) + UnrealBloomPass — no real
 * lights needed.
 */
import * as THREE from 'three';

// ─── Per-line frequency config (5pm weekday peak, tph per direction) ─
const LINE_CONFIG = {
  'victoria':         { tph: 36, dwellSec: 25 },
  'central':          { tph: 34, dwellSec: 30 },
  'jubilee':          { tph: 30, dwellSec: 30 },
  'northern':         { tph: 24, dwellSec: 30 },
  'piccadilly':       { tph: 24, dwellSec: 30 },
  'bakerloo':         { tph: 21, dwellSec: 30 },
  'waterloo-city':    { tph: 19, dwellSec: 20 },
  'dlr':              { tph: 18, dwellSec: 20 },
  'district':         { tph: 12, dwellSec: 30 },
  'metropolitan':     { tph: 12, dwellSec: 30 },
  'circle':           { tph:  6, dwellSec: 30 },
  'hammersmith-city':  { tph:  6, dwellSec: 30 },
};
const LINE_CONFIG_DEFAULT = { tph: 12, dwellSec: 28 };

// ─── Train dimensions ───────────────────────────────────────────────
const CAPSULE_RADIUS = 3.8;       // fills ~84% of 4.5m tunnel radius
const CAPSULE_LENGTH = 96;        // 6 × 16m carriages
const NUM_CARRIAGES = 6;
const STRIP_LENGTH = 93;          // window zone (inset from hemispherical caps)
const STRIP_HEIGHT = 2.0;         // window band height
const STRIP_Y = 0.4;              // above capsule centre (where windows sit)
const STRIP_X = 4.0;              // outside capsule surface at STRIP_Y

// ─── Shared GPU resources (created once, reused by all trains) ──────
let _capsuleGeo = null;
let _stripGeo = null;
let _windowTex = null;

function ensureSharedResources() {
  if (!_capsuleGeo) {
    _capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 8, 16);
    _capsuleGeo.rotateX(Math.PI / 2); // Y-up default → Z-forward for travel
  }
  if (!_stripGeo) {
    _stripGeo = new THREE.PlaneGeometry(STRIP_LENGTH, STRIP_HEIGHT);
    _stripGeo.rotateY(Math.PI / 2); // face +X (outward from train sides)
  }
  if (!_windowTex) _windowTex = buildWindowTexture();
}

// ─── Procedural window texture (1972 Stock pattern) ─────────────────
//
// Canvas: full train length (6 carriages). Per carriage:
//   [margin] DD _ W _ DD _ W _ DD _ W _ DD [margin]
// DD = door pair (two tall windows + thin divider), W = single window.
// Dark coupling gaps between carriages.
//
function buildWindowTexture() {
  const W = 2048, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const carriageW = W / NUM_CARRIAGES;
  const couplingGap = carriageW * 0.045; // dark gap at carriage joints

  ctx.fillStyle = '#ffd860';
  for (let c = 0; c < NUM_CARRIAGES; c++) {
    const x0 = c * carriageW + couplingGap / 2;
    const cw = carriageW - couplingGap;
    stampCarriage(ctx, x0, cw, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Draw one carriage's worth of windows into the canvas. */
function stampCarriage(ctx, x0, cw, ch) {
  const margin = cw * 0.055; // end caps (cab/vestibule — no windows)
  const zoneX = x0 + margin;
  const zoneW = cw - 2 * margin;

  // Door windows: taller (like the reference double-doors).
  // Single windows: shorter, set slightly lower.
  const dH = ch * 0.70, dY = ch * 0.15;
  const sH = ch * 0.52, sY = ch * 0.22;
  const r = 3; // corner radius (rounded rect, characteristic of Tube stock)

  // Relative unit system matching reference proportions:
  //   door window = 7u, divider = 1.8u, single window = 8u, gap = 4.5u
  //   door pair = 7 + 1.8 + 7 = 15.8u
  //   total = 4×15.8 + 3×8 + 6×4.5 = 63.2 + 24 + 27 = 114.2u
  const U = zoneW / 114.2;
  let x = zoneX;

  for (let i = 0; i < 4; i++) {
    // Door pair — two tall windows with thin pillar between
    ctx.beginPath(); ctx.roundRect(x, dY, 7 * U, dH, r); ctx.fill();
    x += (7 + 1.8) * U;
    ctx.beginPath(); ctx.roundRect(x, dY, 7 * U, dH, r); ctx.fill();
    x += 7 * U;

    if (i < 3) {
      x += 4.5 * U; // gap
      // Single passenger window — shorter, slightly lower
      ctx.beginPath(); ctx.roundRect(x, sY, 8 * U, sH, r); ctx.fill();
      x += (8 + 4.5) * U;
    }
  }
}

// ─── Temp vector (reused per frame to avoid GC) ─────────────────────
const _lookTarget = new THREE.Vector3();

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create the shared train system (call once after scene/renderer creation).
 */
export function createTrainSystem({ scene, renderer, camera }) {
  return { scene, renderer, camera, allTrains: [] };
}

/**
 * Create multiple trains on a pair of curves, count derived from line
 * frequency (tph) and end-to-end travel time so busier/longer lines
 * naturally get more trains.  Each direction is phased independently
 * so trains never synchronise at stations.
 */
export function createTrains({ system, leftCurve, rightCurve, stationUs, lineId, colour, group }) {
  const cfg = LINE_CONFIG[lineId] || LINE_CONFIG_DEFAULT;
  const lengthM = leftCurve.getLength();
  const avgSpeedMps = 12; // ~43 km/h including dwell
  const transitTimeSec = lengthM / avgSpeedMps;
  const count = Math.max(1, Math.round((cfg.tph / 3600) * transitTimeSec));

  const trains = [];
  const spacing = 1 / Math.max(1, count);

  // Forward direction — evenly spaced with proportional jitter
  for (let i = 0; i < count; i++) {
    const phase = (i * spacing) + (Math.random() - 0.5) * spacing * 0.15;
    trains.push(createTrain({ system, curve: leftCurve, stationUs, lineId, colour, dir: +1, phase, group }));
  }

  // Reverse direction — same even spacing, independent offset
  const reverseOffset = Math.random() * spacing; // shift whole fleet by up to one gap
  for (let i = 0; i < count; i++) {
    const phase = (i * spacing) + reverseOffset + (Math.random() - 0.5) * spacing * 0.15;
    trains.push(createTrain({ system, curve: rightCurve, stationUs, lineId, colour, dir: -1, phase, group }));
  }

  return trains;
}

/**
 * Create a single train and add it to the system.
 */
export function createTrain({ system, curve, stationUs, lineId, colour, dir, phase, group }) {
  ensureSharedResources();

  const train = new THREE.Group();
  train.name = `train-${lineId}-${dir > 0 ? 'fwd' : 'rev'}`;

  // ── Capsule body + textured window strips ──
  const nearGroup = new THREE.Group();
  nearGroup.name = 'near';

  // Dark capsule body — faint line-colour emissive for silhouette underground
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.7,
    metalness: 0.1,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.03,
  });
  nearGroup.add(new THREE.Mesh(_capsuleGeo, bodyMat));

  // Window strips with procedural 1972 Stock texture
  const winMat = new THREE.MeshBasicMaterial({
    map: _windowTex,
    alphaTest: 0.5,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const wL = new THREE.Mesh(_stripGeo, winMat);
  wL.position.set(-STRIP_X, STRIP_Y, 0);
  nearGroup.add(wL);

  const wR = new THREE.Mesh(_stripGeo, winMat);
  wR.position.set(STRIP_X, STRIP_Y, 0);
  nearGroup.add(wR);

  train.add(nearGroup);

  // ── Simulation userData ──
  const cfg = LINE_CONFIG[lineId] || LINE_CONFIG_DEFAULT;
  const cruiseMps = lineId === 'victoria' ? 14.5 : 12.0;
  const dwellSec = Math.max(15, cfg.dwellSec + (Math.random() - 0.5) * 8); // ±4s variance, min 15
  train.userData = {
    t: ((phase % 1) + 1) % 1,
    curve, dir,
    curveLengthM: curve.getLength(),
    stationUs,
    nextStationIndex: dir === 1 ? 0 : stationUs.length - 1,
    cruiseMps,
    dwellSec,
    _pausedLeft: 0,
    lineId,
    nearGroup,
    dispose() {
      bodyMat.dispose();
      winMat.dispose();
    },
  };

  train.position.copy(curve.getPointAt(train.userData.t));
  group.add(train);
  system.allTrains.push(train);
  return train;
}

/**
 * Per-frame update: simulation and orientation.
 */
export function updateTrains(system, sim, camera, dt) {
  const simDt = sim.paused ? 0 : (dt * sim.timeScale);

  for (const train of system.allTrains) {
    const ud = train.userData;

    // Dwell at stations
    if (ud._pausedLeft > 0) {
      ud._pausedLeft = Math.max(0, ud._pausedLeft - simDt);
      orient(train);
      continue;
    }

    // Advance along curve
    const du = (ud.cruiseMps * simDt) / Math.max(1e-6, ud.curveLengthM);
    let u = ud.t + ud.dir * du;

    // Wrap
    if (u >= 1) u -= 1;
    if (u < 0) u += 1;

    // Station arrival detection
    const stations = ud.stationUs;
    if (stations.length > 0) {
      const idx = ud.nextStationIndex;
      const targetU = stations[idx];
      const prevU = ud.t;
      const crossed = ud.dir === 1
        ? (prevU <= targetU && u >= targetU) || (prevU > u && (u >= targetU || prevU <= targetU))
        : (prevU >= targetU && u <= targetU) || (prevU < u && (u <= targetU || prevU >= targetU));

      if (crossed) {
        u = targetU;
        ud._pausedLeft = ud.dwellSec;
        ud.nextStationIndex = ud.dir === 1
          ? (idx + 1) % stations.length
          : (idx - 1 + stations.length) % stations.length;
      }
    }

    ud.t = u;
    train.position.copy(ud.curve.getPointAt(u));
    orient(train);
  }
}

/**
 * Orient train along curve tangent.
 */
function orient(train) {
  const ud = train.userData;
  const uAhead = Math.min(ud.t + 0.001, 0.999);
  _lookTarget.copy(ud.curve.getPointAt(uAhead));
  train.lookAt(_lookTarget);

  if (ud.dir === -1) train.rotateY(Math.PI);
}

/**
 * Remove old trains from system, dispose GPU resources.
 */
export function disposeTrains(system, trainsToRemove) {
  for (const train of trainsToRemove) {
    const idx = system.allTrains.indexOf(train);
    if (idx >= 0) system.allTrains.splice(idx, 1);
    if (train.userData.dispose) train.userData.dispose();
    if (train.parent) train.parent.remove(train);
  }
}
