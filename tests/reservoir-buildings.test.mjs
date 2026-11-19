import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from 'three';
import {anchorReservoirBuildings,reservoirBuildingBase} from '../src/reservoir-buildings.js';
import {createCollisionService} from '../src/modes/collision.js';
test('bank arrival corrects attached and retained city instances; later arrivals share the same ground and off-site bases stay exact',()=>{
 const x=-18233,z=12118;
 const mesh=(parent,sphere)=>{const m=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshBasicMaterial(),1),a=m.instanceMatrix.array;a[0]=a[10]=4;a[5]=50;a[15]=1;a[12]=x;a[13]=50;a[14]=z;m.parent=parent;m.name='baked-buildings-fixture';m.computeBoundingBox();if(sphere)m.computeBoundingSphere();return m;};
 const group={traverse(fn){fn(attached)}};const attached=mesh(group,true),retained=mesh(null,false);
 const water={groundAt:()=>95,bodies:[{spec:{id:'way/147638019'},bounds:{minX:x-5,maxX:x+5,minZ:z-5,maxZ:z+5},bankAt:()=>94}]};
 const collision=createCollisionService({getBuildingMeshes:()=>[attached,retained]});collision.sync();
 assert.ok(collision.buildingsNear(x,z,1).every(b=>b.baseY===50),'prime the old collision grids');
 const changed=anchorReservoirBuildings(water,group,[attached,retained],m=>collision.invalidateBuilding(m));
 assert.equal(changed.length,2);for(const m of [attached,retained]){
  assert.equal(m.instanceMatrix.array[13],95);assert.ok(m.instanceMatrix.version>0);
  assert.equal(m.boundingBox.min.y,95);assert.equal(m.boundingBox.max.y,145);
  for(const p of [m.boundingBox.min,m.boundingBox.max])assert.ok(p.distanceTo(m.boundingSphere.center)<=m.boundingSphere.radius+1e-8);
 }
 assert.equal(reservoirBuildingBase(x,z,50),95,'a future tile gets the same base, including a higher neighbouring divider');
 assert.equal(reservoirBuildingBase(x,z,110),110,'a higher existing support is retained');
 assert.equal(reservoirBuildingBase(0,0,12.345),12.345,'off-site city unchanged');
 assert.ok(collision.buildingsNear(x,z,1).every(b=>b.baseY===95),'indexed collisions immediately follow the moved instances');
 anchorReservoirBuildings({bodies:[]},null);assert.equal(reservoirBuildingBase(x,z,50),50,'new scene resets bank references');
 for(const m of [attached,retained]){m.geometry.dispose();m.material.dispose();}
});
