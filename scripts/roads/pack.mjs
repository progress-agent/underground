import {compactRoadPart} from './compact.mjs';
import {packRoadCoordinate} from './coordinate.mjs';
// Offline packets share an origin. Float32 bank positions stay separate, and
// distant ordinary faces need not carry an unrelated bridge's morph stream.
export function mergeRoadParts(parts,{maxVertices=4000000,wide=true,splitMorph=true}={}) {
 const result=[],split=[];
 for(const p of parts){if(!splitMorph||!p.rise){split.push(p);continue;}const ground=[],bridge=[];
  for(let i=0;i<p.idx.length;i+=3){const ids=p.idx.subarray(i,i+3);(ids.some(j=>p.rise[j]!==0)?bridge:ground).push(...ids);}
  for(const [indices,morph]of [[ground,false],[bridge,true]])if(indices.length){const q=compactRoadPart(p,indices);if(!morph)q.rise=null;split.push(q);}
 }
 for(const float of [false,true])for(const morph of splitMorph?[false,true]:[null]){
  const selected=split.filter(p=>(p.pos instanceof Float32Array)===float&&(morph===null||!!p.rise===morph));let batch=[],size=0;
  const finish=()=>{if(!batch.length)return;
   const n=batch.reduce((s,p)=>s+p.pos.length/3,0),count=batch.reduce((s,p)=>s+p.idx.length,0),bridge=batch.some(p=>p.rise),across=batch.some(p=>p.across),packed=batch.some(p=>p.across instanceof Uint16Array);
   const out={pos:new (float?Float32Array:Uint16Array)(n*3),road:new Uint8Array(n*3),rise:bridge?new Int16Array(n):null,across:across?new (packed?Uint16Array:Int16Array)(n):null,idx:new (wide?Uint32Array:Uint16Array)(count),farIdx:new Uint16Array()};
   let vertex=0,index=0;
   for(const p of batch){const length=p.pos.length/3;out.pos.set(p.pos,vertex*3);out.road.set(p.road,vertex*3);
    if(out.rise&&p.rise)out.rise.set(p.rise,vertex);
    if(out.across){if(p.across&&(!packed||p.across instanceof Uint16Array))out.across.set(p.across,vertex);else for(let j=0;j<length;j++){const side=p.road[j*3+1]>=128?1:-1;out.across[vertex+j]=packed?packRoadCoordinate(p.across?p.across[j]/32767:side):side*32767;}}
    for(const j of p.idx)out.idx[index++]=vertex+j;vertex+=length;
   }
   result.push(out);batch=[];size=0;
  };
  for(const p of selected){const n=p.pos.length/3;if(n>maxVertices)throw Error('Road packet exceeds its vertex cap');if(size+n>maxVertices)finish();batch.push(p);size+=n;}finish();
 }
 return result;
}

// Localise a large source packet without changing a face or its coordinate
// frame. Wide intermediate indices remain valid until final spatial splitting.
// Four-kilometre neighbourhoods permit finer frustum disposal; final indices
// remain 16-bit, avoiding a city-wide doubling of index-buffer memory.
export function deduplicateRoadParts(parts){
 const float=parts.some(p=>p.pos instanceof Float32Array),bridge=parts.some(p=>p.rise),positions=[],road=[],rise=[],across=[],indices=[],vertices=new Map();
 for(const p of parts){if(!(p.across instanceof Uint16Array))throw Error('Deduplication requires packed road coordinates');const remap=new Int32Array(p.pos.length/3).fill(-1);
  for(const j of p.idx){let at=remap[j];if(at<0){const paint=p.across[j],key=[...p.pos.subarray(j*3,j*3+3),...p.road.subarray(j*3,j*3+3),p.rise?.[j]??0,(paint-4)%1024].join(',');at=vertices.get(key);
    if(at===undefined){at=positions.length/3;vertices.set(key,at);positions.push(...p.pos.subarray(j*3,j*3+3));road.push(...p.road.subarray(j*3,j*3+3));rise.push(p.rise?.[j]??0);across.push(paint);}else across[at]=Math.min(across[at],paint);
    remap[j]=at;
   }indices.push(at);
  }
 }
 return{pos:new(float?Float32Array:Uint16Array)(positions),road:Uint8Array.from(road),rise:bridge?Int16Array.from(rise):null,across:Uint16Array.from(across),idx:Uint32Array.from(indices),farIdx:new Uint16Array()};
}
function splitRoadPart(p,maxVertices=65000){
 if(p.pos.length/3<=maxVertices){const q=compactRoadPart(p,p.idx);if(q.rise&&!q.rise.some(v=>v))q.rise=null;return[q];}
 const ranges=[0,2].map(axis=>{let lo=Infinity,hi=-Infinity;for(let i=axis;i<p.pos.length;i+=3){lo=Math.min(lo,p.pos[i]);hi=Math.max(hi,p.pos[i]);}return{axis,lo,hi};}).sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo)),{axis,lo,hi}=ranges[0],mid=(lo+hi)/2,groups=[[],[]];
 for(let i=0;i<p.idx.length;i+=3){const ids=p.idx.subarray(i,i+3);groups[Number(ids.reduce((n,j)=>n+p.pos[j*3+axis],0)/3>=mid)].push(...ids);}
 if(groups.every(g=>g.length))return groups.flatMap(g=>splitRoadPart(compactRoadPart(p,g),maxVertices));
 // Degenerate centroid arrangements still make progress without overflowing.
 const result=[];let indices=[],used=new Set();for(let i=0;i<p.idx.length;i+=3){const ids=p.idx.subarray(i,i+3);if(used.size+ids.filter(j=>!used.has(j)).length>maxVertices){result.push(compactRoadPart(p,indices));indices=[];used=new Set();}indices.push(...ids);for(const j of ids)used.add(j);}if(indices.length)result.push(compactRoadPart(p,indices));return result;
}
export function localiseRoadParts(parts,cell=4000,{deduplicate=false,mergeMorph=false,index16=false}={}){
 const buckets=new Map();
 for(const p of parts){
  const groups=new Map();
  for(let i=0;i<p.idx.length;i+=3){const ids=p.idx.subarray(i,i+3),x=Math.floor((ids.reduce((s,j)=>s+p.pos[j*3],0)/24-64)/cell),z=Math.floor((ids.reduce((s,j)=>s+p.pos[j*3+2],0)/24-64)/cell),key=x+','+z+','+Number(p.pos instanceof Float32Array)+(mergeMorph?'':','+Number(!!p.rise));
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...ids);
  }
  for(const [key,indices]of groups){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(compactRoadPart(p,indices));}
 }
 return [...buckets.keys()].sort().flatMap(key=>{if(!deduplicate)return mergeRoadParts(buckets.get(key),{maxVertices:65000,wide:false,splitMorph:false});const p=deduplicateRoadParts(buckets.get(key));return index16?splitRoadPart(p):[p];});
}
