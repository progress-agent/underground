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
  addToBatch(group, train, lineId, colour); // s24:R
  return train;
}

// ── s24:R ── Per-line train batches (sprint 24Sep26h, D-038, fix round 2).
// Each train used to be three draw calls (capsule body plus two window
// strips) with its own copy of two materials, so a line of 40 trains cost 120
// draws that all share one geometry pair and, within the line, one colour.
// A batch draws a whole line's trains as two InstancedMeshes: bodies (one
// instance per train) and window strips (two per train). Colour stays
// per-line, in the material, so D-015 holds: no per-instance colour.
//
// Picture: every train part is opaque (the strips are alphaTest cutouts, not
// transparent), so draw order inside the batch cannot change a pixel; the
// depth test decides, exactly as it did for the separate meshes. Instance
// matrices are the train's own local matrix (and that matrix times the strip
// offset), relative to the line group the batch also lives in, so hiding a
// line (solo filter) hides its batch with it.
//
// The per-train meshes stay in place, hidden, so the economy switches off at
// runtime to the e367efd path (?econ=-trainBatch, and the ABBA specs).
// The batch is a Group carrying userData.lineId, so main.js's line rebuild
// sweep treats it like a train group: kept for the DLR (whose trains are
// kept), otherwise handed to disposeTrains, which calls userData.dispose().
const _batches = new Set();
const _batchOf = new WeakMap();                // line group -> batch
const _stripL = new THREE.Matrix4().makeTranslation(-STRIP_X, STRIP_Y, 0);
const _stripR = new THREE.Matrix4().makeTranslation(STRIP_X, STRIP_Y, 0);
const _m = new THREE.Matrix4();
export const trainBatchStats = { batches: 0, instances: 0, uploads: 0, frames: 0, syncMs: 0 };

function makeBatchMeshes(batch, capacity) {
  const body = new THREE.InstancedMesh(_capsuleGeo, batch.bodyMat, capacity);
  const win = new THREE.InstancedMesh(_stripGeo, batch.winMat, capacity * 2);
  for (const m of [body, win]) {
    m.frustumCulled = false; // instances span the whole line; bounds would go stale
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
  }
  body.name = `train-batch-body-${batch.lineId}`;
  win.name = `train-batch-windows-${batch.lineId}`;
  return { body, win };
}

function addToBatch(group, train, lineId, colour) {
  let batch = _batchOf.get(group);
  if (!batch || batch.disposed || batch.root.parent !== group) {
    const root = new THREE.Group();
    root.name = `train-batch-${lineId}`;
    batch = {
      lineId, root, trains: [], capacity: 0, body: null, win: null, disposed: false,
      // Same parameters as the per-train materials above.
      bodyMat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.1,
        emissive: new THREE.Color(colour), emissiveIntensity: 0.03 }),
      winMat: new THREE.MeshBasicMaterial({ map: _windowTex, alphaTest: 0.5, toneMapped: false, side: THREE.DoubleSide }),
      last: null, // Float32Array of the matrices last uploaded, for change detection
    };
    root.userData = { lineId, trainBatch: batch, dispose: () => disposeBatch(batch) };
    root.visible = trainEconomies.batch;
    group.add(root);
    _batchOf.set(group, batch);
    _batches.add(batch);
  }
  batch.trains.push(train);
  train.userData.batch = batch;
  train.userData.nearGroup.visible = !trainEconomies.batch;
  if (batch.trains.length > batch.capacity) {
    const capacity = Math.max(8, batch.capacity * 2, batch.trains.length);
    if (batch.body) { batch.root.remove(batch.body, batch.win); batch.body.dispose(); batch.win.dispose(); }
    Object.assign(batch, makeBatchMeshes(batch, capacity), { capacity, last: null });
    batch.root.add(batch.body, batch.win);
  }
  batch.dirty = true;
}

function removeFromBatch(train) {
  const batch = train.userData.batch;
  if (!batch) return;
  const i = batch.trains.indexOf(train);
  if (i >= 0) { batch.trains.splice(i, 1); batch.dirty = true; }
  train.userData.batch = null;
}

