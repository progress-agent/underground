import * as THREE from 'three';
import { buildWaterBodySteps, geometryOf, inRing } from './water-body-geometry.js';
import { createWaterMaterial } from './water-material.js';
import { clipPolygonToRing, subtractPolygonRing } from './map-edge-clip.js';
import { createLakeSeaLife } from './lake-sea-life.js';
import { RENDER_ORDER } from './render-layers.js';

export async function loadDeepWaterData() {
  const r=await fetch('/data/deep-water.json');if(!r.ok)throw Error(`Water inventory HTTP ${r.status}`);return r.json();
}
export function* createDeepWaterSteps(data,getTerrainY,mapRing,{VE=5,legacyCanals=null}={}) {
  const group=new THREE.Group();group.name='deep-water';
  const bodies=[],grid=new Map(),cell=512;
  const waterMat=createWaterMaterial('reservoir',{opacity:0.82});
  const submergedWaterMat=createWaterMaterial('reservoir');
  // Opaque floors and banks occlude the non-depth-writing terrain skin, as
  // Thames' interior shell already does. No coarse-grid carve or global
  // terrain shader is needed, so views away from these basins keep the exact
  // existing material/program. All shell faces draw after that skin.
  const earth=new THREE.MeshStandardMaterial({color:0x31413a,roughness:1,emissive:0x18382e,emissiveIntensity:0.06,side:THREE.DoubleSide});earth.name='water-basin-earth';
  const grass=new THREE.MeshStandardMaterial({color:new THREE.Color(0.18,0.35,0.15),roughness:1,side:THREE.DoubleSide});grass.name='reservoir-bank-grass';
  for(const spec of data.bodies) {
    if(spec.mode!=='VOLUME')continue;
    for(const ring of spec.rings) {
      yield;
      if(mapRing&&!clipPolygonToRing(ring,mapRing).length)continue;
      const otherWater=data.bodies.filter(b=>b!==spec).flatMap(b=>b.rings);
      const body=yield* buildWaterBodySteps(spec,ring,getTerrainY,{VE,mapRing,otherWater});
      if(body.topPos.length===0)continue;
      const root=new THREE.Group();root.name=`water-body:${spec.id}`;group.add(root);body.group=root;
      const topGeo=geometryOf(body.topPos),n=topGeo.attributes.position.count;
      topGeo.setAttribute('waterDepth',new THREE.Float32BufferAttribute(new Float32Array(n).fill(spec.depth.renderM),1));
      topGeo.setAttribute('waterEdge',new THREE.Float32BufferAttribute(new Float32Array(n),1));
      const top=new THREE.Mesh(topGeo,waterMat);top.name=`water-top:${spec.id}`;top.renderOrder=RENDER_ORDER.SURFACE_WATER;
      top.userData={type:spec.kind==='dock'?'canal':'reservoir',name:spec.name,area:spec.area.ha,waterBodyId:spec.id};root.add(top);body.topMesh=top;
      const shell=new THREE.Group();shell.name=`water-interior:${spec.id}`;root.add(shell);body.shell=shell;
      const floor=new THREE.Mesh(geometryOf(body.basinPos),earth);floor.name=`water-bed:${spec.id}`;floor.raycast=()=>{};
      shell.add(floor);body.bedMesh=floor;
      if(body.bankPos.length) {
        const bankMesh=new THREE.Mesh(geometryOf(body.bankPos),grass);bankMesh.name=`reservoir-bank:${spec.id}`;root.add(bankMesh);body.bankMesh=bankMesh;
      }
      body.renderBounds=topGeo.boundingBox.clone().union(floor.geometry.boundingBox);
      if(body.bankMesh)body.renderBounds.union(body.bankMesh.geometry.boundingBox);
      // Sea life is attached/precompiled while hidden and updated only in its
      // own submerged body. Nothing animates in a remote reservoir.
      if(spec.seaLife) {yield;body.life=createLakeSeaLife(body,VE);if(body.life)root.add(body.life.group);}
      const index=bodies.push(body)-1,b=body.bounds;
      for(let x=Math.floor(b.minX/cell);x<=Math.floor(b.maxX/cell);x++)for(let z=Math.floor(b.minZ/cell);z<=Math.floor(b.maxZ/cell);z++) {
        const k=`${x},${z}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(index);
      }
    }
  }
  // Old canal centrelines run across several docks. Keep their outside
  // sections byte-identical and cut only actual wet-polygon overlap.
  if(legacyCanals)yield* clipLegacyCanals(legacyCanals,bodies);
  const near=(x,z)=>grid.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)??[];
  function at(x,z) {for(const i of near(x,z)){const b=bodies[i];if(b.containsXZ(x,z))return b;}return null;}
  function groundAt(x,z) {
    const water=at(x,z);if(water)return water.bedAt(x,z);
    let y=null;
    for(const i of near(x,z)) {
      const b=bodies[i];if(x<b.bounds.minX||x>b.bounds.maxX||z<b.bounds.minZ||z>b.bounds.maxZ)continue;
      const h=b.groundAt(x,z);if(h!=null&&(y===null||h>y))y=h;
    }
    return y;
  }
  const activeIds=new Set(data.bodies.filter(b=>b.mode==='VOLUME').flatMap(b=>b.legacyIds??[]));
  function hideLegacy(...groups) {
    for(const g of groups)g?.traverse(o=>{
      if(activeIds.has(o.userData.waterBodyId)||activeIds.has(o.userData.osm))o.visible=false;
    });
  }
  let previous=null,solo='all';
  const viewMatrix=new THREE.Matrix4(),viewFrustum=new THREE.Frustum();
  function update(dt,camera,{submerged=false,belowSurface=false}={}) {
    camera.updateMatrixWorld();
    viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const active=at(camera.position.x,camera.position.z);
    const wet=!!active&&submerged;
    for(const body of bodies) {
      // These landscape meshes never cast shadows. Cull a whole body before
      // the renderer visits its surfaces, using the same paired camera view
      // matrix as Master. Bounds contain the actual clipped bank/basin faces.
      body.group.visible=(solo==='all'||solo===(body.spec.kind==='dock'?'canals':'reservoirs'))&&viewFrustum.intersectsBox(body.renderBounds);
      body.shell.visible=(!belowSurface||wet&&body===active);
      body.topMesh.material=wet&&body===active?submergedWaterMat:waterMat;
      if(body.life) {
        const showing=wet&&body===active;
        body.life.update(dt,camera,{submerged:showing});
        // Three updates matrices even under visible=false. Keep dormant
        // animals out of scene traversal, while retaining their model/API.
        if(showing&&body.life.group.parent!==body.group)body.group.add(body.life.group);
        else if(!showing&&body.life.group.parent)body.life.group.removeFromParent();
      }
    }
    previous=wet?active:null;
    return previous;
  }
  function outwardNormal(p,movement) {
    const b=at(p.x,p.z);if(!b)return null;
    let distance=b.waterY-p.y,normal={x:0,y:1,z:0};
    const bed=b.bedAt(p.x,p.z);
    if(bed!=null&&p.y-bed<distance) {distance=p.y-bed;normal={x:0,y:-1,z:0};}
    for(const ring of b.waterRings)for(let i=0;i<ring.length;i++) {
      const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz)||1;
      const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/(len*len)));
      const d=Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz);
      if(d<distance){distance=d;normal={x:dz/len,y:0,z:-dx/len};if(b.containsXZ(p.x+normal.x*.1,p.z+normal.z*.1)){normal.x*=-1;normal.z*=-1;}}
    }
    if(movement&&normal.x*movement.x+normal.y*movement.y+normal.z*movement.z<0){normal.x*=-1;normal.y*=-1;normal.z*=-1;}
    return normal;
  }
  return {group,bodies,data,at,groundAt,update,hideLegacy,outwardNormal,
    setSolo(value) {solo=value;for(const b of bodies)b.group.visible=value==='all'||value===(b.spec.kind==='dock'?'canals':'reservoirs');},
    surfaceAt:(x,z)=>at(x,z)?.waterY??null,
    contains:(x,y,z)=>at(x,z)?.contains({x,y,z})??false,
    get active(){return previous;}};
}

function* clipLegacyCanals(group,bodies) {
  const cuts=bodies.flatMap(b=>b.waterRings.map(r=>({ring:r,minX:Math.min(...r.map(p=>p[0])),maxX:Math.max(...r.map(p=>p[0])),minZ:Math.min(...r.map(p=>p[1])),maxZ:Math.max(...r.map(p=>p[1]))})));
  for(const mesh of group.children) {
    if(!mesh.isMesh)continue;
    const g=mesh.geometry,pos=g.attributes.position,idx=g.index,attrs=Object.entries(g.attributes),out=Object.fromEntries(attrs.map(([name])=>[name,[]]));let changed=false;
    const count=idx?.count??pos.count;
    for(let k=0;k<count;k+=3) {
      if(k%96===0)yield;
      const ids=[0,1,2].map(j=>idx?idx.getX(k+j):k+j),points=ids.map(i=>[pos.getX(i),pos.getZ(i)]);
      const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
      let pieces=[points],touched=false;
      for(const c of cuts) {
        if(maxX<c.minX||minX>c.maxX||maxZ<c.minZ||minZ>c.maxZ)continue;
        const next=pieces.flatMap(p=>subtractPolygonRing(p,c.ring));
        if(next.length!==pieces.length||JSON.stringify(next)!==JSON.stringify(pieces))touched=true;
        pieces=next;
      }
      if(!touched) {for(const i of ids)for(const [name,a]of attrs)for(let j=0;j<a.itemSize;j++)out[name].push(a.array[i*a.itemSize+j]);continue;}
      changed=true;
      const [a,b,c]=points,det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(det)<1e-8)continue;
      for(const piece of pieces) {
        const ts=THREE.ShapeUtils.triangulateShape(piece.map(p=>new THREE.Vector2(...p)),[]);
        for(const tri of ts) {
          const [p,q,r]=tri.map(i=>piece[i]);if(((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))*det<0)tri.reverse();
          for(const j of tri) {
            const [x,z]=piece[j],u=((x-a[0])*(c[1]-a[1])-(z-a[1])*(c[0]-a[0]))/det,v=((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]))/det;
            for(const [name,attr]of attrs)for(let n=0;n<attr.itemSize;n++) {
              const va=attr.array[ids[0]*attr.itemSize+n],vb=attr.array[ids[1]*attr.itemSize+n],vc=attr.array[ids[2]*attr.itemSize+n];out[name].push(va+u*(vb-va)+v*(vc-va));
            }
          }
        }
      }
    }
    if(changed){const next=new THREE.BufferGeometry();for(const [name,a]of attrs)next.setAttribute(name,new THREE.Float32BufferAttribute(out[name],a.itemSize));next.computeBoundingSphere();g.dispose();mesh.geometry=next;}
  }
}
