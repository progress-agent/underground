import { RESERVOIR_FEET, inReservoirFootRegion } from './reservoir-feet.js';
import * as THREE from 'three';
import { getTerrainMeshSurfaceY } from './terrain.js';

const fittedMaterials=new WeakMap();
let foundationWallMaterial=null;
function drySupport(x,z,terrainAt,base,bodies=activeWater.bodies){
  const terrain=terrainAt({x,z});let support=Number.isFinite(terrain)?terrain:base;
  for(const b of bodies){const y=b.bankAt?.(x,z);if(y!=null)support=Math.max(support,y);}
  return support;
}

// The four box corners locate the main walls. Where a concave bank leaves air
// beneath a straight wall edge, a short foundation face continues that wall to
// the actual ground. These faces are landscape support, with no windows or
// height multiplier, and share one ordinary city-colour material.
function fitFoundationWalls(mesh,corrections,terrainAt){
  const previous=mesh.children.find(o=>o.userData.reservoirFoundationWall);
  if(previous){previous.geometry.dispose();previous.removeFromParent();}
  const a=mesh.instanceMatrix.array,p=[],corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  let min=mesh.boundingBox.min.y;
  for(const {i,offsets}of corrections){
    const j=i*16,x=a[j+12],z=a[j+14],base=a[j+13],h=a[j+5],side=a[j];
    if(Math.max(...offsets.map(v=>Math.abs(v*h)))<=.25)continue;
    const nearby=activeWater.bodies.filter(b=>!b.bounds||x+side/2>=b.bounds.minX&&x-side/2<=b.bounds.maxX&&z+side/2>=b.bounds.minZ&&z-side/2<=b.bounds.maxZ);
    const point=(edge,t)=>{
      const v=corners[edge],w=corners[(edge+1)%4],lx=v[0]+(w[0]-v[0])*t,lz=v[1]+(w[1]-v[1])*t,tx=lx+.5,tz=lz+.5;
      const top=base+((offsets[0]*(1-tx)+offsets[1]*tx)*(1-tz)+(offsets[2]*(1-tx)+offsets[3]*tx)*tz)*h;
      const px=x+lx*side,pz=z+lz*side,support=drySupport(px,pz,terrainAt,base,nearby);
      return{top:[px,top,pz],bottom:[px,Math.min(top,support-.02),pz],gap:top-support};
    };
    for(let edge=0;edge<4;edge++){
      const n=Math.max(1,Math.ceil(side/.25));let left=point(edge,0);
      for(let k=1;k<=n;k++){
        const right=point(edge,k/n);
        if(Math.max(left.gap,right.gap)>.01){
          p.push(...left.top,...right.top,...left.bottom,...right.top,...right.bottom,...left.bottom);
          min=Math.min(min,left.bottom[1],right.bottom[1]);
        }
        left=right;
      }
    }
  }
  if(!p.length)return;
  if(!foundationWallMaterial){
    const source=mesh.material.userData.reservoirBaseSource??mesh.material;
    foundationWallMaterial=new THREE.MeshStandardMaterial({color:source.color,roughness:source.roughness??.85,metalness:source.metalness??.1});
    foundationWallMaterial.name='reservoir-foundation-walls';
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const walls=new THREE.Mesh(geometry,foundationWallMaterial);walls.name='reservoir-building-foundations';walls.userData.reservoirFoundationWall=true;walls.castShadow=true;walls.receiveShadow=true;
  mesh.add(walls);mesh.userData.reservoirFoundationVertices=p.length/3;
  mesh.boundingBox.min.y=min;mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
}
export function reservoirBaseMaterial(material) {
  if(fittedMaterials.has(material))return fittedMaterials.get(material);
  const fitted=material.clone(),previous=material.onBeforeCompile,key=material.customProgramCacheKey;
  fitted.userData.reservoirBaseSource=material;
  fitted.onBeforeCompile=function(shader,renderer){
    previous.call(material,shader,renderer);
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute vec4 reservoirBase;')
      .replace('transformed.y *= uHeightScale;',`transformed.y *= uHeightScale;
      // Keep the roof horizontal. Only the foundation corners follow the bank;
      // the correction is landscape, so it must not receive the structure ratio.
      vec2 rbCorner = step(vec2(0.0), position.xz);
      float rbY = mix(mix(reservoirBase.x,reservoirBase.y,rbCorner.x),
                      mix(reservoirBase.z,reservoirBase.w,rbCorner.x),rbCorner.y);
      transformed.y += rbY * (1.0-step(0.5,position.y));`);
  };
  fitted.customProgramCacheKey=()=>key.call(material)+'|reservoir-foundations-v1';
  fittedMaterials.set(material,fitted);return fitted;
}

/** The base matrix remains the centre datum used by navigation. The four actual
 * wall feet meet terrain/bank triangles instead of hovering at that one datum.
 * Allocate the optional attribute only on tiles that contain a corrected box. */
export function fitReservoirBuildingFootprints(mesh,terrainAt=getTerrainMeshSurfaceY) {
  if(!banks.length||!mesh?.isInstancedMesh)return;
  const box=mesh.boundingBox;
  if(box&&!banks.some(b=>box.max.x>=b.bounds.minX-100&&box.min.x<=b.bounds.maxX+100&&box.max.z>=b.bounds.minZ-100&&box.min.z<=b.bounds.maxZ+100))return;
  const a=mesh.instanceMatrix.array,corrections=[];
  for(let i=0;i<mesh.count;i++){
    const j=i*16,x=a[j+12],z=a[j+14],base=a[j+13],h=a[j+5];
    if(!h||!inReservoirFootRegion(x,z))continue;
    if(!banks.some(b=>x>=b.bounds.minX-100&&x<=b.bounds.maxX+100&&z>=b.bounds.minZ-100&&z<=b.bounds.maxZ+100))continue;
    const offsets=[];
    for(const sz of [-1,1])for(const sx of [-1,1]){
      const px=x+sx*a[j]/2,pz=z+sz*a[j+10]/2;
      // Only dry bank triangles support these walls. groundAt also returns
      // underwater beds, which can be higher than terrain at an overlapping
      // basin boundary and are not the visible dry support.
      const support=drySupport(px,pz,terrainAt,base);
      offsets.push((support-base)/h);
    }
    if(offsets.some(v=>Math.abs(v*h)>.01))corrections.push({i,offsets});
  }
  if(!corrections.length)return;
  if(!mesh.geometry.attributes.reservoirBase){
    mesh.geometry=mesh.geometry.clone();
    mesh.geometry.setAttribute('reservoirBase',new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count*4),4));
  }
  const attribute=mesh.geometry.attributes.reservoirBase;
  for(const {i,offsets}of corrections)attribute.array.set(offsets,i*4);
  attribute.needsUpdate=true;
  mesh.material=reservoirBaseMaterial(mesh.material.userData.reservoirBaseSource??mesh.material);
  mesh.userData.reservoirFootprints=corrections.length;
  // InstancedMesh's automatic bounds cannot see vertex shader foundation offsets.
  mesh.computeBoundingBox();
  for(const {i}of corrections){const j=i*16;for(let k=0;k<4;k++)mesh.boundingBox.min.y=Math.min(mesh.boundingBox.min.y,a[j+13]+attribute.array[i*4+k]*a[j+5]);}
  mesh.boundingSphere??=new THREE.Sphere();mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
  fitFoundationWalls(mesh,corrections,terrainAt);
}

