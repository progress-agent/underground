// r-roads.js: THROWAWAY proof for research round "Roads: all the roads inside the M25, then buses"
// (sprint 02Oct26f, lane R, D-048 item 11). Never merged, never deployed.
//
// Two independent switches, both read from the URL by parseRoadsParams():
//   ?roads=ribbons[&rclasses=motorway,trunk,...]   every OSM road inside the M25 drawn as a draped ribbon,
//                                                  one merged mesh per 2 km scene cell (roads.ugr1 from analyse-roads.mjs)
//   ?buses=real | <N> | real,<N>                    buses on TfL routes 25 and 73 (real), and/or N synthetic buses
//                                                  spread over the road network (the load test: 1000, 3000, 9000)
//
// Buses are instanced as the M25 traffic is (m25-motorway.js): a compact near mesh, a two-triangle far silhouette,
// a deterministic phase (a pure function of identity and time, no randomness), full pass every third frame with the
// near buses re-posed every frame, true proportions through trueHeadingBasis. NO per-instance colour (D-015, the M5
// driver renders instanceColor black): the red comes through the material and the geometry carries vertex shading.
// Because there is one type and one colour, the whole fleet is TWO draw calls, however many buses.
import * as THREE from 'three';
import { trueHeadingBasis } from './true-proportion.js';
import { hash01 } from './m25-traffic.js';

export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'other'];
const CLASS_WIDTH_M = [12, 10, 9, 8, 7, 6, 3.5, 4.5];
// speedMps is the speed at 1x; the simulation clock runs at the HUD multiplier (8x by default), so 0.7 shows as 5.6 m/s (20 km/h, a London bus's average).
export const BUS = { length: 10.9, width: 2.55, height: 4.4, speedMps: 0.7, bodyHex: 0xc8102e };
const LOD_FAR_PX = 2.5, LOD_NEAR_PX = 3.5;
const LANE_OFFSET_M = 1.9;
const mod = (a, b) => ((a % b) + b) % b;

/** Parse the proof's URL flags; null when the page asks for neither. */
export function parseRoadsParams(search) {
  const sp = new URLSearchParams(search);
  const roads = sp.get('roads'), buses = sp.get('buses');
  if (!roads && !buses) return null;
  const out = { ribbons: roads === 'ribbons', classes: null, realBuses: false, syntheticBuses: 0 };
  const rc = sp.get('rclasses');
  if (rc) out.classes = new Set(rc.split(',').filter(c => ROAD_CLASSES.includes(c)));
  if (buses) for (const part of buses.split(/[+, ]/)) { if (part === 'real') out.realBuses = true; else if (/^\d+$/.test(part)) out.syntheticBuses += +part; }
  return out;
}

// ── data ───────────────────────────────────────────────────────────────────
/** Decode roads.ugr1 into per-cell piece lists in scene metres. */
export function decodeUgr1(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'UGR1') throw new Error('roads.ugr1: bad magic (SPA fallback served?)');
  const cell = dv.getUint16(6, true), cols = dv.getUint16(8, true), x0 = dv.getInt32(12, true), z0 = dv.getInt32(16, true), n = dv.getUint32(20, true);
  const cells = [];
  for (let k = 0; k < n; k++) {
    const ci = dv.getUint16(24 + k * 16, true), cj = dv.getUint16(24 + k * 16 + 2, true);
    let o = dv.getUint32(24 + k * 16 + 4, true); const pc = dv.getUint32(24 + k * 16 + 8, true);
    const ox = x0 + ci * cell, oz = z0 + cj * cell, pieces = [];
    for (let p = 0; p < pc; p++) {
      const flags = dv.getUint8(o), m = dv.getUint16(o + 1, true); o += 3;
      const pts = new Float64Array(m * 2);
      for (let i = 0; i < m; i++) { pts[i * 2] = ox + dv.getUint16(o, true) / 10; pts[i * 2 + 1] = oz + dv.getUint16(o + 2, true) / 10; o += 4; }
      pieces.push({ cls: flags & 15, bridge: !!(flags & 16), pts });
    }
    cells.push({ ci, cj, ox, oz, pieces });
  }
  return { cell, cols, x0, z0, cells };
}
function pieceLength(pts) { let d = 0; for (let i = 2; i < pts.length; i += 2) d += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); return d; }

