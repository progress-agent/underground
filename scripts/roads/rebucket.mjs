// Consolidate integer road triangles in a global grid, rather than creating a
// separate packet for every neighbouring source tile's overhanging fragments.
// Float32 reservoir overlays keep their original precision and coordinate frame.
import {compactRoadPart} from './compact.mjs';
export function rebucketFarRoads(groups) {
  const packed=new Map(),precise=[];
  for(const [key,c]of groups){
    if(c.lod!=='far')continue;
    const cell=8000;
    const keep=[];
    for(const source of c.parts){
      if(source.pos instanceof Float32Array){keep.push(source);continue;}
      const buckets=new Map();
      for(let i=0;i<source.idx.length;i+=3){
        const a=source.idx[i],b=source.idx[i+1],d=source.idx[i+2];
        const x=Math.floor((c.x+(source.pos[a*3]+source.pos[b*3]+source.pos[d*3])/24)/cell)*cell;
        const z=Math.floor((c.z+(source.pos[a*3+2]+source.pos[b*3+2]+source.pos[d*3+2])/24)/cell)*cell;
        const id=`${c.tier}-far-packed-${x}-${z}`,dx=(c.x-(x-64))*8,dz=(c.z-(z-64))*8;
        // A crossing face must not widen all other faces from its source part.
        const wide=[a,b,d].some(j=>source.pos[j*3]+dx<0||source.pos[j*3]+dx>65535||source.pos[j*3+2]+dz<0||source.pos[j*3+2]+dz>65535);
        const bucket=id+(wide?'-float':'-integer');
        let list=buckets.get(bucket);if(!list){list={id,x,z,wide,indices:[]};buckets.set(bucket,list);}
        list.indices.push(a,b,d);
      }
      for(const {id,x,z,wide,indices}of buckets.values()){
        let target=packed.get(id);
        if(!target){target={key:id,x:x-64,z:z-64,size:cell,tier:c.tier,lod:'far',rebucketed:true,parts:[]};packed.set(id,target);}
        const part=compactRoadPart(source,indices),dx=(c.x-target.x)*8,dz=(c.z-target.z)*8;
        const pos=new (wide?Float32Array:Uint16Array)(part.pos.length);
        for(let i=0;i<pos.length;i+=3){pos[i]=part.pos[i]+dx;pos[i+1]=part.pos[i+1];pos[i+2]=part.pos[i+2]+dz;}
        part.pos=pos;target.parts.push(part);
      }
    }
    if(keep.length)precise.push({...c,key:key+'-precise',parts:keep});
    groups.delete(key);
  }
  for(const c of precise)groups.set(c.key,c);
  for(const [key,c]of packed)groups.set(key,c);
}
