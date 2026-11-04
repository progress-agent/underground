import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createOpeningPrograms} from '../src/opening-programs.js';
import {applyM25Mask} from '../src/m25.js';
import {installAirportDockTerrainMask} from '../src/airport-docks.js';
import {applyRiverBedMaterial} from '../src/river-materials.js';
import {applySurfaceTexture} from '../src/surface-texture.js';
import {registerGroundNight} from '../src/night-scene.js';

test('early preparation covers future ground hooks without changing the scene or its material',async()=>{
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(0,1,100);
  const texture=new THREE.DataTexture(new Uint8Array([1,2,3,4]),1,1);
  const material=new THREE.MeshStandardMaterial({map:texture,normalMap:texture,roughnessMap:texture,vertexColors:true});
  applyM25Mask(material,texture);installAirportDockTerrainMask(material);applyRiverBedMaterial(material);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);mesh.name='terrainMesh';scene.add(mesh);
  const camera=new THREE.PerspectiveCamera(),target={},previous={};let current=previous;
  const keys=new Set(),targets=[],prepared=[];
  const renderer={getRenderTarget:()=>current,setRenderTarget:t=>{current=t;},compile(group,camera,world){
    targets.push(current);group.traverse(o=>{if(o.material){keys.add(o.material.customProgramCacheKey());prepared.push(o);}});
    assert.equal(scene.children.length,1);assert.equal(mesh.parent,scene);
  }};
  const key=material.customProgramCacheKey(),hook=material.onBeforeCompile,version=material.version;
  const preparation=createOpeningPrograms({renderer,composer:{readBuffer:target},scene,camera,
    undergroundCull:{render:(mode,draw)=>draw()},tubeMaterial:new THREE.MeshStandardMaterial()});
  preparation.prepare();await preparation.ready();
  assert.ok(prepared.some(o=>o.isInstancedMesh&&o.material.isMeshStandardMaterial&&o.material.vertexColors),'motorway coloured instances are prepared');
  assert.ok(prepared.some(o=>o.isInstancedMesh&&o.material.isMeshBasicMaterial&&o.material.side===THREE.DoubleSide&&!o.material.map),'distant double-sided traffic is prepared');
  assert.equal(current,previous);assert.ok(targets.every(t=>t===target));
  assert.equal(material.onBeforeCompile,hook);assert.equal(material.customProgramCacheKey(),key);assert.equal(material.version,version);
  assert.equal(mesh.geometry.drawRange.count,Infinity);assert.deepEqual([...texture.image.data],[1,2,3,4]);
  const bounds={minU:0,minV:0,maxU:1,maxV:1};
  applySurfaceTexture(material,texture,bounds);
  const night=registerGroundNight(material,{minX:0,minZ:0,maxX:1,maxZ:1});
  assert.ok(keys.has(material.customProgramCacheKey()),'eventual day program was prepared');
  assert.ok(keys.has(night.customProgramCacheKey()),'eventual night program was prepared');
  preparation.stop();const count=targets.length;preparation.prepare();assert.equal(targets.length,count);
});
