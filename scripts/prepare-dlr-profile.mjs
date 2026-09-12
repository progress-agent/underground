// Rebuild the bundled DLR graph from a retained Overpass body+geometry snapshot.
// No guessed links: OSM node identity determines connectivity.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import proj4 from 'proj4';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const origin=proj4('EPSG:4326','EPSG:27700',[-.1278,51.5074]);
const project=(lat,lon)=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return [e-origin[0],origin[1]-n];};
const source=process.argv[process.argv.indexOf('--source')+1];
if(!process.argv.includes('--source'))throw Error('Supply --source /absolute/retained-osm-light-rail.json; missing data is not replaced.');
const bytes=await fs.readFile(source),raw=JSON.parse(bytes);
if(!Array.isArray(raw.elements)||raw.elements.length<100)throw Error('Incomplete OSM source');
const nodes=[],edges=[],ways={},indices=new Map();
function node(id,lat,lon){if(indices.has(id))return indices.get(id);const i=nodes.length;indices.set(id,i);nodes.push({id,lat,lon,xz:project(lat,lon)});return i;}
for(const w of raw.elements){
  if(w.type!=='way'||w.tags?.railway!=='light_rail'||['siding','yard'].includes(w.tags.service))continue;
  if(!w.nodes||w.nodes.length!==w.geometry.length)throw Error(`No node identity for ${w.id}`);
  const t=w.tags;
  // A covered bridge is above ground, even where a mapper also added tunnel=yes.
  const kind=t.bridge&&t.bridge!=='no'?'elevated':t.tunnel==='yes'?'tunnel':t.cutting==='yes'?'cutting':t.embankment==='yes'?'embankment':'surface';
  ways[w.id]={kind,tags:Object.fromEntries(['bridge','tunnel','cutting','embankment','layer','note','source','name'].filter(k=>t[k]).map(k=>[k,t[k]]))};
  for(let j=1;j<w.nodes.length;j++){
    const a=node(w.nodes[j-1],w.geometry[j-1].lat,w.geometry[j-1].lon),b=node(w.nodes[j],w.geometry[j].lat,w.geometry[j].lon);
    if(a!==b)edges.push({a,b,way:w.id,kind});
  }
}
const topology=JSON.parse(await fs.readFile(path.join(ROOT,'public/data/tfl/route-sequence/dlr.json'),'utf8'));
const stops=new Map();for(const seq of topology.stopPointSequences)for(const s of seq.stopPoint)stops.set(s.id,s);
const stopBytes=await fs.readFile(path.join(path.dirname(source),'osm-stop-positions.json'));
const stopPositions=JSON.parse(stopBytes).elements;
const stations={};
for(const s of stops.values()){
 const base=s.name.replace(/ DLR Station$/,'').split(' (')[0].toLowerCase();
 let matches=stopPositions.filter(n=>indices.has(n.id)&&((n.tags?.name||'').toLowerCase()===base||(n.tags?.name||'').toLowerCase().startsWith(base+' platform')||(n.tags?.name||'').toLowerCase().startsWith(base+' for ')));
 if(!matches.length&&s.id==='940GZZDLWLA'){
  // No named stop_position in this source snapshot. Retain TfL location and
  // explicitly approximate its anchor with the nearest mapped tunnel node.
  const [sx,sz]=project(s.lat,s.lon);const candidates=nodes.filter((n,i)=>edges.some(e=>(e.a===i||e.b===i)&&e.kind==='tunnel'));
  const nearest=candidates.reduce((a,b)=>Math.hypot(a.xz[0]-sx,a.xz[1]-sz)<Math.hypot(b.xz[0]-sx,b.xz[1]-sz)?a:b);
  matches=[{...nearest,tags:{name:'Woolwich Arsenal approximate mapped tunnel anchor'}}];
 }
 if(!matches.length)throw Error(`Missing named mapped platform for ${s.name}`);
 const [x,z]=project(s.lat,s.lon);
 const candidates=matches.map(n=>({node:indices.get(n.id),osmId:n.id,name:n.tags.name,ref:n.tags.ref,distance:Math.hypot(nodes[indices.get(n.id)].xz[0]-x,nodes[indices.get(n.id)].xz[1]-z)})).sort((a,b)=>a.distance-b.distance);
 const ni=candidates[0].node,edge=edges.find(e=>e.a===ni||e.b===ni);
 stations[s.id]={name:s.name,lat:s.lat,lon:s.lon,node:ni,kind:edge.kind,sourceWay:edge.way,mapOffsetM:+candidates[0].distance.toFixed(2),anchorApproximate:s.id==='940GZZDLWLA',candidates};
}
const adjacency=nodes.map(()=>[]);for(const e of edges){const a=nodes[e.a].xz,b=nodes[e.b].xz;e.length=Math.hypot(a[0]-b[0],a[1]-b[1]);adjacency[e.a].push([e.b,e.length]);adjacency[e.b].push([e.a,e.length]);}
function shortestFrom(start){const dist=new Map([[start,0]]),prev=new Map(),open=new Set([start]);while(open.size){let n=[...open].reduce((a,b)=>dist.get(a)<dist.get(b)?a:b);open.delete(n);for(const [next,len]of adjacency[n]){const d=dist.get(n)+len;if(d<(dist.get(next)??Infinity)){dist.set(next,d);prev.set(next,n);open.add(next);}}}return {dist,prev};}
const paths=new Map();
function shortest(start,end){if(!paths.has(start))paths.set(start,shortestFrom(start));const {dist,prev}=paths.get(start);if(!dist.has(end))return null;let n=end;const p=[n];while(n!==start){n=prev.get(n);if(n===undefined)throw Error('Broken source graph');p.push(n);}return {start,end,nodes:p.reverse(),length:dist.get(end)};}
const links={};for(const seq of topology.stopPointSequences)for(let i=1;i<seq.stopPoint.length;i++){
 const ids=[seq.stopPoint[i-1].id,seq.stopPoint[i].id].sort(),key=ids.join('|');if(links[key])continue;
 const alternatives=[];for(const a of stations[ids[0]].candidates)for(const b of stations[ids[1]].candidates){const route=shortest(a.node,b.node);if(route)alternatives.push(route);}
 if(!alternatives.length)throw Error(`Disconnected mapped link ${key}`);links[key]=alternatives;
}
const data={version:1,source:{url:'https://overpass-api.de/api/interpreter',query:'[out:json][timeout:90];way[railway=light_rail](51.45,-0.10,51.56,0.10);out body geom;',timestamp:raw.osm3s?.timestamp_osm_base,sha256:createHash('sha256').update(bytes).digest('hex'),stopPositionSha256:createHash('sha256').update(stopBytes).digest('hex'),attribution:'© OpenStreetMap contributors, ODbL 1.0',tfl:'https://tfl.gov.uk/cdn/static/cms/documents/tube-map-with-tunnels.pdf'},heightModel:{surveyed:false,elevatedM:8,embankmentM:3,surfaceM:1,cuttingM:-3,tunnelMaxM:30,portalGrade:.06,abovegroundGrade:.08,notes:'Illustrative clearances and depths, not surveyed. OSM underground alignment can itself be approximate; note/source tags retained. Terrain remains DSM outside the validated Stratford patch.'},nodes:nodes.map(({id,lat,lon})=>({id,lat,lon})),edges:edges.map(({a,b,way,kind})=>({a,b,way,kind})),ways,stations,links};
await fs.writeFile(path.join(ROOT,'src/dlr-profile-data.json'),JSON.stringify(data));
console.log(JSON.stringify({nodes:nodes.length,edges:edges.length,ways:Object.keys(ways).length,stations:stops.size,links:Object.keys(links).length,stationClassifications:Object.entries(stations).map(([id,s])=>[id,s.kind,s.mapOffsetM])}));
