import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createOvergroundFleet,BODY_GREY} from '../src/overground-trains.js';

// Sprint 23Sep26w lane E: overground roofs are light grey like the rest of the
// train, whatever the line colour, so trains read clearly from above.
const path=[new THREE.Vector3(0,0,0),new THREE.Vector3(3000,0,0)];
for(const colour of['#ee7c0e','#00a4a7','#e21836',0x7156a5])test(`roof matches body grey for line colour ${colour}`,()=>{
 const fleet=createOvergroundFleet([path],colour,'test');
 const byName=Object.fromEntries(fleet.userData.meshes.map(m=>[m.name,m]));
 const body=byName['overground-train-bodies'].material.color.getHex();
 const roof=byName['overground-train-roofs'].material.color.getHex();
 assert.equal(body,new THREE.Color(BODY_GREY).getHex());
 assert.equal(roof,body);
 assert.notEqual(roof,new THREE.Color(colour).getHex());
 // D-015: no per-instance colour on any train mesh.
 for(const mesh of fleet.userData.meshes)assert.equal(mesh.instanceColor,null);
});
