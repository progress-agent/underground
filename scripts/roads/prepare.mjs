#!/usr/bin/env node
// Generate compact, terrain-conforming road buffers. Never touches the shared surface store.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {installNodeEnv,ROOT} from '../bake-node-env.mjs';
import {buildNetwork,CLASSES,WIDTHS} from './network.mjs';
import {carriagewayIndex,trimJunction,split,cut,area,bounds} from './polygons.mjs';
import {roadOverpassConstraints,overpassDatum} from './overpasses.mjs';
import {surfaceIndex,overlap,conformRoadTriangle,supportFace,raiseRoadDeck} from './support.mjs';
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
const terrainResult=await terrain.tryCreateTerrainMesh({thamesData});
// C lowers the coarse ground beneath four fine bank meshes. Compile roads
// against those same dry support triangles, after they exist, before clearance.
const {createDeepWaterSteps}=await import('../../src/deep-water.js');
const {inReservoirFootRegion}=await import('../../src/reservoir-feet.js');
const {anchorReservoirBuildings,reservoirRoadBase,reservoirBuildingBase}=await import('../../src/reservoir-buildings.js');
const inventory=JSON.parse(fs.readFileSync(path.join(ROOT,'public/data/deep-water.json')));
const steps=createDeepWaterSteps({...inventory,bodies:inventory.bodies.map(b=>({...b,seaLife:false}))},
  terrain.getTerrainMeshSurfaceY,getMapEdgeRing());
