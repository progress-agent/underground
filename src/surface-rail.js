// Surface railway: the D-019 earthworks archetype language, shared by the
// London Overground (overground.js) and the open-air Tube and DLR
// (tube-surface-rail.js, sprint 30Sep26w, D-041 item 2: "drawn exactly like
// the Overground, stripe included").
//
// Generalised out of overground.js (a095a84, reworked 06Sep26u for D-024 and
// 25Sep26f for the Thames Tunnel) WITHOUT changing a number: the Overground is
// built from exactly these functions and constants and stays pixel-identical
// (tests/surface-rail.spec.js). The archetypes:
//   surface    — ballast ribbon + line-colour stripe on the ground
//   embankment — ribbon raised ~3m with earth-tone skirt strips
//   viaduct    — masonry deck raised ~8m on piers
//   cutting    — ballast at grade, flanked by dark shadow bands (06Sep26u:
//                was sunk 3m between wall strips, which put it inside the
//                un-carved terrain mesh and made it invisible)
//   tunnel     — stripe only, sunk ~20m (e.g. Windrush under the Thames); the
//                Tube and DLR skip it (skipTunnel): their below-ground
//                sections keep the underground look and the D-040 cull.
//
// D-024, both halves load-bearing: only a tunnel may sit below the terrain,
// and buildPath applies the terrain floor AFTER smoothing.

import * as THREE from 'three';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import { VERTICAL_EXAGGERATION, getTerrainMeshSurfaceY as renderedFloorY } from './terrain.js';
// s25:E Thames Tunnel depth (sourced; see rail-truth.js)
import { WATER_LEVEL_M } from './thames.js';
import { isInThames } from './thames-mask.js';
import { THAMES_TUNNEL } from './rail-truth.js';

const VE = VERTICAL_EXAGGERATION;

// Registered in main.js too — defs() is idempotent, keep this module portable.
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

// ── Archetype constants (scene units; Y lifts are real metres × VE) ──────
export const BALLAST_HALF_W = 9;          // 18m ballast bed (visual presence at altitude)
export const STRIPE_HALF_W = 4.5;         // line-colour identity stripe
export const BASE_LIFT = 5;               // ~1m real: rail head above surrounding ground.
                                          // Was 2 (0.4m), which left 9.3% of the network
                                          // "grazing" — flickering in and out of the terrain
                                          // mesh between rail points (06Sep26u census).
export const STRIPE_LIFT = 0.8;           // stripe above its ballast
export const CUT_SHADOW_W = 6;            // flanking dark band per side (real metres = scene units in XZ)
export const CUT_SHADOW_DROP = 1.2;       // band sits just under the ballast lip, still above terrain
export const CLASS_LIFT_M = {             // real metres relative to terrain
  surface: 0,
  embankment: 3,
  viaduct: 8,
  // Cuttings render AT GRADE, recessed by tone rather than geometry (06Sep26u).
  // The terrain mesh is 512x512 over 70x50km — ~137m x 98m per cell — so a 20m
  // cutting is an order of magnitude below the grid's resolution and cannot be
  // carved (the Thames carve works only because the river is 80-250m wide).
  // Sunk geometry was simply inside an opaque mesh: 14.1% of the identity stripe
  // network-wide, 79% within 700m of Highbury & Islington, was invisible.
  cutting: 0,
  tunnel: -20,
};
export const PIER_SPACING_M = 110;
export const SMOOTH_PASSES = 3;           // moving-average passes over track Y
export const SAMPLE_STEP_M = 12;          // path sampling within source segments

export const MATS = {
  ballast: new THREE.MeshStandardMaterial({ color: 0x4c4741, roughness: 0.9, metalness: 0.05, fog: true, side: THREE.DoubleSide }),
  earth: new THREE.MeshStandardMaterial({ color: 0x5d5142, roughness: 0.95, metalness: 0.0, fog: true, side: THREE.DoubleSide }),
  masonry: new THREE.MeshStandardMaterial({ color: 0x8d8778, roughness: 0.8, metalness: 0.08, fog: true, side: THREE.DoubleSide }),
  // Cutting treatment: the shaded flank of a trench, read as tone from altitude.
  cutShadow: new THREE.MeshStandardMaterial({ color: 0x272320, roughness: 1.0, metalness: 0.0, fog: true, side: THREE.DoubleSide }),
};

