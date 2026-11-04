import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {buildCrownRibbonsSteps} from '../src/crown-ribbon.js';

// Captured from the synchronous live implementation at cfb8c44. Include
// indexed colour and casing meshes, curved tangents and more than one branch.
test('sliced crown ribbons retain the live geometry bytes',()=>{
  const curves=[0,1].map(j=>({curve:new THREE.CatmullRomCurve3(Array.from({length:25},(_,i)=>new THREE.Vector3(i*80,j*12+Math.sin(i)*30,Math.cos(i/2)*140))),segments:256,baseRadius:4.4}));
  const steps=buildCrownRibbonsSteps({lineId:'northern',colour:0x202020,curves});
  let step=steps.next(),yields=0;
  while(!step.done){yields++;step=steps.next();}
  assert.ok(yields>20);
  const hashes=step.value.map(mesh=>Object.fromEntries([...Object.entries(mesh.geometry.attributes),['index',mesh.geometry.index]].map(([key,a])=>[key,createHash('sha256').update(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength)).digest('hex')])));
  assert.deepEqual(hashes,[
    {position:'4200d47ce31d273c0ba14947ca0892787e8d24ea90f1f91b5beefa68f39a0a46',normal:'d0765e113196bd35de0f47d010f370619bd90dd03c9f792a0155487b5f001ea3',trueAxisY:'f2be2378e258491a29e7597ff644221d9b2f7826377d64b09e2889086ff92af9',index:'df42f89422ae58efe01e586edbe4bcef7be54868d4bb9f99bd0e7eabd0abeef7'},
    {position:'c955c74c428b6b770f799e8697859d279eb6ff6f57dde0963da38988cb2d9b17',normal:'19c92d5409f394d2e250305aa512cc314e0b8b455494b6bb18564679ca800b38',trueAxisY:'e0aac22490a3d64a192ffef3c3c4b5f1055feaca5eb0312ce1ade1f536345455',index:'c8ed9e989fcff5fa737a9199b96fe10db36b0186e9b08e50c29cca5b179b9981'},
  ]);
});
