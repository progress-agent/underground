import {test,expect} from '@playwright/test';
const phone={viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true};
async function ready(page,url){
 await page.goto(url);
 await page.waitForFunction(()=>{const u=window.__ug,s=u?.bakedStats;return s?.tilesTotal>0&&s.tilesBuilt===s.tilesTotal&&u.groundReady&&u.lateLayers?.settled();},null,{timeout:240000});
}
test('phone frame-time readout shows the five-second median, p95 and Automatic rung',async({browser,baseURL},testInfo)=>{
 const context=await browser.newContext(phone),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await ready(page,baseURL+'/?fast=1&touch=1&fps=1');
 await expect(page.locator('#ug-frame-time')).toContainText(/median \d+\.\d ms/);
 await expect(page.locator('#ug-frame-time')).toContainText(/p95 \d+\.\d ms\s+Auto \d+/);
 const bounds=await page.locator('#ug-frame-time').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThan(430);
 await page.evaluate(()=>{const u=__ug,b=u.llToXZ(51.5133,-.089),g=u.getTerrainMeshSurfaceY(b);u.camera.position.set(b.x,g+1500,b.z+400);u.controls.target.set(b.x,g,b.z);u.controls.update();});
 await page.waitForTimeout(600);await page.screenshot({path:testInfo.outputPath('fps-phone.png')});
 expect(errors).toEqual([]);await context.close();
});
test('phone batching retains authored building storage and the M25 has local bounds',async({browser,baseURL})=>{
 const context=await browser.newContext(phone),page=await context.newPage();
 await ready(page,baseURL+'/?fast=1&touch=1');
 await page.waitForFunction(()=>window.__ug.phoneCityBatches?.stats().remaining===0 && window.__ug.phoneLandmarkBatches?.stats().done);
 const r=await page.evaluate(()=>{
  const u=window.__ug,group=u.scene.getObjectByName('surfaceGeometry'),batches=group.children.filter(m=>m.name.startsWith('phone-city-batch'));
  const tiles=group.children.filter(m=>m.name.startsWith('baked-buildings-'));
  return{readout:!!document.querySelector('#ug-frame-time'),batches:batches.length,aliased:tiles.filter(m=>batches.some(b=>b.instanceMatrix.array.buffer===m.instanceMatrix.array.buffer)).length,
   chunks:u.motorwayGroup.children.filter(m=>m.userData.part==='road').map(m=>{return m.geometry.boundingBox.max.x-m.geometry.boundingBox.min.x;})};
 });
 expect(r.readout).toBe(false);expect(r.aliased).toBeGreaterThan(100);expect(r.chunks.length).toBeGreaterThan(50);expect(Math.max(...r.chunks)).toBeLessThan(2200);await context.close();
});
test('desktop frame readout is opt-in and desktop night keeps full shading',async({page},testInfo)=>{
 await ready(page,'/?fast=1&touch=0&fps=1');await expect(page.locator('#ug-frame-time')).toContainText('p95');
 const r=await page.evaluate(async()=>{const {nightUniforms}=await import('/src/night.js');return{phone:nightUniforms.uNightPhone.value,batches:window.__ug.scene.getObjectByName('surfaceGeometry').children.filter(m=>m.name.startsWith('phone-city-batch')).length}});
 expect(r).toEqual({phone:0,batches:0});
 await page.screenshot({path:testInfo.outputPath('fps-desktop.png')});
});
