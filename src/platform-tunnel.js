// platform-tunnel.js: the lit platform tunnel a Pedestrian walker's bore
// opens into at every station (sprint 30Sep26w, D-041 item 4, Lane P).
//
// Jordan (D-040 item 5): "it needs to be visually clear when you reach the
// next station". Grilled (D-041 item 4): "the bore opens into a lit platform
// tunnel at true size with roundel name boards and the name shown briefly on
// screen".
//
// SOURCED DIMENSIONS (true size; every figure below is real metres):
//   * Station (platform) tunnel 21 ft 2.5 in (6.46 m) internal diameter and
//     350 ft (106.7 m) long: the Yerkes tubes' standard, e.g. Brompton Road on
//     the Great Northern, Piccadilly and Brompton Railway (Subterranea
//     Britannica, "Brompton Road Underground Station",
//     https://www.subbrit.org.uk/sites/brompton-road-underground-station-and-gun-operations-room/;
//     Grace's Guide, "Great Northern, Piccadilly and Brompton Railway": "At
//     stations, the platforms and track are accommodated in tunnels 21ft.
//     2 1/2in in internal diameter"). Wikipedia's "London deep-level
//     shelters" gives "about 21 feet (6.4 m) at stations" for the tube lines
//     generally. The running tunnels either side are the bores main.js draws
//     (true-proportion.js, 11 ft 8.25 in / 3.56 m).
//   * Tube train 2.629 m wide and 2.875 m high (London Underground 1996 Stock,
//     Wikipedia), for the clearance the section is fitted to.
//   * Platform at the tube train's floor height, about 685 mm above rail
//     ("the floor height of a tube train is about 685mm above rail level",
//     metadyne.co.uk, "Mind The Gap").
//   * Platform edge 75 mm from the train side: the most TfL's step-free
//     criterion allows ("a horizontal gap can be no bigger than 75mm", London
//     Assembly, "Step-free access on the London Underground (2)").
//   * Platform edge: the coping, then the blister warning surface "installed
//     to a depth of 400mm", "laid immediately behind the platform edge coping
//     stone ... in most cases between 600mm and 700mm back from the platform
//     edge" (Department for Transport, "Guidance on the use of tactile paving
//     surfaces"): 0.6 m coping, 0.4 m warning strip.
//   * Roundel name boards 973 x 798 mm, one of the two commonest roundel sizes
//     (A.J. Wells, London Underground's vitreous enamel sign maker, "London
//     Underground Signs FAQs"), centred 2 m above the platform (London
//     Overground signs standard Issue 4: platform roundels "positioned at a
//     height of 2m"). The roundel's own geometry (ring outer diameter 406.29,
//     inner 262.14, bar 500 x 82.17 in one unit) is Wikimedia Commons'
//     "Underground (no text).svg", and 973 / 798 = 1.219 matches its 500 /
//     406.29 = 1.231 to 1%. One board per 16 m, one car of trains.js's train.
//
//   NOT SOURCED (a fit, stated as such): where the tunnel's centre sits
//   relative to the track. It is placed so the sourced numbers above all hold
//   at once: the track 1.1 m off the tunnel's centre, away from the platform,
//   and the rail 1.9 m below it, which clears the 1996 Stock outline by more
//   than 0.4 m and leaves a 2.7 m platform. Every Tube line uses this one deep
//   tube section, including the sub-surface lines' stations (really cut and
//   cover boxes): a simplification, reported.
//
// HEIGHT CONTRACT (D-039): a structure. Vertices are the walker's bore axis
// (canonical y) plus REAL-metre offsets, the axis height in `trueAxisY`, and
// the material carries true-proportion.js's 'axis' patch, exactly as the
// lining does, so the section is true at every Master.
//
// LAYERS: like the lining, tube-interior.js puts these meshes on the default
// layer and INTERIOR_LAYER and shows them only while the walker is in the bore.

import * as THREE from 'three';
import { setAxisAttribute, patchTrueProportionMaterial } from './true-proportion.js';

export const PLATFORM = Object.freeze({
  tunnelDiameterM: 6.46,   // 21 ft 2.5 in
  lengthM: 106.68,         // 350 ft
  trainWidthM: 2.629,
  trainHeightM: 2.875,
  floorAboveRailM: 0.685,
  edgeGapM: 0.075,
  copingM: 0.6,
  tactileM: 0.4,
  gaugeM: 1.435,
  railHeightM: 0.15,       // model detail, not sourced
  railWidthM: 0.07,        // model detail, not sourced
  trackOffsetM: 1.1,       // fit (see header)
  centreAboveRailM: 1.9,   // fit (see header)
  roundelWidthM: 0.973,
  roundelHeightM: 0.798,
  roundelCentreM: 2.0,     // above the platform
  roundelPitchM: 16,
  friezeLowM: 2.45,        // line-colour frieze band, above the platform (design choice)
  friezeHighM: 2.62,
});

