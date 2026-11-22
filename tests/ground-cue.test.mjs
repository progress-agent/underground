import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Scene,ShaderLib} from 'three';
import {groundCueStrength,groundCueWeight} from '../src/ground-cue.js';
import {createRoads} from '../src/roads.js';

test('ground cue URL strength has a mid default, exact off, and bounded tuning',()=>{
  for(const value of [null,undefined,'','bad',Infinity])assert.equal(groundCueStrength(value),.5);
  assert.equal(groundCueStrength('0'),0);assert.equal(groundCueStrength('.75'),.75);
  assert.equal(groundCueStrength(-2),0);assert.equal(groundCueStrength(2),1);
});
test('ground cue vanishes above the street, below ground and under water',()=>{
  assert.equal(groundCueWeight(.5,1.7),.5);
  assert.ok(groundCueWeight(.5,25)>0&&groundCueWeight(.5,25)<.5);
  for(const height of [-1,40,60,300,NaN])assert.equal(groundCueWeight(.5,height),0);
  assert.equal(groundCueWeight(.5,2,true),0);
});
test('road cue height follows Master and tuning never replaces either material',()=>{
  let ratio=1;const r=createRoads({scene:new Scene(),isOpen:()=>false,getRatio:()=>ratio});
  const materials=[r.material,r.bridgeMaterial],keys=materials.map(m=>m.customProgramCacheKey());
  try{for(const master of [1,1.1,5,10]){ratio=1/master;
    r.update({x:0,z:0,height:1.7/master});assert.equal(r.groundCue.weight,.5);
    r.update({x:0,z:0,height:60/master});assert.equal(r.groundCue.weight,0);
  }
  r.groundCue.setStrength(0);r.update({x:0,z:0,height:.1});assert.equal(r.groundCue.weight,0);
  r.groundCue.setStrength(1);r.update({x:0,z:0,height:.1});assert.equal(r.groundCue.weight,1);
  assert.deepEqual([r.material,r.bridgeMaterial],materials);
  assert.deepEqual(materials.map(m=>m.customProgramCacheKey()),keys);
  for(const m of materials)assert.equal(m.emissive.getHex(),0);
  }finally{r.dispose()}
});
test('both road materials install the cue after the base pavement colour',()=>{
  const roads=createRoads({scene:new Scene(),isOpen:()=>false});
  try{for(const material of [roads.material,roads.bridgeMaterial]){
    const shader={vertexShader:ShaderLib.lambert.vertexShader,fragmentShader:ShaderLib.lambert.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader,null);
    assert.ok(shader.fragmentShader.includes('float gcJoints = gcJoint('));
    assert.ok(shader.fragmentShader.indexOf('diffuseColor.rgb=lkCol;')<shader.fragmentShader.indexOf('float gcJoints ='));
    assert.ok(shader.vertexShader.includes('vGroundLocal = vRoadWorld - uGroundOrigin;'));
    assert.equal(shader.uniforms.uGroundCue,roads.material.userData.shader.uniforms.uGroundCue);
  }}finally{roads.dispose();}
});
