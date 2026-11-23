// Round 1 regressions: original desktop shaders, bounded planning, one-way pavement.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {injectBuildingWindows,installGroundGlow} from '../src/night.js';
import {planOutlineBoxes} from '../src/outline-buildings.js';
import {pairCarriageways} from '../scripts/roads/network.mjs';
const shader=()=>({uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader});
const digest=s=>createHash('sha256').update(s.vertexShader+'\n'+s.fragmentShader).digest('hex');
test('desktop window shader is byte-identical to the live full-shading shader',()=>{
 const s=shader();injectBuildingWindows(s,{phone:false});
 // Captured from b3a51d4, before either phone optimisation was introduced.
 assert.equal(digest(s),'b3f69f4ba05d9b845a622e8a17ccf28cd00ecaf22e558237e639a92136b79d28');
 const p=shader();injectBuildingWindows(p,{phone:true});assert.notEqual(digest(p),digest(s));
 assert.equal(p.vertexShader,s.vertexShader,'the phone keeps the same window positions');
});
test('desktop ground-light shader is byte-identical to live, with phone shading selected before compilation',()=>{
 const m=new THREE.MeshStandardMaterial(),s=shader();installGroundGlow(m,{minX:0,maxX:100,minZ:0,maxZ:100},{phone:false});m.onBeforeCompile(s);
 assert.equal(digest(s),'2993d3798562af96600699da5f16031649009cbef6418bf068de479b3436b5f0');
 const p=new THREE.MeshStandardMaterial(),q=shader();installGroundGlow(p,{minX:0,maxX:100,minZ:0,maxZ:100},{phone:true});p.onBeforeCompile(q);
 assert.notEqual(digest(q),digest(s));assert.equal(q.vertexShader,s.vertexShader);
});
test('outline planning yields before indexing a complete large cohort and never mutates boxes while preparing',()=>{
 let read=0;const records=Array.from({length:1000},(_,i)=>({get tile(){read++;return i;},x:i,z:0,rectX:i,rectZ:0,height:50}));
 const steps=planOutlineBoxes(records,[]);assert.equal(steps.next().done,false);
 assert.ok(read<records.length,'the first slice must not index the whole cohort');
 let n;do{n=steps.next();}while(!n.done);assert.equal(n.value.hidden,0);
});
test('untagged unpaired one-way halves keep only their outer UK kerbside pavement in both source directions',()=>{
 const base={oneway:true,widthSource:'oneway-class',width:3,left:2,right:2,cls:5,layer:0,bridge:false};
 const a={...base,id:1,direction:1,p:[[0,0],[20,0]]},b={...base,id:2,direction:-1,p:[[0,100],[20,100]]},tagged={...base,id:3,direction:1,widthSource:'lanes',p:[[0,200],[20,200]]};
 pairCarriageways([a,b,tagged]);assert.deepEqual([a.left,a.right,b.left,b.right],[2,0,0,2]);assert.deepEqual([tagged.left,tagged.right],[2,2]);
});

import {rebucketFarRoads} from '../scripts/roads/rebucket.mjs';
const part=(coords,float=false)=>({pos:new(float?Float32Array:Uint16Array)(coords),road:new Uint8Array(9).fill(20),rise:null,across:new Uint16Array(3).fill(32772),idx:new Uint16Array([0,1,2]),farIdx:new Uint16Array()});
const worldTriangles=groups=>[...groups.values()].flatMap(c=>c.parts.flatMap(p=>{const out=[];for(let i=0;i<p.idx.length;i+=3)out.push(Array.from(p.idx.slice(i,i+3),j=>[c.x+p.pos[j*3]/8,p.pos[j*3+1],c.z+p.pos[j*3+2]/8]));return out;}));
test('far packets consolidate adjacent source overhangs without moving any world-space triangle',()=>{
 const groups=new Map([['a',{key:'a',tier:'major',lod:'far',size:8000,x:-64,z:-64,parts:[part([64520,10000,800,64528,10001,800,64520,10002,808])]}],['b',{key:'b',tier:'major',lod:'far',size:8000,x:7936,z:-64,parts:[part([544,10003,800,552,10004,800,544,10005,808])]}]]);
 const before=worldTriangles(groups);rebucketFarRoads(groups);
 assert.equal(groups.size,1,'the neighbouring source tiles must share one distant packet');
 assert.deepEqual(worldTriangles(groups),before);
});
test('rebucketing keeps negative local coordinates exact and leaves precise bank overlays in their original frame',()=>{
 const ints=part([62912,10000,800,65312,10001,800,65312,10002,808]),bank=part([30912.125,10000.5,800,30912.25,10001.5,800,30912.125,10002.5,808],true);
 const groups=new Map([['a',{key:'a',tier:'desktop',lod:'far',size:8000,x:-64,z:-64,parts:[ints,bank]}]]);
 const before=worldTriangles(groups).map(t=>JSON.stringify(t)).sort();rebucketFarRoads(groups);
 assert.deepEqual(worldTriangles(groups).map(t=>JSON.stringify(t)).sort(),before);
 const precise=[...groups.values()].find(c=>!c.rebucketed);assert.equal(precise.x,-64);assert.equal(precise.parts[0],bank);
 const rebased=[...groups.values()].find(c=>c.rebucketed);assert.ok(rebased.parts.some(p=>p.pos instanceof Float32Array&&p.pos.some(v=>v<0)));
});

