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
