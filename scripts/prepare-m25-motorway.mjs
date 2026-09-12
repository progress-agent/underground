import fs from 'node:fs';
import proj4 from 'proj4';
const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/prepare-m25-motorway.mjs /path/to/m25-a282-osm.json');
const raw=JSON.parse(fs.readFileSync(input));
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const origin=proj4('EPSG:4326','EPSG:27700',[-.1278,51.5074]);
const project=p=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[p.lon,p.lat]);return [+(e-origin[0]).toFixed(2),+(origin[1]-n).toFixed(2)];};
let core=raw.elements.filter(e=>e.type==='way'&&e.geometry&&e.tags.oneway==='yes');
for(;;){const starts=new Set(core.map(e=>e.nodes[0])),ends=new Set(core.map(e=>e.nodes.at(-1)));const next=core.filter(e=>ends.has(e.nodes[0])&&starts.has(e.nodes.at(-1)));if(next.length===core.length)break;core=next;}
const outgoing=new Map();for(const e of core){if(!outgoing.has(e.nodes[0]))outgoing.set(e.nodes[0],[]);outgoing.get(e.nodes[0]).push(e);}
const cycles=[],covered=new Set();
for(const first of core){if(covered.has(first.id))continue;const start=first.nodes[0],visited=new Set([start]);const walk=(node,path)=>{for(const e of outgoing.get(node)||[]){const end=e.nodes.at(-1);if(end===start){if(path.length>200){const route=[...path,e];cycles.push(route);for(const w of route)covered.add(w.id);}continue;}if(visited.has(end)||path.length>1000)continue;visited.add(end);walk(end,[...path,e]);visited.delete(end);}};walk(start,[]);if(cycles.length>128)throw new Error('Unexpected motorway cycle multiplicity');}
if(cycles.length<2)throw new Error('No complete directed motorway circuits; do not invent joins');
const wayMap=new Map();for(const route of cycles)for(const e of route)wayMap.set(e.id,{id:e.id,ref:e.tags.ref,highway:e.tags.highway,name:e.tags.name||'',lanes:Math.min(6,Math.max(2,parseInt(e.tags.lanes)||3)),lanesSource:e.tags.lanes?'OSM tag':'authored 3-lane default',bridge:e.tags.bridge||null,tunnel:e.tags.tunnel==='yes',layer:Number(e.tags.layer)||0,points:e.geometry.map(project)});
const ways=[...wayMap.values()];const byId=new Map(ways.map(w=>[w.id,w]));
const routePoints=r=>r.flatMap((e,i)=>byId.get(e.id).points.slice(i?1:0));
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const routes=cycles.map((r,i)=>{const p=routePoints(r),length=p.slice(1).reduce((s,b,i)=>s+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);return {id:`circuit-${i}`,direction:area(p)>0?'clockwise':'anticlockwise',wayIds:r.map(e=>e.id),lengthM:+length.toFixed(1),signedArea:area(p)};});
// Collapse equivalent cyclic rotations only. Alternative Dartford bores remain distinct routes.
const unique=routes.filter((r,i)=>!routes.slice(0,i).some(a=>a.wayIds.length===r.wayIds.length&&a.wayIds.every(id=>r.wayIds.includes(id))));
const outer=unique.reduce((a,b)=>Math.abs(a.signedArea)>Math.abs(b.signedArea)?a:b);const ring=outer.wayIds.flatMap((id,i)=>byId.get(id).points.slice(i?1:0));
// Douglas-Peucker simplification to 3m keeps the motorway boundary below pavement-width error.
function simplify(p,tol=3){if(p.length<=2)return p;const a=p[0],b=p.at(-1),dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;let best=tol*tol,index=0;for(let i=1;i<p.length-1;i++){const t=l?Math.max(0,Math.min(1,((p[i][0]-a[0])*dx+(p[i][1]-a[1])*dz)/l)):0,d=(p[i][0]-a[0]-t*dx)**2+(p[i][1]-a[1]-t*dz)**2;if(d>best){best=d;index=i;}}if(!index)return [a,b];return [...simplify(p.slice(0,index+1),tol).slice(0,-1),...simplify(p.slice(index),tol)];}
const mid=Math.floor(ring.length/2);const simple=[...simplify(ring.slice(0,mid+1)).slice(0,-1),...simplify(ring.slice(mid))];
const data={version:1,attribution:'© OpenStreetMap contributors, ODbL 1.0',source:'https://www.openstreetmap.org/copyright',sourceTimestamp:raw.osm3s?.timestamp_osm_base,coordinateContract:'Canonical BNG metres relative to projected WGS84 51.5074,-0.1278; x east,z south; no vertical scaling',originBNG:origin,roads:ways,routes:unique,boundary:{routeId:outer.id,points:simple,toleranceM:3,supportMarginM:40,note:'Outer directed carriageway centreline. Buffer outward 40m before using as terrain mask/curtain, to support exaggerated road width. Ring follows A282 southbound bridge at Dartford; northbound tunnel is separate.'}};
for(const r of data.routes)if(r.lengthM<175000||r.lengthM>205000)throw new Error(`Unexpected complete route length ${r.lengthM}`);
fs.writeFileSync(new URL('../src/m25-motorway-data.json',import.meta.url),JSON.stringify(data));console.log(JSON.stringify({rawWays:raw.elements.length,cycleWays:ways.length,routes:unique.map(r=>({id:r.id,direction:r.direction,lengthM:r.lengthM,ways:r.wayIds.length})),boundaryVertices:simple.length,outer:outer.id}));