/** The muted line-colour stripe: identity kept, placed into the city palette. */
export function stripeColour(hex, fallback = '#EE7C0E') {
  // Keep the identities while placing the corridors into the muted city
  // palette. A small residual glow preserves underground route legibility.
  const colour = new THREE.Color(hex || fallback);
  const neutral = new THREE.Color(0x85827a);
  colour.lerp(neutral, 0.32).multiplyScalar(0.82);
  return colour;
}
export function createStripeMaterial(hex, fallback) {
  const colour = stripeColour(hex, fallback);
  return new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.55, metalness: 0.1,
    emissive: colour, emissiveIntensity: 0.07, fog: true, side: THREE.DoubleSide,
  });
}

export function llToScene(lon, lat) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) };
}

// Build a quad-strip BufferGeometry from parallel left/right rails of points.
export function stripGeometry(left, right) {
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

// s25:E (see buildPath). Source segment i joins pts[i] to pts[i+1].
export function closeRiverTunnelSlivers(pts, classes) {
  const runs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const tunnel = classes[i] === 'tunnel';
    if (!runs.length || runs.at(-1).tunnel !== tunnel) runs.push({ tunnel, i0: i, i1: i });
    runs.at(-1).i1 = i;
  }
  const crossesRiver = r => {
    // Sample along the segments: a tunnel's source nodes can all sit on land.
    for (let i = r.i0; i <= r.i1; i++) {
      const a = llToScene(...pts[i]), b = llToScene(...pts[i + 1]);
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
      for (let j = 0; j <= n; j++) if (isInThames(a.x + (b.x - a.x) * j / n, a.z + (b.z - a.z) * j / n)) return true;
    }
    return false;
  };
  for (let k = 1; k < runs.length - 1; k++) {
    const r = runs[k];
    if (r.tunnel || !runs[k - 1].tunnel || !runs[k + 1].tunnel) continue;
    let len = 0;
    for (let i = r.i0; i <= r.i1; i++) { const a = llToScene(...pts[i]), b = llToScene(...pts[i + 1]); len += Math.hypot(b.x - a.x, b.z - a.z); }
    if (len >= 25 || !(crossesRiver(runs[k - 1]) || crossesRiver(runs[k + 1]))) continue;
    for (let i = r.i0; i <= r.i1; i++) classes[i] = 'tunnel';
  }
}

/** Per source segment earthworks class, as the source's {i0,i1,class} segments give it. */
export function branchClasses(branch) {
  const pts = branch.points;
  const classes = new Array(pts.length).fill('surface');
  for (const seg of branch.segments || []) {
    for (let i = seg.i0; i < Math.min(seg.i1, pts.length); i++) classes[i] = seg.class;
  }
  return classes;
}

