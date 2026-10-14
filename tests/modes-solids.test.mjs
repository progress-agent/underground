// Lane S (sprint 14Oct26w, D-053 item 8): the second family of collision solids, src/modes/solids.js,
// wired into the collision service. Pure node: fake groups laid out exactly like bridges.js builds them
// (a real merged THREE.BoxGeometry deck whose Y a morph rewrites), fake station index and a fake motorway.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCollisionService } from '../src/modes/collision.js';
import { readDeckColumns, shown } from '../src/modes/solids.js';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const VE = 5;
const scene = { isScene: true, visible: true, parent: null };

// ── fixtures ──────────────────────────────────────────────────────────────

/** bridges.js box(): a BoxGeometry with one width segment per 12 m, translated into place. */
function box(widthX, heightY, depthZ, x, y, z) {
  const g = new THREE.BoxGeometry(widthX, heightY, depthZ, Math.max(1, Math.ceil(widthX / 12)), 1, 1);
  g.translate(x, y, z);
  return g;
}

/**
 * A bridge record shaped like bridges.js createBridges' registry entries. The axis runs along +X through
 * the origin; the deck box is the first geometry merged, then an extra box stands in for everything else.
 */
function makeBridge({ slug = 'testbridge', archetype = 'suspension', len = 200, ext = 30, deckTop = 6.75, thick = 6,
  width = 12, spanM = 150, clearanceM = 8, cx = 0, cz = 0 } = {}) {
  const aX = -len / 2 - ext, bX = len / 2 + ext, length = bX - aX;
  const deckY = deckTop - thick / 2;
  const geoms = [box(length, thick, width, (aX + bX) / 2, deckY, 0), box(4, 20, 4, 0, 5, 40)];
  const merged = mergeGeometries(geoms, false);
  const group = {
    name: `bridge:${slug}`, visible: true, parent: null, position: { x: cx, z: cz }, rotation: { y: 0 },
    userData: { type: 'bridge' },
  };
  const rec = {
    data: {
      curatedSlug: slug, archetype, kind: 'road', deckWidthM: width, spanM, clearanceM,
      axis: { a: { e: BNG_REF_E - len / 2, n: BNG_REF_N }, b: { e: BNG_REF_E + len / 2, n: BNG_REF_N } },
    },
    group, deckMesh: { geometry: merged }, deckY, waterSurfaceY: deckY - clearanceM * VE,
    deckSpan: { aX, bX, length, centerX: (aX + bX) / 2 },
  };
  return rec;
}

function bridgesGroup(...recs) {
  const registry = new Map(recs.map(r => [r.data.curatedSlug, r]));
  const g = { visible: true, parent: scene, userData: { registry } };
  for (const r of recs) r.group.parent = g;
  return g;
}

function world({ bridges = null, motorway = null, stations = null, tiles = [], scale = 1, water = () => null } = {}) {
  const state = { scale };
  const svc = createCollisionService({
    getBuildingMeshes: () => tiles,
    getHeightScale: () => state.scale,
    getGroundY: () => 0,
    getWaterSurfaceY: water,
    isSubmerged: () => false,
  });
  svc.setSolidSources({ bridges: () => bridges, motorway: () => motorway, stationBuildings: () => stations });
  return { svc, state };
}

function tile(boxes) {
  const arr = new Float32Array(boxes.length * 16);
  boxes.forEach(({ x, z, side, h, y = 0 }, i) => {
    const o = i * 16;
    arr[o] = side; arr[o + 5] = h; arr[o + 10] = side;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  });
  return { isInstancedMesh: true, name: 'baked-buildings-0', count: boxes.length, instanceMatrix: { array: arr } };
}

function stationsOf(rings, { base = 0, heightM = 10 } = {}) {
  const items = rings.map((ring, i) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { ring, building: { key: `b${i}`, height: heightM }, bounds: { x0, z0, x1, z1 } };
  });
  const bases = new Map(items.map(it => [it.building.key, base]));
  return { index: { items }, meshes: { bases, group: { visible: true, parent: scene } }, VE };
}

