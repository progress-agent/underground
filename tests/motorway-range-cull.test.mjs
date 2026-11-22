import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMotorwayRangeCull } from '../src/motorway-static-batches.js';
test('adjacent visible chunks coalesce without drawing invisible gaps or losing a chunk',()=>{
 const a=new THREE.Float32BufferAttribute(new Float32Array(180),3);
 const tiles=[-200,10,20,-200,40].map((x,i)=>{
  const g=new THREE.BufferGeometry();g.setAttribute('position',a);g.boundingSphere=new THREE.Sphere(new THREE.Vector3(x,0,-50),1);g.boundingBox=new THREE.Box3(new THREE.Vector3(x-1,-1,-51),new THREE.Vector3(x+1,1,-49));g.setDrawRange(i*6,6);
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial());m.userData.staticRange={start:i*6,count:6};return m;
 });
 const camera=new THREE.PerspectiveCamera(90,2,1,1000);camera.updateMatrixWorld(true);
 createMotorwayRangeCull(tiles)(camera,null,new THREE.Matrix4());
 assert.deepEqual(tiles.filter(m=>m.visible).map(m=>[m.geometry.drawRange.start,m.geometry.drawRange.count]),[[6,12],[24,6]]);
 createMotorwayRangeCull(tiles)(camera,new THREE.Fog(0,1,40),new THREE.Matrix4());
 assert.equal(tiles.filter(m=>m.visible).length,0);
});
