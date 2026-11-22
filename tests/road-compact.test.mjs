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

test('distant packets preserve attributes and indices beyond the unsigned-short boundary',async()=>{
 const {mergeRoadParts}=await import('../scripts/roads/pack.mjs'),{decodeRoadBlock,createRoadMaterial}=await import('../src/roads.js');
 const n=65535,a={pos:new Uint16Array(n*3),road:new Uint8Array(n*3),rise:null,across:new Int16Array(n).fill(123),idx:Uint16Array.from([65534,0,1]),farIdx:new Uint16Array()},b={pos:Uint16Array.from([1,2,3,4,5,6,7,8,9]),road:new Uint8Array(9),rise:null,across:null,idx:Uint16Array.from([0,1,2]),farIdx:new Uint16Array()};
 const [p]=mergeRoadParts([a,b]);assert.ok(p.idx instanceof Uint32Array);assert.deepEqual([...p.idx],[65534,0,1,65535,65536,65537]);assert.equal(p.across[65535],-32767);
 const count=p.pos.length/3,head=Buffer.alloc(32);head.write('UGR4');head.writeUInt32LE(count,4);head.writeUInt32LE(p.idx.length,8);head.writeUInt32LE(1|8,28);const base=32+p.pos.byteLength+p.road.byteLength,pad=(4-base%4)%4;
 const raw=Buffer.concat([head,Buffer.from(p.pos.buffer),Buffer.from(p.road.buffer),Buffer.alloc(pad),Buffer.from(p.idx.buffer),Buffer.from(p.across.buffer)]),m=createRoadMaterial();
 try{const mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),m,m);assert.equal(mesh.geometry.index.getX(5),65537);mesh.geometry.dispose();}finally{m.dispose();}
});

test('near grid residency covers a kilometre while visible distant packets stay available through a tile swap',()=>{
 const near={tileLOD:true,tier:'desktop',lod:'near',x:0,z:0,size:2000},far={...near,lod:'far',size:8000};
 for(const x of [0,1000,2000,3000])assert.equal(roadBlockWanted(near,{x,z:1000,height:1.7}),true);
 assert.equal(roadBlockWanted(near,{x:4000,z:1000,height:1.7}),false);
 assert.equal(roadBlockWanted(far,{x:1000,z:1000,height:1.7}),true);
 assert.equal(roadBlockWanted(far,{x:1000,z:1000,height:3000}),true);
 assert.equal(roadBlockWanted(far,{inView:false}),false);
 const minor={...near,tier:'near'};for(const height of [1.7,150,300])assert.equal(roadBlockWanted(minor,{phone:true,height}),true);assert.equal(roadBlockWanted(minor,{phone:true,height:600}),false);
});

test('32-bit distant packet indices decode correctly with odd bridge vertex padding',async()=>{
 const {decodeRoadBlock,createRoadMaterial}=await import('../src/roads.js');
 const n=3,pad=3,raw=new ArrayBuffer(32+n*11+pad+3*4),v=new DataView(raw);v.setUint32(0,0x34524755,true);v.setUint32(4,n,true);v.setUint32(8,3,true);v.setUint32(20,1,true);v.setUint32(28,8,true);
 for(let i=0;i<n;i++){v.setUint16(32+i*6,i*8,true);v.setUint16(34+i*6,12000,true);v.setUint16(36+i*6,i*8,true);}
 const rise=32+n*9+pad,index=rise+n*2;for(let i=0;i<n;i++){v.setInt16(rise+i*2,10+i,true);v.setUint32(index+i*4,i,true);}
 const m=createRoadMaterial(),mesh=decodeRoadBlock(raw,m,m);assert.equal(mesh.geometry.index.array.BYTES_PER_ELEMENT,4);assert.deepEqual([...mesh.geometry.attributes.roadRise.array],[10,11,12]);mesh.geometry.dispose();m.dispose();
});

test('an incomplete detail tile leaves the distant road visible until every part is resident',async()=>{
 const {Scene,ShaderLib}=await import('three'),{createRoads}=await import('../src/roads.js');
 const raw=new ArrayBuffer(66),v=new DataView(raw);v.setUint32(0,0x34524755,true);v.setUint32(4,3,true);v.setUint32(8,3,true);
 new Uint16Array(raw,32,9).set([0,10000,0,8,10000,0,0,10000,8]);new Uint8Array(raw,50,9).set([20,20,20,20,148,20,20,20,20]);new Uint16Array(raw,60,3).set([0,2,1]);
 const base={tileLOD:true,tier:'desktop',x:0,z:0,size:2000,bytes:34,vertices:3,bounds:[0,0,0,1,1,1]},records=[{...base,file:'near-a',lod:'near'},{...base,file:'near-b',lod:'near'},{...base,file:'far',lod:'far',size:8000}];
 const previous=globalThis.fetch;let release;const delayed=new Promise(resolve=>{release=resolve;});
 globalThis.fetch=async url=>String(url).endsWith('manifest.json')?{ok:true,json:async()=>({format:'UGR4',records})}:{ok:true,body:{},headers:new Headers({'content-encoding':'gzip'}),arrayBuffer:()=>String(url).endsWith('near-b')?delayed:Promise.resolve(raw)};
 const roads=createRoads({scene:new Scene()}),shader={uniforms:{},vertexShader:ShaderLib.lambert.vertexShader,fragmentShader:ShaderLib.lambert.fragmentShader};roads.material.onBeforeCompile(shader);
 const tick=async()=>{roads.update({x:0,z:0,height:2});await new Promise(resolve=>setImmediate(resolve));};
 try{for(let i=0;i<10;i++)await tick();assert.equal(roads.stats.loaded,2);assert.equal(shader.uniforms.uRoadNearCount.value,0);assert.equal(roads.group.children.find(m=>m.name.endsWith('near-a')).visible,false);assert.equal(roads.group.children.find(m=>m.name.endsWith(':far')).visible,true);
  release(raw);for(let i=0;i<5;i++)await tick();assert.equal(roads.stats.loaded,3);assert.equal(shader.uniforms.uRoadNearCount.value,1);assert.ok(roads.group.children.filter(m=>m.name.includes('near-')).every(m=>m.visible));
  roads.update({x:0,z:0,height:600});assert.equal(shader.uniforms.uRoadNearCount.value,0);assert.deepEqual(roads.coverage().resident,['far']);
 }finally{roads.dispose();globalThis.fetch=previous;}
});
