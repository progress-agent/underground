import * as THREE from 'three';

// Originals retain collision/hover identities and alias the batch's CPU matrix
// storage. Only the synchronous render traversal sees the replacement list.
export function createPhoneCityBatches({ span = 6000, spanZ = 2000 } = {}) {
  const batches=[],parents=new Map();
  const projection=new THREE.Matrix4(),view=new THREE.Matrix4();
  let queue=null,next=0;
  function parentState(parent){
    if(!parents.has(parent)){const world=new THREE.Matrix4();world.elements.fill(NaN);parents.set(parent,{world,version:0,canonical:null,draw:[],skip:new Set(),frustum:new THREE.Frustum()});}
    return parents.get(parent);
  }
  function unfreeze(entry){
    if(!entry.frozen)return;
    for(const s of entry.states){s.mesh.matrixWorldAutoUpdate=s.worldAuto;if(s.worldAuto)s.mesh.matrixWorldNeedsUpdate=true;}
    entry.frozen=false;entry.worldVersion=-1;
  }
  return {
    prepare(meshes,ready){
      if(!ready)return;
      if(!queue){
        const groups=new Map();
        for(const m of meshes){
          if(!m.count||!m.boundingBox||m.children.length||m.material.userData.reservoirBaseSource)continue;
          const b=m.boundingBox,key=`${Math.floor((b.min.x+b.max.x)/2/span)},${Math.floor((b.min.z+b.max.z)/2/spanZ)}:${m.material.uuid}:${m.geometry.uuid}`;
          if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
        }
        queue=[...groups.values()].filter(g=>g.length>1);
      }
      if(next>=queue.length)return;
      // East-first means an eastward flight usually draws just a prefix. It
      // never removes a tile that the original tile frustum would draw.
      const originals=queue[next++].sort((a,b)=>b.boundingSphere.center.x-a.boundingSphere.center.x);
      const count=originals.reduce((n,m)=>n+m.count,0),batch=new THREE.InstancedMesh(originals[0].geometry,originals[0].material,0);
      // Every matrix is copied from its source. Avoid the constructor's JS
      // loop writing identities that are immediately overwritten.
      batch.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(count*16),16);batch.count=count;
      const array=batch.instanceMatrix.array,bounds=new THREE.Box3(),states=[],ends=new Uint32Array(originals.length);
      let offset=0;
      for(const m of originals){
        const length=m.count*16;array.set(m.instanceMatrix.array.subarray(0,length),offset);m.dispose();
        m.instanceMatrix=new THREE.InstancedBufferAttribute(array.subarray(offset,offset+length),16);
        m.updateMatrixWorld(true);
        states.push({mesh:m,attribute:m.instanceMatrix,count:m.count,version:m.instanceMatrix.version,worldAuto:m.matrixWorldAutoUpdate});
        m.matrixWorldAutoUpdate=false;
        bounds.union(m.boundingBox);offset+=length;ends[states.length-1]=offset/16;
      }
      batch.boundingBox=bounds;batch.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());
      batch.name=`phone-city-batch-${batches.length}`;batch.raycast=()=>{};
      batch.matrixAutoUpdate=false;batch.matrixWorldAutoUpdate=false;batch.visible=false;
      originals[0].parent?.add(batch);
      batches.push({batch,originals,states,worldVersion:-1,retired:false,total:count,frozen:true,ends});
    },
    begin(enabled,camera=null,shadowsActive=false){
      if(!enabled){for(const entry of batches)unfreeze(entry);return;}
      for(const state of parents.values()){state.canonical=null;state.skip.clear();}
      for(const entry of batches){
        const {batch,originals,states}=entry,parent=batch.parent;
        if(entry.retired||!parent)continue;
        const material=originals[0].material;
        let valid=true,visible=true,upload=false;
        for(const s of states){
          const m=s.mesh;
          if(m.geometry!==batch.geometry||m.material!==material||m.children.length||m.count!==s.count||m.instanceMatrix!==s.attribute){valid=false;break;}
          visible&&=m.visible&&m.parent===parent;
          if(s.version!==s.attribute.version){s.version=s.attribute.version;upload=true;}
        }
        if(!valid){unfreeze(entry);batch.dispose();batch.removeFromParent();entry.retired=true;continue;}
        // Late reservoir anchoring writes the aliased arrays through the source
        // attribute, so its version must also invalidate the batch GPU buffer.
        if(upload){
          batch.instanceMatrix.needsUpdate=true;
          batch.boundingBox.makeEmpty();for(const m of originals)batch.boundingBox.union(m.boundingBox);
          batch.boundingBox.getBoundingSphere(batch.boundingSphere);
        }
        if(!visible){unfreeze(entry);continue;}
        if(!entry.frozen){for(const s of states)s.mesh.matrixWorldAutoUpdate=false;entry.frozen=true;}
        const state=parentState(parent);
        if(!state.canonical){
          parent.updateWorldMatrix(true,false);state.canonical=parent.children;
          if(!state.world.equals(parent.matrixWorld)){state.world.copy(parent.matrixWorld);state.version++;}
          if(camera&&!shadowsActive){view.multiplyMatrices(camera.matrixWorldInverse,state.world);projection.multiplyMatrices(camera.projectionMatrix,view);state.frustum.setFromProjectionMatrix(projection);}
        }
        if(entry.worldVersion!==state.version){batch.matrixWorld.copy(state.world);for(const s of states)s.mesh.matrixWorld.copy(state.world);entry.worldVersion=state.version;}
        let drawCount=entry.total;
        if(camera&&!shadowsActive){
          drawCount=0;
          if(state.frustum.intersectsSphere(batch.boundingSphere)){
            for(let i=originals.length-1;i>=0;i--)if(state.frustum.intersectsSphere(originals[i].boundingSphere)){drawCount=entry.ends[i];break;}
          }
        }
        batch.count=drawCount;batch.visible=drawCount>0;batch.material=material;
        batch.castShadow=originals[0].castShadow;batch.receiveShadow=originals[0].receiveShadow;batch.customDepthMaterial=originals[0].customDepthMaterial;
        for(const m of originals)state.skip.add(m);
      }
      for(const [parent,state] of parents){
        if(!state.canonical)continue;
        state.draw.length=0;for(const m of state.canonical)if(!state.skip.has(m))state.draw.push(m);
        parent.children=state.draw;
      }
    },
    end(){
      for(const [parent,state] of parents)if(state.canonical){parent.children=state.canonical;state.canonical=null;}
      for(const {batch} of batches)batch.visible=false;
    },
    stats:()=>({batches:batches.filter(b=>!b.retired).length,remaining:queue?queue.length-next:null}),
  };
}
