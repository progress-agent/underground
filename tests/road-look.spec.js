import {test,expect,devices} from '@playwright/test';
test.setTimeout(240000);
test('default Plain look switches to Painted lines and back without new road programs',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/?fast=1&buildings=baked');
 await page.waitForFunction(()=>window.__ug?.roads.stats.state==='ready'&&__ug.lateLayers.settled(),null,{timeout:180000});
 await expect(page.locator('#roadLook')).toHaveValue('2');
 const before=await page.evaluate(()=>({look:__ug.roads.look,programs:__ug.composer.renderer.info.programs.length,materials:[__ug.roads.material.uuid,__ug.roads.bridgeMaterial.uuid]}));
 await page.selectOption('#roadLook','3');await page.waitForTimeout(200);
 expect(await page.evaluate(()=>__ug.roads.look)).toBe(3);
 const after=await page.evaluate(()=>({programs:__ug.composer.renderer.info.programs.length,materials:[__ug.roads.material.uuid,__ug.roads.bridgeMaterial.uuid]}));
 expect(after.programs).toBe(before.programs);expect(after.materials).toEqual(before.materials);
 await page.selectOption('#roadLook','2');expect(await page.evaluate(()=>__ug.roads.look)).toBe(2);expect(errors).toEqual([]);
});
test('URL selects Painted lines and Roads off restores the unchanged raster weight',async({page})=>{
 await page.goto('/?fast=1&roadlook=3&roads=0');await page.waitForFunction(()=>window.__ug?.groundReady);
 await expect(page.locator('#roadLook')).toHaveValue('3');expect(await page.evaluate(()=>__ug.roads.look)).toBe(3);
 expect(await page.evaluate(async()=>{const m=await import('/src/road-style.js');return m.roadRasterWeight.value;})).toBe(1);
 await page.evaluate(()=>document.getElementById('roadsVisible').click());
 await page.waitForFunction(()=>__ug.roads.stats.state==='ready',null,{timeout:180000});
 expect(await page.evaluate(async()=>{const m=await import('/src/road-style.js');return m.roadRasterWeight.value;})).toBe(0);
});
test('phone keeps minor roads at 150m and 300m and releases them above the bounded tier',async({browser})=>{
 const d=devices['iPhone 15 Pro Max'];const page=await browser.newPage({viewport:d.viewport,deviceScaleFactor:d.deviceScaleFactor,isMobile:true,hasTouch:true});
 try{
  await page.goto('/?touch=1&fast=1');await page.waitForFunction(()=>window.__ug?.roads.stats.state==='ready',null,{timeout:180000});
  for(const altitude of [150,300,600]){
   await page.evaluate(alt=>{const u=__ug,x=1107,z=-3634,g=u.getTerrainMeshSurfaceY({x,z})??0;u.masterHeight.setValue(1.1);u.structureMorph.flush();u.camera.position.set(x,g+alt*5/1.1,z);u.controls.target.set(x,g,z-1);u.controls.update();},altitude);
   await page.waitForTimeout(250);await page.waitForFunction(()=>__ug.roads.stats.state==='ready',null,{timeout:180000});
   const near=await page.evaluate(()=>__ug.roads.group.children.filter(m=>m.name.includes(':near-')).length);
   if(altitude<=300)expect(near).toBeGreaterThan(0);else expect(near).toBe(0);
  }
 }finally{await page.close();}
});
