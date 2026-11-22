// An offline LOD owns only the vertices its indices reference. Keeping two
// index buffers over the full vertex array saves triangles but no vertex RAM.
export function compactRoadPart(part,indices) {
  const remap=new Map(),pos=[],road=[],rise=[],across=[],idx=[];
  for(const j of indices){let k=remap.get(j);if(k===undefined){k=remap.size;remap.set(j,k);
    pos.push(...part.pos.subarray(j*3,j*3+3));road.push(...part.road.subarray(j*3,j*3+3));
    if(part.rise)rise.push(part.rise[j]);if(part.across)across.push(part.across[j]);
  }idx.push(k);}
  return {pos:part.pos.constructor.from(pos),road:Uint8Array.from(road),rise:part.rise?Int16Array.from(rise):null,
    across:part.across?part.across.constructor.from(across):null,idx:(remap.size>65000?Uint32Array:Uint16Array).from(idx),farIdx:new Uint16Array()};
}
