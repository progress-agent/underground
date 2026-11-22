import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseBakedBuildings,buildBakedTile,createBakedBuildingBuilder } from '../src/baked-buildings.js';
import { encodeBuildingArea,encodeBuildingAspect } from '../src/building-record.js';
import { createCollisionService } from '../src/modes/collision.js';
import { rayBlockedByBoxes } from '../src/station-buildings.js';
import { injectBuildingWindows } from '../src/night.js';
import { anchorReservoirBuildings } from '../src/reservoir-buildings.js';
function payload(){
 const b=new ArrayBuffer(12+16+14),v=new DataView(b);v.setUint32(0,0x32424755,true);v.setUint16(4,2,true);v.setUint16(6,1,true);v.setUint32(8,1,true);v.setUint32(20,28,true);v.setUint32(24,1,true);
 v.setUint16(32,200,true);v.setUint16(34,encodeBuildingArea(240),true);v.setInt16(36,30,true);v.setUint16(38,encodeBuildingAspect(2.4),true);v.setUint16(40,31*512,true);
 return parseBakedBuildings(b);
}
test('UGB2 dimensions preserve area, rotate all four walls, retain base-pivot and conservative bounds',()=>{
 const m=buildBakedTile(payload(),0,5,new THREE.MeshBasicMaterial()),a=m.instanceMatrix.array;
 const w=Math.hypot(a[0],a[2]),d=Math.hypot(a[8],a[10]);assert.ok(Math.abs(w*d/240-1)<1e-6);assert.equal(a[5],100);assert.equal(a[13],15);
 for(const u of [-.5,.5])for(const v of [-.5,.5])assert.ok(m.boundingBox.containsPoint(new THREE.Vector3(u*a[0]+v*a[8],15,u*a[2]+v*a[10])));
});
test('the optional decode-buffer release leaves all meshes and builder stats available',()=>{
 const p=payload(),meshes=[],builder=createBakedBuildingBuilder(p,{VE:5,material:new THREE.MeshBasicMaterial(),onMesh:m=>meshes.push(m),releasePayload:true});
 builder.pump(1e9);assert.equal(p.view,null);assert.equal(p.buffer,null);assert.equal(builder.stats().buildings,1);assert.equal(builder.completeRadius({x:0,z:0}),Infinity);assert.equal(meshes[0].count,1);
});
for(const theta of [.17,.39,.67,.98,1.32])test(`collision, corners, roof and ray tests use the actual box frame (${theta})`,()=>{
 const geo=new THREE.BoxGeometry(1,1,1);geo.translate(0,.5,0);const mesh=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial(),1);
 const c=Math.cos(theta),s=Math.sin(theta),w=24,d=10,a=mesh.instanceMatrix.array;a[0]=w*c;a[2]=w*s;a[5]=50;a[8]=-d*s;a[10]=d*c;a[15]=1;
 mesh.computeBoundingBox();const svc=createCollisionService({getBuildingMeshes:()=>[mesh],getGroundY:()=>-100});svc.sync();
 const world=(u,v)=>({x:u*c-v*s,z:u*s+v*c});
 const start=world(w/2+2,0),delta=world(-4,0),r=svc.moveAndSlide({...start,y:0},{...delta,y:0},{radius:.4,height:9,step:2});
 assert.ok(r.hit);assert.ok(Math.abs(r.x*c+r.z*s-(w/2+.401))<.01,'stops at wall');
 const corner=world(w/2+2,d/2+2),dc=world(-4,-4),hit=svc.moveAndSlide({...corner,y:0},{...dc,y:0},{radius:.4,height:9,step:2});assert.ok(hit.hit);assert.ok(Math.abs(hit.x*c+hit.z*s)>=w/2+.399||Math.abs(-hit.x*s+hit.z*c)>=d/2+.399);
 const outside=world(0,d/2+1);assert.equal(svc.roofHeightAt(outside.x,outside.z),null);assert.equal(svc.roofHeightAt(0,0),50);
 const rayStart=world(0,d/2+2);assert.equal(rayBlockedByBoxes([mesh],rayStart.x,25,rayStart.z,-s,0,c,1),false,'no invisible AABB wall');
 assert.equal(rayBlockedByBoxes([mesh],start.x,25,start.z,-c,0,-s,10),true);
 const los=svc.lineOfSight({...start,y:25},{...world(-w/2-2,0),y:25},{pad:0,padY:0});assert.equal(los.what,'box');assert.ok(Math.abs(los.t-2/(w+4))<1e-6);
});
test('night windows derive both side lengths in the box frame, independent of Y rotation',()=>{
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <emissivemap_fragment>'};injectBuildingWindows(shader);
 assert.ok(shader.vertexShader.includes('length( instanceMatrix[0].xyz )'));assert.ok(shader.vertexShader.includes('length( instanceMatrix[2].xyz )'));
 assert.ok(shader.vertexShader.includes('position.z * nInst.z'));assert.ok(shader.vertexShader.includes('position.x * nInst.x'));
});
test('overlapping rotated building parts cannot push a walker into an earlier wall',()=>{
 const boxes=[
  [.012319,-9.910725,8.397366,9.727633,2.562962],
  [4.062739,-5.403177,13.827049,7.037389,2.696644],
  [6.833781,3.690414,6.401052,14.164010,.309581],
  [6.478032,-8.677234,5.955659,7.626227,.705589],
  [-9.736362,7.558574,12.187858,17.092400,2.271722],
 ];
 const a=new Float32Array(boxes.length*16);
 for(let i=0;i<boxes.length;i++){const[x,z,w,d,t]=boxes[i],o=i*16,c=Math.cos(t),s=Math.sin(t);a[o]=w*c;a[o+2]=w*s;a[o+5]=50;a[o+8]=-d*s;a[o+10]=d*c;a[o+12]=x;a[o+14]=z;a[o+15]=1;}
 const service=createCollisionService({getBuildingMeshes:()=>[{count:boxes.length,instanceMatrix:{array:a}}]});service.sync();
 const end=service.moveAndSlide({x:17.652348557,y:0,z:-12.714725197},{x:-16.155625263,y:0,z:19.662897475},{radius:.4,height:9,step:2});
 for(const[x,z,w,d,t]of boxes){const c=Math.cos(t),s=Math.sin(t),dx=end.x-x,dz=end.z-z;assert.ok(Math.abs(dx*c+dz*s)>=w/2-.001||Math.abs(-dx*s+dz*c)>=d/2-.001,'outside every actual footprint');}
});
test('deflected slides query the full reachable area and remain outside overlapping footprints',()=>{
 let seed=419;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let scene=0;scene<400;scene++){
  const boxes=Array.from({length:5},()=>({x:random()*20-10,z:random()*20-10,w:5+random()*15,d:5+random()*15,theta:random()*Math.PI}));
  const a=new Float32Array(boxes.length*16);
  const frames=boxes.map((b,i)=>{const o=i*16,c=Math.cos(b.theta),s=Math.sin(b.theta);a[o]=b.w*c;a[o+2]=b.w*s;a[o+5]=50;a[o+8]=-b.d*s;a[o+10]=b.d*c;a[o+12]=b.x;a[o+14]=b.z;a[o+15]=1;return {inverse:new THREE.Matrix4().fromArray(a,o).invert(),w:b.w,d:b.d};});
  const mesh={count:boxes.length,instanceMatrix:{array:a}},service=createCollisionService({getBuildingMeshes:()=>[mesh]});service.sync();
  const local=new THREE.Vector3(),inside=(f,p,pad)=>{local.set(p.x,0,p.z).applyMatrix4(f.inverse);return Math.abs(local.x)<.5+pad/f.w&&Math.abs(local.z)<.5+pad/f.d;};
  for(let j=0;j<40;j++){
   const start={x:random()*50-25,y:0,z:random()*50-25},delta={x:random()*50-25,y:0,z:random()*50-25};
   if(frames.some(f=>inside(f,start,.4)))continue;
   const end=service.moveAndSlide(start,delta,{radius:.4,height:9,step:2});
   assert.ok(frames.every(f=>!inside(f,end,-.001)),`outside the rendered footprint union, scene ${scene}, move ${j}`);
  }
 }
});
test('a rotated building beside a bridge is not carved out merely because its AABB touches the deck',async()=>{
 const {createSolidWorld}=await import('../src/modes/solids.js');
 const world=createSolidWorld(),c=Math.SQRT1_2,a=new Float32Array(16);a[0]=30*c;a[2]=30*c;a[5]=50;a[8]=-2*c;a[10]=2*c;a[12]=140;a[14]=5;a[15]=1;
 const extent=16*c,deck={minX:-130,maxX:130,minZ:-2,maxZ:2,ox:0,oz:0,ux:1,uz:0,nx:0,nz:1,uF:-130,uL:130,v0:-2,v1:2};
 assert.equal(world.boxTouches([deck],140-extent,140+extent,5-extent,5+extent),true,'the broad AABB overlaps the bridge corner');
 assert.equal(world.boxTouches([deck],140-extent,140+extent,5-extent,5+extent,a,0),false,'the actual rotated footprint clears the bridge');
});

