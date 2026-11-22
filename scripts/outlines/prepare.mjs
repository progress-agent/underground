#!/usr/bin/env node
// Bounded, opt-in real building outlines. Source credits accompany the payload.
// Corrected R snapshot is an explicit input, never another worktree at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { BNG_REF_E,BNG_REF_N } from '../../src/coordinates.js';
import { installNodeEnv,ROOT } from '../bake-node-env.mjs';
import { assertBakeOutput,writeLocal } from '../surface-overlay.mjs';
import { isSuppressed } from '../landmarks.mjs';
import { createAirportSuppression } from '../../src/airport-suppression.js';
import * as G from './geom.mjs';
import { packSet,roofTriangles } from './pack.mjs';
import { surfaceCorridorKind } from './select.mjs';
installNodeEnv();
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,s)=>i%2?a:(a.push([v.replace(/^--/,''),s[i+1]]),a),[]));
if(!args.snapshot||!args.commit)throw new Error('--snapshot and --commit of corrected R network required');
const out=path.join(ROOT,'public/data/surface/baked');
const files=['outlines-a.z.bin','outlines-b.z.bin','outlines-meta.json'];
await assertBakeOutput(out,files,{root:ROOT});
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f)));
const {readRoadNetwork}=await import(pathToFileURL(path.join(args.snapshot,'scripts/roads/network.mjs')));
const {carriagewayPolygons,split}=await import(pathToFileURL(path.join(args.snapshot,'scripts/roads/polygons.mjs')));
const polys=[],kinds=[];
function addCorridor(p,kind){polys.push(p);kinds.push(kind);}
function erode(p){let q=p;for(let i=0;i<p.length&&q.length;i++){const a=p[i],b=p[(i+1)%p.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);q=split(q,v=>(b[0]-a[0])*(v[1]-a[1])-(b[1]-a[1])*(v[0]-a[0])-L)[0];}return q;}
for(const r of readRoadNetwork(path.join(args.snapshot,'network.bin.gz'))){const kind=surfaceCorridorKind(r);if(!kind)continue;
 for(const p of carriagewayPolygons(r)){const q=erode(p);if(q.length>=3)addCorridor(q,kind);}}
const ll=([lon,lat])=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return[e-BNG_REF_E,BNG_REF_N-n];};
for(const f of ['overground.json','tube-surface.json'])for(const line of read('public/data/'+f).lines)for(const b of line.branches||[]){
 const p=b.points.map(ll);for(const s of b.segments||[{i0:0,i1:p.length-1,class:'surface'}]){if(/tunnel/.test(s.class))continue;
 for(let i=s.i0+1;i<=Math.min(s.i1,p.length-1);i++){const a=p[i-1],b=p[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L>2)addCorridor(G.rectPoly((a[0]+b[0])/2,(a[1]+b[1])/2,L-2,16,Math.atan2(b[1]-a[1],b[0]-a[0])),'rail');}}}
const box=p=>[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))];
const grid=new Map(),cell=64;
polys.forEach((p,i)=>{const b=box(p);for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let z=Math.floor(b[1]/cell);z<=Math.floor(b[3]/cell);z++){const k=x+','+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}});
function candidates(p){const b=box(p),ids=new Set();for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let z=Math.floor(b[1]/cell);z<=Math.floor(b[3]/cell);z++)for(const i of grid.get(x+','+z)||[])ids.add(i);return ids;}
function intrusionKinds(p,ids){const hits=new Set();for(const i of ids)if(!hits.has(kinds[i])&&G.clipArea(p,polys[i])>1e-7)hits.add(kinds[i]);return hits;}
const {initThamesMask,isInThames}=await import('../../src/thames-mask.js');
const {loadM25Data,initM25Boundary,isInsideM25}=await import('../../src/m25.js');
initThamesMask(read('public/data/thames.json').points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints||m25.points);
const airport=createAirportSuppression(read('src/airport-data.json'));
// The current bake supplies height/base without a second terrain implementation.
const baked=fs.readFileSync(path.join(out,'buildings.bin')),bv=new DataView(baked.buffer,baked.byteOffset,baked.byteLength);
const version=bv.getUint16(4,true),rb=version===1?10:14,bases=new Map();
for(let t=0;t<bv.getUint16(6,true);t++){const d=12+t*16,off=bv.getUint32(d+8,true),n=bv.getUint32(d+12,true),a=[];
 for(let i=0;i<n;i++){const o=off+i*rb;a.push({height:bv.getUint16(o+4,true)*.1,base:bv.getInt16(o+8,true)*.1});}bases.set(t,a);}
