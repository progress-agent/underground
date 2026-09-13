import * as THREE from 'three';
import { createThamesNavigation } from './thames-navigation.js';

const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const area=poly=>poly.reduce((sum,p,i)=>sum+p.x*poly[(i+1)%poly.length].z-poly[(i+1)%poly.length].x*p.z,0)/2;
function clip(poly,distance){
  const result=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b);
    if(da>=-1e-8)result.push(a);
    if((da>1e-8&&db<-1e-8)||(da<-1e-8&&db>1e-8))result.push(mix(a,b,da/(da-db)));
  }
  return result.length>=3&&Math.abs(area(result))>1e-8?result:[];
}
function weights(tri,p){
  const [a,b,c]=tri,det=cross(a,b,c);
  return [cross(b,c,p)/det,cross(c,a,p)/det,cross(a,b,p)/det];
}
const height=(tri,p)=>weights(tri,p).reduce((s,w,i)=>s+w*tri[i].y,0);
const bounds=tri=>({minX:Math.min(...tri.map(p=>p.x)),maxX:Math.max(...tri.map(p=>p.x)),
  minZ:Math.min(...tri.map(p=>p.z)),maxZ:Math.max(...tri.map(p=>p.z))});

/**
 * Cut ONLY wet portions from the coarse terrain and triangulate the supplied
 * bathymetry at the exact water footprint. Original land triangles/positions
 * stay unchanged. Intersecting both grids also preserves old deeper pockets:
 * each intersection is split where old terrain and profile planes exchange
 * which is lower, so min(old,profile) is exact rather than vertex-only.
 */
