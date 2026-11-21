import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {installNodeEnv,ROOT} from '../scripts/bake-node-env.mjs';
import {decodeRoadBlock,createRoadMaterial} from '../src/roads.js';

test('desktop and phone road triangle interiors clear all dry banks within 100m of the four repaired feet',async()=>{
  installNodeEnv();
  const terrain=await import('../src/terrain.js');
  const {initThamesMask}=await import('../src/thames-mask.js');
  const {loadM25Data,initM25Boundary}=await import('../src/m25.js');
  const {getMapEdgeRing}=await import('../src/m25-edge.js');
  const {createDeepWaterSteps}=await import('../src/deep-water.js');
  const thamesData=JSON.parse(fs.readFileSync(`${ROOT}/public/data/thames.json`));
  initThamesMask(thamesData.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints??m25.points);
  await terrain.tryCreateTerrainMesh({thamesData});
  const data=JSON.parse(fs.readFileSync(`${ROOT}/public/data/deep-water.json`));
  const steps=createDeepWaterSteps({...data,bodies:data.bodies.map(b=>({...b,seaLife:false}))},terrain.getTerrainMeshSurfaceY,getMapEdgeRing());
  let done;do{done=steps.next();}while(!done.done);
  const all=done.value.bodies.filter(b=>b.bankMesh),targets=all.filter(b=>/William Girling|Staines|Bessborough/.test(b.spec.name));
  const counts=new Map(targets.map(b=>[b.spec.name,0]));
  const distance=(x,z,ring)=>{let min=Infinity;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));min=Math.min(min,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}return min;};
  const regions=targets.map(b=>{const x=b.outer.map(p=>p[0]),z=b.outer.map(p=>p[1]);return{bank:b,box:[Math.min(...x)-101,Math.min(...z)-101,Math.max(...x)+101,Math.max(...z)+101]};});
  const material=createRoadMaterial(),manifest=JSON.parse(fs.readFileSync(`${ROOT}/public/data/roads/manifest.json`));
  let checked=0;
  try{for(const r of manifest.records){
    if(!regions.some(({box:b})=>r.x+r.size+128>=b[0]&&r.x-128<=b[2]&&r.z+r.size+128>=b[1]&&r.z-128<=b[3]))continue;
    const raw=gunzipSync(fs.readFileSync(`${ROOT}/public/data/roads/${r.file}`));
    const mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),material,material,r);
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
    for(let i=0;i<index.count;i+=3){
      const t=[0,1,2].map(k=>{const j=index.getX(i+k);return[mesh.position.x+p.getX(j)*.125,mesh.position.z+p.getZ(j)*.125,mesh.position.y+p.getY(j)*.05,(mesh.geometry.attributes.roadRise?.getX(j)??0)*.05];});
      if(!regions.some(({box:b})=>t.some(v=>v[0]>=b[0]&&v[0]<=b[2]&&v[1]>=b[1]&&v[1]<=b[3])))continue;
      for(const w of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){
        const [x,z,y,rise]=[0,1,2,3].map(k=>t.reduce((s,v,j)=>s+v[k]*w[j],0));
        const near=regions.filter(({bank,box:b})=>x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&distance(x,z,bank.outer)<=100);
        if(!near.length)continue;
        const support=Math.max(terrain.getTerrainMeshSurfaceY({x,z}),...all.map(b=>b.bankAt(x,z)??-Infinity)),clearance=(y-support)/5;
        assert.ok(clearance>=-.1&&clearance-rise/5<=.5,`${r.file} face ${i/3}: ${clearance}m at ${x},${z}`);
        for(const {bank} of near)counts.set(bank.spec.name,counts.get(bank.spec.name)+1);
        checked++;
      }
    }
    mesh.geometry.dispose();mesh.userData.roadFarGeometry?.dispose();
  }}finally{material.dispose();}
  assert.ok(checked>1000);for(const [name,n]of counts)assert.ok(n>100,`${name}: insufficient samples`);
});
