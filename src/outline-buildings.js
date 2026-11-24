// Opt-in, once-resident real footprints. Nothing in this module is imported
// until an explicit ?outlines=a|b has landed. No runtime triangulation.
import * as THREE from 'three';
import { getBuildingHeightScale, getBuildingMaterial } from './surface-geometry.js';
import { injectBuildingWindows } from './night.js';
import { riseUniforms } from './opening-rise.js';
import { pointInRing } from './station-building-geometry.js';
import { createOutlineSolidLayer, visitOutlineSolidLayer } from './modes/solids.js';

export function parseOutlineDirectory(buffer) {
  const v=new DataView(buffer);
  if(v.byteLength<16||v.getUint32(0,true)!==0x314f4755||v.getUint32(4,true)!==1)throw new Error('bad UGO1 payload');
  const n=v.getUint32(8,true),count=v.getUint32(12,true),chunks=[];
  if(16+n*8>v.byteLength)throw new Error('truncated outline directory');
  let end=16+n*8;
  for(let i=0;i<n;i++){const o=v.getUint32(16+i*8,true),length=v.getUint32(20+i*8,true);if(o!==end||length%4||o+length>v.byteLength)throw new Error('corrupt outline chunk');chunks.push({offset:o,length});end=o+length;}
  if(end!==v.byteLength)throw new Error('trailing outline bytes');
  return {buffer,chunks,count};
}