function disposeBatch(batch) {
  if (batch.disposed) return;
  batch.disposed = true;
  for (const t of batch.trains) if (t.userData.batch === batch) t.userData.batch = null;
  batch.trains.length = 0;
  batch.body?.dispose(); batch.win?.dispose();
  batch.bodyMat.dispose(); batch.winMat.dispose();
  _batches.delete(batch);
}

function setBatchesEnabled(on) {
  for (const b of _batches) {
    b.root.visible = on; b.dirty = true;
    for (const t of b.trains) t.userData.nearGroup.visible = !on;
  }
}

/** Write each shown batch's instance matrices from its trains' current poses.
 * Uploads only when a matrix changed (a still or paused line costs nothing).
 *
 * Precision: a separate mesh gets its model-view matrix built on the CPU in
 * double precision, so a train near the camera is placed to a tiny fraction
 * of a pixel however far it is from the world origin. An instanced draw
 * multiplies model-view by the instance matrix on the GPU in single
 * precision, where two translations of thousands of metres nearly cancel and
 * edges shift by a fraction of a pixel (measured: 430 px at the landing view,
 * up to 36 levels, on MSAA edge samples). So each batch is rebased on a grid
 * point near the camera: the batch root sits at that point and the instances
 * hold small offsets from it, which keeps nearby trains as exact as before.
 * The grid step only decides how often the camera's travel forces a rewrite. */
const REBASE_STEP = 32;
const _origin = new THREE.Vector3();
const _rebase = new THREE.Matrix4();
function syncBatches(camera) {
  if (!trainEconomies.batch) return;
  const t0 = performance.now();
  trainBatchStats.frames++;
  let batches = 0, instances = 0;
  for (const b of _batches) {
    if (!b.body || !lineShown(b.root)) continue;
    const n = b.trains.length;
    // Rebase on the grid point nearest the camera, in the line group's space.
    if (camera?.position) {
      const parent = b.root.parent;
      _origin.copy(camera.position);
      if (parent) { parent.updateWorldMatrix(true, false); parent.worldToLocal(_origin); }
      _origin.set(Math.round(_origin.x / REBASE_STEP) * REBASE_STEP, Math.round(_origin.y / REBASE_STEP) * REBASE_STEP, Math.round(_origin.z / REBASE_STEP) * REBASE_STEP);
      if (!_origin.equals(b.root.position)) { b.root.position.copy(_origin); b.root.updateMatrix(); b.dirty = true; }
    }
    _rebase.makeTranslation(-b.root.position.x, -b.root.position.y, -b.root.position.z);
    const bodyArr = b.body.instanceMatrix.array, winArr = b.win.instanceMatrix.array;
    if (!b.last || b.last.length !== n * 16) { b.last = new Float32Array(n * 16).fill(NaN); b.dirty = true; }
    let changed = b.dirty;
    for (let i = 0; i < n; i++) {
      const t = b.trains[i];
      t.updateMatrix();
      const e = t.matrix.elements, o = i * 16;
      let same = true;
      for (let k = 0; k < 16; k++) if (b.last[o + k] !== Math.fround(e[k])) { same = false; break; }
      if (same && !b.dirty) continue;
      changed = true;
      for (let k = 0; k < 16; k++) b.last[o + k] = e[k];
      _m.multiplyMatrices(_rebase, t.matrix).toArray(bodyArr, o);
      _m.multiplyMatrices(_rebase, t.matrix).multiply(_stripL).toArray(winArr, 2 * o);
      _m.multiplyMatrices(_rebase, t.matrix).multiply(_stripR).toArray(winArr, 2 * o + 16);
    }
    if (b.body.count !== n) { b.body.count = n; b.win.count = 2 * n; changed = true; }
    if (changed) {
      b.body.instanceMatrix.needsUpdate = true; b.win.instanceMatrix.needsUpdate = true;
      trainBatchStats.uploads++;
    }
    b.dirty = false;
    batches++; instances += 3 * n;
  }
  trainBatchStats.batches = batches; trainBatchStats.instances = instances;
  trainBatchStats.syncMs = performance.now() - t0;
}
// ── /s24:R ──

