import {compactRoadPart} from './compact.mjs';
import {packRoadCoordinate} from './coordinate.mjs';
// Offline distant packets share an origin and layout. Keep Float32 bank support
// separate so ordinary quantised positions do not acquire its larger stride.
export function mergeRoadParts(parts) {
 const result=[],split=[];
 for(const p of parts){if(!p.rise){split.push(p);continue;}const ground=[],bridge=[];
  for(let i=0;i<p.idx.length;i+=3){const ids=p.idx.subarray(i,i+3);(ids.some(j=>p.rise[j]!==0)?bridge:ground).push(...ids);}
  for(const [indices,morph]of [[ground,false],[bridge,true]])if(indices.length){const q=compactRoadPart(p,indices);if(!morph)q.rise=null;split.push(q);}
 }

 for(const float of [false,true])for(const morph of [false,true]){
  const selected=split.filter(p=>(p.pos instanceof Float32Array)===float&&!!p.rise===morph);if(!selected.length)continue;
  const n=selected.reduce((s,p)=>s+p.pos.length/3,0),count=selected.reduce((s,p)=>s+p.idx.length,0),bridge=selected.some(p=>p.rise),across=selected.some(p=>p.across),packed=selected.some(p=>p.across instanceof Uint16Array);
  const out={pos:new (float?Float32Array:Uint16Array)(n*3),road:new Uint8Array(n*3),rise:bridge?new Int16Array(n):null,across:across?new (packed?Uint16Array:Int16Array)(n):null,idx:new Uint32Array(count),farIdx:new Uint16Array()};
  let vertex=0,index=0;
  for(const p of selected){const size=p.pos.length/3;out.pos.set(p.pos,vertex*3);out.road.set(p.road,vertex*3);
   if(out.rise&&p.rise)out.rise.set(p.rise,vertex);
   if(out.across){if(p.across&&(!packed||p.across instanceof Uint16Array))out.across.set(p.across,vertex);else for(let j=0;j<size;j++){const side=p.road[j*3+1]>=128?1:-1;out.across[vertex+j]=packed?packRoadCoordinate(p.across?p.across[j]/32767:side):side*32767;}}
   for(const j of p.idx)out.idx[index++]=vertex+j;vertex+=size;
  }
  result.push(out);
 }
 return result;
}
