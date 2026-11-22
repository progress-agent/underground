import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {rayBlockedByBoxes,prepareBoxMeshBounds} from '../src/station-buildings.js';

test('box occlusion agrees with Three rays, including parallel axes and origins inside boxes',()=>{
  let seed=4903;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const meshes=Array.from({length:12},(_,j)=>{
    const array=new Float32Array(137*16);
    for(let i=0;i<137;i++){
      const o=i*16;array[o]=1+random()*20;array[o+5]=1+random()*35;array[o+10]=array[o];
      array[o+12]=random()*200-100;array[o+13]=random()*50-25;array[o+14]=random()*200-100;
    }
    return {count:137,visible:j!==3,instanceMatrix:{array}};
  });
  const box=new THREE.Box3(),ray=new THREE.Ray(),hit=new THREE.Vector3();
  for(let i=0;i<4000;i++){
    ray.origin.set(random()*240-120,random()*80-30,random()*240-120);
    ray.direction.set(random()-.5,random()-.5,random()-.5);
    if(i%4===0)ray.direction.x=0;if(i%5===0)ray.direction.y=0;if(i%7===0)ray.direction.z=0;
    if(!ray.direction.lengthSq())ray.direction.z=1;ray.direction.normalize();
    const scale=[0,.1,1,2][i%4],distance=random()*400,end=distance-.75;
    let expected=false;
    if(end>0)for(const mesh of meshes)if(mesh.visible)for(let o=0;o<mesh.count*16;o+=16){
      const a=mesh.instanceMatrix.array;
      box.min.set(a[o+12]-a[o]/2,a[o+13],a[o+14]-a[o+10]/2);
      box.max.set(a[o+12]+a[o]/2,a[o+13]+a[o+5]*scale,a[o+14]+a[o+10]/2);
      if(box.containsPoint(ray.origin)||(ray.intersectBox(box,hit)&&hit.distanceTo(ray.origin)<=end))expected=true;
    }
    if(i===2000)for(const mesh of meshes)prepareBoxMeshBounds(mesh);
    assert.equal(rayBlockedByBoxes(meshes,...ray.origin.toArray(),...ray.direction.toArray(),distance,scale),expected,`ray ${i}`);
  }
});

test('twenty screen rays agree with Three mesh hits on five rotated buildings',()=>{
  const geo=new THREE.BoxGeometry(1,1,1);geo.translate(0,.5,0);
  const mesh=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial(),5),m=new THREE.Matrix4();
  for(let i=0;i<5;i++){
    m.compose(new THREE.Vector3((i-2)*27,0,0),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-(.17+i*.27)),new THREE.Vector3(19,23+i*3,11));
    mesh.setMatrixAt(i,m);
  }
  mesh.computeBoundingSphere();mesh.computeBoundingBox();mesh.updateMatrixWorld(true);prepareBoxMeshBounds(mesh);
  const camera=new THREE.PerspectiveCamera(55,1.6,.1,1000);camera.position.set(0,65,130);camera.lookAt(0,12,0);camera.updateMatrixWorld(true);
  const caster=new THREE.Raycaster(),target=new THREE.Vector3(),screen=new THREE.Vector3();let hits=0;
  for(let i=0;i<5;i++)for(const [dx,dy]of [[0,10],[-5,15],[5,20],[0,45]]){
    target.set((i-2)*27+dx,dy,0);screen.copy(target).project(camera);caster.setFromCamera(new THREE.Vector2(screen.x,screen.y),camera);
    const distance=300,expected=caster.intersectObject(mesh,false).some(h=>h.distance<=distance-.75);if(expected)hits++;
    assert.equal(rayBlockedByBoxes([mesh],...caster.ray.origin.toArray(),...caster.ray.direction.toArray(),distance,1),expected,`screen ray ${i}, ${dx}, ${dy}`);
  }
  assert.ok(hits>=10,'the screen sample includes actual building pixels');
});

test('ray bounds follow a matrix upload after a reservoir changes the base',()=>{
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshBasicMaterial(),1),m=new THREE.Matrix4();
 m.compose(new THREE.Vector3(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.67),new THREE.Vector3(8,20,4));mesh.setMatrixAt(0,m);
 const before=prepareBoxMeshBounds(mesh);
 assert.equal(rayBlockedByBoxes([mesh],0,110,20,0,0,-1,50),false);
 m.setPosition(0,100,0);mesh.setMatrixAt(0,m);mesh.instanceMatrix.needsUpdate=true;
 const after=prepareBoxMeshBounds(mesh);assert.notEqual(after,before);assert.equal(after.y0,100);
 assert.equal(rayBlockedByBoxes([mesh],0,110,20,0,0,-1,50),true);
});

test('rotated chunk bounds equal independent Three-transformed corner extrema',()=>{
 const array=new Float32Array(5*16),points=[];
 for(let i=0;i<5;i++){
  const m=new THREE.Matrix4().compose(new THREE.Vector3(i*30,0,i*7),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-(.17+i*.27)),new THREE.Vector3(7,20,19));m.toArray(array,i*16);
  const actual=new THREE.Matrix4().fromArray(array,i*16);
  for(const x of [-.5,.5])for(const z of [-.5,.5])points.push(new THREE.Vector3(x,0,z).applyMatrix4(actual));
 }
 const b=prepareBoxMeshBounds({count:5,instanceMatrix:{array}});
 for(const [key,axis,fn]of [['x0','x',Math.min],['x1','x',Math.max],['z0','z',Math.min],['z1','z',Math.max]]){
  const expected=fn(...points.map(p=>p[axis]));assert.ok(Math.abs(b[key]-expected)<1e-9,key);assert.ok(Math.abs(b.chunks[0][key]-expected)<1e-9,'chunk '+key);
 }
});
