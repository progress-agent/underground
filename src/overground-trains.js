import * as THREE from 'three';

// Schematic services, not live arrival predictions. Instancing keeps an entire
// line's fleet to three draws, with no per-instance colours (M5 constraint).
const CAR_LENGTH=19, CAR_STEP=20.5, CAR_WIDTH=3.6, CAR_HEIGHT=3.5;
const SPEED=13, SPACING=2400, VISIBLE_DISTANCE=12000;
const bodyGeometry=new THREE.BoxGeometry(CAR_WIDTH,CAR_HEIGHT,CAR_LENGTH);
const roofGeometry=new THREE.BoxGeometry(CAR_WIDTH+.15,.28,CAR_LENGTH-.5);
const windowGeometry=new THREE.BoxGeometry(CAR_WIDTH+.07,1.1,CAR_LENGTH*.82);
const dummy=new THREE.Object3D(),forward=new THREE.Vector3(0,0,1);
const direction=new THREE.Vector3();

function sample(path,cum,s,out){
 let lo=0,hi=cum.length-1;
 while(lo<hi-1){const mid=(lo+hi)>>1;if(cum[mid]<=s)lo=mid;else hi=mid;}
 const a=path[lo],b=path[hi],t=THREE.MathUtils.clamp((s-cum[lo])/(cum[hi]-cum[lo]||1),0,1);
 out.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
 direction.set(b.x-a.x,b.y-a.y,b.z-a.z).normalize();
}

export function createOvergroundFleet(paths,colour,lineId){
 const group=new THREE.Group();group.name=`overground-trains-${lineId}`;
 const trains=[];let instances=0;
 paths.forEach((path,pathIndex)=>{
  const cum=[0];for(let i=1;i<path.length;i++)cum.push(cum.at(-1)+Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z));
  const total=cum.at(-1);if(total<130)return;
  const cars=Math.min(5,Math.floor((total-20)/CAR_STEP)),margin=cars*CAR_STEP/2+4,run=total-2*margin;
  const count=Math.max(2,Math.ceil(total/SPACING));
  for(let i=0;i<count;i++){
   trains.push({path,pathIndex,cum,total,cars,margin,run,phase:(i+.31)/count*2*run,first:instances,position:new THREE.Vector3(),visible:false});
   instances+=cars;
  }
 });
 const materials=[
  new THREE.MeshStandardMaterial({color:0xe2e3de,roughness:.65,metalness:.15}),
  new THREE.MeshStandardMaterial({color:new THREE.Color(colour),roughness:.6,metalness:.2}),
  new THREE.MeshBasicMaterial({color:0x24384b,toneMapped:false}),
 ];
 const meshes=[bodyGeometry,roofGeometry,windowGeometry].map((geometry,i)=>{
  const mesh=new THREE.InstancedMesh(geometry,materials[i],instances);
  mesh.name=['overground-train-bodies','overground-train-roofs','overground-train-windows'][i];
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;group.add(mesh);return mesh;
 });
 const point=new THREE.Vector3(),localUp=new THREE.Vector3();
 function update(dt,camera,heightMultiplier){
  for(const train of trains){
   train.phase=(train.phase+Math.max(0,dt)*SPEED)%(2*train.run);
   const dir=train.phase<train.run?1:-1;
   const s=train.margin+(dir===1?train.phase:2*train.run-train.phase);
   sample(train.path,train.cum,s,train.position);
   train.visible=!camera||Math.hypot(camera.position.x-train.position.x,camera.position.z-train.position.z)<VISIBLE_DISTANCE;
   for(let c=0;c<train.cars;c++){
    const index=train.first+c;
    if(!train.visible){dummy.position.set(0,0,0);dummy.scale.set(0,0,0);dummy.updateMatrix();for(const mesh of meshes)mesh.setMatrixAt(index,dummy.matrix);continue;}
    sample(train.path,train.cum,s+(c-(train.cars-1)/2)*CAR_STEP*dir,point);
    direction.multiplyScalar(dir);
    // Two directions use opposite sides of the combined rail corridor.
    const horizontal=Math.hypot(direction.x,direction.z)||1;
    point.x+=direction.z/horizontal*2.6;point.z-=direction.x/horizontal*2.6;
    dummy.quaternion.setFromUnitVectors(forward,direction);
    dummy.scale.set(1,heightMultiplier,1);
    localUp.set(0,1,0).applyQuaternion(dummy.quaternion);
    dummy.position.copy(point).addScaledVector(localUp,(CAR_HEIGHT/2+.2)*heightMultiplier);
    dummy.updateMatrix();meshes[0].setMatrixAt(index,dummy.matrix);
    dummy.position.addScaledVector(localUp,CAR_HEIGHT/2*heightMultiplier);dummy.updateMatrix();meshes[1].setMatrixAt(index,dummy.matrix);
    dummy.position.addScaledVector(localUp,-CAR_HEIGHT*.35*heightMultiplier);dummy.updateMatrix();meshes[2].setMatrixAt(index,dummy.matrix);
   }
  }
  for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;
 }
 group.userData={trains,meshes,update,schematic:true};
 return group;
}
