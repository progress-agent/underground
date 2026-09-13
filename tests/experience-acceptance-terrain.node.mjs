import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installNodeEnv} from '../scripts/bake-node-env.mjs';
installNodeEnv();
const terrain=await import('../src/terrain.js');
const {initThamesMask}=await import('../src/thames-mask.js');
const {loadM25Data,initM25Boundary}=await import('../src/m25.js');
const {createThamesVolume}=await import('../src/thames.js');
const thames=JSON.parse(await readFile(new URL('../public/data/thames.json',import.meta.url)));
initThamesMask(thames.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints||m25.points);
const actual=await terrain.tryCreateTerrainMesh({thamesData:thames});
assert.ok(actual,'Actual source terrain boots');
function check(geometry,name){
 let largest=-1;for(const index of geometry.index?.array||[])largest=Math.max(largest,index);
 for(const [attributeName,attribute]of Object.entries(geometry.attributes)){
  assert.ok(attribute.count>largest,`${name}.${attributeName} has ${attribute.count} vertices but index ${largest} is rendered`);
  for(let i=0;i<attribute.array.length;i++)assert.ok(Number.isFinite(attribute.array[i]),`${name}.${attributeName}[${i}] is nonfinite`);
 }
 geometry.computeBoundingSphere();assert.ok(Number.isFinite(geometry.boundingSphere.radius),`${name} has finite bounds`);
}
test('complete real terrain and underside have a value for every rendered vertex attribute',()=>{
 check(actual.mesh.geometry,'terrainMesh');check(actual.undersideMesh.geometry,'terrainUnderside');
});
test('complete real Thames and bank shell contain finite positions and normals',()=>{
 const water=createThamesVolume(thames,terrain.getTerrainMeshSurfaceY);
 check(water.geometry,'thamesRiver');check(water.userData.interiorShell.geometry,'thamesInteriorShell');
});
test('real Westminster bank retains outward keyboard pressure',async()=>{
 const {createMaterialResistance}=await import('../src/material-resistance.js');
 const water=createThamesVolume(thames,terrain.getTerrainMeshSurfaceY),nav=water.userData.navigation;
 const point={x:530.2144486408156,y:-14,z:717.1084189187284};
 const direction={x:.99752645684065,y:0,z:.07029201877156};
 const trace=[];let previous;
 const classify=p=>{const kind=nav.contains(p)?'WATER':p.y>=terrain.getTerrainMeshSurfaceY(p)?'AIR':'CLAY';if(kind!==previous){trace.push({kind,...p,surface:terrain.getTerrainMeshSurfaceY(p)});previous=kind;}return kind;};
 assert.equal(classify(point),'WATER');
 const control=createMaterialResistance({classify,riverNormal:(p,d)=>nav.outwardNormal(p,d)});
 const delta=control.apply(point,{x:direction.x*8,y:0,z:direction.z*8},.016);
 console.log(JSON.stringify({wallStart:point,delta,state:control.state,trace,end:classify({x:point.x+delta.x,y:point.y,z:point.z+delta.z})}));
 assert.equal(control.state?.kind,'hold');
 assert.equal(classify({x:point.x+delta.x,y:point.y,z:point.z+delta.z}),'WATER');
});
