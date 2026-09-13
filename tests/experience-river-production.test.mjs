import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installNodeEnv} from '../scripts/bake-node-env.mjs';
import {createMaterialResistance} from '../src/material-resistance.js';
installNodeEnv();
const terrain=await import('../src/terrain.js');
const {createThamesVolume}=await import('../src/thames.js');
const thames=await(await fetch('/data/thames.json')).json();
await terrain.tryCreateTerrainMesh({thamesData:thames});
const water=createThamesVolume(thames,terrain.getTerrainMeshSurfaceY),nav=water.userData.navigation;
const classify=p=>nav.contains(p)?'WATER':p.y>=terrain.getTerrainMeshSurfaceY(p)?'AIR':'CLAY';
const start={x:530.2144486408156,y:-14,z:717.1084189187284};
for(const [name,direction,speed]of[
 ['forward',{x:.99752645684065,y:0,z:.07029201877156},500],
 ['oblique',{x:.655653,y:0,z:.755062},500],
 ['sprint',{x:.99752645684065,y:0,z:.07029201877156},2000],
])test(`actual Westminster ${name} wall requires sustained pressure and cancels on release`,()=>{
 const controller=createMaterialResistance({classify,riverNormal:(p,d)=>nav.outwardNormal(p,d)});
 const p={...start},dt=.016,d={x:direction.x*speed*dt,y:0,z:direction.z*speed*dt};
 let contactTime=null,exitTime=null;
 for(let frame=0;frame<80;frame++){
  const delta=controller.apply(p,d,dt);
  p.x+=delta.x;p.y+=delta.y;p.z+=delta.z;
  if(contactTime===null&&controller.state?.kind==='hold')contactTime=frame*dt;
  if(classify(p)!=='WATER'){exitTime=(frame+1)*dt;break;}
 }
 assert.notEqual(contactTime,null);assert.notEqual(exitTime,null);
 assert.ok(exitTime-contactTime>=.69,`${exitTime-contactTime}s contact`);
 assert.ok(exitTime-contactTime<.75,`${exitTime-contactTime}s contact`);
 const q={...start};controller.cancel();
 for(let frame=0;frame<20;frame++){
  const delta=controller.apply(q,d,dt);q.x+=delta.x;q.z+=delta.z;
 }
 assert.equal(controller.state?.kind,'hold');controller.cancel();
 controller.apply(q,d,dt);
 assert.ok(controller.state.elapsed<.02,'fresh pressure after release');
});
test('structural sampler preserves independently identified accepted city building bases',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./experience-river-accepted-anchors.json',import.meta.url)));
 let wetChanged=0;
 for(const anchor of fixture.anchors){
  const data=await(await fetch(`/data/surface/tiles/${anchor.tile}`)).json();
  assert.ok(data.buildings.some(b=>b.cx===anchor.x&&b.cz===anchor.z),'retained actual source centre');
  const stable=terrain.getStructuralSurfaceY(anchor);
  assert.equal(Math.round(stable/terrain.VERTICAL_EXAGGERATION*10),anchor.baseDecimetres,
   `accepted anchor ${anchor.x},${anchor.z}`);
  if(Math.abs(stable-terrain.getTerrainMeshSurfaceY(anchor))>.1)wetChanged++;
 }
 assert.equal(fixture.anchors.length,10);
 assert.equal(wetChanged,10,'all ten independently identified changed locations retain accepted structural bases');
});
