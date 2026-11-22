#!/usr/bin/env node
// Gate 0, city-wide and globally deduplicated. Geometry in scene metres.
// OSM-derived roads/buildings © OpenStreetMap contributors, ODbL 1.0.
// Usage: node scripts/buildings/gate0.mjs --network-module /snapshot/scripts/roads/network.mjs --network-commit HASH [--out docs/building-orientation-gate0.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import proj4 from 'proj4';
import { installNodeEnv,ROOT } from '../bake-node-env.mjs';
import { BNG_REF_E,BNG_REF_N } from '../../src/coordinates.js';
import { isSuppressed } from '../landmarks.mjs';
import { createAirportSuppression } from '../../src/airport-suppression.js';
import * as G from './geom.mjs';
import { createHash } from 'node:crypto';
import { readBuildingRecord } from '../../src/building-record.js';
import { buildingShape } from './shape.mjs';
installNodeEnv();
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,s)=>i%2?a:(a.push([v.replace(/^--/,''),s[i+1]]),a),[]));
if(!args['network-module']||!args['network-commit'])throw new Error('A committed corrected-network snapshot and its hash are required');
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f)));
const {readRoadNetwork}=await import(pathToFileURL(args['network-module']));
const {carriagewayPolygons,split}=await import(pathToFileURL(args['polygon-module']));
const net={roads:readRoadNetwork(args['network-file'])};
const roadPolys=[];
function erode(p){let q=p;for(let i=0;i<p.length&&q.length;i++){const a=p[i],b=p[(i+1)%p.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);q=split(q,v=>(b[0]-a[0])*(v[1]-a[1])-(b[1]-a[1])*(v[0]-a[0])-L)[0];}return q;}
const segments=[];
for(const r of net.roads){if(r.tunnel||r.bridge||r.layer!==0)continue;
 for(const poly of carriagewayPolygons(r)){const inner=erode(poly);if(inner.length)roadPolys.push({poly:inner,g:r.cls<=5?0:1});}
 for(let i=1;i<r.p.length;i++)segments.push([...r.p[i-1],...r.p[i],r.width/2,r.cls<=5?0:1]);}
