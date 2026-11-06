// Lane W, sprint 06Nov26f. Every browser invocation goes through ug-gpu.sh.
// Interleaved live/new, median of 3. Costs are pinned full quality and GPU-
// synchronised; Automatic is a separate lived-frame / settled-resolution run.
import {chromium,devices} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {VIEWS} from './measure-night.mjs';
import {resolveAnyPose} from './measure-setups.mjs';
const [kind,out,live='http://localhost:5340',candidate='http://localhost:5341']=process.argv.slice(2);
if(!['cost','automatic','poses'].includes(kind))throw Error('measure-water.mjs poses|cost|automatic <scratch-dir> [live-url] [new-url]');
await mkdir(out,{recursive:true});
const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return {n:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,median:sorted[Math.floor(a.length/2)],p95:sorted[Math.floor(a.length*.95)]};};
async function boot(browser,origin,setup,phone=false) {
 const d=devices['iPhone 15 Pro'];
 const page=await browser.newPage(phone?{viewport:d.viewport,deviceScaleFactor:d.deviceScaleFactor,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},deviceScaleFactor:setup==='weak'?1:2});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{
  const raf=requestAnimationFrame.bind(window),held=[];window.__held=false;window.__ticks=[];
  window.requestAnimationFrame=cb=>{if(window.__held&&cb.name==='tick'){held.push(cb);return 0;}return raf(ts=>{const t=performance.now();cb(ts);if(cb.name==='tick')window.__ticks.push([ts,performance.now()-t]);});};
  window.__resume=()=>{window.__held=false;for(const cb of held.splice(0))requestAnimationFrame(cb);};
 });
 await page.goto(`${origin}/?skip=1`);
 await page.waitForFunction(()=>{const u=window.__ug;return u?.bakedStats?.tilesTotal>0&&u.bakedStats.tilesBuilt===u.bakedStats.tilesTotal&&u.groundReady&&u.flightsGroup&&u.motorwayGroup&&u.landmarkGroup?.children.length;},null,{timeout:240000});
 if(origin===candidate)await page.waitForFunction(()=>window.__ug?.deepWater,null,{timeout:180000});
 // Loader-quiescence (not a timed guess) before taking a settled pose.
 let last=-1,stable=0;
 for(let i=0;i<60&&stable<3;i++){const s=await page.evaluate(()=>window.__ug.surfaceLoaderStats);if(!s||s.loading===0&&s.loaded===last)stable++;else stable=0;last=s?.loaded??-1;await page.waitForTimeout(400);}
 await page.evaluate(()=>{const u=window.__ug;u.controls.enableDamping=false;u.sim.paused=true;});
 if(setup==='weak'){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
 const gpu=await page.evaluate(()=>{const gl=window.__ug.composer.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
 return {page,errors,gpu};
}
async function pose(page,p) {
 p=await resolveAnyPose(page,p);
 await page.evaluate(p=>{const u=window.__ug;u.camera.position.fromArray(p.p);u.controls.target.fromArray(p.t);u.controls.update();u.camera.updateMatrixWorld(true);},p);
 await page.waitForTimeout(2000);
}
if(kind==='poses') {
 const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
 try {
  const {page}=await boot(browser,candidate,'as-lived');
  const water=await page.evaluate(()=>{
   const bs=window.__ug.deepWater.bodies,q=bs.find(b=>b.spec.name==='Queen Mary Reservoir'),r=bs.find(b=>b.spec.name==='Royal Albert Dock');
   const i=q.original.reduce((a,p,i)=>p[0]<q.original[a][0]?i:a,0),a=q.original[i],o=q.outer[i];
   const eye=[a[0]+(o[0]-a[0])*.15,q.crestY+8.5,a[1]+(o[1]-a[1])*.15];
   const view=q.life.viewpoint('blue-whale',0,40),p=v=>[v.x,v.y,v.z];
   return {heathrowWater:{p:[-19200,5100,4500],t:[-24500,120,8000]},queenMaryCrest:{p:eye,t:[q.centre[0],q.waterY,q.centre[1]]},queenMaryDive:{p:p(view.eye),t:p(view.target)},royalDocks:{p:[r.centre[0],r.waterY+2500,r.centre[1]+800],t:[r.centre[0],r.waterY,r.centre[1]]}};
  });
  await writeFile(`${out}/poses.json`,JSON.stringify(water,null,2));console.log(water);
 }finally{await browser.close();}
} else {
 const water=JSON.parse(await readFile(`${out}/poses.json`,'utf8'));
 const views=kind==='cost'?{...VIEWS,arrival:VIEWS.riverGreenwich,...water}:water;
 const setups=process.env.UG_W_SETUP?[process.env.UG_W_SETUP]:kind==='cost'?['as-lived','weak']:['weak','phone'];
 for(const setup of setups)for(let round=1;round<=3;round++)for(const [label,origin]of [['live',live],['new',candidate]]) {
  if(process.env.UG_W_ROUND&&round!==Number(process.env.UG_W_ROUND))continue;
  if(process.env.UG_W_LABEL&&label!==process.env.UG_W_LABEL)continue;
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
  try {
   const {page,errors,gpu}=await boot(browser,origin,setup==='as-lived'?'as-lived':'weak',setup==='phone');
   await page.evaluate(kind=>{const u=window.__ug;u.sim.paused=kind==='cost';u.setRenderQualityMode(kind==='cost'?'manual':'auto');if(kind==='cost')u.renderQuality.set({scale:1,samples:4});},kind);
   const results={};
   for(const [name,p]of Object.entries(views)) {
    await pose(page,p);
    if(kind==='cost'&&setup==='as-lived'&&round===1&&label==='new'&&water[name])await page.screenshot({path:`${out}/${name}.png`});
    if(kind==='cost') {
     results[name]=await page.evaluate(async()=>{
      const u=window.__ug,r=u.composer.renderer,gl=r.getContext(),pixel=new Uint8Array(4);window.__held=true;await new Promise(r=>setTimeout(r,120));
      const once=()=>{if(window.__ugSun.status.active)r.shadowMap.needsUpdate=true;const draw=()=>u.undergroundCull.render(u.aboveGroundView,()=>u.composer.render(.016));if(u.lakeInteriorMask)u.lakeInteriorMask.render(draw);else draw();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);};
      for(let i=0;i<15;i++)once();const samples=[];
      for(let i=0;i<90;i++){const t=performance.now();once();samples.push(performance.now()-t);}
      window.__resume();return {samples};
     });Object.assign(results[name],stats(results[name].samples));
    }else {
     // Same 24s settle and final 8s resolution window as measure-setups.mjs.
     const trace=[];
     for(let i=0;i<96;i++){await page.waitForTimeout(250);trace.push(await page.evaluate(()=>window.__ug.adaptiveQuality.get()));}
     await page.evaluate(()=>{window.__ticks.length=0;});await page.waitForTimeout(2500);
     const ticks=await page.evaluate(()=>window.__ticks);
     const intervals=ticks.slice(1).map((p,i)=>p[0]-ticks[i][0]);
     const mean=stats(intervals).mean;
     results[name]={fps:1000/mean,interval:stats(intervals),cpu:stats(ticks.map(p=>p[1])),scale:stats(trace.slice(-32).map(p=>p.scale)).median,trace};
    }
    console.log(setup,round,label,name,kind==='cost'?results[name].mean:results[name].fps);
   }
   await writeFile(`${out}/${kind}-${setup}-${label}-${round}.json`,JSON.stringify({setup,round,label,origin,gpu,errors,results},null,2));
  }finally{await browser.close();}
 }
}