function patch(material,night=false) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.uHeightScale={get value(){return getBuildingHeightScale();}};
    Object.assign(shader.uniforms,riseUniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
uniform float uHeightScale;
uniform float uRiseFront, uRiseBand, uRiseDepth;
uniform vec2 uRiseOrigin;
attribute vec4 aBuilding;
attribute float aAcross;
varying vec3 vOutlinePosition;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
transformed.y = aBuilding.x + (position.y-aBuilding.x)*uHeightScale;
float outlineRise = smoothstep(0.0,1.0,(uRiseFront-distance(aBuilding.yz,uRiseOrigin))/uRiseBand);
transformed.y -= (1.0-outlineRise)*uRiseDepth;
vOutlinePosition=position;`);
    if(night){
      injectBuildingWindows(shader);
      // Keep the shared window fragment term, substituting the merged mesh's
      // true wall coordinates and source-centre hash for instance attributes.
      shader.vertexShader=shader.vertexShader.replace('float nAcross = mix( position.z * nInst.z, position.x * nInst.x, nAcrossX );','float nAcross = aAcross;')
        .replace('position.y * nInst.y * uHeightScale','(position.y-aBuilding.x)*uHeightScale')
        .replace('floor( nT.xz * 0.5 )','floor( aBuilding.yz * 0.5 )')
        .replace('sign( normal.x ) + 2.0 * sign( normal.z ) + 4.0 * nAcrossX','0.0')
        .replace('nInst.y * uHeightScale','aBuilding.w * uHeightScale');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vOutlinePosition;')
        .replace('vNW.z > 0.5','abs(normalize(cross(dFdx(vOutlinePosition), dFdy(vOutlinePosition))).y) < 0.5');
    }
  };
  material.customProgramCacheKey=()=>`outlines-v1-${night?'night':'day'}-${material.type}`;
  return material;
}

export function createOutlineMaterials() {
  // The roof is a single surface. Its front must cast into the shadow map;
  // the default PCF front-face cull assumes a closed box with a bottom cap.
  const make=()=>{const m=new THREE.MeshStandardMaterial({color:0x8a8580,roughness:.85,metalness:.1,flatShading:true});m.shadowSide=THREE.DoubleSide;return m;};
  return {day:patch(make()),night:patch(make(),true),depth:patch(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}))};
}

export function* decodeOutlineChunkSteps(payload,index,VE=5,batchSize=32) {
  const {offset,length}=payload.chunks[index],v=new DataView(payload.buffer,offset,length);
  const nb=v.getUint32(0,true),nv=v.getUint32(4,true),ni=v.getUint32(8,true),vertexOffset=12+nb*48;
  if(((vertexOffset+nv*32+ni*2+3)&~3)!==length)throw new Error('corrupt outline geometry');
  const data=new Float32Array(payload.buffer,offset+vertexOffset,nv*8),records=[];let prepared=0;
  for(let i=0;i<nb;i++){
    const o=12+i*48,r={x:v.getFloat32(o,true),z:v.getFloat32(o+4,true),rectX:v.getFloat32(o+8,true),rectZ:v.getFloat32(o+12,true),
      height:v.getFloat32(o+16,true)*VE,base:v.getFloat32(o+20,true)*VE,n:v.getUint32(o+24,true),start:v.getUint32(o+28,true),first:v.getUint32(o+32,true),indices:v.getUint32(o+36,true),tile:v.getUint32(o+40,true),ordinal:v.getUint32(o+44,true)};
    if(r.start+2*(r.n+1)>nv||r.first+r.indices>ni)throw new Error('corrupt outline identity');
    r.ring=[];r.minX=Infinity;r.maxX=-Infinity;r.minZ=Infinity;r.maxZ=-Infinity;
    for(let j=0;j<r.n;j++){const p=(r.start+j*2)*8,x=data[p],z=data[p+2];r.ring.push([x,z]);r.minX=Math.min(r.minX,x);r.maxX=Math.max(r.maxX,x);r.minZ=Math.min(r.minZ,z);r.maxZ=Math.max(r.maxZ,z);if(++prepared%batchSize===0)yield;}
    for(let j=0;j<2*(r.n+1);j++){const p=(r.start+j)*8;data[p+1]=r.base+(j%2?r.height:0);data[p+3]=r.base;data[p+6]=r.height;if(++prepared%batchSize===0)yield;}
    // Solids use negative x/z winding for the outward wall normal.
    r.ring.reverse();r.h=r.height;r.skirt=0;r.key=`outline:${r.tile}:${r.ordinal}`;r.oriented=false;
    records.push(r);
  }
  const geometry=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(data,8);
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
  geometry.setAttribute('aBuilding',new THREE.InterleavedBufferAttribute(interleaved,4,3));
  geometry.setAttribute('aAcross',new THREE.InterleavedBufferAttribute(interleaved,1,7));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(payload.buffer,offset+vertexOffset+nv*32,ni),1));
  return {geometry,records};
}

// Synchronous facade for direct callers; the loader consumes bounded steps.
export function decodeOutlineChunk(payload,index,VE=5) {
  const steps=decodeOutlineChunkSteps(payload,index,VE);let next;
  do{next=steps.next();}while(!next.done);
  return next.value;
}

// Compact the existing tile's drawn instances once, preserving its allocation
// and default-path construction. No off-path identity buffer is needed.
export function* planOutlineBoxes(records,meshes,batchSize=8) {
  const plan={items:[],matched:new Set(),placements:new Map(),keptFoundations:new Set(),hidden:0};
  const byTile=new Map();let prepared=0;
  // Index construction is loading work too, not just the subsequent box scan.
  for(const r of records){if(!byTile.has(r.tile))byTile.set(r.tile,[]);byTile.get(r.tile).push(r);if(++prepared%batchSize===0)yield;}
  for(const mesh of meshes){
    const a=mesh.instanceMatrix.array,box=mesh.boundingBox,foundation=mesh.geometry.attributes.reservoirBase;
    const tile=Number(mesh.name?.replace('baked-buildings-',''));
    const near=Number.isFinite(tile)?byTile.get(tile):records.filter(r=>!box||(r.x>=box.min.x-1000&&r.x<=box.max.x+1000&&r.z>=box.min.z-1000&&r.z<=box.max.z+1000));
    if(!near?.length)continue;
    let placed=0,run=0;
    const runs=[],matched=[];
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
    for(const r of near)for(const [x,z]of [[r.x,r.z],[r.rectX,r.rectZ]]){
      x0=Math.min(x0,Math.floor(x-.12));x1=Math.max(x1,Math.floor(x+.12));
      z0=Math.min(z0,Math.floor(z-.12));z1=Math.max(z1,Math.floor(z+.12));
      if(++prepared%batchSize===0)yield;
    }
    // Tile-local integer keys avoid a new string for every scanned box. The
    // explicit bounds make the keys unique and keep this bake's keys small.
    const stride=z1-z0+1,cellKey=(x,z)=>(x-x0)*stride+z-z0;
    const lookup=new Map();
    for(const r of near)for(const [x,z]of [[r.x,r.z],[r.rectX,r.rectZ]])for(let ix=Math.floor(x-.12);ix<=Math.floor(x+.12);ix++)for(let iz=Math.floor(z-.12);iz<=Math.floor(z+.12);iz++){
      const key=cellKey(ix,iz);if(!lookup.has(key))lookup.set(key,[]);lookup.get(key).push(r);
      if(++prepared%batchSize===0)yield;
    }
    const keepRun=end=>{const n=end-run;if(n&&placed!==run)runs.push({from:run,to:end,dest:placed});placed+=n;};
    for(let i=0;i<mesh.count;i++){
      const o=i*16,x=a[o+12],z=a[o+14],h=a[o+5];
      const ix=Math.floor(x),iz=Math.floor(z);
      const r=ix>=x0&&ix<=x1&&iz>=z0&&iz<=z1?lookup.get(cellKey(ix,iz))?.find(r=>!r.matched&&!plan.matched.has(r)&&!plan.keptFoundations.has(r)&&Math.abs(h-r.height)<.12&&((Math.abs(x-r.x)<.12&&Math.abs(z-r.z)<.12)||(Math.abs(x-r.rectX)<.12&&Math.abs(z-r.rectZ)<.12))):null;
      if(r){
        // Preserve the few boxes whose independently fitted bank foundations
        // have extra faces. Removing only their instance would leave those
        // rectangular faces behind. The optional trial reports this exception.
        const fitted=foundation&&[0,1,2,3].some(k=>Math.abs(foundation.array[i*4+k]*h)>.01);
        if(fitted)plan.keptFoundations.add(r);
        else {keepRun(i);run=i+1;matched.push(r);plan.matched.add(r);plan.placements.set(r,{base:a[o+13],height:h});plan.hidden++;}
      }
      if((i+1)%batchSize===0)yield;
    }
    keepRun(mesh.count);
    if(placed!==mesh.count)plan.items.push({mesh,count:mesh.count,placed,runs,matched});
  }
  return plan;
}

// The displayed box datum includes legacy DEM corrections, late banks and
// any upstream bake version. Inherit that final state rather than estimating
// it from raw payload bases a second time.
export function* applyOutlinePlacementsSteps(geometry,records,placements,batchSize=32) {
  const data=geometry.attributes.position.data.array;let prepared=0;
  for(const r of records){const p=placements.get(r);if(!p)continue;r.base=p.base;r.height=r.h=p.height;
    for(let j=0;j<2*(r.n+1);j++){const o=(r.start+j)*8;data[o+1]=r.base+(j%2?r.height:0);data[o+3]=r.base;data[o+6]=r.height;
      if(++prepared%batchSize===0)yield;
    }
  }
  // Native bounding scans are linear too. Keep both passes in the same
  // bounded work stream as the datum updates, including a very large ring.
  const box=new THREE.Box3(),point=new THREE.Vector3();
  for(let o=0;o<data.length;o+=8){point.set(data[o],data[o+1],data[o+2]);box.expandByPoint(point);if(++prepared%batchSize===0)yield;}
  const sphere=new THREE.Sphere();box.getCenter(sphere.center);let radiusSq=0;
  for(let o=0;o<data.length;o+=8){point.set(data[o],data[o+1],data[o+2]);radiusSq=Math.max(radiusSq,point.distanceToSquared(sphere.center));if(++prepared%batchSize===0)yield;}
  sphere.radius=Math.sqrt(radiusSq);geometry.boundingBox=box;geometry.boundingSphere=sphere;
}

export function applyOutlinePlacements(geometry,records,placements) {
  const steps=applyOutlinePlacementsSteps(geometry,records,placements);while(!steps.next().done){}
}

export function commitOutlineBoxes(plan,invalidate=()=>{}) {
  for(const p of plan.items)if(p.mesh.count!==p.count)throw new Error('building instances changed during outline planning');
  for(const {mesh,placed,runs,matched}of plan.items){
    const a=mesh.instanceMatrix.array,extra=mesh.geometry.attributes.reservoirBase;
    for(const r of runs){a.copyWithin(r.dest*16,r.from*16,r.to*16);if(extra)extra.array.copyWithin(r.dest*4,r.from*4,r.to*4);}
    for(const r of matched)r.matched=true;
    mesh.count=placed;mesh.instanceMatrix.needsUpdate=true;if(extra)extra.needsUpdate=true;invalidate(mesh);
  }
  return plan.hidden;
}

// Synchronous facade for callers/tests that do not need the incremental loader.
export function replaceOutlineBoxes(records,meshes,invalidate=()=>{}) {
  const steps=planOutlineBoxes(records,meshes);let next;
  do{next=steps.next();}while(!next.done);
  return commitOutlineBoxes(next.value,invalidate);
}

// Keep diagnostic storage bounded on the phone. All maxima and complete
// loader-task durations remain recorded even after a slice sample is evicted.
export function recordOutlineSlice(stats,ms,stage) {
  const cap=2048;
  stats.sliceCount=(stats.sliceCount??0)+1;
  if(stats.slices.length<cap)stats.slices.push(ms);
  else stats.slices[(stats.sliceCount-1)%cap]=ms;
  stats.sliceSamplesOmitted=Math.max(0,stats.sliceCount-cap);
  stats.maxSliceMs=Math.max(stats.maxSliceMs,ms);
  stats.stageMax[stage]=Math.max(stats.stageMax[stage]||0,ms);
}

export function createOutlineBuildings({set,scene,getMeshes,isReady,compile=async()=>{},upload=()=>{},invalidate,getHidden=()=>false,VE=5}) {
  const group=new THREE.Group();group.name='outline-buildings';group.userData.solidRecords=[];group.userData.version=0;
  const stats={set,state:'waiting',count:0,hidden:0,foundationBoxes:0,chunks:0,uploads:0,pipelineUploads:0,maxSliceMs:0,maxTaskMs:0,stageMax:{},slices:[],tasks:[],errors:[]};
  const layers=[];
  let started=false,materials=null,lastMaterial=null;
  const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
  const timed=(fn,stage='other')=>{const t=performance.now(),r=fn();recordOutlineSlice(stats,performance.now()-t,stage);return r;};
  let taskStart=0;
  function closeTask(){if(!taskStart)return;const ms=performance.now()-taskStart;stats.tasks.push(ms);stats.maxTaskMs=Math.max(stats.maxTaskMs,ms);taskStart=0;}
  async function checkpoint(force=false){if(force||performance.now()-taskStart>.75){closeTask();await yieldTask();taskStart=performance.now();}}
  async function load(){
    stats.state='fetching';
    const response=await fetch(`/data/surface/baked/outlines-${set}.z.bin`);
    if(!response.ok||(response.headers.get('content-type')||'').includes('text/html'))throw new Error('outline payload missing');
    const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    taskStart=performance.now(); // include directory/material/tile-map setup in the loading task bound
    const payload=parseOutlineDirectory(buffer);stats.selected=payload.count;
    materials=createOutlineMaterials();stats.state='building';scene.add(group);
    const tileMeshes=new Map();
    for(const mesh of getMeshes()){const tile=Number(mesh.name?.replace('baked-buildings-',''));if(Number.isFinite(tile))tileMeshes.set(tile,mesh);}
    for(let i=0;i<payload.chunks.length;i++){
      await checkpoint(true);
      const decoder=decodeOutlineChunkSteps(payload,i,VE),decodeNext=()=>decoder.next();let decoded;
      do{decoded=timed(decodeNext,'decode');if(!decoded.done&&performance.now()-taskStart>.75)await checkpoint();}while(!decoded.done);
      const {geometry,records}=decoded.value;
      // Suppressed station/edge boxes have no matching instance, so their
      // corresponding outline triangles are omitted too.
      await checkpoint();
      const target=tileMeshes.get(records[0]?.tile),planner=planOutlineBoxes(records,target?[target]:[]),planNext=()=>planner.next();
      let next;
      do{next=timed(planNext,'plan');if(!next.done&&performance.now()-taskStart>.75)await checkpoint();}while(!next.done);
      const plan=next.value,active=records.filter(r=>plan.matched.has(r)&&!getHidden(r));
      await checkpoint(true);
      const placer=applyOutlinePlacementsSteps(geometry,records,plan.placements),placeNext=()=>placer.next();let placed;
      do{placed=timed(placeNext,'placement');if(!placed.done&&performance.now()-taskStart>.75)await checkpoint();}while(!placed.done);
      await checkpoint();const solidLayer=timed(()=>createOutlineSolidLayer(active),'solid');
      const drawn=new Set(active);
      const index=geometry.index.array;
      for(const r of records)if(!drawn.has(r))index.fill(0,r.first,r.first+r.indices);
      const mesh=new THREE.Mesh(geometry,getBuildingMaterial().name==='night-buildings'?materials.night:materials.day);
      mesh.name=`outline-buildings-${i}`;mesh.customDepthMaterial=materials.depth;mesh.castShadow=true;mesh.receiveShadow=true;
      mesh.userData.outlineRecords=active;mesh.userData.outlineMaterial=true;mesh.userData.outlineDepth=materials.depth;
      // Ordinary mesh raycasting would intersect the unscaled canonical roof.
      // Use the displayed prisms, and preserve the identity in each hit.
      mesh.raycast=(raycaster,hits)=>{for(const r of active){const t=rayPrism(r,raycaster.ray,getBuildingHeightScale());if(t!=null&&t>=raycaster.near&&t<=raycaster.far)hits.push({distance:t,point:raycaster.ray.at(t,new THREE.Vector3()),object:mesh,building:r,faceIndex:r.first/3});}};
      if(i===0)for(const material of [materials.day,materials.night,materials.depth]){
        await checkpoint(true);const original=mesh.material;mesh.material=material;
        const compilation=timed(()=>compile(mesh),'compile');closeTask();await compilation;taskStart=performance.now();await checkpoint(true);
        timed(()=>upload(mesh,material),'upload');stats.pipelineUploads++;mesh.material=original;
      }
      await checkpoint();timed(()=>upload(mesh,mesh.material),'upload');
      await checkpoint(true);
      timed(()=>{mesh.material=getBuildingMaterial().name==='night-buildings'?materials.night:materials.day;stats.hidden+=commitOutlineBoxes(plan,invalidate);stats.foundationBoxes+=plan.keptFoundations.size;group.add(mesh);layers.push(solidLayer);group.userData.solidRecords.push(...active);group.userData.version++;stats.count+=active.length;stats.chunks++;stats.uploads++;},'commit');
    }
    closeTask();
    stats.state='ready';
  }
  return {group,stats,layers,materials:()=>materials,
    occludes(ox,oy,oz,dx,dy,dz,t,scale){
      if(!group.visible)return false;
      const ray={origin:{x:ox,y:oy,z:oz},direction:{x:dx,y:dy,z:dz}};
      const ex=ox+dx*t,ez=oz+dz*t;let blocked=false;
      for(const layer of layers){visitOutlineSolidLayer(layer,Math.min(ox,ex),Math.max(ox,ex),Math.min(oz,ez),Math.max(oz,ez),r=>{
        if(ox>=r.minX&&ox<=r.maxX&&oz>=r.minZ&&oz<=r.maxZ&&pointInRing(ox,oz,r.ring))return false;
        const hit=rayPrism(r,ray,scale);if(hit!=null&&hit<t-.75){blocked=true;return true;}return false;
      });if(blocked)return true;}return false;
    },
    update(){if(!started&&isReady()){started=true;load().catch(e=>{stats.state='failed';stats.errors.push(e.message);console.error('[outlines]',e);});}
      if(materials){const mat=getBuildingMaterial().name==='night-buildings'?materials.night:materials.day;if(mat!==lastMaterial){for(const mesh of group.children)mesh.material=mat;lastMaterial=mat;}}},
    buildingAtFace(mesh,face){return mesh.userData.outlineRecords?.find(r=>face*3>=r.first&&face*3<r.first+r.indices)||null;},
  };
}

export function rayPrism(r,ray,scale) {
  const {origin:o,direction:d}=ray,roof=r.base+r.h*scale;let best=Infinity;
  if(Math.abs(d.y)>1e-12)for(const y of [r.base,roof]){const t=(y-o.y)/d.y;if(t>=0&&pointInRing(o.x+d.x*t,o.z+d.z*t,r.ring))best=Math.min(best,t);}
  for(let i=0;i<r.ring.length;i++){
    const a=r.ring[i],b=r.ring[(i+1)%r.ring.length],ex=b[0]-a[0],ez=b[1]-a[1],det=d.x*ez-d.z*ex;
    if(Math.abs(det)<1e-12)continue;
    const ax=a[0]-o.x,az=a[1]-o.z,t=(ax*ez-az*ex)/det,u=(ax*d.z-az*d.x)/det,y=o.y+d.y*t;
    if(t>=0&&u>=0&&u<=1&&y>=r.base&&y<=roof)best=Math.min(best,t);
  }
  return Number.isFinite(best)?best:null;
}
