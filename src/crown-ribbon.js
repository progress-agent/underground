// Crown ribbon line-colour device (Item A, 10Jul26f).
//
// An OPAQUE, slightly-emissive ribbon of the canonical line colour running
// along every tunnel crown (11 tube lines + DLR + Elizabeth; NOT sewers/
// Tideway/canals). Shallow box section: reads as a thin line edge-on at
// tunnel height and a full-width stripe from above/below — a tube-map device
// draped over the physical network. Dark lines (Northern, Jubilee) get white
// casing edges flanking the colour ribbon, tube-map style, legible from BOTH
// above and below (flanking, not underlay).
//
// WHY OPAQUE IS SAFE FROM ALTITUDE: the terrain TOP mesh writes depth
// (terrain.js — only the underside is depthWrite:false), so a depth-tested
// opaque ribbon is correctly occluded from above ground. The frosted-tube
// glow-through-terrain hazard is specific to `transmission` bypassing opaque
// occlusion — the ribbon uses none. Keep emissiveIntensity <= 0.3 so
// AgX + bloom (threshold 0.88) never blooms it above terrain.
//
// transparent:false is load-bearing: any accidental transparent:true moves
// ribbons to the transparent queue and re-opens the glow-through class of
// bugs. Regression spec: tests/crown-ribbon.spec.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RENDER_ORDER } from './render-layers.js';

// Cross-section is CONSTANT for all lines including Crossrail's radius-9 tube
// (only baseRadius changes per host tube) — the ribbon is a map device, not
// physical infrastructure.
export const RIBBON_WIDTH = 3.2;        // scene units, full stripe width
export const RIBBON_THICKNESS = 0.7;    // vertical box depth (edge-on read)
export const RIBBON_BASE_RADIUS = 4.4;  // 0.1 embedded into the 4.5 glass crown (no gap seam)
export const CASING_WIDTH = 0.7;        // each flanking white edge
export const CASING_DROP = 0.05;        // casing sits 0.05 lower — kills coplanar z-fights

// Sub-surface lines sharing cut-and-cover alignments have IDENTICAL
// centrelines between shared stations (station positions dedup by NaPTAN id),
// so their crown ribbons would be coplanar and z-fight (yellow/green
// braiding on the Circle/District corridor, seen in first captures).
// Deterministic per-line radial lifts separate them; steps sized for depth
// precision (near=1 plane) at the ~1-2km ranges where the stripe is visibly
// wide. The highest ribbon wins from above (met > district > h&c > circle).
export const LINE_RIBBON_LIFT = {
  circle: 0,
  'hammersmith-city': 0.18,
  district: 0.36,
  metropolitan: 0.54,
};

// Jordan-named low-luminance lines that need white casing edges.
// FLAGGED further candidates (linear luma): piccadilly 0x0019a8 (~0.035),
// metropolitan 0x9b0056 (~0.076), district 0x00782a (~0.13 borderline),
// elizabeth 0x6950a1 (~0.12 borderline). Extending is a one-token change —
// screenshot a clay-depth pose first and let Jordan decide.
export const CASING_LINES = new Set(['northern', 'jubilee', 'piccadilly', 'metropolitan', 'district', 'elizabeth']); // crossrail.js consumes Elizabeth casing directly.

// TfL canonical Elizabeth line purple — NOT the legacy gold (0xffd300) used
// by the crossrail tunnel body/glow.
export const ELIZABETH_LINE_COLOUR = 0x6950a1;

const UP = new THREE.Vector3(0, 1, 0);

