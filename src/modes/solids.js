// solids.js: the second family of collision solids (sprint 14Oct26w, lane S, D-053 item 8).
//
// collision.js reads only the instanced map boxes. This module adds what the boxes cannot say:
//   RIBBONS  oriented rectangles in plan whose top and underside vary linearly along their length:
//            the 41 Thames bridge decks (read from the DRAWN deck mesh, so they follow Master exactly),
//            their approach ramps, parapets, piers and towers, and the M25's two Thames crossings.
//   PRISMS   the station buildings: a footprint polygon with a flat roof.
// Pure: no THREE, no DOM. Everything is canonical scene space (X/Z real metres, Y = real metres x VE).
// Sources are read through getters set on the collision service (see collision.js, setSolidSources), so no
// mode file, no installModes signature and no drawn object changes. Nothing here draws anything.
//
// WHAT BLOCKS. A ribbon blocks a body whose vertical span [F, H] overlaps (underside, top - step]:
// a body standing on the deck is not blocked by it, a body beside or below it is. Parts that are above step
// height at their edge block like a wall (parapets, piers, towers, a deck seen from the river).
// WHAT LIFTS. Only decks and the motorway deck lift a body that is inside the slab
// (underside <= feet <= top); prisms and towers never lift. A deck's underside is also a CEILING
// (ceilingAt) so a rising Drone, Balloon or jetpack walker stops under it.

import { bridgePierAnchors } from '../bridges.js';
import { nearestOnRing, pointInRing } from '../station-building-geometry.js';
import { motorwayRoadWidth } from '../m25-motorway.js';
import { BNG_REF_E, BNG_REF_N } from '../coordinates.js';

export const NEG = -1e9;
const EPS = 1e-3;
const CELL = 32;
const DECK_COLUMN_M = 12;            // bridges.js box(): one width segment per 12 m
export const PARAPET_M = 1.10;       // real metres above the deck top
export const PARAPET_STRIP_M = 0.30;
export const PASSAGE_M = 3.0;        // open height above a deck under a tower that stands on it
export const RAMP_RUN_PER_RISE = 6;  // 1 in 6
export const RAMP_MIN_RISE_M = 0.40;
const RAMP_MIN_LEN_M = 2, RAMP_MAX_LEN_M = 12;
const MOTORWAY_DECK_M = 1.2;         // thickness of the motorway deck slab for collision
const MOTORWAY_BARRIER_M = 0.85;     // m25-motorway.js: barrier strip height
const MOTORWAY_TRANSITION_M = 150;   // raised approaches counted from a crossing way's end samples
const GOLDEN_JUBILEE = 'golden-jubilee-foot';

// ── small helpers ─────────────────────────────────────────────────────────

/** True when the object and every ancestor are visible and the chain ends at a Scene. */
export function shown(o) {
  if (!o) return false;
  for (let n = o; n; n = n.parent) {
    if (n.visible === false) return false;
    if (!n.parent) return n.isScene === true;
  }
  return false;
}

const idMap = new WeakMap();
let idNext = 1;
function idOf(o) {
  if (!o) return 0;
  let i = idMap.get(o);
  if (i === undefined) { i = idNext++; idMap.set(o, i); }
  return i;
}

function profAt(r, arr, u) {
  const c = r.cols, m = c.length;
  if (u <= c[0]) return arr[0];
  if (u >= c[m - 1]) return arr[m - 1];
  let j = 0;
  while (j < m - 2 && u > c[j + 1]) j++;
  return arr[j] + (arr[j + 1] - arr[j]) * ((u - c[j]) / (c[j + 1] - c[j]));
}

function bngToScene({ e, n }) { return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) }; }

/** A ribbon: columns cols[] along axis (ux, uz) from origin (ox, oz), lateral extent [v0, v1]. */
function ribbon(kind, ox, oz, ux, uz, cols, top, under, v0, v1, flags = {}) {
  const nx = -uz, nz = ux;
  const uF = cols[0], uL = cols[cols.length - 1];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const u of [uF, uL]) for (const v of [v0, v1]) {
    const x = ox + u * ux + v * nx, z = oz + u * uz + v * nz;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  let maxTop = -Infinity, minUnder = Infinity;
  for (let i = 0; i < top.length; i++) { if (top[i] > maxTop) maxTop = top[i]; if (under[i] < minUnder) minUnder = under[i]; }
  return {
    kind, ox, oz, ux, uz, nx, nz, cols, top, under, v0, v1, uF, uL, minX, maxX, minZ, maxZ, maxTop, minUnder,
    move: true, drawn: false, stand: false, lift: false, ceil: false, corridor: false, oriented: true, slug: null,
    ...flags,
  };
}

function flat(kind, ox, oz, ux, uz, u0, u1, v0, v1, topY, underY, flags) {
  return ribbon(kind, ox, oz, ux, uz, [u0, u1], [topY, topY], [underY, underY], v0, v1, flags);
}

function prismOf(item, base, h, skirt) {
  const b = item.bounds;
  return { ring: item.ring, minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1, base, h, skirt, key: item.building?.key ?? null, oriented: false };
}

// ── the grid ──────────────────────────────────────────────────────────────

function cellHitsRibbon(r, cx, cz) {
  // SAT of an axis-aligned square cell against the ribbon's full oriented rectangle.
  const h = CELL / 2, mx = cx + h, mz = cz + h;
  const cu = (mx - r.ox) * r.ux + (mz - r.oz) * r.uz, cv = (mx - r.ox) * r.nx + (mz - r.oz) * r.nz;
  const eu = h * (Math.abs(r.ux) + Math.abs(r.uz)), ev = h * (Math.abs(r.nx) + Math.abs(r.nz));
  return cu + eu >= r.uF && cu - eu <= r.uL && cv + ev >= r.v0 && cv - ev <= r.v1;
}