// Roundel construction, Wikimedia Commons "Underground (no text).svg" units.
export const ROUNDEL = Object.freeze({ outerR: 203.1445, innerR: 131.0685, barW: 500, barH: 82.173, width: 500, height: 406.289,
  red: '#E1251B', blue: '#000F9F' });

/**
 * The cross-section in the walker's bore frame: u across (+ toward the
 * platform), v up, origin on the bore axis (the walker's eye line), metres.
 * `liningRadius` places the rails where the lining draws them.
 */
export function platformSection(liningRadius = 1.72) {
  const P = PLATFORM;
  const half = P.gaugeM / 2;
  const railV = -Math.sqrt(Math.max(0, liningRadius * liningRadius - half * half));
  const bedV = railV - P.railHeightM;
  const cu = P.trackOffsetM, cv = railV + P.centreAboveRailM;
  // The larger bores (Jubilee extension, sub-surface boxes, DLR) would poke
  // their eye through a 6.46 m station tunnel: widen it just enough (not sourced).
  const Rs = Math.max(P.tunnelDiameterM / 2, Math.hypot(cu, cv) + liningRadius + 0.25);
  const platformV = railV + P.floorAboveRailM;
  const edgeU = P.trainWidthM / 2 + P.edgeGapM;
  const at = (v, sign) => cu + sign * Math.sqrt(Math.max(0, Rs * Rs - (v - cv) * (v - cv)));
  const backU = at(platformV, 1);
  const trackWallU = at(bedV, -1);
  return {
    Rs, cu, cv, railV, bedV, platformV, edgeU, backU, trackWallU,
    platformWidthM: backU - edgeU,
    wallU: at,  // wallU(v, +1) back wall, wallU(v, -1) track-side wall
    // Clearance of the train's outline (half width x height above rail) to the tunnel wall.
    trainClearanceM: Rs - Math.hypot(-P.trainWidthM / 2 - cu, railV + P.trainHeightM - cv),
    headroomAtEdgeM: cv + Math.sqrt(Math.max(0, Rs * Rs - (edgeU - cu) ** 2)) - platformV,
  };
}

const KIND = { wall: 1, top: 2, face: 3, bed: 4, rail: 5, end: 6 };

/**
 * Frames along a canonical polyline [{x,y,z,s}] (as tube-interior.js builds
 * them): tangent t (y / VE), side = UP x t, up = t x side.
 */
function frames(points, VE) {
  const UP = new THREE.Vector3(0, 1, 0);
  const out = [];
  const prevSide = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector3(b.x - a.x, (b.y - a.y) / VE, b.z - a.z);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    t.normalize();
    const side = new THREE.Vector3().crossVectors(UP, t);
    if (side.lengthSq() < 1e-10) side.copy(prevSide);
    side.normalize(); prevSide.copy(side);
    const up = new THREE.Vector3().crossVectors(t, side).normalize();
    out.push({ t, side, up });
  }
  return out;
}

/** The window's points between arcs a0 and a1, with exact end points. */
export function slicePolyline(points, a0, a1) {
  const out = [];
  const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k, s: p.s + (q.s - p.s) * k });
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], q = points[i + 1];
    if (q.s < a0 || p.s > a1) continue;
    if (p.s <= a0 && q.s >= a0 && q.s > p.s) out.push(lerp(p, q, (a0 - p.s) / (q.s - p.s)));
    if (p.s > a0 && p.s < a1) out.push({ ...p });
    if (p.s <= a1 && q.s >= a1 && q.s > p.s) { out.push(lerp(p, q, (a1 - p.s) / (q.s - p.s))); break; }
  }
  // Drop coincident neighbours.
  return out.filter((p, i) => i === 0 || Math.abs(p.s - out[i - 1].s) > 1e-4);
}

/**
 * The platform tunnel's geometry along `points` (a slice of the bore window
 * from one end of the platform to the other). `sigma` is +1 when the platform
 * is on the bore's `side` (UP x t) hand, -1 on the other. Attributes:
 * position, trueAxisY, ptA = (arc metres along, metres round the profile,
 * height above the platform, kind), ptB = (u across, v up, 0, rail-head v).
 */
