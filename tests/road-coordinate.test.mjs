import {test} from 'node:test';import assert from 'node:assert/strict';
import {packRoadCoordinate,unpackRoadCoordinate} from '../scripts/roads/coordinate.mjs';
import {trimRibbon,trimJunction,carriagewayIndex,cut,split,area} from '../scripts/roads/polygons.mjs';
test('one existing two-byte coordinate retains across-road precision and a conservative signed paint field',()=>{
 for(let i=0;i<=1000;i++)for(let paint=-32;paint<32;paint++){
  const across=i/500-1,value=packRoadCoordinate(across,paint+.99),decoded=unpackRoadCoordinate(value);
  assert.ok(value>=4&&value<=65535);assert.equal(decoded.paint,paint);assert.ok(Math.abs(decoded.across-across)<=1/1019+1e-12);
 }
});
test('whole-ribbon pavement clipping and packed paint remain conservative after storage rounding',()=>{
 const r={id:1,width:6,left:2,right:2,layer:0,bridge:false,p:[[-20,0],[20,0]]},other={...r,id:2,p:[[0,-20],[0,20]]},index=carriagewayIndex([r,other]);
 let before=0,after=0,pavement=0,painted=0;
 for(const t of [[[-20,-5,-5,0,0],[20,-5,-5,0,0],[20,5,5,0,0]],[[-20,-5,-5,0,0],[20,5,5,0,0],[-20,5,5,0,0]]]){
  for(const p of trimJunction(t,r,index))before+=p.polygon.length-2;
  for(const {polygon}of trimRibbon(t,r,index)){after+=polygon.length-2;for(const band of [split(polygon,p=>-3-p[2])[0],split(polygon,p=>p[2]-3)[0]])pavement+=area(band);
   for(let i=1;i<polygon.length-1;i++){const stored=[polygon[0],polygon[i],polygon[i+1]].map(p=>{const q=unpackRoadCoordinate(packRoadCoordinate(p[2]/5,p[5]));painted+=Number(q.paint>1);return[Math.round(p[0]*8)/8,Math.round(p[1]*8)/8,q.across*5,q.paint];});
    for(const f of index([-20,-5,20,5]).filter(f=>f.r.id!==r.id))for(const p of cut(stored,f.polygon).inside)assert.ok(p[3]<=0,'paint crosses a carriageway');
   }
  }
 }
 assert.ok(after<before);assert.ok(Math.abs(pavement-136)<1e-6);assert.ok(painted>0);
});
test('ordinary distant faces do not acquire bridge attributes from unrelated roads in their packet',async()=>{
 const {mergeRoadParts}=await import('../scripts/roads/pack.mjs'),across=Uint16Array.from([4,2000,65535]);
 const p={pos:new Uint16Array(18),road:new Uint8Array(18),rise:Int16Array.from([0,0,0,5,8,5]),across:Uint16Array.from([...across,...across]),idx:Uint16Array.from([0,1,2,3,4,5]),farIdx:new Uint16Array()};
 const parts=mergeRoadParts([p]);assert.equal(parts.length,2);assert.equal(parts.filter(p=>p.rise).length,1);assert.ok(parts.every(p=>p.pos.length===9&&p.across instanceof Uint16Array));assert.ok(parts.every(p=>[...p.across].every((v,i)=>v===across[i])));
});
test('packed coordinates are decoded as raw unsigned values before the vertex shader interpolates them',async()=>{
 const {createRoadMaterial,decodeRoadBlock}=await import('../src/roads.js'),n=3,pad=3,raw=new ArrayBuffer(32+n*11+pad+12+n*2),v=new DataView(raw);
 v.setUint32(0,0x34524755,true);v.setUint32(4,n,true);v.setUint32(8,3,true);v.setUint32(20,1,true);v.setUint32(28,13,true);
 const rise=32+n*9+pad,index=rise+n*2,across=index+12;for(let i=0;i<n;i++){v.setUint32(index+i*4,i,true);v.setUint16(across+i*2,[4,packRoadCoordinate(0,0),65535][i],true);}
 const m=createRoadMaterial(),mesh=decodeRoadBlock(raw,m,m),a=mesh.geometry.attributes.roadAcross;
 try{assert.equal(a.normalized,false);assert.ok(a.array instanceof Uint16Array);assert.deepEqual([...a.array],[4,packRoadCoordinate(0,0),65535]);}finally{mesh.geometry.dispose();m.dispose();}
});
test('a ribbon overhang is assigned to both grid cells without losing area or affine coordinates',async()=>{
 const {roadTriangleTiles}=await import('../scripts/roads/polygons.mjs'),source=[[1998,10,-5,100],[2003,10,5,110],[1998,110,-5,120]],tiles=roadTriangleTiles(source);
 assert.equal(tiles.length,2);assert.deepEqual(tiles.map(t=>[t.x,t.z]),[[0,0],[2000,0]]);assert.ok(Math.abs(tiles.reduce((n,t)=>n+area(t.polygon),0)-area(source))<1e-7);
 for(const t of tiles)for(const p of t.polygon){assert.ok(p[0]>=t.x&&p[0]<=t.x+2000&&p[1]>=t.z&&p[1]<=t.z+2000);assert.ok(Math.abs(p[2]-((p[0]-1998)*2-5))<1e-8);assert.ok(Math.abs(p[3]-(100+(p[0]-1998)*2+(p[1]-10)*.2))<1e-8);}
});
test('nearby tile contributions merge without index overflow or a draw for each border strip',async()=>{
 const {mergeRoadParts}=await import('../scripts/roads/pack.mjs'),make=n=>({pos:new Uint16Array(n*3),road:new Uint8Array(n*3),rise:null,across:new Uint16Array(n).fill(4000),idx:Uint16Array.from([0,1,n-1]),farIdx:new Uint16Array()});
 const p=mergeRoadParts([make(40000),make(1000),make(30000)],{maxVertices:65000,wide:false,splitMorph:false});assert.equal(p.length,2);assert.ok(p.every(p=>p.idx instanceof Uint16Array&&p.pos.length/3<=65000));assert.deepEqual([...p[0].idx],[0,1,39999,40000,40001,40999]);
});
test('shared vertices retain geometry and across phase while paint takes the conservative minimum',async()=>{
 const {deduplicateRoadParts}=await import('../scripts/roads/pack.mjs'),make=paint=>({pos:Uint16Array.from([0,0,0,8,0,0,0,0,8]),road:Uint8Array.from([20,0,0,20,0,0,20,0,0]),rise:null,across:Uint16Array.from([-1,1,0].map(v=>packRoadCoordinate(v,paint))),idx:Uint16Array.from([0,1,2]),farIdx:new Uint16Array()});
 const a=make(25),b=make(3),p=deduplicateRoadParts([a,b]);assert.equal(p.pos.length,9);assert.deepEqual([...p.idx],[0,1,2,0,1,2]);assert.ok([...p.across].every(v=>unpackRoadCoordinate(v).paint===3));
 b.across[2]=packRoadCoordinate(.25,3);assert.equal(deduplicateRoadParts([a,b]).pos.length,12,'different paving phase is not merged');
});
test('intermediate compaction retains wide references until final spatial splitting',async()=>{
 const {compactRoadPart}=await import('../scripts/roads/compact.mjs'),n=70002,p={pos:new Uint16Array(n*3),road:new Uint8Array(n*3),rise:null,across:new Uint16Array(n).fill(4000)},indices=Uint32Array.from({length:n},(_,i)=>i),q=compactRoadPart(p,indices);
 assert.ok(q.idx instanceof Uint32Array);assert.equal(q.idx.at(-1),70001);assert.equal(q.pos.length/3,n);
});
test('spatial distant packing preserves every face while returning bounded 16-bit packets',async()=>{
 const {localiseRoadParts}=await import('../scripts/roads/pack.mjs'),n=70002,pos=new Uint16Array(n*3),across=new Uint16Array(n),idx=Uint32Array.from({length:n},(_,i)=>i);
 for(let i=0;i<n;i++){const triangle=Math.floor(i/3),corner=i%3;pos[i*3]=512+(triangle%100)*8+(corner===1?4:0);pos[i*3+1]=10000;pos[i*3+2]=512+Math.floor(triangle/100)*8+(corner===2?4:0);across[i]=packRoadCoordinate([-1,1,0][corner],5);}
 const source={pos,road:new Uint8Array(n*3),rise:null,across,idx,farIdx:new Uint16Array()},parts=localiseRoadParts([source],4000,{deduplicate:true,mergeMorph:true,index16:true});
 assert.ok(parts.length>1);assert.ok(parts.every(p=>p.idx instanceof Uint16Array&&p.pos.length/3<=65000));assert.equal(parts.reduce((n,p)=>n+p.idx.length,0),idx.length);
 const face=(p,i)=>[0,1,2].flatMap(k=>[...p.pos.subarray(p.idx[i+k]*3,p.idx[i+k]*3+3)]).join(','),expected=new Set();for(let i=0;i<idx.length;i+=3)expected.add(face(source,i));
 for(const p of parts)for(let i=0;i<p.idx.length;i+=3)assert.ok(expected.delete(face(p,i)),'new or duplicate face');assert.equal(expected.size,0);
});