const ll=([lon,lat])=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return[e-BNG_REF_E,BNG_REF_N-n];};
let railKm=0;
for(const file of ['overground.json','tube-surface.json'])for(const line of read('public/data/'+file).lines)for(const branch of line.branches||[]){
 const p=branch.points.map(ll);
 for(const s of branch.segments||[{i0:0,i1:p.length-1,class:'surface'}]){
  if(/tunnel/.test(s.class))continue;
  for(let i=s.i0+1;i<=Math.min(s.i1,p.length-1);i++){segments.push([...p[i-1],...p[i],9,2]);railKm+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1])/1000;}
 }
}
const cell=64,grid=new Map();
for(let i=0;i<segments.length;i++){
 const [ax,az,bx,bz,h]=segments[i];
 for(let x=Math.floor((Math.min(ax,bx)-h)/cell);x<=Math.floor((Math.max(ax,bx)+h)/cell);x++)for(let z=Math.floor((Math.min(az,bz)-h)/cell);z<=Math.floor((Math.max(az,bz)+h)/cell);z++){
  const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
 }
}
for(const [ax,az,bx,bz,h,g]of segments)if(g===2){const L=Math.hypot(bx-ax,bz-az);if(L>2){const poly=G.rectPoly((ax+bx)/2,(az+bz)/2,L-2,2*(h-1),Math.atan2(bz-az,bx-ax));roadPolys.push({poly,g});}}
const polyGrid=new Map();
for(let i=0;i<roadPolys.length;i++){const f=roadPolys[i],p=f.poly,b=[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];f.box=b;
 for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let z=Math.floor(b[1]/cell);z<=Math.floor(b[3]/cell);z++){const k=x+','+z;if(!polyGrid.has(k))polyGrid.set(k,[]);polyGrid.get(k).push(i);}
}
const polyStamp=new Uint32Array(roadPolys.length);let polySerial=0;
function polygonCandidates(b){polySerial++;const out=[];for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let z=Math.floor(b[1]/cell);z<=Math.floor(b[3]/cell);z++)for(const i of polyGrid.get(x+','+z)||[])if(polyStamp[i]!==polySerial){polyStamp[i]=polySerial;out.push(i);}return out;}
const stamp=new Uint32Array(segments.length);let serial=0;
function candidates(box){serial++;const out=[];
 for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++)for(const i of grid.get(x+','+z)||[])if(stamp[i]!==serial){stamp[i]=serial;out.push(i);}return out;
}
const aabb=polys=>{const b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of polys)for(const [x,z]of p){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],z);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],z);}return b;};
function intrusion(poly,cand){const out=[false,false,false],box=aabb([poly]);for(const i of cand){const f=roadPolys[i],b=f.box;if(out[f.g]||b[2]<box[0]||b[0]>box[2]||b[3]<box[1]||b[1]>box[3])continue;if(G.clipArea(poly,f.poly)>1e-7)out[f.g]=true;}return out;}
const names=['square','oriented','roadAligned','outline','drawnOriented','roadFrameFit'];
const init=()=>({buildings:0,counts:Object.fromEntries(names.map(n=>[n,{roads:0,service:0,rail:0,roadsOrRail:0,all:0}])),iou:{square:0,oriented:0,roadAligned:0,drawnOriented:0,roadFrameFit:0}});
const city=init(),cityBox=init(),placed=new Set(),airport=createAirportSuppression(read('src/airport-data.json'));
const {initThamesMask,isInThames}=await import('../../src/thames-mask.js'),{loadM25Data,initM25Boundary,isInsideM25}=await import('../../src/m25.js');
initThamesMask(read('public/data/thames.json').points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints||m25.points);
const stats={duplicates:0,largeFootprints:0,ringsOver255:0,outlineVertices:0,irregular:0,onRoadOrRail:0};
const files=read('public/data/surface/tiles/manifest.json').tiles.sort((a,b)=>a.file.localeCompare(b.file));
const baked=fs.readFileSync(path.join(ROOT,'public/data/surface/baked/buildings.bin')),bv=new DataView(baked.buffer,baked.byteOffset,baked.byteLength);
let bakeTile=0;
for(const [ti,file]of files.entries()){
 let bakeRecord=0;
 for(const b of read('public/data/surface/tiles/'+file.file).buildings||[]){
  if(!isInsideM25(b.cx,b.cz)||isInThames(b.cx,b.cz)||airport(b)||isSuppressed(b.cx,b.cz))continue;
  const key=`${Math.round(b.cx/5)*5},${Math.round(b.cz/5)*5},${Math.round(b.height)}`;
  if(placed.has(key)){stats.duplicates++;continue;}placed.add(key);
  if(!Number.isFinite(b.height)||!Number.isFinite(b.area)||!(b.area>0))continue;
  const r=buildingShape(b),A=r.area,s=Math.sqrt(b.area),square=G.rectPoly(b.cx,b.cz,s,s,0),oriented=G.rectPoly(r.cx,r.cz,r.w,r.h,r.theta);
  // Query the WHOLE original footprint and both candidate rectangles, not a
  // fixed centroid box. The road index already includes each carriageway width.
  const near=candidates([b.cx-60,b.cz-60,b.cx+60,b.cz+60]);let distance=Infinity,phi=r.theta;
  for(const i of near){const [ax,az,bx,bz,h,g]=segments[i];if(g===1)continue;const d=G.ptSeg(b.cx,b.cz,ax,az,bx,bz)-h;
   if(d<distance){distance=d;phi=Math.atan2(bz-az,bx-ax);}}
  if(distance>50)phi=r.theta;
  // A fitted rectangle in the road frame, scaled to exactly the same true
  // outline area as O1b, including O2b in clearance as well as IoU.
  const rr=G.frameRect(r.ring,phi),scale=Math.sqrt(A/rr.area),road=G.rectPoly(rr.cx,rr.cz,Math.max(rr.w,rr.h)*scale,Math.min(rr.w,rr.h)*scale,phi);
  const dd=12+bakeTile*16,dt={minX:baked.readInt32LE(dd),minZ:baked.readInt32LE(dd+4)},br=readBuildingRecord(bv,baked.readUInt32LE(dd+8)+14*bakeRecord++,dt,2),drawn=G.rectPoly(br.x,br.z,br.width,br.depth,br.theta),frameFit=G.rectPoly(rr.cx,rr.cz,rr.w*scale,rr.h*scale,phi);
  const polys=[square,oriented,road,r.ring,drawn,frameFit],box=aabb(polys),cand=polygonCandidates(box),ins=polys.map(p=>intrusion(p,cand));
  if(box[2]-b.cx>80||b.cx-box[0]>80||box[3]-b.cz>80||b.cz-box[1]>80)stats.largeFootprints++;
  if(r.ring.length>255)stats.ringsOver255++;
  stats.outlineVertices+=r.ring.length;
  let outward=0;const c=Math.cos(r.theta),sn=Math.sin(r.theta);
  for(const [x,z]of r.ring){const u=(x-r.cx)*c+(z-r.cz)*sn,v=-(x-r.cx)*sn+(z-r.cz)*c;outward=Math.max(outward,Math.hypot(Math.max(0,Math.abs(u)-r.w/2),Math.max(0,Math.abs(v)-r.h/2)));}
  const minArea=G.minRect(G.hull(r.ring)).area;
  if(A/minArea<.85&&outward>3)stats.irregular++;
  if((ins[1][0]||ins[1][2])&&!ins[3][0]&&!ins[3][2])stats.onRoadOrRail++;
  const ious={square:G.iou(r.ring,A,square,s*s),oriented:G.iou(r.ring,A,oriented,A),roadAligned:G.iou(r.ring,A,road,A),drawnOriented:G.iou(r.ring,A,drawn,br.width*br.depth),roadFrameFit:G.iou(r.ring,A,frameFit,A)};
  const targets=[city];if(b.cx>=1400&&b.cx<=3400&&b.cz>=-2000&&b.cz<=0)targets.push(cityBox);
  for(const target of targets){target.buildings++;for(let i=0;i<names.length;i++){
   const o=target.counts[names[i]],v=ins[i];for(let g=0;g<3;g++)if(v[g])o[['roads','service','rail'][g]]++;
   if(v[0]||v[2])o.roadsOrRail++;if(v.some(Boolean))o.all++;
  }for(const name in ious)target.iou[name]+=ious[name];}
 }
 if(bakeRecord){if(bakeRecord!==baked.readUInt32LE(12+bakeTile*16+12))throw new Error('bake population differs at '+file.file);bakeTile++;}
 if(ti%50===0)console.log('tile',ti,'buildings',city.buildings);
}
for(const target of [city,cityBox]){for(const n of names){target.counts[n].percent=Object.fromEntries(Object.entries(target.counts[n]).map(([k,v])=>[k,v/target.buildings*100]));}for(const k in target.iou)target.iou[k]/=target.buildings;}
const chosen=city.counts.roadAligned.roadsOrRail<city.counts.oriented.roadsOrRail&&city.iou.roadAligned>=city.iou.oriented-.01?'roadAligned':'oriented';
const out={networkCommit:args['network-commit'],networkSha256:createHash('sha256').update(fs.readFileSync(args['network-file'])).digest('hex'),method:'Globally deduplicated bake population; full-footprint query; outward deviation only; uncapped arrays (no uint8 ring counts). Intrusion = positive-area intersection with the actual corrected carriageway quads eroded inward 1 m on every edge, or the finite drawn rail-bed rectangles eroded 1 m. Segment end caps are finite, not rounded capsules. Bridges/tunnels excluded. Service includes unclassified/other. Rail is the drawn non-tunnel Overground and tube-surface beds, 9 m half-width, as in the research. Road-aligned is fitted at nearest bearing, the long side put on that bearing, then area-preserving.',railKm,segments:segments.length,stats,chosen,city,cityBox};
fs.writeFileSync(path.resolve(ROOT,args.out||'docs/building-orientation-gate0.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
