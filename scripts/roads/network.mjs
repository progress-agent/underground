// Offline deterministic OSM network, retaining tags needed by the renderer and future vehicles.
// Data © OpenStreetMap contributors, ODbL 1.0. See docs/roads.md.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../../src/coordinates.js';
export const CLASSES = ['motorway','trunk','primary','secondary','tertiary','residential','service','other'];
export const WIDTHS = [12,10,9,8,7,6,3.5,4.5];
const classOf = {motorway:0,motorway_link:0,trunk:1,trunk_link:1,primary:2,primary_link:2,secondary:3,secondary_link:3,tertiary:4,tertiary_link:4,residential:5,service:6,unclassified:7,living_street:7,road:7,pedestrian:7,track:7};
export function metres(value) {
  if (value === undefined) return null;
  const s = String(value).trim(), m = s.match(/^(\d+(?:\.\d+)?)\s*(m|ft|')?$/);
  if (!m) return null;
  const n = +m[1] * (m[2] === 'ft' || m[2] === "'" ? .3048 : 1);
  return n > 0 && n < 100 ? n : null;
}
// 3.2m per lane is the sprint acceptance spec’s informed urban-lane estimate,
// D-062, not a survey of each carriageway.
export const LANE_WIDTH_M = 3.2;
export const isOneWay = tags => ['yes','1','true','-1'].includes(String(tags.oneway)) || tags.junction === 'roundabout';
export function dimensions(tags, cls, {legacy=false}={}) {
  const lanes = /^\d+(?:\.\d+)?$/.test(String(tags.lanes)) ? +tags.lanes : 0;
  const width = metres(tags['width:carriageway']) ?? metres(tags.width)
    ?? (lanes > 0 && lanes < 20 ? lanes * LANE_WIDTH_M : WIDTHS[cls] * (isOneWay(tags) ? .5 : 1));
  // DfT Inclusive Mobility's 2m preferred unobstructed width, used as an informed estimate,
  // not a survey. 'separate' still has a pavement: separately mapped footways are excluded.
  const defaults = (cls >= 2 && cls <= 5) || (!legacy && cls === 1 && isOneWay(tags));
  const side = which => {
    const flag = tags[`sidewalk:${which}`] ?? tags['sidewalk:both'] ?? tags.sidewalk;
    const no = ['no','none',which === 'left' ? 'right' : 'left'].includes(flag);
    const yes = ['yes','both','separate',which].includes(flag);
    if (no || (!yes && !defaults)) return 0;
    return Math.min(5, metres(tags[`sidewalk:${which}:width`]) ?? metres(tags['sidewalk:both:width']) ?? metres(tags['sidewalk:width']) ?? 2);
  };
  return {width,left:side('left'),right:side('right')};
}
export function inside(ring,x,z) {
  let c = false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) c=!c;
  }
  return c;
}
// Exact clipping, accelerated with 200m buckets. Boundary segments are tested against actual edges,
// rather than accepting whole OSM segments by their midpoint as the October sizing proof did.
export function clipper(ring) {
  const buckets=new Map(), cell=200;
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length];
    for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
      for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++) {
        const k=x+','+z; if(!buckets.has(k)) buckets.set(k,[]); buckets.get(k).push(i);
      }
  }
  const states=new Map();
  const contains=(x,z)=>{ const k=Math.floor(x/cell)+','+Math.floor(z/cell); if(buckets.has(k))return inside(ring,x,z); if(!states.has(k))states.set(k,inside(ring,x,z));return states.get(k); };
  return pts=>{
    const out=[];let current=null;
    for(let i=1;i<pts.length;i++) {
      const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dz=b[1]-a[1],ts=[0,1],edges=new Set();
      for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
        for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++)
          for(const e of buckets.get(x+','+z)??[])edges.add(e);
      for(const e of edges){const c=ring[e],d=ring[(e+1)%ring.length],ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-10)continue;
        const t=((c[0]-a[0])*ez-(c[1]-a[1])*ex)/den,u=((c[0]-a[0])*dz-(c[1]-a[1])*dx)/den;if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);}
      ts.sort((a,b)=>a-b);
      for(let j=1;j<ts.length;j++) {const lo=ts[j-1],hi=ts[j];if(hi-lo<1e-9)continue;
        if(!contains(a[0]+dx*(lo+hi)/2,a[1]+dz*(lo+hi)/2)){current=null;continue;}
        const p=[a[0]+dx*lo,a[1]+dz*lo],q=[a[0]+dx*hi,a[1]+dz*hi];
        if(!current){current=[p];out.push(current);}current.push(q);
      }
    }
    return out;
  };
}
export function simplify(p,tol=1) {
  if(p.length<3)return p;
  const keep=new Uint8Array(p.length);keep[0]=keep[p.length-1]=1;const stack=[[0,p.length-1]];
  while(stack.length){const[a,b]=stack.pop(),dx=p[b][0]-p[a][0],dz=p[b][1]-p[a][1],l=dx*dx+dz*dz;let max=tol*tol,at=-1;
    for(let i=a+1;i<b;i++){const t=l?Math.max(0,Math.min(1,((p[i][0]-p[a][0])*dx+(p[i][1]-p[a][1])*dz)/l)):0;const d=(p[i][0]-p[a][0]-dx*t)**2+(p[i][1]-p[a][1]-dz*t)**2;if(d>max){max=d;at=i;}}
    if(at>=0){keep[at]=1;stack.push([a,at],[at,b]);}}
  return p.filter((_,i)=>keep[i]);
}
export function buildNetwork(root,ring,{legacy=false}={}) {
  const ways=new Map(),cache=path.join(root,'scripts/.cache/roads-overpass');
  const files=fs.readdirSync(cache).filter(f=>/^blk_.*\.json\.gz$/.test(f)).sort();
  if(files.length!==80)throw new Error(`Expected October's 80 cached OSM blocks, got ${files.length}`);
  for(const f of files) for(const w of JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(cache,f)))).elements)
    if(w.type==='way'&&w.geometry?.length>1&&!ways.has(w.id))ways.set(w.id,w);
  const clip=clipper(ring),roads=[],km=Array(8).fill(0);let tunnelKm=0,widthTags=0;
  for(const w of [...ways.values()].sort((a,b)=>a.id-b.id)) {
    const t=w.tags??{},cls=classOf[t.highway];if(cls===undefined||/(^|;)(M25|A282)(;|$)/.test(t.ref??''))continue;
    const p=w.geometry.map(p=>{const[e,n]=proj4('EPSG:4326','EPSG:27700',[p.lon,p.lat]);return[e-BNG_REF_E,BNG_REF_N-n];});
    for(const run of clip(p)){
      let length=0;for(let i=1;i<run.length;i++)length+=Math.hypot(run[i][0]-run[i-1][0],run[i][1]-run[i-1][1]);
      const tunnel=!!t.tunnel&&t.tunnel!=='no'&&t.tunnel!=='building_passage';
      if(tunnel)tunnelKm+=length/1000;else km[cls]+=length/1000;
      if(t.width)widthTags++;
      roads.push({id:w.id,name:t.name??null,ref:t.ref??null,oneway:isOneWay(t),direction:t.oneway==='-1'?-1:1,roundabout:t.junction==='roundabout',widthSource:metres(t['width:carriageway'])??metres(t.width)?'width':+t.lanes>0?'lanes':isOneWay(t)?'oneway-class':'class',cls,...(legacy?{...dimensions(t,cls,{legacy:true}),width:metres(t['width:carriageway'])??metres(t.width)??WIDTHS[cls]}:dimensions(t,cls)),bridge:!!t.bridge&&t.bridge!=='no',tunnel,layer:Math.max(-10,Math.min(10,parseInt(t.layer)||0)),p:simplify(run).map(p=>p.map(v=>Math.round(v*100)/100))});
    }
  }
  return {roads,stats:{...(legacy?{}:pairCarriageways(roads)),blocks:files.length,uniqueWays:ways.size,km:km.map(v=>+v.toFixed(3)),totalKm:+km.reduce((a,b)=>a+b,0).toFixed(3),tunnelKm:+tunnelKm.toFixed(3),widthTags}};
}

