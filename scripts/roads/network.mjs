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
export function dimensions(tags, cls) {
  const width = metres(tags['width:carriageway']) ?? metres(tags.width) ?? WIDTHS[cls];
  // DfT Inclusive Mobility's 2m preferred unobstructed width, used as an informed estimate,
  // not a survey. 'separate' still has a pavement: separately mapped footways are excluded.
  const defaults = cls >= 2 && cls <= 5;
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
export function buildNetwork(root,ring) {
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
      roads.push({id:w.id,name:t.name??null,cls,...dimensions(t,cls),bridge:!!t.bridge&&t.bridge!=='no',tunnel,layer:Math.max(-10,Math.min(10,parseInt(t.layer)||0)),p:simplify(run).map(p=>p.map(v=>Math.round(v*100)/100))});
    }
  }
  return {roads,stats:{blocks:files.length,uniqueWays:ways.size,km:km.map(v=>+v.toFixed(3)),totalKm:+km.reduce((a,b)=>a+b,0).toFixed(3),tunnelKm:+tunnelKm.toFixed(3),widthTags}};
}
