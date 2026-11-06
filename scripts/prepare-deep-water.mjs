// Re-runnable OSM water inventory. Network refresh is explicit, offline output
// is deterministic. No surface-store files are read or written.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import proj4 from 'proj4';
import {BNG_REF_E,BNG_REF_N} from '../src/coordinates.js';
import {ringArea,openRing} from '../src/water-body-geometry.js';
const root=new URL('../',import.meta.url),cache=new URL('scripts/.cache/',root);
const read=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const legacy=await read('public/data/reservoirs.json'),facts=await read('data/water-facts.json');
const namedQuery='[out:json][timeout:120];(nwr["natural"="water"]["name"~"Serpentine|Long Water|Royal Victoria Dock|Royal Albert Dock|King George V Dock|West India|Millwall|Greenland Dock|Canada Water|South Dock"](51.35,-0.65,51.75,0.15););out geom;';
const members=legacy.features.map(f=>f.id.replace('/','(')+');').join('');
const inventoryQuery=`[out:json][timeout:120];(${members}nwr["natural"="water"](51.49,-0.03,51.515,0.015););out geom;`;
if(process.argv.includes('--refresh')) {
  await mkdir(cache,{recursive:true});
  for(const [file,query]of [['deep-water-overpass.json',namedQuery],['deep-water-inventory-overpass.json',inventoryQuery]]) {
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'User-Agent':'UnderGround-WaterInventory/1.0'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error(`Overpass ${response.status}`);
    const bytes=await response.text();if(!Array.isArray(JSON.parse(bytes).elements))throw Error('Invalid OSM response');
    await writeFile(new URL(file,cache),bytes);
  }
}
const inputs=['scripts/.cache/deep-water-overpass.json','scripts/.cache/deep-water-inventory-overpass.json'];
const sources=await Promise.all(inputs.map(read));
const elements=new Map(sources.flatMap(s=>s.elements).map(e=>[`${e.type}/${e.id}`,e]));
const xz=({lat,lon})=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return [+(e-BNG_REF_E).toFixed(3),+(BNG_REF_N-n).toFixed(3)];};
const holes=e=>e.members?.filter(m=>m.role==='inner'&&m.geometry?.length>3).map(m=>openRing(m.geometry.map(xz)))??[];
const geom=e=>e.geometry?.length>3?[openRing(e.geometry.map(xz))]:e.members?.filter(m=>m.role==='outer'&&m.geometry?.length>3).map(m=>openRing(m.geometry.map(xz)))??[];
const entries=new Map();
for(const old of legacy.features) {
  const element=elements.get(old.id);
  // Relations with two OUTER closed basins are separate physical water
  // bodies (Staines has different levels). Single-outer relation is an alias.
  if(element?.members?.length) {
    for(const m of element.members.filter(m=>m.role==='outer'&&m.geometry?.length>3)) {
      const id=`way/${m.ref}`;
      const e=entries.get(id)??{id,name:elements.get(id)?.tags?.name??element.tags?.name??old.name,rings:[openRing(m.geometry.map(xz))],holes:holes(element),legacyIds:[]};
      if(element.tags?.name && !element.tags.name.startsWith('Staines') && !element.tags.name.startsWith('King George'))e.name=element.tags.name;
      e.holes=holes(element);e.legacyIds.push(old.id,id);entries.set(id,e);
    }
  } else {
    const e=entries.get(old.id)??{id:old.id,name:element?.tags?.name??old.name,rings:element?geom(element):[openRing(old.coords.map(([lat,lon])=>xz({lat,lon})))],legacyIds:[]};
    e.legacyIds.push(old.id);entries.set(old.id,e);
  }
}
const dockIds=['way/122304315','way/121158887','way/190792949','way/23782754','relation/18985240','way/183373686','way/183373683','way/187272267','way/259674282','way/138040109','relation/18015947'];
const parkIds=['relation/5392','way/19841953'];
for(const id of [...dockIds,...parkIds]) {
  const e=elements.get(id);if(!e)throw Error(`OSM source missing ${id}`);
  entries.set(id,{id,name:e.tags.name,rings:geom(e),holes:holes(e),legacyIds:[id],kind:dockIds.includes(id)?'dock':'park'});
}
// Deleted legacy member ways may have been replaced by current ways on
// exactly the same outline. Merge those aliases without changing the old
// renderer, which remains untouched for 2D bodies.
const unique=new Map();
for(const e of entries.values()) {
  const key=JSON.stringify(e.rings.map(r=>r.map(p=>p.join(',')).sort()).sort());
  const prev=unique.get(key);
  if(prev){prev.legacyIds.push(...e.legacyIds);if(e.name&&!e.name.startsWith('Reservoir '))prev.name=e.name;}
  else unique.set(key,e);
}
const bodies=[...unique.values()].map(e=>{
  const area=Math.abs(e.rings.reduce((a,r)=>a+ringArea(r),0))/10000;
  const f=facts[e.id]??{mode:'2D',reason:'No defensible sourced depth yet; retain the exact live surface and navigation. This is an unknown depth, not a claim that the body is shallow.',depth:{typicalM:null,maxM:null,renderM:null,source:null}};
  return {...e,shoreSlope:(e.holes?.length||e.kind==='dock')?0:3,kind:e.kind??'reservoir',...f,area:{ha:+area.toFixed(3),source:`https://www.openstreetmap.org/${e.id}`,method:'Plan area of OSM outer shoreline, EPSG:27700; excludes no islands. Not a surveyed storage area.'},legacyIds:[...new Set(e.legacyIds)],seaLife:f.mode==='VOLUME'&&(area>=50||e.kind==='dock')};
}).sort((a,b)=>b.area.ha-a.area.ha||a.id.localeCompare(b.id));
const provenance=await Promise.all(inputs.map(async p=>({file:p,sha256:createHash('sha256').update(await readFile(new URL(p,root))).digest('hex')})));
const data={version:1,attribution:'© OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright',coordinateContract:'BNG scene metres, X east, Z south, origin src/coordinates.js',provenance,bodies};
await writeFile(new URL('public/data/deep-water.json',root),JSON.stringify(data)+'\n');
const cite=s=>s??'Unknown';
const depthText=b=>{const d=b.depth,cite=(v,s)=>v==null?'unknown':`${v}${s?` ([source](${s}))`:''}`;return `${cite(d.typicalM,d.typicalSource??d.source)} / ${cite(d.maxM,d.maxSource??d.source)}`;};
const lines=['# Water inventory, sprint 06Nov26f','','Generated by `node scripts/prepare-deep-water.mjs`, facts in `data/water-facts.json`. OSM response caches can be refreshed with `--refresh`. All plan areas come from the linked OSM outline, projected to EPSG:27700. Water-body aliases from the legacy 50 records are retained in the JSON. A duplicate way/relation is one body, not two. Staines and King George V each have two distinct basins.','','© OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). Fact citations travel with the JSON. A missing depth remains explicitly unknown and 2D. Published operating references are not live levels.','','| Name / OSM outline | Area ha | Typical / maximum depth m | Water reference m AOD | Bank | Choice and reason |','|---|---:|---|---|---|---|',...bodies.map(b=>`| [${b.name}](https://www.openstreetmap.org/${b.id}) | ${b.area.ha} | ${depthText(b)} | ${b.level?`${b.level.aodM} ([source](${b.level.source})); ${b.level.meaning}`:'unknown, terrain-relative'} | ${b.bank?`${b.bank.heightM} m above land, crest ${b.bank.crestAodM??'terrain-relative'} m AOD; [source](${b.bank.source}); freeboard ${b.bank.freeboardM} m (${b.bank.freeboardSource})`:'none added'} | ${b.mode}: ${b.reason} |`),'','The geometry uses an illustrative level floor at `renderM`, with 3:1 interior slopes for reservoirs and vertical dock quays. There is no surveyed bathymetric mesh. The datum is canonical real metres multiplied by VE, so Master stretches landscape, banks and depth together. Where a published water/crest AOD is absent, the median DEM elevation at an outside toe is the surrounding-land datum. Estimated freeboard and crest width are model assumptions, not measured facts. The crest is 4 m wide unless a site-specific fact supplies it.',''];
await writeFile(new URL('docs/water-inventory.md',root),lines.join('\n'));
console.log(`${bodies.length} physical entries; ${bodies.filter(b=>b.mode==='VOLUME').length} volumes; ${bodies.filter(b=>b.bank).length} embanked basins`);