// ── paths: uniformly resampled, draped on the terrain ──────────────────────
/** Resample a polyline (flat [x,z,...]) to uniform spacing and drape it. `closed` appends the first point. */
export function buildPath(flat, getY, { step = 8, closed = false } = {}) {
  const pts = Array.from(flat);
  if (closed) pts.push(pts[0], pts[1]);
  const cum = [0]; for (let i = 2; i < pts.length; i += 2) cum.push(cum.at(-1) + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  const L = cum.at(-1), n = Math.max(2, Math.ceil(L / step) + 1), sp = L / (n - 1);
  const x = new Float32Array(n), z = new Float32Array(n), y = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = i * sp; while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const t = cum[seg + 1] > cum[seg] ? (d - cum[seg]) / (cum[seg + 1] - cum[seg]) : 0;
    x[i] = pts[seg * 2] + (pts[seg * 2 + 2] - pts[seg * 2]) * t; z[i] = pts[seg * 2 + 1] + (pts[seg * 2 + 3] - pts[seg * 2 + 1]) * t;
    const h = getY(x[i], z[i]); y[i] = Number.isFinite(h) ? h : (i ? y[i - 1] : 0);
  }
  return { n, sp, x, z, y, length: L, closed };
}
const POSE = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
/** Pose at chainage d along the path (heading from the surrounding sample pair). dir = -1 reverses the heading. */
function poseAt(path, d, dir, out = POSE) {
  let u = d / path.sp; let i = Math.floor(u); if (i < 0) i = 0; if (i > path.n - 2) i = path.n - 2; const t = u - i;
  out.x = path.x[i] + (path.x[i + 1] - path.x[i]) * t; out.z = path.z[i] + (path.z[i + 1] - path.z[i]) * t; out.y = path.y[i] + (path.y[i + 1] - path.y[i]) * t;
  let dx = path.x[i + 1] - path.x[i], dz = path.z[i + 1] - path.z[i], dy = path.y[i + 1] - path.y[i];
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; dy /= l;
  if (dir < 0) { dx = -dx; dz = -dz; dy = -dy; }
  out.dx = dx; out.dy = dy; out.dz = dz;
  return out;
}

// ── bus geometry: one merged, vertex-shaded body (about 72 triangles) ──────
const DARK = 0.1, MID = 1, WIN = 0.12;
function boxes(spec) {
  const pos = [], nor = [], col = [], idx = []; const c = new THREE.Color();
  for (const [w, h, l, cx, cy, cz, shade] of spec) {
    const g = new THREE.BoxGeometry(w, h, l); g.translate(cx, cy, cz);
    const faces = Array.isArray(shade) ? shade : [shade, shade, shade, shade, shade, shade]; // +x,-x,+y,-y,+z,-z
    const base = pos.length / 3, p = g.attributes.position.array, nn = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(nn[i]); }
    for (let i = 0; i < p.length / 3; i++) { const s = faces[Math.floor(i / 4)]; c.setRGB(s, s, s); col.push(c.r, c.g, c.b); }
    for (const k of g.index.array) idx.push(base + k);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); return g;
}
/** A London double-decker, real metres, z forward, x across, y up from the road. Shade 1 takes the material's red. */
export function buildBusGeometry() {
  const W = [WIN, WIN, MID, MID, WIN, MID]; // window band: dark sides and front, red roof and floor, red tail
  return boxes([
    [2.5, 1.0, 10.2, 0, 0.7, 0, DARK],        // chassis and wheels
    [2.55, 0.9, 10.9, 0, 1.65, 0, MID],       // lower body
    [2.57, 0.9, 10.9, 0, 2.55, 0, W],         // lower deck windows
    [2.55, 0.35, 10.9, 0, 3.175, 0, MID],     // band between the decks
    [2.57, 0.85, 10.9, 0, 3.775, 0, W],       // upper deck windows
    [2.4, 0.2, 10.8, 0, 4.3, 0, MID],         // roof
  ]);
}

