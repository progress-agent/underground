// Read the served asset, after winding/sliver cleanup and compaction. The bake
// audit's overlap numerator is conservative: cleanup only removes triangles.
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {decodeRoadBlock,createRoadMaterial} from '../../src/roads.js';
import {unpackRoadCoordinate} from './coordinate.mjs';
import {split,area} from './polygons.mjs';
export function measureStoredBands(dir){
 const auditFile=path.join(dir,'junction-audit.json');if(!fs.existsSync(auditFile))throw Error('Pass a road directory generated with prepare.mjs --audit');
 const audit=JSON.parse(fs.readFileSync(auditFile));
 const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),material=createRoadMaterial(),totals={};
 try{for(const rec of m.records.filter(r=>r.tier==='desktop')){
  const raw=gunzipSync(fs.readFileSync(path.join(dir,rec.file))),mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),material,material,rec);
  for(const [lod,g]of rec.lod?[[rec.lod,mesh.geometry]]:[['near',mesh.geometry],['far',mesh.userData.roadFarGeometry]]){if(!g)continue;
   const out=totals[lod]??(totals[lod]={triangles:0,pavementArea:0}),p=g.attributes.position,d=g.attributes.roadData,ac=g.attributes.roadAcross,ix=g.index;
   for(let i=0;i<ix.count;i+=3){const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)],j=ids[0],lb=d.getY(j),rb=d.getZ(j),half=(d.getX(j)*4+(Math.floor(lb/64)%2)+2*(Math.floor(rb/64)%2))/16,left=(lb%64)/10,right=(rb%64)/10;out.triangles++;
    if(!left&&!right)continue;const x=p.getX(j),z=p.getZ(j),tri=ids.map(j=>{const value=ac?ac.getX(j):(d.getY(j)>=128?1:-1),across=value>2?unpackRoadCoordinate(value).across:value;return[(p.getX(j)-x)/8,(p.getZ(j)-z)/8,across*half];});
    if(left)out.pavementArea+=area(split(tri,v=>-half+left-v[2])[0]);if(right)out.pavementArea+=area(split(tri,v=>v[2]-half+right)[0]);
   }
  }
  mesh.geometry.dispose();mesh.userData.roadFarGeometry?.dispose();
 }}finally{material.dispose();}
 const result={lods:totals,pavementArea:Object.values(totals).reduce((n,p)=>n+p.pavementArea,0),overlapAreaUpperBound:audit.overlapArea};
 result.upperBoundValid=!!m.tileLODs||audit.farTopologySubstitutions===0;
 result.percentUpperBound=100*result.overlapAreaUpperBound/result.pavementArea;
 for(const [lod,r]of Object.entries(totals)){r.overlapAreaUpperBound=audit.lods[lod].overlapArea;r.percentUpperBound=100*r.overlapAreaUpperBound/r.pavementArea;}
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(measureStoredBands(process.argv[2]),null,2));