export function refineTerrainRiverBed(geometry,sections,{centerX=0,centerZ=0}={}){
  const footprint=createThamesNavigation(sections,null,0);
  const water=[],buckets=new Map(),bucketSize=256;
  const put=(map,box,index)=>{
    for(let x=Math.floor(box.minX/bucketSize);x<=Math.floor(box.maxX/bucketSize);x++)
      for(let z=Math.floor(box.minZ/bucketSize);z<=Math.floor(box.maxZ/bucketSize);z++){
        const key=`${x},${z}`;if(!map.has(key))map.set(key,[]);map.get(key).push(index);
      }
  };
  const point=i=>({x:sections[i*3],y:sections[i*3+1],z:sections[i*3+2]});
  for(let i=0;i<sections.length/12-1;i++){
    const b=i*4+2,n=b+4;
    for(const tri of [[point(b),point(n),point(b+1)],[point(b+1),point(n),point(n+1)]]){
      const box=bounds(tri),index=water.push({tri,box,sign:Math.sign(area(tri))})-1;put(buckets,box,index);
    }
  }
  const oldPositions=geometry.attributes.position,oldIndex=geometry.index.array;
  const attributes=Object.fromEntries(Object.entries(geometry.attributes).filter(([name])=>name!=='normal')
    .map(([name,attribute])=>[name,{original:attribute,values:Array.from(attribute.array)}]));
  const indices=[],bedTriangles=[],bedBuckets=new Map();
  let cutCount=0;
  const emit=(poly,original,originalIndices,bed=false)=>{
    if(poly.length<3)return;
    const base=attributes.position.values.length/3;
    for(const p of poly){
      const bary=weights(original,p);
      for(const [name,entry]of Object.entries(attributes)){
        if(name==='position')entry.values.push(p.x-centerX,p.y,p.z-centerZ);
        else for(let c=0;c<entry.original.itemSize;c++)entry.values.push(bary.reduce((sum,w,k)=>
          sum+w*entry.original.array[originalIndices[k]*entry.original.itemSize+c],0));
      }
    }
    for(let i=1;i<poly.length-1;i++){
      const order=area(poly)<0?[0,i,i+1]:[0,i+1,i];
      const tri=order.map(k=>({x:Math.fround(poly[k].x-centerX)+centerX,
        y:Math.fround(poly[k].y),z:Math.fround(poly[k].z-centerZ)+centerZ}));
      // Clipping slivers can collapse when uploaded as Float32. Never render
      // or sample a triangle whose final coordinates have no projected area.
      if(!tri.every(p=>Object.values(p).every(Number.isFinite))||Math.abs(cross(...tri))<1e-10)continue;
      indices.push(...order.map(k=>base+k));
      if(bed){
        const index=bedTriangles.push(tri)-1;put(bedBuckets,bounds(tri),index);
      }
    }
  };
  for(let i=0;i<oldIndex.length;i+=3){
    const sourceIds=[oldIndex[i],oldIndex[i+1],oldIndex[i+2]];
    const original=sourceIds.map(k=>({x:oldPositions.getX(k)+centerX,y:oldPositions.getY(k),z:oldPositions.getZ(k)+centerZ}));
    const box=bounds(original),candidates=new Set();
    for(let x=Math.floor(box.minX/bucketSize);x<=Math.floor(box.maxX/bucketSize);x++)
      for(let z=Math.floor(box.minZ/bucketSize);z<=Math.floor(box.maxZ/bucketSize);z++)
        for(const k of buckets.get(`${x},${z}`)||[])candidates.add(k);
    let pieces=[original],changed=false;
    for(const k of candidates){
      const w=water[k];if(w.box.maxX<box.minX||w.box.minX>box.maxX||w.box.maxZ<box.minZ||w.box.minZ>box.maxZ)continue;
      const next=[];
      for(const poly of pieces){
        let inside=poly;const outside=[];
        for(let e=0;e<3&&inside.length;e++){
          const a=w.tri[e],b=w.tri[(e+1)%3],distance=p=>cross(a,b,p)*w.sign;
          const part=clip(inside,p=>-distance(p));if(part.length)outside.push(part);
          inside=clip(inside,distance);
        }
        if(!inside.length){next.push(poly);continue;}
        changed=true;next.push(...outside);
        const difference=p=>p.y-height(w.tri,p);
        if(inside.every(p=>Math.abs(difference(p))<1e-7)){
          emit(inside,original,sourceIds,true);continue;
        }
        // Old lower pockets and new profile bed are each planar after this cut.
        const lowerOld=clip(inside,p=>-difference(p));
        const lowerProfile=clip(inside,difference);
        if(lowerOld.length)emit(lowerOld,original,sourceIds,true);
        if(lowerProfile.length)emit(lowerProfile.map(p=>({...p,y:height(w.tri,p)})),original,sourceIds,true);
      }
      pieces=next;if(!pieces.length)break;
    }
    if(!changed)indices.push(...sourceIds);
    else {cutCount++;for(const poly of pieces)emit(poly,original,sourceIds);}
  }
  for(const [name,entry]of Object.entries(attributes))geometry.setAttribute(name,
    new THREE.BufferAttribute(new Float32Array(entry.values),entry.original.itemSize));
  geometry.setIndex(indices);
  // Three reuses an existing normal buffer, which still has the old grid size.
  geometry.deleteAttribute('normal');geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  function sample(x,z){
    // Use precisely the same footprint/tolerance as navigation. Independent
    // clipped-triangle tolerances otherwise create a microscopic AIR slit.
    if(!footprint.containsXZ(x,z))return null;
    let y=null;
    for(const k of bedBuckets.get(`${Math.floor(x/bucketSize)},${Math.floor(z/bucketSize)}`)||[]){
      const tri=bedTriangles[k],bary=weights(tri,{x,z});
      if(bary.every(w=>w>=-1e-7&&w<=1+1e-7)){
        const value=bary.reduce((s,w,i)=>s+w*tri[i].y,0);y=y===null?value:Math.min(y,value);
      }
    }
    return y;
  }
  function segmentMinimum(a,b){
    const box=bounds([a,b]),candidates=new Set();let minimum=null;
    for(let x=Math.floor(box.minX/bucketSize);x<=Math.floor(box.maxX/bucketSize);x++)
      for(let z=Math.floor(box.minZ/bucketSize);z<=Math.floor(box.maxZ/bucketSize);z++)
        for(const k of bedBuckets.get(`${x},${z}`)||[])candidates.add(k);
    for(const k of candidates){
      const tri=bedTriangles[k],wa=weights(tri,a),wb=weights(tri,b);
      if(!wa.every(Number.isFinite)||!wb.every(Number.isFinite))continue;
      let lo=0,hi=1;
      for(let i=0;i<3;i++){
        const delta=wb[i]-wa[i];
        if(Math.abs(delta)<1e-10){if(wa[i]<-1e-5)hi=-1;continue;}
        const t=(-1e-5-wa[i])/delta;
        if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
      }
      if(lo>hi)continue;
      for(const t of[lo,hi]){
        const y=height(tri,{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
        if(Number.isFinite(y))minimum=minimum===null?y:Math.min(minimum,y);
      }
    }
    return minimum;
  }
  return {sample,segmentMinimum,triangles:bedTriangles,cutCount,
    source:'existing Thames width/depth profile intersected with existing terrain triangles'};
}