// Match opposing, parallel one-way carriageways at their segment midpoints. Require
// a shared road name/ref, same layer and a 3..40m separation. Roundabouts are not pairs.
// Untagged unpaired one-way halves use the UK traffic kerbside (left in the
// direction of travel); explicit paired geometry still determines the outer side.
export function pairCarriageways(roads) {
  const cells=new Map(), cell=80, segments=[];
  for(const r of roads)if(r.oneway&&!r.roundabout&&!r.tunnel)for(let i=1;i<r.p.length;i++){
    const a=r.p[i-1],b=r.p[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<1)continue;
    const s={r,a,b,L,dx:(b[0]-a[0])/L,dz:(b[1]-a[1])/L};segments.push(s);
    for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)
      for(let z=Math.floor(Math.min(a[1],b[1])/cell);z<=Math.floor(Math.max(a[1],b[1])/cell);z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(s);
      }
  }
  const votes=new Map();
  for(const s of segments){const x=(s.a[0]+s.b[0])/2,z=(s.a[1]+s.b[1])/2;let best=null,distance=40;
    for(let ix=Math.floor((x-40)/cell);ix<=Math.floor((x+40)/cell);ix++)for(let iz=Math.floor((z-40)/cell);iz<=Math.floor((z+40)/cell);iz++)for(const t of cells.get(ix+','+iz)??[]){
      if(t.r.id===s.r.id||t.r.cls!==s.r.cls||t.r.layer!==s.r.layer||t.r.bridge!==s.r.bridge)continue;
      if(!(s.r.name&&s.r.name===t.r.name)&&!(s.r.ref&&s.r.ref===t.r.ref))continue;
      if((s.dx*t.dx+s.dz*t.dz)*s.r.direction*t.r.direction>-.9)continue;
      const u=((x-t.a[0])*t.dx+(z-t.a[1])*t.dz)/t.L;if(u<0||u>1)continue;
      const qx=t.a[0]+u*t.L*t.dx,qz=t.a[1]+u*t.L*t.dz,d=Math.hypot(qx-x,qz-z);
      if(d<3||d>=distance)continue;distance=d;best={side:(qx-x)*(-s.dz)+(qz-z)*s.dx>0?'right':'left',id:t.r.id};
    }
    if(best){if(!votes.has(s.r))votes.set(s.r,{left:0,right:0,ids:new Set()});const v=votes.get(s.r);v[best.side]+=s.L;v.ids.add(best.id);}
  }
  const paired=new Set(),unpaired=new Set();
  for(const r of roads)if(r.oneway&&!r.tunnel){const v=votes.get(r);
    if(v){r[v.right>v.left?'right':'left']=0;r.pairedWith=[...v.ids].sort((a,b)=>a-b);paired.add(r.id);}
    else {
      // R2: no width or lanes means half a class carriageway and one outer
      // pavement. Keep explicitly tagged widths/lanes on their existing rule.
      if(r.widthSource==='oneway-class')r[r.direction===-1?'left':'right']=0;
      unpaired.add(r.id);
    }
  }
  return {pairedOneWayWays:paired.size,unpairedOneWayWays:unpaired.size};
}

// The committed UGN1 file already contains corrected widths and paired-pavement
// decisions. No OSM fetch or terrain boot is needed to consume it in another lane.
export function readRoadNetwork(file) {
  const b=zlib.gunzipSync(fs.readFileSync(file));
  if(b.toString('ascii',0,4)!=='UGN1')throw Error('Invalid UGN1 network');
  const n=b.readUInt32LE(4),roads=[];let at=8;
  for(let i=0;i<n;i++){
    const id=b.readUInt32LE(at),flags=b[at+4],cls=flags&7,layer=b.readInt8(at+5),width=b.readUInt16LE(at+6)/100,left=b.readUInt16LE(at+8)/100,right=b.readUInt16LE(at+10)/100,count=b.readUInt32LE(at+12);at+=16;
    const p=[];for(let j=0;j<count;j++){p.push([b.readInt32LE(at)/100,b.readInt32LE(at+4)/100]);at+=8;}
    roads.push({id,cls,layer,width,left,right,bridge:!!(flags&16),tunnel:!!(flags&32),p});
  }
  if(at!==b.length)throw Error('UGN1 trailing/short data');return roads;
}