// ── projection helpers (as m25-motorway.js, kept local so that file is untouched) ──
function projectionOf(camera, heightPx) {
  if (!camera?.matrixWorldInverse || !camera?.projectionMatrix) return null;
  const v = camera.matrixWorldInverse.elements, m = camera.matrixWorld.elements, q = camera.projectionMatrix.elements;
  const widthPx = heightPx * (camera.aspect || 1);
  const factor = Math.max(Math.abs(q[0]) * widthPx * Math.hypot(v[0], v[4], v[8]), Math.abs(q[5]) * heightPx * Math.hypot(v[1], v[5], v[9]));
  const right = new THREE.Vector3(m[0], m[1], m[2]).normalize(), up = new THREE.Vector3(m[4], m[5], m[6]).normalize();
  return { v, q, factor, right, up, depthFactor: Math.hypot(v[2], v[6], v[10]) };
}
function pixelSize(pr, x, y, z, radius) {
  if (!pr) return Infinity;
  const v = pr.v, depth = -(v[2] * x + v[6] * y + v[10] * z + v[14]);
  if (depth <= 0) return 0;
  return pr.factor * radius / Math.max(0.001, depth - radius * pr.depthFactor);
}
/** Cheap frustum plus fog test on a bus centre; r is the bounding radius in scene units. */
function visible(pr, x, y, z, r, fogFar) {
  const v = pr.v, q = pr.q;
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12], vy = v[1] * x + v[5] * y + v[9] * z + v[13], vz = v[2] * x + v[6] * y + v[10] * z + v[14];
  const depth = -vz; if (depth < -r) return false;
  if (fogFar && depth - r >= fogFar) return false;
  const cx = q[0] * vx + q[8] * vz, cy = q[5] * vy + q[9] * vz, w = depth;
  return Math.abs(cx) <= w + q[0] * r + 1e-6 && Math.abs(cy) <= w + Math.abs(q[5]) * r + 1e-6;
}

