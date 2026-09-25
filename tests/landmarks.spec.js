import { test, expect } from '@playwright/test';
import { LANDMARKS } from '../scripts/landmarks.mjs';

async function ready(page) {
  await page.goto('/?buildings=baked&skip=1');
  await page.waitForFunction(() => window.__ug?.landmarkGroup?.parent && window.__ug.bakedStats?.tilesBuilt === window.__ug.bakedStats?.tilesTotal);
}

test('eleven complete sites have finite geometry grounded independently, and scale about their bases', async ({ page }) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  const before=await page.evaluate(()=>{
    const u=window.__ug, sites=[];
    for(const s of u.landmarkGroup.children) {
      let meshes=0,finite=true,grounded=true;
      s.traverse(o=>{if(o.isMesh){meshes++;for(const a of Object.values(o.geometry.attributes))finite &&= a.array.every(Number.isFinite);}});
      for(const a of s.children)grounded &&= Math.abs(a.position.y-u.getTerrainMeshSurfaceY({x:a.position.x,z:a.position.z}))<.001;
      sites.push({id:s.userData.site,meshes,finite,grounded});
    }
    document.getElementById('hudDetails').open=true;
    return {sites,bases:u.landmarkGroup.children.flatMap(s=>s.children.map(a=>a.position.y))};
  });
  expect(before.sites.map(s=>s.id)).toEqual(LANDMARKS.map(s=>s.id));
  for(const s of before.sites){expect(s.meshes).toBeGreaterThan(0);expect(s.finite).toBe(true);expect(s.grounded).toBe(true);}
  // D-039 (sprint 25Sep26f): the Structure slider is gone. Landmarks follow
  // Master instead, at true proportions: anchor scale.y = VE / Master, so at
  // Master 5 (the old "Structure 1") every anchor is 1 and its base is unmoved.
  await page.evaluate(()=>{const el=document.getElementById('masterHeight');el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));window.__ug.structureMorph.flush();});
  const after=await page.evaluate(()=>({bases:window.__ug.landmarkGroup.children.flatMap(s=>s.children.map(a=>a.position.y)),scales:window.__ug.landmarkGroup.children.flatMap(s=>s.children.map(a=>a.scale.y))}));
  expect(after.bases).toEqual(before.bases);expect(after.scales.every(s=>Math.abs(s-1)<1e-12)).toBe(true);
  const details=await page.evaluate(()=>{
    const u=window.__ug,T=window.__ugTHREE;
    const proxies=u.landmarkGroup.getObjectByName('landmark-site-westminster').children.filter(c=>c.userData.sourceHeight===96);
    const pitches=['wembley','london-stadium'].map(id=>{
      const a=u.landmarkGroup.getObjectByName(`landmark-site-${id}`).children.find(c=>c.userData.primary);
      const mesh=a.getObjectByName('landmark-pitch');const box=new T.Box3().setFromObject(mesh);
      let maxTerrain=-Infinity;
      for(let x=box.min.x;x<=box.max.x;x+=8)for(let z=box.min.z;z<=box.max.z;z+=8)maxTerrain=Math.max(maxTerrain,u.getTerrainMeshSurfaceY({x,z}));
      return box.min.y>maxTerrain;
    });
    return {proxies:proxies.length,pitches};
  });
  expect(details.proxies).toBe(0);expect(details.pitches).toEqual([true,true]);
  expect(errors).toEqual([]);
});

test('live/baked toggle detaches and restores one set of landmarks',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{window.__landmarkUUID=window.__ug.landmarkGroup.uuid;window.__ug.setBuildingsPath('live');});
  expect(await page.evaluate(()=>window.__ug.landmarkGroup.parent===null)).toBe(true);
  await page.evaluate(()=>window.__ug.setBuildingsPath('baked'));
  await expect.poll(()=>page.evaluate(()=>window.__ug.surfaceGeometryGroup.children.filter(c=>c.name==='landmarks').length)).toBe(1);
  expect(await page.evaluate(()=>window.__landmarkUUID===window.__ug.landmarkGroup.uuid)).toBe(true);
});

test('missing landmark side-file falls back to live buildings with no bald baked city',async({page})=>{
  await page.route('**/baked/landmark-footprints.json',r=>r.fulfill({status:200,contentType:'text/html',body:'<html>SPA fallback</html>'}));
  await page.goto('/?buildings=baked&skip=1');
  await page.waitForFunction(()=>window.__ug?.groundReady && window.__ug.buildingsPath==='live');
  await expect(page.locator('#bakedBuildings')).toHaveAttribute('aria-pressed','false');
  await page.waitForFunction(()=>window.__ug.surfaceGeometryGroup.children.some(c=>c.name.startsWith('buildings-')));
  expect(await page.evaluate(()=>window.__ug.landmarkGroup)).toBe(null);
});
