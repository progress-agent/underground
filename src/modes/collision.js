// collision.js: world collision service for the solid conveyance modes
// (sprint 23Sep26w, D-037, lane A1). Pedestrian, Drone and Balloon collide
// with buildings; Deity never calls this and stays passable.
//
// ─── API ────────────────────────────────────────────────────────────────────
//
//   const collision = createCollisionService({
//     getBuildingMeshes,   // () => iterable of building InstancedMeshes (live or baked)
//     getHeightScale,      // () => building height uniform (1 / Master since D-039: true height)
//     getGroundY,          // (x, z) => canonical terrain Y, or null off the mesh
//     getWaterSurfaceY,    // (x, z) => canonical water-top Y where there is water, else null
//     isSubmerged,         // (x, y, z) => boolean, the shared inside-water predicate
//     cellSize = 32,       // metres per spatial-grid cell
//   });
//
//   collision.sync()                           pick up added / removed tile meshes (cheap; call per frame)
//   collision.buildingsNear(x, z, r, out?)     boxes whose footprint lies within r: [{minX,maxX,minZ,maxZ,baseY,roofY}]
//   collision.roofHeightAt(x, z)               highest roof Y of a building covering (x, z), or null
//   collision.groundHeightAt(x, z)             terrain Y, or null
//   collision.standHeightAt(x, z, feetY?)      what a body can stand on: the highest roof at or
//                                              below feetY (+ step) else ground. Walkable roofs.
//   collision.waterAt(x, z)                    { surfaceY, bedY } where the Thames / a dock is, else null
//   collision.isInWater(x, y, z)               the shared submerged predicate
//   collision.moveAndSlide(pos, delta, body)   2D footprint collision with facade sliding (below)
//   collision.stats()                          { meshes, indexedMeshes, indexedBuildings }
//
//   moveAndSlide(pos, delta, { radius = 0.4, height = 1.8*5, step = 0.4*5 })
//     pos    {x, y, z} feet position, canonical scene units. NOT mutated.
//     delta  {x, y, z} desired displacement this frame.
//     Returns { x, y, z, hit, normalX, normalZ }: the allowed end position and,
//     when a facade stopped part of the motion, the last facade's outward
//     normal. Only X/Z are resolved; y is simply pos.y + delta.y (vertical is
//     the mode's business, using standHeightAt / roofHeightAt).
//     A building blocks a body when its footprint (expanded by radius) contains
//     the body AND the body's vertical span [y, y + height] overlaps
//     [baseY, roofY - step]. So a body at roof level walks across the roof, a
//     body slightly below a kerb-high roof steps onto it, and a body already
//     inside a footprint (spawned there, or Deity left it there) is never
//     trapped: boxes it starts inside are ignored for that move.
//
// ─── UNITS ──────────────────────────────────────────────────────────────────
//
//   Everything is canonical scene space (vertical-scale.js contract): X/Z are
//   real metres, Y is VE5 scene units (5 per real metre). Master rescales only
//   the camera display, never this data, so collision is correct at every
//   Master value. Roof heights follow the building height uniform through
//   getHeightScale() (roofY = baseY + authoredHeight * scale, exactly what the
//   building shader draws); since D-039 that uniform is 1 / Master, so every
//   roof stands at its true height above the stretched ground.
//
// ─── DATA ───────────────────────────────────────────────────────────────────
//
//   Buildings are read straight from the instance matrices both render paths
//   write (baked-buildings.js and surface-geometry.js): an axis-aligned,
//   base-pivoted box, [0]=side [5]=height [10]=side [12..14]=x,y,z. That makes
//   the service path-agnostic and needs no second copy of the payload. Each
//   tile mesh is indexed lazily into its own CSR grid the first time a query
//   touches its bounds, so only the neighbourhood the player is in costs
//   anything, and Deity (which never queries) costs nothing at all.
//
//   D-023 CAVEAT: about 85% of building heights are the fabricated 10m OSM
//   fallback (12% are 6.4m). Walkable roofs are therefore mostly a uniform
//   roofscape, not the real skyline. Landmark models and airport buildings are
//   separate groups and are not solid yet. Since sprint 14Oct26w (lane S, D-053
//   item 8) the 41 Thames bridges, the M25's two Thames crossings and the
//   station buildings are solid too, through src/modes/solids.js (below).

// ── s14:S ──
import { createSolidWorld } from './solids.js';