export function buildPlatformGeometry(points, { sigma = 1, liningRadius = 1.72, VE = 5, arcSegments = 40, endSegments = 48 } = {}) {
  const S = platformSection(liningRadius);
  const F = frames(points, VE);
  const pos = [], axis = [], A = [], B = [], idx = [];
  const put = (i, u, v, around, kind) => {
    const P = points[i], f = F[i];
    const L = f.side, U = f.up;
    pos.push(P.x + sigma * u * L.x + v * U.x, P.y + sigma * u * L.y + v * U.y, P.z + sigma * u * L.z + v * U.z);
    axis.push(P.y);
    A.push(P.s, around, v - S.platformV, kind);
    B.push(u, v, 0, S.railV);
    return pos.length / 3 - 1;
  };
  // A profile swept along every point: consecutive profile vertices join into quads.
  const sweep = (profile, kind) => {
    const n = points.length, m = profile.length;
    const base = pos.length / 3;
    let around = 0;
    const arcs = profile.map((q, k) => { if (k) around += Math.hypot(q[0] - profile[k - 1][0], q[1] - profile[k - 1][1]); return around; });
    for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) put(i, profile[k][0], profile[k][1], arcs[k], kind);
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < m - 1; k++) {
        const a = base + i * m + k, b = base + (i + 1) * m + k, c = base + i * m + k + 1, d = base + (i + 1) * m + k + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  };
  // Tunnel wall: from the back of the platform, up over the crown, down to the track bed.
  const th0 = Math.asin((S.platformV - S.cv) / S.Rs);
  const th1 = Math.PI - Math.asin((S.bedV - S.cv) / S.Rs);
  const wall = [];
  for (let k = 0; k <= arcSegments; k++) {
    const th = th0 + (th1 - th0) * (k / arcSegments);
    wall.push([S.cu + S.Rs * Math.cos(th), S.cv + S.Rs * Math.sin(th)]);
  }
  sweep(wall, KIND.wall);
  sweep([[S.edgeU, S.platformV], [S.edgeU + PLATFORM.copingM, S.platformV], [S.edgeU + PLATFORM.copingM + PLATFORM.tactileM, S.platformV], [S.backU, S.platformV]], KIND.top);
  sweep([[S.edgeU, S.bedV], [S.edgeU, S.platformV]], KIND.face);
  sweep([[S.trackWallU, S.bedV], [S.edgeU, S.bedV]], KIND.bed);
  const hw = PLATFORM.railWidthM / 2, half = PLATFORM.gaugeM / 2;
  for (const x of [-half, half]) sweep([[x - hw, S.bedV], [x - hw, S.railV], [x + hw, S.railV], [x + hw, S.bedV]], KIND.rail);

  // End walls: the ring between the station tunnel and the running tunnel's
  // eye (the lining continues through it), facing into the platform tunnel.
  const Cu = S.cu, Cv = S.cv;
  for (const i of [0, points.length - 1]) {
    const base = pos.length / 3;
    for (let k = 0; k <= endSegments; k++) {
      const ph = (2 * Math.PI * k) / endSegments;
      const eu = Math.cos(ph), ev = Math.sin(ph);
      const dot = eu * Cu + ev * Cv;
      const ro = dot + Math.sqrt(Math.max(0, dot * dot - (Cu * Cu + Cv * Cv) + S.Rs * S.Rs));
      put(i, eu * liningRadius, ev * liningRadius, ph * liningRadius, KIND.end);
      put(i, eu * ro, ev * ro, ph * ro, KIND.end);
    }
    for (let k = 0; k < endSegments; k++) {
      const a = base + 2 * k, b = base + 2 * k + 1, c = base + 2 * (k + 1), d = base + 2 * (k + 1) + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('ptA', new THREE.Float32BufferAttribute(A, 4));
  g.setAttribute('ptB', new THREE.Float32BufferAttribute(B, 4));
  setAxisAttribute(g, axis);
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Roundel boards along both walls: on the platform's back wall facing the
 * track, and on the track-side wall facing the platform. Quads with uv.
 */
export function buildRoundelGeometry(points, { sigma = 1, liningRadius = 1.72, VE = 5 } = {}) {
  const S = platformSection(liningRadius);
  const F = frames(points, VE);
  const P = PLATFORM;
  const pos = [], axis = [], uv = [], idx = [];
  const len = points.at(-1).s - points[0].s;
  const count = Math.max(1, Math.floor(len / P.roundelPitchM));
  const first = points[0].s + (len - (count - 1) * P.roundelPitchM) / 2;
  const vC = S.platformV + P.roundelCentreM, vTop = vC + P.roundelHeightM / 2;
  const w = P.roundelWidthM / 2, h = P.roundelHeightM / 2;
  const at = (s) => {
    let i = 0;
    while (i < points.length - 2 && points[i + 1].s < s) i++;
    const a = points[i], b = points[i + 1], k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const f = F[i];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, f };
  };
  for (let n = 0; n < count; n++) {
    const s = first + n * P.roundelPitchM;
    const q = at(s), { t, side, up } = q.f;
    const L = side.clone().multiplyScalar(sigma);
    for (const wallSign of [1, -1]) {
      // The board stands just proud of the wall at its top edge, where the wall leans in most.
      const u = wallSign > 0 ? S.wallU(vTop, 1) - 0.03 : S.wallU(vTop, -1) + 0.03;
      const facing = L.clone().multiplyScalar(wallSign);          // the viewer looks along this
      const right = new THREE.Vector3().crossVectors(facing, up).normalize();
      const c = { x: q.x + u * L.x + vC * up.x, y: q.y + u * L.y + vC * up.y, z: q.z + u * L.z + vC * up.z };
      const base = pos.length / 3;
      for (const [sx, sy, tu, tv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [-1, 1, 0, 1], [1, 1, 1, 1]]) {
        pos.push(c.x + right.x * w * sx + up.x * h * sy, c.y + right.y * w * sx + up.y * h * sy, c.z + right.z * w * sx + up.z * h * sy);
        axis.push(q.y);
        uv.push(tu, tv);
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    void t;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  setAxisAttribute(g, axis);
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Linear-space palette, all under the bloom threshold except the lamps.
const COL = {
  tile: [0.42, 0.395, 0.33],     // cream glazed tile
  grout: [0.24, 0.23, 0.2],
  soffit: [0.16, 0.16, 0.16],     // painted crown and cable runs
  coping: [0.4, 0.4, 0.38],
  tactile: [0.5, 0.38, 0.08],     // buff-yellow blister surface
  floor: [0.13, 0.125, 0.12],
  face: [0.05, 0.05, 0.05],
  bed: [0.035, 0.032, 0.03],
  rail: [0.42, 0.42, 0.44],       // polished head; the web and foot are rust (railSide)
  railSide: [0.05, 0.035, 0.025],
  lamp: [0.95, 0.93, 0.86],
};
const v3 = (c) => `vec3(${c.map(x => x.toFixed(4)).join(', ')})`;

/** The platform tunnel material: vertex-free, pattern from ptA/ptB. */
export function createPlatformMaterial() {
  const uniforms = { uLineColour: { value: new THREE.Color(1, 1, 1) }, uFadeNear: { value: 110 }, uFadeFar: { value: 230 } };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: true });
  mat.name = 'platform-tunnel';
  const P = PLATFORM;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 ptA;\nattribute vec4 ptB;\nvarying vec4 vPtA;\nvarying vec4 vPtB;\nvarying float vPtDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPtA = ptA;\nvPtB = ptB;\nvPtDist = length( mvPosition.xyz );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uLineColour;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec4 vPtA;
varying vec4 vPtB;
varying float vPtDist;
float ptBand( float d, float halfWidth, float aa ) { return 1.0 - smoothstep( halfWidth, halfWidth + aa, d ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float along = vPtA.x, around = vPtA.y, h = vPtA.z, kind = vPtA.w;
  float u = vPtB.x, v = vPtB.y;
  vec3 col = ${v3(COL.face)};
  if ( kind < 1.5 || kind > 5.5 ) {
    // Glazed tiles, 6 x 3 in (0.152 x 0.076 m), with grout lines.
    float aa1 = fwidth( along ) + 1e-4, aa2 = fwidth( around ) + 1e-4;
    float gx = fract( along / 0.152 ), gy = fract( around / 0.076 );
    float grout = max( ptBand( min( gx, 1.0 - gx ) * 0.152, 0.004, aa1 ), ptBand( min( gy, 1.0 - gy ) * 0.076, 0.004, aa2 ) );
    grout *= clamp( 1.0 - max( aa1, aa2 ) * 30.0, 0.0, 1.0 );
    col = mix( ${v3(COL.tile)}, ${v3(COL.grout)}, grout * 0.6 );
    // The crown above the lamps is painted dark; the frieze is the line's colour.
    float crown = smoothstep( 3.7, 3.9, h );
    col = mix( col, ${v3(COL.soffit)}, crown );
    float frieze = step( ${P.friezeLowM.toFixed(3)}, h ) * step( h, ${P.friezeHighM.toFixed(3)} );
    col = mix( col, uLineColour * 0.75, frieze * ( kind < 1.5 ? 1.0 : 0.0 ) );
    // A continuous lamp line either side of the crown.
    float lampH = 3.55;
    float lamp = ptBand( abs( h - lampH ), 0.05, fwidth( h ) + 1e-4 ) * ( kind < 1.5 ? 1.0 : 0.0 );
    col = mix( col, ${v3(COL.lamp)}, lamp );
    // End walls: plain tile, darker toward the eye of the running tunnel.
    if ( kind > 5.5 ) col *= 0.8;
  } else if ( kind < 2.5 ) {
    // Platform top: coping, the blister warning strip behind it, then the floor.
    float fromEdge = around;           // metres back from the platform edge (the profile starts there)
    col = ${v3(COL.floor)};
    col = mix( col, ${v3(COL.tactile)}, step( ${P.copingM.toFixed(3)}, fromEdge ) * step( fromEdge, ${(P.copingM + P.tactileM).toFixed(3)} ) );
    col = mix( col, ${v3(COL.coping)}, step( fromEdge, ${P.copingM.toFixed(3)} ) );
    // White line along the coping's lip.
    col = mix( col, vec3( 0.8 ), ptBand( fromEdge, 0.05, fwidth( fromEdge ) + 1e-4 ) );
  } else if ( kind < 3.5 ) {
    col = ${v3(COL.face)};
  } else if ( kind < 4.5 ) {
    col = ${v3(COL.bed)};
  } else {
    // Only the running surface of the rail is polished.
    col = mix( ${v3(COL.railSide)}, ${v3(COL.rail)}, step( ${(-0.004).toFixed(3)}, v - vPtB.w ) );
  }
  diffuseColor.rgb = col;
}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  gl_FragColor.rgb *= mix( 1.0, 0.18, smoothstep( uFadeNear, uFadeFar, vPtDist ) );`);
  };
  mat.customProgramCacheKey = () => 'platform-tunnel-v1';
  mat.userData.platformUniforms = uniforms;
  return patchTrueProportionMaterial(mat, { mode: 'axis' });
}

const textureCache = new Map();   // name -> { texture, used }
let fontPromise = null;

/** The roundel with the station's name on its bar, as a canvas texture (cached). */
export function roundelTexture(name, { document = globalThis.document } = {}) {
  const key = String(name || '').toUpperCase();
  const hit = textureCache.get(key);
  if (hit) { hit.used = textureCache.size; return hit.texture; }
  if (!document?.createElement) return null;
  const W = 1024, H = Math.round(W * ROUNDEL.height / ROUNDEL.width);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = () => {
    const c = canvas.getContext('2d');
    if (!c) return;
    const k = W / ROUNDEL.width, cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    c.fillStyle = ROUNDEL.red;
    c.beginPath();
    c.arc(cx, cy, ROUNDEL.outerR * k, 0, Math.PI * 2);
    c.arc(cx, cy, ROUNDEL.innerR * k, 0, Math.PI * 2, true);
    c.fill('evenodd');
    const bh = ROUNDEL.barH * k;
    c.fillStyle = ROUNDEL.blue;
    c.fillRect(0, cy - bh / 2, W, bh);
    // Johnston is TfL's; the app ships the open Railway face (index.html) for it.
    let size = Math.round(bh * 0.66);
    const family = "'Railway Sans', 'Helvetica Neue', Arial, sans-serif";
    c.font = `${size}px ${family}`;
    const maxW = W * 0.9;
    while (size > 18 && c.measureText(key).width > maxW) { size -= 2; c.font = `${size}px ${family}`; }
    c.fillStyle = '#e6e6e6';  // under the bloom threshold
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(key, cx, cy + size * 0.04);
    texture.needsUpdate = true;
  };
  draw();
  try {
    fontPromise ??= document.fonts?.load?.("64px 'Railway Sans'") ?? null;
    fontPromise?.then?.(() => draw(), () => {});
  } catch { /* no font API: the fallback face stays */ }
  textureCache.set(key, { texture, used: textureCache.size });
  // Keep the cache small: a walk passes a few dozen stations at most.
  if (textureCache.size > 24) {
    const oldest = [...textureCache].sort((a, b) => a[1].used - b[1].used)[0];
    oldest[1].texture.dispose();
    textureCache.delete(oldest[0]);
  }
  return texture;
}

export function createRoundelMaterial(texture) {
  const mat = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, fog: false, toneMapped: true });
  mat.name = 'platform-roundel';
  mat.customProgramCacheKey = () => 'platform-roundel-v1';
  return patchTrueProportionMaterial(mat, { mode: 'axis' });
}
