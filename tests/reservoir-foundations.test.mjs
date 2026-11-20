import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {anchorReservoirBuildings,reservoirBaseMaterial,reservoirRoadBase} from '../src/reservoir-buildings.js';
import {disposeTileGeometry} from '../src/surface-geometry.js';
test('bank foundations fit four independent corner heights, with a horizontal roof and matching depth shader',()=>{
  const x=-18233,z=12118;
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshStandardMaterial(),1);
  mesh.name='baked-buildings-foundation-fixture';
  const a=mesh.instanceMatrix.array;a[0]=a[10]=4;a[5]=50;a[15]=1;a[12]=x;a[13]=50;a[14]=z;
  mesh.computeBoundingBox();const group=new THREE.Group();group.add(mesh);
  const groundAt=(px,pz)=>95+(px-x)*2+(pz-z)*3+(px-x)*(pz-z)*.25;
  const water={groundAt,bodies:[{spec:{id:'way/147638019'},bankAt:groundAt,bounds:{minX:x-5,maxX:x+5,minZ:z-5,maxZ:z+5}}]};
  try{
    anchorReservoirBuildings(water,group,[],()=>{},()=>0);
    assert.equal(a[13],95);
    const offsets=mesh.geometry.attributes.reservoirBase.array;
    let i=0;
    for(const sz of [-1,1])for(const sx of [-1,1]){
      assert.ok(Math.abs(a[13]+offsets[i++]*a[5]-groundAt(x+sx*2,z+sz*2))<.00001);
    }
    const base=new THREE.MeshDepthMaterial();
    base.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y *= uHeightScale;');};
    base.customProgramCacheKey=()=> 'test-depth';
    const depth=reservoirBaseMaterial(base),shader={vertexShader:'#include <common>\n#include <begin_vertex>',uniforms:{}};
    depth.onBeforeCompile(shader);
    assert.match(shader.vertexShader,/attribute vec4 reservoirBase/);
    assert.match(shader.vertexShader,/1.0-step\(0.5,position.y\)/,'only foundation vertices move');
    assert.equal(reservoirBaseMaterial(base),depth,'all affected tiles share one variant');
    assert.ok(mesh.boundingBox.min.y<=Math.min(...offsets)*a[5]+95);
  }finally{anchorReservoirBuildings({bodies:[]},null);mesh.geometry.dispose();mesh.material.dispose();}
});

test('a concave bank under the middle of a wall is closed by ground-fitting foundations and disposed with its tile',()=>{
  const x=-18233,z=12118;
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshStandardMaterial(),1);
  mesh.name='baked-buildings-concave-fixture';const a=mesh.instanceMatrix.array;
  a[0]=a[10]=4;a[5]=50;a[15]=1;a[12]=x;a[13]=50;a[14]=z;mesh.computeBoundingBox();
  const group=new THREE.Group();group.add(mesh);
  const groundAt=(px,pz)=>95+2.5*Math.abs(px-x);
  const water={groundAt,bodies:[{spec:{id:'way/147638019'},bankAt:groundAt,bounds:{minX:x-5,maxX:x+5,minZ:z-5,maxZ:z+5}}]};
  try{
    anchorReservoirBuildings(water,group,[],()=>{},()=>0);
    const walls=mesh.children.find(o=>o.userData.reservoirFoundationWall);assert.ok(walls);
    const p=walls.geometry.attributes.position,feet=[];
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.001&&Math.abs(p.getZ(i)-(z-2))<.001)feet.push(p.getY(i));
    assert.ok(feet.length>0);assert.ok(Math.abs(Math.min(...feet)-95)<.03,'the middle of the wall reaches the independent valley floor');
    assert.equal(a[13]+a[5],145,'roof datum and height are retained');
    assert.ok(mesh.boundingBox.min.y<=Math.min(...feet));
    let disposed=false;walls.geometry.addEventListener('dispose',()=>{disposed=true;});
    disposeTileGeometry(mesh);assert.equal(disposed,true);
  }finally{anchorReservoirBuildings({bodies:[]},null);mesh.material.dispose();mesh.dispose();}
});

test('roads at a repaired foot clear its unmodified neighbouring bank too, while other terrain stays exact',()=>{
  const x=-18233,z=12118,bounds={minX:x-5,maxX:x+5,minZ:z-5,maxZ:z+5};
  const water={groundAt:()=>90,bodies:[{spec:{id:'way/147638019'},bounds,bankAt:()=>95},{spec:{id:'neighbour'},bounds,bankAt:()=>120}]};
  try{
    anchorReservoirBuildings(water,null);
    assert.equal(reservoirRoadBase(x,z,50),120,'include the real neighbouring dry triangles, not just the four target banks');
    assert.equal(reservoirRoadBase(x,z,125),125,'higher terrain still supports the road');
    assert.equal(reservoirRoadBase(0,0,12.345),12.345,'the correction is confined to the repaired-foot regions');
  }finally{anchorReservoirBuildings({bodies:[]},null);}
});
