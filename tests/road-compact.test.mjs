import {test} from 'node:test';import assert from 'node:assert/strict';
import {compactRoadPart} from '../scripts/roads/compact.mjs';
import {roadBlockWanted} from '../src/roads.js';
test('offline LOD compaction preserves every referenced attribute and retains no unused vertex',()=>{
 const part={pos:Uint16Array.from([1,2,3,4,5,6,7,8,9,10,11,12]),road:Uint8Array.from([1,2,3,4,5,6,7,8,9,10,11,12]),rise:Int16Array.from([10,20,30,40]),across:Int16Array.from([-32767,0,12000,32767])};
 const compact=compactRoadPart(part,Uint16Array.from([3,1,2,2,1,3]));
 assert.deepEqual([...compact.idx],[0,1,2,2,1,0]);assert.equal(compact.pos.length,9);assert.equal(compact.farIdx.length,0);
 for(let i=0;i<compact.idx.length;i++){const a=compact.idx[i],b=[3,1,2,2,1,3][i];assert.deepEqual([...compact.pos.subarray(a*3,a*3+3)],[...part.pos.subarray(b*3,b*3+3)]);assert.deepEqual([...compact.road.subarray(a*3,a*3+3)],[...part.road.subarray(b*3,b*3+3)]);assert.equal(compact.rise[a],part.rise[b]);assert.equal(compact.across[a],part.across[b]);}
});
test('desktop and phone choose exactly one LOD, keep a 1km street guarantee and cull outside the preload cone',()=>{
 const base={tier:'desktop',bounds:[100,-100,0,200,100,100],x:0,z:0,size:8000};
 for(const phone of [false,true])for(const height of [1.7,150,300,500,3000])for(const x of [0,3000,10000]){
  const near={...base,tier:phone?'major':'desktop',lod:'near'},far={...near,lod:'far'};
  const a=roadBlockWanted(near,{phone,height,x}),b=roadBlockWanted(far,{phone,height,x});assert.notEqual(a,b);
  assert.equal(roadBlockWanted(near,{phone,height,x,inView:false}),false);assert.equal(roadBlockWanted(far,{phone,height,x,inView:false}),false);
  if(x===0&&height===1.7)assert.equal(a,true);
 }
 for(const height of [1.7,150,300])assert.equal(roadBlockWanted({...base,tier:'near'},{phone:true,x:0,z:0,height}),true);
 assert.equal(roadBlockWanted({...base,tier:'near'},{phone:true,height:500}),false);
});

test('compact half-width precision keeps lane-derived carriageways within 0.1m without another attribute',async()=>{
 const {roadMetadata,roadDimensions}=await import('../scripts/roads/metadata.mjs');
 for(const width of [3.2,6.4,9.6,12.8,7.1,5,17.3,85])for(const [left,right]of [[2,2],[2,0],[0,2],[0,0]])for(const side of [-1,1]){
  const data=roadMetadata((width+left+right)/2,left,right,side),decoded=roadDimensions(data);
  assert.ok(data.every(v=>v>=0&&v<256));assert.ok(Math.abs(2*decoded.half-decoded.left-decoded.right-width)<=.062501);
  assert.equal(decoded.left,left);assert.equal(decoded.right,right);assert.equal(data[1]>=128,side>0);
 }
});

test('final stored-coordinate repair restores bank clearance without creeping on a second pass',async()=>{
 const {repairRoadClearance}=await import('../scripts/roads/clearance.mjs');
 for(const bridge of [false,true]){
  const raw=Buffer.alloc(bridge?72:66),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);v.setUint32(4,3,true);v.setUint32(8,3,true);v.setUint32(20,bridge?1:0,true);
  for(let i=0;i<3;i++){v.setUint16(32+i*6,i*8,true);v.setUint16(34+i*6,12011,true);v.setUint16(36+i*6,i*8,true);if(bridge)v.setInt16(60+i*2,8,true);}
  const support=100.2805407741632,opts={inRegion:()=>true,support:()=>support};
  assert.equal(repairRoadClearance(raw,opts).repaired,3);
  assert.equal(repairRoadClearance(raw,opts).repaired,0,'reapplying cannot raise an already valid road');
  for(let i=0;i<3;i++)for(const ratio of [1,1/1.1,.1]){const y=v.getUint16(34+i*6,true)*.05-500,rise=bridge?v.getInt16(60+i*2,true)*.05:0;assert.ok(y+rise*(ratio-1)>=support+.27);}
 }
});