test('a fitted rectangle quantised to zero degrees still uses swept wall collision',()=>{
 const a=new Float32Array(16);a[0]=.15;a[5]=50;a[10]=20;a[15]=1;
 const service=createCollisionService({getBuildingMeshes:()=>[{count:1,instanceMatrix:{array:a}}]});service.sync();
 const result=service.moveAndSlide({x:-2.2,y:0,z:0},{x:4,y:0,z:0},{radius:.01,height:9,step:2});
 assert.equal(result.hit,true);assert.ok(result.x<-.084,'cannot skip the thin axis-aligned wall between substeps');
});

test('late reservoir anchoring retains the live source datum after rectangle shift and payload release',()=>{
 const p=payload(),x=-18233,z=12118;p.tiles[0].minX=x-1;p.tiles[0].minZ=z;
 p.reservoirFeetVersion=1;p.identityCentres={28:[x,z]};
 const group=new THREE.Group(),builder=createBakedBuildingBuilder(p,{VE:5,material:new THREE.MeshBasicMaterial(),onMesh:m=>group.add(m),releasePayload:true});
 builder.pump(1e9);assert.equal(p.identityCentres,null);
 const mesh=group.children[0],a=mesh.instanceMatrix.array;assert.equal(a[12],x-1);
 const groundAt=px=>95+(px-x)*2;
 try{
  anchorReservoirBuildings({groundAt,bodies:[{spec:{id:'way/147638019'},bankAt:groundAt,bounds:{minX:x-50,maxX:x+50,minZ:z-50,maxZ:z+50}}]},group,[],()=>{},()=>0);
  assert.equal(a[13],95,'source centre preserves live base and roof; shifted centre would give 93');
  assert.equal(a[13]+a[5],195);
  const offsets=mesh.geometry.attributes.reservoirBase.array;let k=0;
  for(const sz of [-1,1])for(const sx of [-1,1]){
   const px=a[12]+(sx*a[0]+sz*a[8])/2;
   assert.ok(Math.abs(a[13]+offsets[k++]*a[5]-groundAt(px))<1e-4,'feet still sample the rotated drawn walls');
  }
 }finally{anchorReservoirBuildings({bodies:[]},null);mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}
});