// ─── SOLIDS (sprint 14Oct26w, lane S) ───────────────────────────────────────
//
//   collision.setSolidSources({ bridges, motorway, stationBuildings })
//       Three getters, each returning the current source or null: the bridges group
//       (userData.registry), the motorway group (userData.roadPaths) and
//       { index, meshes, VE } for the station buildings. Called once from main.js.
//   moveAndSlide / standHeightAt   now also resolve against bridge decks (walkable, with a
//       1-in-6 approach ramp at each end), parapets, piers, towers, the motorway crossings
//       and station-building footprints, with no change to any caller. Map boxes that stand
//       across a deck or ramp are not solid to a body in that corridor (feet at or above the
//       slab's underside less a step); below the deck they are as before.
//   collision.ceilingAt(x, z, feetY)     the lowest deck / tower underside above feetY, or null
//   collision.segmentHitsSolids(from, to)  { x, y, z } pair -> first hit fraction in [1e-6, 1]
//       over the DRAWN new solids (not ramps or parapets), or null. For the camera's line of sight.
//   collision.solidStats()               { version, bridges, decks, ramps, parapets, piers, towers,
//       motorwaySegments, stations, ribbons, prisms, errors, buildMs }
//   roofHeightAt and buildingsNear are unchanged: they read only the map boxes.
// ── /s14:S ──

const DEFAULT_CELL = 32;
const EPS = 1e-3;
const MAX_SUBSTEPS = 64;
const NEG_SOLID = -1e8; // s14:S: solids.js returns NEG (-1e9) when it has nothing to stand on

