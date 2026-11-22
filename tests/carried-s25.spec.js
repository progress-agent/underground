import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Independent UGB1 companion supplies the unchanged source centres. The runtime
// keeps only a sparse identity map, so it cannot prove every old vertical datum.
async function originalCentres(page) {
 const result=await page.evaluate(async()=>{
  const u=window.__ug,wanted=new Set(),key=(x,z)=>`${Math.fround(x)},${Math.fround(z)}`;
  const banks=u.deepWater.bodies.filter(b=>/William Girling|Staines|Bessborough/.test(b.spec.name));
  u.scene.traverse(o=>{if(!o.isInstancedMesh||!o.name.startsWith('baked-buildings-'))return;
   const m=o.instanceMatrix.array;for(let i=0;i<o.count;i++){const x=m[i*16+12],z=m[i*16+14];if(banks.some(b=>x>=b.bounds.minX-100&&x<=b.bounds.maxX+100&&z>=b.bounds.minZ-100&&z<=b.bounds.maxZ+100))wanted.add(key(x,z));}});
  const current=new DataView(await(await fetch('/data/surface/baked/buildings.bin')).arrayBuffer());
  const version=current.getUint16(4,true),stride=version===1?10:14;
  const original=version===1?current:new DataView(await(await fetch('/data/surface/baked/buildings-square.bin')).arrayBuffer());
  if(original.getUint16(4,true)!==1||original.getUint16(6,true)!==current.getUint16(6,true))throw Error('UGB1 source companion mismatch');
  const found=new Map(),ambiguous=[];
  for(let t=0;t<current.getUint16(6,true);t++){
   const d=12+t*16,x=current.getInt32(d,true),z=current.getInt32(d+4,true),offset=current.getUint32(d+8,true),n=current.getUint32(d+12,true);
   const sx=original.getInt32(d,true),sz=original.getInt32(d+4,true),sourceOffset=original.getUint32(d+8,true);
   if(n!==original.getUint32(d+12,true))throw Error('source record count mismatch');
   for(let i=0;i<n;i++){const o=offset+stride*i,k=key(x+current.getUint16(o,true)*.1,z+current.getUint16(o+2,true)*.1);if(!wanted.has(k))continue;
    const q=sourceOffset+10*i,centre=[Math.fround(sx+original.getUint16(q,true)*.1),Math.fround(sz+original.getUint16(q+2,true)*.1)],previous=found.get(k);
    if(previous&&(previous[0]!==centre[0]||previous[1]!==centre[1]))ambiguous.push(k);found.set(k,centre);
   }
  }
  return {entries:[...found],wanted:wanted.size,ambiguous};
 });
 expect(result.entries.length).toBe(result.wanted);expect(result.ambiguous).toEqual([]);return result.entries;
}

