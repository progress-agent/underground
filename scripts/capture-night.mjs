// Sprint night acceptance poses. Run under ug-gpu.sh; outputs belong outside the vault.
import {chromium,devices} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
export const POSES={
 overview:{p:[0,20000,18000],t:[0,0,0]},streetBank:{p:[2952.9,337.8,-732.9],t:[1910.1,196.2,-783.7]},
 riverGreenwich:{p:[8447.1,112,2136.1],t:[7156,12,635.4]},city2km:{p:[-1800,2000,3400],t:[1500,0,-300]},
 streetClose:{p:[2300,130,-720],t:[1500,90,-760]},dlrViaduct:{p:[7682.2,192.7,-342.8],t:[7448,24.5,-110.1]},
 lookUp:{rel:true,p:[-3000,30,-300],t:[-2880,930,-600]},dusk:{hour:19,rel:true,p:[-3000,30,-300],t:[-2400,450,-900]},
 // The research labelled its 2,000 scene-unit pose "2km"; real 2km is 10,000 scene units at VE5.
 real2km:{p:[-1800,10000,3400],t:[1500,0,-300]},
 moon:{rel:true,p:[-3000,30,-300],t:[-3645,645,152]},
 // The research's nearly upward pose changes its displayed pitch with Master. Keep a true-zenith supplement too.
 zenith:{rel:true,p:[-3000,30,-300],t:[-3000,1030,-300]},
};
// Optional final argument selects comma-separated pose names for supplemental captures.
const [origin,out,mode='desktop',path='baked',only='']=process.argv.slice(2);await mkdir(out,{recursive:true});
const selected=only?only.split(','):Object.keys(POSES);
if(selected.some(name=>!POSES[name]))throw new Error('Unknown night capture pose');
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
const d=devices['iPhone 15 Pro'];const p=await b.newPage(mode==='phone'?{viewport:d.viewport,deviceScaleFactor:d.deviceScaleFactor,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},deviceScaleFactor:2});
const errors=[];p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await p.goto(`${origin}/?fast=1&buildings=${path}`);
// The live building path does not create the baked landmark group. Let its tiles stream at each pose.
await p.waitForFunction(path=>window.__ug?.groundReady&&window.__ug?.motorwayGroup&&(path==='live'||window.__ug?.landmarkGroup),path,{timeout:180000});
await p.evaluate(()=>{const u=window.__ug;u.controls.enableDamping=false;if(!document.documentElement.classList.contains('ug-touch')){u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:4});}window.__ugClouds?.setTimeOverride(900);});
if(mode==='phone'){const c=await p.context().newCDPSession(p);await c.send('Emulation.setCPUThrottlingRate',{rate:4});}
const records=[];
for(const name of selected){const pose=POSES[name];
 await p.evaluate(pose=>{const u=window.__ug,p=[...pose.p],t=[...pose.t];if(pose.rel){const g=u.getTerrainMeshSurfaceY({x:p[0],z:p[2]})??0;p[1]+=g;t[1]+=g;}
 u.camera.position.fromArray(p);u.controls.target.fromArray(t);u.controls.update();window.__ugSun.setHour(pose.hour??23,{persist:false});},pose);
 await p.waitForTimeout(mode==='phone'?60000:path==='live'?15000:3500);
 const metadata=await p.evaluate(async()=>{const u=window.__ug,s=window.__ugSun,n=await import('/src/night.js');const mats={};let buildingMeshes=0,buildingInstanceColours=0;u.scene.traverse(o=>{if(o.material){const name=o.material.name||o.material.type;mats[name]=(mats[name]??0)+1;if(o.material.name==='night-buildings'){buildingMeshes++;if(o.instanceColor)buildingInstanceColours++;}}});return{hour:s.hour,buildingPath:u.buildingsPath,buildingMeshes,buildingInstanceColours,night:s.state.night,air:s.status.airWeight,shadow:s.status.active,sunFactor:s.state.sunFactor,nightUniforms:Object.fromEntries(Object.entries(n.nightUniforms).map(([k,v])=>[k,v.value])),materials:mats,quality:u.renderQuality.get(),camera:u.camera.position.toArray(),target:u.controls.target.toArray(),quaternion:u.camera.quaternion.toArray(),master:u.camera.userData.masterHeightController.value,stars:u.scene.getObjectByName('real-stars')?.geometry.attributes.position.count};});
 await p.screenshot({path:`${out}/${mode}-${path}-${name}.png`});records.push({name,...metadata});console.log(mode,name,metadata.night,metadata.stars);
}
await writeFile(`${out}/${mode}-${path}-metadata.json`,JSON.stringify({records,errors},null,2));await b.close();
