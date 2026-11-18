#!/usr/bin/env node
// Generate compact, terrain-conforming road buffers. Never touches the shared surface store.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {installNodeEnv,ROOT} from '../bake-node-env.mjs';
import {buildNetwork,CLASSES,WIDTHS} from './network.mjs';
import {BNG_REF_E,BNG_REF_N} from '../../src/coordinates.js';
import * as THREE from 'three';
installNodeEnv();
const out=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:path.join(ROOT,'public/data/roads');
fs.mkdirSync(out,{recursive:true});
if(fs.realpathSync(out).startsWith(fs.realpathSync(path.join(ROOT,'public/data/surface'))))throw Error('Road output must never be the shared surface store');
const {getMapEdgeRing}=await import('../../src/m25-edge.js');
const {initThamesMask}=await import('../../src/thames-mask.js');
const {loadM25Data,initM25Boundary}=await import('../../src/m25.js');
const terrain=await import('../../src/terrain.js');
const {createBridges}=await import('../../src/bridges.js');
const thamesData=JSON.parse(fs.readFileSync(path.join(ROOT,'public/data/thames.json')));
initThamesMask(thamesData.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints??m25.points);
await terrain.tryCreateTerrainMesh({thamesData});
const g=(x,z)=>terrain.getTerrainMeshSurfaceY({x,z})??0;
const network=buildNetwork(ROOT,getMapEdgeRing());
const bridgeData=JSON.parse(fs.readFileSync(path.join(ROOT,'public/data/bridges.json'))).bridges;
const bridgeRoadWidths={};
for(const b of bridgeData.filter(b=>b.kind.includes('road'))) {
  const ax=b.axis.a.e-BNG_REF_E,az=BNG_REF_N-b.axis.a.n,bx=b.axis.b.e-BNG_REF_E,bz=BNG_REF_N-b.axis.b.n,dx=bx-ax,dz=bz-az,L=Math.hypot(dx,dz),ux=dx/L,uz=dz/L;
  let half=b.deckWidthM/2;
  for(const r of network.roads)if(r.bridge&&!r.tunnel) {
    const named=r.name?.toLowerCase()===b.name.toLowerCase(),known=b.source?.osmWayIds?.includes(r.id);
    for(let i=1;i<r.p.length;i++) {
      const p=r.p[i-1],q=r.p[i],px=p[0]-ax,pz=p[1]-az,qx=q[0]-ax,qz=q[1]-az;
      const a=px*ux+pz*uz,c=qx*ux+qz*uz,change=c-a;if(Math.abs(change)<1e-6)continue;
      const lo=Math.max(0,Math.min(-a/change,(L-a)/change)),hi=Math.min(1,Math.max(-a/change,(L-a)/change));if(hi<lo)continue;
      const side=t=>(px+(qx-px)*t)*uz-(pz+(qz-pz)*t)*ux;
      const ac=Math.max(Math.abs(side(lo)),Math.abs(side(hi)));
      if(ac>60||(!named&&!known&&ac>b.deckWidthM/2+12))continue;
      if(Math.abs(change)/Math.hypot(qx-px,qz-pz)<.7)continue;
      half=Math.max(half,ac+r.width/2+Math.max(r.left,r.right)+.25);
    }
  }
  const width=Math.ceil(half*20)/10;if(width>b.deckWidthM+.01)bridgeRoadWidths[b.curatedSlug]=width;
}
const legacy=await createBridges({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1});
const bridges=await createBridges({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1,roadWidths:bridgeRoadWidths});
const bridgeMorphs=[],bridgeChunks=[];let bridgeOffset=0;
const oldMorphs=legacy.userData.roadMorphSources();
for(const m of bridges.userData.roadMorphSources())if(bridgeRoadWidths[m.rec.data.curatedSlug]) {
  const old=oldMorphs.find(o=>o.mesh.name===m.mesh.name);
  const a=old?.mesh.geometry.index.array,b=m.mesh.geometry.index.array;
  if(!old||old.original.length!==m.original.length||a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error('Bridge width changes topology: '+m.mesh.name);
  bridgeMorphs.push({slug:m.rec.data.curatedSlug,mesh:m.mesh.name,width:m.rec.data.deckWidthM,vertices:m.original.length/3,offset:bridgeOffset});
  for(const array of [m.original,m.feet]){const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);bridgeChunks.push(bytes);bridgeOffset+=bytes.length;}
}
const bridgeBytes=zlib.gzipSync(Buffer.concat(bridgeChunks),{level:9});fs.writeFileSync(path.join(out,'bridge-decks.bin.gz'),bridgeBytes);
// Immutable copies at both affine endpoints of the existing bridge morph. Interpolating each
// face preserves its 12m longitudinal subdivisions and bank ramps at every Master.
const decks=[];
for(const rec of bridges.userData.registry.values())if(rec.data.kind.includes('road')){
  const a=rec.deckEndpoints.a,b=rec.deckEndpoints.b,dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz);
  decks.push({rec,a,b,dx:dx/L,dz:dz/L,L,width:rec.data.deckWidthM,mesh:rec.deckMesh,one:rec.deckMesh.geometry.attributes.position.array.slice()});
}
bridges.userData.setHeightScale(0);
for(const d of decks)d.zero=d.mesh.geometry.attributes.position.array.slice();
bridges.userData.setHeightScale(1);bridges.updateMatrixWorld(true);
function bridgeFor(p) {for(const d of decks){const dx=p[0]-d.a.x,dz=p[1]-d.a.z,s=dx*d.dx+dz*d.dz,ac=dx*d.dz-dz*d.dx;if(s>=-30&&s<=d.L+30&&Math.abs(ac)<d.width/2+1)return d;}return null;}
const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
const probe=new THREE.Mesh();probe.material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});probe.geometry=new THREE.BufferGeometry();
const cache=new Map();
function bridgeHeight(d,x,z) {
  const key=d.rec.data.curatedSlug+':'+x+','+z;if(cache.has(key))return cache.get(key);
  const along=(x-d.a.x)*d.dx+(z-d.a.z)*d.dz;
  if(along<0||along>d.L) {
    const end=along<0?d.a:d.b,amount=Math.min(1,Math.abs(along<0?along:along-d.L)/30);
    const h=bridgeHeight(d,end.x+d.dx*.01*(along<0?1:-1),end.z+d.dz*.01*(along<0?1:-1));
    return h?.map(y=>y*(1-amount)+g(x,z)*amount)??null;
  }
  probe.matrixWorld.copy(d.mesh.matrixWorld);probe.geometry.setIndex(d.mesh.geometry.index);
  const yy=[];
  for(const p of [d.zero,d.one]){probe.geometry.setAttribute('position',new THREE.BufferAttribute(p,3));probe.geometry.computeBoundingBox();probe.geometry.computeBoundingSphere();ray.ray.origin.set(x,3000,z);const h=ray.intersectObject(probe,false).find(h=>h.point.y<d.rec.deckY+8);yy.push(h?.point.y);}
  const result=yy.every(Number.isFinite)?yy:null;cache.set(key,result);return result;
}
const netParts=[];
for(const r of network.roads){const b=Buffer.alloc(16+r.p.length*8);b.writeUInt32LE(r.id,0);b[4]=r.cls|(r.bridge?16:0)|(r.tunnel?32:0);b.writeInt8(r.layer,5);b.writeUInt16LE(Math.round(r.width*100),6);b.writeUInt16LE(Math.round(r.left*100),8);b.writeUInt16LE(Math.round(r.right*100),10);b.writeUInt32LE(r.p.length,12);r.p.forEach((p,i)=>{b.writeInt32LE(Math.round(p[0]*100),16+i*8);b.writeInt32LE(Math.round(p[1]*100),20+i*8);});netParts.push(b);}
const netHead=Buffer.alloc(8);netHead.write('UGN1');netHead.writeUInt32LE(network.roads.length,4);
const networkBytes=zlib.gzipSync(Buffer.concat([netHead,...netParts]),{level:9});fs.writeFileSync(path.join(out,'network.bin.gz'),networkBytes);
const groups=new Map();
const LIFT=.30; // 6cm real in canonical VE5, plus polygon offset at render. Landscape follows Master.
function group(key,x,z,size,tier){if(!groups.has(key))groups.set(key,{key,x:x-64,z:z-64,size,tier,parts:[],pos:[],road:[],rise:[],idx:[]});return groups.get(key);}
function flush(c){
  if(!c.idx.length)return;
  // Weld identical vertices and remove quantisation-degenerate triangles. Side and pavement
  // metadata are part of the key, so this cannot erase K's carriageway edges or morph seams.
  const pos=[],road=[],rise=[],idx=[],keys=new Map();
  for(let i=0;i<c.idx.length;i+=3){
    const ids=c.idx.slice(i,i+3),[a,b,d]=ids;
    const area=(c.pos[b*3]-c.pos[a*3])*(c.pos[d*3+2]-c.pos[a*3+2])-(c.pos[b*3+2]-c.pos[a*3+2])*(c.pos[d*3]-c.pos[a*3]);
    if(!area)continue;
    for(const j of ids){const p=c.pos.slice(j*3,j*3+3),r=c.road.slice(j*3,j*3+3),h=c.rise[j],key=[...p,...r,h].join(',');
      let at=keys.get(key);if(at===undefined){at=pos.length/3;keys.set(key,at);pos.push(...p);road.push(...r);rise.push(h);}idx.push(at);
    }
  }
  if(idx.length)c.parts.push({pos:Uint16Array.from(pos),road:Uint8Array.from(road),rise:rise.some(v=>v!==0)?Int16Array.from(rise):null,idx:Uint16Array.from(idx)});
  c.pos=[];c.road=[];c.rise=[];c.idx=[];
}
function append(c,pts,r,d){
  const half=(r.width+r.left+r.right)/2; // bands live in the same ribbon, outside the tagged carriageway
  if(c.pos.length/3+pts.length*2>65000)flush(c);
  let base=c.pos.length/3;const offset=(r.right-r.left)/2;
  // Sample the actual rails, then subdivide where a terrain triangle crease would cut
  // through a straight ribbon. This is adaptive to the drawn surface, not another DEM.
  const rails=[];
  for(let i=0;i<pts.length;i++) {
    const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    rails.push([-1,1].map(side=>[pts[i][0]-dz/len*(side*half+offset),pts[i][1]+dx/len*(side*half+offset),pts[i][2]]));
  }
  const dense=[rails[0]],bounds=terrain.getTerrainBounds();
  const gridX=bounds.widthM/(bounds.columns-1),gridZ=bounds.heightM/(bounds.rows-1);
  for(let i=1;i<rails.length;i++) {
    const a=rails[i-1],b=rails[i],cuts=[0,1];
    if(!r.bridge&&!d)for(let side=0;side<2;side++){
      const p=a[side],q=b[side];
      const u=[(p[0]-bounds.minX)/gridX,(p[1]-bounds.minZ)/gridZ];
      const v=[(q[0]-bounds.minX)/gridX,(q[1]-bounds.minZ)/gridZ];
      u.push(u[0]+u[1]);v.push(v[0]+v[1]);
      for(let axis=0;axis<3;axis++)if(Math.abs(v[axis]-u[axis])>1e-9)
        for(let k=Math.floor(Math.min(u[axis],v[axis]))+1;k<Math.max(u[axis],v[axis]);k++){
          const t=(k-u[axis])/(v[axis]-u[axis]);if(t>1e-7&&t<1-1e-7)cuts.push(t);
        }
    }
    cuts.sort((a,b)=>a-b);
    let prev=0;for(const t of cuts.slice(1)){if(t-prev<1e-7)continue;dense.push(a.map((p,side)=>p.map((v,j)=>v+(b[side][j]-v)*t)));prev=t;}
  }
  if(c.pos.length/3+dense.length*2>65000){
    flush(c);
    if(dense.length*2>65000){const mid=Math.floor(pts.length/2);append(c,pts.slice(0,mid+1),r,d);append(c,pts.slice(mid),r,d);return;}
  }

  base=c.pos.length/3;
  for(let i=0;i<dense.length;i++){
    for(const [side,point] of [[-1,dense[i][0]],[1,dense[i][1]]]){
      let [x,z]=point;
      // Quantise X/Z before sampling Y, so height corresponds to the exact drawn point.
      const qx=Math.round((x-c.x)*8),qz=Math.round((z-c.z)*8);x=c.x+qx/8;z=c.z+qz/8;
      let y=g(x,z),rise=0;
      if(d){const h=bridgeHeight(d,x,z);if(h){y=h[1];rise=h[1]-h[0];}}
      else if(r.bridge){
        // An unsurveyed non-Thames deck spans the measured terrain landings. Do not
        // add road-clearance metres above its landings: that makes short canal bridges
        // into implausibly steep humps. The inferred clearance is the end-to-end chord
        // above the local terrain depression, never a fabricated absolute elevation.
        const t=point[2],a=g(r.p[0][0],r.p[0][1]),b=g(r.p.at(-1)[0],r.p.at(-1)[1]);
        const datum=a+(b-a)*t;rise=Math.max(0,datum-y);y+=rise;
      }
      y+=LIFT;
      const qy=Math.round((y/5+100)*100);
      if([qx,qy,qz].some(v=>v<0||v>65535||!Number.isFinite(v)))throw Error('Road position overflow '+JSON.stringify({road:r.id,block:c.key,qx,qy,qz}));
      c.pos.push(qx,qy,qz);
      c.rise.push(Math.round(rise/.05));
      c.road.push(Math.min(255,Math.round(half*4)),Math.round(r.left*10)+(side>0?128:0),Math.round(r.right*10));
    }
  }
  // Each rail is simplified independently in quantised X/Z, height and Master delta.
  // Max deviation: two horizontal quanta (250mm) and three vertical quanta (30mm real).
  // This removes redundant samples from the opposite rail at every terrain-grid crossing.
  const rawPos=c.pos.slice(base*3),rawRoad=c.road.slice(base*3),rawRise=c.rise.slice(base);
  const keepRail=side=>{
    const n=dense.length,keep=new Uint8Array(n);keep[0]=keep[n-1]=1;
    const at=i=>{const j=i*2+side;return[rawPos[j*3]/2,rawPos[j*3+2]/2,rawPos[j*3+1]/3,rawRise[j]/3];};
    const stack=[[0,n-1]];
    while(stack.length){const[a,b]=stack.pop();if(b-a<2)continue;const p=at(a),q=at(b),d=q.map((v,i)=>v-p[i]),l=d.reduce((s,v)=>s+v*v,0);let max=1,which=-1;
      for(let i=a+1;i<b;i++){const r=at(i),t=l?Math.max(0,Math.min(1,r.reduce((s,v,k)=>s+(v-p[k])*d[k],0)/l)):0,err=r.reduce((s,v,k)=>s+(v-p[k]-t*d[k])**2,0);if(err>max){max=err;which=i;}}
      if(which>=0){keep[which]=1;stack.push([a,which],[which,b]);}
    }
    return Array.from(keep,(v,i)=>v?i:-1).filter(i=>i>=0);
  };
  const left=keepRail(0),right=keepRail(1);
  c.pos.length=base*3;c.road.length=base*3;c.rise.length=base;
  const write=(kept,side)=>kept.map(t=>{const j=t*2+side,index=c.pos.length/3;c.pos.push(...rawPos.slice(j*3,j*3+3));c.road.push(...rawRoad.slice(j*3,j*3+3));c.rise.push(rawRise[j]);return{t,index};});
  const ls=write(left,0),rs=write(right,1);
  const triangle=(a,b,d)=>{const ids=[a,b,d],[p,q,r]=ids.map(i=>[c.pos[i*3],c.pos[i*3+2]]);if((q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1])<0)[ids[1],ids[2]]=[ids[2],ids[1]];c.idx.push(...ids);};
  let li=0,ri=0;
  while(li<ls.length-1||ri<rs.length-1){
    if(ri===rs.length-1||(li<ls.length-1&&ls[li+1].t<=rs[ri+1].t)){triangle(ls[li].index,rs[ri].index,ls[li+1].index);li++;}
    else{triangle(ls[li].index,rs[ri].index,rs[ri+1].index);ri++;}
  }
}
for(const r of network.roads){
  if(r.tunnel)continue;
  const p=r.p;if(p.length<2)continue;
  const d=(()=>{
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1;
      for(const point of [a,b,[(a[0]+b[0])/2,(a[1]+b[1])/2]]){
        const d=bridgeFor(point);if(!d||Math.abs(dx*d.dx+dz*d.dz)/L<.7)continue;
        const along=(point[0]-d.a.x)*d.dx+(point[1]-d.a.z)*d.dz;
        if(r.bridge||along<30||along>d.L-30)return d;
      }
    }return null;
  })();
  const cumulative=[0];for(let i=1;i<p.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
  const L=cumulative.at(-1);if(L<.05)continue;
  const samples=[];
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],len=cumulative[i]-cumulative[i-1],n=Math.max(1,Math.ceil(len/(r.bridge||d?6:Infinity)));
    for(let j=0;j<n;j++)samples.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n,(cumulative[i-1]+len*j/n)/L]);
  }
  samples.push([...p.at(-1),1]);
  // Extend square end caps beneath intersecting ways. Collinear end surfaces share identical
  // height sampling, winding and depth bias, so overlaps cannot flicker between different colours.
  if(!r.bridge){const e=(r.width+r.left+r.right)/2;for(const[i,j,sgn]of [[0,1,-1],[samples.length-1,samples.length-2,-1]]){const a=samples[i],b=samples[j],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;a[0]+=sgn*dx/l*e;a[1]+=sgn*dz/l*e;}}
  for(const [size,tier] of [[8000,'desktop'],...(r.cls<=4?[[8000,'major']]:[[2000,'near']])]){
    let run=[],last=null;
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],cuts=[0,1];
      for(const axis of [0,1])if(Math.abs(b[axis]-a[axis])>1e-9)
        for(let k=Math.floor(Math.min(a[axis],b[axis])/size)+1;k<=Math.floor(Math.max(a[axis],b[axis])/size);k++) {
          const t=(k*size-a[axis])/(b[axis]-a[axis]);if(t>1e-9&&t<1-1e-9)cuts.push(t);
        }
      cuts.sort((a,b)=>a-b);
      for(let j=1;j<cuts.length;j++) {
        const lo=cuts[j-1],hi=cuts[j];if(hi-lo<1e-9)continue;
        const p=a.map((v,k)=>v+(b[k]-v)*lo),q=a.map((v,k)=>v+(b[k]-v)*hi);
        const x=Math.floor((p[0]+q[0])/2/size)*size,z=Math.floor((p[1]+q[1])/2/size)*size;
        const key=tier+'-'+x+'-'+z;
        if(last&&key!==last.key){append(last,run,r,d);run=[];}
        last=group(key,x,z,size,tier);
        if(!run.length)run.push(p);run.push(q);
      }
    }
    if(last&&run.length>1)append(last,run,r,d);
  }
}
const records=[];let totalGPU=0,compressedBytes=0;
for(const c of [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))){flush(c);for(let j=0;j<c.parts.length;j++){
  const p=c.parts[j],n=p.pos.length/3,head=Buffer.alloc(32);head.write('UGR4');head.writeUInt32LE(n,4);head.writeUInt32LE(p.idx.length,8);head.writeInt32LE(c.x,12);head.writeInt32LE(c.z,16);head.writeUInt32LE(p.rise?1:0,20);
  const raw=Buffer.concat([head,Buffer.from(p.pos.buffer),Buffer.from(p.road.buffer),Buffer.alloc(n%2),...(p.rise?[Buffer.from(p.rise.buffer)]:[]),Buffer.from(p.idx.buffer)]),body=zlib.gzipSync(raw,{level:9});
  const file=c.key+'-'+j+'.bin.gz';fs.writeFileSync(path.join(out,file),body);
  const gpu=raw.length-32;if(c.tier==='desktop')totalGPU+=gpu;compressedBytes+=body.length;
  let lo=Infinity,hi=-Infinity;for(let i=1;i<p.pos.length;i+=3){const y=(p.pos[i]/100-100)*5;lo=Math.min(lo,y);hi=Math.max(hi,y);}
  records.push({file,tier:c.tier,x:c.x+64,z:c.z+64,size:c.size,vertices:n,indices:p.idx.length,bytes:gpu,sha256:createHash('sha256').update(body).digest('hex'),bounds:[c.x,c.z,lo,c.x+c.size+128,c.z+c.size+128,hi]});
}}
const meta={format:'UGR4',source:'© OpenStreetMap contributors, ODbL 1.0',licence:'https://www.openstreetmap.org/copyright',classes:CLASSES,classWidthsM:WIDTHS,stats:network.stats,networkSHA256:createHash('sha256').update(networkBytes).digest('hex'),desktopGPUBytes:totalGPU,compressedGeometryBytes:compressedBytes,bridgeRoadWidths,bridgeMorphs,bridgeBytes:bridgeOffset,bridgeSHA256:createHash('sha256').update(bridgeBytes).digest('hex'),records};
const keep=new Set(['manifest.json','network.bin.gz','bridge-decks.bin.gz',...records.map(r=>r.file)]);
for(const file of fs.readdirSync(out))if((file.endsWith('.bin.gz')||file==='manifest.json')&&!keep.has(file))fs.unlinkSync(path.join(out,file));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(meta));
console.log(JSON.stringify({...network.stats,files:records.length,desktopGPUBytes:totalGPU,compressedGeometryBytes:compressedBytes}));