// Per-corridor path in scene space with per-point earthworks class + track Y.
// Each sample records `src`, the source segment it lies on (shared-track bands
// index the owner's source points).
export function buildPath(branch, getTerrainMeshSurfaceY) {
  const pts = branch.points;
  const classes = branchClasses(branch);
  // s25:E: the Thames Tunnel's source carries a ~20 m 'surface' sliver at
  // Wapping station, which sits at the foot of Brunel's shaft underground; it
  // threw the line up to street level between two tunnel runs. Close any
  // non-tunnel gap under 25 m between tunnel runs when one of them crosses the
  // river. Other lines' short gaps are left alone.
  closeRiverTunnelSlivers(pts, classes);
  const path = [];
  // Sample within long source segments too: a chord between two terrain
  // samples otherwise sails across intervening street-level relief.
  for(let i=0;i<pts.length-1;i++) {
    const a=llToScene(...pts[i]),b=llToScene(...pts[i+1]);
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/SAMPLE_STEP_M));
    for(let j=0;j<steps+(i===pts.length-2?1:0);j++) {
      const t=j/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      const terrainY=getTerrainMeshSurfaceY({x,z});if(!Number.isFinite(terrainY))continue;
      const cls=CLASS_LIFT_M[classes[i]]===undefined?'surface':classes[i];
      // s25:E: a tunnel sample under the river (inside the river mask, rendered
      // bed below the water line) is the Thames
      // Tunnel; its centre sits 5.2 m below the bed, not 20 m under the ground.
      // Measured from the RENDERED bed (refined river floor), which is what
      // the viewer sees; the structural sampler passed in sits above it.
      const floorY=cls==='tunnel'&&isInThames(x,z)?renderedFloorY({x,z}):null;
      const underRiver=Number.isFinite(floorY)&&floorY<WATER_LEVEL_M*VE;
      const bedY=underRiver?floorY:terrainY;
      path.push({x,z,terrainY,cls,underRiver,bedY,y:underRiver?bedY-THAMES_TUNNEL.centreBelowBedM*VE:terrainY+BASE_LIFT+CLASS_LIFT_M[cls]*VE,src:i});
    }
  }
  // Distance-based approaches taper a viaduct/embankment down to adjoining
  // ground-level track. A point-count smoother makes steep steps when source
  // nodes are unevenly spaced. Limit the additional earthwork grade to4%.
  const lifts=path.map(p=>Math.max(0,CLASS_LIFT_M[p.cls]));
  for(const direction of [1,-1]){
    for(let i=direction===1?1:path.length-2;i>=0&&i<path.length;i+=direction){
      const j=i-direction,distance=Math.hypot(path[i].x-path[j].x,path[i].z-path[j].z);
      lifts[i]=Math.min(lifts[i],lifts[j]+distance*.04);
    }
  }
  for(let i=0;i<path.length;i++)if(path[i].cls!=='tunnel')path[i].y=path[i].terrainY+BASE_LIFT+lifts[i]*VE;
  // Tunnel portal smoothing stays within tunnel samples. Above-ground samples
  // keep their bounded terrain-relative profiles and cannot be pulled under.
  for(let pass=0;pass<SMOOTH_PASSES;pass++)for(let i=1;i<path.length-1;i++){
    if(path[i].cls==='tunnel')path[i].y=(path[i-1].y+2*path[i].y+path[i+1].y)/4;
  }
  // s25:E: smoothing may only deepen the river crossing, never lift its bore
  // towards the bed.
  for(const p of path)if(p.underRiver)p.y=Math.min(p.y,p.bedY-THAMES_TUNNEL.centreBelowBedM*VE);
  return path;
}

// Left/right offset points perpendicular to the path at halfW, at yFn(p).
export function offsetRails(path, halfW, yFn) {
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

/**
 * A band across the stripe between two signed offsets (left positive, the
 * `left` side of offsetRails), over path[i0..i1] with normals taken from the
 * FULL path, so the band's edges coincide with the stripe drawn on that path.
 */
export function offsetBand(path, i0, i1, offA, offB, yFn) {
  const a = [], b = [];
  for (let i = i0; i <= i1; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(path.length - 1, i + 1)];
    let nx = -(p1.z - p0.z), nz = p1.x - p0.x;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    const p = path[i], y = yFn(p);
    a.push({ x: p.x + nx * offA, y, z: p.z + nz * offA });
    b.push({ x: p.x + nx * offB, y, z: p.z + nz * offB });
  }
  return { a, b };
}

/**
 * Which samples of a Tube or DLR corridor Lane R actually draws above ground
 * (sprint 30Sep26w integration). buildCorridor below, with the
 * skipTunnel option the Tube and DLR use, draws an open run only when it has
 * two or more samples: a non-tunnel sample is drawn when at least one of its
 * neighbours on the path is non-tunnel too. A lone 'surface' or 'cutting'
 * sample with tunnel on both sides (nine of them in the data: Aldgate,
 * Victoria, Great Portland Street, Gloucester Road, between Sloane Square and
 * South Kensington) is not drawn, so no car may stand on it. Returns a
 * Uint8Array, 1 where the sample is drawn open track.
 */
export function drawnOpenFlags(path) {
  const n = path?.length || 0, f = new Uint8Array(n);
  // s01:R: a sample flagged offMap (tube-surface-rail.js flagOffMap; s02:T: only where there is no ground) is not drawn either.
  const open = i => path[i].cls !== 'tunnel' && !path[i].offMap;
  for (let i = 0; i < n; i++) if (open(i) && ((i > 0 && open(i - 1)) || (i + 1 < n && open(i + 1)))) f[i] = 1;
  return f;
}

/**
 * Position + normal (and a baked colour), non-indexed: the attribute set every
 * strip geometry has (s01:R, moved here from tube-surface-rail.js). The
 * viaduct piers are indexed BoxGeometry with uv and the deck strips are not;
 * mergeGeometries refuses that mix and returns null, which silently dropped
 * the whole masonry mesh (deck and piers). Strips pass through unchanged (the
 * same object, no attribute touched), so normalising a list of strips changes
 * nothing in it.
 */