function buildGrid(items) {
  if (!items.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const it of items) {
    if (it.minX < minX) minX = it.minX; if (it.maxX > maxX) maxX = it.maxX;
    if (it.minZ < minZ) minZ = it.minZ; if (it.maxZ > maxZ) maxZ = it.maxZ;
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1), rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const counts = new Uint32Array(cols * rows + 1);
  const each = (it, fn) => {
    const c0 = Math.max(0, Math.floor((it.minX - minX) / CELL)), c1 = Math.min(cols - 1, Math.floor((it.maxX - minX) / CELL));
    const r0 = Math.max(0, Math.floor((it.minZ - minZ) / CELL)), r1 = Math.min(rows - 1, Math.floor((it.maxZ - minZ) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (it.oriented && !cellHitsRibbon(it, minX + c * CELL, minZ + r * CELL)) continue;
      fn(r * cols + c);
    }
  };
  items.forEach((it) => each(it, (cell) => { counts[cell + 1]++; }));
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const list = new Uint32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, cols * rows);
  items.forEach((it, i) => each(it, (cell) => { list[fill[cell]++] = i; }));
  return { minX, minZ, cols, rows, start: counts, list, stamp: new Uint32Array(items.length) };
}

let stampCounter = 1;
/** fn(item) for every item whose cell overlaps [x0,x1]x[z0,z1]; returning true stops. */
function visit(layer, x0, x1, z0, z1, fn) {
  const g = layer.grid;
  if (!g) return;
  const lx0 = g.minX, lz0 = g.minZ;
  if (x1 < lx0 || z1 < lz0) return;
  const c0 = Math.max(0, Math.floor((x0 - lx0) / CELL)), c1 = Math.min(g.cols - 1, Math.floor((x1 - lx0) / CELL));
  const r0 = Math.max(0, Math.floor((z0 - lz0) / CELL)), r1 = Math.min(g.rows - 1, Math.floor((z1 - lz0) / CELL));
  if (c0 > c1 || r0 > r1) return;
  const stamp = stampCounter++;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const cell = r * g.cols + c;
    for (let k = g.start[cell], end = g.start[cell + 1]; k < end; k++) {
      const i = g.list[k];
      if (g.stamp[i] === stamp) continue;
      g.stamp[i] = stamp;
      const it = layer.items[i];
      if (it.maxX < x0 || it.minX > x1 || it.maxZ < z0 || it.minZ > z1) continue;
      if (fn(it)) return;
    }
  }
}

// ── building the bridge layer ─────────────────────────────────────────────

/**
 * Read the first deck box merged into rec.deckMesh (bridges.js addDeck/box): width segments n,
 * three r161 BoxGeometry vertex order. Returns { cols, top, under, v0, v1 } or null with `why`.
 */
export function readDeckColumns(rec, deckIndex, out) {
  const geo = rec.deckMesh?.geometry;
  const pos = geo?.attributes?.position;
  if (!pos) { out.why = 'no-position'; return null; }
  const len = rec.deckSpan.length;
  const n = Math.max(1, Math.ceil(len / DECK_COLUMN_M));
  const base = deckIndex * (8 + 8 * (n + 1));
  if (base + 8 + 4 * (n + 1) > pos.count) { out.why = 'short-geometry'; return null; }
  const a = pos.array, stride = pos.itemSize || 3;
  const X = (i) => a[i * stride], Y = (i) => a[i * stride + 1], Z = (i) => a[i * stride + 2];
  const cols = new Float64Array(n + 1), top = new Float64Array(n + 1), under = new Float64Array(n + 1);
  const row0 = base + 8, row1 = base + 8 + (n + 1), low0 = base + 8 + 2 * (n + 1), low1 = base + 8 + 3 * (n + 1);
  for (let k = 0; k <= n; k++) {
    const x = X(row0 + k);
    cols[k] = x;
    // Layout checks: the column x on all four rows, the two top rows level, increasing columns.
    if (Math.abs(x - (rec.deckSpan.aX + k * len / n)) > 1e-3 || Math.abs(X(row1 + k) - x) > 1e-3
      || Math.abs(X(low0 + k) - x) > 1e-3 || Math.abs(X(low1 + k) - x) > 1e-3) { out.why = 'column-x'; return null; }
    if (Math.abs(Y(row0 + k) - Y(row1 + k)) > 1e-3) { out.why = 'top-rows'; return null; }
    top[k] = Y(row0 + k);
    under[k] = Math.min(Y(low0 + k), Y(low1 + k));
    if (!(under[k] < top[k])) { out.why = 'underside'; return null; }
    if (k > 0 && !(cols[k] > cols[k - 1])) { out.why = 'order'; return null; }
  }
  out.v0 = Math.min(Z(row0), Z(row1)); out.v1 = Math.max(Z(row0), Z(row1));
  return { cols, top, under, v0: out.v0, v1: out.v1 };
}

function orientedOverlap(a, b) {
  // SAT of two oriented rectangles (full extents), given as { ox, oz, ux, uz, nx, nz, uF, uL, v0, v1 }.
  const corners = (r) => {
    const out = [];
    for (const u of [r.uF, r.uL]) for (const v of [r.v0, r.v1]) out.push([r.ox + u * r.ux + v * r.nx, r.oz + u * r.uz + v * r.nz]);
    return out;
  };
  const ca = corners(a), cb = corners(b);
  for (const r of [a, b]) for (const ax of [[r.ux, r.uz], [r.nx, r.nz]]) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
    if (aMax < bMin || bMax < aMin) return false;
  }
  return true;
}

