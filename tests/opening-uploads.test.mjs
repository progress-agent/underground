import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {installDoubleSideSplit} from '../src/double-side-split.js';
import {createOpeningUploads} from '../src/opening-uploads.js';

test('opening uploads initialize the actual transparent derivatives and restore render state',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const material=new THREE.MeshStandardMaterial({transparent:true,side:THREE.DoubleSide});
  const geometry=new THREE.BoxGeometry(),mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
  const originalTarget={};let target=originalTarget;const seen=[];
  const renderer={shadowMap:{autoUpdate:true,needsUpdate:true},getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},setTransparentSort:()=>{},properties:{get:()=>({})},render:stage=>{
    assert.equal(stage,scene,'preparation uses the real scene light-state cache');
    const proxy=stage.children.find(o=>o.isMesh);
    assert.equal(proxy.geometry.drawRange.count,0);
    assert.equal(renderer.shadowMap.autoUpdate,false);
    seen.push(proxy.material);
  }};
  const split=installDoubleSideSplit({renderer,scene});
  const uploads=createOpeningUploads({renderer,camera,materialsFor:split.materialsFor,renderPrepared:split.renderPrepared});
  uploads.frame(scene,Infinity,true);
  const pair=split.pairOf(material);
  assert.deepEqual(seen,[pair.back,pair.front]);
  assert.equal(pair.back.side,THREE.BackSide);assert.equal(pair.front.side,THREE.FrontSide);
  assert.equal(mesh.material,material);assert.equal(material.side,THREE.DoubleSide);
  assert.equal(geometry.drawRange.count,Infinity);assert.equal(target,originalTarget);
  assert.deepEqual(renderer.shadowMap,{autoUpdate:true,needsUpdate:true});
  assert.equal(scene.children.length,1);assert.equal(mesh.children.length,0);
  split.setEnabled(false);assert.deepEqual(split.materialsFor(mesh),[material]);
  const children=scene.children;
  const broken=createOpeningUploads({renderer,camera,renderPrepared:()=>{throw new Error('draw failed');}});
  assert.throws(()=>broken.frame(scene,Infinity,true),/draw failed/);
  assert.equal(scene.children,children);assert.equal(mesh.parent,scene);
  assert.equal(geometry.drawRange.count,Infinity);assert.equal(target,originalTarget);
  assert.deepEqual(renderer.shadowMap,{autoUpdate:true,needsUpdate:true});
});