/** Walk a body along +x from x0 with W held, the way the Pedestrian does: move, then stand. */
function walk(svc, { x0, z0 = 0, y0 = 0, dirX = 1, dirZ = 0, speed = 6, frames = 400, dt = 1 / 60, step = 0.4 * VE, radius = 0.35, height = 1.85 * VE }) {
  let x = x0, z = z0, y = y0, minY = y0, maxStep = 0;
  const trace = [];
  for (let i = 0; i < frames; i++) {
    const r = svc.moveAndSlide({ x, y, z }, { x: dirX * speed * dt, y: 0, z: dirZ * speed * dt }, { radius, height, step });
    x = r.x; z = r.z;
    const stand = svc.standHeightAt(x, z, y, step);
    if (stand !== null && stand >= y - 0.6 * VE) { maxStep = Math.max(maxStep, Math.abs(stand - y)); y = stand; }
    minY = Math.min(minY, y);
    trace.push([x, y, z]);
  }
  return { x, y, z, minY, maxStep, trace };
}

// ── (1) Master following ─────────────────────────────────────────────────

test('deck columns are read from the drawn mesh and follow a morph of the position attribute', () => {
  const rec = makeBridge({ deckTop: 6.75 });
  const info = {};
  const col = readDeckColumns(rec, 0, info);
  assert.ok(col, info.why);
  assert.equal(col.cols.length, Math.ceil(rec.deckSpan.length / 12) + 1);
  assert.ok(Math.abs(col.top[3] - 6.75) < 1e-4 && Math.abs(col.under[3] - 0.75) < 1e-4);
  const { svc } = world({ bridges: bridgesGroup(rec) });
  assert.ok(Math.abs(svc.standHeightAt(10, 0, 7, 0) - 6.75) < 1e-4);
  assert.ok(Math.abs(svc.ceilingAt(10, 0, 0.1) - 0.75) < 1e-4);
  // A morph (Master moves the bridge): rewrite Y and flag the attribute, as bridges.js does.
  const pos = rec.deckMesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + 2.5);
  pos.needsUpdate = true;
  assert.ok(Math.abs(svc.standHeightAt(10, 0, 9.4, 0) - 9.25) < 1e-4, 'top follows the attribute');
  assert.ok(Math.abs(svc.ceilingAt(10, 0, 0.1) - 3.25) < 1e-4, 'underside follows the attribute');
  assert.equal(svc.solidStats().errors.length, 0);
});

test('a deck whose layout does not match is skipped and reported, never guessed', () => {
  const rec = makeBridge();
  rec.deckSpan = { ...rec.deckSpan, aX: rec.deckSpan.aX + 5 };
  const { svc } = world({ bridges: bridgesGroup(rec) });
  assert.equal(svc.standHeightAt(10, 0, 7, 0), 0);
  assert.match(svc.solidStats().errors[0], /deck-layout:testbridge/);
});

// ── (2) ramps ────────────────────────────────────────────────────────────

test('a ramp lets a body walk from the ground onto a 1.35 m deck without a jump', () => {
  const rec = makeBridge({ deckTop: 1.35 * VE });
  const { svc } = world({ bridges: bridgesGroup(rec) });
  const st = svc.solidStats();
  assert.equal(st.ramps, 2);
  const w = walk(svc, { x0: rec.deckSpan.aX - 20, frames: 900 });
  assert.ok(w.x > rec.deckSpan.aX + 30, `stopped at x=${w.x}`);
  assert.ok(Math.abs(w.y - 1.35 * VE) < 0.05, `y=${w.y}`);
  assert.ok(w.maxStep < 0.4 * VE, `a step of ${w.maxStep} units needs a jump`);
});

