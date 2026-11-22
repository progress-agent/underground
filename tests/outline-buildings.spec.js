import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const bakedMeta=JSON.parse(fs.readFileSync(new URL('../public/data/surface/baked/outlines-meta.json',import.meta.url)));

async function ready(page,set){
 await page.goto(`/?fast=1&outlines=${set}`);
 await page.waitForFunction(()=>window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal,{},{timeout:120000});
 if(set!=='0')await page.waitForFunction(()=>['ready','failed'].includes(window.__ug?.outlines?.stats.state),{},{timeout:240000});
}
test('outlines off imports and allocates nothing, including after landing',async({page})=>{
 const requests=[];page.on('request',r=>requests.push(r.url()));await ready(page,'0');await page.waitForTimeout(3000);
 expect(await page.evaluate(()=>window.__ug.outlines)).toBeNull();expect(requests.filter(u=>/outline-buildings|outlines-[ab]\.z\.bin/.test(u))).toEqual([]);
 expect(await page.evaluate(()=>window.__ug.scene.getObjectByName('outline-buildings')!=null)).toBe(false);
});
for(const set of ['a','b'])test(`outline ${set}: resident once, no duplicates, real wall collision and hover at five buildings`,async({page})=>{
 test.setTimeout(300000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await ready(page,set);
 const result=await page.evaluate(async()=>{
  const u=window.__ug,o=u.outlines,T=window.__ugTHREE;
  const all=o.group.children.flatMap(m=>m.userData.outlineRecords.map(r=>({m,r}))),samples=[];
  const inside=(ring,x,z)=>{let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;};
  u.modes.collision.sync();
  // Pick exposed walls from geometry, without testing movement to choose a
  // passing sample. A neighbour standing across a shared party wall is a
  // real earlier obstacle and cannot measure this facade's stand-off.
  for(const {m,r}of all){if(r.ring.length<6||r.height<15)continue;
   for(let edge=0;edge<r.ring.length;edge++){
    const a=r.ring[edge],b=r.ring[(edge+1)%r.ring.length],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz);if(L<6)continue;
    const nx=-dz/L,nz=dx/L,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
    if(inside(r.ring,x+nx*2,z+nz*2)||!inside(r.ring,x-nx*2,z-nz*2))continue;
    if(u.modes.collision.buildingsNear(x,z,2.5).length)continue;
    const x0=Math.min(x-nx*2,x+nx*2)-.15,x1=Math.max(x-nx*2,x+nx*2)+.15,z0=Math.min(z-nz*2,z+nz*2)-.15,z1=Math.max(z-nz*2,z+nz*2)+.15;
    if(all.some(q=>q.r!==r&&q.r.maxX>=x0&&q.r.minX<=x1&&q.r.maxZ>=z0&&q.r.minZ<=z1))continue;
    samples.push({m,r,edge});break;
   }if(samples.length===5)break;
  }
  const probes=[];
  for(const {m,r,edge}of samples){
   const a=r.ring[edge],b=r.ring[(edge+1)%r.ring.length],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),nx=-dz/L,nz=dx/L,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
   const p={x:x+nx*2,z:z+nz*2,y:r.base+1};
   const move=u.modes.collision.moveAndSlide(p,{x:-nx*4,z:-nz*4,y:0},{radius:.1,height:2,step:0});
   const raycaster=new T.Raycaster(new T.Vector3(p.x,p.y,p.z),new T.Vector3(-nx,0,-nz));const hit=raycaster.intersectObject(m)[0];
   probes.push({key:r.key,collision:move.hit,wallDistance:Math.hypot(move.x-x,move.z-z),hover:hit?.building.key===r.key});
  }
  window.__ugSun.setHour(23,{persist:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const night=o.group.children.every(m=>m.material===o.materials().night);
  window.__ugSun.setHour(13,{persist:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const shadow=o.group.children.every(m=>m.castShadow&&m.customDepthMaterial===o.materials().depth);
  return {stats:o.stats,probes,night,shadow,uploads:o.stats.uploads,geometry:o.group.children.map(m=>[m.geometry.id,m.geometry.attributes.position.data.version,m.geometry.index.version])};
 });
 console.log('OUTLINE_EVIDENCE',set,JSON.stringify(result));
 expect(result.stats.state).toBe('ready');expect(result.stats.errors).toEqual([]);expect(result.stats.count).toBe(result.stats.hidden);
 expect(result.stats.selected).toBe(bakedMeta.sets[set].buildings);expect(result.stats.count).toBeGreaterThan(bakedMeta.sets[set].buildings*.98);expect(result.probes).toHaveLength(5);
 for(const p of result.probes){expect(p.collision,p.key).toBe(true);expect(p.wallDistance,p.key).toBeLessThan(.31);expect(p.hover,p.key).toBe(true);}
 expect(result.night).toBe(true);expect(result.shadow).toBe(true);expect(errors).toEqual([]);
 await page.evaluate(()=>{const u=__ug;u.camera.position.x+=1000;u.controls.target.x+=1000;u.controls.update();});
 await page.waitForTimeout(1000);expect(await page.evaluate(()=>window.__ug.outlines.stats.uploads)).toBe(result.uploads);
 expect(await page.evaluate(()=>__ug.outlines.group.children.map(m=>[m.geometry.id,m.geometry.attributes.position.data.version,m.geometry.index.version]))).toEqual(result.geometry);
});
test.describe('phone loading slices',()=>{
 test.use({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 for(const set of ['a','b'])test(`outline ${set} stays within the loading-task budget on the phone setup`,async({page})=>{
  test.setTimeout(300000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(()=>{window.__outlineLongTasks=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__outlineLongTasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});});
  await page.goto(`/?touch=1&fast=1&outlines=${set}`);
  await page.waitForFunction(()=>['ready','failed'].includes(window.__ug?.outlines?.stats.state),null,{timeout:270000});
  const result=await page.evaluate(()=>({stats:__ug.outlines.stats,longTasks:window.__outlineLongTasks,gpu:__ug.composer.renderer.getContext().getParameter(__ug.composer.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)}));
  console.log('OUTLINE_PHONE_LOADING',set,JSON.stringify(result));expect(result.stats.state).toBe('ready');expect(result.gpu).toContain('Metal');expect(result.stats.maxTaskMs).toBeLessThanOrEqual(8);
 });
});
