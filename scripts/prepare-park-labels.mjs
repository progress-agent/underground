// Offline only: name-preserving park boundaries independent of live tile loads.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const PARK_SELECTION = [
  ['hyde-park', 'Hyde Park'], ['kensington-gardens', 'Kensington Gardens'],
  ['regents-park', "The Regent's Park"], ['green-park', 'The Green Park'],
  ['st-jamess-park', "St. James's Park"], ['battersea-park', 'Battersea Park'],
  ['greenwich-park', 'Greenwich Park'], ['richmond-park', 'Richmond Park'],
  ['bushy-park', 'Bushy Park'], ['hampstead-heath', 'Hampstead Heath'],
  ['finsbury-park', 'Finsbury Park'], ['olympic-park', 'Queen Elizabeth Olympic Park'],
  ['crystal-palace-park', 'Crystal Palace Park'], ['victoria-park', 'Victoria Park'],
];
const repairedIds = new Map([["The Regent's Park", 1384127], ['Victoria Park', 11127855]]);
const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
export const ringArea = p => p.reduce((s, a, i) => { const b = p[(i+1)%p.length]; return s+a[0]*b[1]-b[0]*a[1]; }, 0)/2;
export function cleanRing(input,minArea=10000) {
  const ring = [];
  for (const p of input) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw Error('Non-finite park vertex');
    if (!ring.length || !equal(p, ring.at(-1))) ring.push([...p]);
  }
  if (ring.length && equal(ring[0], ring.at(-1))) ring.pop();
  if (ring.length < 3 || Math.abs(ringArea(ring)) < minArea) throw Error('Missing/degenerate major-park boundary');
  return ring;
}
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const between = (a,b,c) => c[0]>=Math.min(a[0],b[0]) && c[0]<=Math.max(a[0],b[0]) && c[1]>=Math.min(a[1],b[1]) && c[1]<=Math.max(a[1],b[1]);
export function validateSimpleRing(ring, label = 'park') {
  if (new Set(ring.map(p => p.join(','))).size !== ring.length) throw Error(`${label}: repeated non-adjacent boundary vertex`);
  for (let i=0;i<ring.length;i++) for (let j=i+2;j<ring.length;j++) {
    if (i===0 && j===ring.length-1) continue;
    const a=ring[i], b=ring[(i+1)%ring.length], c=ring[j], d=ring[(j+1)%ring.length];
    const ac=cross(a,b,c), ad=cross(a,b,d), ca=cross(c,d,a), cb=cross(c,d,b);
    if ((ac*ad<0 && ca*cb<0) || (!ac&&between(a,b,c)) || (!ad&&between(a,b,d)) || (!ca&&between(c,d,a)) || (!cb&&between(c,d,b))) {
      throw Error(`${label}: intersecting boundary segments ${i}/${j}`);
    }
  }
  return ring;
}
// Stitch actual OSM way endpoint IDs; never join unrelated relation members by
// their document order, which caused the old Regent's/Victoria bow-tie rings.
export function relationRings(source, relationId,role='outer') {
  const relation = source.elements.find(e => e.type==='relation' && e.id===relationId);
  if (!relation) throw Error(`Missing relation ${relationId}`);
  const ways = new Map(source.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
  const nodes = new Map(source.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  const unused = relation.members.filter(m=>m.type==='way' && m.role===role).map(m=>{
    const way=ways.get(m.ref); if(!way?.nodes?.length) throw Error(`Missing outer way ${m.ref}`); return [...way.nodes];
  });
  const rings=[];
  while (unused.length) {
    const chain=unused.shift();
    while (chain[0]!==chain.at(-1)) {
      const candidates=unused.map((p,i)=>({p,i})).filter(({p})=>p[0]===chain.at(-1)||p.at(-1)===chain.at(-1));
      if(candidates.length!==1) throw Error(`Ambiguous/open boundary in relation ${relationId}`);
      const {p,i}=candidates[0];unused.splice(i,1);if(p[0]!==chain.at(-1))p.reverse();chain.push(...p.slice(1));
    }
    rings.push(cleanRing(chain.map(id=>{const node=nodes.get(id);if(!node)throw Error(`Missing node ${id}`);const [e,n]=proj4('EPSG:4326','EPSG:27700',[node.lon,node.lat]);return [Number((e-BNG_REF_E).toFixed(3)),Number((BNG_REF_N-n).toFixed(3))];}),1));
  }
  if(!rings.length&&role==='outer')throw Error(`No outer ring in relation ${relationId}`);
  return rings;
}
export async function prepareParkLabels() {
  const dir=path.join(ROOT,'public/data/surface/tiles');
  const manifestBytes=await readFile(path.join(dir,'manifest.json'));
  const manifest=JSON.parse(manifestBytes), candidates=new Map(PARK_SELECTION.map(([,name])=>[name,new Map()]));
  for (const tile of [...manifest.tiles].sort((a,b)=>a.file.localeCompare(b.file))) {
    const bytes=await readFile(path.join(dir,tile.file)), data=JSON.parse(bytes);
    for(const p of data.parks||[]) {
      if(!candidates.has(p.name)||repairedIds.has(p.name))continue;
      const ring=cleanRing(p.polygon), key=hash(JSON.stringify(ring));
      const pool=candidates.get(p.name);
      if(!pool.has(key))pool.set(key,{ring,sourceTiles:[],geometrySha256:key});
      pool.get(key).sourceTiles.push({file:tile.file,sha256:hash(bytes)});
    }
  }
  const repairPath='scripts/sources/park-boundary-repair-osm.json';
  const repairBytes=await readFile(path.join(ROOT,repairPath)), source=JSON.parse(repairBytes);
  const parks=[];
  for(const [id,name]of PARK_SELECTION) {
    let rings,holes=[],provenance;
    if(repairedIds.has(name)) {
      const osmId=repairedIds.get(name);rings=relationRings(source,osmId);holes=relationRings(source,osmId,'inner');
      provenance={file:repairPath,sha256:hash(repairBytes),osm:`relation/${osmId}`,url:`https://www.openstreetmap.org/relation/${osmId}`,timestamp:source.osm3s.timestamp_osm_base};
    } else {
      const options=[...candidates.get(name).values()];
      if(options.length!==1)throw Error(`${name}: expected one unique boundary, got ${options.length}`);
      const {ring,...tileProvenance}=options[0];rings=[ring];provenance=tileProvenance;
    }
    for(const ring of [...rings,...holes])validateSimpleRing(ring,name);
    rings.sort((a,b)=>Math.abs(ringArea(b))-Math.abs(ringArea(a)));
    const area=rings.reduce((s,r)=>s+Math.abs(ringArea(r)),0),perimeter=rings.reduce((s,ring)=>s+ring.reduce((n,p,i)=>n+Math.hypot(p[0]-ring[(i+1)%ring.length][0],p[1]-ring[(i+1)%ring.length][1]),0),0);
    parks.push({id,name,label:name.toUpperCase(),rings,holes,areaM2:Math.round(area),perimeterM:Math.round(perimeter),provenance});
  }
  const output={version:1,attribution:'© OpenStreetMap contributors, ODbL 1.0',sourceManifest:{sha256:hash(manifestBytes),generated:manifest.generated,sceneOrigin:manifest.sceneOrigin},note:'Twelve deduplicated tile boundaries; Regent’s Park and Victoria Park rebuilt from exact joined OSM outer ways. No invented outlines. Decorative inscriptions follow outer perimeters only.',parks};
  await writeFile(path.join(ROOT,'public/data/park-labels.json'),JSON.stringify(output)+'\n');
  const repairs={version:1,attribution:output.attribution,parks:parks.filter(p=>repairedIds.has(p.name)).map(({id,name,rings,holes,provenance})=>({id,name,rings,holes,provenance}))};
  await writeFile(path.join(ROOT,'src/park-boundary-repairs.json'),JSON.stringify(repairs)+'\n');
  return output;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const data=await prepareParkLabels();console.log(`Validated ${data.parks.length} park boundaries, ${data.parks.reduce((s,p)=>s+p.rings.reduce((n,r)=>n+r.length,0),0)} vertices`);
}
