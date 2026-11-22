import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { installNodeEnv } from '../scripts/bake-node-env.mjs';
import { surfaceCorridorKind } from '../scripts/outlines/select.mjs';
import { packSet,roofTriangles } from '../scripts/outlines/pack.mjs';
installNodeEnv();
const {parseOutlineDirectory,decodeOutlineChunk,replaceOutlineBoxes,planOutlineBoxes,commitOutlineBoxes,applyOutlinePlacements,rayPrism,createOutlineMaterials}=await import('../src/outline-buildings.js');
const {createSolidWorld,createOutlineSolidLayer}=await import('../src/modes/solids.js');
const fixture=ring=>({x:5,z:5,rectX:5,rectZ:5,height:10,base:2,ring,tile:0,ordinal:0});
const L=fixture([[0,0],[10,0],[10,3],[3,3],[3,10],[0,10]]);
const payload=records=>{const b=packSet(records);return parseOutlineDirectory(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
test('on-road trial includes service and other surface carriageways, excluding vertical crossings',()=>{
 for(let cls=0;cls<8;cls++)assert.equal(surfaceCorridorKind({cls,layer:0}),cls<=5?'roads':cls===6?'service':'other');
 for(const crossing of [{bridge:true},{tunnel:true},{layer:1},{layer:-1}])assert.equal(surfaceCorridorKind({cls:6,layer:0,...crossing}),null);
});
test('outline packing is byte deterministic and preserves rings over 255 vertices',()=>{
 const ring=Array.from({length:512},(_,i)=>[20+10*Math.cos(i/512*2*Math.PI),20+10*Math.sin(i/512*2*Math.PI)]);
 const records=[L,fixture(ring)],a=packSet(records),b=packSet(records);assert.deepEqual(a,b);
 const chunk=decodeOutlineChunk(payload(records),0,5);assert.equal(chunk.records[1].ring.length,512);
 assert.equal(chunk.records[1].height,50);assert.equal(chunk.records[1].base,10);
});
test('concave roof triangulation faces up and exactly fills the L footprint',()=>{
 const {geometry}=decodeOutlineChunk(payload([L]),0,1),p=geometry.attributes.position,ix=geometry.index.array;let area=0;
 for(let i=6*L.ring.length;i<ix.length;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,ix[i]),b=new THREE.Vector3().fromBufferAttribute(p,ix[i+1]),c=new THREE.Vector3().fromBufferAttribute(p,ix[i+2]);
 const n=b.sub(a).cross(c.sub(a));assert.ok(n.y>0);area+=n.y/2;}
 assert.equal(area,51);
});
test('invalid self-crossing source rings retain boxes instead of submitting a broken roof',()=>{
 const malformed=[[0,0],[10,10],[0,10],[10,0]];
 assert.equal(roofTriangles(malformed).valid,false);
 assert.throws(()=>packSet([fixture(malformed)]),/invalid outline roof/);
});
test('replacement removes exactly one instance and keeps the neighbour and identity',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);mesh.name='baked-buildings-0';
 mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(10,50,10).setPosition(5,10,5));
 mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(10,50,10).setPosition(30,10,5));
 const {records}=decodeOutlineChunk(payload([L]),0,5);assert.equal(replaceOutlineBoxes(records,[mesh]),1);assert.equal(mesh.count,1);assert.equal(mesh.instanceMatrix.array[12],30);
 assert.equal(replaceOutlineBoxes(records,[mesh]),0);
});
test('bulk replacement preserves multiple retained runs and their foundation attributes',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),7);mesh.name='baked-buildings-0';
 const extra=new THREE.InstancedBufferAttribute(Float32Array.from({length:28},(_,i)=>i),4);for(const i of [1,3,4])extra.array.fill(0,i*4,i*4+4);mesh.geometry.setAttribute('reservoirBase',extra);
 for(let i=0;i<7;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeScale(10,50,10).setPosition(i*30,10,0));
 const records=[1,3,4].map(i=>({tile:0,x:i*30,z:0,rectX:i*30,rectZ:0,height:50}));
 assert.equal(replaceOutlineBoxes(records,[mesh]),3);assert.equal(mesh.count,4);
 assert.deepEqual(Array.from({length:4},(_,i)=>mesh.instanceMatrix.array[i*16+12]),[0,60,150,180]);
 assert.deepEqual([...extra.array.slice(0,16)],[0,1,2,3,8,9,10,11,20,21,22,23,24,25,26,27]);
});
test('replacement planning can yield without changing drawn boxes or collision state',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),5);mesh.name='baked-buildings-0';
 for(let i=0;i<5;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeScale(10,50,10).setPosition(i*30,10,0));
 const original=mesh.instanceMatrix.array.slice(),records=[{tile:0,x:30,z:0,rectX:30,rectZ:0,height:50}],steps=planOutlineBoxes(records,[mesh],1);
 let n;do{n=steps.next();assert.deepEqual(mesh.instanceMatrix.array,original);assert.equal(mesh.count,5);assert.equal(records[0].matched,undefined);}while(!n.done);
 let invalidations=0;assert.equal(commitOutlineBoxes(n.value,m=>{assert.equal(m.count,4);invalidations++;}),1);
 assert.equal(invalidations,1);assert.equal(mesh.count,4);assert.equal(records[0].matched,true);
 assert.deepEqual(Array.from({length:4},(_,i)=>mesh.instanceMatrix.array[i*16+12]),[0,60,90,120]);
});
test('outline placement inherits the final box datum and true height after compatibility corrections',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1);mesh.name='baked-buildings-0';
 mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(10,50,10).setPosition(5,75,5));
 const {geometry,records}=decodeOutlineChunk(payload([L]),0,5),steps=planOutlineBoxes(records,[mesh]);let n;do{n=steps.next();}while(!n.done);
 applyOutlinePlacements(geometry,records,n.value.placements);assert.equal(records[0].base,75);assert.equal(records[0].height,50);
 assert.equal(geometry.attributes.position.getY(0),75);assert.equal(geometry.attributes.position.getY(1),125);
 assert.equal(geometry.attributes.aBuilding.getX(0),75);assert.equal(records[0].h,50);
});
test('bank-fitted boxes retain their original instance, foundation attributes and extra faces',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);mesh.name='baked-buildings-0';
 for(let i=0;i<2;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeScale(10,50,10).setPosition(5+i*30,75,5));
 mesh.geometry.setAttribute('reservoirBase',new THREE.InstancedBufferAttribute(new Float32Array([.2,.1,.3,.4,0,0,0,0]),4));
 const faces=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());faces.userData.reservoirFoundationWall=true;mesh.add(faces);
 const records=[{tile:0,x:5,z:5,rectX:5,rectZ:5,height:50},{tile:0,x:35,z:5,rectX:35,rectZ:5,height:50}],steps=planOutlineBoxes(records,[mesh]);let n;do{n=steps.next();}while(!n.done);
 assert.equal(n.value.keptFoundations.size,1);assert.ok(n.value.keptFoundations.has(records[0]));assert.equal(commitOutlineBoxes(n.value),1);
 assert.equal(mesh.count,1);assert.equal(mesh.instanceMatrix.array[12],5);assert.equal(mesh.children[0],faces);assert.equal(records[0].matched,undefined);assert.equal(records[1].matched,true);
 assert.deepEqual(Array.from(mesh.geometry.attributes.reservoirBase.array.slice(0,4)),Array.from(new Float32Array([.2,.1,.3,.4])));
});
test('real concave wall is solid, recess stays open, displayed hover obeys Master',()=>{
 const {records}=decodeOutlineChunk(payload([L]),0,5),scene=new THREE.Scene(),group=new THREE.Group();scene.add(group);
 const layer=createOutlineSolidLayer(records),world=createSolidWorld({getHeightScale:()=>.2});world.setSources({outlines:()=>({group,layers:[layer]})});world.update();
 assert.equal(world.standOn(1,1,100,0),20);assert.ok(world.standOn(7,7,100,0)<0);
 assert.ok(world.segmentHits(-2,15,1,2,15,1)>0);assert.equal(world.segmentHits(5,15,5,8,15,8),null);
 const ray=new THREE.Ray(new THREE.Vector3(-2,15,1),new THREE.Vector3(1,0,0));assert.equal(rayPrism(records[0],ray,.2),2);
 assert.equal(rayPrism(records[0],new THREE.Ray(new THREE.Vector3(-2,30,1),new THREE.Vector3(1,0,0)),.2),null);
});
test('outline day, night and depth shaders all share true height and opening rise',()=>{
 const m=createOutlineMaterials();for(const material of Object.values(m)){const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(s);
 assert.match(s.vertexShader,/position.y-aBuilding.x/);assert.match(s.vertexShader,/outlineRise/);assert.ok(s.uniforms.uRiseFront);}
});
test('complete source bake regenerates byte-identically on the pinned corrected network',{skip:!process.env.UG_OUTLINE_SNAPSHOT},()=>{
 const files=['outlines-a.z.bin','outlines-b.z.bin','outlines-meta.json'],dir=new URL('../public/data/surface/baked/',import.meta.url),before=files.map(f=>fs.readFileSync(new URL(f,dir)));
 execFileSync(process.execPath,['scripts/outlines/prepare.mjs','--snapshot',process.env.UG_OUTLINE_SNAPSHOT,'--commit',JSON.parse(before[2]).networkCommit],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
 files.forEach((f,i)=>assert.deepEqual(fs.readFileSync(new URL(f,dir)),before[i],f));
 const meta=JSON.parse(before[2]);for(const [i,name]of ['a','b'].entries()){const raw=gunzipSync(before[i]);assert.equal(createHash('sha256').update(raw).digest('hex'),meta.sets[name].sha256);}
});