// Tower layouts, mirrored from bridges.js (suspension :329-352, cable-stayed :381-396, bascule :423-435).
function towerPlan(rec, frameLength) {
  const b = rec.data;
  const out = [];
  const span = b.spanM, slug = b.curatedSlug;
  if (b.archetype === 'suspension') {
    const width = Math.max(b.deckWidthM, 4);
    const hM = { hammersmith: 22, albert: 24, chelsea: 25, 'millennium-foot': 10, 'teddington-foot': 12 }[slug] ?? 18;
    const tx = Math.min(frameLength * 0.34, span * 0.36);
    const zs = width < 6 ? [0] : [-width / 2 - 0.8, width / 2 + 0.8];
    for (const x of [-tx, tx]) for (const z of zs) out.push({ x, z, hu: 1.4, hv: 1.4, heightM: hM });
  } else if (b.archetype === 'cable-stayed') {
    const qe2 = slug === 'qe2';
    const px = qe2 ? Math.min(frameLength * 0.24, span * 0.25) : Math.min(frameLength * 0.22, span * 0.22);
    for (const x of [-px, px]) out.push({ x, z: 0, hu: qe2 ? 4 : 1.6, hv: qe2 ? 3.5 : 1.6, heightM: qe2 ? 86 : 26 });
  } else if (b.archetype === 'bascule') {
    const width = Math.max(b.deckWidthM, 18);
    const tx = Math.min(frameLength * 0.28, span * 0.3);
    for (const x of [-tx, tx]) out.push({ x, z: 0, hu: 8.5, hv: (width + 8) / 2, heightM: 44 });
  }
  return out;
}

