import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildThamesCrossSections } from '../src/thames-profile.js';
import { refineTerrainRiverBed } from '../src/terrain-river-bed.js';
import { configureRiverMaterialReach, riverCentrality } from '../src/river-materials.js';
import { createThamesNavigation } from '../src/thames-navigation.js';

const source=JSON.parse(fs.readFileSync(new URL('../public/data/thames.json',import.meta.url)));
const sections=buildThamesCrossSections(source.points);
const targets=[{name:'Westminster',x:435.131,z:710.408,expected:-40},
  {name:'Tower Bridge',x:3653.742,z:119.195,expected:-50}];
function fixture(x,z){
  const geom=new THREE.PlaneGeometry(800,800,4,4);geom.rotateX(-Math.PI/2);
  for(let i=0;i<geom.attributes.position.count;i++)geom.attributes.position.setY(i,10.75);
  const refined=refineTerrainRiverBed(geom,sections.positions,{centerX:x,centerZ:z});
  const mesh=new THREE.Mesh(geom,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.position.set(x,0,z);mesh.updateMatrixWorld(true);
  return {geom,refined,mesh};
}
function rayY(mesh,x,z){
  const ray=new THREE.Raycaster(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));
  return ray.intersectObject(mesh,false)[0]?.point.y;
}
for(const target of targets)test(`${target.name} actual coarse shelf is replaced by sourced navigable bathymetry`,()=>{
  const {geom,refined,mesh}=fixture(target.x,target.z);
  const y=refined.sample(target.x,target.z);
  assert.ok(Math.abs(y-target.expected)<0.02,`${target.name} floor ${y}`);
  assert.ok(Math.abs(rayY(mesh,target.x,target.z)-y)<0.002,'physical sample matches actual final GPU triangles');
  assert.ok((12-y)*1.1/5>10,'whole water column is renderable at requested Master height');
  const nav=createThamesNavigation(sections.positions,({x,z})=>refined.sample(x,z),12);
  assert.ok(nav.contains({x:target.x,y:(12+y)/2,z:target.z}));
  assert.ok(!nav.contains({x:target.x,y:y-0.1,z:target.z}));
  // Unchanged coarse land/shelf outside the wet footprint.
  let exterior=0;
  for(let x=target.x-380;x<=target.x+380;x+=38)for(let z=target.z-380;z<=target.z+380;z+=38){
    if(nav.containsXZ(x,z))continue;
    assert.ok(Math.abs(rayY(mesh,x,z)-10.75)<0.002,'outside river terrain moved');exterior++;
  }
  assert.ok(exterior>200);geom.dispose();mesh.material.dispose();
});
test('minimum plane intersection retains deeper existing pockets without duplicate coplanar floors',()=>{
  const geom=new THREE.PlaneGeometry(100,100,2,2);geom.rotateX(-Math.PI/2);
  for(let i=0;i<geom.attributes.position.count;i++)geom.attributes.position.setY(i,-20);
  geom.attributes.position.setY(4,-80);
  const old=geom.clone(),oldMesh=new THREE.Mesh(old,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  oldMesh.updateMatrixWorld(true);
  const raw=new Float32Array([-45,12,-45,45,12,-45,-45,-40,-45,45,-40,-45,
    -45,12,45,45,12,45,-45,-40,45,45,-40,45]);
  const refined=refineTerrainRiverBed(geom,raw),mesh=new THREE.Mesh(geom,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.updateMatrixWorld(true);
  for(let x=-44;x<45;x+=7)for(let z=-44;z<45;z+=7){
    const expected=Math.min(-40,rayY(oldMesh,x,z));
    assert.ok(Math.abs(refined.sample(x,z)-expected)<0.002);
    assert.ok(Math.abs(rayY(mesh,x,z)-expected)<0.002);
  }
  assert.ok(refined.sample(0,0)<-79.99);
  assert.ok(refined.segmentMinimum({x:0,z:-44},{x:0,z:44})<-79.99,
    'bank foundations can follow the minimum between cross-section endpoints');
  for(const item of[mesh,oldMesh]){item.geometry.dispose();item.material.dispose();}
});
test('central masonry follows current mapped bridge positions, not obsolete zone-table chainages',()=>{
  const result=configureRiverMaterialReach(source.points);
  assert.ok(Math.abs(result.anchors[0]-55128)<30);
  assert.ok(Math.abs(result.anchors[1]-59308)<30);
  assert.ok(Math.abs(result.anchors[2]-63971)<30);
  for(const chain of[60021.85,60990,63980.85])assert.equal(riverCentrality(chain),1);
  assert.equal(riverCentrality(45000),0);
  assert.equal(riverCentrality(72000),0);
});
