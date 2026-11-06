import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const evidence=async(name,value)=>writeFile(test.info().outputPath(name+'.json'),JSON.stringify(value,null,2));
const ready=async page=>{
 await page.goto('/?skip=1');
 await page.waitForFunction(()=>window.__ug?.deepWater&&window.__ug?.groundReady,null,{timeout:180000});
 await page.evaluate(()=>{const u=window.__ug;u.controls.enableDamping=false;u.sim.paused=true;const m=document.getElementById('masterHeight');m.value='1';m.dispatchEvent(new Event('input'));u.structureMorph.flush();});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
};
test('each drawn volume has its sourced bed at three independent downward ray probes',async({page})=>{
 await ready(page);
 const report=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE,out=[];u.scene.updateMatrixWorld(true);
  for(const b of u.deepWater.bodies) {
   const box=b.bounds,pts=[];
   const step=Math.max(5,(box.maxX-box.minX)/20);
   for(let x=box.minX+step/2;x<box.maxX&&pts.length<3;x+=step)for(let z=box.minZ+step/2;z<box.maxZ&&pts.length<3;z+=step) {
    if(!b.containsXZ(x,z))continue;const bed=b.bedAt(x,z);
    if(bed==null||Math.abs((b.waterY-bed)/5-b.spec.depth.renderM)>.05)continue;
    const ray=new T.Raycaster(new T.Vector3(x,b.waterY+50,z),new T.Vector3(0,-1,0));
    // A bed does not participate in hover picking. Restore Mesh's actual
    // raycast only for this independent geometric measurement.
    const prior=b.bedMesh.raycast;b.bedMesh.raycast=T.Mesh.prototype.raycast;
    const hits=ray.intersectObject(b.bedMesh);b.bedMesh.raycast=prior;
    if(hits.length)pts.push({x,z,drawnDepth:(b.waterY-hits[0].point.y)/5,collisionBed:u.modes.collision.waterAt(x,z)?.bedY,drawnBed:hits[0].point.y});
   }
   out.push({id:b.spec.id,name:b.spec.name,source:b.spec.depth.renderM,pts});
  }
  return out;
 });
 await evidence('bed-probes',report);
 expect(report.length).toBeGreaterThanOrEqual(20);
 for(const b of report){expect(b.pts.length,b.name).toBe(3);for(const p of b.pts){expect(Math.abs(p.drawnDepth-b.source),b.name).toBeLessThan(b.source*.1);expect(p.collisionBed,b.name).toBeCloseTo(p.drawnBed,2);}}
});
test('the real walker dives, meets the floor and surfaces in every deep body',async({page})=>{
 test.setTimeout(300000);await ready(page);
 await page.evaluate(()=>window.__ug.modes.activate('pedestrian'));
 await page.waitForFunction(()=>{const d=window.__ug.modes.registry.get('pedestrian').debug();return d.phase==='body'&&!d.ease.running;},null,{timeout:60000});
 const report=await page.evaluate(async()=>{
  const u=window.__ug,ped=u.modes.registry.get('pedestrian'),keys=u.fpsControls.keys,out=[];
  for(const b of u.deepWater.bodies) {
   const box=b.bounds,step=Math.max(5,(box.maxX-box.minX)/16);let P=null;
   for(let x=box.minX+step/2;x<box.maxX&&!P;x+=step)for(let z=box.minZ+step/2;z<box.maxZ&&!P;z+=step)if(b.containsXZ(x,z)&&b.bedAt(x,z)<b.waterY-b.spec.depth.renderM*5*.9&&(u.modes.collision.standHeightAt(x,z,Infinity,0)??-Infinity)<=b.waterY+1)P={x,z};
   if(!P){out.push({name:b.spec.name,error:'No deep probe'});continue;}
   ped.place(P.x,P.z);ped.setView('first');
   keys.add('q');for(let i=0;i<180;i++)u.modes.update(1/60);keys.delete('q');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const dive=ped.debug(),submerged=u.isSubmergedAt(u.camera.position.x,u.camera.position.y,u.camera.position.z),blend=u.submergedBlend,warp=u.underwaterSurface.uniforms.uUnderwaterAmount.value,visible=b.group.visible&&b.shell.visible;
   keys.add('q');for(let i=0;i<1200;i++)u.modes.update(1/60);keys.delete('q');const bottom=ped.debug();
   keys.add(' ');for(let i=0;i<1500;i++)u.modes.update(1/60);keys.delete(' ');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const surface=ped.debug(),dry=!u.isSubmergedAt(u.camera.position.x,u.camera.position.y,u.camera.position.z);
   out.push({name:b.spec.name,dive,submerged,blend,warp,visible,bottomY:bottom.y,bedY:b.bedAt(bottom.x,bottom.z),surface,dry});
  }
  keys.clear();return out;
 });
 await evidence('walker-dives',report);
 for(const b of report){expect(b.error,b.name).toBeUndefined();expect(b.dive.state,b.name).toBe('swim');expect(b.submerged,b.name).toBe(true);expect(b.visible,b.name).toBe(true);expect(b.blend,b.name).toBeGreaterThan(.9);expect(b.warp,b.name).toBeGreaterThan(.9);expect(b.bottomY,b.name).toBeGreaterThanOrEqual(b.bedY-.01);expect(b.dry,b.name).toBe(true);}
});
test('the larger reservoirs and all Royal Docks reuse Thames animals at true scale',async({page})=>{
 await ready(page);
 const r=await page.evaluate(()=>{
  const u=window.__ug,bodies=u.deepWater.bodies.filter(b=>b.life),before=bodies.map(b=>({id:b.spec.id,name:b.spec.name,ids:b.life.ids,scale:b.life.scaleY,anchor:b.life.habitat.anchor}));
  const slider=document.getElementById('masterHeight');slider.value='5';slider.dispatchEvent(new Event('input'));u.structureMorph.flush();
  for(const b of bodies)b.life.update(0,u.camera,{submerged:false});
  return {before,after:bodies.map(b=>({id:b.spec.id,scale:b.life.scaleY,bedY:b.bedY,waterY:b.waterY}))};
 });
 await evidence('animal-scale',r);
 expect(r.before.filter(b=>b.name.endsWith('Dock')&&/Royal|King George V/.test(b.name))).toHaveLength(3);
 expect(r.before.length).toBeGreaterThanOrEqual(7);
 for(const b of r.before){for(const id of ['blue-whale','bottlenose-whale','hammerhead','turtle','octopus','jellyfish','silver-school'])expect(b.ids,b.name).toContain(id);expect(b.scale).toBe(5);}
 for(const b of r.after)expect(b.scale).toBe(1);
});
test('banks share solid ground queries for the walker, Drone and Balloon, with no water gaps',async({page})=>{
 await ready(page);
 const r=await page.evaluate(async()=>{
  const u=window.__ug,T=window.__ugTHREE;
  const drone=await import('/src/modes/drone-physics.js'),balloon=await import('/src/modes/balloon-physics.js');
  u.scene.updateMatrixWorld(true);
  const bankMeshes=u.deepWater.bodies.map(b=>b.bankMesh).filter(Boolean);
  const out=[];
  for(const b of u.deepWater.bodies.filter(b=>b.spec.bank)) {
   let probes=0,largestMismatch=0,minimumDroneClearance=Infinity,minimumBalloonClearance=Infinity;
   for(let i=0;i<b.original.length;i+=Math.max(1,Math.floor(b.original.length/20))) {
    const a=b.original[i],o=b.outer[i],x=a[0]+(o[0]-a[0])*.15,z=a[1]+(o[1]-a[1])*.15;
    if(u.deepWater.at(x,z))continue;
    const h=b.bankAt(x,z);if(h==null)continue;
    const g=u.modes.collision.groundHeightAt(x,z);
    const ray=new T.Raycaster(new T.Vector3(x,5000,z),new T.Vector3(0,-1,0));
    const hits=ray.intersectObjects(bankMeshes);if(!hits.length)continue;
    largestMismatch=Math.max(largestMismatch,Math.abs(hits[0].point.y-g));probes++;
    const world={VE:5,collision:u.modes.collision,waterSurfaceY:u.modes.ctx.waterSurfaceAt};
    const ds=drone.createDroneState({x,y:g-5,z});drone.stepDrone(ds,{},1/30,drone.DRONE_DEFAULTS,world);
    minimumDroneClearance=Math.min(minimumDroneClearance,ds.pos.y-drone.DRONE_HALF_HEIGHT_M*5-g);
    const bs=balloon.createBalloonState({x,y:g-5,z});balloon.stepBalloon(bs,{},1/30,balloon.BALLOON_DEFAULTS,world);
    minimumBalloonClearance=Math.min(minimumBalloonClearance,bs.pos.y-balloon.BASKET_EYE_M*5-g);
   }
   out.push({name:b.spec.name,probes,largestMismatch,minimumDroneClearance,minimumBalloonClearance});
  }
  return out;
 });
 await evidence('bank-solids',r);
 for(const b of r){expect(b.probes,b.name).toBeGreaterThan(0);expect(b.largestMismatch,b.name).toBeLessThan(.01);expect(b.minimumDroneClearance,b.name).toBeGreaterThanOrEqual(-.01);expect(b.minimumBalloonClearance,b.name).toBeGreaterThanOrEqual(-.01);}
});