// Box-section ribbon extruded along `curve` at the tunnel crown.
// Four faces (top/bottom/left/right), no end caps (termini are underground /
// off-view). Faces share no vertices so computeVertexNormals stays crisp.
// `lateralOffset` shifts the section sideways along the ring `side` vector
// (used by the casing edges).
export function createCrownRibbonGeometry(curve, {
  segments = 128,
  width = RIBBON_WIDTH,
  thickness = RIBBON_THICKNESS,
  baseRadius = RIBBON_BASE_RADIUS,
  lateralOffset = 0,
} = {}) {
  const halfW = width / 2;
  const rings = []; // per ring: [bl, br, tl, tr]
  const prevSide = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    side.crossVectors(UP, T);
    // Near-vertical tangent guard: reuse the previous side vector.
    if (side.lengthSq() < 1e-8) side.copy(prevSide);
    side.normalize();
    prevSide.copy(side);
    up.crossVectors(T, side).normalize();

    const low = P.clone().addScaledVector(up, baseRadius).addScaledVector(side, lateralOffset);
    const bl = low.clone().addScaledVector(side, -halfW);
    const br = low.clone().addScaledVector(side, halfW);
    const tl = bl.clone().addScaledVector(up, thickness);
    const tr = br.clone().addScaledVector(up, thickness);
    rings.push([bl, br, tl, tr]);
  }

  // Each face is a quad strip between ring corners A and B, wound so the
  // outward normal is cross(T, B-A): top (tl,tr)->up, bottom (br,bl)->-up,
  // left (bl,tl)->-side, right (tr,br)->+side. Ring corner order: 0=bl 1=br 2=tl 3=tr.
  const FACES = [[2, 3], [1, 0], [0, 2], [3, 1]];
  const positions = [];
  const indices = [];
  for (const [a, b] of FACES) {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const r = rings[i];
      positions.push(r[a].x, r[a].y, r[a].z, r[b].x, r[b].y, r[b].z);
    }
    for (let i = 0; i < segments; i++) {
      const o = base + i * 2;
      indices.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Two flanking casing boxes, flush against the colour ribbon's edges
// (centres at +/-(RIBBON_WIDTH/2 + CASING_WIDTH/2)), same thickness, base
// dropped by CASING_DROP to avoid coplanar z-fighting with the colour ribbon.
export function createCasingGeometries(curve, {
  segments = 128,
  baseRadius = RIBBON_BASE_RADIUS - CASING_DROP,
} = {}) {
  const offset = RIBBON_WIDTH / 2 + CASING_WIDTH / 2;
  const opts = { segments, width: CASING_WIDTH, thickness: RIBBON_THICKNESS, baseRadius };
  return [
    createCrownRibbonGeometry(curve, { ...opts, lateralOffset: -offset }),
    createCrownRibbonGeometry(curve, { ...opts, lateralOffset: offset }),
  ];
}

// Canonical colour, NOT brightenIfTooDark — Northern stays black; the white
// casing carries legibility. Opaque + depth-tested (defaults) so terrain
// occludes it correctly from above ground.
export function createRibbonMaterial(hex) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.22,
    roughness: 0.55,
    metalness: 0.0,
    fog: true, // clay fog dims at distance; inside-chalk clarity reveals (Item B)
  });
}

export function createCasingMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.15,
    roughness: 0.55,
    metalness: 0.0,
    fog: true,
  });
}

// Build the merged per-line ribbon meshes for a set of tunnel curves
// (twin tunnels: one entry per crown, left AND right — both carry trains).
// Returns [colourMesh] or [colourMesh, casingMesh]. ONE draw call per mesh.
//
// The caller owns scene placement + pickable registration. Do NOT register
// these in lineMeshesById — setHoverHighlight hard-resets that map with
// glass-material values (opacity/thickness) that would stomp the ribbon;
// ribbons live in their own registry (lineRibbonsById in main.js).
export function buildCrownRibbons({
  lineId,
  colour,
  curves,             // [{ curve, segments, baseRadius? }, ...]
  userData = null,
  casing = CASING_LINES.has(lineId),
} = {}) {
  if (!curves || curves.length === 0) return [];

  const lift = LINE_RIBBON_LIFT[lineId] ?? 0;
  const colourGeos = [];
  const casingGeos = [];
  for (const { curve, segments, baseRadius = RIBBON_BASE_RADIUS } of curves) {
    colourGeos.push(createCrownRibbonGeometry(curve, { segments, baseRadius: baseRadius + lift }));
    if (casing) {
      casingGeos.push(...createCasingGeometries(curve, { segments, baseRadius: baseRadius + lift - CASING_DROP }));
    }
  }

  const meshes = [];
  const makeMesh = (geos, material, name, baseEmissive, hoverEmissive) => {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const g of geos) g.dispose(); // merge copies data
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    // Opaque queue — depth does the occlusion work; the tier is documentary
    // (kept for consistency with the tunnels the ribbon decorates).
    mesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    mesh.userData = { ...(userData || {}), _baseEmissive: baseEmissive, _hoverEmissive: hoverEmissive };
    return mesh;
  };

  meshes.push(makeMesh(colourGeos, createRibbonMaterial(colour), `ribbon:${lineId}`, 0.22, 0.45));
  if (casing && casingGeos.length > 0) {
    meshes.push(makeMesh(casingGeos, createCasingMaterial(), `ribbon-casing:${lineId}`, 0.15, 0.3));
  }
  return meshes;
}
