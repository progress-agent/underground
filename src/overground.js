// London Overground surface rail — D-019 earthworks archetype language.
//
// Renders public/data/overground.json (Prog 11Jul26s delivery, wA v2 restitch
// + twin-track pair-collapse) as TRUE AT-GRADE rail: the track follows the
// terrain mesh and each OSM earthworks class gets its own archetype:
//   surface    — ballast ribbon + line-colour stripe on the ground
//   embankment — ribbon raised ~3m with earth-tone skirt strips
//   viaduct    — masonry deck raised ~8m on piers
//   cutting    — ribbon sunk ~3m between rising wall strips
//   tunnel     — stripe only, sunk ~20m (e.g. Windrush under the Thames)
// The same language is intended for NatRail corridors + above-ground tube in
// later waves (D-019 §2) — keep archetype constants here, not per-line.
//
// Geometry is merged per material per line (BufferGeometryUtils) — ~5k input
// points build a handful of draw calls per line. All opaque, fog: true,
// SURFACE_BRIDGE render tier (depth testing resolves visibility).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import proj4 from 'proj4';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { RENDER_ORDER } from './render-layers.js';

const VE = VERTICAL_EXAGGERATION;
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Registered in main.js too — defs() is idempotent, keep this module portable.
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

// ── Archetype constants (scene units; Y lifts are real metres × VE) ──────
const BALLAST_HALF_W = 9;          // 18m ballast bed (visual presence at altitude)
const STRIPE_HALF_W = 4.5;         // line-colour identity stripe
const BASE_LIFT = 2;               // z-fight clearance above terrain
const STRIPE_LIFT = 0.8;           // stripe above its ballast
const CLASS_LIFT_M = {             // real metres relative to terrain
  surface: 0,
  embankment: 3,
  viaduct: 8,
  cutting: -3,
  tunnel: -20,
};
const PIER_SPACING_M = 110;
const SMOOTH_PASSES = 3;           // moving-average passes over track Y

const MATS = {
  ballast: new THREE.MeshStandardMaterial({ color: 0x4c4741, roughness: 0.9, metalness: 0.05, fog: true, side: THREE.DoubleSide }),
  earth: new THREE.MeshStandardMaterial({ color: 0x5d5142, roughness: 0.95, metalness: 0.0, fog: true, side: THREE.DoubleSide }),
  masonry: new THREE.MeshStandardMaterial({ color: 0x8d8778, roughness: 0.8, metalness: 0.08, fog: true, side: THREE.DoubleSide }),
  wall: new THREE.MeshStandardMaterial({ color: 0x57534a, roughness: 0.9, metalness: 0.05, fog: true, side: THREE.DoubleSide }),
};

function llToScene(lon, lat) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) };
}

