// OSM-derived geometry © OpenStreetMap contributors, ODbL 1.0.
import { ShapeUtils, Vector2 } from 'three';

export function roofTriangles(ring) {
  const triangles=ShapeUtils.triangulateShape(ring.map(p=>new Vector2(...p)),[]);
  let area=0,roof=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-a[1]*b[0];}
  area=Math.abs(area)/2;
  for(const [i,j,k]of triangles){const a=ring[i],b=ring[j],c=ring[k];roof+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
  return {triangles,area,roof,valid:area>0&&Math.abs(roof/area-1)<=.01};
}

// 32 B/vertex: xyz, base/centre-x/centre-z/height, wall distance. Two vertices
// per ring point, plus a seam duplicate. Flat normals come from derivatives.
export function packChunk(buildings) {
  const vertices=[], indices=[], records=[];
  for(const b of buildings) {
    const start=vertices.length/8, first=indices.length, ring=b.ring;
    let along=0;
    for(let i=0;i<=ring.length;i++) {
      const p=ring[i%ring.length];
      if(i)along+=Math.hypot(p[0]-ring[(i-1)%ring.length][0],p[1]-ring[(i-1)%ring.length][1]);
      for(const dy of [0,b.height])vertices.push(p[0],b.base+dy,p[1],b.base,b.x,b.z,b.height,along);
      if(i<ring.length) { const a=start+i*2,c=a+2; indices.push(a,a+1,c,c,a+1,c+1); }
    }
    // Positive x/z shoelace: top triangles must face +Y (negative x/z winding).
    const roof=roofTriangles(ring);
    if(!roof.valid)throw new Error(`invalid outline roof at ${b.x},${b.z}`);
    for(const t of roof.triangles) {
      const [a,c,d]=t.map(i=>start+i*2+1); indices.push(a,d,c);
    }
    records.push({...b,start,first,indices:indices.length-first});
  }
  const n=records.length,v=vertices.length/8,k=indices.length;
  if(v>65535)throw new Error('outline chunk exceeds uint16 vertex address');
  const rawBytes=12+n*48+vertices.length*4+k*2,buf=Buffer.alloc((rawBytes+3)&~3);
  buf.writeUInt32LE(n,0);buf.writeUInt32LE(v,4);buf.writeUInt32LE(k,8);
  records.forEach((b,i)=>{
    const o=12+i*48;
    [b.x,b.z,b.rectX,b.rectZ,b.height,b.base].forEach((x,j)=>buf.writeFloatLE(x,o+j*4));
    [b.ring.length,b.start,b.first,b.indices,b.tile,b.ordinal].forEach((x,j)=>buf.writeUInt32LE(x,o+24+j*4));
  });
  Buffer.from(new Float32Array(vertices).buffer).copy(buf,12+n*48);
  Buffer.from(new Uint16Array(indices).buffer).copy(buf,12+n*48+vertices.length*4);
  return buf;
}

export function packSet(buildings,{maxVertices=8192}={}) {
  const chunks=[];let pending=[],vertices=0;
  for(const b of buildings) {
    const n=2*(b.ring.length+1);
    if(pending.length&&(vertices+n>maxVertices||pending.length>=128||b.tile!==pending[0].tile)){chunks.push(packChunk(pending));pending=[];vertices=0;}
    pending.push(b);vertices+=n;
  }
  if(pending.length)chunks.push(packChunk(pending));
  const header=Buffer.alloc(16+chunks.length*8);header.write('UGO1');header.writeUInt32LE(1,4);
  header.writeUInt32LE(chunks.length,8);header.writeUInt32LE(buildings.length,12);
  let offset=header.length;
  chunks.forEach((c,i)=>{header.writeUInt32LE(offset,16+i*8);header.writeUInt32LE(c.length,20+i*8);offset+=c.length;});
  return Buffer.concat([header,...chunks]);
}
