import { createOvergroundFleet } from './overground-trains.js';
// London Overground surface rail — D-019 earthworks archetype language.
//
// Renders public/data/overground.json (Prog 11Jul26s delivery, wA v2 restitch
// + twin-track pair-collapse) as TRUE AT-GRADE rail: the track follows the
// terrain mesh and each OSM earthworks class gets its own archetype (surface,
// embankment, viaduct, cutting at grade, tunnel; see surface-rail.js).
//
// s30:R (sprint 30Sep26w, D-041): the archetype language, constants and
// geometry builders moved to surface-rail.js unchanged, shared with the
// open-air Tube and DLR (tube-surface-rail.js). This file builds exactly what
// it built before (tests/surface-rail.spec.js proves the pixels unchanged);
// the only additions are data a caller can read: each merged mesh's
// userData.part and group.userData.linePaths, which the Tube's shared-track
// bands on Overground corridors are laid along.
//
// Geometry is merged per material per line (BufferGeometryUtils) — ~5k input
// points build a handful of draw calls per line. All opaque, fog: true,
// SURFACE_BRIDGE render tier (depth testing resolves visibility).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { RENDER_ORDER } from './render-layers.js';
import { MATS, buildPath, buildCorridor, stationOnRail, createStripeMaterial } from './surface-rail.js';

const VE = VERTICAL_EXAGGERATION;

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
  const linePaths = new Map(); // s30:R: lineId -> built paths by branch index

  for (const line of data.lines || []) {
    const lineGroup = new THREE.Group();
    lineGroup.name = `overground-${line.id}`;
    // Keep the six identities while placing the corridors into the muted city
    // palette (surface-rail.js stripeColour).
    const stripeMat = createStripeMaterial(line.colour, '#EE7C0E');
    const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
    const paths = [];
    const byBranch = []; // s30:R: branch index -> built path (null if too short)
    for (const branch of line.branches || []) {
      const path = buildPath(branch, getTerrainMeshSurfaceY);
      if (path.length < 2) { byBranch.push(null); continue; }
      byBranch.push(path);
      paths.push(path);allPaths.push(path);
      buildCorridor(path, out);
    }
    linePaths.set(line.id, byBranch);
    const addMerged = (geos, mat, part) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;
      mesh.userData = { type: 'overground-line', lineId: line.id, name: `${line.name} line (Overground)`, part };
      lineGroup.add(mesh);
      const p=merged.attributes.position,original=p.array.slice(),bases=new Float32Array(p.count);
      for(let i=0;i<p.count;i++)bases[i]=getTerrainMeshSurfaceY({x:p.getX(i),z:p.getZ(i)});
      morphs.push({mesh,original,bases});
    };
    addMerged(out.stripe, stripeMat, 'stripe');
    addMerged(out.ballast, MATS.ballast, 'ballast');
    addMerged(out.masonry, MATS.masonry, 'masonry');
    addMerged(out.earth, MATS.earth, 'earth');
    addMerged(out.cutShadow, MATS.cutShadow, 'cutShadow');

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
  group.userData.linePaths=linePaths; // s30:R
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