function frameLengthOf(rec) {
  const a = bngToScene(rec.data.axis.a), b = bngToScene(rec.data.axis.b);
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function buildBridgeLayer(ctx) {
  const { group, getGroundY, VE, errors } = ctx;
  const reg = group?.userData?.registry;
  const ribbons = [];
  const counts = { bridges: 0, decks: 0, ramps: 0, parapets: 0, piers: 0, towers: 0 };
  if (!reg) return { ribbons, counts };
  const towers = [];
  const decks = [];
  for (const [slug, rec] of reg) {
    if (!rec.group || rec.group.visible === false) continue;
    const theta = rec.group.rotation.y, gx = rec.group.position.x, gz = rec.group.position.z;
    const ux = Math.cos(theta), uz = -Math.sin(theta);
    const nDecks = slug === GOLDEN_JUBILEE ? 2 : 1;
    let any = false;
    const own = [];
    for (let d = 0; d < nDecks; d++) {
      const info = {};
      const col = readDeckColumns(rec, d, info);
      if (!col) { errors.push(`deck-layout:${slug}:${d}:${info.why}`); continue; }
      const deck = ribbon('deck', gx, gz, ux, uz, col.cols, col.top, col.under, col.v0, col.v1,
        { drawn: true, stand: true, lift: true, ceil: true, corridor: true, slug });
      ribbons.push(deck); decks.push(deck); own.push(deck); counts.decks++; any = true;
      // Approach ramps: a 1-in-6 collision ramp from each deck end down to the bank.
      const vm = (col.v0 + col.v1) / 2;
      for (const side of [-1, 1]) {
        const iEnd = side < 0 ? 0 : col.cols.length - 1;
        const uEnd = col.cols[iEnd], topEnd = col.top[iEnd];
        const ex = gx + uEnd * ux + vm * -uz, ez = gz + uEnd * uz + vm * ux;
        const g0 = getGroundY(ex, ez);
        if (!Number.isFinite(g0)) continue;
        const riseM = (topEnd - g0) / VE;
        if (!(riseM > RAMP_MIN_RISE_M)) continue;
        const Lr = Math.min(RAMP_MAX_LEN_M, Math.max(RAMP_MIN_LEN_M, RAMP_RUN_PER_RISE * riseM));
        const uOut = uEnd + side * Lr;
        const g1 = getGroundY(gx + uOut * ux + vm * -uz, gz + uOut * uz + vm * ux);
        const outer = Number.isFinite(g1) ? Math.min(g1, topEnd) : g0;
        const cols = side < 0 ? [uOut, uEnd] : [uEnd, uOut];
        const tops = side < 0 ? [outer, topEnd] : [topEnd, outer];
        ribbons.push(ribbon('ramp', gx, gz, ux, uz, cols, tops, [NEG, NEG], col.v0, col.v1,
          { stand: true, corridor: true, slug }));
        counts.ramps++;
      }
      // Parapets: 0.30 m strips on the inside of both deck edges, deck end to deck end.
      const up = col.top.map(t => t + PARAPET_M * VE);
      for (const [a0, a1] of [[col.v0, col.v0 + PARAPET_STRIP_M], [col.v1 - PARAPET_STRIP_M, col.v1]]) {
        ribbons.push(ribbon('parapet', gx, gz, ux, uz, col.cols, up, col.under, a0, a1, { stand: true, slug }));
        counts.parapets++;
      }
    }
    if (!any) continue;
    counts.bridges++;
    // Piers (arch, beam, cantilever): the same anchors the sea life uses.
    const deck0 = own[0];
    for (const p of bridgePierAnchors(rec.data)) {
      const under = profAt(deck0, deck0.under, p.localX);
      ribbons.push(flat('pier', p.x, p.z, p.ux, p.uz, -p.halfU, p.halfU, -p.halfN, p.halfN, under, NEG,
        { drawn: true, slug }));
      counts.piers++;
    }
    // Cantilever bearers (Wandsworth): the 28 m blocks drawn under the deck at each interior pier hang below its
    // underside. Their bottom is read from the drawn mesh (the vertices at the block's two ends), not derived.
    if (rec.data.archetype === 'cantilever') {
      const pos = rec.deckMesh?.geometry?.attributes?.position;
      const isRail = rec.data.kind.includes('rail');
      const width = Math.max(rec.data.deckWidthM, isRail ? 11 : 9);
      const half = Math.min(28, frameLengthOf(rec) * 0.16) / 2, hv = (width + 1.5) / 2;
      if (pos) for (const p of bridgePierAnchors(rec.data)) {
        let bottom = Infinity;
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(Math.abs(pos.getX(i) - p.localX) - half) < 0.05 && Math.abs(pos.getZ(i)) <= hv + 0.05 && pos.getY(i) < bottom) bottom = pos.getY(i);
        }
        const under = profAt(deck0, deck0.under, p.localX);
        if (Number.isFinite(bottom) && bottom < under - 0.05) {
          ribbons.push(flat('bearer', p.x, p.z, p.ux, p.uz, -half, half, -hv, hv, under, bottom, { drawn: true, ceil: true, slug }));
          counts.piers++;
        }
      }
    }
    // Towers and pylons: collected, then given a passage if they stand on a deck.
    const frameLength = frameLengthOf(rec);
    for (const t of towerPlan(rec, frameLength)) towers.push({ rec, slug, gx, gz, ux, uz, ...t });
  }
  // Towers.
  for (const t of towers) {
    const cx = t.gx + t.x * t.ux + t.z * -t.uz, cz = t.gz + t.x * t.uz + t.z * t.ux;
    const rec = t.rec;
    // bridges.js: oldDeck - water = clearanceM x VE, and every morph rewrites rec.deckY.
    const den = rec.data.clearanceM * VE;
    const ratio = Number.isFinite(den) && den > 0 ? (rec.deckY - rec.waterSurfaceY) / den : 1;
    const topY = rec.deckY + t.heightM * VE * ratio;
    const probe = { ox: cx, oz: cz, ux: t.ux, uz: t.uz, nx: -t.uz, nz: t.ux, uF: -t.hu, uL: t.hu, v0: -t.hv, v1: t.hv };
    let overlapTop = -Infinity;
    for (const d of decks) {
      if (!orientedOverlap(probe, d)) continue;
      const u = (cx - d.ox) * d.ux + (cz - d.oz) * d.uz;
      const top = profAt(d, d.top, u);
      if (top > overlapTop) overlapTop = top;
    }
    counts.towers++;
    if (overlapTop === -Infinity) {
      ribbons.push(flat('tower', cx, cz, t.ux, t.uz, -t.hu, t.hu, -t.hv, t.hv, topY, NEG,
        { drawn: true, stand: true, slug: t.slug }));
    } else {
      // The tower is drawn solid; for movement a 3 m passage stays open above the deck it stands on.
      ribbons.push(flat('tower-low', cx, cz, t.ux, t.uz, -t.hu, t.hu, -t.hv, t.hv, overlapTop, NEG, { slug: t.slug }));
      const passage = overlapTop + PASSAGE_M * VE;
      if (topY > passage) {
        ribbons.push(flat('tower-high', cx, cz, t.ux, t.uz, -t.hu, t.hu, -t.hv, t.hv, topY, passage,
          { stand: true, ceil: true, slug: t.slug }));
      }
      ribbons.push(flat('tower-drawn', cx, cz, t.ux, t.uz, -t.hu, t.hu, -t.hv, t.hv, topY, NEG, { move: false, drawn: true, slug: t.slug }));
    }
  }
  return { ribbons, counts };
}

// ── the motorway layer (the M25's Thames crossings, while the motorway is drawn) ───────────────

