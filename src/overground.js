import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import { createOvergroundFleet } from './overground-trains.js';
// London Overground surface rail — D-019 earthworks archetype language.
//
// Renders public/data/overground.json (Prog 11Jul26s delivery, wA v2 restitch
// + twin-track pair-collapse) as TRUE AT-GRADE rail: the track follows the
// terrain mesh and each OSM earthworks class gets its own archetype:
//   surface    — ballast ribbon + line-colour stripe on the ground
//   embankment — ribbon raised ~3m with earth-tone skirt strips
//   viaduct    — masonry deck raised ~8m on piers
//   cutting    — ballast at grade, flanked by dark shadow bands (06Sep26u:
//                was sunk 3m between wall strips, which put it inside the
//                un-carved terrain mesh and made it invisible)
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
import { VERTICAL_EXAGGERATION, getTerrainMeshSurfaceY as renderedFloorY } from './terrain.js';
import { RENDER_ORDER } from './render-layers.js';
// s25:E Thames Tunnel depth (sourced; see rail-truth.js)
import { WATER_LEVEL_M } from './thames.js';
import { isInThames } from './thames-mask.js';
import { THAMES_TUNNEL } from './rail-truth.js';

const VE = VERTICAL_EXAGGERATION;



// Registered in main.js too — defs() is idempotent, keep this module portable.
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

// ── Archetype constants (scene units; Y lifts are real metres × VE) ──────
const BALLAST_HALF_W = 9;          // 18m ballast bed (visual presence at altitude)
const STRIPE_HALF_W = 4.5;         // line-colour identity stripe
const BASE_LIFT = 5;               // ~1m real: rail head above surrounding ground.
                                   // Was 2 (0.4m), which left 9.3% of the network
                                   // "grazing" — flickering in and out of the terrain
                                   // mesh between rail points (06Sep26u census).
