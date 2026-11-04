import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createStars} from '../src/stars.js';
import {createVerticalScaleController} from '../src/vertical-scale.js';

for(const master of [1.1,5,10])test(`stars keep their real elevation when Master is ${master}`,async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>[[11767,2.53,89.26,1.97,.6]]});
 try{
  const scene=new THREE.Scene(),stars=createStars({scene,renderer:{getPixelRatio:()=>2}});
  await stars.load();
  const camera=new THREE.PerspectiveCamera(55,1.6,1,50000),ratio=master/5;
  createVerticalScaleController({camera,value:master});
  camera.position.set(0,100,0);
  // This canonical direction is displayed 40 degrees above the northern horizon.
  camera.lookAt(0,100+1000*Math.tan(40*Math.PI/180)/ratio,-1000);camera.updateMatrixWorld(true);
  stars.update(camera,23,1);
  const pole=new THREE.Vector3(0,Math.sin(51.5*Math.PI/180),-Math.cos(51.5*Math.PI/180));
  pole.applyMatrix3(stars.points.material.uniforms.uRotation.value);
  const onScreen=Math.atan2(pole.y,-pole.z)*180/Math.PI;
  assert.ok(Math.abs(onScreen-11.5)<.01,`real north pole should be 11.5 degrees above frame centre, found ${onScreen}`);
 }finally{globalThis.fetch=originalFetch;}
});
