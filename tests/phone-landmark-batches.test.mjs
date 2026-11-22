import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPhoneLandmarkBatches} from '../src/phone-landmark-batches.js';
test('plain landmark neighbours keep every vertex and base across Master changes, and visibility restores',()=>{
 const root=new THREE.Group(),mat=new THREE.MeshStandardMaterial(),originals=[];
 for(const [x,y,z] of [[10,30,10],[200,70,400]]){const anchor=new THREE.Group();anchor.name='landmark-neighbour';anchor.position.set(x,y,z);anchor.scale.y=1;
 const m=new THREE.Mesh(new THREE.BoxGeometry(12,20,8).translate(0,10,0).toNonIndexed(),mat);m.name='landmark-context';anchor.add(m);root.add(anchor);originals.push(m);}
 const b=createPhoneLandmarkBatches();for(let i=0;i<100&&!b.stats().done;i++)b.prepare(root,true,.2);assert.equal(b.stats().done,true);
 const batch=root.children.find(o=>o.name==='phone-landmark-context-batch');assert.ok(batch);
 for(const ratio of [.2,.5,1]){
  let at=0;for(const m of originals){m.parent.scale.y=5*ratio;root.updateWorldMatrix(true,true);const p=m.geometry.attributes.position;
   for(let i=0;i<p.count;i++,at++){const original=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld),merged=new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.position,at),base=batch.geometry.attributes.aBaseY.getX(at);merged.y=base+(merged.y-base)*ratio;assert.ok(original.distanceTo(merged)<.0001);}}
 }
 b.begin(true);assert.equal(batch.visible,true);assert.ok(originals.every(m=>!m.visible));b.end();assert.equal(batch.visible,false);assert.ok(originals.every(m=>m.visible));
});