/**
 * Per-frame update: simulation and orientation.
 */
// ── s24:R ── Pose reuse (sprint 24Sep26h, D-038). A train's pose is a pure
// function of (t, dir), so while it dwells (t fixed) the pose already applied
// is the one orient() would compute again, and a train on a hidden line need
// not be posed at all until it is shown. Simulation state always advances.
const trainEconomies = { reusePose: false, batch: false };
export function setTrainEconomies(next = {}) {
  const wasBatch = trainEconomies.batch;
  for (const k of Object.keys(trainEconomies)) if (k in next) trainEconomies[k] = !!next[k];
  if (trainEconomies.batch !== wasBatch) setBatchesEnabled(trainEconomies.batch);
  return { ...trainEconomies };
}
export const trainPoseStats = { posed: 0, reused: 0, hidden: 0 };
function lineShown(train) {
  for (let o = train; o; o = o.parent) if (o.visible === false) return false;
  return true;
}
function pose(train) {
  const ud = train.userData;
  ud.curve.getPointAt(ud.t, train.position);
  orient(train);
  ud._poseT = ud.t; ud._poseDir = ud.dir;
  trainPoseStats.posed++;
}
// ── /s24:R ──

export function updateTrains(system, sim, camera, dt) {
  const simDt = sim.paused ? 0 : (dt * sim.timeScale);
  const reuse = trainEconomies.reusePose;

  for (const train of system.allTrains) {
    const ud = train.userData;

    // Dwell at stations
    if (ud._pausedLeft > 0) {
      ud._pausedLeft = Math.max(0, ud._pausedLeft - simDt);
      // ── s24:R ──
      if (reuse) {
        if (!lineShown(train)) { trainPoseStats.hidden++; continue; }
        if (ud._poseT === ud.t && ud._poseDir === ud.dir) { trainPoseStats.reused++; continue; }
        pose(train);
        continue;
      }
      // ── /s24:R ──
      orient(train);
      continue;
    }

    // Advance along curve
    const du = (ud.cruiseMps * simDt) / Math.max(1e-6, ud.curveLengthM);
    let u = ud.t + ud.dir * du;

    // A delayed frame can cover several complete circuits, especially on
    // short DLR branches at accelerated simulation speed. Keep the curve
    // parameter valid in either direction without dropping elapsed time.
    u = ((u % 1) + 1) % 1;

    // Station arrival detection
    const stations = ud.stationUs;
    if (stations.length > 0) {
      const idx = ud.nextStationIndex;
      const targetU = stations[idx];
      const prevU = ud.t;
      // A complete circuit crosses the next station regardless of where the
      // wrapped endpoint falls. Retain the existing arrival/dwell policy.
      const crossed = du >= 1 || (ud.dir === 1
        ? (prevU <= targetU && u >= targetU) || (prevU > u && (u >= targetU || prevU <= targetU))
        : (prevU >= targetU && u <= targetU) || (prevU < u && (u <= targetU || prevU >= targetU)));

      if (crossed) {
        u = targetU;
        ud._pausedLeft = ud.dwellSec;
        ud.nextStationIndex = ud.dir === 1
          ? (idx + 1) % stations.length
          : (idx - 1 + stations.length) % stations.length;
      }
    }

    ud.t = u;
    // ── s24:R ──
    if (reuse) {
      if (!lineShown(train)) { ud._poseT = NaN; trainPoseStats.hidden++; continue; }
      pose(train);
      continue;
    }
    // ── /s24:R ──
    train.position.copy(ud.curve.getPointAt(u));
    orient(train);
  }
  syncBatches(camera); // s24:R
}

/**
 * Orient train along curve tangent.
 */
function orient(train) {
  const ud = train.userData;
  const uAhead = Math.min(ud.t + 0.001, 0.999);
  ud.curve.getPointAt(uAhead, _lookTarget); // s24:R: same point, no per-frame allocation
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
    removeFromBatch(train); // s24:R
    if (train.userData.dispose) train.userData.dispose();
    if (train.parent) train.parent.remove(train);
  }
}
