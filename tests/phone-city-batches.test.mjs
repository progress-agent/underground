import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhoneCityBatches } from '../src/phone-city-batches.js';

function fixture() {
 const group=new THREE.Group(), geometry=new THREE.BoxGeometry(1,1,1), material=new THREE.MeshStandardMaterial();
 const tiles=[0,1000,12000].map(x=>{
  const m=new THREE.InstancedMesh(geometry,material,2);
  for(let i=0;i<2;i++)m.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(x+i*20,20,i*15),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.3+i),new THREE.Vector3(12,30,9)));
  m.computeBoundingBox();m.computeBoundingSphere();m.matrixAutoUpdate=false;group.add(m);return m;
 });return {group,tiles};
}
test('phone batches retain every authored rotated matrix, alias storage and restore visibility',()=>{
 const {group,tiles}=fixture(), before=tiles.map(m=>m.instanceMatrix.array.slice());
 const b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.find(m=>m.name.startsWith('phone-city-batch'));
 assert.equal(batch.count,4);assert.equal(tiles[0].instanceMatrix.array.buffer,batch.instanceMatrix.array.buffer);
 assert.equal(tiles[1].instanceMatrix.array.buffer,batch.instanceMatrix.array.buffer);
 for(let i=0;i<tiles.length;i++)assert.deepEqual(tiles[i].instanceMatrix.array,before[i]);
 assert.deepEqual(batch.instanceMatrix.array,Float32Array.from([...before[1],...before[0]]));
 b.begin(true);assert.equal(batch.visible,true);assert.equal(tiles[0].visible,true);assert.equal(group.children.includes(tiles[0]),false);assert.equal(tiles[2].visible,true);
 b.end();assert.equal(batch.visible,false);assert.ok(tiles.every(m=>m.visible));
 b.begin(false);assert.equal(batch.visible,false);
});
test('hidden tiles and switched building paths cannot appear through a batch',()=>{
 const {group,tiles}=fixture(),b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.at(-1);tiles[0].visible=false;group.matrixAutoUpdate=false;group.matrix.makeTranslation(0,50,0);group.matrixWorldNeedsUpdate=true;group.updateMatrixWorld(true);b.begin(true);assert.equal(batch.visible,false);
 assert.equal(tiles[1].matrixWorldAutoUpdate,true,'authored fallback must retain native world propagation');
 group.updateMatrixWorld();assert.equal(tiles[1].matrixWorld.elements[13],50);b.end();
 b.begin(false);assert.ok(tiles.every(m=>m.matrixWorldAutoUpdate));b.end();
 assert.equal(tiles[0].visible,false);tiles[0].visible=true;tiles[1].removeFromParent();b.begin(true);assert.equal(batch.visible,false);b.end();
});
test('late matrix changes propagate from original tiles to the shared GPU batch and bounds',()=>{
 const {group,tiles}=fixture(),b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.find(m=>m.name.startsWith('phone-city-batch'));
 const before=batch.instanceMatrix.version,radius=batch.boundingSphere.radius;
 tiles[0].instanceMatrix.array[13]+=100;tiles[0].instanceMatrix.needsUpdate=true;
 tiles[0].computeBoundingBox();tiles[0].boundingBox.getBoundingSphere(tiles[0].boundingSphere);
 b.begin(true);assert.ok(batch.instanceMatrix.version>before,'an anchored source matrix must upload through the batch attribute');
 assert.ok(batch.boundingBox.containsBox(tiles[0].boundingBox),'the batch bound must include an updated reservoir base');
 assert.ok(batch.boundingSphere.radius>radius,'the renderer culling sphere must also expand');b.end();
});
test('a late reservoir geometry/material replacement falls back to the authored tiles',()=>{
 const {group,tiles}=fixture(),b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.find(m=>m.name.startsWith('phone-city-batch'));
 tiles[0].geometry=tiles[0].geometry.clone();tiles[0].material=tiles[0].material.clone();
 b.begin(true);assert.equal(batch.visible,false);assert.ok(tiles.every(m=>m.visible&&m.matrixWorldAutoUpdate));b.end();
});
test('batch prefixes retain all camera-visible tiles and keep every shadow caster',()=>{
 const {group,tiles}=fixture(),b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.find(m=>m.name.startsWith('phone-city-batch'));
 const camera=new THREE.PerspectiveCamera(55,1,1,50000);camera.position.set(500,20,0);camera.lookAt(1500,20,0);camera.updateMatrixWorld(true);
 const originalChildren=group.children;
 b.begin(true,camera,false);assert.equal(batch.count,2);assert.equal(batch.visible,true);assert.equal(group.children.includes(tiles[0]),false);b.end();
 assert.equal(group.children,originalChildren);assert.ok(tiles.every(m=>m.visible));
 b.begin(true,camera,true);assert.equal(batch.count,4,'shadow casters outside the colour frustum are retained');b.end();
});

test('reverse prefix search matches the original visible-tile prefix across camera poses',()=>{
 const {group,tiles}=fixture(),b=createPhoneCityBatches();b.prepare(tiles,true);
 const batch=group.children.find(m=>m.name.startsWith('phone-city-batch')),originals=[tiles[1],tiles[0]];
 const frustum=new THREE.Frustum(),projection=new THREE.Matrix4();let seed=26;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let sample=0;sample<250;sample++){
  const camera=new THREE.PerspectiveCamera(20+random()*70,.5+random(),1,300+random()*10000);
  camera.position.set(random()*6000-2500,random()*2000-500,random()*6000-3000);camera.lookAt(500,20,8);camera.updateMatrixWorld(true);
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  let expected=0,end=0;for(const m of originals){end+=m.count;if(frustum.intersectsSphere(m.boundingSphere))expected=end;}
  if(!frustum.intersectsSphere(batch.boundingSphere))expected=0;
  b.begin(true,camera,false);const actual=batch.visible&&frustum.intersectsSphere(batch.boundingSphere)?batch.count:0;
  assert.equal(actual,expected,'pose '+sample);b.end();
 }
});
