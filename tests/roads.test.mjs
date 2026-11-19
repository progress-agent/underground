import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dimensions,metres,clipper} from '../scripts/roads/network.mjs';
import {decodeRoadBlock,createRoadMaterial,roadBlockWanted,createRoads} from '../src/roads.js';
import {Scene} from 'three';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'public/data/roads');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('road asset regenerates byte-identically from the 80 cached OSM answers',()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ug-roads-'));
  try{execFileSync(process.execPath,[path.join(root,'scripts/roads/prepare.mjs'),'--out',out],{timeout:240000,stdio:'pipe'});
    assert.deepEqual(fs.readFileSync(path.join(out,'manifest.json')),fs.readFileSync(path.join(dir,'manifest.json')));
    assert.equal(hash(fs.readFileSync(path.join(out,'network.bin.gz'))),manifest.networkSHA256);
    assert.equal(hash(fs.readFileSync(path.join(out,'bridge-decks.bin.gz'))),manifest.bridgeSHA256);
    for(const r of manifest.records)assert.equal(hash(fs.readFileSync(path.join(out,r.file))),r.sha256,r.file);
  }finally{fs.rmSync(out,{recursive:true,force:true});}
});
test('coverage includes all eight classes and the October total within 5%',()=>{
  assert.equal(manifest.classes.length,8);assert.ok(manifest.stats.km.every(k=>k>0));
  assert.ok(Math.abs(manifest.stats.totalKm/29921-1)<.05);assert.ok(manifest.desktopGPUBytes<80e6);
  assert.match(manifest.source,/OpenStreetMap.*ODbL/);
});
test('merged roads near all four reservoir feet follow actual bank support before clearance',async()=>{
  const {installNodeEnv}=await import('../scripts/bake-node-env.mjs');installNodeEnv();
  const terrain=await import('../src/terrain.js'),{initThamesMask}=await import('../src/thames-mask.js'),{loadM25Data,initM25Boundary}=await import('../src/m25.js');
  const thamesData=JSON.parse(fs.readFileSync(path.join(root,'public/data/thames.json')));initThamesMask(thamesData.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints??m25.points);await terrain.tryCreateTerrainMesh({thamesData});
  const {RESERVOIR_FEET,inReservoirFootRegion}=await import('../src/reservoir-feet.js'),{createDeepWaterSteps}=await import('../src/deep-water.js');
  const {anchorReservoirBuildings,reservoirBuildingBase}=await import('../src/reservoir-buildings.js');
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'public/data/deep-water.json'))),ids=new Set(RESERVOIR_FEET.map(b=>b.id));
  const steps=createDeepWaterSteps({...inventory,bodies:inventory.bodies.filter(b=>ids.has(b.id)).map(b=>({...b,seaLife:false}))},terrain.getTerrainMeshSurfaceY,m25.supportPoints??m25.points);
  let step;do{step=steps.next();}while(!step.done);anchorReservoirBuildings(step.value,null);
  const counts=new Map(RESERVOIR_FEET.map(b=>[b.id,0]));let raised=0;
  const material=createRoadMaterial();
  for(const rec of manifest.records.filter(r=>r.tier==='desktop')){
    if(!RESERVOIR_FEET.some(b=>rec.x+rec.size>=b.minX&&rec.x<=b.maxX&&rec.z+rec.size>=b.minZ&&rec.z<=b.maxZ))continue;
    const raw=gunzipSync(fs.readFileSync(path.join(dir,rec.file))),mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),material,material,rec),p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=mesh.position.x+p.getX(i)*.125,z=mesh.position.z+p.getZ(i)*.125;if(!inReservoirFootRegion(x,z))continue;
      const ground=terrain.getTerrainMeshSurfaceY({x,z}),support=reservoirBuildingBase(x,z,ground),y=mesh.position.y+p.getY(i)*.05;
      assert.ok(y>=support+.27,`${rec.file} ${x},${z}: road ${y} below support ${support}`);
      if(support>ground+.3)raised++;
      for(const b of RESERVOIR_FEET)if(x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ)counts.set(b.id,counts.get(b.id)+1);
    }mesh.geometry.dispose();
  }material.dispose();
  assert.ok(raised>0,'exercise roads supported by grass above the DEM');
  for(const [id,count]of counts)assert.ok(count>0,`no road samples near ${id}`);
});
test('tagged widths and left/right pavements override labelled estimates',()=>{
  assert.equal(metres("12 ft"),3.6576000000000004);assert.equal(metres('bad'),null);
  assert.deepEqual(dimensions({width:'7.2',sidewalk:'left','sidewalk:left:width':'1.8'},5),{width:7.2,left:1.8,right:0});
  assert.deepEqual(dimensions({sidewalk:'none'},5),{width:6,left:0,right:0});
  assert.deepEqual(dimensions({},5),{width:6,left:2,right:2});
  assert.deepEqual(dimensions({},0),{width:12,left:0,right:0});
});
test('exact clipping retains an entering and exiting segment and removes outside pieces',()=>{
  const clip=clipper([[0,0],[10,0],[10,10],[0,10]]);
  assert.deepEqual(clip([[-5,5],[15,5]]),[[[0,5],[10,5]]]);assert.deepEqual(clip([[-5,-5],[15,-5]]),[]);
});
test('all generated blocks use 16-bit indices, upward winding and compact pavement attributes',()=>{
  const m=createRoadMaterial();
  for(const r of manifest.records){
    const b=gunzipSync(fs.readFileSync(path.join(dir,r.file))),buffer=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),mesh=decodeRoadBlock(buffer,m,m,r),g=mesh.geometry,p=g.attributes.position;
    assert.ok(p.count<=65000);assert.equal(g.index.array.BYTES_PER_ELEMENT,2);assert.equal(g.attributes.roadData.array.BYTES_PER_ELEMENT,1);
    for(let i=0;i<g.index.count;i+=3){const a=g.index.getX(i),b=g.index.getX(i+1),c=g.index.getX(i+2),ny=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
      assert.ok(ny>=0,`${r.file} triangle ${i/3} points below ground`);}
    g.dispose();
  }m.dispose();
});
test('phone guarantees every nearby minor block while desktop retains all roads',()=>{
  for(const [x,z]of [[2744,-761],[-10000,5000],[8447,2136]])for(const r of manifest.records){
    assert.equal(roadBlockWanted(r),r.tier==='desktop');
    if(r.tier==='near'&&Math.max(r.x-x,0,x-r.x-r.size)**2+Math.max(r.z-z,0,z-r.z-r.size)**2<=1000**2)
      assert.equal(roadBlockWanted(r,{phone:true,x,z,height:2}),true);
    if(r.tier==='near')assert.equal(roadBlockWanted(r,{phone:true,x,z,height:3000}),false);
  }
});
for(const scenario of ['toggle','range'])test(`an old download cannot attach twice after a ${scenario} change`,async()=>{
  const raw=new ArrayBuffer(66),header=new DataView(raw);header.setUint32(0,0x34524755,true);header.setUint32(4,3,true);header.setUint32(8,3,true);
  new Uint16Array(raw,32,9).set([0,10000,0,8,10000,0,0,10000,8]);new Uint8Array(raw,50,9).set([20,20,20,20,148,20,20,20,20]);new Uint16Array(raw,60,3).set([0,2,1]);
  const rec={file:'test.bin.gz',tier:scenario==='range'?'near':'desktop',x:0,z:0,size:8000,bytes:34,vertices:3,bounds:[0,0,0,1,1,1]};
  const previous=globalThis.fetch;let releaseOld,downloads=0;
  const old=new Promise(resolve=>{releaseOld=resolve;});
  globalThis.fetch=async url=>String(url).endsWith('manifest.json')?{ok:true,json:async()=>({format:'UGR4',records:[rec]})}:{ok:true,body:{},headers:new Headers({'content-encoding':'gzip'}),arrayBuffer:()=>++downloads===1?old:Promise.resolve(raw)};
  const roads=createRoads({scene:new Scene(),phone:scenario==='range'}),frame=()=>roads.update({x:0,z:0,height:2}),flush=()=>new Promise(resolve=>setImmediate(resolve));
  try{frame();await flush();frame();await flush();assert.equal(downloads,1);
    if(scenario==='toggle'){roads.setEnabled(false);roads.setEnabled(true);}else roads.update({x:0,z:0,height:300});
    frame();await flush();frame();await flush();frame();assert.equal(roads.stats.bytes,34);
    releaseOld(raw);await flush();frame();assert.equal(roads.group.children.length,1);assert.equal(roads.stats.bytes,34);assert.equal(roads.stats.state,'ready');
  }finally{roads.dispose();globalThis.fetch=previous;}
});
test('road bridge widths prepare one mesh at a time and restore original geometry exactly',async()=>{
  const {installNodeEnv}=await import('../scripts/bake-node-env.mjs');installNodeEnv();
  const terrain=await import('../src/terrain.js'),{initThamesMask}=await import('../src/thames-mask.js'),{loadM25Data,initM25Boundary}=await import('../src/m25.js');
  const thamesData=JSON.parse(fs.readFileSync(path.join(root,'public/data/thames.json')));initThamesMask(thamesData.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints??m25.points);await terrain.tryCreateTerrainMesh({thamesData});
  const {createBridges}=await import('../src/bridges.js'),b=await createBridges({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1/1.1});
  const livePath=path.join(root,'../ug-s25-livebase/src/bridges.js');
  if(fs.existsSync(livePath)) {
    const {createBridges:createLive}=await import(livePath);
    const live=await createLive({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1/1.1});
    const baseline=new Map();live.traverse(m=>{if(m.isMesh)baseline.set(m.name,hash(Buffer.from(m.geometry.attributes.position.array.buffer)));});
    for(const m of b.userData.roadMorphSources())assert.equal(hash(Buffer.from(m.mesh.geometry.attributes.position.array.buffer)),baseline.get(m.mesh.name),'roads-off differs from live bridge '+m.mesh.name);
  }
  const before=new Map(b.userData.roadMorphSources().map(m=>[m.mesh.name,{geometry:m.mesh.geometry,hash:hash(Buffer.from(m.mesh.geometry.attributes.position.array.buffer))}]));
  const raw=gunzipSync(fs.readFileSync(path.join(dir,'bridge-decks.bin.gz'))),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  assert.equal(hash(fs.readFileSync(path.join(dir,'bridge-decks.bin.gz'))),manifest.bridgeSHA256);
  let steps=0;for(const _ of b.userData.prepareRoadWidths(manifest.bridgeMorphs,buffer))steps++;
  assert.equal(steps,manifest.bridgeMorphs.length);b.userData.activateRoadWidths(true);
  assert.ok(b.userData.registry.get('london').data.deckWidthM>10);
  b.userData.setHeightScale(.1);b.userData.setHeightScale(1/1.1);b.userData.activateRoadWidths(false);
  for(const m of b.userData.roadMorphSources()){assert.equal(m.mesh.geometry,before.get(m.mesh.name).geometry);assert.equal(hash(Buffer.from(m.mesh.geometry.attributes.position.array.buffer)),before.get(m.mesh.name).hash);}
  b.userData.clearRoadWidths();assert.ok(b.userData.roadMorphSources().every(m=>m.road===null));
});