export function createCollisionService({
  getBuildingMeshes = () => [],
  getHeightScale = () => 1,
  getGroundY = () => null,
  getWaterSurfaceY = () => null,
  isSubmerged = () => false,
  cellSize = DEFAULT_CELL,
  VE = 5, // s14:S
} = {}) {
  /** @type {WeakMap<object, object>} mesh -> entry */
  const entries = new WeakMap();
  let current = [];          // entries for the meshes present at the last sync
  let stampCounter = 1;
  let indexedBuildings = 0;
  // ── s14:S ──
  const solidWorld = createSolidWorld({ getGroundY: (x, z) => getGroundY(x, z), getWaterSurfaceY: (x, z) => getWaterSurfaceY(x, z),
    getHeightScale: () => getHeightScale(), VE });
  const corridor = [];
  const slideQ = { x: 0, z: 0 };
  // ── /s14:S ──

  function makeEntry(mesh) {
    const count = mesh.count | 0;
    const m = mesh.instanceMatrix?.array;
    if (!m || count <= 0) return null;
    // Bounds: trust the baked mesh's own AABB; compute for live tiles.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const bb = mesh.boundingBox;
    if (bb && Number.isFinite(bb.min?.x)) {
      minX = bb.min.x; maxX = bb.max.x; minZ = bb.min.z; maxZ = bb.max.z;
    } else {
      for (let i = 0; i < count; i++) {
        const o = i * 16, h = m[o] * 0.5;
        minX = Math.min(minX, m[o + 12] - h); maxX = Math.max(maxX, m[o + 12] + h);
        minZ = Math.min(minZ, m[o + 14] - h); maxZ = Math.max(maxZ, m[o + 14] + h);
      }
    }
    return { mesh, count, minX, maxX, minZ, maxZ, grid: null };
  }

  function indexEntry(e) {
    const m = e.mesh.instanceMatrix.array, n = e.count;
    const boxes = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const o = i * 16, b = i * 6, h = Math.abs(m[o]) * 0.5;
      boxes[b] = m[o + 12] - h; boxes[b + 1] = m[o + 12] + h;
      boxes[b + 2] = m[o + 14] - h; boxes[b + 3] = m[o + 14] + h;
      boxes[b + 4] = m[o + 13]; boxes[b + 5] = m[o + 5];
    }
    const cols = Math.max(1, Math.ceil((e.maxX - e.minX) / cellSize) + 1);
    const rows = Math.max(1, Math.ceil((e.maxZ - e.minZ) / cellSize) + 1);
    const counts = new Uint32Array(cols * rows + 1);
    const cellRange = (b, fn) => {
      const c0 = Math.max(0, Math.floor((boxes[b] - e.minX) / cellSize));
      const c1 = Math.min(cols - 1, Math.floor((boxes[b + 1] - e.minX) / cellSize));
      const r0 = Math.max(0, Math.floor((boxes[b + 2] - e.minZ) / cellSize));
      const r1 = Math.min(rows - 1, Math.floor((boxes[b + 3] - e.minZ) / cellSize));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
    };
    for (let i = 0; i < n; i++) cellRange(i * 6, cell => { counts[cell + 1]++; });
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const items = new Uint32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, cols * rows);
    for (let i = 0; i < n; i++) cellRange(i * 6, cell => { items[fill[cell]++] = i; });
    e.grid = { boxes, cols, rows, start: counts, items, stamp: new Uint32Array(n) };
    indexedBuildings += n;
  }

  function sync() {
    const next = [];
    for (const mesh of getBuildingMeshes() || []) {
      if (!mesh || !mesh.isInstancedMesh && !mesh.instanceMatrix) continue;
      let e = entries.get(mesh);
      if (!e || e.count !== (mesh.count | 0)) {
        if (e?.grid) indexedBuildings -= e.count;
        e = makeEntry(mesh);
        if (!e) continue;
        entries.set(mesh, e);
      }
      next.push(e);
    }
    current = next;
    solidWorld.update(); // s14:S
    return current.length;
  }

  /**
   * Visit every building whose footprint overlaps the AABB [x0,x1]x[z0,z1].
   * fn(minX, maxX, minZ, maxZ, baseY, roofY) returning true stops the walk.
   */
  function forEachBuilding(x0, x1, z0, z1, fn) {
    if (!current.length) sync();
    const scale = getHeightScale();
    const stamp = stampCounter++;
    for (const e of current) {
      if (e.maxX < x0 || e.minX > x1 || e.maxZ < z0 || e.minZ > z1) continue;
      if (!e.grid) indexEntry(e);
      const g = e.grid;
      const c0 = Math.max(0, Math.floor((x0 - e.minX) / cellSize));
      const c1 = Math.min(g.cols - 1, Math.floor((x1 - e.minX) / cellSize));
      const r0 = Math.max(0, Math.floor((z0 - e.minZ) / cellSize));
      const r1 = Math.min(g.rows - 1, Math.floor((z1 - e.minZ) / cellSize));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * g.cols + c;
          for (let k = g.start[cell], end = g.start[cell + 1]; k < end; k++) {
            const i = g.items[k];
            if (g.stamp[i] === stamp) continue;
            g.stamp[i] = stamp;
            const b = i * 6;
            if (g.boxes[b + 1] < x0 || g.boxes[b] > x1 || g.boxes[b + 3] < z0 || g.boxes[b + 2] > z1) continue;
            if (fn(g.boxes[b], g.boxes[b + 1], g.boxes[b + 2], g.boxes[b + 3],
              g.boxes[b + 4], g.boxes[b + 4] + g.boxes[b + 5] * scale)) return;
          }
        }
      }
    }
  }

  function buildingsNear(x, z, r, out = []) {
    out.length = 0;
    forEachBuilding(x - r, x + r, z - r, z + r, (minX, maxX, minZ, maxZ, baseY, roofY) => {
      out.push({ minX, maxX, minZ, maxZ, baseY, roofY });
    });
    return out;
  }

  function roofHeightAt(x, z) {
    let best = null;
    forEachBuilding(x, x, z, z, (minX, maxX, minZ, maxZ, baseY, roofY) => {
      if (best === null || roofY > best) best = roofY;
    });
    return best;
  }

  function groundHeightAt(x, z) {
    const y = getGroundY(x, z);
    return Number.isFinite(y) ? y : null;
  }

  function standHeightAt(x, z, feetY = Infinity, step = 2) {
    let best = groundHeightAt(x, z);
    // ── s14:S ── a map box that stands across the deck or ramp the body is on is not a roof to it
    solidWorld.update();
    const onSlab = solidWorld.corridorsAt(x, z, feetY, step, corridor).length > 0;
    forEachBuilding(x, x, z, z, (minX, maxX, minZ, maxZ, baseY, roofY) => {
      if (onSlab && solidWorld.boxTouches(corridor, minX, maxX, minZ, maxZ)) return;
      if (roofY <= feetY + step && (best === null || roofY > best)) best = roofY;
    });
    const solid = solidWorld.standOn(x, z, feetY, step);
    if (solid > NEG_SOLID && (best === null || solid > best)) best = solid;
    // ── /s14:S ──
    return best;
  }

  function waterAt(x, z) {
    const surfaceY = getWaterSurfaceY(x, z);
    if (!Number.isFinite(surfaceY)) return null;
    return { surfaceY, bedY: groundHeightAt(x, z) };
  }

  function moveAndSlide(pos, delta, { radius = 0.4, height = 9, step = 2 } = {}) {
    let x = pos.x, z = pos.z;
    const y = pos.y + (delta.y || 0);
    const feet = Math.min(pos.y, y), head = Math.max(pos.y, y) + height;
    const dx = delta.x || 0, dz = delta.z || 0;
    const len = Math.hypot(dx, dz);
    const res = { x, y, z, hit: false, normalX: 0, normalZ: 0 };
    if (len === 0) return res;
    // Gather candidates once over the swept, radius-expanded AABB.
    const pad = radius + EPS;
    const sx0 = Math.min(x, x + dx) - pad, sx1 = Math.max(x, x + dx) + pad;
    const sz0 = Math.min(z, z + dz) - pad, sz1 = Math.max(z, z + dz) + pad;
    // ── s14:S ── the corridor carve (map boxes across a deck or ramp are not solid to a body on it),
    // then the new solids: oriented blocked rectangles and station prisms.
    solidWorld.update();
    const onSlab = solidWorld.corridorsAt(x, z, feet, step, corridor).length > 0;
    // ── /s14:S ──
    const cand = [];
    forEachBuilding(sx0, sx1, sz0, sz1,
      (minX, maxX, minZ, maxZ, baseY, roofY) => {
        if (head <= baseY || feet >= roofY - step) return; // passes over / under
        if (onSlab && solidWorld.boxTouches(corridor, minX, maxX, minZ, maxZ)) return; // s14:S
        const ex0 = minX - radius, ex1 = maxX + radius, ez0 = minZ - radius, ez1 = maxZ + radius;
        // Already inside at the start: never trap the body.
        if (x > ex0 && x < ex1 && z > ez0 && z < ez1) return;
        cand.push(ex0, ex1, ez0, ez1);
      });
    // ── s14:S ──
    const sol = solidWorld.gatherFor(sx0, sx1, sz0, sz1, x, z, radius, feet, head, step);
    const hasSolids = sol.rects.length > 0 || sol.prisms.length > 0;
    // ── /s14:S ──
    if (!cand.length && !hasSolids) { res.x = x + dx; res.z = z + dz; return res; }
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(len / Math.max(radius, 0.5))));
    const sx = dx / steps, sz = dz / steps;
    for (let s = 0; s < steps; s++) {
      const px = x, pz = z; // s14:S
      // Axis-separated resolution: every footprint is axis-aligned, so this
      // is exact and yields a natural slide along the facade.
      if (sx !== 0) {
        let nx = x + sx;
        for (let k = 0; k < cand.length; k += 4) {
          if (nx > cand[k] && nx < cand[k + 1] && z > cand[k + 2] && z < cand[k + 3]) {
            nx = sx > 0 ? cand[k] - EPS : cand[k + 1] + EPS;
            res.hit = true; res.normalX = sx > 0 ? -1 : 1; res.normalZ = 0;
          }
        }
        x = nx;
      }
      if (sz !== 0) {
        let nz = z + sz;
        for (let k = 0; k < cand.length; k += 4) {
          if (x > cand[k] && x < cand[k + 1] && nz > cand[k + 2] && nz < cand[k + 3]) {
            nz = sz > 0 ? cand[k + 2] - EPS : cand[k + 3] + EPS;
            res.hit = true; res.normalX = 0; res.normalZ = sz > 0 ? -1 : 1;
          }
        }
        z = nz;
      }
      // ── s14:S ── the new solids resolve after the boxes; a box the result now penetrates (and the
      // substep did not start inside) sends the body back to where the substep began.
      if (hasSolids) {
        slideQ.x = x; slideQ.z = z;
        solidWorld.resolveSubstep(px, pz, slideQ, radius, res);
        if (slideQ.x !== x || slideQ.z !== z) {
          x = slideQ.x; z = slideQ.z;
          for (let k = 0; k < cand.length; k += 4) {
            if (x > cand[k] && x < cand[k + 1] && z > cand[k + 2] && z < cand[k + 3]
              && !(px > cand[k] && px < cand[k + 1] && pz > cand[k + 2] && pz < cand[k + 3])) { x = px; z = pz; break; }
          }
        }
      }
      // ── /s14:S ──
    }
    res.x = x; res.z = z;
    return res;
  }

  return {
    // ── s14:S ──
    setSolidSources: (sources) => solidWorld.setSources(sources || {}),
    ceilingAt: (x, z, feetY) => solidWorld.ceilingAt(x, z, feetY),
    segmentHitsSolids: (a, b) => solidWorld.segmentHits(a.x, a.y, a.z, b.x, b.y, b.z),
    solidStats: () => solidWorld.stats(),
    // ── /s14:S ──
    sync,
    buildingsNear,
    roofHeightAt,
    groundHeightAt,
    standHeightAt,
    waterAt,
    isInWater: (x, y, z) => !!isSubmerged(x, y, z),
    moveAndSlide,
    stats: () => ({
      meshes: current.length,
      indexedMeshes: current.filter(e => e.grid).length,
      indexedBuildings,
    }),
  };
}