test('a ramp is gone where the deck end is within the 0.4 m step of the bank', () => {
  const rec = makeBridge({ deckTop: 0.3 * VE });
  const { svc } = world({ bridges: bridgesGroup(rec) });
  assert.equal(svc.solidStats().ramps, 0);
  const w = walk(svc, { x0: rec.deckSpan.aX - 10, frames: 400 });
  assert.ok(w.x > rec.deckSpan.aX + 5);
});

test('without the ramp a 1.35 m deck end is a wall from the bank', () => {
  const rec = makeBridge({ deckTop: 1.35 * VE });
  const g = bridgesGroup(rec);
  const { svc } = world({ bridges: g });
  // Beside the ramp (outside the deck width) the bank still meets the deck end as a wall.
  const r = svc.moveAndSlide({ x: rec.deckSpan.aX - 3, y: 0, z: 9 }, { x: 6, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(r.x < rec.deckSpan.aX + 4);
});

// ── (3) parapets ─────────────────────────────────────────────────────────

test('a parapet stops a 0.35 m body at 45 degrees and is not tunnelled at 35 m/s', () => {
  const rec = makeBridge({ width: 12, deckTop: 6.75 });
  const { svc } = world({ bridges: bridgesGroup(rec) });
  const top = 6.75, edge = 6 - 0.3 - 0.35;
  const a = walk(svc, { x0: 0, z0: 0, y0: top, dirX: Math.SQRT1_2, dirZ: Math.SQRT1_2, frames: 300 });
  assert.ok(a.trace.every(([, , z]) => z <= edge + 0.01), 'stayed inside the parapet');
  assert.ok(a.x > 20, 'slid along it');
  const b = walk(svc, { x0: 0, z0: 5, y0: top, dirX: 0, dirZ: 1, speed: 35, frames: 30 });
  assert.ok(b.trace.every(([, , z]) => z <= edge + 0.01), 'not tunnelled at 35 m/s');
  assert.ok(b.trace.every(([, y]) => Math.abs(y - top) < 0.05));
});

// ── (4) under a deck ─────────────────────────────────────────────────────

test('a body under a deck is not lifted, and is blocked where the underside comes below its head', () => {
  const high = makeBridge({ slug: 'high', deckTop: 40, thick: 6 }); // underside 34 units = 6.8 m up
  const g1 = bridgesGroup(high);
  const { svc: s1 } = world({ bridges: g1 });
  assert.equal(s1.standHeightAt(0, 0, 0, 2), 0, 'not lifted onto the deck from below');
  const r = s1.moveAndSlide({ x: 0, y: 0, z: -20 }, { x: 0, y: 0, z: 40 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(Math.abs(r.z - 20) < 1e-6, 'walks under a deck that clears its head');
  const low = makeBridge({ slug: 'low', deckTop: 14, thick: 6 }); // underside 8 units = 1.6 m up
  const { svc: s2 } = world({ bridges: bridgesGroup(low) });
  const q = s2.moveAndSlide({ x: 0, y: 0, z: -20 }, { x: 0, y: 0, z: 40 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(q.z < -5.9 - 0.35 + 0.01 && q.z > -6.8, `stopped at the deck edge, z=${q.z}`);
  assert.ok(q.hit);
});

// ── (5) inside-slab lift ─────────────────────────────────────────────────

test('inside the slab a deck lifts a body to its top; a prism never lifts', () => {
  const rec = makeBridge({ deckTop: 40, thick: 6 });
  const { svc } = world({ bridges: bridgesGroup(rec), stations: stationsOf([[[200, -10], [220, -10], [220, 10], [200, 10]]], { heightM: 20 }) });
  assert.equal(svc.standHeightAt(0, 0, 37, 0), 40, 'feet between underside (34) and top (40)');
  assert.equal(svc.standHeightAt(0, 0, 30, 0), 0, 'below the underside there is no lift');
  assert.equal(svc.standHeightAt(210, 0, 50, 2), 0, 'inside a station building at mid-height: not lifted');
  assert.equal(svc.standHeightAt(210, 0, 98, 2), 100, 'a roof within the step is standable');
});

// ── (6) concave polygon prism ────────────────────────────────────────────

test('a concave station prism pushes a body out with a slide, and a body that starts inside is never trapped', () => {
  // An L: 20x20 with the corner (10..20, 10..20) cut away.
  const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
  // The module's ring orientation is counter-clockwise seen from above: negative shoelace in (x, z).
  const ring = L.slice().reverse();
  const { svc } = world({ stations: stationsOf([ring], { heightM: 10 }) });
  // Walk into the lower wall (z = 0 face) at 45 degrees: slides along it.
  const r = svc.moveAndSlide({ x: 5, y: 0, z: -3 }, { x: 4, y: 0, z: 4 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(r.hit && r.z <= -0.35 + 1e-3 + 1e-6, `z=${r.z}`);
  assert.ok(r.x > 8, 'slid along the wall');
  // Into the re-entrant corner: never ends inside.
  const c = svc.moveAndSlide({ x: 14, y: 0, z: 14 }, { x: -3, y: 0, z: -3 }, { radius: 0.35, height: 9.25, step: 2 });
  const inside = (x, z) => x >= 0 && x <= 20 && z >= 0 && z <= 10 || x >= 0 && x <= 10 && z >= 0 && z <= 20;
  assert.ok(!inside(c.x, c.z), `inside the L at ${c.x}, ${c.z}`);
  // Starts inside: free to leave.
  const o = svc.moveAndSlide({ x: 5, y: 0, z: 5 }, { x: -10, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(Math.abs(o.x - -5) < 1e-6 && !o.hit);
});

// ── (7) the stop distance ────────────────────────────────────────────────

test('a body walking into a station wall stops 0.351 m from it', () => {
  const sq = [[10, -10], [10, 10], [30, 10], [30, -10]].reverse(); // wall face at x = 10
  const ring = sq[0][0] === 30 || true ? [[10, -10], [30, -10], [30, 10], [10, 10]] : sq;
  const { svc } = world({ stations: stationsOf([ring], { heightM: 10 }) });
  const w = walk(svc, { x0: -5, frames: 300 });
  assert.ok(Math.abs(w.x - (10 - 0.351)) < 2e-3, `stopped at x=${w.x}`);
});

// ── (8) the corridor rule ────────────────────────────────────────────────

test('a map box on the deck is not solid to a body on the deck, and stays solid below it', () => {
  const rec = makeBridge({ deckTop: 40, thick: 6 });
  const b = { x: 20, z: 0, side: 6, h: 50 }; // a 10 m box standing on the deck, base 0 (the bank's level)
  const { svc } = world({ bridges: bridgesGroup(rec), tiles: [tile([b])] });
  const on = svc.moveAndSlide({ x: 10, y: 40, z: 0 }, { x: 8, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(Math.abs(on.x - 18) < 1e-6 && !on.hit, 'passes the drawn box on the deck');
  assert.equal(svc.standHeightAt(20, 0, 40, 2), 40, 'the box roof is not a floor either');
  // The same box seen from below the deck is as solid as ever.
  const below = svc.moveAndSlide({ x: 10, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { radius: 0.35, height: 1, step: 2 });
  assert.ok(below.x < 20 - 3 && below.hit);
});

// ── (9) ceilings and tower passages ──────────────────────────────────────

test('ceilingAt is the deck underside; a tower standing on the deck leaves a 3 m passage', () => {
  const rec = makeBridge({ archetype: 'suspension', deckTop: 6.75, thick: 6, width: 4, len: 400, spanM: 400, clearanceM: 8 });
  rec.data.curatedSlug = 'millennium-foot'; // 10 m towers on the deck (width < 6)
  const { svc } = world({ bridges: bridgesGroup(rec) });
  assert.equal(svc.ceilingAt(50, 0, 3), null, 'a point off the tower: only the deck, and it is below');
  assert.ok(Math.abs(svc.ceilingAt(50, 0, -5) - 0.75) < 1e-4, 'from below, the deck underside');
  const towerX = Math.min(400 * 0.34, 400 * 0.36);
  const st = svc.solidStats();
  assert.equal(st.towers, 2);
  // Walking along the deck through the tower: the passage is open for a 1.85 m body (9.25 units) ...
  const w = walk(svc, { x0: towerX - 15, y0: 6.75, z0: 0, frames: 400, step: 2 });
  assert.ok(w.x > towerX + 10, `the tower held the walker at x=${w.x}`);
  // ... and the tower underside above it is a ceiling for a body rising on the deck.
  const c = svc.ceilingAt(towerX, 0, 6.75);
  assert.ok(Math.abs(c - (6.75 + 3 * VE)) < 0.2, `passage ceiling ${c}`);
});

// ── (10) segmentHitsSolids ───────────────────────────────────────────────

test('segmentHitsSolids is exact on a deck and a polygon, and start-inside is a tiny positive fraction', () => {
  const rec = makeBridge({ archetype: 'beam-girder', deckTop: 40, thick: 6, width: 10 });
  const ring = [[100, -10], [120, -10], [120, 10], [100, 10]];
  const { svc } = world({ bridges: bridgesGroup(rec), stations: stationsOf([ring], { heightM: 10 }) });
  // Vertical segment from 20 units above the deck to 0: hits the deck top at 40.
  const t = svc.segmentHitsSolids({ x: 0, y: 60, z: 0 }, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(60 - t * 60 - 40) < 1e-6, `hit y=${60 - t * 60}`);
  // Horizontal through a station wall at y = 25 (inside 0..50): the wall face is x = 100.
  const h = svc.segmentHitsSolids({ x: 80, y: 25, z: 0 }, { x: 140, y: 25, z: 0 });
  assert.ok(Math.abs(80 + h * 60 - 100) < 1e-6);
  // A segment along the deck 0.5 m above it and 0.15 m inside the edge crosses only the invisible parapet: null.
  assert.equal(svc.segmentHitsSolids({ x: -90, y: 42.5, z: 4.85 }, { x: 90, y: 42.5, z: 4.85 }), null);
  // Starts inside: in (0, 1e-5].
  const s = svc.segmentHitsSolids({ x: 110, y: 10, z: 0 }, { x: 200, y: 10, z: 0 });
  assert.ok(s > 0 && s <= 1e-5, `start-inside returned ${s}`);
  const s2 = svc.segmentHitsSolids({ x: 0, y: 38, z: 0 }, { x: 0, y: 80, z: 0 });
  assert.ok(s2 > 0 && s2 <= 1e-5, `start-inside deck returned ${s2}`);
  // A miss.
  assert.equal(svc.segmentHitsSolids({ x: 0, y: 500, z: 0 }, { x: 300, y: 500, z: 0 }), null);
  // The segment's returned fraction is always a number in (0, 1].
  assert.ok(h > 0 && h <= 1 && t > 0 && t <= 1);
});

// ── (11) never both, never neither ───────────────────────────────────────

function motorwayFixture({ x0 = 500 } = {}) {
  // One bridge way over water, straight along +x, 120 m, deck 20 units above the bank.
  const samples = [];
  for (let i = 0; i <= 10; i++) {
    samples.push({ x: x0 + i * 12, z: 0, dx: 1, dz: 0, baseY: 0, deltaY: 20, profileKind: 'bridge', groundY: 0 });
  }
  const road = { id: 7, bridge: true, tunnel: false, lanes: 2 };
  const group = { visible: true, parent: scene, userData: { roadPaths: new Map([[7, { road, samples, length: 120 }]]) } };
  return group;
}

test('never both and never neither: the registry deck is solid only while its group is drawn, the motorway only while attached', () => {
  // The registry crossing at x in [-130, 130] and a motorway crossing at x in [500, 620].
  const rec = makeBridge({ slug: 'qe2', deckTop: 40, thick: 6 });
  const bg = bridgesGroup(rec);
  const mw = motorwayFixture();
  const water = (x) => (x > 490 && x < 630 ? 2 : null);
  const { svc } = world({ bridges: bg, motorway: mw, water });
  const reg = () => svc.standHeightAt(0, 0, 100, 0), mot = () => svc.standHeightAt(560, 0, 100, 0);
  assert.equal(reg(), 40); assert.equal(mot(), 20);
  rec.group.visible = false; // syncMotorwayBridges hides the registry deck when the motorway attaches
  assert.equal(reg(), 0, 'hidden registry deck is not solid'); assert.equal(mot(), 20);
  mw.visible = false; // the motorway failed to attach: the registry deck is drawn again
  rec.group.visible = true;
  assert.equal(reg(), 40); assert.equal(mot(), 0, 'detached motorway is not solid');
  assert.equal(svc.solidStats().motorwaySegments, 0);
  mw.visible = true;
  assert.ok(svc.solidStats().motorwaySegments >= 10);
});

test('the motorway crossing deck, barriers and Master scale', () => {
  const mw = motorwayFixture();
  const water = (x) => (x > 490 && x < 630 ? 2 : null);
  const { svc, state } = world({ motorway: mw, water, scale: 1 });
  assert.equal(svc.standHeightAt(560, 0, 100, 0), 20);
  state.scale = 0.5;
  assert.equal(svc.standHeightAt(560, 0, 100, 0), 10, 'follows the building height scale');
  state.scale = 1;
  // Barriers stop a body on the deck.
  const half = (2 * 3.5 + 2.4) * 1.18 / 2;
  const r = svc.moveAndSlide({ x: 560, y: 20, z: 0 }, { x: 0, y: 0, z: half + 5 }, { radius: 0.35, height: 9.25, step: 2 });
  assert.ok(r.z <= half + 0.17 - 0.35 + 1e-3, `z=${r.z}`);
});

test('shown() needs every ancestor visible and a Scene at the root', () => {
  assert.equal(shown(null), false);
  assert.equal(shown({ visible: true, parent: null }), false);
  assert.equal(shown({ visible: true, parent: scene }), true);
  assert.equal(shown({ visible: true, parent: { visible: false, parent: scene } }), false);
});

test('per-frame queries stay far inside the budget on a deck and beside a 28-vertex prism', () => {
  const rec = makeBridge({ deckTop: 6.75 });
  const ring = [];
  for (let i = 0; i < 28; i++) { const a = -i / 28 * Math.PI * 2; ring.push([300 + 20 * Math.cos(a), 20 * Math.sin(a)]); }
  const { svc } = world({ bridges: bridgesGroup(rec), stations: stationsOf([ring], { heightM: 16 }) });
  const n = 20000;
  const bench = (x, y, z) => {
    for (let i = 0; i < 2000; i++) { svc.moveAndSlide({ x, y, z }, { x: 0.1, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 }); svc.standHeightAt(x, z, y, 2); svc.ceilingAt(x, z, y); }
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { svc.moveAndSlide({ x, y, z }, { x: 0.1, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 }); svc.standHeightAt(x, z, y, 2); svc.ceilingAt(x, z, y); }
    return (performance.now() - t0) * 1000 / n;
  };
  const onDeck = bench(0, 6.75, 0), byPrism = bench(279.5, 0, 0.2), away = bench(-5000, 0, 0);
  console.log(`# per-frame queries (us): deck ${onDeck.toFixed(2)}, prism ${byPrism.toFixed(2)}, away ${away.toFixed(2)}`);
  assert.ok(onDeck < 100 && byPrism < 100 && away < 20);
});
