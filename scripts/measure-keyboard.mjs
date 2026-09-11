// Compare real keyboard flight on two dev builds, in ABBA order on one GPU.
// Usage: node scripts/measure-keyboard.mjs <before-url> <after-url> <output-dir>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const [before, after, out] = process.argv.slice(2);
if (!before || !after || !out) throw new Error('Expected before URL, after URL and output directory');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const results = [];
function stats(a) {
  a = [...a].sort((a,b) => a-b);
  const q = p => +a[Math.min(a.length-1, Math.floor(a.length*p))].toFixed(3);
  return { n:a.length, p50:q(.5), p95:q(.95), p99:q(.99), max:q(1) };
}
try {
  for (const [index, version] of ['before','after','after','before'].entries()) {
    const context = await browser.newContext({ viewport: { width:1440, height:900 }, deviceScaleFactor:2 });
    const page = await context.newPage();
    const errors = [];page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${version==='before'?before:after}/?fast=1&buildings=baked`);
    await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal, null, {timeout:120000});
    const info = await page.evaluate(() => {
      const {composer,bloomPass} = window.__ug, r=composer.renderer, gl=r.getContext();
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown', canvas:[r.domElement.width,r.domElement.height], scene:[composer.renderTarget1.width,composer.renderTarget1.height], bloom:[bloomPass.renderTargetBright.width,bloomPass.renderTargetBright.height]};
    });
    const routes = {};
    for (const [name, position, target, keys] of [
      ['street',[0,900,800],[1000,850,800],['KeyW','ArrowLeft']],
      ['overview',[0,12000,12000],[0,0,0],['KeyW','ArrowLeft']],
      ['steadyChalk',[0,-5000,0],[1000,-5000,0],['KeyW']],
    ]) {
      await page.evaluate(({position,target}) => {const u=window.__ug;u.camera.position.set(...position);u.controls.target.set(...target);u.controls.update();}, {position,target});
      await page.waitForTimeout(1200);
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(600); // exclude initial audio start and control handover
      const samples = await page.evaluate(() => new Promise(resolve => {
        const samples=[];let last, position, start;
        function frame(t) {
          const p=window.__ug.camera.position;
          start ??= t;
          if(last!==undefined) samples.push({ms:t-last, speed:p.distanceTo(position)*1000/(t-last)});
          last=t;position=p.clone();
          if(t-start<6000)requestAnimationFrame(frame);else resolve(samples);
        }requestAnimationFrame(frame);
      }));
      for (const key of keys) await page.keyboard.up(key);
      routes[name]={frames:stats(samples.map(s=>s.ms)),over33:samples.filter(s=>s.ms>33.4).length,over50:samples.filter(s=>s.ms>50).length};
      if(name==='steadyChalk')routes[name].speedErrorPercent=stats(samples.filter(s=>s.ms<50).map(s=>Math.abs(s.speed-250)/2.5));
    }
    await page.screenshot({path:`${out}/${index}-${version}.png`});
    const row={index,version,info,routes,errors};results.push(row);console.log(JSON.stringify(row));
    await writeFile(`${out}/report.json`,JSON.stringify({at:new Date().toISOString(),before,after,results},null,2));
    await context.close();
  }
} finally {await browser.close();}