let banks=[],activeWater=null;
/** Generic map boxes on a dry bank stand on the same triangles as the walker.
 * The terrain below the bank is deliberately lower than its grass surface. */
export function reservoirBuildingBase(x,z,base) {
  if(!banks.length||!Number.isFinite(base)||!inReservoirFootRegion(x,z))return base;
  for(const b of banks) {
    if(x<b.bounds.minX-100||x>b.bounds.maxX+100||z<b.bounds.minZ-100||z>b.bounds.maxZ+100)continue;
    // Compartments can share a dry divider. Use the highest actual support
    // from the same shared query as navigation, including its neighbour.
    const bank=activeWater.groundAt(x,z);
    if(bank!=null)base=Math.max(base,bank);
  }
  return base;
}

/** Roads around the repaired feet must clear all neighbouring dry bank meshes,
 * including compartments whose own terrain was not lowered in this sprint. */
export function reservoirRoadBase(x,z,base){
  if(!activeWater||!Number.isFinite(base)||!inReservoirFootRegion(x,z))return base;
  return drySupport(x,z,()=>base,base);
}

/** Banks arrive after the baked city. Re-anchor existing boxes once; both
 * building decoders also call the same base function for later arrivals. */
export function anchorReservoirBuildings(water,group,retained=[],invalidate=()=>{},terrainAt=getTerrainMeshSurfaceY) {
  activeWater=water;
  const ids=new Set(RESERVOIR_FEET.map(b=>b.id));
  banks=water.bodies.filter(b=>ids.has(b.spec.id));
  const changed=[];
  const visit=mesh=>{
    if(!mesh.isInstancedMesh||!/^(baked-)?buildings-/.test(mesh.name))return;
    const box=mesh.boundingBox;
    if(box&&!banks.some(b=>box.max.x>=b.bounds.minX-100&&box.min.x<=b.bounds.maxX+100&&box.max.z>=b.bounds.minZ-100&&box.min.z<=b.bounds.maxZ+100))return;
    const a=mesh.instanceMatrix.array;let touched=false;
    for(let i=0;i<mesh.count;i++) {
      const j=i*16,x=a[j+12],z=a[j+14],before=a[j+13],after=reservoirBuildingBase(x,z,before);
      if(after-before>.01) {a[j+13]=after;touched=true;changed.push({x,z,before,after});}
    }
    if(touched){
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();
      // Retain the decoder's box-derived culling sphere after moving bases.
      if(!mesh.boundingSphere)mesh.computeBoundingSphere();
      mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);invalidate(mesh);
    }
    fitReservoirBuildingFootprints(mesh,terrainAt);
  };
  group?.traverse(visit);
  // An early switch to live detaches, but retains, the baked city. It must
  // already have correct bases when the user switches back later.
  for(const mesh of retained)if(!mesh.parent)visit(mesh);
  return changed;
}
