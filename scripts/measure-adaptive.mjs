// Real-GPU heavy/light/heavy recovery with the shipped automatic controller.
// Usage: node scripts/measure-adaptive.mjs <dev-url> <output-dir>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const [origin='http://127.0.0.1:5173', out='/tmp/ug-adaptive'] = process.argv.slice(2);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
const results=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/?fast=1&buildings=baked`);
 await page.waitForFunction(()=>window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal);
 const info=await page.evaluate(()=>{const gl=window.__ug.composer.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return{gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),dpr:devicePixelRatio}});
 for(const [name,mode,target,duration] of [
  ['full-quality','manual',[0,0,0],5000],
  ['automatic-heavy','auto',[0,0,0],20000],
  ['automatic-light','auto',[0,40000,36000],22000],
  ['automatic-heavy-return','auto',[0,0,0],20000],
 ]) {
  await page.evaluate(({mode,target,name})=>{const u=window.__ug;u.camera.position.set(0,20000,18000);u.controls.target.set(...target);u.controls.update();if(u.renderQualityMode!==mode)u.setRenderQualityMode(mode);if(name==='full-quality')u.renderQuality.set({scale:1,samples:4});},{mode,target,name});
  const samples=await page.evaluate(duration=>new Promise(resolve=>{const a=[];let last,start;function f(t){start??=t;if(last)a.push({at:t-start,ms:t-last,...window.__ug.renderQuality.get()});last=t;if(t-start<duration)requestAnimationFrame(f);else resolve(a)}requestAnimationFrame(f)}),duration);
  const tail=samples.filter(s=>s.at>duration-4000),frames=tail.map(s=>s.ms).sort((a,b)=>a-b);
  const transitions=samples.filter((s,i)=>i===0||s.scale!==samples[i-1].scale||s.samples!==samples[i-1].samples);
  const row={name,final:samples.at(-1),tail:{fps:frames.length*1000/frames.reduce((a,b)=>a+b,0),p95:frames[Math.floor(frames.length*.95)],over33:frames.filter(t=>t>33.4).length},transitions};results.push(row);console.log(JSON.stringify(row));
  await page.screenshot({path:`${out}/${name}.png`});
  await writeFile(`${out}/report.json`,JSON.stringify({info,errors,results},null,2));
 }
}finally{await browser.close()}
