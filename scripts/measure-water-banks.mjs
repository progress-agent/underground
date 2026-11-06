// EA 1 m DTM transects across actual mapped shorelines. Raw TIFFs stay in
// this worktree's ignored cache; only the sampled survey facts are committed.
import {readFile,writeFile} from 'node:fs/promises';
import {fetchCoverage,sampleRaster,coverageUrl,ATTRIBUTION} from './ea-lidar-wcs.mjs';
import {BNG_REF_E,BNG_REF_N} from '../src/coordinates.js';
import {offsetRing,openRing} from '../src/water-body-geometry.js';
const root=new URL('../',import.meta.url),data=JSON.parse(await readFile(new URL('public/data/deep-water.json',root)));
const ids=['way/147189989','way/147855503','way/147855517','way/23129884','way/147638018','way/147855519','way/147855520','way/23130091','way/3172115','way/147637938','way/147638019','way/147637935','way/23161630','way/3171810','way/3172042','way/3172043'];
const med=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;};
const results={};
try{Object.assign(results,JSON.parse(await readFile(new URL('data/water-bank-profiles.json',root))).bodies);}catch{}
for(const id of ids) {
 if(results[id]&&!process.argv.includes('--refresh'))continue;
 const b=data.bodies.find(b=>b.id===id),ring=openRing(b.rings[0]);
 const es=ring.map(p=>p[0]+BNG_REF_E),ns=ring.map(p=>BNG_REF_N-p[1]);
 const bounds=[Math.floor((Math.min(...es)-140)/100)*100,Math.floor((Math.min(...ns)-140)/100)*100,Math.ceil((Math.max(...es)+140)/100)*100,Math.ceil((Math.max(...ns)+140)/100)*100];
 console.log('fetch',b.name,bounds);
 try {
  const {raster,sha256}=await fetchCoverage('dtm',bounds,new URL('scripts/.cache/water-bank-lidar/',root).pathname);
  const offsets=Array.from({length:71},(_,i)=>(i-10)*2),rings=offsets.map(d=>offsetRing(ring,d));
  const transects=ring.map((_,i)=>{
   const values=rings.map((r,j)=>({outwardM:offsets[j],aodM:sampleRaster(raster,r[i][0]+BNG_REF_E,BNG_REF_N-r[i][1])}));
   const crests=values.filter(v=>v.outwardM>=0&&v.outwardM<=35&&v.aodM!=null);
   const crest=crests.sort((a,b)=>b.aodM-a.aodM)[0]??null;
   const toe=med(values.filter(v=>v.outwardM>=80).map(v=>v.aodM));
   return {x:ring[i][0],z:ring[i][1],crest,toeAodM:toe,values};
  });
  const crestAodM=med(transects.map(t=>t.crest?.aodM)),groundAodM=med(transects.map(t=>t.toeAodM));
  results[id]={name:b.name,source:coverageUrl('dtm',bounds),sourceSha256:sha256,bounds,resolutionM:raster.px,method:'1m EA DTM; crest = median of transect maxima from wet outline to 35m outward; ground = median of 80 to120m outer samples. Check raw profiles for adjacent roads/structures or missing water returns.',crestAodM,groundAodM,heightM:crestAodM-groundAodM,transects};
  console.log(b.name,'crest',crestAodM,'ground',groundAodM,'height',crestAodM-groundAodM);
  await writeFile(new URL('data/water-bank-profiles.json',root),JSON.stringify({attribution:ATTRIBUTION,bodies:results})+'\n');
 }catch(e){console.error(id,e.message);}
}
