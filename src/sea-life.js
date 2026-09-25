// sea-life.js: incongruous, silent sea life in the Thames water volume
// (sprint 23Sep26w, Lane C, D-037).
//
// Minimalist realism: a handful of low-poly, flat-shaded forms at true scale,
// placed for discovery rather than density. They are dark against the green
// submerged fog, so each one arrives as a silhouette and only resolves as the
// camera closes in. The whole layer is drawn only while the camera is inside
// the submerged regime (main.js passes the shared isSubmergedAt result).
//
// Contracts this module keeps:
//  - Motion is a pure function of elapsed simulation time (plus, for the fish
//    school only, the camera position it shies away from). No state carries
//    between frames except the elapsed clock, so tests can pin any instant.
//  - Per-individual variation comes from a string hash, never Math.random.
//  - No per-instance colour. Tones are baked vertex colour (countershading);
//    repeated animals share one InstancedMesh with instanceMatrix only.
//  - Height contract (D-039, sprint 25Sep26f): creatures are structures and
//    keep TRUE proportions whatever Master is. Geometry is authored in real
//    metres under a parent scaled (1, sy, 1) with sy = base / Master (the
//    camera's master-height controller), which the Master display transform
//    (y * Master / base) turns back into exactly 1:1. Only the landscape (the
//    water column and bed) stretches; placement still fits the Master 1 body
//    (the tallest a body can be in canonical space), so containment holds at
//    every Master.
//  - Containment: paths live in (chainage, lateral fraction, column fraction)
//    space over the very cross-sections the water volume and its navigation
//    predicate are built from, and every body is clamped between the real bed
//    (navigation.bedAt) and the water top with its own vertical half extents.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildThamesCrossSections } from './thames-profile.js';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import { bridgePierAnchors } from './bridges.js';

const MARGIN_M = 0.6;          // clearance from bed and water top, real metres
const BANK_MARGIN_M = 8;       // clearance from the mapped bank, metres

