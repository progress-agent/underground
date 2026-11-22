import * as THREE from 'three';
import { computeVertexNormalsSteps } from './sliced-geometry.js';

// One upload per material, with spatial chunks as draw ranges into it. Visible
// neighbouring ranges coalesce into a single draw, so culling the orbital does
// not replace six city-wide calls with a hundred tiny calls.
export function* buildMotorwayStaticChunks(batches, materials) {
  const byMaterial = new Map(), meshes = [];
  for (const [key,b] of batches) {
    if (!byMaterial.has(b.mat)) byMaterial.set(b.mat, []);
    const [x,z] = key.split(':')[1].split(',').map(Number);
    byMaterial.get(b.mat).push({ ...b, key, angle: Math.atan2(z+.5,x+.5) });
  }
  for (const [mat, chunks] of byMaterial) {
    chunks.sort((a,b)=>a.angle-b.angle || a.key.localeCompare(b.key));
    const length=chunks.reduce((n,b)=>n+b.positions.length,0);
    const positions=new Float32Array(length), bases=new Float32Array(length/3);
    let offset=0;
    for (const b of chunks) {
      b.start=offset/3;b.count=b.positions.length/3;
      for(let i=0;i<b.positions.length;i++){positions[offset+i]=b.positions[i];if(i%40000===39999)yield;}
      bases.set(b.bases,offset/3);offset+=b.positions.length;yield;
    }
    const full=new THREE.BufferGeometry();
    full.setAttribute('position',new THREE.BufferAttribute(positions,3));
    full.setAttribute('motorwayBase',new THREE.BufferAttribute(bases,1));
    yield* computeVertexNormalsSteps(full);
    const original=new Float32Array(length);
    for(let i=0;i<length;i+=150000){original.set(positions.subarray(i,i+150000),i);yield;}
    for(const b of chunks){
      const g=new THREE.BufferGeometry();
      for(const [key,attribute] of Object.entries(full.attributes))g.setAttribute(key,attribute);
      g.userData.original=original;g.setDrawRange(b.start,b.count);
      const mesh=new THREE.Mesh(g,materials[mat]);
      mesh.name=`m25-${mat}-${b.key.split(':')[1]}`;
      mesh.userData={type:'motorway',name:'M25 / A282 orbital motorway',part:mat,staticChunkKey:b.key.split(':')[1],staticRange:{start:b.start,count:b.count}};
      mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.matrixWorldAutoUpdate=false;
      mesh.frustumCulled=false; // the range controller tests each original chunk
      mesh.raycast=function(raycaster,hits){
        const {start,count}=this.geometry.drawRange,r=this.userData.staticRange;
        this.geometry.setDrawRange(r.start,r.count);
        try{THREE.Mesh.prototype.raycast.call(this,raycaster,hits);}
        finally{this.geometry.setDrawRange(start,count);}
      };
      meshes.push(mesh);yield;
    }
  }
  return meshes;
}

export function* updateMotorwayChunkBoundsSteps(meshes) {
  const p=new THREE.Vector3();
  for(const m of meshes){
    const {start,count}=m.userData.staticRange,a=m.geometry.attributes.position;
    const box=new THREE.Box3();
    for(let i=start;i<start+count;i++){box.expandByPoint(p.fromBufferAttribute(a,i));if(i%10000===9999)yield;}
    m.geometry.boundingBox=box;
    m.geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());yield;
  }
}

export function createMotorwayRangeCull(meshes) {
  const groups=new Map(),cells=new Map(),versions=new Map();
  for(const m of meshes){
    const id=m.geometry.attributes.position,key=m.userData.staticChunkKey??m.uuid;
    if(!groups.has(id))groups.set(id,[]);
    if(!cells.has(key))cells.set(key,{box:new THREE.Box3(),sphere:new THREE.Sphere(),visible:true});
    groups.get(id).push({mesh:m,cell:cells.get(key)});
  }
  const lastWorld=new THREE.Matrix4();lastWorld.elements.fill(NaN);
  const view=new THREE.Matrix4(),projection=new THREE.Matrix4(),frustum=new THREE.Frustum(),point=new THREE.Vector3();
  return (camera,fog,world)=>{
    if(!lastWorld.equals(world)){for(const m of meshes)m.matrixWorld.copy(world);lastWorld.copy(world);}
    // Four material parts usually occupy the same cell: test their conservative
    // union once, rather than repeating the frustum/fog arithmetic for each.
    let changed=versions.size!==groups.size;
    for(const attribute of groups.keys())if(versions.get(attribute)!==attribute.version)changed=true;
    if(changed){
      for(const cell of cells.values())cell.box.makeEmpty();
      for(const [attribute,list] of groups){
        for(const {mesh,cell} of list)cell.box.union(mesh.geometry.boundingBox??new THREE.Box3().setFromBufferAttribute(attribute));
        versions.set(attribute,attribute.version);
      }
      for(const cell of cells.values())cell.box.getBoundingSphere(cell.sphere);
    }
    view.multiplyMatrices(camera.matrixWorldInverse,world);
    projection.multiplyMatrices(camera.projectionMatrix,view);frustum.setFromProjectionMatrix(projection);
    const scale=view.getMaxScaleOnAxis();
    for(const cell of cells.values()){
      const b=cell.sphere,depth=-point.copy(b.center).applyMatrix4(view).z;
      cell.visible=frustum.intersectsSphere(b)&&(!fog||depth-b.radius*scale<fog.far);
    }
    for(const list of groups.values()){
      let lead=null,end=0;
      for(const {mesh:m,cell} of list){
        const r=m.userData.staticRange;m.visible=false;
        if(!cell.visible){lead=null;continue;}
        if(lead&&r.start===end){end=r.start+r.count;lead.geometry.setDrawRange(lead.userData.staticRange.start,end-lead.userData.staticRange.start);}
        else{lead=m;end=r.start+r.count;m.visible=true;m.geometry.setDrawRange(r.start,r.count);}
      }
    }
  };
}

// Phone-only: retain float positions, encode unit normals to signed 16-bit.
// This saves half the normal-buffer memory; each component errs by <=1/32767.
export function* packMotorwayNormalsSteps(meshes) {
  const groups=new Map();
  for(const m of meshes){const id=m.geometry.attributes.position;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(m);}
  for(const list of groups.values()){
    const first=list[0].geometry,source=first.attributes.normal.array;
    const packed=first.userData.packedNormal??new THREE.BufferAttribute(new Int16Array(source.length),3,true);
    for(let i=0;i<source.length;i++){packed.array[i]=Math.round(Math.max(-1,Math.min(1,source[i]))*32767);if(i%40000===39999)yield;}
    packed.needsUpdate=true;
    for(const m of list){m.geometry.setAttribute('normal',packed);m.geometry.userData.packedNormal=packed;}
    yield;
  }
}
