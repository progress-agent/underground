import {test,expect} from '@playwright/test';

test('manual quality preserves scene/camera, persists, resizes and restores full quality',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:2});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(()=>window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal);
  const snapshot=()=>page.evaluate(()=>{const u=window.__ug,r=u.composer.renderer;return{quality:u.renderQuality.get(),canvas:[r.domElement.width,r.domElement.height],scene:[u.composer.renderTarget1.width,u.composer.renderTarget1.height],samples:[u.composer.renderTarget1.samples,u.composer.renderTarget2.samples],buildings:u.bakedStats?.buildings ?? 0,position:u.camera.position.toArray()}});
  const before=await snapshot();expect(before.quality).toEqual({scale:1,samples:4,pixelRatio:2});expect(before.buildings).toBeGreaterThan(1000000);
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;const e=document.getElementById('renderScale');e.value='75';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'))});
  await page.selectOption('#edgeQuality','2');
  const reduced=await snapshot();expect(reduced.canvas).toEqual([1500,1050]);expect(reduced.scene).toEqual([1500,1050]);expect(reduced.samples).toEqual([2,0]);expect(reduced.position).toEqual(before.position);expect(reduced.buildings).toBe(before.buildings);
  await page.setViewportSize({width:1200,height:800});
  await expect.poll(async()=> (await snapshot()).scene).toEqual([1800,1200]);
  await page.reload();await page.waitForFunction(()=>window.__ug?.renderQuality);
  expect((await snapshot()).quality).toEqual({scale:.75,samples:2,pixelRatio:1.5});
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;const e=document.getElementById('renderScale');e.value='100';e.dispatchEvent(new Event('change'))});
  await page.selectOption('#edgeQuality','4');
  expect((await snapshot()).canvas).toEqual([2400,1600]);expect((await snapshot()).samples).toEqual([4,0]);
  await page.focus('#renderScale');
  const stationary=await page.evaluate(()=>window.__ug.camera.position.toArray());
  await page.keyboard.press('ArrowLeft');
  expect(await page.locator('#renderScale').inputValue()).toBe('95');
  expect(await page.evaluate(()=>window.__ug.fpsControls.keys.size)).toBe(0);
  expect(await page.evaluate(()=>window.__ug.camera.position.toArray())).toEqual(stationary);
  await page.waitForTimeout(500);expect(errors).toEqual([]);
 }finally{await context.close()}
});