function buildMotorwayLayer(ctx) {
  const { group, getWaterSurfaceY, VE, scale } = ctx;
  const roadPaths = group?.userData?.roadPaths;
  const ribbons = [];
  let segments = 0;
  if (!roadPaths) return { ribbons, segments };
  const crossing = [], ends = [];
  for (const rp of roadPaths.values()) {
    if (!rp.road.bridge || rp.road.tunnel) continue;
    const over = rp.samples.some(s => Number.isFinite(getWaterSurfaceY(s.x, s.z)));
    if (!over) continue;
    crossing.push(rp);
    ends.push(rp.samples[0], rp.samples[rp.samples.length - 1]);
  }
  const nearEnd = (s) => ends.some(e => Math.hypot(e.x - s.x, e.z - s.z) <= MOTORWAY_TRANSITION_M);
  const raised = (s) => s.profileKind === 'bridge' || s.profileKind === 'qe2';
  const slabM = MOTORWAY_DECK_M * VE * scale;
  const addSegment = (rp, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.5 || !Number.isFinite(a.baseY + a.deltaY + b.baseY + b.deltaY)) return;
    const ux = dx / len, uz = dz / len;
    const half = motorwayRoadWidth(rp.road) / 2;
    const ta = a.baseY + a.deltaY * scale, tb = b.baseY + b.deltaY * scale;
    ribbons.push(ribbon('motorway', a.x, a.z, ux, uz, [0, len], [ta, tb], [ta - slabM, tb - slabM], -half, half,
      { drawn: true, stand: true, lift: true, ceil: true, corridor: true }));
    const bar = MOTORWAY_BARRIER_M * VE * scale;
    for (const [v0, v1] of [[half + 0.17, half + 0.43], [-half - 0.43, -half - 0.17]]) {
      ribbons.push(ribbon('barrier', a.x, a.z, ux, uz, [0, len], [ta + bar, tb + bar], [ta - slabM, tb - slabM], v0, v1,
        { drawn: true, stand: true }));
    }
    segments++;
  };
  for (const rp of crossing) for (let i = 1; i < rp.samples.length; i++) addSegment(rp, rp.samples[i - 1], rp.samples[i]);
  for (const rp of roadPaths.values()) {
    if (rp.road.tunnel || crossing.includes(rp)) continue;
    for (let i = 1; i < rp.samples.length; i++) {
      const a = rp.samples[i - 1], b = rp.samples[i];
      if (raised(a) && raised(b) && (nearEnd(a) || nearEnd(b))) addSegment(rp, a, b);
    }
  }
  // QE2's four pylons (m25-motorway.js :133-134), standing on the southern carriageway.
  const qe = roadPaths.get(20003982);
  if (qe) {
    const p = qe.samples;
    for (const fraction of [0.5 - 225 / qe.length, 0.5 + 225 / qe.length]) {
      const s = p[Math.floor((p.length - 1) * fraction)];
      if (!s || !Number.isFinite(s.baseY + s.deltaY)) continue;
      const topY = s.baseY + (s.deltaY + 86 * VE) * scale;
      for (const side of [-1, 1]) {
        const off = motorwayRoadWidth(qe.road) / 2 + 1.4;
        ribbons.push(flat('pylon', s.x - s.dz * side * off, s.z + s.dx * side * off, 1, 0, -2.2, 2.2, -2.2, 2.2, topY, NEG,
          { drawn: true, stand: true }));
      }
    }
  }
  return { ribbons, segments };
}

// ── blocked intervals, resolution, queries ────────────────────────────────

/** u-range where f > 0 for the linear f through (u0, f0) and (u1, f1), as [lo, hi] or null. */
function positiveRange(u0, u1, f0, f1, out) {
  if (f0 > 0 && f1 > 0) { out[0] = u0; out[1] = u1; return true; }
  if (f0 <= 0 && f1 <= 0) return false;
  const ur = u0 + (u1 - u0) * (f0 / (f0 - f1));
  if (f0 > 0) { out[0] = u0; out[1] = ur; } else { out[0] = ur; out[1] = u1; }
  return out[1] > out[0];
}

const tmpA = [0, 0], tmpB = [0, 0];
/** Push the blocked u-intervals of ribbon r for a body span [F, H] and step into `out` as [lo, hi, lo, hi...]. */
function blockedIntervals(r, F, H, step, out) {
  const c = r.cols, top = r.top, under = r.under;
  for (let j = 0; j < c.length - 1; j++) {
    if (!positiveRange(c[j], c[j + 1], H - under[j], H - under[j + 1], tmpA)) continue;
    if (!positiveRange(c[j], c[j + 1], top[j] - step - F, top[j + 1] - step - F, tmpB)) continue;
    const lo = Math.max(tmpA[0], tmpB[0]), hi = Math.min(tmpA[1], tmpB[1]);
    if (!(hi > lo)) continue;
    const n = out.length;
    if (n && lo <= out[n - 1] + 1e-9) { if (hi > out[n - 1]) out[n - 1] = hi; } else out.push(lo, hi);
  }
}

const iv = [];
const stat = { u: 0, v: 0 };
function localOf(r, x, z) {
  const dx = x - r.ox, dz = z - r.oz;
  stat.u = dx * r.ux + dz * r.uz; stat.v = dx * r.nx + dz * r.nz;
  return stat;
}

function emptyLayer() { return { items: [], grid: null, counts: null }; }
function layerOf(items) { return { items, grid: buildGrid(items) }; }

