import {test,expect} from '@playwright/test';
test('synthetic river samples and their rendered tubes are unchanged by repeated terrain snaps',async({page})=>{
 test.setTimeout(240000);await page.goto('/?fast=1');
 await page.waitForFunction(()=>__ug?.groundReady&&__ug.lateLayers.settled()&&__ug.lineBranchCenterPts.has('central')&&__ug.lineBranchCenterPts.has('district'),null,{timeout:180000});
 const result=await page.evaluate(()=>{
  const u=__ug;u.sim.paused=true;
  const hash=a=>{let h=2166136261;for(const b of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))h=Math.imul(h^b,16777619);return h>>>0;};
  const snapshot=()=>Object.fromEntries(['central','district'].map(id=>[id,{
   points:u.lineBranchCenterPts.get(id).map(ps=>ps.map(p=>[p.x,p.y,p.z,p._depthM,p._synthetic||false])),
   geometry:u.scene.getObjectByName('line:'+id).children.filter(o=>o.isMesh&&o.geometry).map(o=>[o.name,hash(o.geometry.attributes.position.array)])
  }]));
  const before=snapshot(),samples=Object.values(before).flatMap(v=>v.points.flat()).filter(p=>p[4]);
  const after=[];for(let i=0;i<2;i++){for(const id of ['central','district'])u.snapAllTubesToTerrain({onlyLine:id});after.push(snapshot());}
  return{before,after,synthetics:samples.length};
 });
 expect(result.synthetics).toBeGreaterThan(0);for(const state of result.after)expect(state).toEqual(result.before);
});