// Build a quad-strip BufferGeometry from parallel left/right rails of points.
function stripGeometry(left, right) {
  const n = Math.min(left.length, right.length);
  const positions = new Float32Array((n - 1) * 6 * 3);
  let o = 0;
  const push = (p) => { positions[o++] = p.x; positions[o++] = p.y; positions[o++] = p.z; };
  for (let i = 0; i < n - 1; i++) {
    push(left[i]); push(right[i]); push(left[i + 1]);
    push(right[i]); push(right[i + 1]); push(left[i + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// Per-corridor path in scene space with per-point earthworks class + track Y.
function buildPath(branch, getTerrainMeshSurfaceY) {
  const pts = branch.points;
  const classes = new Array(pts.length).fill('surface');
  for (const seg of branch.segments || []) {
    for (let i = seg.i0; i < Math.min(seg.i1, pts.length); i++) classes[i] = seg.class;
  }
  const path = [];
  for (let i = 0; i < pts.length; i++) {
    const { x, z } = llToScene(pts[i][0], pts[i][1]);
    const tY = getTerrainMeshSurfaceY({ x, z });
    if (tY === null || tY === undefined) continue;
    const cls = CLASS_LIFT_M[classes[i]] === undefined ? 'surface' : classes[i];
    path.push({ x, z, terrainY: tY, cls, y: tY + BASE_LIFT + CLASS_LIFT_M[cls] * VE });
  }
  // Smooth Y so class transitions ramp instead of stepping, and coarse
  // terrain-cell sampling doesn't jitter the deck.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = 1; i < path.length - 1; i++) {
      path[i].y = (path[i - 1].y + path[i].y * 2 + path[i + 1].y) / 4;
    }
  }
  return path;
}

// Left/right offset points perpendicular to the path at halfW, at yFn(p).
function offsetRails(path, halfW, yFn) {
  const left = [], right = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let nx = -(b.z - a.z), nz = b.x - a.x;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    const p = path[i];
    const y = yFn(p);
    left.push({ x: p.x + nx * halfW, y, z: p.z + nz * halfW });
    right.push({ x: p.x - nx * halfW, y, z: p.z - nz * halfW });
  }
  return { left, right };
}

function buildCorridor(path, out) {
  if (path.length < 2) return;

  // Split into runs of "kind" so tunnel sections drop the ballast bed and
  // viaduct/embankment/cutting get their dressing per run.
  let runStart = 0;
  for (let i = 1; i <= path.length; i++) {
    const boundary = i === path.length || path[i].cls !== path[runStart].cls;
    if (!boundary) continue;
    const run = path.slice(Math.max(0, runStart - 1), i + 1); // 1-pt overlap for continuity
    const cls = path[runStart].cls;
    runStart = i;
    if (run.length < 2) continue;

    // Identity stripe always renders (it IS the line on the map).
    const stripe = offsetRails(run, STRIPE_HALF_W, (p) => p.y + STRIPE_LIFT);
    out.stripe.push(stripGeometry(stripe.left, stripe.right));
    if (cls === 'tunnel') continue;

    // Ballast/deck bed.
    const bed = offsetRails(run, cls === 'viaduct' ? BALLAST_HALF_W + 1.5 : BALLAST_HALF_W, (p) => p.y);
    out[cls === 'viaduct' ? 'masonry' : 'ballast'].push(stripGeometry(bed.left, bed.right));

    if (cls === 'embankment') {
      // Earth skirts: bed edge down to terrain, splayed outward 1.5x the drop.
      const drop = (p) => Math.max(0, p.y - p.terrainY);
      const skirtL = offsetRails(run, BALLAST_HALF_W, (p) => p.y);
      const skirtLBase = run.map((p, j) => {
        const e = skirtL.left[j];
        const spread = drop(p) * 0.3;
        return { x: e.x + (e.x - p.x) / BALLAST_HALF_W * spread, y: p.terrainY + 0.5, z: e.z + (e.z - p.z) / BALLAST_HALF_W * spread };
      });
      out.earth.push(stripGeometry(skirtL.left, skirtLBase));
      const skirtRBase = run.map((p, j) => {
        const e = skirtL.right[j];
        const spread = drop(p) * 0.3;
        return { x: e.x + (e.x - p.x) / BALLAST_HALF_W * spread, y: p.terrainY + 0.5, z: e.z + (e.z - p.z) / BALLAST_HALF_W * spread };
      });
      out.earth.push(stripGeometry(skirtRBase, skirtL.right));
    } else if (cls === 'cutting') {
      // Walls: bed edge up to terrain level either side.
      const wall = offsetRails(run, BALLAST_HALF_W + 1, (p) => p.y);
      const wallLTop = run.map((p, j) => ({ x: wall.left[j].x, y: Math.max(p.terrainY + 0.5, p.y), z: wall.left[j].z }));
      const wallRTop = run.map((p, j) => ({ x: wall.right[j].x, y: Math.max(p.terrainY + 0.5, p.y), z: wall.right[j].z }));
      out.wall.push(stripGeometry(wallLTop, wall.left));
      out.wall.push(stripGeometry(wall.right, wallRTop));
    } else if (cls === 'viaduct') {
      // Piers every PIER_SPACING_M down to terrain.
      let acc = 0;
      for (let j = 1; j < run.length; j++) {
        acc += Math.hypot(run[j].x - run[j - 1].x, run[j].z - run[j - 1].z);
        if (acc < PIER_SPACING_M) continue;
        acc = 0;
        const p = run[j];
        const h = Math.max(2, p.y - p.terrainY);
        const pier = new THREE.BoxGeometry(5, h, 5);
        pier.translate(p.x, p.terrainY + h / 2, p.z);
        out.masonry.push(pier);
      }
    }
  }
}

// ── Trains: simple ping-pong capsules with emissive window strips ────────
const TRAIN_LENGTH = 100;
const TRAIN_RADIUS = 2.2;
const TRAIN_SPEED_MPS = 13;
const TRAIN_MIN_CORRIDOR_M = 5000;
const TRAIN_VISIBLE_DIST = 9000;

let _ogCapsuleGeo = null;
let _ogStripGeo = null;

function buildTrain(colour) {
  if (!_ogCapsuleGeo) {
    _ogCapsuleGeo = new THREE.CapsuleGeometry(TRAIN_RADIUS, TRAIN_LENGTH, 6, 12);
    _ogCapsuleGeo.rotateX(Math.PI / 2);
  }
  if (!_ogStripGeo) {
    _ogStripGeo = new THREE.PlaneGeometry(TRAIN_LENGTH * 0.95, 1.6);
    _ogStripGeo.rotateY(Math.PI / 2);
  }
  const train = new THREE.Group();
  const body = new THREE.Mesh(_ogCapsuleGeo, new THREE.MeshStandardMaterial({
    color: 0x22252a,
    roughness: 0.65,
    metalness: 0.15,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.05,
    fog: true,
  }));
  train.add(body);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb14e, toneMapped: false, side: THREE.DoubleSide });
  const wL = new THREE.Mesh(_ogStripGeo, winMat);
  wL.position.set(-(TRAIN_RADIUS + 0.05), 0.6, 0);
  train.add(wL);
  const wR = new THREE.Mesh(_ogStripGeo, winMat);
  wR.position.set(TRAIN_RADIUS + 0.05, 0.6, 0);
  train.add(wR);
  return train;
}

