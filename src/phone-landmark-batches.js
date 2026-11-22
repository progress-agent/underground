import * as THREE from 'three';
import { patchBuildingHeight } from './surface-geometry.js';

// The profile's 95 landmark calls include dozens of plain neighbouring
// footprints. Batch those, retaining all authored models and all pick objects.
// Geometry is built once in budgeted slices, in canonical VE5 coordinates with
// a base for each vertex, so changing Master still keeps every true height.
export function createPhoneLandmarkBatches({ VE = 5 } = {}) {
  const batches=[],hidden=[];
  let work=null,done=false;
  function* build(root, ratio) {
    root.updateWorldMatrix(true,true);
    const groups=new Map();
    root.traverse(m=>{
      if(!m.isMesh||m.name!=='landmark-context'||m.parent?.name!=='landmark-neighbour'||m.geometry.index)return;
      const anchor=m.parent,key=`${Math.floor(anchor.position.x/6000)},${Math.floor(anchor.position.z/6000)}:${m.material.uuid}`;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
    });
    const point=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
    for(const originals of groups.values()){
      if(originals.length<2)continue;
      const n=originals.reduce((n,m)=>n+m.geometry.attributes.position.count,0);
      const p=new Float32Array(n*3),normals=new Float32Array(n*3),bases=new Float32Array(n),box=new THREE.Box3();
      let at=0;
      for(const m of originals){
        const anchor=m.parent,base=anchor.position.y,position=m.geometry.attributes.position,sourceNormal=m.geometry.attributes.normal;
        anchor.updateWorldMatrix(true,true);
        const matrix=m.matrixWorld.clone(),currentRatio=anchor.scale.y/VE;
        normalMatrix.getNormalMatrix(matrix);
        for(let i=0;i<position.count;i++,at++){
          point.fromBufferAttribute(position,i).applyMatrix4(matrix);
          point.y=base+(point.y-base)/currentRatio;
          p.set(point.toArray(),at*3);bases[at]=base;box.expandByPoint(point);
          normal.fromBufferAttribute(sourceNormal,i).applyNormalMatrix(normalMatrix);normals.set(normal.toArray(),at*3);
          if(i%256===255)yield;
        }
        yield;
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('aBaseY',new THREE.BufferAttribute(bases,1));
      geometry.boundingBox=box;geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
      const material=originals[0].material.clone();material.onBeforeCompile=originals[0].material.onBeforeCompile;
      patchBuildingHeight(material,{key:'phone-landmark-context'});
      const batch=new THREE.Mesh(geometry,material);batch.name='phone-landmark-context-batch';batch.visible=false;batch.raycast=()=>{};batch.matrixAutoUpdate=false;
      batch.customDepthMaterial=patchBuildingHeight(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),{key:'phone-landmark-context-depth'});
      root.add(batch);batches.push({batch,originals});
      // Ray and hover keep the small authored CPU geometries. Release only
      // their GPU copies; the replacement is the same set of triangles.
      for(const m of originals)m.geometry.dispose();
      yield;
    }
  }
  return {
    prepare(root,ready,ratio) {
      if(!root||!ready||done)return;
      work??=build(root,ratio);
      const start=performance.now();
      do{const step=work.next();if(step.done){done=true;break;}}while(performance.now()-start<3);
    },
    begin(enabled){
      if(!enabled)return;
      for(const {batch,originals} of batches){
        const visible=m=>{let o=m;for(;o&&o!==batch.parent;o=o.parent)if(!o.visible)return false;return o===batch.parent;};
        if(!originals.every(visible))continue;
        batch.visible=true;batch.castShadow=originals[0].castShadow;batch.receiveShadow=originals[0].receiveShadow;
        for(const m of originals){m.visible=false;hidden.push(m);}
      }
    },
    end(){for(const m of hidden)m.visible=true;hidden.length=0;for(const {batch} of batches)batch.visible=false;},
    stats:()=>({batches:batches.length,done}),
  };
}
