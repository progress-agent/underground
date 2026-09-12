import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import UPNG from 'upng-js';
import dtm from '../public/data/terrain/airport-dtm.json' with {type:'json'};
import airports from '../src/airport-data.json' with {type:'json'};
import {validateAirportTerrainCorrections,applyAirportTerrainCorrections,sampleTerrainCorrection,tryCreateTerrainMesh,getTerrainMeshSurfaceY,getTerrainBounds,TERRAIN_ORIGIN_BNG,AIRPORT_TERRAIN_URL} from '../src/terrain.js';
import {decodeAirportElevationTiff} from '../scripts/prepare-airport-dtm.mjs';
import {installNodeEnv,ROOT} from '../scripts/bake-node-env.mjs';
import {initThamesMask} from '../src/thames-mask.js';

test('all nine bounded airport exports contain physical samples and reject incomplete or mislocated data',()=>{
 expect(validateAirportTerrainCorrections(dtm)).toBe(dtm);
 expect(dtm.patches.reduce((n,p)=>n+p.elevations.length,0)).toBe(176000);
 expect(dtm.patches[0].sourceSha256).toBe('b9a514279c6058d4f8a28ad40a1c036e43f8963a114df59d90336ce1fd4affee');
 for(const change of [{units:'intensity'},{datum:'unknown'},{bounds_m:[504025,173000,511025,178000]},{elevations:[-3.4028235e38]}])expect(()=>validateAirportTerrainCorrections({...dtm,patches:[{...dtm.patches[0],...change},...dtm.patches.slice(1)]})).toThrow();
 expect(()=>validateAirportTerrainCorrections({...dtm,patches:dtm.patches.slice(1)})).toThrow();
 expect(()=>decodeAirportElevationTiff(Buffer.from('<html>Not found</html>'),dtm.patches[0].bounds_m)).toThrow();
});

test('source pixel centres and covered blend boundaries are correct, with full-weight mapped campuses',()=>{
 for(const p of dtm.patches){
  const [w,s,e,n]=p.bounds_m;
  for(const [row,col]of [[0,0],[p.height-1,p.width-1],[Math.floor(p.height/2),Math.floor(p.width/2)]])expect(sampleTerrainCorrection(p,w+(col+.5)*25,n-(row+.5)*25).elevation).toBe(p.elevations[row*p.width+col]);
  expect(sampleTerrainCorrection(p,w-1,(s+n)/2)).toBeNull();
  expect(sampleTerrainCorrection(p,w,(s+n)/2).weight).toBe(0);
  expect(sampleTerrainCorrection(p,w+.001,(s+n)/2).weight).toBeLessThan(1e-9);
  expect(sampleTerrainCorrection(p,w+250,(s+n)/2).weight).toBe(1);
  const a=airports.airports.find(a=>a.id===p.id);
  for(const f of [...a.buildings,...a.runways])for(const [x,z]of f.points)expect(sampleTerrainCorrection(p,x+TERRAIN_ORIGIN_BNG[0],TERRAIN_ORIGIN_BNG[1]-z)?.weight).toBe(1);
 }
});

test('patch application preserves every source pixel outside verified coverage',async()=>{
 const meta=JSON.parse(await readFile(`${ROOT}/public/data/terrain/london_full_height.json`,'utf8'));
 const bytes=await readFile(`${ROOT}/public/data/terrain/london_full_height_u16.png`),png=UPNG.decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),raw=new Uint8Array(png.data);
 const original=Float32Array.from({length:png.width*png.height},(_,i)=>((raw[i*2]<<8)|raw[i*2+1])/65535),hm={width:png.width,height:png.height,floats:original.slice()};
 const results=applyAirportTerrainCorrections(hm,meta,dtm);expect(results.every(p=>p.correctedSamples>1000)).toBe(true);
 let exterior=0,interior=0,maxPhysicalError=0;
 for(let row=0;row<png.height;row++)for(let col=0;col<png.width;col++){
  const e=490000+col/(png.width-1)*70000,n=205000-row/(png.height-1)*50000,index=row*png.width+col;
  const p=dtm.patches.find(p=>e>=p.bounds_m[0]&&e<=p.bounds_m[2]&&n>=p.bounds_m[1]&&n<=p.bounds_m[3]);
  if(!p){exterior++;if(hm.floats[index]!==original[index])throw Error(`Unverified exterior changed at ${e},${n}`);continue;}
  const sample=sampleTerrainCorrection(p,e,n);if(sample.weight===1){interior++;maxPhysicalError=Math.max(maxPhysicalError,Math.abs(hm.floats[index]*meta.elev_max_m-sample.elevation));}
 }
 expect(exterior).toBeGreaterThan(1300000);expect(interior).toBeGreaterThan(20000);expect(maxPhysicalError).toBeLessThan(.0001);
});