// ── Hashing (deterministic per-id variation) ─────────────────────────────
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function hash01(id, k = 0) {
  let h = hashString(`${id}#${k}`);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hsym = (id, k) => hash01(id, k) * 2 - 1;

// Shared school shape: radius in metres, vertical flattening, the camera
// avoidance radius (was 11 m, which emptied the space around the viewer) and
// the fish length scale over the original 0.39 m form (about 0.62 m now).
export const SCHOOL = { radius: 8, flatten: 0.45, avoidM: 4, fishScale: 1.6 };
// Beyond this range a school is hidden and not posed: the submerged fog has
// long since closed (it reads by about 150 m).
const SCHOOL_DRAW_RANGE_M = 320;

// ── Species table (true scale, metres) ──────────────────────────────────
// anchor: BNG point on the Thames centreline the path is centred on.
// vr: vertical half extents in real metres INCLUDING animated parts and the
// pitch limit, used to keep the whole body inside the water column.
// r: horizontal radius used for the bank margin.
export const SEA_LIFE_SPECIES = [
  { id: 'blue-whale', name: 'Blue whale', note: 'The Pool of London, between London Bridge and Tower Bridge',
    anchor: { e: 533230, n: 180420 }, speed: 1.8, r: 13, vr: { up: 3.4, down: 3.4 }, maxPitch: 0.06,
    path: { A: 230, L: 0.26, f0: 0.5, fA: 0.3, dir: 1 } },
  { id: 'manta', name: 'Manta rays', note: 'Low over the Greenwich bed', count: 3,
    anchor: { e: 538161, n: 178060 }, speed: 1.2, r: 5, vr: { up: 1.9, down: 1.9 }, maxPitch: 0.12,
    path: { A: 160, L: 0.34, f0: 0.18, fA: 0.1, dir: -1 } },
  { id: 'jellyfish', name: 'Lion\'s mane jellyfish', note: 'Drifting in Limehouse Reach', count: 9,
    anchor: { e: 536856, n: 179734 }, speed: 0.08, r: 2, vr: { up: 0.9, down: 5.4 } },
  { id: 'octopus', name: 'Giant octopus', note: 'On a Westminster Bridge pier',
    pier: { bridge: 'westminster', index: 3 }, r: 4.5, vr: { up: 3.4, down: 3.4 } },
  { id: 'turtle', name: 'Leatherback turtle', note: 'Rising and sinking off Rotherhithe',
    anchor: { e: 535031, n: 179955 }, speed: 0.6, r: 2, vr: { up: 1.1, down: 1.1 }, maxPitch: 0.35,
    path: { A: 120, L: 0.34, f0: 0.55, fA: 0.33, dir: 1 } },
  { id: 'hammerhead', name: 'Great hammerhead', note: 'Patrolling Blackwall Reach',
    anchor: { e: 538566, n: 179821 }, speed: 1.5, r: 3.5, vr: { up: 1.6, down: 1.3 }, maxPitch: 0.15,
    path: { A: 220, L: 0.4, f0: 0.45, fA: 0.2, dir: -1 } },
  // Silver shoals (sprint 25Sep26f): four reaches, larger brighter fish, and a
  // 4 m avoidance radius so a school parts around the camera, not vanishes.
  { id: 'silver-school', name: 'Silver fish school', note: 'Deptford; parts around the camera', count: 90,
    anchor: { e: 537245, n: 178352 }, speed: 1.0, r: 24, vr: { up: 4.4, down: 4.4 }, maxPitch: 0.2,
    path: { A: 90, L: 0.3, f0: 0.5, fA: 0.25, dir: 1 }, school: SCHOOL },
  { id: 'shoal-nine-elms', name: 'Silver fish school', note: 'Nine Elms reach, between Vauxhall and Grosvenor bridges', count: 80,
    anchor: { e: 529431, n: 177999 }, speed: 0.9, r: 24, vr: { up: 4.4, down: 4.4 }, maxPitch: 0.2,
    path: { A: 160, L: 0.28, f0: 0.55, fA: 0.2, dir: -1 }, school: SCHOOL },
  { id: 'shoal-wapping', name: 'Silver fish school', note: 'Off Wapping, below Tower Bridge', count: 80,
    anchor: { e: 534250, n: 180250 }, speed: 1.1, r: 24, vr: { up: 4.4, down: 4.4 }, maxPitch: 0.2,
    path: { A: 130, L: 0.3, f0: 0.45, fA: 0.22, dir: 1 }, school: SCHOOL },
  { id: 'shoal-battersea', name: 'Silver fish school', note: 'Battersea reach, between Wandsworth and Battersea rail bridges', count: 80,
    anchor: { e: 526262, n: 176022 }, speed: 0.95, r: 24, vr: { up: 4.4, down: 4.4 }, maxPitch: 0.2,
    path: { A: 150, L: 0.26, f0: 0.5, fA: 0.22, dir: 1 }, school: SCHOOL },
  // The species that swam up the Thames in January 2006, placed off the
  // Palace of Westminster between Westminster and Lambeth bridges.
  { id: 'bottlenose-whale', name: 'Northern bottlenose whale', note: 'Off the Palace of Westminster: the species of the 2006 Thames whale',
    anchor: { e: 530436, n: 179310 }, speed: 1.1, r: 5, vr: { up: 1.6, down: 1.6 }, maxPitch: 0.08,
    path: { A: 170, L: 0.3, f0: 0.5, fA: 0.25, dir: 1 } },
];
export const SCHOOL_IDS = SEA_LIFE_SPECIES.filter(s => s.school).map(s => s.id);

// ── River frame over the shared cross-sections ──────────────────────────
function buildRiverFrame(points, { VE, topY, waterLevelM }) {
  const cs = buildThamesCrossSections(points, { samples: 1500, VE, waterLevelM, topY });
  if (!cs) return null;
  const n = cs.samples + 1, P = cs.positions;
  const cx = new Float64Array(n), cz = new Float64Array(n), S = new Float64Array(n);
  const lx = new Float64Array(n), lz = new Float64Array(n), hw = new Float64Array(n), bed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * 12;
    const tlx = P[b], tlz = P[b + 2], trx = P[b + 3], trz = P[b + 5];
    cx[i] = (tlx + trx) / 2; cz[i] = (tlz + trz) / 2;
    lx[i] = tlx - cx[i]; lz[i] = tlz - cz[i];               // centre → left bank (lateral +1)
    hw[i] = Math.hypot(lx[i], lz[i]);
    bed[i] = P[b + 7];
    if (i > 0) S[i] = S[i - 1] + Math.hypot(cx[i] - cx[i - 1], cz[i] - cz[i - 1]);
  }
  const length = S[n - 1];
  function locate(s) {
    s = Math.max(0, Math.min(length, s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - S[lo]) / ((S[hi] - S[lo]) || 1);
    return { i: lo, j: hi, f };
  }
  function at(s, l) {
    const { i, j, f } = locate(s);
    const xi = cx[i] + lx[i] * l, zi = cz[i] + lz[i] * l;
    const xj = cx[j] + lx[j] * l, zj = cz[j] + lz[j] * l;
    const tx = cx[j] - cx[i], tz = cz[j] - cz[i], tl = Math.hypot(tx, tz) || 1;
    return { x: xi + (xj - xi) * f, z: zi + (zj - zi) * f, hw: hw[i] + (hw[j] - hw[i]) * f,
      bed: bed[i] + (bed[j] - bed[i]) * f, tx: tx / tl, tz: tz / tl };
  }
  function nearestS(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = (cx[i] - x) ** 2 + (cz[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return S[best];
  }
  return { at, nearestS, length, sections: n };
}

// ── Geometry helpers (real metres, +Z forward, +Y up) ────────────────────
const _cA = new THREE.Color(), _cB = new THREE.Color();
function colouredTriangles(verts, top, bottom, spanY = null) {
  // verts: flat array of xyz triangles. Countershading by face-centroid height.
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(verts);
  const col = new Float32Array(pos.length);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
  if (spanY) { minY = spanY[0]; maxY = spanY[1]; }
  _cA.setHex(bottom); _cB.setHex(top);
  for (let t = 0; t < pos.length; t += 9) {
    const cy = (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3;
    const k = THREE.MathUtils.smoothstep(cy, minY, maxY);
    const r = _cA.r + (_cB.r - _cA.r) * k, gg = _cA.g + (_cB.g - _cA.g) * k, b = _cA.b + (_cB.b - _cA.b) * k;
    for (let v = 0; v < 3; v++) col.set([r, gg, b], t + v * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// Loft of elliptical rings along Z. stations: [z, halfWidth, halfHeight, yOffset].
function loftVerts(stations, seg = 7) {
  const v = [];
  const ring = (s, k) => {
    const a = (k / seg) * Math.PI * 2;
    return [Math.cos(a) * s[1], (s[3] || 0) + Math.sin(a) * s[2], s[0]];
  };
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = ring(stations[i], k), b = ring(stations[i], k + 1);
      const c = ring(stations[i + 1], k), d = ring(stations[i + 1], k + 1);
      v.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  return v;
}
function loft(stations, top, bottom, seg = 7) { return colouredTriangles(loftVerts(stations, seg), top, bottom); }
// A thin double-faced polygon fan (fins, wings, flukes). pts: [[x,y,z]...]
// around a centre; thickness splits it into a top and bottom face.
function fin(centre, pts, thick, top, bottom) {
  const v = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    v.push(centre[0], centre[1] + thick, centre[2], ...a, ...b);
    v.push(centre[0], centre[1] - thick, centre[2], ...b, ...a);
  }
  return colouredTriangles(v, top, bottom, [centre[1] - thick, centre[1] + thick]);
}
function merge(geoms) {
  const g = mergeGeometries(geoms, false);
  for (const x of geoms) x.dispose();
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
const mirrorX = pts => pts.map(([x, y, z]) => [-x, y, z]);

// ── Materials ───────────────────────────────────────────────────────────
// One shared opaque material: flat Lambert, baked vertex tones, a faint
// emissive of the submerged fog so the near side never reads as pure black.
function createMaterials() {
  const body = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    emissive: new THREE.Color(0x44665d).multiplyScalar(0.12) });
  body.name = 'sea-life-body';
  const jelly = new THREE.MeshLambertMaterial({ color: 0xcdbfa6, emissive: new THREE.Color(0x3a3024),
    flatShading: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  jelly.name = 'sea-life-jelly';
  // Shoal fish: the same flat Lambert family, lifted by a cool silver
  // emissive so a school glints in the green murk before its shape resolves.
  // A separate material, never per-instance colour (D-015).
  const silver = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    emissive: new THREE.Color(0x9fbcb6).multiplyScalar(0.28) });
  silver.name = 'sea-life-silver';
  return { body, jelly, silver };
}

// ── Species builders: return { body (Group, metres), animate(t) } ───────
function buildWhale(mat) {
  const top = 0x2c3a40, bottom = 0x6d7a78;
  const body = new THREE.Group();
  const front = merge([
    loft([[12.5, 0.15, 0.15, -0.1], [11.8, 1.1, 0.9, 0.05], [10, 1.9, 1.5, 0], [6, 2.25, 1.75, 0],
      [1, 2.05, 1.65, 0], [-3, 1.55, 1.35, 0.05], [-5, 1.15, 1.05, 0.1]], top, bottom, 8),
    fin([2.0, -0.6, 7.2], [[2.1, -0.7, 8.2], [5.2, -1.6, 6.6], [4.8, -1.6, 6.0], [2.0, -0.8, 6.2]], 0.08, top, bottom),
    fin([-2.0, -0.6, 7.2], mirrorX([[2.1, -0.7, 8.2], [5.2, -1.6, 6.6], [4.8, -1.6, 6.0], [2.0, -0.8, 6.2]]), 0.08, top, bottom),
    fin([0, 1.3, -3.6], [[0, 1.3, -2.8], [0, 1.9, -3.9], [0, 1.2, -4.4]], 0.05, top, top),
  ]);
  body.add(new THREE.Mesh(front, mat.body));
  const tail = new THREE.Group(); tail.position.set(0, 0.1, -5); body.add(tail);
  tail.add(new THREE.Mesh(merge([loft([[0, 1.15, 1.05, 0], [-3.5, 0.65, 0.8, 0], [-7, 0.25, 0.4, 0]], top, bottom, 8)]), mat.body));
  const flukes = new THREE.Group(); flukes.position.set(0, 0, -7); tail.add(flukes);
  flukes.add(new THREE.Mesh(merge([
    fin([0, 0, -0.3], [[0.2, 0, 0.2], [2.4, 0, -1.2], [3.6, 0, -2.3], [1.4, 0, -1.9], [0, 0, -1.3]], 0.12, top, bottom),
    fin([0, 0, -0.3], mirrorX([[0.2, 0, 0.2], [2.4, 0, -1.2], [3.6, 0, -2.3], [1.4, 0, -1.9], [0, 0, -1.3]]), 0.12, top, bottom),
  ]), mat.body));
  return { body, animate(t, id) {
    const w = (Math.PI * 2) / 7.5, p = hash01(id, 9) * 6.28;
    tail.rotation.x = 0.11 * Math.sin(w * t + p);
    flukes.rotation.x = 0.22 * Math.sin(w * t + p - 0.9);
  } };
}

function buildManta(mat) {
  const top = 0x1f2a2a, bottom = 0xaab5b0;
  const body = new THREE.Group();
  body.add(new THREE.Mesh(merge([
    loft([[1.35, 0.05, 0.05, 0], [1.1, 0.75, 0.3, 0], [0, 0.95, 0.38, 0], [-0.9, 0.55, 0.25, 0], [-1.25, 0.08, 0.06, 0]], top, bottom, 6),
    fin([0.55, 0, 1.2], [[0.45, 0.05, 1.3], [0.6, -0.1, 1.9], [0.75, -0.05, 1.25]], 0.05, top, bottom),
    fin([-0.55, 0, 1.2], mirrorX([[0.45, 0.05, 1.3], [0.6, -0.1, 1.9], [0.75, -0.05, 1.25]]), 0.05, top, bottom),
    fin([0, 0, -1.2], [[0.03, 0, -1.2], [0, 0, -3.3], [-0.03, 0, -1.2]], 0.03, top, top),
  ]), mat.body));
  const wingPts = [[0, 0.12, 1.05], [1.4, 0.05, 0.5], [2.9, 0, -0.55], [1.2, 0.04, -0.95], [0, 0.1, -1.0]];
  const left = new THREE.Group(); left.position.set(0.85, 0, 0); body.add(left);
  left.add(new THREE.Mesh(merge([fin([0, 0, 0], wingPts, 0.16, top, bottom)]), mat.body));
  const right = new THREE.Group(); right.position.set(-0.85, 0, 0); body.add(right);
  right.add(new THREE.Mesh(merge([fin([0, 0, 0], mirrorX(wingPts), 0.16, top, bottom)]), mat.body));
  return { body, animate(t, id) {
    const w = (Math.PI * 2) / 5.2, a = 0.42 * Math.sin(w * t + hash01(id, 9) * 6.28);
    left.rotation.z = a; right.rotation.z = -a;
    left.rotation.x = right.rotation.x = 0.08 * Math.sin(w * t + hash01(id, 9) * 6.28 - 1.2);
  } };
}

function buildTurtle(mat) {
  const top = 0x1d2523, bottom = 0x5e6862;
  const body = new THREE.Group();
  body.add(new THREE.Mesh(merge([
    loft([[1.05, 0.08, 0.06, 0.05], [0.8, 0.55, 0.3, 0.05], [0, 0.7, 0.36, 0.05], [-0.8, 0.4, 0.22, 0.05], [-1.1, 0.05, 0.04, 0.05]], top, bottom, 6),
    loft([[1.55, 0.05, 0.05, 0.05], [1.45, 0.17, 0.15, 0.06], [1.1, 0.2, 0.17, 0.04], [0.95, 0.15, 0.13, 0.03]], top, bottom, 6),
  ]), mat.body));
  const flipper = pts => merge([fin([0, 0, 0], pts, 0.05, top, bottom)]);
  const fl = new THREE.Group(); fl.position.set(0.55, -0.05, 0.55); body.add(fl);
  fl.add(new THREE.Mesh(flipper([[0, 0, 0.18], [0.7, 0, 0.0], [1.3, 0, -0.55], [0.5, 0, -0.25], [0, 0, -0.15]]), mat.body));
  const fr = new THREE.Group(); fr.position.set(-0.55, -0.05, 0.55); body.add(fr);
  fr.add(new THREE.Mesh(flipper(mirrorX([[0, 0, 0.18], [0.7, 0, 0.0], [1.3, 0, -0.55], [0.5, 0, -0.25], [0, 0, -0.15]])), mat.body));
  const rl = new THREE.Group(); rl.position.set(0.4, -0.05, -0.8); body.add(rl);
  rl.add(new THREE.Mesh(flipper([[0, 0, 0.1], [0.35, 0, -0.2], [0.2, 0, -0.45], [0, 0, -0.1]]), mat.body));
  const rr = new THREE.Group(); rr.position.set(-0.4, -0.05, -0.8); body.add(rr);
  rr.add(new THREE.Mesh(flipper(mirrorX([[0, 0, 0.1], [0.35, 0, -0.2], [0.2, 0, -0.45], [0, 0, -0.1]])), mat.body));
  return { body, animate(t) {
    const w = (Math.PI * 2) / 4.2, s = Math.sin(w * t), c = Math.cos(w * t);
    fl.rotation.z = 0.45 * s; fr.rotation.z = -0.45 * s;
    fl.rotation.y = 0.25 * c; fr.rotation.y = -0.25 * c;
    rl.rotation.y = 0.2 * s; rr.rotation.y = -0.2 * s;
  } };
}

function buildHammerhead(mat) {
  const top = 0x364146, bottom = 0x98a19d;
  const body = new THREE.Group();
  body.add(new THREE.Mesh(merge([
    loft([[2.45, 0.12, 0.1, 0], [2.0, 0.35, 0.4, 0], [0.6, 0.45, 0.52, 0], [-1.0, 0.33, 0.42, 0.02]], top, bottom, 6),
    // Cephalofoil: the wide, flat hammer.
    loft([[2.75, 0.2, 0.06, 0.05], [2.6, 0.62, 0.1, 0.05], [2.35, 0.6, 0.09, 0.05], [2.2, 0.2, 0.06, 0.05]], top, bottom, 6),
    fin([0, 0.45, 0.4], [[0, 0.45, 0.9], [0, 1.45, 0.05], [0, 1.3, -0.15], [0, 0.45, -0.1]], 0.04, top, top),
    fin([0.35, -0.3, 1.1], [[0.35, -0.3, 1.4], [1.25, -0.65, 0.6], [1.0, -0.6, 0.45], [0.35, -0.3, 0.8]], 0.04, top, bottom),
    fin([-0.35, -0.3, 1.1], mirrorX([[0.35, -0.3, 1.4], [1.25, -0.65, 0.6], [1.0, -0.6, 0.45], [0.35, -0.3, 0.8]]), 0.04, top, bottom),
  ]), mat.body));
  const tail = new THREE.Group(); tail.position.set(0, 0.02, -1.0); body.add(tail);
  tail.add(new THREE.Mesh(merge([
    loft([[0, 0.33, 0.42, 0], [-1.0, 0.16, 0.22, 0.05], [-1.5, 0.06, 0.08, 0.08]], top, bottom, 6),
    fin([0, 0.1, -1.4], [[0, 0.1, -1.25], [0, 1.05, -2.0], [0, 0.9, -2.1], [0, 0.05, -1.6], [0, -0.42, -1.85], [0, -0.1, -1.4]], 0.03, top, top),
  ]), mat.body));
  return { body, animate(t, id) {
    const w = (Math.PI * 2) / 2.4, p = hash01(id, 9) * 6.28;
    tail.rotation.y = 0.28 * Math.sin(w * t + p);
    body.children[0].rotation.y = -0.05 * Math.sin(w * t + p);
  } };
}

// Northern bottlenose whale (Hyperoodon ampullatus), about 7 m: the bulbous
// melon over a short distinct beak, a small falcate dorsal fin set well back,
// small flippers and a brown-grey back over a paler belly.
function buildBottlenoseWhale(mat) {
  const top = 0x4b4540, bottom = 0x8d867b;
  const body = new THREE.Group();
  body.add(new THREE.Mesh(merge([
    loft([[3.55, 0.05, 0.05, -0.16], [3.3, 0.16, 0.13, -0.15], [3.0, 0.3, 0.28, -0.08], [2.8, 0.5, 0.6, 0.1],
      [2.4, 0.66, 0.76, 0.1], [1.5, 0.82, 0.86, 0.02], [0.3, 0.88, 0.88, 0], [-0.8, 0.72, 0.74, 0.02],
      [-1.6, 0.5, 0.55, 0.05]], top, bottom, 8),
    fin([0, 0.72, -0.9], [[0, 0.72, -0.45], [0, 1.1, -1.05], [0, 1.02, -1.12], [0, 0.72, -1.3]], 0.04, top, top),
    fin([0.55, -0.45, 1.8], [[0.6, -0.45, 2.0], [1.15, -0.78, 1.45], [0.95, -0.74, 1.33], [0.6, -0.5, 1.6]], 0.04, top, bottom),
    fin([-0.55, -0.45, 1.8], mirrorX([[0.6, -0.45, 2.0], [1.15, -0.78, 1.45], [0.95, -0.74, 1.33], [0.6, -0.5, 1.6]]), 0.04, top, bottom),
  ]), mat.body));
  const tail = new THREE.Group(); tail.position.set(0, 0.05, -1.6); body.add(tail);
  tail.add(new THREE.Mesh(merge([loft([[0, 0.5, 0.55, 0], [-1.2, 0.22, 0.32, 0], [-1.8, 0.08, 0.12, 0]], top, bottom, 8)]), mat.body));
  const flukes = new THREE.Group(); flukes.position.set(0, 0, -1.8); tail.add(flukes);
  const flukePts = [[0.1, 0, 0.1], [0.7, 0, -0.4], [1.0, 0, -0.78], [0.45, 0, -0.62], [0, 0, -0.42]];
  flukes.add(new THREE.Mesh(merge([
    fin([0, 0, -0.1], flukePts, 0.06, top, bottom),
    fin([0, 0, -0.1], mirrorX(flukePts), 0.06, top, bottom),
  ]), mat.body));
  // Authored about 8 m nose to fluke tips; 0.9 brings it to about 7 m.
  body.scale.setScalar(0.9);
  return { body, animate(t, id) {
    const w = (Math.PI * 2) / 3.6, p = hash01(id, 9) * 6.28;
    tail.rotation.x = 0.13 * Math.sin(w * t + p);
    flukes.rotation.x = 0.25 * Math.sin(w * t + p - 0.9);
  } };
}

// Octopus clings to a vertical wall: local +Z is the wall's outward normal,
// arms spread in the local XY plane (the wall), tips peel and curl.
function buildOctopus(mat) {
  const top = 0x4a2824, bottom = 0x70483f;
  const body = new THREE.Group();
  const mantleGeo = loft([[0, 0.35, 0.3, 0], [0.4, 0.6, 0.5, 0], [1.0, 0.62, 0.55, 0], [1.55, 0.35, 0.32, 0], [1.75, 0.05, 0.05, 0]], top, bottom, 7);
  mantleGeo.rotateX(-Math.PI / 2 + 0.35);   // bulb rises up and out from the hub
  mantleGeo.translate(0, 0.1, 0.45);
  const mantle = new THREE.Mesh(merge([mantleGeo]), mat.body);
  body.add(mantle);
  const seg = new THREE.CylinderGeometry(1, 1, 1, 5, 1).toNonIndexed();
  seg.translate(0, 0.5, 0);
  const segC = colouredTriangles(Array.from(seg.attributes.position.array), bottom, top);
  seg.dispose();
  segC.computeVertexNormals();
  const ARMS = 8, SEGS = 7, ARM_LEN = 3.4;
  const arms = new THREE.InstancedMesh(segC, mat.body, ARMS * SEGS);
  arms.name = 'sea-life-octopus-arms';
  arms.frustumCulled = false;
  body.add(arms);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return { body, arms, animate(t, id) {
    mantle.scale.setScalar(1 + 0.04 * Math.sin(t * 0.8));
    let n = 0;
    for (let k = 0; k < ARMS; k++) {
      // Spread weighted towards the horizontal so the span fits the column.
      const base = (k / ARMS) * Math.PI * 2 + 0.2 + 0.25 * hsym(id, k);
      let theta = Math.atan2(Math.sin(base) * 0.7, Math.cos(base));
      let x = Math.cos(theta) * 0.35, y = Math.sin(theta) * 0.35 * 0.8, z = 0.25;
      const ph = hash01(id, k + 20) * 6.28, w = 0.35 + 0.15 * hash01(id, k + 40);
      for (let j = 0; j < SEGS; j++) {
        const u = j / (SEGS - 1), len = (ARM_LEN / SEGS) * (1 - 0.35 * u);
        theta += (0.05 + 0.32 * u * u) * Math.sin(w * t + ph + j * 0.7) + 0.06 * u;
        const lift = 0.35 * u * u * (0.5 + 0.5 * Math.sin(w * 0.6 * t + ph * 1.7));
        const nx = x + Math.cos(theta) * len, ny = y + Math.sin(theta) * len, nz = 0.25 + lift;
        dir.set(nx - x, ny - y, nz - z); const dl = dir.length(); dir.divideScalar(dl || 1);
        q.setFromUnitVectors(up, dir);
        const r = 0.2 * (1 - 0.85 * u) + 0.025;
        m.compose(p.set(x, y, z), q, s.set(r, dl * 1.12, r * 0.8)); // overlap hides joints
        arms.setMatrixAt(n++, m);
        x = nx; y = ny; z = nz;
      }
    }
    arms.instanceMatrix.needsUpdate = true;
  } };
}

// ── Main factory ────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {Array}  o.thamesPoints   thames.json points (BNG)
 * @param {object} o.navigation     thamesMesh.userData.navigation (contains, bedAt, topY)
 * @param {Array}  [o.bridges]      bridges.json bridges (for the pier anchor)
 * @param {number} [o.VE=5] @param {number} [o.topY] @param {number} [o.waterLevelM=2]
 */
export function createSeaLife({ thamesPoints, navigation, bridges = [], VE = 5, topY = navigation?.topY ?? 12, waterLevelM = 2 } = {}) {
  const river = buildRiverFrame(thamesPoints, { VE, topY, waterLevelM });
  if (!river) throw new Error('Sea life needs the Thames centreline');
  const mat = createMaterials();
  const group = new THREE.Group();
  group.name = 'seaLife';
  group.visible = false;
  let elapsed = 0;
  // Vertical scale of every creature root: base / Master, so bodies display
  // at true proportions (D-039). VE (= Master 1) until a camera says otherwise.
  let sy = VE;
  let schoolGeo = null; // shared by every school (built on first use)

  const bedAt = (x, z, fallback) => {
    const b = navigation?.bedAt?.(x, z);
    if (Number.isFinite(b)) return b;
    return typeof fallback === 'function' ? fallback() : fallback;
  };
  // Column placement: f in [0,1] from lowest to highest position the body
  // may take at this point, given its vertical half extents (real metres).
  function columnY(footprint, fallbackBed, vr, f) {
    let bed = -Infinity;
    for (const p of footprint) bed = Math.max(bed, bedAt(p.x, p.z, fallbackBed));
    const lo = bed + (vr.down + MARGIN_M) * VE, hi = topY - (vr.up + MARGIN_M) * VE;
    if (hi <= lo) return (lo + hi) / 2;
    return lo + THREE.MathUtils.clamp(f, 0, 1) * (hi - lo);
  }

  const creatures = [];
  const byId = new Map();
  function addCreature(c) { creatures.push(c); byId.set(c.id, c); group.add(c.root); }
  function makeRoot(name) {
    const root = new THREE.Group(); root.name = name; root.scale.set(1, sy, 1);
    const body = new THREE.Group(); body.rotation.order = 'YXZ'; root.add(body);
    return { root, holder: body };
  }

  // Path in (S, l, f) space: a closed loop around the anchor.
  function loopSLF(spec, idx, t) {
    const P = spec.path, id = `${spec.id}:${idx}`;
    const hwA = river.at(spec.S0, 0).hw;
    const R = Math.sqrt((P.A * P.A + (P.L * hwA) ** 2) / 2) || 1;
    const omega = (spec.speed / R) * (P.dir || 1);
    const phase = spec.count > 1 ? (idx / spec.count) * 0.55 + hsym(id, 1) * 0.05 : hash01(id, 1) * 6.283;
    const th = omega * t + phase;
    const S = spec.S0 + P.A * Math.cos(th) + (spec.count > 1 ? hsym(id, 2) * 12 : 0);
    const l = (P.l0 || 0) + P.L * Math.sin(th) + (spec.count > 1 ? hsym(id, 3) * 0.05 : 0)
      + 0.03 * Math.sin(th * 3.1 + hash01(id, 4) * 6.28);
    const f = P.f0 + P.fA * Math.sin(2 * th + hash01(id, 5) * 6.28) + (spec.count > 1 ? hsym(id, 6) * 0.06 : 0);
    return { S, l, f };
  }
  function placeSLF(spec, slf) {
    const a0 = river.at(slf.S, 0);
    const lMax = Math.max(0, 1 - (spec.r + BANK_MARGIN_M) / a0.hw);
    const l = THREE.MathUtils.clamp(slf.l, -lMax, lMax);
    const a = river.at(slf.S, l);
    const h = spec.r;
    const foot = [{ x: a.x, z: a.z }, { x: a.x + a.tx * h, z: a.z + a.tz * h }, { x: a.x - a.tx * h, z: a.z - a.tz * h },
      { x: a.x - a.tz * h, z: a.z + a.tx * h }, { x: a.x + a.tz * h, z: a.z - a.tx * h }];
    return { x: a.x, y: columnY(foot, a.bed, spec.vr, slf.f), z: a.z };
  }
  // Pure pose of a path-following individual at time t.
  function pathPose(spec, idx, t) {
    const p0 = placeSLF(spec, loopSLF(spec, idx, t));
    const p1 = placeSLF(spec, loopSLF(spec, idx, t + 0.5));
    const dx = p1.x - p0.x, dz = p1.z - p0.z, dh = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = THREE.MathUtils.clamp(Math.atan2((p1.y - p0.y) / sy, dh || 1e-6), -(spec.maxPitch ?? 0.1), spec.maxPitch ?? 0.1);
    return { x: p0.x, y: p0.y, z: p0.z, yaw, pitch, roll: 0 };
  }

  const speciesState = {};
  for (const base of SEA_LIFE_SPECIES) {
    const spec = { ...base };
    if (spec.anchor) spec.S0 = river.nearestS(spec.anchor.e - BNG_REF_E, -(spec.anchor.n - BNG_REF_N));
    speciesState[spec.id] = spec;

    if (spec.id === 'blue-whale' || spec.id === 'turtle' || spec.id === 'hammerhead' || spec.id === 'bottlenose-whale') {
      const build = { 'blue-whale': buildWhale, turtle: buildTurtle, hammerhead: buildHammerhead, 'bottlenose-whale': buildBottlenoseWhale }[spec.id];
      const { root, holder } = makeRoot(`sea-life:${spec.id}`);
      const made = build(mat); holder.add(made.body);
      addCreature({ id: spec.id, spec, root, holder, animate: made.animate,
        pose: t => pathPose(spec, 0, t) });
    } else if (spec.id === 'manta') {
      for (let i = 0; i < spec.count; i++) {
        const id = `manta-${i + 1}`;
        const { root, holder } = makeRoot(`sea-life:${id}`);
        const made = buildManta(mat); holder.add(made.body);
        addCreature({ id, spec, root, holder, animate: (t) => made.animate(t, id),
          pose: t => { const p = pathPose(spec, i, t); p.roll = 0.12 * Math.sin(t * 0.21 + i); return p; } });
      }
    } else if (spec.id === 'octopus') {
      const bridge = bridges.find(b => b.curatedSlug === spec.pier.bridge);
      const anchors = bridge ? bridgePierAnchors(bridge) : [];
      const pier = anchors[Math.min(spec.pier.index, anchors.length - 1)];
      if (!pier) continue;
      // Cling to the pier face that looks along the bridge axis into the arch.
      const nrm = { x: pier.ux, z: pier.uz };
      const x = pier.x + nrm.x * (pier.halfU + 0.05), z = pier.z + nrm.z * (pier.halfU + 0.05);
      const off = 2.5; // a little upstream of the pier's centre line
      const cx = x - pier.nx * off, cz = z - pier.nz * off;
      const along = { x: pier.nx, z: pier.nz };
      const foot = [-4, 0, 4].map(k => ({ x: cx + along.x * k, z: cz + along.z * k }));
      const sectionBed = river.at(river.nearestS(cx, cz), 0).bed;
      const y = columnY(foot, sectionBed, spec.vr, 0.45);
      const yaw = Math.atan2(nrm.x, nrm.z);
      const { root, holder } = makeRoot('sea-life:octopus');
      const made = buildOctopus(mat); holder.add(made.body);
      spec.pierAnchor = pier;
      addCreature({ id: 'octopus', spec, root, holder, animate: t => made.animate(t, 'octopus'),
        pose: t => ({ x: cx, y: y + 0.15 * VE * Math.sin(t * 0.11), z: cz, yaw, pitch: 0, roll: 0.05 * Math.sin(t * 0.07) }) });
    } else if (spec.id === 'jellyfish') {
      addJellies(spec);
    } else if (spec.school) {
      addSchool(spec);
    }
  }

  // ── Jellyfish: two InstancedMeshes (bells, tentacle bundles) ─────────
  function addJellies(spec) {
    const bellGeo = new THREE.SphereGeometry(0.9, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    bellGeo.scale(1, 0.7, 1);
    const tent = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, r = 0.55 + 0.2 * (k % 2);
      const c = new THREE.ConeGeometry(0.05, 5, 3, 1, true); c.translate(Math.cos(a) * r, -2.5, Math.sin(a) * r); tent.push(c.toNonIndexed()); c.dispose();
    }
    for (let k = 0; k < 4; k++) {
      const c = new THREE.ConeGeometry(0.22, 2.2, 4, 1, true); c.rotateY(k); c.translate(0.08 * Math.cos(k * 1.6), -1.1, 0.08 * Math.sin(k * 1.6));
      tent.push(c.toNonIndexed()); c.dispose();
    }
    const tentGeo = mergeGeometries(tent, false); for (const g of tent) g.dispose();
    const { root, holder } = makeRoot('sea-life:jellyfish');
    const bells = new THREE.InstancedMesh(bellGeo, mat.jelly, spec.count);
    const tents = new THREE.InstancedMesh(tentGeo, mat.jelly, spec.count);
    bells.name = 'sea-life-jelly-bells'; tents.name = 'sea-life-jelly-tentacles';
    for (const im of [bells, tents]) { im.frustumCulled = false; im.renderOrder = 3; holder.add(im); }
    // The holder is unrotated; instance matrices carry each jelly's pose.
    root.userData.instanced = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const jellyPose = (i, t) => {
      const id = `jelly-${i + 1}`;
      const S = spec.S0 + hsym(id, 1) * 180 + 25 * Math.sin(0.006 * t + hash01(id, 2) * 6.28);
      const l = hsym(id, 3) * 0.45 + 0.06 * Math.sin(0.009 * t + hash01(id, 4) * 6.28);
      // Pulsed rise, slow sink: a sawtooth softened by the bell's beat.
      const f = 0.25 + 0.5 * hash01(id, 5) + 0.12 * Math.sin(0.03 * t + hash01(id, 6) * 6.28);
      const pos = placeSLF(spec, { S, l, f });
      return { ...pos, yaw: hash01(id, 7) * 6.28 + 0.05 * t, pitch: 0.12 * Math.sin(0.05 * t + i), roll: 0.1 * Math.sin(0.04 * t + i * 2) };
    };
    const ids = [];
    for (let i = 0; i < spec.count; i++) ids.push(`jelly-${i + 1}`);
    const c = { id: 'jellyfish', spec, root, holder, instanced: true, count: spec.count, ids,
      poseOf: jellyPose,
      pose: t => jellyPose(0, t),
      apply(t) {
        for (let i = 0; i < spec.count; i++) {
          const P = jellyPose(i, t);
          const beat = Math.sin((Math.PI * 2 / 3.2) * t + hash01(`jelly-${i + 1}`, 8) * 6.28);
          e.set(P.pitch, P.yaw, P.roll, 'YXZ'); q.setFromEuler(e);
          m.compose(p.set(P.x, P.y / sy, P.z), q, s.set(1 - 0.1 * beat, 1 + 0.14 * beat, 1 - 0.1 * beat));
          bells.setMatrixAt(i, m);
          m.compose(p, q, s.set(1 + 0.05 * beat, 1 - 0.04 * beat, 1 + 0.05 * beat));
          tents.setMatrixAt(i, m);
        }
        bells.instanceMatrix.needsUpdate = true; tents.instanceMatrix.needsUpdate = true;
      },
      probes(t) {
        const out = [];
        for (let i = 0; i < spec.count; i++) {
          const P = jellyPose(i, t);
          out.push({ x: P.x, y: P.y + (0.7 * 0.9 * 1.14) * sy, z: P.z }, { x: P.x, y: P.y - 5 * sy, z: P.z },
            { x: P.x + 0.9, y: P.y, z: P.z }, { x: P.x - 0.9, y: P.y, z: P.z });
        }
        return out;
      } };
    addCreature(c);
  }

  // ── Fish schools: one InstancedMesh each; part around the camera ─────
  // Per-fish constants are hashed once at build time; the per-frame work is
  // arithmetic only, and a school beyond SCHOOL_DRAW_RANGE_M is neither posed
  // nor drawn (its pose stays a pure function of time when it returns).
  function addSchool(spec) {
    const k = spec.school.fishScale ?? 1;
    if (!schoolGeo) {
      // Brighter countershading than the other animals: a silver flank.
      const top = 0x6f8388, bottom = 0xf1f6f4;
      schoolGeo = merge([
        loft([[0.19, 0.01, 0.01, 0], [0.12, 0.035, 0.07, 0], [-0.05, 0.03, 0.06, 0], [-0.13, 0.008, 0.02, 0]], top, bottom, 5),
        fin([0, 0, -0.13], [[0, 0.01, -0.13], [0, 0.06, -0.2], [0, -0.06, -0.2], [0, -0.01, -0.13]], 0.005, top, bottom),
      ]);
      schoolGeo.scale(k, k, k);
      schoolGeo.computeBoundingBox(); schoolGeo.computeBoundingSphere();
    }
    const { root, holder } = makeRoot(`sea-life:${spec.id}`);
    const fish = new THREE.InstancedMesh(schoolGeo, mat.silver, spec.count);
    fish.name = `sea-life-${spec.id}`; fish.frustumCulled = false;
    holder.add(fish);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const R = spec.school.radius, avoid = spec.school.avoidM;
    const C1 = new Float64Array(spec.count), C2 = new Float64Array(spec.count), C3 = new Float64Array(spec.count);
    const C4 = new Float64Array(spec.count), C5 = new Float64Array(spec.count);
    for (let i = 0; i < spec.count; i++) {
      const id = `${spec.id === 'silver-school' ? 'fish' : spec.id}-${i}`;
      C1[i] = hash01(id, 1) * 2 - 1; C2[i] = hash01(id, 2) * Math.PI * 2; C3[i] = 0.6 + 0.4 * hash01(id, 3);
      C4[i] = R * Math.cbrt(0.05 + 0.95 * hash01(id, 4)); // filled to near the core, so a camera inside meets fish C5[i] = hash01(id, 5) * 6.28;
    }
    // Fish positions (holder units: displayed metres): school centre on its
    // loop, each fish on a hashed shell slowly wheeling around it, then pushed
    // radially out to the avoidance radius around the camera.
    function fishAt(t, camera) {
      const C = pathPose(spec, 0, t);
      const cy = C.y / sy, out = [];
      const cam = camera ? { x: camera.x, y: camera.y / sy, z: camera.z } : null;
      const sectionTop = (topY / sy) - MARGIN_M - 0.2;
      const cyw = Math.cos(C.yaw), syw = Math.sin(C.yaw);
      for (let i = 0; i < spec.count; i++) {
        const u = C1[i], az = C2[i] + 0.05 * t * C3[i];
        const rr = C4[i], rh = Math.sqrt(1 - u * u) * rr;
        const lx = Math.cos(az) * rh, lz = Math.sin(az) * rh;
        const ly = u * rr * spec.school.flatten + 0.25 * Math.sin(0.7 * t + C5[i]);
        // Rotate the shell into the school heading so it streams, not orbs.
        let x = C.x + lx * cyw + lz * syw * 1.6, z = C.z - lx * syw + lz * cyw * 1.6, y = cy + ly;
        let yaw = C.yaw + 0.15 * Math.sin(0.5 * t + i);
        if (cam) {
          const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = Math.hypot(dx, dy, dz);
          if (d < avoid) {
            if (d > 1e-6) { const k2 = (avoid - d) / d; x += dx * k2; y += dy * k2; z += dz * k2; yaw = Math.atan2(dx, dz); }
            else { x += Math.cos(az) * avoid; z += Math.sin(az) * avoid; yaw = Math.atan2(Math.cos(az), Math.sin(az)); }
          }
        }
        out.push({ x, y, z, yaw });
      }
      // Keep every fish in the water column around the school centre.
      const bedHere = bedAt(C.x, C.z, () => river.at(river.nearestS(C.x, C.z), 0).bed) / sy + MARGIN_M + 0.2;
      for (const f of out) f.y = Math.min(sectionTop, Math.max(bedHere, f.y));
      return { centre: C, fish: out, scaleY: sy };
    }
    const c = { id: spec.id, spec, root, holder, instanced: true, count: spec.count, fishAt, mesh: fish,
      pose: t => pathPose(spec, 0, t),
      apply(t, camera) {
        if (camera) {
          const C = pathPose(spec, 0, t);
          const far = Math.hypot(C.x - camera.x, (C.y - camera.y) / sy, C.z - camera.z) > SCHOOL_DRAW_RANGE_M;
          fish.visible = !far;
          if (far) return;
        }
        fish.visible = true;
        const { fish: F } = fishAt(t, camera);
        for (let i = 0; i < F.length; i++) {
          e.set(0, F[i].yaw, 0.2 * Math.sin(t * 2 + i), 'YXZ'); q.setFromEuler(e);
          m.compose(p.set(F[i].x, F[i].y, F[i].z), q, s); fish.setMatrixAt(i, m);
        }
        fish.instanceMatrix.needsUpdate = true;
      },
      probes(t, camera) {
        // Body extent of each fish (half length, half height) around its centre.
        const hl = 0.2 * k, hh = 0.07 * k;
        const out = [];
        for (const f of fishAt(t, camera).fish) {
          out.push({ x: f.x + Math.sin(f.yaw) * hl, y: (f.y + hh) * sy, z: f.z + Math.cos(f.yaw) * hl },
            { x: f.x - Math.sin(f.yaw) * hl, y: (f.y - hh) * sy, z: f.z - Math.cos(f.yaw) * hl });
        }
        return out;
      } };
    addCreature(c);
  }

  // Rest-pose probe points (real metres, body frame) for single creatures.
  const _box = new THREE.Box3(), _v = new THREE.Vector3();
  for (const c of creatures) {
    if (c.instanced) continue;
    if (c.id === 'octopus') {
      c.localProbes = [];
      for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const th = Math.atan2(Math.sin(a * Math.PI / 4 + 0.2) * 0.7, Math.cos(a * Math.PI / 4 + 0.2));
        c.localProbes.push(new THREE.Vector3(Math.cos(th) * 3.2, Math.sin(th) * 3.2, 0.5));
      }
      c.localProbes.push(new THREE.Vector3(0, 1.9, 1.2), new THREE.Vector3(0, 0, 0.2));
      continue;
    }
    c.holder.updateMatrixWorld(true);
    _box.makeEmpty();
    c.holder.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { o.geometry.computeBoundingBox(); _box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    // matrixWorld above includes root scale; undo to body metres.
    const inv = new THREE.Matrix4().copy(c.holder.matrixWorld).invert();
    const b = _box.clone().applyMatrix4(inv);
    c.localProbes = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) c.localProbes.push(new THREE.Vector3(x, y, z));
    c.localProbes.push(new THREE.Vector3(0, 0, b.max.z), new THREE.Vector3(0, 0, b.min.z));
  }

  function applyPose(c, t, camera) {
    if (c.instanced) { c.apply(t, camera); return; }
    const P = c.pose(t);
    c.root.position.set(P.x, P.y, P.z);
    c.holder.rotation.set(-P.pitch, P.yaw, P.roll, 'YXZ');
    c.animate?.(t, c.id);
  }
  // World (canonical) probe points of a creature posed at time t.
  function probes(id, t, camera = null) {
    const c = byId.get(id);
    if (!c) return [];
    if (c.instanced) return c.probes(t, camera);
    const P = c.pose(t);
    const body = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-P.pitch, P.yaw, P.roll, 'YXZ'));
    const pad = c.id === 'octopus' ? 0 : 0.08; // animated parts swing a touch past the rest box
    return c.localProbes.map(v => {
      _v.copy(v).multiplyScalar(1 + pad).applyMatrix4(body);
      return { x: P.x + _v.x, y: P.y + _v.y * sy, z: P.z + _v.z };
    });
  }

  let _lastCamera = null;
  // True proportions: follow the camera's Master (base / value). No
  // controller (node tests, a bare camera) means Master 1, i.e. VE.
  function setScaleY(next) {
    if (!Number.isFinite(next) || next <= 0 || next === sy) return;
    sy = next;
    for (const c of creatures) c.root.scale.y = sy;
  }
  function update(dt, camera, { submerged = false } = {}) {
    if (Number.isFinite(dt) && dt > 0) elapsed += dt;
    const mh = camera?.userData?.masterHeightController;
    if (mh) setScaleY(mh.base / mh.value);
    group.visible = !!submerged;
    if (!group.visible) return;
    _lastCamera = camera?.position ?? null;
    for (const c of creatures) applyPose(c, elapsed, _lastCamera);
  }
  function setElapsed(t) { elapsed = Math.max(0, +t || 0); if (group.visible) for (const c of creatures) applyPose(c, elapsed, _lastCamera); }

  function dispose() {
    group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of Object.values(mat)) { m.map?.dispose(); m.dispose(); }
    schoolGeo?.dispose();
    group.removeFromParent();
  }

  const api = {
    group, update, setElapsed, getElapsed: () => elapsed, probes, dispose, river, setScaleY,
    get scaleY() { return sy; }, schoolIds: SCHOOL_IDS,
    species: speciesState,
    ids: creatures.map(c => c.id),
    poseAt(id, t) { const c = byId.get(id); return c ? c.pose(t) : null; },
    fishAt(t, camera, id = 'silver-school') { return byId.get(id)?.fishAt(t, camera) ?? null; },
    jellyPose(i, t) { return byId.get('jellyfish')?.poseOf(i, t) ?? null; },
    /** A viewing spot for each creature: behind and level with it at time t. */
    viewpoint(id, t, distance = 40) {
      const c = byId.get(id); if (!c) return null;
      const P = c.pose(t);
      // The octopus faces out of its pier; view it from the water, not the stone.
      const s = id === 'octopus' ? -1 : 1;
      const hx = Math.sin(P.yaw) * s, hz = Math.cos(P.yaw) * s;
      return { target: { x: P.x, y: P.y, z: P.z }, eye: { x: P.x - hx * distance, y: P.y, z: P.z - hz * distance } };
    },
  };
  group.userData.seaLife = api;
  group.userData.stats = { species: SEA_LIFE_SPECIES.length, individuals: SEA_LIFE_SPECIES.reduce((n, s) => n + (s.count ?? 1), 0) };
  return api;
}