let bankStep;do{bankStep=steps.next();}while(!bankStep.done);
anchorReservoirBuildings(bankStep.value,null);
const targets=bankStep.value.bodies.filter(b=>/William Girling|Staines|Bessborough/.test(b.spec.name));
const supportRegions=targets.map(b=>{const x=b.outer.map(p=>p[0]),z=b.outer.map(p=>p[1]);return[Math.min(...x)-110,Math.min(...z)-110,Math.max(...x)+110,Math.max(...z)+110];});
const terrainFaces=surfaceIndex([terrainResult.mesh],supportRegions);
const bankFaces=surfaceIndex(bankStep.value.bodies.filter(b=>b.bankMesh).map(b=>b.bankMesh),supportRegions);
const g=(x,z)=>reservoirRoadBase(x,z,terrain.getTerrainMeshSurfaceY({x,z})??0);
const legacy=process.argv.includes('--legacy');
const audit=process.argv.includes('--audit')?{pavementArea:0,overlapArea:0,triangles:0}:null;
const network=buildNetwork(ROOT,getMapEdgeRing(),{legacy});
const junctionIndex=carriagewayIndex(network.roads);
const overpasses=roadOverpassConstraints(network.roads,g);
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
const legacyBridges=await createBridges({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1});
const bridges=await createBridges({getTerrainMeshSurfaceY:terrain.getTerrainMeshSurfaceY,heightScale:1,roadWidths:bridgeRoadWidths});
const bridgeMorphs=[],bridgeChunks=[];let bridgeOffset=0;
const oldMorphs=legacyBridges.userData.roadMorphSources();
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
function group(key,x,z,size,tier){if(!groups.has(key))groups.set(key,{key,x:x-64,z:z-64,size,tier,parts:[],pos:[],road:[],rise:[],idx:[],farIdx:[],owner:[]});return groups.get(key);}
function flush(c){
  if(!c.idx.length)return;
  // Exact local overlay, including triangle interiors, at the four repaired feet.
  // All other faces retain their original quantised vertices and aerial indices.
  let pos=[],road=[],rise=[],across=[],idx=[],farIdx=[],keys=new Map();
  const finish=(vertices=pos,metadata=road,morph=rise,ac=across,near=idx,far=farIdx)=>{
    if(vertices.length/3>65000){
      const ranges=[0,2].map(axis=>{let lo=Infinity,hi=-Infinity;for(let i=axis;i<vertices.length;i+=3){lo=Math.min(lo,vertices[i]);hi=Math.max(hi,vertices[i]);}return{axis,lo,hi};}).sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo));
      const {axis,lo,hi}=ranges[0],mid=(lo+hi)/2;
      for(const side of [0,1]){const pp=[],rr=[],hh=[],aa=[],nn=[],ff=[],map=new Map();
        for(const [source,target]of [[near,nn],[far,ff]])for(let i=0;i<source.length;i+=3){const ids=source.slice(i,i+3);if(Number(ids.reduce((s,j)=>s+vertices[j*3+axis],0)/3>=mid)!==side)continue;
          for(const j of ids){if(!map.has(j)){map.set(j,pp.length/3);pp.push(...vertices.slice(j*3,j*3+3));rr.push(...metadata.slice(j*3,j*3+3));hh.push(morph[j]);aa.push(ac[j]);}target.push(map.get(j));}
        }
        if(nn.length||ff.length)finish(pp,rr,hh,aa,nn,ff);
      }
      return;
    }
    const positions=(vertices.some(v=>!Number.isInteger(v))?Float32Array:Uint16Array).from(vertices);
    const upward=indices=>{const out=[];for(let i=0;i<indices.length;i+=3){let [a,b,d]=indices.slice(i,i+3);const det=(positions[b*3]-positions[a*3])*(positions[d*3+2]-positions[a*3+2])-(positions[b*3+2]-positions[a*3+2])*(positions[d*3]-positions[a*3]);// Overlay intersections can collapse into sub-millimetre slivers in
      // Float32 storage. Remove faces below 10 cm² rather than retaining
      // numerically unstable scraps along a bank's discontinuous boundary.
      const longest=Math.max(...[[a,b],[b,d],[d,a]].map(([a,b])=>Math.hypot(positions[a*3]-positions[b*3],positions[a*3+2]-positions[b*3+2])));
      if(Math.abs(det)/128<.001||Math.abs(det)/longest/8<.005)continue;if(det>0)[b,d]=[d,b];out.push(a,b,d);}return out;};
    near=upward(near);far=upward(far);if(far.length>near.length)far=near; // clipped slivers may cost more than the full topology locally
    if(near.length||far.length)c.parts.push({pos:positions,road:Uint8Array.from(metadata),
      rise:morph.some(v=>v!==0)?Int16Array.from(morph):null,
      across:ac.some((v,i)=>v!==(metadata[i*3+1]>=128?32767:-32767))?Int16Array.from(ac):null,
      idx:Uint16Array.from(near),farIdx:Uint16Array.from(far)});
  };
  const emitRaw=(points,far)=>{
    if(audit&&c.tier==='desktop'&&!far){
      const r=points[0].owner,half=points[0].road[0]/4;
      const tri=points.map(p=>[c.x+p.pos[0]/8,c.z+p.pos[2]/8,p.across/32767*half]);
      const left=points[0].road[1]%128/10,right=points[0].road[2]%128/10;
      const bands=[...(left?[split(tri,p=>-half+left-p[2])[0]]:[]),...(right?[split(tri,p=>p[2]-half+right)[0]]:[])].filter(p=>p.length);
      const faces=junctionIndex(bounds(tri)).filter(f=>f.r.id!==r.id&&f.r.layer===r.layer&&f.r.bridge===r.bridge);
      for(const band of bands){const total=area(band);let remaining=[band];for(const f of faces)remaining=remaining.flatMap(p=>cut(p,f.polygon).outside);
        audit.pavementArea+=total;audit.overlapArea+=Math.max(0,total-remaining.reduce((s,p)=>s+area(p),0));}
      audit.triangles++;
    }
    const [a,b,d]=points.map(p=>p.pos);
    if((b[0]-a[0])*(d[2]-a[2])-(b[2]-a[2])*(d[0]-a[0])===0)return;
    for(const p of points){const key=[...p.pos,...p.road,p.rise,p.across].join(',');let at=keys.get(key);
      if(at===undefined){at=pos.length/3;keys.set(key,at);pos.push(...p.pos);road.push(...p.road);rise.push(p.rise);across.push(p.across);}
      (far?farIdx:idx).push(at);
    }
  };
  const emit=(points,far)=>{
    if(legacy){emitRaw(points,far);return;}
    const r=points[0].owner;
    const half=(r.width+r.left+r.right)/2;
    const precise=points.some(p=>p.pos.some(v=>!Number.isInteger(v)));
    const quantize=v=>precise?Math.fround(v):Math.round(v);
    const triangle=points.map(p=>[c.x+p.pos[0]/8,c.z+p.pos[2]/8,p.across/32767*half,p.pos[1],p.rise]);
    for(const {polygon,junction} of trimJunction(triangle,r,junctionIndex))for(let i=1;i<polygon.length-1;i++){
      emitRaw([polygon[0],polygon[i],polygon[i+1]].map(p=>({
        owner:r,pos:[quantize((p[0]-c.x)*8),quantize(p[3]),quantize((p[1]-c.z)*8)],
        road:[points[0].road[0],junction?0:points[0].road[1]%128,junction?128:points[0].road[2]%128],
        rise:Math.round(p[4]),across:Math.round(Math.max(-1,Math.min(1,p[2]/half))*32767),
      })),far);
    }
  };
  const vertex=j=>({owner:c.owner[j],pos:c.pos.slice(j*3,j*3+3),road:c.road.slice(j*3,j*3+3),rise:c.rise[j],across:c.road[j*3+1]>=128?32767:-32767});
  for(const [indices,far]of [[c.idx,false],[c.farIdx,true]])for(let i=0;i<indices.length;i+=3){
    const points=indices.slice(i,i+3).map(vertex);
    const tri=points.map(p=>[c.x+p.pos[0]/8,c.z+p.pos[2]/8,p.across/32767,p.pos[1]*.05-500-LIFT,p.rise*.05]);
    const box=[Math.min(...tri.map(p=>p[0])),Math.min(...tri.map(p=>p[1])),Math.max(...tri.map(p=>p[0])),Math.max(...tri.map(p=>p[1]))];
    if(!supportRegions.some(r=>overlap(r,box))){emit(points,far);continue;}
    // A bridge keeps its inferred deck chord where it is already above the
    // bank. Where that chord is buried, the bank becomes its new support.
    const bridge=points.some(p=>p.rise),deck=bridge?supportFace(tri.map(v=>[v[0],v[1],v[3]])):null;
    let refined=conformRoadTriangle(tri,terrainFaces(box),bankFaces(box));
    if(deck)refined=raiseRoadDeck(refined,deck);
    for(const t of refined){
      const centre=[t.reduce((s,p)=>s+p[0]/3,0),t.reduce((s,p)=>s+p[1]/3,0)];
      emit(t.map(v=>{
        let x=v[0],z=v[1],qx,qz,support;
        const expected=v[3]-(deck?v[4]:0);
        // At a discontinuous shore boundary, a Float32 point can select the
        // neighbouring face. Move only such boundary vertices a few mm into
        // their own clipped face, then sample the final stored coordinate.
        for(const inset of [0,.002,.005,.01]){
          if(inset){const dx=centre[0]-v[0],dz=centre[1]-v[1],d=Math.hypot(dx,dz);x=v[0]+dx/d*Math.min(inset,d/4);z=v[1]+dz/d*Math.min(inset,d/4);}
          qx=Math.fround((x-c.x)*8);qz=Math.fround((z-c.z)*8);x=c.x+qx/8;z=c.z+qz/8;support=g(x,z);
          if(Math.abs(support-expected)<.25)break;
        }
        // Navigation includes the wet-bed lip at some boundary vertices.
        // Retain that small lip without spanning a whole underwater basin.
        const lip=reservoirBuildingBase(x,z,terrain.getTerrainMeshSurfaceY({x,z})??support);
        if(lip>support&&lip-support<.25)support=lip;
        const y=deck?Math.max(support,deck.height(x,z)):support;
        return {owner:points[0].owner,pos:[qx,(y+LIFT+500)*20,qz],road:points[0].road,rise:deck?Math.round((y-support)/.05):0,across:Math.round(Math.max(-1,Math.min(1,v[2]))*32767)};
      }),far);
    }
  }
  finish();
  c.pos=[];c.road=[];c.rise=[];c.idx=[];c.farIdx=[];c.owner=[];
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
    // The bank slopes are finer than the DEM grid. Retain their contact along
    // the rail as well as at endpoints; ordinary roads keep R's exact sampling.
    if(a.some(p=>inReservoirFootRegion(p[0],p[1]))||b.some(p=>inReservoirFootRegion(p[0],p[1]))) {
      const n=Math.ceil(Math.max(...a.map((p,s)=>Math.hypot(b[s][0]-p[0],b[s][1]-p[1])))/2);
      for(let j=1;j<n;j++)cuts.push(j/n);
    }
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
        const datum=overpassDatum(t,a,b,overpasses.get(r));rise=Math.max(0,datum-y);y+=rise;
      }
      y+=LIFT;
      const qy=Math.round((y/5+100)*100);
      if([qx,qy,qz].some(v=>v<0||v>65535||!Number.isFinite(v)))throw Error('Road position overflow '+JSON.stringify({road:r.id,block:c.key,qx,qy,qz}));
      c.owner.push(r);
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
  c.pos.length=base*3;c.road.length=base*3;c.rise.length=base;c.owner.length=base;
  const write=(kept,side)=>kept.map(t=>{const j=t*2+side,index=c.pos.length/3;c.owner.push(r);c.pos.push(...rawPos.slice(j*3,j*3+3));c.road.push(...rawRoad.slice(j*3,j*3+3));c.rise.push(rawRise[j]);return{t,index};});
  const ls=write(left,0),rs=write(right,1);
  const triangle=(a,b,d)=>{const ids=[a,b,d],[p,q,r]=ids.map(i=>[c.pos[i*3],c.pos[i*3+2]]);if((q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1])<0)[ids[1],ids[2]]=[ids[2],ids[1]];c.idx.push(...ids);};
  const stitch=(left,right)=>{
    let li=0,ri=0;
    while(li<left.length-1||ri<right.length-1){
      if(ri===right.length-1||(li<left.length-1&&left[li+1].t<=right[ri+1].t)){triangle(left[li].index,right[ri].index,left[li+1].index);li++;}
      else{triangle(left[li].index,right[ri].index,right[ri+1].index);ri++;}
    }
  };
  stitch(ls,rs);
  if(c.tier==='desktop'){
    const simplify=rail=>{
      const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]),runBox=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
      if(r.bridge||d||rail.length<3||supportRegions.some(r=>overlap(r,runBox)))return rail;
      const tolerance=Math.min(2,r.width/4);
      const at=k=>{const j=rail[k].index;return[c.pos[j*3]/(8*tolerance),c.pos[j*3+2]/(8*tolerance),c.pos[j*3+1]/100];};
      // Aerial-only rendering tolerance: up to 2m (at most a quarter carriageway width)
      // horizontally / 1m real vertically. Every road, width and endpoint is retained.
      const keep=new Set([0,rail.length-1]),stack=[[0,rail.length-1]];
      while(stack.length){const[a,b]=stack.pop();if(b-a<2)continue;const p=at(a),q=at(b),d=q.map((v,k)=>v-p[k]),l=d.reduce((s,v)=>s+v*v,0);let max=1,which=-1;
        for(let i=a+1;i<b;i++){const v=at(i),t=l?Math.max(0,Math.min(1,v.reduce((s,v,k)=>s+(v-p[k])*d[k],0)/l)):0,err=v.reduce((s,v,k)=>s+(v-p[k]-t*d[k])**2,0);if(err>max){max=err;which=i;}}
        if(which>=0){keep.add(which);stack.push([a,which],[which,b]);}
      }
      return rail.filter((_,i)=>keep.has(i));
    };
    const near=c.idx;c.idx=c.farIdx;stitch(simplify(ls),simplify(rs));c.farIdx=c.idx;c.idx=near;
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
  // Butt caps meet at the mapped junction. --legacy is solely the R1 baseline instrument.
  if(legacy&&!r.bridge){const e=(r.width+r.left+r.right)/2;for(const[i,j]of [[0,1],[samples.length-1,samples.length-2]]){const a=samples[i],b=samples[j],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;a[0]-=dx/l*e;a[1]-=dz/l*e;}}
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
  const p=c.parts[j],n=p.pos.length/3,head=Buffer.alloc(32);head.write('UGR4');head.writeUInt32LE(n,4);head.writeUInt32LE(p.idx.length,8);head.writeInt32LE(c.x,12);head.writeInt32LE(c.z,16);head.writeUInt32LE(p.rise?1:0,20);head.writeUInt32LE(p.farIdx.length,24);head.writeUInt32LE((p.across?1:0)|(p.pos instanceof Float32Array?2:0),28);
  const raw=Buffer.concat([head,Buffer.from(p.pos.buffer),Buffer.from(p.road.buffer),Buffer.alloc(n%2),...(p.rise?[Buffer.from(p.rise.buffer)]:[]),Buffer.from(p.idx.buffer),Buffer.from(p.farIdx.buffer),...(p.across?[Buffer.from(p.across.buffer)]:[])]),body=zlib.gzipSync(raw,{level:9});
  const file=c.key+'-'+j+'.bin.gz';fs.writeFileSync(path.join(out,file),body);
  const gpu=raw.length-32;if(c.tier==='desktop')totalGPU+=gpu;compressedBytes+=body.length;
  let lo=Infinity,hi=-Infinity;for(let i=1;i<p.pos.length;i+=3){const y=(p.pos[i]/100-100)*5;lo=Math.min(lo,y);hi=Math.max(hi,y);}
  records.push({file,tier:c.tier,x:c.x+64,z:c.z+64,size:c.size,vertices:n,indices:p.idx.length,bytes:gpu,sha256:createHash('sha256').update(body).digest('hex'),bounds:[c.x,c.z,lo,c.x+c.size+128,c.z+c.size+128,hi]});
}}
const meta={format:'UGR4',source:'© OpenStreetMap contributors, ODbL 1.0',licence:'https://www.openstreetmap.org/copyright',classes:CLASSES,classWidthsM:WIDTHS,stats:network.stats,networkSHA256:createHash('sha256').update(networkBytes).digest('hex'),desktopGPUBytes:totalGPU,compressedGeometryBytes:compressedBytes,bridgeRoadWidths,bridgeMorphs,bridgeBytes:bridgeOffset,bridgeSHA256:createHash('sha256').update(bridgeBytes).digest('hex'),records};
const keep=new Set(['manifest.json','network.bin.gz','bridge-decks.bin.gz',...records.map(r=>r.file)]);
for(const file of fs.readdirSync(out))if((file.endsWith('.bin.gz')||file==='manifest.json')&&!keep.has(file))fs.unlinkSync(path.join(out,file));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(meta));
if(audit){audit.percent=100*audit.overlapArea/audit.pavementArea;fs.writeFileSync(path.join(out,'junction-audit.json'),JSON.stringify(audit,null,2));}
console.log(JSON.stringify({...network.stats,files:records.length,desktopGPUBytes:totalGPU,compressedGeometryBytes:compressedBytes}));
