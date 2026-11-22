import {test,expect} from '@playwright/test';
test.describe.configure({mode:'serial'});
test.setTimeout(240000);
let page,errors=[];
test.beforeAll(async({browser})=>{
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(()=>window.__ug?.roads.stats.state==='ready',null,{timeout:180000});
});
test.afterAll(async()=>page?.close());
test('all desktop blocks load, obey the vertex cap, carry pavement coordinates and compile without errors',async()=>{
  const s=await page.evaluate(()=>{const r=window.__ug.roads;return{...r.stats,meshes:r.group.children.length,layouts:r.group.children.map(m=>({name:m.name,vertices:m.geometry.attributes.position.count,indexBytes:m.geometry.index.array.BYTES_PER_ELEMENT})),front:r.material.side,emissive:r.material.emissive.getHex()};});
  expect(s.errors).toEqual([]);expect(errors).toEqual([]);expect(s.meshes).toBeGreaterThan(0);expect(s.meshes).toBe(await page.evaluate(()=>window.__ug.roads.coverage().wanted.length));for(const m of s.layouts){expect([2,4]).toContain(m.indexBytes);if(m.indexBytes===4){expect(m.name).toContain('-far-');expect(m.vertices).toBeLessThanOrEqual(4000000);}else expect(m.vertices).toBeLessThanOrEqual(65000);}
  // Live holds66.11829MB of road buffers. The lane's actual desktop GPU ceiling
  // is live+40MB; canonical GPU allocation measurements remain the budget gate.
  expect(s.bytes).toBeLessThan(106e6);expect(s.front).toBe(0);expect(s.emissive).toBe(0);
});
test('every road is hidden from a camera below Bank and restored above it',async()=>{
  await page.evaluate(()=>{const u=window.__ug;u.camera.position.set(2744,u.getTerrainMeshSurfaceY({x:2744,z:-761})-48*5,-761);u.controls.target.set(2744,500,-762);u.controls.update();});
  await expect.poll(()=>page.evaluate(()=>window.__ug.roads.group.visible)).toBe(false);
  await page.evaluate(()=>{const u=window.__ug;u.camera.position.y+=50*5;u.controls.target.y+=50*5;u.controls.update();});
  await expect.poll(()=>page.evaluate(()=>window.__ug.roads.group.visible)).toBe(true);
});
test('HUD off disposes all buffers and on reloads every road',async()=>{
  await page.evaluate(()=>document.getElementById('roadsVisible').click());
  expect(await page.evaluate(()=>({visible:window.__ug.roads.group.visible,bytes:window.__ug.roads.stats.bytes}))).toEqual({visible:false,bytes:0});
  await page.evaluate(()=>document.getElementById('roadsVisible').click());
  await page.waitForFunction(()=>window.__ug.roads.stats.state==='ready'&&window.__ug.roads.stats.bytes>0,null,{timeout:180000});
  expect(errors).toEqual([]);
});
test('URL off never fetches road assets',async()=>{
  const requests=[];const handler=r=>{if(r.url().includes('/data/roads/'))requests.push(r.url());};page.on('request',handler);
  await page.goto('/?fast=1&roads=0&buildings=baked');await page.waitForFunction(()=>window.__ug?.groundReady);await page.waitForTimeout(3000);
  expect(await page.evaluate(()=>window.__ug.roads.enabled)).toBe(false);expect(requests).toEqual([]);page.off('request',handler);
});
