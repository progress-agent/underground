import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeRoadBlock,createRoadMaterial} from '../src/roads.js';

test('separately streamable road LODs retain upward triangles, valid indices and only referenced vertices',()=>{
 const dir=new URL('../public/data/roads/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir))),material=createRoadMaterial(),pairs=new Map();
 let nearCount=0,farCount=0,nearFiles=0,farFiles=0;
 try{for(const r of manifest.records){
  const raw=gunzipSync(fs.readFileSync(new URL(r.file,dir))),mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),material,material,r),g=mesh.geometry,p=g.attributes.position;
  assert.equal(mesh.userData.roadFarGeometry,undefined,'one file owns one LOD, no retained full-size unused vertex buffer');
  assert.equal(new Set(g.index.array).size,p.count,`${r.file}: unused vertex`);
  for(let i=0;i<g.index.count;i+=3){const ids=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];assert.ok(ids.every(j=>j<p.count),r.file);
   const[a,b,c]=ids,ny=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));assert.ok(ny>=0,r.file);
  }
  if(r.pair){if(!pairs.has(r.pair))pairs.set(r.pair,{});pairs.get(r.pair)[r.lod]=g.index.count;}
  if(r.tier==='desktop'){if(r.lod==='near'){nearCount+=g.index.count;nearFiles++;}else{farCount+=g.index.count;farFiles++;}}
  g.dispose();
 }
 for(const [pair,lods]of pairs){assert.ok(lods.near>0&&lods.far>0,pair);assert.ok(lods.far<=lods.near,pair);}
 if(manifest.tileLODs){assert.ok(farFiles<nearFiles,'spatial distant packets must stay more consolidated than full nearby detail');assert.ok(farCount<nearCount,'distant geometry must actually reduce triangles');assert.ok(farCount/3>manifest.stats.uniqueWays*.9,'city-wide aerial geometry must retain the mapped network, not only the last road in each packet');for(const r of manifest.records)assert.equal(r.size,r.lod==='far'?8000:2000);}
 else{assert.ok(pairs.size>0);assert.ok(farCount<nearCount,'the aerial LOD must actually reduce drawing');}
 }finally{material.dispose();}
});