import fs from 'node:fs';
test('one outlying triangle does not widen the position buffers of ordinary triangles in the same distant cell',()=>{
 const p=part([62912,10000,800,65312,10001,800,65312,10002,808,64600,10000,1000,64700,10001,1000,64600,10002,1100]);
 p.road=new Uint8Array(18).fill(20);p.across=new Uint16Array(6).fill(32772);p.idx=new Uint16Array([0,1,2,3,4,5]);
 const groups=new Map([['a',{key:'a',tier:'major',lod:'far',size:8000,x:-64,z:-64,parts:[p]}]]),before=worldTriangles(groups).map(t=>JSON.stringify(t)).sort();
 rebucketFarRoads(groups);
 assert.deepEqual(worldTriangles(groups).map(t=>JSON.stringify(t)).sort(),before);
 const parts=[...groups.values()].flatMap(c=>c.parts);
 assert.equal(parts.filter(p=>p.pos instanceof Float32Array).reduce((n,p)=>n+p.pos.length/3,0),3,'only the triangle that crosses the coordinate range needs Float32');
 assert.equal(parts.filter(p=>p.pos instanceof Uint16Array).reduce((n,p)=>n+p.pos.length/3,0),3);
});
test('distant road packets retain the bounded 16-bit index allocation used on the phone',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/data/roads/manifest.json',import.meta.url)));
 for(const r of manifest.records.filter(r=>r.lod==='far')){
  assert.ok(r.vertices<=65000,`${r.file}: distant packet exceeds the existing narrow-index vertex limit`);
  assert.equal(r.indexBytes,2,`${r.file}: distant index buffers must not double their allocation`);
 }
});

import * as outlineDecoder from '../src/outline-buildings.js';
import {packSet} from '../scripts/outlines/pack.mjs';
test('outline decoding yields before a large ring is converted and preserves the original geometry and identity bytes',()=>{
 assert.equal(typeof outlineDecoder.decodeOutlineChunkSteps,'function');
 const ring=Array.from({length:512},(_,i)=>[20+10*Math.cos(i/512*2*Math.PI),20+10*Math.sin(i/512*2*Math.PI)]);
 const b=packSet([{x:20,z:20,rectX:20,rectZ:20,height:10,base:2,ring,tile:0,ordinal:0}]);
 const p=outlineDecoder.parseOutlineDirectory(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),initial=new Uint8Array(p.buffer).slice();
 const steps=outlineDecoder.decodeOutlineChunkSteps(p,0,5,32);let next=steps.next();
 assert.equal(next.done,false);assert.deepEqual(new Uint8Array(p.buffer),initial,'the first slice must yield before converting the large ring');
 let slices=1;while(!next.done){next=steps.next();slices++;}assert.ok(slices>10);
 const c=next.value,digest=createHash('sha256').update(Buffer.from(c.geometry.attributes.position.data.array.buffer)).update(Buffer.from(c.geometry.index.array.buffer)).update(JSON.stringify(c.records)).digest('hex');
 // Golden output from the synchronous decoder before incremental decoding.
 assert.equal(digest,'d595e02f96b31b1a30032dbfe2843d342de635503e8ea3340bd07569a6c5bfc9');assert.equal(c.records[0].ring.length,512);
 assert.equal(c.geometry.attributes.position.getY(0),10);assert.equal(c.geometry.attributes.position.getY(1),60);c.geometry.dispose();
});