test('C1: actual four bank buffers meet surveyed rises; baked neighbours follow the runtime terrain',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.deepWater&&window.__ug?.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal,null,{timeout:180000});
 const centres=await originalCentres(page);
 const r=await page.evaluate(entries=>{const identities=new Map(entries),key=(x,z)=>`${Math.fround(x)},${Math.fround(z)}`;const u=window.__ug;u.masterHeight.setValue(1);u.structureMorph.flush();
 return u.deepWater.bodies.filter(b=>/William Girling|Staines|Bessborough/.test(b.spec.name)).map(b=>{
 const p=b.bankMesh.geometry.attributes.position;let min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++){min=Math.min(min,p.getY(i)/5);max=Math.max(max,p.getY(i)/5)}
 let boxes=0,worst=0;u.scene.traverse(o=>{if(!o.isInstancedMesh||!o.name.startsWith('baked-buildings-'))return;const m=o.instanceMatrix.array;for(let i=0;i<o.count;i++){const x=m[i*16+12],z=m[i*16+14];if(x<b.bounds.minX-100||x>b.bounds.maxX+100||z<b.bounds.minZ-100||z>b.bounds.maxZ+100)continue;boxes++;const [sx,sz]=identities.get(key(x,z));worst=Math.max(worst,Math.abs(m[i*16+13]-Math.max(u.getTerrainMeshSurfaceY({x:sx,z:sz}),u.deepWater.groundAt(sx,sz)??-Infinity))/5);}});
 return{name:b.spec.name,rise:max-min,expected:b.spec.bank.heightM,crest:max,expectedCrest:b.spec.bank.crestAodM,boxes,worst};});},centres);
 await writeFile(test.info().outputPath('banks-and-boxes.json'),JSON.stringify(r,null,2));
 for(const b of r){expect(Math.abs(b.rise-b.expected),b.name).toBeLessThan(.5);expect(b.crest,b.name).toBeCloseTo(b.expectedCrest,4);expect(b.worst,b.name).toBeLessThan(.06);}
});
test('C3: every real vent uses opaque, non-emissive cast metal, with true structure scales',async({page})=>{
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.tidewayPlatforms,null,{timeout:180000});
 const result=await page.evaluate(()=>{const u=window.__ug,rows=[],meshes=new Set([...u.tidewayPlatforms.userData.registry.values()].flatMap(r=>r.columns.map(c=>c.mesh??r.detail)));
  for(const m of [1,1.1,10]){u.masterHeight.setValue(m);u.structureMorph.flush();for(const o of meshes)rows.push({name:o.name,finish:o.material.userData.ventFinish,mask:o.geometry.attributes.tidewayVent.array.some(v=>v===255),emissive:o.material.emissive.getHex(),opaque:!o.material.transparent,scale:o.parent.scale.y*m/5});}
  const renderer=u.composer.renderer,gl=renderer.getContext();renderer.compile(u.scene,u.camera);const uniforms=new Set();
  for(const p of renderer.info.programs)for(let i=0;i<gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS);i++)uniforms.add(gl.getActiveUniform(p.program,i).name);
  return{rows,uniforms:[...uniforms]};});
 expect(result.rows.length).toBe(27);for(const r of result.rows){expect(r.finish).toEqual({roughness:.58,metalness:.35});expect(r.mask).toBe(true);expect(r.emissive).toBe(0);expect(r.opaque).toBe(true);expect(r.scale).toBeCloseTo(1,6);}
 expect(result.uniforms).toEqual(expect.arrayContaining(['uTidewayVentRoughness','uTidewayVentMetalness']));
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
 const centres=await originalCentres(page);
 const rows=await page.evaluate(async entries=>{
  const identities=new Map(entries),key=(x,z)=>`${Math.fround(x)},${Math.fround(z)}`;
  const loaded=name=>performance.getEntriesByType('resource').find(r=>new URL(r.name).pathname==='/src/'+name)?.name??'/src/'+name;
  const u=window.__ug,{createTileBuildings}=await import(loaded('surface-geometry.js')),{buildBakedTile}=await import(loaded('baked-buildings.js')),out=[];
  for(const anchor of u.deepWater.buildingAnchors.filter(a=>a.after-a.before>.5)){
   const [x,z]=identities.get(key(anchor.x,anchor.z)),a={...anchor,x,z};
   const ground=Math.max(u.getTerrainMeshSurfaceY(a),u.deepWater.groundAt(a.x,a.z)??-Infinity);
   const live=createTileBuildings([{cx:a.x,cz:a.z,height:4,area:16}],u.getTerrainMeshSurfaceY,5);
   const view=new DataView(new ArrayBuffer(10));view.setUint16(4,40,true);view.setUint16(6,40,true);view.setInt16(8,Math.round(u.getTerrainMeshSurfaceY(a)*2),true);
   const baked=buildBakedTile({view,version:1,recordBytes:10,tiles:[{minX:a.x,minZ:a.z,offset:0,count:1}],reservoirFeetVersion:1},0,5,live.material);
   out.push({x:a.x,z:a.z,before:a.before,after:a.after,ground,live:live.instanceMatrix.array[13],baked:baked.instanceMatrix.array[13]});
   live.geometry.dispose();live.dispose();baked.dispose();
  }return out;
 },centres);
 await writeFile(test.info().outputPath('bank-building-arrivals.json'),JSON.stringify(rows,null,2));
 expect(rows.length).toBeGreaterThanOrEqual(2);
 expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({x:-25177,z:6183}),expect.objectContaining({x:-18233,z:12118})]));for(const r of rows){expect(r.after).toBeGreaterThan(r.before);expect(Math.abs(r.after-r.ground)).toBeLessThan(.001);expect(Math.abs(r.live-r.ground)).toBeLessThan(.001);expect(Math.abs(r.baked-r.ground)).toBeLessThan(.001);}
});
