import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test('C1: actual four bank buffers meet surveyed rises; baked neighbours follow the runtime terrain',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.deepWater&&window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal,null,{timeout:180000});
 const r=await page.evaluate(()=>{const u=window.__ug;u.masterHeight.setValue(1);u.structureMorph.flush();
 return u.deepWater.bodies.filter(b=>/William Girling|Staines|Bessborough/.test(b.spec.name)).map(b=>{
 const p=b.bankMesh.geometry.attributes.position;let min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++){min=Math.min(min,p.getY(i)/5);max=Math.max(max,p.getY(i)/5)}
 let boxes=0,worst=0;u.scene.traverse(o=>{if(!o.isInstancedMesh||!o.name.startsWith('baked-buildings-'))return;const m=o.instanceMatrix.array;for(let i=0;i<o.count;i++){const x=m[i*16+12],z=m[i*16+14];if(x<b.bounds.minX-100||x>b.bounds.maxX+100||z<b.bounds.minZ-100||z>b.bounds.maxZ+100)continue;boxes++;worst=Math.max(worst,Math.abs(m[i*16+13]-Math.max(u.getTerrainMeshSurfaceY({x,z}),u.deepWater.groundAt(x,z)??-Infinity))/5);}});
 return{name:b.spec.name,rise:max-min,expected:b.spec.bank.heightM,crest:max,expectedCrest:b.spec.bank.crestAodM,boxes,worst};});});
 await writeFile(test.info().outputPath('banks-and-boxes.json'),JSON.stringify(r,null,2));
 for(const b of r){expect(Math.abs(b.rise-b.expected),b.name).toBeLessThan(.5);expect(b.crest,b.name).toBeCloseTo(b.expectedCrest,4);expect(b.worst,b.name).toBeLessThan(.06);}
});
test('C3: every real vent uses opaque, non-emissive cast metal, with true structure scales',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.tidewayPlatforms,null,{timeout:180000});
 const rows=await page.evaluate(()=>{const u=window.__ug,out=[];for(const m of [1,1.1,10]){u.masterHeight.setValue(m);u.structureMorph.flush();u.tidewayPlatforms.traverse(o=>{if(!o.isMesh||!o.name.startsWith('tideway-vent'))return;out.push({name:o.name,material:o.material.name,emissive:o.material.emissive.getHex(),opaque:!o.material.transparent,scale:o.parent.scale.y*m/5});});}return out;});
 expect(rows.length).toBe(27);for(const r of rows){expect(r.material).toBe('tideway-cast-metal');expect(r.emissive).toBe(0);expect(r.opaque).toBe(true);expect(r.scale).toBeCloseTo(1,6);}
});
test('C2: Wapping is hidden behind Chambers vents and visible in its ordinary street view',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.tidewayPlatforms&&window.__ug?.stationBuildings,null,{timeout:180000});
 await page.evaluate(()=>{const u=window.__ug;u.controls.enableDamping=false;u.masterHeight.setValue(1);u.structureMorph.flush();u.sim.paused=true;});
 const label=page.locator('.station-label-surface').filter({hasText:/^Wapping$/});
 // Derived from the real Chambers column and Wapping station anchors. The
 // paired live capture at this exact pose shows Wapping across the casting.
 await page.evaluate(()=>{const u=window.__ug;u.camera.position.set(4354.305312745784,35.0164191904838,637.4135590929766);u.controls.target.set(4372.574283533264,35.75,625.156124354573);u.controls.update();});
 await expect(label).toBeHidden();
 await page.evaluate(()=>{const u=window.__ug;u.camera.position.set(4955.17,80.75,257.43);u.controls.target.set(4995.17,60.75,207.43);u.controls.update();});
 await expect(label).toBeVisible();
});
test('C1: live and baked boxes arriving after the banks stand on their actual grass triangles',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.deepWater?.buildingAnchors,null,{timeout:180000});
 const rows=await page.evaluate(async()=>{
  const loaded=name=>performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/'+name)?.name??'/src/'+name;
  const u=window.__ug,{createTileBuildings}=await import(loaded('surface-geometry.js')),{buildBakedTile}=await import(loaded('baked-buildings.js')),out=[];
  for(const a of u.deepWater.buildingAnchors.filter(a=>a.after-a.before>.5)){
   const ground=Math.max(u.getTerrainMeshSurfaceY(a),u.deepWater.groundAt(a.x,a.z)??-Infinity);
   const live=createTileBuildings([{cx:a.x,cz:a.z,height:4,area:16}],u.getTerrainMeshSurfaceY,5);
   const view=new DataView(new ArrayBuffer(10));view.setUint16(4,40,true);view.setUint16(6,40,true);view.setInt16(8,Math.round(u.getTerrainMeshSurfaceY(a)*2),true);
   const baked=buildBakedTile({view,tiles:[{minX:a.x,minZ:a.z,offset:0,count:1}],reservoirFeetVersion:1},0,5,live.material);
   out.push({x:a.x,z:a.z,before:a.before,after:a.after,ground,live:live.instanceMatrix.array[13],baked:baked.instanceMatrix.array[13]});
   live.geometry.dispose();live.dispose();baked.dispose();
  }return out;
 });
 await writeFile(test.info().outputPath('bank-building-arrivals.json'),JSON.stringify(rows,null,2));
 expect(rows.length).toBeGreaterThanOrEqual(2);
 expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({x:-25177,z:6183}),expect.objectContaining({x:-18233,z:12118})]));for(const r of rows){expect(r.after).toBeGreaterThan(r.before);expect(Math.abs(r.after-r.ground)).toBeLessThan(.001);expect(Math.abs(r.live-r.ground)).toBeLessThan(.001);expect(Math.abs(r.baked-r.ground)).toBeLessThan(.001);}
});
