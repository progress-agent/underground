// Closed, independent basins: the ~137 m terrain grid cannot resolve banks.
// All navigation heights are interpolated from these very triangles. Canonical
// Y is real metres * VE; landscape (including the bank) follows Master.
import * as THREE from 'three';
import { clipPolygonToRing, subtractPolygonRing } from './map-edge-clip.js';
import { WATER_LIFT } from './render-layers.js';

export function inRing(x, z, ring) {
  let hit = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
export function ringArea(ring) { let a=0; for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];a+=p[0]*q[1]-q[0]*p[1];}return a/2; }
export function openRing(ring) {
  const p=ring.filter((q,i,a)=>!i || q[0]!==a[i-1][0] || q[1]!==a[i-1][1]);
  if(p.length>2 && p[0][0]===p.at(-1)[0] && p[0][1]===p.at(-1)[1]) p.pop();
  return ringArea(p)>0?p:p.reverse();
}
// Positive offset is outward. Miter joins retain the mapped outline rather
// than scaling it about a centroid (which distorts long, narrow reservoirs).
export function offsetRing(ring, distance) {
  return ring.map((p,i)=>{
    const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
    let ax=p[0]-a[0],az=p[1]-a[1],bx=b[0]-p[0],bz=b[1]-p[1];
    const al=Math.hypot(ax,az)||1,bl=Math.hypot(bx,bz)||1;
    ax/=al;az/=al;bx/=bl;bz/=bl;
    const nx=az+bz,nz=-ax-bx,d=1+ax*bx+az*bz;
    const k=distance/Math.max(0.5,d);
    return [p[0]+nx*k,p[1]+nz*k];
  });
}
export function densify(ring, step=24) {
  const out=[];
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/step));
    for(let j=0;j<n;j++)out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
  }
  return out;
}
function tri(out,a,b,c) {
  if ((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0])>0)out.push(...a,...c,...b);
  else out.push(...a,...b,...c);
}
function strip(out,a,b) {
  for(let i=0;i<a.length;i++){const j=(i+1)%a.length;tri(out,a[i],a[j],b[i]);tri(out,b[i],a[j],b[j]);}
}
function floor(out,ring,y,holes=[]) {
  const pts=ring.map(p=>new THREE.Vector2(...p)),hs=holes.map(r=>r.map(p=>new THREE.Vector2(...p)));
  const all=[...ring,...holes.flat()];
  for(const t of THREE.ShapeUtils.triangulateShape(pts,hs))tri(out,...t.map(i=>[all[i][0],y,all[i][1]]));
}
export function geometryOf(positions) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}
// 64 m bins of triangles, shared by the visual surface and collisions. No
// second depth formula can disagree with the drawn slope at a shore.
export function triangleSampler(positions) {
  const cells=new Map(),size=64;
  for(let i=0;i<positions.length;i+=9) {
    const x=[positions[i],positions[i+3],positions[i+6]],z=[positions[i+2],positions[i+5],positions[i+8]];
    for(let c=Math.floor(Math.min(...x)/size);c<=Math.floor(Math.max(...x)/size);c++)
      for(let r=Math.floor(Math.min(...z)/size);r<=Math.floor(Math.max(...z)/size);r++) {
        const k=`${c},${r}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);
      }
  }
  return (x,z)=>{
    let y=null;
    for(const i of cells.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)??[]) {
      const ax=positions[i],az=positions[i+2],bx=positions[i+3]-ax,bz=positions[i+5]-az,cx=positions[i+6]-ax,cz=positions[i+8]-az;
      const det=bx*cz-bz*cx;if(Math.abs(det)<1e-9)continue;
      const u=((x-ax)*cz-(z-az)*cx)/det,v=(bx*(z-az)-bz*(x-ax))/det;
      if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7) {
        const h=positions[i+1]+u*(positions[i+4]-positions[i+1])+v*(positions[i+7]-positions[i+1]);
        if(y===null||h>y)y=h;
      }
    }
    return y;
  };
}
/** sourceRing is the WATER outline, not a crest outline. Unsurveyed shaping
 * assumptions (3:1 slopes, 4m crest) are disclosed in docs/deep-water.md. */
export function buildWaterBody(...args) {
  const steps=buildWaterBodySteps(...args);let r;do{r=steps.next();}while(!r.done);return r.value;
}
export function* buildWaterBodySteps(spec, sourceRing, getTerrainY, {VE=5,mapRing=null,otherWater=[]}={}) {
  const original=openRing(sourceRing),depth=spec.depth.renderM;
  const centre=original.reduce((a,p)=>[a[0]+p[0]/original.length,a[1]+p[1]/original.length],[0,0]);
  const bank=spec.bank;
  // Only outside toe samples establish surrounding land. Sampling the wet
  // centroid picks up a DEM's water/crest plateau rather than the floodplain.
  const groundSamples=offsetRing(original,bank?Math.max(70,bank.heightM*4):8).map(p=>getTerrainY({x:p[0],z:p[1]})).filter(Number.isFinite).sort((a,b)=>a-b);
  const ground=groundSamples[Math.floor(groundSamples.length/2)]??0;
  const waterY=spec.level?.aodM!=null?spec.level.aodM*VE:(bank?ground+(bank.heightM-bank.freeboardM)*VE:ground+WATER_LIFT);
  const crestY=bank?(spec.bank.crestAodM!=null?spec.bank.crestAodM*VE:spec.level?.aodM!=null?waterY+bank.freeboardM*VE:ground+bank.heightM*VE):waterY;
  const bedY=waterY-depth*VE;
  // Inset before densifying: offsets of collinear subdivisions otherwise
  // disagree at a miter. A 3:1 inner slope, quay walls are vertical in docks.
  const slope=spec.shoreSlope??(spec.kind==='dock'?0:3);
  const holes=(spec.holes??[]).filter(r=>inRing(r[0][0],r[0][1],original)).map(r=>openRing(r));
  const inner=slope?offsetRing(original,-depth*slope):original;
  const bedHoles=holes.map(r=>slope?offsetRing(r,depth*slope):r);
  const basin=[],banks=[],tops=[];
  const to3=(ring,y)=>ring.map(p=>[p[0],typeof y==='function'?y(p):y,p[1]]);
  strip(basin,to3(original,waterY),to3(inner,bedY));
  for(let i=0;i<holes.length;i++)strip(basin,to3(holes[i],waterY),to3(bedHoles[i],bedY));
  floor(basin,inner,bedY,bedHoles);floor(tops,original,waterY,holes);
  let outer=original;
  if(bank) {
    const crestIn=offsetRing(original,Math.max(0,(crestY-waterY)/VE)*3);
    const crestOut=offsetRing(original,Math.max(0,(crestY-waterY)/VE)*3+4);
    outer=offsetRing(original,Math.max(0,(crestY-waterY)/VE)*3+4+bank.heightM*3);
    strip(banks,to3(original,waterY),to3(crestIn,crestY));
    strip(banks,to3(crestIn,crestY),to3(crestOut,crestY));
    strip(banks,to3(crestOut,crestY),to3(outer,p=>(getTerrainY({x:p[0],z:p[1]})??ground)-0.02));
  }
  yield;
  const extentParts=mapRing?clipPolygonToRing(outer,mapRing):[outer];
  const whole=extentParts.length===1&&Math.abs(Math.abs(ringArea(extentParts[0]))-Math.abs(ringArea(outer)))<0.01;
  const clipOthers=otherWater.map(r=>({ring:r,minX:Math.min(...r.map(p=>p[0])),maxX:Math.max(...r.map(p=>p[0])),minZ:Math.min(...r.map(p=>p[1])),maxZ:Math.max(...r.map(p=>p[1]))}));
  // Clip every triangle, including slopes and dry toes, at the actual map
  // edge. Interpolate Y on the original face, so clipping never moves a crest.
  const clip=function*(positions){
    if(!mapRing||whole)return positions;
    const out=[];
    for(let i=0;i<positions.length;i+=9) {
      if(i%288===0)yield;
      const a=positions.slice(i,i+3),b=positions.slice(i+3,i+6),c=positions.slice(i+6,i+9);
      const ring=[a,b,c].map(p=>[p[0],p[2]]);
      // Most triangles are far from the edge; clipPolygonToRing has a cached
      // segment index and cheaply returns unchanged interior triangles.
      const det=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
      if(Math.abs(det)<1e-9) { // vertical quay wall: clip its horizontal span separately below
        if(inRing((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3,mapRing))out.push(...a,...b,...c);
        continue;
      }
      for(const piece of clipPolygonToRing(ring,mapRing)) {
        const p=piece.map(([x,z])=>{
          const u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/det;
          const v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/det;
          return [x,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]),z];
        });
        for(let j=1;j<p.length-1;j++)tri(out,p[0],p[j],p[j+1]);
      }
    }
    return out;
  };
  // Shared divider banks stop at every other actual water outline. An
  // outward offset alone would put a wide toe inside the adjacent compartment.
  const dryBanks=[];
  for(let i=0;i<banks.length;i+=9) {
    if(i%144===0)yield;
    const a=banks.slice(i,i+3),b=banks.slice(i+3,i+6),c=banks.slice(i+6,i+9);
    const det=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);if(Math.abs(det)<1e-9)continue;
    let pieces=[[a,b,c].map(p=>[p[0],p[2]])];
    for(const r0 of clipOthers) {
      const r=r0.ring;
      if(Math.max(a[0],b[0],c[0])<r0.minX||Math.min(a[0],b[0],c[0])>r0.maxX||Math.max(a[2],b[2],c[2])<r0.minZ||Math.min(a[2],b[2],c[2])>r0.maxZ)continue;
      pieces=pieces.flatMap(p=>subtractPolygonRing(p,r));
    }
    for(const piece of pieces) {
      const pts=piece.map(([x,z])=>{
        const u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/det;
        const v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/det;
        return [x,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]),z];
      });
      const vv=piece.map(p=>new THREE.Vector2(...p));
      for(const t of THREE.ShapeUtils.triangulateShape(vv,[]))tri(dryBanks,...t.map(j=>pts[j]));
    }
  }
  const basinPos=new Float32Array(yield* clip(basin)),bankPos=new Float32Array(yield* clip(dryBanks)),topPos=new Float32Array(yield* clip(tops));
  yield;
  const bedAt=triangleSampler(basinPos);yield;const bankAt=triangleSampler(bankPos);
  const waterRings=mapRing?clipPolygonToRing(original,mapRing):[original];
  const bounds={minX:Math.min(...outer.map(p=>p[0])),maxX:Math.max(...outer.map(p=>p[0])),minZ:Math.min(...outer.map(p=>p[1])),maxZ:Math.max(...outer.map(p=>p[1]))};
  const containsXZ=(x,z)=>waterRings.some(r=>inRing(x,z,r))&&!holes.some(r=>inRing(x,z,r));
  return {spec,original,waterRings,outer,centre,groundY:ground,holes,waterY,bedY,crestY,bounds,basinPos,bankPos,topPos,
    bedAt,bankAt,containsXZ,groundAt:(x,z)=>containsXZ(x,z)?bedAt(x,z):bankAt(x,z),
    contains:p=>p.y<waterY&&containsXZ(p.x,p.z)&&p.y>=(bedAt(p.x,p.z)??Infinity)};
}