function makeTrainRunner(path, colour) {
  // cumulative distances for constant-speed travel
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  const total = cum[cum.length - 1];
  if (total < TRAIN_MIN_CORRIDOR_M) return null;
  const mesh = buildTrain(colour);
  return {
    mesh, path, cum, total,
    s: Math.random() * total,
    dir: Math.random() < 0.5 ? 1 : -1,
  };
}

function stepTrain(runner, dt) {
  runner.s += runner.dir * TRAIN_SPEED_MPS * dt;
  if (runner.s <= 0) { runner.s = 0; runner.dir = 1; }
  if (runner.s >= runner.total) { runner.s = runner.total; runner.dir = -1; }
  // locate segment by binary search
  const { cum, path } = runner;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= runner.s) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const t = (runner.s - cum[lo]) / segLen;
  const a = path[lo], b = path[hi];
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t + TRAIN_RADIUS;
  const z = a.z + (b.z - a.z) * t;
  runner.mesh.position.set(x, y, z);
  runner.mesh.lookAt(x + (b.x - a.x) * runner.dir, y + (b.y - a.y) * runner.dir, z + (b.z - a.z) * runner.dir);
}

export async function createOverground({ getTerrainMeshSurfaceY }) {
  const res = await fetch('/data/overground.json');
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    throw new Error('overground.json unavailable');
  }
  const data = await res.json();

  const group = new THREE.Group();
  group.name = 'overground';
  const runners = [];
  const registry = new Map();

  for (const line of data.lines || []) {
    const lineGroup = new THREE.Group();
    lineGroup.name = `overground-${line.id}`;
    const colour = new THREE.Color(line.colour || '#EE7C0E');
    const stripeMat = new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.55, metalness: 0.1,
      emissive: colour, emissiveIntensity: 0.35, fog: true, side: THREE.DoubleSide,
    });
    const out = { stripe: [], ballast: [], masonry: [], earth: [], wall: [] };
    const paths = [];
    for (const branch of line.branches || []) {
      const path = buildPath(branch, getTerrainMeshSurfaceY);
      if (path.length < 2) continue;
      paths.push(path);
      buildCorridor(path, out);
    }
    const addMerged = (geos, mat) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;
      mesh.userData = { type: 'overground-line', lineId: line.id, name: `${line.name} line (Overground)` };
      lineGroup.add(mesh);
    };
    addMerged(out.stripe, stripeMat);
    addMerged(out.ballast, MATS.ballast);
    addMerged(out.masonry, MATS.masonry);
    addMerged(out.earth, MATS.earth);
    addMerged(out.wall, MATS.wall);

    // one train on each corridor long enough to justify it
    for (const path of paths) {
      const runner = makeTrainRunner(path, colour);
      if (runner) {
        lineGroup.add(runner.mesh);
        runners.push(runner);
      }
    }
    registry.set(line.id, {
      name: line.name,
      colour: line.colour,
      corridors: paths.length,
      points: paths.reduce((s, p) => s + p.length, 0),
      trains: runners.filter((r) => lineGroup.children.includes(r.mesh)).length,
    });
    group.add(lineGroup);
  }

  let camRef = null;
  group.userData.registry = registry;
  group.userData.update = (dt, camera) => {
    camRef = camera || camRef;
    for (const r of runners) {
      if (camRef) {
        const dx = r.mesh.position.x - camRef.position.x;
        const dz = r.mesh.position.z - camRef.position.z;
        const visible = (dx * dx + dz * dz) < TRAIN_VISIBLE_DIST * TRAIN_VISIBLE_DIST;
        r.mesh.visible = visible;
        if (!visible) continue;
      }
      stepTrain(r, dt);
    }
  };
  return group;
}
