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
    assert.equal(proxy.geometry.drawRange.count,3,'a real triangle exercises the draw pipeline');
    assert.equal(target.width,2);assert.equal(target.height,2);
    assert.equal(target.samples,4);assert.equal(target.depthBuffer,true);
    assert.equal(target.texture.type,THREE.HalfFloatType);
    assert.equal(target.depthTexture.type,THREE.UnsignedIntType);
    assert.notEqual(target.depthTexture.source,cityTarget.depthTexture.source);
    assert.deepEqual(cityTarget.depthTexture.image,{width:2880,height:1800});
    assert.equal(renderer.shadowMap.autoUpdate,false);
    seen.push(proxy.material);
  }};
  const cityTarget=new THREE.WebGLRenderTarget(2880,1800,{samples:4,type:THREE.HalfFloatType});
  cityTarget.depthTexture=new THREE.DepthTexture(2880,1800,THREE.UnsignedIntType);
  const split=installDoubleSideSplit({renderer,scene});
  const uploads=createOpeningUploads({renderer,camera,renderTarget:cityTarget,materialsFor:split.materialsFor,renderPrepared:split.renderPrepared});
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

test('opening preparation reuses a real draw and removes its observer when finished or skipped',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
  let target=null,prepared=0;
  const direct=()=>{};
  const renderer={renderBufferDirect:direct,shadowMap:{},getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},render:()=>{prepared++;}};
  const uploads=createOpeningUploads({renderer,camera});
  assert.equal(renderer.renderBufferDirect,direct,'a bypassed opening observes nothing');
  uploads.prime(scene);
  renderer.renderBufferDirect(camera,scene,mesh.geometry,mesh.material,mesh,null);
  const before=prepared;
  uploads.frame(scene,Infinity,true);
  assert.equal(prepared,before,'the already drawn object needs no preparation render');
  assert.equal(uploads.stats.skippedDrawn,1);
  assert.equal(renderer.renderBufferDirect,direct);
  const cancelled=createOpeningUploads({renderer,camera});cancelled.prime(scene);cancelled.stop();
  assert.equal(renderer.renderBufferDirect,direct,'an interrupted opening restores ownership too');
});


test('one primitive and one geometry instance are prepared without mutating the city depth attachment',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(30),3));
  geometry.setDrawRange(3,6);geometry.instanceCount=200;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());scene.add(mesh);
  const city=new THREE.WebGLRenderTarget(2880,1800,{samples:4,type:THREE.HalfFloatType});
  city.depthTexture=new THREE.DepthTexture(2880,1800,THREE.UnsignedIntType);
  let bound=city;let throws=false;
  const renderer={shadowMap:{},getRenderTarget:()=>bound,setRenderTarget:t=>{bound=t;},render:()=>{
    assert.equal(geometry.drawRange.start,3);assert.equal(geometry.drawRange.count,3);
    assert.equal(geometry.instanceCount,1);
    assert.notEqual(bound.depthTexture.source,city.depthTexture.source);
    bound.depthTexture.image.width=2;bound.depthTexture.image.height=2;
    assert.deepEqual(city.depthTexture.image,{width:2880,height:1800});
    if(throws)throw Error('warm draw failed');
  }};
  createOpeningUploads({renderer,camera,renderTarget:city}).frame(scene,Infinity,true);
  assert.deepEqual(geometry.drawRange,{start:3,count:6});assert.equal(geometry.instanceCount,200);assert.equal(bound,city);
  throws=true;const uploads=createOpeningUploads({renderer,camera,renderTarget:city});
  assert.throws(()=>uploads.frame(scene,Infinity,true),/warm draw failed/);
  assert.deepEqual(geometry.drawRange,{start:3,count:6});assert.equal(geometry.instanceCount,200);assert.equal(bound,city);
});
