import {test,expect,devices} from '@playwright/test';
const {defaultBrowserType,...phone}=devices['iPhone 15 Pro'];
const ready=page=>page.waitForFunction(()=>window.__ug?.groundReady&&window.__ug?.lateLayers?.settled(),null,{timeout:180000});

test.describe('lossless phone ground',()=>{
 test.use(phone);
 for(const forced of [null,0])test(`coarse pointer${forced===0?' forced desktop':''} selects only the matching channel layout`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`/?fast=1&buildings=baked${forced===0?'&touch=0':''}`);await ready(page);
  const result=await page.evaluate(()=>{const u=window.__ug,s=u.surfaceTexState;return {touch:document.documentElement.classList.contains('ug-touch'),size:s.size,channels:s.channels,bytes:s.pixels.byteLength,format:s.texture.format,expected:document.documentElement.classList.contains('ug-touch')?window.__ugTHREE.RGFormat:window.__ugTHREE.RGBAFormat};});
  const compact=forced!==0;expect(result.touch).toBe(compact);expect(result.size).toBe(4096);expect(result.channels).toBe(compact?2:4);expect(result.bytes).toBe(compact?33554432:67108864);expect(result.format).toBe(result.expected);
  // Compile and draw all consumers, including night and the park underside.
  await page.evaluate(()=>{const u=window.__ug;window.__ugSun.setHour(23,{persist:false});u.camera.position.set(-2900,-100,-40);u.controls.target.set(-2900,-100,500);u.controls.update();});
  await page.waitForTimeout(800);expect(errors).toEqual([]);
 });
 test('failed baked request keeps phone RG layout and paints nonempty live masks',async({page})=>{
  await page.route('**/surface/baked/ground.bin',r=>r.fulfill({status:404,body:'missing'}));
  await page.goto('/?fast=1&touch=1&buildings=baked');
  await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ug.groundPath==='live'&&window.__ug.surfaceLoaderStats.loaded>2);
  const s=await page.evaluate(()=>{const s=window.__ug.surfaceTexState;let road=0,green=0;for(let i=0;i<s.pixels.length;i+=2){road+=s.pixels[i];green+=s.pixels[i+1];}return {channels:s.channels,road,green};});
  expect(s.channels).toBe(2);expect(s.road).toBeGreaterThan(0);expect(s.green).toBeGreaterThan(0);
 });
});
