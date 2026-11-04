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