export function normaliseForMerge(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (out !== g) g.dispose();
  return out;
}

/** Half width of a viaduct deck (scene units = metres in XZ). */
export const DECK_HALF_W = BALLAST_HALF_W + 1.5;
/** Pier footprint (metres). */
export const PIER_SIDE_M = 5;

// pierShortRuns (s30:R fix round 2, the DLR; s01:R the Overground too): a
// viaduct run shorter than the pier spacing, which the spacing rule leaves
// without a pier, stands on one at its middle sample.
//
// structureClear (s01:R): (x, z) => false where no viaduct deck or pier may
// stand. The Overground and the open-air Tube pass "not in the Thames": where
// their viaducts cross the river, bridges.js already draws the railway bridge
// (Kew, Battersea, Fulham), so the deck and its piers stop at the bank and the
// stripe alone crosses on the bridge model. A deck sample is drawn only when
// its centre and both deck edges are clear; a pier only when its centre and
// its four corners are. Every other archetype (stripe, ballast, earth skirts,
// cutting bands) is built exactly as before.
export function buildCorridor(path, out, { skipTunnel = false, pierShortRuns = false, structureClear = null } = {}) {
  if (path.length < 2) return;

  // Split into runs of "kind" so tunnel sections drop the ballast bed and
  // viaduct/embankment/cutting get their dressing per run.
  // s01:R: with skipTunnel, a sample flagged offMap (tube-surface-rail.js
  // flagOffMap) is undrawn like a tunnel. s02:T: that is now only a sample with
  // no ground under it (nothing in today's data), not one beyond the map edge: the
  // track runs on to its terminus. The Overground never flags it, so its runs are as before.
  const kind = p => (skipTunnel && p.offMap ? 'offmap' : p.cls);
  const hidden = p => p.cls === 'tunnel' || p.offMap;
  let runStart = 0;
  for (let i = 1; i <= path.length; i++) {
    const boundary = i === path.length || kind(path[i]) !== kind(path[runStart]);
    if (!boundary) continue;
    const cls = path[runStart].cls, k = kind(path[runStart]);
    // skipTunnel (Tube, DLR): a tunnel run is drawn by the underground layer,
    // and the open runs either side do not overlap into it.
    const run = skipTunnel
      ? path.slice(Math.max(0, runStart - (runStart > 0 && hidden(path[runStart - 1]) ? 0 : 1)),
        i + (i < path.length && hidden(path[i]) ? 0 : 1))
      : path.slice(Math.max(0, runStart - 1), i + 1); // 1-pt overlap for continuity
    runStart = i;
    if (run.length < 2) continue;
    if (skipTunnel && (k === 'tunnel' || k === 'offmap')) continue;

    // Identity stripe always renders (it IS the line on the map).
    const stripe = offsetRails(run, STRIPE_HALF_W, (p) => p.y + STRIPE_LIFT);
    out.stripe.push(stripGeometry(stripe.left, stripe.right));
    if (cls === 'tunnel') continue;

    // Ballast/deck bed.
    const bed = offsetRails(run, cls === 'viaduct' ? DECK_HALF_W : BALLAST_HALF_W, (p) => p.y);
    if (cls === 'viaduct' && structureClear) {
      // s01:R: the deck only over samples whose centre and edges are clear,
      // in stretches of two samples or more (the rails of the whole run, so a
      // stretch's edges are those the full deck would have had).
      const clear = run.map((p, j) => structureClear(p.x, p.z) && structureClear(bed.left[j].x, bed.left[j].z) && structureClear(bed.right[j].x, bed.right[j].z));
      for (let a = 0; a < run.length;) {
        if (!clear[a]) { a++; continue; }
        let b = a; while (b + 1 < run.length && clear[b + 1]) b++;
        if (b > a) out.masonry.push(stripGeometry(bed.left.slice(a, b + 1), bed.right.slice(a, b + 1)));
        a = b + 1;
      }
    } else {
      out[cls === 'viaduct' ? 'masonry' : 'ballast'].push(stripGeometry(bed.left, bed.right));
    }

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
      // At-grade trench treatment: two dark bands flanking the ballast, read as
      // the shaded walls of a cutting. Tone, not relief — at a 90m camera a 0.6m
      // step is invisible while a 6m dark band is not, and everything stays
      // ABOVE the terrain so nothing can occlude it. Replaces the old sunk bed +
      // vertical wall strips, which were buried inside the terrain mesh.
      const inner = offsetRails(run, BALLAST_HALF_W, (p) => p.y - CUT_SHADOW_DROP);
      const outer = offsetRails(run, BALLAST_HALF_W + CUT_SHADOW_W, (p) => p.y - CUT_SHADOW_DROP);
      out.cutShadow.push(stripGeometry(outer.left, inner.left));
      out.cutShadow.push(stripGeometry(inner.right, outer.right));
    } else if (cls === 'viaduct') {
      // Piers every PIER_SPACING_M down to terrain.
      let acc = 0, piers = 0;
      const half = PIER_SIDE_M / 2;
      const pierClear = (p) => !structureClear || [[0, 0], [-half, -half], [half, -half], [-half, half], [half, half]].every(([dx, dz]) => structureClear(p.x + dx, p.z + dz));
      const pierAt = (p) => {
        if (!pierClear(p)) return;
        const h = Math.max(2, p.y - p.terrainY);
        const pier = new THREE.BoxGeometry(PIER_SIDE_M, h, PIER_SIDE_M);
        pier.translate(p.x, p.terrainY + h / 2, p.z);
        out.masonry.push(pier);
        piers++;
      };
      for (let j = 1; j < run.length; j++) {
        acc += Math.hypot(run[j].x - run[j - 1].x, run[j].z - run[j - 1].z);
        if (acc < PIER_SPACING_M) continue;
        acc = 0;
        pierAt(run[j]);
      }
      if (pierShortRuns && !piers && run.length >= 3) pierAt(run[Math.floor(run.length / 2)]);
    }
  }
}