// ── the proof ──────────────────────────────────────────────────────────────
export async function createRoadsProof({ getSurfaceY, VE = 5, heightScale = 1, params, viewportHeightPx = () => (typeof window === 'undefined' ? 900 : window.innerHeight * (window.devicePixelRatio || 1)), base = '' }) {
  const getY = (x, z) => getSurfaceY({ x, z });
  const root = new THREE.Group(); root.name = 'rRoadsProof';
  const stats = { buses: 0, near: 0, far: 0, culled: 0, triangles: 0, drawCalls: 0, updateMs: 0, nearMs: 0, passes: 0, buildMs: {}, ribbons: null, busPaths: 0 };
  let scale = heightScale, elapsed = 0, frame = 0, lastCamera = null;
  const t0 = performance.now();
  const data = decodeUgr1(await (await fetch(`${base}/data/r-roads/roads.ugr1`)).arrayBuffer());
  stats.buildMs.decode = performance.now() - t0;

  // ── ribbons ──────────────────────────────────────────────────────────────
  if (params.ribbons) {
    const t1 = performance.now();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2c2c2e, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const STEP = 20, LIFT = 0.6; // metres between drape samples; canonical lift (about 12 cm real) above the terrain triangle
    let tris = 0, verts = 0, meshes = 0, samples = 0;
    const ribbons = new THREE.Group(); ribbons.name = 'rRoadsRibbons';
    for (const cell of data.cells) {
      const pos = [], idx = [];
      for (const pc of cell.pieces) {
        if (params.classes && !params.classes.has(ROAD_CLASSES[pc.cls])) continue;
        const half = CLASS_WIDTH_M[pc.cls] / 2, p = pc.pts, m = p.length / 2;
        // densify to at most STEP metres, then drape both rails
        const sx = [], sz = [];
        for (let i = 0; i < m - 1; i++) {
          const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
          for (let s = 0; s < k; s++) { sx.push(ax + (bx - ax) * s / k); sz.push(az + (bz - az) * s / k); }
        }
        sx.push(p[m * 2 - 2]); sz.push(p[m * 2 - 1]);
        const n = sx.length, first = pos.length / 3;
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = sx[b] - sx[a], dz = sz[b] - sz[a]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const lx = sx[i] + dz * half, lz = sz[i] - dx * half, rx = sx[i] - dz * half, rz = sz[i] + dx * half;
          const ly = getY(lx, lz), ry = getY(rx, rz);
          pos.push(lx, (Number.isFinite(ly) ? ly : 0) + LIFT, lz, rx, (Number.isFinite(ry) ? ry : 0) + LIFT, rz); samples += 2;
        }
        for (let i = 0; i < n - 1; i++) { const a = first + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      if (!idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat); mesh.name = `rRoadsRibbons-${cell.ci}-${cell.cj}`; mesh.renderOrder = 1; ribbons.add(mesh);
      tris += idx.length / 3; verts += pos.length / 3; meshes++;
    }
    root.add(ribbons);
    stats.ribbons = { meshes, triangles: tris, vertices: verts, terrainSamples: samples, bytes: verts * 12 + tris * 3 * 2, buildMs: performance.now() - t1 };
    stats.buildMs.ribbons = stats.ribbons.buildMs;
  }

  // ── buses ────────────────────────────────────────────────────────────────
  const paths = [];
  const bus = { path: [], base: [], amp: [], omega: [], phase: [], mode: [], route: [] };
  function addBus(pathIndex, mode, b, id, route) {
    bus.path.push(pathIndex); bus.mode.push(mode); bus.base.push(b);
    // bounded: amp x omega <= 0.24 m/s, a third of the cruise speed, so no bus ever reverses
    bus.amp.push(1 + 0.7 * hash01(id, 6)); bus.omega.push((2 * Math.PI) / (45 + 105 * hash01(id, 7))); bus.phase.push(2 * Math.PI * hash01(id, 8)); bus.route.push(route);
  }
  const t2 = performance.now();
  const routeMeta = {};
  if (params.realBuses || params.syntheticBuses) {
    let id = 0;
    if (params.realBuses) {
      const br = await (await fetch(`${base}/data/r-roads/bus-routes.json`)).json();
      for (const [line, dirs] of Object.entries(br.routes)) {
        // a closed circuit: outbound, then inbound (the two ends are joined by a straight turn-round chord)
        const flat = []; for (const d of ['outbound', 'inbound']) for (const pt of dirs[d].points) flat.push(pt[0], pt[1]);
        const path = buildPath(flat, getY, { step: 8, closed: true }); paths.push(path);
        const count = Math.round(path.length / 550); routeMeta[line] = { path: paths.length - 1, lengthM: path.length, buses: count, outboundM: dirs.outbound.lengthM, inboundM: dirs.inbound.lengthM, stops: { outbound: dirs.outbound.stops, inbound: dirs.inbound.stops } };
        for (let k = 0; k < count; k++) addBus(paths.length - 1, 0, (k + (hash01(id, 5) - 0.5) * 0.4) * (path.length / count), id, line), id++;
      }
    }
    if (params.syntheticBuses) {
      // Candidate road pieces: motorway to tertiary, at least 300 m, ordered by a hash so the choice is deterministic and spread everywhere.
      const cand = [];
      for (const cell of data.cells) for (const pc of cell.pieces) if (pc.cls <= 4 && pc.cls >= 1 && !pc.bridge) { const L = pieceLength(pc.pts); if (L >= 300) cand.push({ pc, L, h: hash01(cand.length * 31 + cell.ci * 7 + cell.cj, 11) }); }
      cand.sort((a, b) => a.h - b.h);
      let placed = 0; const SPACING = 90;
      for (const c of cand) {
        if (placed >= params.syntheticBuses) break;
        const path = buildPath(c.pc.pts, getY, { step: 8 }); paths.push(path);
        const k = Math.min(params.syntheticBuses - placed, Math.max(1, Math.floor(c.L / SPACING)));
        for (let j = 0; j < k; j++) addBus(paths.length - 1, 1, (j + hash01(id, 5)) * (2 * path.length / k), id, 'synthetic'), id++;
        placed += k;
      }
      stats.syntheticShortfall = params.syntheticBuses - placed;
    }
  }
  stats.buildMs.busPaths = performance.now() - t2; stats.busPaths = paths.length;
  const N = bus.path.length; stats.buses = N;
  const lod = new Uint8Array(N).fill(1);
  const busPath = Int32Array.from(bus.path), busMode = Uint8Array.from(bus.mode), busBase = Float64Array.from(bus.base), busAmp = Float32Array.from(bus.amp), busOmega = Float32Array.from(bus.omega), busPhase = Float32Array.from(bus.phase);
  let nearMesh = null, farMesh = null;
  const nearSlotBus = new Int32Array(N);
  if (N) {
    const nearMat = new THREE.MeshStandardMaterial({ color: BUS.bodyHex, vertexColors: true, roughness: 0.55, metalness: 0.1, fog: true });
    const farMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(BUS.bodyHex).multiplyScalar(0.82), fog: true, side: THREE.DoubleSide });
    nearMesh = new THREE.InstancedMesh(buildBusGeometry(), nearMat, N); farMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), farMat, N);
    for (const m of [nearMesh, farMesh]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; m.visible = false; }
    nearMesh.name = 'r-buses-near'; farMesh.name = 'r-buses-far'; nearMesh.userData.trianglesPerBus = nearMesh.geometry.index.count / 3; farMesh.userData.trianglesPerBus = 2;
    root.add(nearMesh, farMesh);
  }
  const heading = new THREE.Vector3(), basis = { side: new THREE.Vector3(), up: new THREE.Vector3(), forward: new THREE.Vector3() };
  const scratch = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, dir: 1 };
  /** Pose of bus i at time t, lane-offset to the left of travel. */
  function busAt(i, t, out = scratch) {
    const path = paths[busPath[i]], L = path.length, raw = busBase[i] + BUS.speedMps * t + busAmp[i] * Math.sin(busOmega[i] * t + busPhase[i]);
    let d, dir = 1;
    if (busMode[i] === 0) d = mod(raw, L); else { const u = mod(raw, 2 * L); if (u < L) d = u; else { d = 2 * L - u; dir = -1; } }
    poseAt(path, d, dir, out); out.dir = dir;
    out.x += out.dz * LANE_OFFSET_M; out.z -= out.dx * LANE_OFFSET_M; out.d = d;
    return out;
  }
  function writeMatrix(mesh, index, x, y, z, a, b, c) {
    const arr = mesh.instanceMatrix.array, o = index * 16;
    arr[o] = a.x; arr[o + 1] = a.y; arr[o + 2] = a.z; arr[o + 3] = 0; arr[o + 4] = b.x; arr[o + 5] = b.y; arr[o + 6] = b.z; arr[o + 7] = 0;
    arr[o + 8] = c.x; arr[o + 9] = c.y; arr[o + 10] = c.z; arr[o + 11] = 0; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  const farScratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
  function writeFarMatrix(index, x, y, z, dx, dy, dz, pr) {
    const v = pr.v, right = pr.right, camUp = pr.up;
    let sx = v[0] * dx + v[4] * dy + v[8] * dz, sy = v[1] * dx + v[5] * dy + v[9] * dz; const length = Math.hypot(sx, sy);
    if (length > 1e-8) { sx /= length; sy /= length; } else { sx = 0; sy = 1; }
    const ax = right.x * sy - camUp.x * sx, ay = right.y * sy - camUp.y * sx, az = right.z * sy - camUp.z * sx;
    const bx = right.x * sx + camUp.x * sy, by = right.y * sx + camUp.y * sy, bz = right.z * sx + camUp.z * sy;
    const arr = farMesh.instanceMatrix.array, o = index * 16, W = BUS.width, Ln = BUS.length;
    arr[o] = ax * W; arr[o + 1] = ay * W; arr[o + 2] = az * W; arr[o + 3] = 0; arr[o + 4] = bx * Ln; arr[o + 5] = by * Ln; arr[o + 6] = bz * Ln; arr[o + 7] = 0;
    arr[o + 8] = ay * bz - az * by; arr[o + 9] = az * bx - ax * bz; arr[o + 10] = ax * by - ay * bx; arr[o + 11] = 0; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  let nearN = 0; const sceneFogFar = () => { let o = root; while (o.parent) o = o.parent; const f = o.isScene ? o.fog : null; return f && f.isFog && Number.isFinite(f.far) ? f.far : 0; };
  const uploadRange = (mesh, count) => { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, count * 16); mesh.instanceMatrix.needsUpdate = true; };
  function writeNear(slotBus, index, t) {
    const p = busAt(slotBus, t), k = VE * scale;
    trueHeadingBasis(heading.set(p.dx, p.dy, p.dz), k, basis);
    writeMatrix(nearMesh, index, p.x, p.y, p.z, basis.side, basis.up, basis.forward);
  }
  function updateNear() {
    if (!nearN) return;
    const s = performance.now();
    for (let n = 0; n < nearN; n++) writeNear(nearSlotBus[n], n, elapsed);
    uploadRange(nearMesh, nearN); stats.nearMs = performance.now() - s;
  }
  function fullPass(camera) {
    const s = performance.now(), height = typeof viewportHeightPx === 'function' ? viewportHeightPx() : viewportHeightPx;
    const pr = projectionOf(camera, height); if (!pr) return;
    const k = VE * scale, radius = Math.hypot(BUS.width / 2, (BUS.height / 2) * k, BUS.length / 2), fogFar = sceneFogFar();
    let nearCount = 0, farCount = 0, culled = 0;
    for (let i = 0; i < N; i++) {
      const p = busAt(i, elapsed);
      if (!visible(pr, p.x, p.y, p.z, radius, fogFar)) { culled++; continue; }
      const px = pixelSize(pr, p.x, p.y, p.z, radius);
      if (lod[i]) { if (px > LOD_NEAR_PX) lod[i] = 0; } else if (px < LOD_FAR_PX) lod[i] = 1;
      if (lod[i]) writeFarMatrix(farCount++, p.x, p.y + 2.2 * k, p.z, p.dx, p.dy, p.dz, pr);
      else { nearSlotBus[nearCount] = i; writeNear(i, nearCount, elapsed); nearCount++; }
    }
    nearN = nearCount;
    nearMesh.count = nearCount; nearMesh.visible = nearCount > 0; farMesh.count = farCount; farMesh.visible = farCount > 0;
    if (nearCount) uploadRange(nearMesh, nearCount); if (farCount) uploadRange(farMesh, farCount);
    stats.near = nearCount; stats.far = farCount; stats.culled = culled; stats.drawCalls = (nearCount ? 1 : 0) + (farCount ? 1 : 0);
    stats.triangles = nearCount * nearMesh.userData.trianglesPerBus + farCount * 2; stats.updateMs = performance.now() - s; stats.passes++;
  }
  function update(dt, camera, force = false) {
    if (Number.isFinite(dt) && dt > 0) elapsed += dt;
    if (camera) lastCamera = camera;
    if (!N || !lastCamera) return;
    frame++;
    if (!force && frame % 3) { updateNear(); return; }
    fullPass(lastCamera);
  }
  root.userData = {
    update, stats, N, params, routes: routeMeta, paths,
    setHeightScale(v) { if (Number.isFinite(v) && v > 0) { scale = v; update(0, lastCamera, true); } },
    getElapsed: () => elapsed,
    busAt: (i, t = elapsed) => ({ ...busAt(i, t, { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 }) }),
    /** Pose on a real route's circuit at chainage d (metres), for placing a capture camera. */
    routePoint(line, d) { const m = routeMeta[line]; if (!m) return null; const p = poseAt(paths[m.path], mod(d, m.lengthM), 1, { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 }); return { ...p }; },
    dispose() { root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } }); root.removeFromParent(); },
  };
  stats.buildMs.total = performance.now() - t0;
  return root;
}