const STRIPE_LIFT = 0.8;           // stripe above its ballast
const CUT_SHADOW_W = 6;            // flanking dark band per side (real metres = scene units in XZ)
const CUT_SHADOW_DROP = 1.2;       // band sits just under the ballast lip, still above terrain
const CLASS_LIFT_M = {             // real metres relative to terrain
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
const PIER_SPACING_M = 110;
const SMOOTH_PASSES = 3;           // moving-average passes over track Y

const MATS = {
  ballast: new THREE.MeshStandardMaterial({ color: 0x4c4741, roughness: 0.9, metalness: 0.05, fog: true, side: THREE.DoubleSide }),
  earth: new THREE.MeshStandardMaterial({ color: 0x5d5142, roughness: 0.95, metalness: 0.0, fog: true, side: THREE.DoubleSide }),
  masonry: new THREE.MeshStandardMaterial({ color: 0x8d8778, roughness: 0.8, metalness: 0.08, fog: true, side: THREE.DoubleSide }),
  // Cutting treatment: the shaded flank of a trench, read as tone from altitude.
  cutShadow: new THREE.MeshStandardMaterial({ color: 0x272320, roughness: 1.0, metalness: 0.0, fog: true, side: THREE.DoubleSide }),
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

// s25:E (see buildPath). Source segment i joins pts[i] to pts[i+1].
function closeRiverTunnelSlivers(pts, classes) {
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

// Per-corridor path in scene space with per-point earthworks class + track Y.
function buildPath(branch, getTerrainMeshSurfaceY) {
  const pts = branch.points;
  const classes = new Array(pts.length).fill('surface');
  for (const seg of branch.segments || []) {
    for (let i = seg.i0; i < Math.min(seg.i1, pts.length); i++) classes[i] = seg.class;
  }
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
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/12));
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
      path.push({x,z,terrainY,cls,underRiver,bedY,y:underRiver?bedY-THAMES_TUNNEL.centreBelowBedM*VE:terrainY+BASE_LIFT+CLASS_LIFT_M[cls]*VE});
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

// Preserve TfL stop coordinates. Nearby rail supplies vertical placement only;
// incomplete corridor endpoints must never drag a stop hundreds of metres away.
function stationOnRail(station, paths, getSurfaceY, projectStation) {
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
    sourcePosition:source,railOffsetM:Math.sqrt(distanceSq),network:'overground',lineCount:1};
}

export async function createOverground({ getTerrainMeshSurfaceY, projectStation, heightScale = 1 }) {
  const res = await fetch('/data/overground.json');
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    throw new Error('overground.json unavailable');
  }
  const data = await res.json();

  const group = new THREE.Group();
  group.name = 'overground';
  const fleets = [],allPaths=[],morphs=[];
  let multiplier=VE;
  const registry = new Map();
  const stationSets = [];

  for (const line of data.lines || []) {
    const lineGroup = new THREE.Group();
    lineGroup.name = `overground-${line.id}`;
    // Keep the six identities while placing the corridors into the muted city
    // palette. A small residual glow preserves underground route legibility.
    const colour = new THREE.Color(line.colour || '#EE7C0E');
    const neutral = new THREE.Color(0x85827a);
    colour.lerp(neutral, 0.32).multiplyScalar(0.82);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.55, metalness: 0.1,
      emissive: colour, emissiveIntensity: 0.07, fog: true, side: THREE.DoubleSide,
    });
    const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
    const paths = [];
    for (const branch of line.branches || []) {
      const path = buildPath(branch, getTerrainMeshSurfaceY);
      if (path.length < 2) continue;
      paths.push(path);allPaths.push(path);
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
      const p=merged.attributes.position,original=p.array.slice(),bases=new Float32Array(p.count);
      for(let i=0;i<p.count;i++)bases[i]=getTerrainMeshSurfaceY({x:p.getX(i),z:p.getZ(i)});
      morphs.push({mesh,original,bases});
    };
    addMerged(out.stripe, stripeMat);
    addMerged(out.ballast, MATS.ballast);
    addMerged(out.masonry, MATS.masonry);
    addMerged(out.earth, MATS.earth);
    addMerged(out.cutShadow, MATS.cutShadow);

    for(const path of paths)for(const p of path)p.liftM=(p.y-p.terrainY)/VE;
    const fleet=createOvergroundFleet(paths,line.colour,line.id);lineGroup.add(fleet);fleets.push(fleet);
    const stations=(line.stations || []).map(s=>stationOnRail(s,paths,getTerrainMeshSurfaceY,projectStation)).filter(Boolean);
    // The source list is unordered and interchange entries may be empty.
    for(const station of stations) {
      station.lineId=line.id;
      station.isTerminus=false; // corridor fragments do not prove service termini
      station.lineCount=Math.max(1,new Set((line.stations.find(s=>s.naptan===station.id)?.interchange || []).filter(Boolean)).size);
    }
    stationSets.push({id:line.id,colour:line.colour,stations});
    registry.set(line.id, {
      name: line.name,
      colour: line.colour,
      corridors: paths.length,
      points: paths.reduce((s, p) => s + p.length, 0),
      trains: fleet.userData.trains.length,
    });
    group.add(lineGroup);
  }

  group.userData.registry = registry;
  group.userData.stationSets = stationSets;
  group.userData.fleets=fleets;
  group.userData.paths=allPaths;
  group.userData.setHeightScale=(ratio)=>{
    multiplier=VE*ratio;
    for(const path of allPaths)for(const p of path)p.y=p.terrainY+p.liftM*(p.liftM<0?VE:multiplier);
    for(const {mesh,original,bases} of morphs){
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++)p.setY(i,original[i*3+1]<bases[i]?original[i*3+1]:bases[i]+(original[i*3+1]-bases[i])*ratio);
      p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
    }
    for(const set of stationSets)for(const station of set.stations){
      station.pos.y=station.groundY+station.liftM*multiplier;station.surfaceY=station.pos.y;
    }
    for(const fleet of fleets)fleet.userData.update(0,null,multiplier);
  };
  for(const set of stationSets)for(const station of set.stations){
    station.groundY=getTerrainMeshSurfaceY(station.pos);station.liftM=(station.pos.y-station.groundY)/VE;
  }
  group.userData.update=(dt,camera)=>{for(const fleet of fleets)fleet.userData.update(dt,camera,multiplier);};
  // ── s24:R ── fleet economies (compact live cars, live-range upload, hidden skip)
  group.userData.setEconomies=next=>{for(const fleet of fleets)fleet.userData.setEconomies(next);};
  // ── /s24:R ──
  group.userData.setHeightScale(heightScale);
  return group;
}