// Preserve TfL stop coordinates. Nearby rail supplies vertical placement only;
// incomplete corridor endpoints must never drag a stop hundreds of metres away.
export function stationOnRail(station, paths, getSurfaceY, projectStation, network = 'overground') {
  const source = projectStation(station.lat, station.lon);
  let best = null, distanceSq = Infinity;
  for (const path of paths) for (let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z;
    const t=THREE.MathUtils.clamp(((source.x-a.x)*dx+(source.z-a.z)*dz)/(dx*dx+dz*dz || 1),0,1);
    const x=a.x+t*dx,z=a.z+t*dz,d=(source.x-x)**2+(source.z-z)**2;
    if(d<distanceSq){distanceSq=d;best=new THREE.Vector3(x,a.y+t*(b.y-a.y)+STRIPE_LIFT+3,z);}
  }
  if(!best)return null;
  const groundY=getSurfaceY(source),nearRail=distanceSq<=100*100;
  const pos=new THREE.Vector3(source.x,nearRail?Math.max(best.y,groundY+3):groundY+BASE_LIFT+3,source.z);
  return {id:station.naptan,name:station.name,pos,surfaceY:pos.y,
    sourcePosition:source,railOffsetM:Math.sqrt(distanceSq),network,lineCount:1};
}

/**
 * The true-proportion morph (D-039) shared by every surface-rail mesh: a
 * vertex above the terrain under it keeps its terrain base and scales its lift
 * by `ratio` (the structure height factor, 1 / Master for VE5-authored
 * geometry); a vertex below the terrain (a tunnel) is left where it is.
 */
export function createRailMorph(getTerrainMeshSurfaceY) {
  const morphs = [];
  return {
    morphs,
    add(mesh) {
      const p = mesh.geometry.attributes.position, original = p.array.slice(), bases = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) bases[i] = getTerrainMeshSurfaceY({ x: p.getX(i), z: p.getZ(i) });
      const m = { mesh, original, bases };
      morphs.push(m);
      return m;
    },
    remove(mesh) { const i = morphs.findIndex(m => m.mesh === mesh); if (i >= 0) morphs.splice(i, 1); },
    apply(ratio) {
      for (const { mesh, original, bases } of morphs) {
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, original[i * 3 + 1] < bases[i] ? original[i * 3 + 1] : bases[i] + (original[i * 3 + 1] - bases[i]) * ratio);
        p.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere();
      }
    },
  };
}