const placed=new Set(),sets={a:[],b:[]},eligible={a:0,b:0},invalidRoofs={a:[],b:[]},onRoadBreakdown={roads:0,service:0,other:0,rail:0,legacyNarrowUnion:0};let tileIndex=0,population=0,ringsOver255=0;
for(const tile of read('public/data/surface/tiles/manifest.json').tiles.sort((a,b)=>a.file.localeCompare(b.file))){
 let ordinal=0;
 for(const b of read('public/data/surface/tiles/'+tile.file).buildings||[]){
  if(!isInsideM25(b.cx,b.cz)||isInThames(b.cx,b.cz)||airport(b)||isSuppressed(b.cx,b.cz))continue;
  const key=`${Math.round(b.cx/5)*5},${Math.round(b.cz/5)*5},${Math.round(b.height)}`;
  if(placed.has(key))continue;placed.add(key);
  if(!Number.isFinite(b.height)||!Number.isFinite(b.area)||b.area<=0)continue;
  const base=bases.get(tileIndex)?.[ordinal];if(!base)throw new Error('source and bake population differ');
  const recOrdinal=ordinal++;population++;
  const ring=G.cleanRing(b.footprint||[]),area=Math.abs(G.signedArea(ring));
  if(ring.length<3||area<.5)continue;if(G.signedArea(ring)<0)ring.reverse();
  const r=G.minRect(G.hull(ring)),scale=Math.sqrt(area/r.area),w=r.w*scale,h=r.h*scale;
  const rect=G.rectPoly(r.cx,r.cz,w,h,r.theta),ids=candidates([...ring,...rect]);
  const rectHits=intrusionKinds(rect,ids),ringHits=rectHits.size?intrusionKinds(ring,ids):new Set();
  const onRoad=rectHits.size>0&&ringHits.size===0;
  if(onRoad)for(const kind of rectHits)onRoadBreakdown[kind]++;
  if((rectHits.has('roads')||rectHits.has('rail'))&&!ringHits.has('roads')&&!ringHits.has('rail'))onRoadBreakdown.legacyNarrowUnion++;
  const c=Math.cos(r.theta),s=Math.sin(r.theta);let outward=0;
  for(const [x,z]of ring){const u=(x-r.cx)*c+(z-r.cz)*s,v=-(x-r.cx)*s+(z-r.cz)*c;outward=Math.max(outward,Math.hypot(Math.max(0,Math.abs(u)-w/2),Math.max(0,Math.abs(v)-h/2)));}
  const irregular=area/r.area<.85&&outward>3;
  if(onRoad||irregular){
    if(onRoad)eligible.a++;if(irregular)eligible.b++;
    const roof=roofTriangles(ring);
    if(!roof.valid){const problem={source:[b.cx,b.cz],area:roof.area,roofArea:roof.roof};if(onRoad)invalidRoofs.a.push(problem);if(irregular)invalidRoofs.b.push(problem);continue;}
    const rec={x:b.cx,z:b.cz,rectX:r.cx,rectZ:r.cz,...base,ring,tile:tileIndex,ordinal:recOrdinal};if(onRoad)sets.a.push(rec);if(irregular)sets.b.push(rec);if(ring.length>255)ringsOver255++;
  }
 }
 if(ordinal)tileIndex++;
 if(tileIndex%50===0)console.log('tiles',tileIndex,'population',population,'a',sets.a.length,'b',sets.b.length);
}
const meta={version:1,source:'© OpenStreetMap contributors, ODbL 1.0; © Microsoft Building Footprints, CDLA Permissive 2.0',sourceUrls:['https://www.openstreetmap.org/copyright','https://github.com/microsoft/GlobalMLBuildingFootprints#license'],networkCommit:args.commit,population,ringsOver255,eligible,invalidRoofs,onRoadBreakdown:{...onRoadBreakdown,union:eligible.a,note:'Group counts are globally-clear eligible buildings cutting each corridor kind; overlaps can count in more than one group. Legacy narrow union ignores service/other for both rectangle and ring.'},corridors:kinds.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{}),
 method:'O1b minimum-area rectangle, scaled about its centre to true outline area. A: positive-area intersection with all corrected surface carriageway classes (including service/other) or drawn rail polygons eroded 1m, real ring clear of the entire union. Bridges/tunnels/nonzero road layers excluded to avoid projected crossings. B: area/MBR <0.85 and outward-only deviation >3m. Global bake dedup; whole-footprint query; full rings, no simplification.',sets:{}};
for(const name of ['a','b']){const raw=packSet(sets[name]),zip=gzipSync(raw,{level:6});await writeLocal(path.join(out,`outlines-${name}.z.bin`),zip,{root:ROOT});
 meta.sets[name]={buildings:sets[name].length,ringVertices:sets[name].reduce((s,b)=>s+b.ring.length,0),rawBytes:raw.length,gzipBytes:zip.length,sha256:createHash('sha256').update(raw).digest('hex')};}
await writeLocal(path.join(out,'outlines-meta.json'),JSON.stringify(meta,null,2)+'\n',{root:ROOT});console.log(JSON.stringify(meta,null,2));
