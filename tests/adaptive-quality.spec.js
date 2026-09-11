import {test,expect} from '@playwright/test';

test('automatic rendering responds to sustained slow frames; manual override freezes quality',async({page})=>{
 await page.addInitScript(()=>{
  const raf=requestAnimationFrame.bind(window);let synthetic;
  window.requestAnimationFrame=fn=>raf(time=>{
   if(fn.name==='tick'&&window.__slowFrameProbe){synthetic??=time;synthetic+=35;fn(synthetic)}else fn(time);
  });
 });
 await page.goto('/?fast=1&buildings=baked');
 await page.waitForFunction(()=>window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal);
 expect(await page.locator('#renderMode').inputValue()).toBe('auto');
 await expect(page.locator('#renderScale')).toBeDisabled();
 const buildings=await page.evaluate(()=>window.__ug.bakedStats.buildings);
 await page.evaluate(()=>{window.__slowFrameProbe=true});
 await page.waitForFunction(()=>window.__ug.renderQuality.get().scale<1);
 await page.evaluate(()=>{document.getElementById('hudDetails').open=true});
 await page.selectOption('#renderMode','manual');
 await expect(page.locator('#renderScale')).toBeEnabled();
 const fixed=await page.evaluate(()=>window.__ug.renderQuality.get());
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>window.__ug.renderQuality.get())).toEqual(fixed);
 expect(await page.evaluate(()=>window.__ug.bakedStats.buildings)).toBe(buildings);
});
