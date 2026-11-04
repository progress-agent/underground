import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const [origin,out]=process.argv.slice(2);await mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const errors=[];p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await p.addInitScript(()=>{
 const raf=window.requestAnimationFrame.bind(window),held=[];let ts=1000;
 window.requestAnimationFrame=cb=>{if(window.hold&&cb.name==='tick'){held.push(cb);return 0}return raf(()=>cb(ts))};
 window.step=n=>{for(let i=0;i<n;i++){const cb=held.shift();if(cb)cb(ts)}};
});
await p.goto(`${origin}/?fast=1&buildings=baked`);
await p.waitForFunction(()=>window.__ug?.lateLayers?.settled()&&window.__ug.groundReady&&window.__ug.bakedStats?.tilesBuilt===window.__ug.bakedStats?.tilesTotal,{},{timeout:180000});
await p.evaluate(()=>{window.__ug.setRenderQualityMode('manual');window.__ug.renderQuality.set({scale:1,samples:4});window.__ug.controls.enableDamping=false;window.hold=true;});await p.waitForTimeout(300);
const below=await p.evaluate(()=>{
 const u=window.__ug,gl=u.composer.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;
 const grab=hour=>{window.__ugSun.setHour(hour,{persist:false});window.step(4);const a=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,a);return a};
 const diff=(a,b)=>{let count=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(j=>Math.abs(a[i+j]-b[i+j])));if(d){count++;max=Math.max(max,d)}}return{count,max,pct:count/(W*H)*100}};
 const result=[];
 for(const [name,p,t]of [['clay',[0,-100,0],[0,-100,500]],['chalk',[0,-330,0],[0,-330,500]],['tunnel',[-6000,-60,3000],[-6000,-60,3500]],['river',[8447,0,2136],[7156,0,635]]]){
  u.camera.position.fromArray(p);u.controls.target.fromArray(t);u.controls.update();const day=grab(12),night=grab(23),day2=grab(12),night2=grab(23);
  result.push({name,dayNight:diff(day,night),noise:diff(day,day2),nightNoise:diff(night,night2),air:window.__ugSun.status.airWeight});
 }return result;
});
const flicker=await p.evaluate(()=>{
 const u=window.__ug,T=window.__ugTHREE,gl=u.composer.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;
 window.__ugSun.setHour(12,{persist:false});u.camera.position.set(0,20000,18000);u.controls.target.set(0,0,0);u.controls.update();
 const top=u.scene.getObjectByName('terrainMesh'),textures=[top.material.map,top.material.normalMap,top.material.roughnessMap,top.material.userData.surfaceTex].filter(Boolean);
 const samplers=textures.map(t=>({name:t.name,width:t.image?.width,height:t.image?.height,minFilter:t.minFilter,generateMipmaps:t.generateMipmaps}));
 const grab=()=>{window.step(4);const a=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,a);return a};
 const diff=(a,b)=>{let count=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(j=>Math.abs(a[i+j]-b[i+j])));if(d){count++;max=Math.max(max,d)}}return{count,max,pct:count/(W*H)*100}};
 const base=grab(),noise=grab(),saved=textures.map(t=>[t,t.minFilter,t.generateMipmaps]);
 // Temporary diagnostic only. Restore every sampler before leaving the page.
 for(const t of textures){t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.needsUpdate=true;}
 const candidate=grab();for(const [t,min,gen]of saved){t.minFilter=min;t.generateMipmaps=gen;t.needsUpdate=true;}const restored=grab();
 return{near:u.camera.near,far:u.camera.far,samplers,candidateDifference:diff(base,candidate),noise:diff(base,noise),restored:diff(base,restored)};
});
await writeFile(`${out}/audit.json`,JSON.stringify({below,flicker,errors},null,2));console.log(JSON.stringify({below,flicker,errors},null,2));await b.close();