export function createSolidWorld({ getGroundY = () => null, getWaterSurfaceY = () => null, getHeightScale = () => 1, VE = 5 } = {}) {
  let sources = { bridges: () => null, motorway: () => null, stationBuildings: () => null };
  let bridgeLayer = emptyLayer(), motorLayer = emptyLayer(), stationLayer = emptyLayer();
  let bridgeCounts = { bridges: 0, decks: 0, ramps: 0, parapets: 0, piers: 0, towers: 0 };
  let motorSegments = 0;
  let errors = [];
  let version = 0, buildMs = 0;
  let scale = 1;
  const gather = { rects: [], prisms: [] };

  // The source check runs on every query, so it allocates nothing and does the least that is exact: the three
  // source objects by identity, their shown flags, the motorway's height scale, and for each bridge deck its
  // group's visibility and its position attribute's version (a Master morph bumps it).
  let last = { bg: null, mw: null, index: null, meshes: null, b: false, m: false, s: false, mScale: 0, reg: null }, built = false;
  let watch = [], canary = null;
  function compareSources() {
    const bg = sources.bridges?.() ?? null, mw = sources.motorway?.() ?? null, sb = sources.stationBuildings?.() ?? null;
    const bShown = shown(bg), mShown = shown(mw), sShown = !!sb && shown(sb.meshes?.group);
    const s = { bg, mw, sb, bShown, mShown, sShown, same: false };
    const mScale = mShown ? getHeightScale() : 0;
    if (!built || bg !== last.bg || mw !== last.mw || (sb?.index ?? null) !== last.index || (sb?.meshes ?? null) !== last.meshes
      || bShown !== last.b || mShown !== last.m || sShown !== last.s || mScale !== last.mScale) return s;
    if (bShown) {
      const reg = bg.userData?.registry ?? null;
      if (reg !== last.reg || (reg?.size ?? 0) !== watch.length) return s;
      // One morph rewrites every deck in a single synchronous call, so the last deck's position-attribute
      // version stands for all of them; each group's visibility is read on its own.
      if (canary && (canary.attr.version !== canary.ver || canary.rec.deckMesh !== canary.mesh)) return s;
      for (let i = 0; i < watch.length; i++) if (watch[i].group.visible !== watch[i].vis) return s;
    }
    s.same = true;
    return s;
  }
  function remember(s) {
    last = { bg: s.bg, mw: s.mw, index: s.sb?.index ?? null, meshes: s.sb?.meshes ?? null, b: s.bShown, m: s.mShown, s: s.sShown,
      mScale: s.mShown ? getHeightScale() : 0, reg: s.bShown ? (s.bg.userData?.registry ?? null) : null };
    watch = []; canary = null;
    if (s.bShown && last.reg) {
      for (const rec of last.reg.values()) {
        watch.push({ group: rec.group, vis: rec.group?.visible });
        const attr = rec.deckMesh?.geometry?.attributes?.position;
        canary = { rec, attr: attr ?? { version: -1 }, ver: attr ? attr.version : -1, mesh: rec.deckMesh };
      }
    }
    built = true;
  }

  function rebuild(s) {
    const t0 = (globalThis.performance ?? Date).now();
    errors = [];
    scale = getHeightScale();
    if (s.bShown) {
      const r = buildBridgeLayer({ group: s.bg, getGroundY, VE, errors });
      bridgeLayer = layerOf(r.ribbons); bridgeCounts = r.counts;
    } else { bridgeLayer = emptyLayer(); bridgeCounts = { bridges: 0, decks: 0, ramps: 0, parapets: 0, piers: 0, towers: 0 }; }
    if (s.mShown) {
      const r = buildMotorwayLayer({ group: s.mw, getWaterSurfaceY, VE, scale });
      motorLayer = layerOf(r.ribbons); motorSegments = r.segments;
    } else { motorLayer = emptyLayer(); motorSegments = 0; }
    if (s.sShown) {
      const items = [];
      const bases = s.sb.meshes.bases, sbVE = s.sb.VE ?? VE;
      for (const it of s.sb.index.items) {
        const base = bases?.get(it.building.key);
        if (!Number.isFinite(base)) continue;
        items.push(prismOf(it, base, it.building.height * sbVE, 0.5 * sbVE));
      }
      stationLayer = layerOf(items);
    } else stationLayer = emptyLayer();
    version++;
    buildMs = (globalThis.performance ?? Date).now() - t0;
  }

  /** Re-read the sources; rebuild only if they moved. Returns true if rebuilt. */
  function update() {
    scale = getHeightScale();
    const s = compareSources();
    if (s.same) return false;
    remember(s);
    rebuild(s);
    return true;
  }

  const layers = () => [bridgeLayer, motorLayer, stationLayer];

  /** Ribbons with the corridor flag that cover (x, z) with the body's feet at or above underside - step. */
  function corridorsAt(x, z, feetY, step, out) {
    out.length = 0;
    for (const layer of [bridgeLayer, motorLayer]) {
      if (!layer.grid) continue;
      visit(layer, x, x, z, z, (r) => {
        if (!r.corridor) return false;
        const l = localOf(r, x, z);
        if (l.u < r.uF || l.u > r.uL || l.v < r.v0 || l.v > r.v1) return false;
        if (feetY < profAt(r, r.under, l.u) - step) return false;
        out.push(r);
        return false;
      });
    }
    return out;
  }

  /** Does the box [minX,maxX]x[minZ,maxZ] touch any ribbon in the list? */
  function boxTouches(list, minX, maxX, minZ, maxZ) {
    const hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (maxX < r.minX || minX > r.maxX || maxZ < r.minZ || minZ > r.maxZ) continue;
      const cu = (cx - r.ox) * r.ux + (cz - r.oz) * r.uz, cv = (cx - r.ox) * r.nx + (cz - r.oz) * r.nz;
      const eu = hx * Math.abs(r.ux) + hz * Math.abs(r.uz), ev = hx * Math.abs(r.nx) + hz * Math.abs(r.nz);
      if (cu + eu >= r.uF && cu - eu <= r.uL && cv + ev >= r.v0 && cv - ev <= r.v1) return true;
    }
    return false;
  }

  /** What a body can stand on from the new solids: the highest top at (x, z), or NEG. */
  function standOn(x, z, feetY, step) {
    let best = NEG;
    for (const layer of layers()) {
      if (!layer.grid) continue;
      visit(layer, x, x, z, z, (it) => {
        if (it.ring) {
          if (x < it.minX || x > it.maxX || z < it.minZ || z > it.maxZ) return false;
          const top = it.base + it.h * scale;
          if (top <= feetY + step && top > best && pointInRing(x, z, it.ring)) best = top;
          return false;
        }
        if (!it.stand) return false;
        const l = localOf(it, x, z);
        if (l.u < it.uF || l.u > it.uL || l.v < it.v0 || l.v > it.v1) return false;
        const top = profAt(it, it.top, l.u);
        if (top <= feetY + step) { if (top > best) best = top; }
        else if (it.lift && feetY <= top && profAt(it, it.under, l.u) <= feetY && top > best) best = top;
        return false;
      });
    }
    return best;
  }

  /** The lowest underside above feetY over (x, z), or null. */
  function ceilingAt(x, z, feetY) {
    let best = Infinity;
    for (const layer of [bridgeLayer, motorLayer]) {
      if (!layer.grid) continue;
      visit(layer, x, x, z, z, (r) => {
        if (!r.ceil) return false;
        const l = localOf(r, x, z);
        if (l.u < r.uF || l.u > r.uL || l.v < r.v0 || l.v > r.v1) return false;
        const under = profAt(r, r.under, l.u);
        if (under > feetY + 1e-6 && under < best) best = under;
        return false;
      });
    }
    return best === Infinity ? null : best;
  }

  /**
   * Gather what can stop a move: oriented blocked rectangles (flat 8-tuples in gather.rects) and
   * station prisms (gather.prisms), for the body span [F, H] and the swept AABB [x0,x1]x[z0,z1].
   */
  function gatherFor(x0, x1, z0, z1, px, pz, radius, F, H, step) {
    const rects = gather.rects, prisms = gather.prisms;
    rects.length = 0; prisms.length = 0;
    for (const layer of layers()) {
      if (!layer.grid) continue;
      visit(layer, x0, x1, z0, z1, (it) => {
        if (it.ring) {
          const top = it.base + it.h * scale, under = it.base - it.skirt * scale;
          if (!(under < H && top - step > F)) return false;
          if (pointInRing(px, pz, it.ring)) return false; // never trap a body that starts inside
          prisms.push(it);
          return false;
        }
        if (!it.move) return false;
        if (!(it.minUnder < H && it.maxTop - step > F)) return false;
        iv.length = 0;
        blockedIntervals(it, F, H, step, iv);
        if (!iv.length) return false;
        const l = localOf(it, px, pz);
        const pu = l.u, pv = l.v;
        for (let k = 0; k < iv.length; k += 2) {
          const a0 = iv[k] - radius, a1 = iv[k + 1] + radius, b0 = it.v0 - radius, b1 = it.v1 + radius;
          if (pu > a0 && pu < a1 && pv > b0 && pv < b1) continue; // starts inside: never trapped
          rects.push(it.ox, it.oz, it.ux, it.uz, a0, a1, b0, b1);
        }
        return false;
      });
    }
    return gather;
  }

  /**
   * Resolve one substep p -> q against the gathered rectangles then the prisms. q = {x, z} is
   * updated in place; res gets hit and the last normal. Never a point test alone: a slab test of
   * the whole segment, so a 0.30 m parapet is never tunnelled.
   */
  function resolveSubstep(px, pz, q, radius, res) {
    const rects = gather.rects;
    for (let k = 0; k < rects.length; k += 8) {
      const ox = rects[k], oz = rects[k + 1], ux = rects[k + 2], uz = rects[k + 3];
      const a0 = rects[k + 4], a1 = rects[k + 5], b0 = rects[k + 6], b1 = rects[k + 7];
      const nx = -uz, nz = ux;
      const pu = (px - ox) * ux + (pz - oz) * uz, pv = (px - ox) * nx + (pz - oz) * nz;
      const qu = (q.x - ox) * ux + (q.z - oz) * uz, qv = (q.x - ox) * nx + (q.z - oz) * nz;
      const du = qu - pu, dv = qv - pv;
      let tu0, tu1, tv0, tv1;
      if (du === 0) { if (pu <= a0 || pu >= a1) continue; tu0 = -Infinity; tu1 = Infinity; }
      else { const t1 = (a0 - pu) / du, t2 = (a1 - pu) / du; tu0 = Math.min(t1, t2); tu1 = Math.max(t1, t2); }
      if (dv === 0) { if (pv <= b0 || pv >= b1) continue; tv0 = -Infinity; tv1 = Infinity; }
      else { const t1 = (b0 - pv) / dv, t2 = (b1 - pv) / dv; tv0 = Math.min(t1, t2); tv1 = Math.max(t1, t2); }
      const tEnter = Math.max(tu0, tv0), tExit = Math.min(tu1, tv1);
      if (!(tEnter < tExit) || tEnter >= 1 || tExit <= 0 || tEnter < 0) continue;
      let cu = qu, cv = qv;
      if (tu0 >= tv0) { cu = du > 0 ? a0 - EPS : a1 + EPS; res.normalX = du > 0 ? -ux : ux; res.normalZ = du > 0 ? -uz : uz; }
      else { cv = dv > 0 ? b0 - EPS : b1 + EPS; res.normalX = dv > 0 ? -nx : nx; res.normalZ = dv > 0 ? -nz : nz; }
      q.x = ox + cu * ux + cv * nx; q.z = oz + cu * uz + cv * nz;
      res.hit = true;
    }
    const prisms = gather.prisms;
    for (let i = 0; i < prisms.length; i++) {
      const it = prisms[i], need = radius + EPS;
      if (q.x < it.minX - need || q.x > it.maxX + need || q.z < it.minZ - need || q.z > it.maxZ + need) continue;
      let ok = false;
      for (let iter = 0; iter < 3; iter++) {
        const r = nearestOnRing(q.x, q.z, it.ring);
        if (!r.inside && r.d >= need) { ok = true; break; }
        q.x = r.x + r.nx * need; q.z = r.z + r.nz * need;
        res.hit = true; res.normalX = r.nx; res.normalZ = r.nz;
      }
      if (!ok) {
        const r = nearestOnRing(q.x, q.z, it.ring);
        if (r.inside || r.d < need - 1e-6) { q.x = px; q.z = pz; }
      }
    }
  }

  /**
   * First hit fraction of the segment a -> b over the DRAWN new solids, in [1e-6, 1], or null.
   */
  function segmentHits(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    let best = Infinity;
    for (const layer of layers()) {
      if (!layer.grid) continue;
      visit(layer, minX, maxX, minZ, maxZ, (it) => {
        const t = it.ring ? segmentHitPrism(it, ax, ay, az, dx, dy, dz) : (it.drawn ? segmentHitRibbon(it, ax, ay, az, dx, dy, dz) : null);
        if (t !== null && t < best) best = t;
        return false;
      });
    }
    return best === Infinity ? null : Math.max(1e-6, Math.min(1, best));
  }

  function segmentHitPrism(p, ax, ay, az, dx, dy, dz) {
    const yb = p.base - p.skirt * scale, yr = p.base + p.h * scale;
    let t0 = 0, t1 = 1;
    if (Math.abs(dy) < 1e-12) { if (ay < yb || ay > yr) return null; }
    else { const s = (yb - ay) / dy, e = (yr - ay) / dy; t0 = Math.max(t0, Math.min(s, e)); t1 = Math.min(t1, Math.max(s, e)); }
    if (!(t1 >= t0)) return null;
    const sx = ax + dx * t0, sz = az + dz * t0, ex = ax + dx * t1, ez = az + dz * t1;
    if (Math.max(sx, ex) < p.minX || Math.min(sx, ex) > p.maxX || Math.max(sz, ez) < p.minZ || Math.min(sz, ez) > p.maxZ) return null;
    if (pointInRing(sx, sz, p.ring)) return t0 <= 0 ? 1e-6 : t0;
    let best = null;
    const gx = ex - sx, gz = ez - sz;
    for (let i = 0, n = p.ring.length; i < n; i++) {
      const q = p.ring[i], r = p.ring[(i + 1) % n], fx = r[0] - q[0], fz = r[1] - q[1];
      const den = gx * fz - gz * fx;
      if (Math.abs(den) < 1e-12) continue;
      const u = ((q[0] - sx) * fz - (q[1] - sz) * fx) / den, v = ((q[0] - sx) * gz - (q[1] - sz) * gx) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { const tt = t0 + u * (t1 - t0); if (best === null || tt < best) best = tt; }
    }
    return best;
  }

  function segmentHitRibbon(r, ax, ay, az, dx, dy, dz) {
    const pu = (ax - r.ox) * r.ux + (az - r.oz) * r.uz, pv = (ax - r.ox) * r.nx + (az - r.oz) * r.nz;
    const du = dx * r.ux + dz * r.uz, dv = dx * r.nx + dz * r.nz;
    let tv0 = 0, tv1 = 1;
    if (dv === 0) { if (pv < r.v0 || pv > r.v1) return null; }
    else { const s = (r.v0 - pv) / dv, e = (r.v1 - pv) / dv; tv0 = Math.min(s, e); tv1 = Math.max(s, e); }
    let best = null;
    const c = r.cols;
    for (let j = 0; j < c.length - 1; j++) {
      // plan clip to the column interval and the lateral extent
      let lo = Math.max(0, tv0), hi = Math.min(1, tv1);
      if (du === 0) { if (pu < c[j] || pu > c[j + 1]) continue; }
      else { const s = (c[j] - pu) / du, e = (c[j + 1] - pu) / du; lo = Math.max(lo, Math.min(s, e)); hi = Math.min(hi, Math.max(s, e)); }
      if (!(hi >= lo)) continue;
      // vertical clip: under(u(t)) <= y(t) <= top(u(t)), all linear in t on this interval
      const w = c[j + 1] - c[j];
      const k0 = (r.top[j + 1] - r.top[j]) / w, k1 = (r.under[j + 1] - r.under[j]) / w;
      const topAt = (t) => r.top[j] + k0 * (pu + du * t - c[j]);
      const underAt = (t) => r.under[j] + k1 * (pu + du * t - c[j]);
      // g1(t) = top - y >= 0 ; g2(t) = y - under >= 0
      const g1a = topAt(lo) - (ay + dy * lo), g1b = topAt(hi) - (ay + dy * hi);
      const g2a = (ay + dy * lo) - underAt(lo), g2b = (ay + dy * hi) - underAt(hi);
      let a = lo, b = hi;
      const clip = (ga, gb) => {
        if (ga >= 0 && gb >= 0) return true;
        if (ga < 0 && gb < 0) return false;
        const tc = lo + (hi - lo) * (ga / (ga - gb));
        if (ga >= 0) b = Math.min(b, tc); else a = Math.max(a, tc);
        return true;
      };
      if (!clip(g1a, g1b) || !clip(g2a, g2b)) continue;
      if (!(b >= a)) continue;
      if (best === null || a < best) best = a;
      if (a <= 0) break;
    }
    if (best === null) return null;
    return best <= 0 ? 1e-6 : best;
  }

  return {
    setSources(next) { sources = { ...sources, ...next }; built = false; },
    update, corridorsAt, boxTouches, standOn, ceilingAt, gatherFor, resolveSubstep, segmentHits,
    stats() {
      update();
      const rib = bridgeLayer.items.length + motorLayer.items.length;
      return {
        version, bridges: bridgeCounts.bridges, decks: bridgeCounts.decks, ramps: bridgeCounts.ramps,
        parapets: bridgeCounts.parapets, piers: bridgeCounts.piers, towers: bridgeCounts.towers,
        motorwaySegments: motorSegments, stations: stationLayer.items.length, ribbons: rib,
        prisms: stationLayer.items.length, errors: errors.slice(), buildMs,
      };
    },
  };
}
