import {test,expect} from '@playwright/test';
let page;const errors=[];
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser})=>{
 page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/?skip=1');
 await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ug.lateLayers.settled()&&window.__ug.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal,null,{timeout:180000});
 await page.evaluate(()=>{window.__ug.sim.paused=true;window.__ug.controls.enableDamping=false;window.__ug.modes.activate('pedestrian');});
});
test.afterAll(async()=>page?.close());
for(const master of[1,1.1])test(`TW2/TW6: walk from dry land over each researched approach to its deck at Master ${master}`,async()=>{
 const rows=await page.evaluate(master=>{
  const u=window.__ug,ped=u.modes.registry.get('pedestrian'),keys=u.fpsControls.keys,out=[];
  u.masterHeight.setValue(master);u.structureMorph.flush();
  for(const[id,r]of u.tidewayPlatforms.userData.registry){
   const a=r.approach,{x,z,nx,nz}=a.frame,d0=a.dryDistance+a.length+1;
   ped.place(r.anchor.x+x+nx*d0,r.anchor.z-z-nz*d0,{yaw:Math.atan2(nx,-nz)});
   const start=ped.debug();keys.add('w');let d=d0,swam=false;
   for(let i=0;i<Math.ceil((d0-a.innerStart+3)/6*60)+180;i++){
    u.modes.ctx.time+=1/60;ped.update(1/60);const q=ped.debug();d=(q.x-r.anchor.x-x)*nx-(q.z-r.anchor.z+z)*nz;swam||=q.state==='swim';if(d<a.innerStart-.25)break;
   }
   keys.clear();const q=ped.debug(),xx=r.anchor.x+x+nx*6,zz=r.anchor.z-z-nz*6;
   out.push({id,master,startGround:u.getTerrainMeshSurfaceY({x:start.x,z:start.z}),startY:start.y,d,target:a.innerStart-.25,deckGapM:(q.y-r.deckY)/r.group.scale.y,state:q.state,swam,deckAboveApproachM:(r.deckY-u.modes.collision.standHeightAt(xx,zz,Infinity))/r.group.scale.y,expected:r.data.deckAOD-r.data.approach.aodM});
  }return out;
 },master);
 console.log('TW2 walked approaches',JSON.stringify(rows));expect(rows).toHaveLength(9);
 for(const r of rows){expect(r.startGround,r.id+' starts on dry terrain').toBeGreaterThan(12);expect(Math.abs(r.startY-r.startGround),r.id+' starts on the ground').toBeLessThan(.2);expect(r.d,r.id+' reaches deck').toBeLessThan(r.target);expect(r.swam,r.id).toBe(false);expect(r.state,r.id).toBe('ground');expect(Math.abs(r.deckGapM),r.id).toBeLessThan(.2);expect(r.deckAboveApproachM,r.id).toBeCloseTo(r.expected,4);}
});
test('G1: approaches attach without browser errors',()=>expect(errors).toEqual([]));