test('Heathrow roof mound is removed from actual triangles and all campus queries match ray intersections',async()=>{
 installNodeEnv();const thames=JSON.parse(await readFile(`${ROOT}/public/data/thames.json`,'utf8'));initThamesMask(thames.points);
 const terrain=await tryCreateTerrainMesh({thamesData:thames});expect(terrain).toBeTruthy();expect(terrain.meta.airportTerrainCorrections).toHaveLength(9);
 expect(getTerrainBounds().bounds_m).toEqual([490000,151093.75,560000,205000]);expect(getTerrainBounds().originBNG).toEqual(TERRAIN_ORIGIN_BNG);
 expect(getTerrainMeshSurfaceY({x:-21169.41,z:4701.585})/5).toBeCloseTo(22.889,2);
 terrain.mesh.updateMatrixWorld(true);
 let maxResidual=0;
 for(const a of airports.airports){const patch=dtm.patches.find(p=>p.id===a.id);for(const b of a.buildings){
  const x=(Math.min(...b.points.map(p=>p[0]))+Math.max(...b.points.map(p=>p[0])))/2,z=(Math.min(...b.points.map(p=>p[1]))+Math.max(...b.points.map(p=>p[1])))/2;
  const expected=sampleTerrainCorrection(patch,x+TERRAIN_ORIGIN_BNG[0],TERRAIN_ORIGIN_BNG[1]-z).elevation,y=getTerrainMeshSurfaceY({x,z});maxResidual=Math.max(maxResidual,Math.abs(y/5-expected));
  const hit=new THREE.Raycaster(new THREE.Vector3(x,5000,z),new THREE.Vector3(0,-1,0)).intersectObject(terrain.mesh)[0];expect(hit).toBeTruthy();expect(y).toBeCloseTo(hit.point.y,5);
 }}
 // The retained 137x98m render grid approximates the 25m source; this is not a survey precision claim.
 expect(maxResidual).toBeLessThan(1.6);
 terrain.mesh.geometry.dispose();terrain.undersideMesh.geometry.dispose();terrain.topMat.dispose();terrain.undersideMat.dispose();
});

test('missing required airport correction rejects terrain construction',async()=>{
 installNodeEnv();const saved=globalThis.fetch,error=console.error;let reported='';
 globalThis.fetch=async url=>String(url)===AIRPORT_TERRAIN_URL?{ok:false}:saved(url);console.error=(...args)=>{reported+=args.join(' ');};
 try{expect(await tryCreateTerrainMesh()).toBeNull();expect(reported).toContain('Required airport DTM corrections unavailable');}finally{globalThis.fetch=saved;console.error=error;}
});

test('every runway vertex of all nine fields is enclosed by the actual mapped M25/A282 ring',async()=>{
 const ring=JSON.parse(await readFile(`${ROOT}/public/data/m25.json`,'utf8')).points;
 const inside=(x,z)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i].n>z)!==(ring[j].n>z)&&x<(ring[j].e-ring[i].e)*(z-ring[i].n)/(ring[j].n-ring[i].n)+ring[i].e)hit=!hit;return hit;};
 for(const a of airports.airports)for(const r of a.runways)for(const [x,z]of r.points)expect(inside(x+TERRAIN_ORIGIN_BNG[0],TERRAIN_ORIGIN_BNG[1]-z),`${a.id} ${r.name}`).toBe(true);
});
