import {test,expect,devices} from '@playwright/test';
async function boot(page){await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ugSun,{},{timeout:90000});await page.evaluate(()=>{document.getElementById('hudDetails').open=true;});}
const point=async(page,h)=>{const r=await page.locator('#sunTime').boundingBox(),a=(h-12)*Math.PI/12;return{x:r.x+r.width/2+57*Math.sin(a),y:r.y+r.height/2-57*Math.cos(a)}};
test('circular clock mouse, keyboard, persistence and legacy migration',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('ug:prefs:v2',JSON.stringify({sunTime:.25})));
 await boot(page);expect(await page.evaluate(()=>window.__ugSun.hour)).toBe(9);
 await page.evaluate(()=>localStorage.removeItem('ug:prefs:v2')); // init script is removed below by a fresh context in persistence tests
 for(const h of [12,18,23.8,.2,6]){const p=await point(page,h);await page.mouse.click(p.x,p.y);expect(await page.evaluate(()=>window.__ugSun.hour)).toBeCloseTo(h,1);}
 for(const hours of [[23,23.8,.2,1],[1,.2,23.8,23]]){
   const start=await point(page,hours[0]);await page.mouse.move(start.x,start.y);await page.mouse.down();
   for(const h of hours.slice(1)){const q=await point(page,h);await page.mouse.move(q.x,q.y);expect(await page.evaluate(()=>window.__ugSun.hour)).toBeCloseTo(h,1);}
   await page.mouse.up();
 }
 await page.locator('#sunTime').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowLeft');expect(await page.evaluate(()=>window.__ugSun.hour)).toBeCloseTo(24-1/6,5);
 const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('ug:prefs:v2')));expect(prefs.clockHour).toBeCloseTo(24-1/6,5);
 await expect(page.locator('#sunTime')).toHaveAttribute('aria-valuetext','23:50');
 const mode=await page.evaluate(()=>window.__ug.modes.activeId);
 for(const key of ['w','2','Space','v','t'])await page.keyboard.press(key);
 expect(await page.evaluate(()=>window.__ug.modes.activeId)).toBe(mode);
 await page.keyboard.press('End');await expect(page.locator('#sunTime')).toHaveAttribute('aria-valuetext','23:59');
 expect(await page.evaluate(()=>[...window.__ug.fpsControls.keys])).toEqual([]);
});
test('saved night restores; lit material only in the air, moon has no shadows',async({page})=>{
 await boot(page);await page.evaluate(()=>{window.__ugSun.setHour(23);window.__ug.camera.position.set(2952.9,337.8,-732.9);window.__ug.controls.target.set(1910.1,196.2,-783.7);window.__ug.controls.update();});
 await expect.poll(()=>page.evaluate(()=>window.__ug.scene.getObjectByName('surfaceGeometry')?.children.filter(x=>x.name.startsWith('baked-buildings-')).some(x=>x.material.name==='night-buildings'))).toBe(true);
 expect(await page.evaluate(()=>window.__ugSun.status.active)).toBe(false);
 expect(await page.evaluate(()=>document.body.classList.contains('ug-night'))).toBe(true);
 expect(await page.evaluate(()=>{const e=[...document.querySelectorAll('.station-label-surface')].find(e=>!e.style.color),s=getComputedStyle(e);return[s.color,s.webkitTextStrokeWidth]})).toEqual(['rgb(255, 255, 255)','1px']);
 await page.reload();await page.waitForFunction(()=>!!window.__ugSun);expect(await page.evaluate(()=>window.__ugSun.hour)).toBe(23);
 await page.waitForFunction(()=>window.__ug?.groundReady);
 await page.evaluate(()=>{window.__ug.camera.position.set(0,-100,0);window.__ug.controls.target.set(0,-100,500);window.__ug.controls.update();});
 await expect.poll(()=>page.evaluate(()=>window.__ugSun.status.airWeight)).toBe(0);
 expect(await page.evaluate(()=>document.body.classList.contains('ug-night'))).toBe(false);
});
test.describe('phone menu clock',()=>{
 const {defaultBrowserType,...phone}=devices['iPhone 15 Pro'];test.use(phone);
 test('touch drag crosses midnight in either direction without moving the camera',async({page,context})=>{
 await boot(page);await page.locator('#sunTime').scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>window.__ug.camera.position.toArray());
 const c=await context.newCDPSession(page),touch=(type,pts)=>c.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(p=>({...p,id:4}))});
 for(const hours of [[23,23.8,.2,1],[1,.2,23.8,23]]){
   await touch('touchStart',[await point(page,hours[0])]);for(const h of hours.slice(1))await touch('touchMove',[await point(page,h)]);await touch('touchEnd',[]);
   expect(await page.evaluate(()=>window.__ugSun.hour)).toBeCloseTo(hours.at(-1),1);
 }
 expect(await page.evaluate(()=>[...window.__ug.fpsControls.keys])).toEqual([]);
 const after=await page.evaluate(()=>window.__ug.camera.position.toArray());
 expect(Math.hypot(...after.map((v,i)=>v-before[i]))).toBeLessThan(.0001);
 });
});
