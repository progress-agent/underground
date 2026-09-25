import {test,expect} from '@playwright/test';
import {MeshBasicMaterial} from 'three';
import data from '../src/airport-data.json' with {type:'json'};
import {createAirportSuppression,airportSuppressionSignature} from '../src/airport-suppression.js';
import {createTileBuildings} from '../src/surface-geometry.js';
import {parseBakedBuildings,buildBakedTile,fetchBakedBuildings} from '../src/baked-buildings.js';

const suppress=createAirportSuppression(data);
function buildingFixture(){
  const tower=data.airports[0].buildings.find(b=>b.kind==='tower');
  const [cx,cz]=tower.points[0];
  let outside=cx+100;while(suppress({x:outside,z:cz}))outside+=100;
  return [{cx,cz,height:12,area:100},{cx:outside,cz,height:12,area:100}];
}
function payloadFixture(buildings){
  const buffer=new ArrayBuffer(28+buildings.length*10),v=new DataView(buffer);
  const minX=Math.floor(Math.min(...buildings.map(b=>b.cx))),minZ=Math.floor(Math.min(...buildings.map(b=>b.cz)));
  v.setUint32(0,0x31424755,true);v.setUint16(4,1,true);v.setUint16(6,1,true);v.setUint32(8,buildings.length,true);
  v.setInt32(12,minX,true);v.setInt32(16,minZ,true);v.setUint32(20,28,true);v.setUint32(24,buildings.length,true);
  buildings.forEach((b,i)=>{const o=28+i*10;v.setUint16(o,Math.round((b.cx-minX)*10),true);v.setUint16(o+2,Math.round((b.cz-minZ)*10),true);v.setUint16(o+4,b.height*10,true);v.setUint16(o+6,100,true);v.setInt16(o+8,20,true);});
  return buffer;
}

test('browser-free airport exclusion agrees in live and old baked paths and is reversible on failure',()=>{
  const buildings=buildingFixture(),payload=parseBakedBuildings(payloadFixture(buildings)),material=new MeshBasicMaterial();
  const live=createTileBuildings(buildings,()=>10,5,undefined,suppress);
  const baked=buildBakedTile(payload,0,5,material,suppress);
  expect(live.count).toBe(1);expect(baked.count).toBe(1);
  const fallback=createTileBuildings(buildings,()=>10,5);
  const bakedFallback=buildBakedTile(payload,0,5,material);
  expect(fallback.count).toBe(2);expect(bakedFallback.count).toBe(2);
  for(const mesh of [live,fallback]){mesh.dispose();mesh.geometry.dispose();}
  for(const mesh of [baked,bakedFallback])mesh.dispose();material.dispose();
});

test('browser-free baked metadata rejects absent or changed airport replacements',async()=>{
  const originalFetch=globalThis.fetch,buffer=payloadFixture(buildingFixture());
  const fingerprint=await airportSuppressionSignature(data);
  globalThis.fetch=async url=>String(url).endsWith('meta.json')
    ? new Response(JSON.stringify({buildings:2,tiles:1,airportSuppression:{fingerprint}}),{headers:{'content-type':'application/json'}})
    : new Response(buffer,{headers:{'content-type':'application/octet-stream'}});
  try {
    await expect(fetchBakedBuildings('/data/surface/baked/buildings.bin')).rejects.toThrow('replacements unavailable');
    await expect(fetchBakedBuildings(undefined,{airportFingerprint:'wrong'})).rejects.toThrow('incompatible');
    const result=await fetchBakedBuildings(undefined,{airportFingerprint:fingerprint});expect(result.buildings).toBe(2);
  } finally {globalThis.fetch=originalFetch;}
});

async function ready(page,query='?skip=1&buildings=baked'){
  await page.goto('/'+query);
  await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ug.airportsGroup&&window.__ug.miniMap&&window.__ug.bakedStats?.tilesBuilt===window.__ug.bakedStats?.tilesTotal);
}

test('integrated master preference keeps the opening and reset restores both height controls',async({page})=>{
  await page.goto('/?buildings=baked&mh=2');
  await page.waitForFunction(()=>window.__ug?.masterHeight);
  expect(await page.evaluate(()=>window.__ug.intro.isRunning())).toBe(true);
  expect(await page.evaluate(()=>window.__ug.masterHeight.value)).toBe(2);
  await page.waitForFunction(()=>!window.__ug.intro.isRunning());
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;});
  const master=page.locator('#masterHeight');
  await master.evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(new URL(page.url()).searchParams.get('mh')).toBe('3');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ug:prefs:v2')).masterHeight)).toBe(3);
  // Reset defaults are Master 1.1 and Structure 2 since D-036 (9990a5c changed
  // resetPrefs from setValue(5) to setValue(1.1) and the fresh Structure
  // default to 2; this test was written against the older 5/5 in 8e60ea2 and
  // was not updated). Sprint 24Sep26h (lane H): expect the D-036 values, and
  // wait for the reload Reset performs, so the checks read the reloaded page and
  // not the pre-reload one (the 2.0 Structure value is also its pre-reload value).
  await Promise.all([page.waitForNavigation(),page.locator('#resetPrefs').click()]);
  await page.waitForFunction(()=>window.__ug?.masterHeight);
  expect(await page.evaluate(()=>window.__ug.masterHeight.value)).toBe(1.1);
  expect(new URL(page.url()).searchParams.has('mh')).toBe(false);
  // Reset clears the saved height choices (the reloaded page re-saves only its
  // simulation settings, so the key itself comes back).
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ug:prefs:v2')||'{}'));
  expect(saved.masterHeight).toBeUndefined();expect(saved.buildingHeight).toBeUndefined();
  // D-039 (sprint 25Sep26f, plan Lane S): the Structure slider is removed;
  // structures are always at true proportions (height factor 1 / Master).
  expect(await page.locator('#buildingHeight').count()).toBe(0);
  expect(await page.evaluate(()=>window.__ug.getBuildingHeightScale()*window.__ug.masterHeight.value)).toBeCloseTo(1,9);
});

test('integrated master preserves canonical positions, datums and form-focused navigation',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;});
  const result=await page.evaluate(()=>{
    const u=window.__ug,p=u.camera.position.clone(),q=u.camera.quaternion.clone(),surface=u.getTerrainMeshSurfaceY(p);
    const vertex=u.airportsGroup.userData.pickables[0].geometry.attributes.position.array.slice(0,30);
    for(const value of [1,5,10,1,5])u.masterHeight.setValue(value);
    return {positionError:u.camera.position.distanceTo(p),rotationError:1-Math.abs(u.camera.quaternion.dot(q)),surfaceBefore:surface,surfaceAfter:u.getTerrainMeshSurfaceY(p),verticesEqual:vertex.every((v,i)=>v===u.airportsGroup.userData.pickables[0].geometry.attributes.position.array[i])};
  });
  expect(result.positionError).toBe(0);expect(result.rotationError).toBeLessThan(1e-12);
  expect(result.surfaceAfter).toBe(result.surfaceBefore);expect(result.verticesEqual).toBe(true);
  const before=await page.evaluate(()=>window.__ug.camera.position.toArray());
  await page.locator('#masterHeight').focus();await page.keyboard.down('w');await page.waitForTimeout(200);await page.keyboard.up('w');
  expect(await page.evaluate(()=>window.__ug.camera.position.toArray())).toEqual(before);
});

test('integrated airport replacements survive live/baked switches and exact hover facts reach the formatter',async({page})=>{
  await ready(page);
  const result=await page.evaluate(()=>{
    const u=window.__ug,airports=u.airportsGroup;
    const mesh=airports.userData.pickables.find(m=>m.userData.features?.some(f=>f.heightM===87));
    const feature=mesh.userData.features.find(f=>f.heightM===87);
    const html=u.formatInfraTooltip(mesh,null,feature.start/3);
    u.setBuildingsPath('live');const liveParent=airports.parent?.uuid;
    u.setBuildingsPath('baked');
    return {airports:airports.userData.stats.airports,html,liveParent,bakedParent:airports.parent?.uuid};
  });
  expect(result.airports).toBe(data.airports.length);expect(result.html).toContain('Control Tower');expect(result.html).toContain('87m');expect(result.liveParent).toBe(result.bakedParent);
});

test('browser-free BNG adapters, support boundary and ground atlas retain real source geography',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {installNodeEnv,ROOT}=await import('../scripts/bake-node-env.mjs');
  const {BNG_REF_E,BNG_REF_N}=await import('../src/coordinates.js');
  const {tryCreateTerrainMesh,getTerrainBounds,xzToTerrainUV}=await import('../src/terrain.js');
  const {sceneBBoxToUVBounds}=await import('../src/surface-texture.js');
  const {getMotorwayBoundary}=await import('../src/m25-motorway.js');
  const {initThamesMask,isInThames}=await import('../src/thames-mask.js');
  const {initThamesZones,nearestThamesSegment}=await import('../src/thames-zones.js');
  const {createThamesProfileSampler}=await import('../src/thames-profile.js');
  installNodeEnv();
  const read=async file=>JSON.parse(await readFile(`${ROOT}/${file}`,'utf8'));
  const thames=await read('public/data/thames.json'),ring=await read('public/data/m25.json');
  const atlas=await read('public/data/surface/baked/ground-meta.json');
  const terrain=await tryCreateTerrainMesh({thamesData:thames});expect(terrain).toBeTruthy();
  const bounds=getTerrainBounds(),uv=sceneBBoxToUVBounds(atlas.bbox);
  // Invert the shader mapping independently: original atlas source bounds
  // must survive the southern terrain extension without stretching.
  expect(bounds.minX+uv.minU*bounds.widthM).toBeCloseTo(atlas.bbox.minX,7);
  expect(bounds.maxZ-uv.minV*bounds.heightM).toBeCloseTo(atlas.bbox.maxZ,7);
  expect(bounds.maxZ-uv.maxV*bounds.heightM).toBeCloseTo(atlas.bbox.minZ,7);
  expect((uv.maxV-uv.minV)*bounds.heightM).toBeCloseTo(atlas.bbox.maxZ-atlas.bbox.minZ,7);
  const support=getMotorwayBoundary(40);expect(ring.supportPoints.length).toBe(support.length);
  ring.supportPoints.forEach((p,i)=>{expect(p.e-BNG_REF_E).toBeCloseTo(support[i][0],6);expect(BNG_REF_N-p.n).toBeCloseTo(support[i][1],6);const u=xzToTerrainUV({x:support[i][0],z:support[i][1]});expect(u.u).toBeGreaterThan(0);expect(u.u).toBeLessThan(1);expect(u.v).toBeGreaterThan(0);expect(u.v).toBeLessThan(1);});
  initThamesMask(thames.points);initThamesZones(thames.points);
  const profile=createThamesProfileSampler(thames.points),a=thames.points[30],b=thames.points[31];
  const x=(a.e+b.e)/2-BNG_REF_E,z=BNG_REF_N-(a.n+b.n)/2;
  expect(isInThames(x,z)).toBe(true);expect(nearestThamesSegment(x,z)).not.toBeNull();expect(profile.sampleAt(x,z)).toBeTruthy();
  terrain.mesh.geometry.dispose();terrain.topMat.dispose();terrain.undersideMat.dispose();
});

test('integrated DLR keeps modelled platforms, genuine tunnels and train state across height changes',async({page})=>{
  await ready(page);
  await page.waitForFunction(()=>window.__ug.lineBranchCenterPts.get('dlr')?.length);
  const result=await page.evaluate(()=>{
    const u=window.__ug;u.sim.paused=true;
    const branches=u.lineBranchCenterPts.get('dlr'),trains=branches.flatMap(b=>b._trains);
    const initial=trains.map(t=>({id:t.uuid,t:t.userData.t}));
    const stations=u.lineShaftLayers.get('dlr').stationsLayer.stations;
    // D-039: no Structure slider; Master now drives every structure (true
    // proportions), so the DLR resnap is exercised through Master instead.
    const setMaster=value=>{const el=document.getElementById('masterHeight');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));u.structureMorph.flush();};
    setMaster('10');setMaster('1');
    const alignment=stations.map(s=>s.pos.distanceTo(u.dlrProfile.station({id:s.id,nodeIndex:s.dlrProfile.nodeIndex,structureScale:1})));
    const stopCounts=branches.map(b=>[b._stationIndices.length,b._trains[0].userData.stationUs.length]);
    const classifications=stations.map(s=>s.dlrProfile.classification);
    const mesh=u.scene.children.flatMap(g=>g.children).find(m=>m.userData.type==='tube-line'&&m.userData.lineId==='dlr');
    const station=stations.find(s=>s.dlrProfile.classification==='elevated');
    return {alignment,stopCounts,classifications,initial,after:branches.flatMap(b=>b._trains).map(t=>({id:t.uuid,t:t.userData.t})),hover:u.formatInfraTooltip(mesh,station.pos)};
  });
  expect(Math.max(...result.alignment)).toBeLessThan(1e-8);
  expect(result.classifications).toContain('elevated');expect(result.classifications).toContain('tunnel');
  expect(result.after).toEqual(result.initial);
  for(const [stops,trainStops]of result.stopCounts)expect(trainStops).toBe(stops);
  expect(result.hover).toContain('above');expect(result.hover).toContain('modelled');expect(result.hover).not.toContain('18m below');
});

test('integrated motorway replaces only overlapping bridges and respects pause and height semantics',async({page})=>{
  await ready(page);
  await page.waitForFunction(()=>window.__ug.motorwayGroup&&window.__ug.bridgeRegistry.size);
  const result=await page.evaluate(()=>{
    const u=window.__ug;u.sim.paused=true;
    const stats=u.motorwayGroup.userData.stats;
    const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    // D-039 (sprint 25Sep26f): the Structure slider is gone and the 87m tower
    // stands at its true 87m for every Master (it read 87 x Master x Structure/5
    // under D-023, 17.4m at Master 1 / Structure 1).
    const tower=()=>{let lo=Infinity,hi=-Infinity;
      for(const mesh of u.airportsGroup.userData.pickables) for(const f of mesh.userData.features||[]) if(f.heightM===87) {
        const p=mesh.geometry.attributes.position;for(let i=f.start;i<f.end;i++){lo=Math.min(lo,p.getY(i));hi=Math.max(hi,p.getY(i));}
      }
      return (hi-lo)*u.masterHeight.ratio;};
    const heights={};
    for(const m of ['1','3','10']){set('masterHeight',m);u.structureMorph.flush();heights[m]=tower();}
    const hint=document.getElementById('heightExplanation').textContent;
    return {stats,hint,heights,qe2:u.bridgeRegistry.get('qe2').group.visible,runnymede:u.bridgeRegistry.get('runnymede').group.visible,otherVisible:[...u.bridgeRegistry].filter(([id])=>!['qe2','runnymede'].includes(id)).some(([,b])=>b.group.visible),elapsed:u.motorwayGroup.userData.getElapsed()};
  });
  expect(result.stats.vehicles).toBeGreaterThan(10000);expect(result.qe2).toBe(false);expect(result.runnymede).toBe(false);expect(result.otherVisible).toBe(true);
  expect(result.hint).toContain('true proportions');
  for(const h of Object.values(result.heights))expect(Math.abs(h-87)).toBeLessThan(.25);
  await page.waitForTimeout(250);expect(await page.evaluate(()=>window.__ug.motorwayGroup.userData.getElapsed())).toBe(result.elapsed);
});

test('integrated share pose roundtrips and malformed pose leaves a finite camera',async({page})=>{
  await ready(page);
  const pose=await page.evaluate(()=>{
    const u=window.__ug;u.sim.paused=true;u.camera.position.set(8300,600,-4200);u.controls.target.set(8000,40,-4400);u.camera.lookAt(u.controls.target);u.camera.updateMatrixWorld(true);
    return {url:u.getShareUrl(),position:u.camera.position.toArray(),quaternion:u.camera.quaternion.toArray()};
  });
  await page.goto(pose.url);await page.waitForFunction(()=>window.__ug?.groundReady);
  const restored=await page.evaluate(()=>({position:window.__ug.camera.position.toArray(),quaternion:window.__ug.camera.quaternion.toArray()}));
  restored.position.forEach((n,i)=>expect(n).toBeCloseTo(pose.position[i],2));
  restored.quaternion.forEach((n,i)=>expect(n).toBeCloseTo(pose.quaternion[i],5));
  await page.goto('/?skip=1&view=NaN,Infinity,1,2,3,4');await page.waitForFunction(()=>window.__ug?.camera);
  expect(await page.evaluate(()=>window.__ug.camera.position.toArray().every(Number.isFinite))).toBe(true);
});

test('browser-free rounded concave airport source footprints suppress without clearing courtyards or nearby buildings',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {ROOT}=await import('../scripts/bake-node-env.mjs');
  for(const [file,cx,cz]of [['tile_21_12.json',12290,70],['tile_22_12.json',12290,70],['tile_09_20.json',-13934,-15968]]) {
    const tile=JSON.parse(await readFile(`${ROOT}/public/data/surface/tiles/${file}`,'utf8'));
    const b=tile.buildings.find(b=>b.cx===cx&&b.cz===cz);expect(b).toBeTruthy();
    // The centre-only input cannot identify these concave footprints safely.
    expect(suppress({cx,cz})).toBe(false);expect(suppress(b)).toBe(true);
    expect(createTileBuildings([b],()=>10,5,undefined,suppress)).toBeNull();
    // A distinct courtyard building must survive even though its centre and
    // bounding box are close to the replacement's boundary.
    const small={cx,cz,area:1,footprint:[[cx-.25,cz-.25],[cx+.25,cz-.25],[cx+.25,cz+.25],[cx-.25,cz+.25]]};
    expect(suppress(small)).toBe(false);
  }
  // Synthetic concavity isolates tolerance from neighbouring real buildings.
  const ring=[[0,0],[20,0],[20,20],[15,20],[15,5],[5,5],[5,20],[0,20]];
  const local=createAirportSuppression({airports:[{buildings:[{kind:'terminal',points:ring}]}]});
  const candidate={cx:10,cz:12,footprint:ring.map(([x,z])=>[x+.6,z-.4])};
  expect(local(candidate)).toBe(true);
  expect(local({...candidate,footprint:ring.map(([x,z])=>[x+4,z])})).toBe(false);
  expect(local({...candidate,footprint:[[8,10],[12,10],[12,14],[8,14]]})).toBe(false);
});

test('browser-free old point-only bake rejects active-airport use but preserves failed-airport fallback',async()=>{
  const originalFetch=globalThis.fetch,buffer=payloadFixture(buildingFixture());
  globalThis.fetch=async url=>String(url).endsWith('meta.json')
    ? new Response(JSON.stringify({buildings:2,tiles:1}),{headers:{'content-type':'application/json'}})
    : new Response(buffer,{headers:{'content-type':'application/octet-stream'}});
  try {
    await expect(fetchBakedBuildings(undefined,{airportFingerprint:await airportSuppressionSignature(data)})).rejects.toThrow('rebuild required');
    expect((await fetchBakedBuildings()).buildings).toBe(2);
  } finally {globalThis.fetch=originalFetch;}
});

test('integrated City dock water uses exact wet polygons and published reference level without changing ground',async({page})=>{
 await ready(page);await page.waitForFunction(()=>window.__ug.airportDockGroup);
 const result=await page.evaluate(()=>{
  const u=window.__ug,p={x:12600,z:-250},info=u.getAirportDockInfo(p),ground=u.getTerrainMeshSurfaceY(p);
  u.camera.position.set(p.x,info.referenceLevelM*5+50,p.z);u.controls.target.set(p.x,info.referenceLevelM*5,p.z-100);u.camera.lookAt(u.controls.target);u.camera.updateMatrixWorld(true);
  const water=u.airportDockGroup,mesh=water.userData.pickables[0],before=Array.from(mesh.geometry.attributes.position.array);
  // D-039: no Structure slider; a Master change (which now also re-scales every
  // structure) must leave the dock water and the ground untouched.
  const input=document.getElementById('masterHeight');input.value='3';input.dispatchEvent(new Event('input',{bubbles:true}));u.structureMorph.flush();
  const top=u.scene.children.find(m=>m.material?.userData?.airportDockMask)?.material;
  return {name:info.name,level:info.referenceLevelM,hover:u.formatInfraTooltip(mesh),groundBefore:ground,groundAfter:u.getTerrainMeshSurfaceY(p),mask:Boolean(top),waterUnchanged:before.every((n,i)=>n===mesh.geometry.attributes.position.array[i]),outside:u.getAirportDockInfo({x:0,z:0}),submerged:u.isSubmergedAt(p.x,info.referenceLevelM*5-2,p.z)};
 });
 expect(result.name).toBe('Royal Albert Dock');expect(result.level).toBe(4.26);expect(result.hover).toContain('4.26m AOD');expect(result.hover).toContain('reference');
 expect(result.groundAfter).toBe(result.groundBefore);expect(result.mask).toBe(true);expect(result.waterUnchanged).toBe(true);expect(result.outside).toBeNull();expect(result.submerged).toBe(true);
 await expect(page.locator('#ug-readout-alt')).toHaveText('10');
});

test('integrated dock replacement retains its paired terrain mask when M25 data is absent',async({page})=>{
 await page.route('**/data/m25.json',route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.airportDockGroup);
 await page.waitForFunction(()=>window.__ug.scene.children.some(m=>m.material?.userData?.airportDockMask));
 const state=await page.evaluate(()=>({water:window.__ug.airportDockGroup.parent===window.__ug.scene,masked:window.__ug.scene.children.filter(m=>m.material?.userData?.airportDockMask).length}));
 expect(state.water).toBe(true);expect(state.masked).toBeGreaterThanOrEqual(2);
});

test('browser-free legacy canal wet-polygon mask chains water shading without changing geometry or outside coverage',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {ShaderLib}=await import('three');
 const {installNodeEnv,ROOT}=await import('../scripts/bake-node-env.mjs');
 const {createCanals}=await import('../src/canals.js');
 const {installAirportDockTerrainMask,getAirportDockInfo}=await import('../src/airport-docks.js');
 const {BNG_REF_E,BNG_REF_N}=await import('../src/coordinates.js');
 const {default:proj4}=await import('proj4');
 installNodeEnv();
 const data=JSON.parse(await readFile(`${ROOT}/public/data/canals.json`,'utf8'));
 const project=(lat,lon)=>{const[e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return{x:e-BNG_REF_E,z:BNG_REF_N-n};};
 const canals=createCanals(data,project,()=>20),materials=new Set(canals.children.map(m=>m.material));
 const positions=canals.children.map(m=>new Float32Array(m.geometry.attributes.position.array));
 const shader=()=>({uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader});
 for(const material of materials){
  const original=material.onBeforeCompile,before=shader();original(before);
  expect(before.fragmentShader).toContain('waterFresnel');expect(before.fragmentShader).not.toContain('inAirportDock');
  const dispose=installAirportDockTerrainMask(material),after=shader();material.onBeforeCompile(after);
  expect(after.fragmentShader).toContain('waterFresnel');expect(after.fragmentShader).toContain('inAirportDock0(vAirportDockXZ)||inAirportDock1(vAirportDockXZ)');
  expect(after.vertexShader).toContain('vAirportDockXZ=(modelMatrix*vec4(transformed,1.0)).xz');
  dispose();expect(material.onBeforeCompile).toBe(original);
 }
 expect(getAirportDockInfo({x:12841.115,z:-237.185})?.name).toBe('Royal Albert Dock');
 expect(getAirportDockInfo({x:0,z:0})).toBeNull();
 canals.children.forEach((mesh,i)=>{expect(mesh.geometry.attributes.position.array).toEqual(positions[i]);mesh.geometry.dispose();});
 for(const material of materials)material.dispose();
});

test('integrated actual dock pointer beats redundant canal ribbons at Master1,5,10',async({page})=>{
 await ready(page);await page.waitForFunction(()=>window.__ug.airportDockGroup&&window.__ug.scene.getObjectByName('canals'));
 for(const master of [1,5,10]){
  const point=await page.evaluate(master=>{
   const u=window.__ug;u.sim.paused=true;u.masterHeight.setValue(master);
   const target=new window.__ugTHREE.Vector3(12841.115,23.3,-237.185);
   u.camera.position.set(12985.115,335.069,-129.185);u.controls.target.copy(target);u.camera.lookAt(target);u.camera.updateMatrixWorld(true);
   const ndc=target.project(u.camera);return{x:(ndc.x+1)*innerWidth/2,y:(1-ndc.y)*innerHeight/2};
  },master);
  await page.mouse.move(point.x+70,point.y+30);await page.mouse.move(point.x,point.y);await page.waitForTimeout(250);
  await expect(page.locator('#hoverTip')).toContainText('Royal Albert Dock');await expect(page.locator('#hoverTip')).toContainText('4.26m AOD');
 }
 expect(await page.evaluate(()=>window.__ug.scene.getObjectByName('canals').children.every(m=>m.material.userData.airportDockMask))).toBe(true);
});

test('integrated failed dock construction preserves original canal rendering and pointer fallback',async({page})=>{
 let injected=false;
 await page.route('**/src/airport-docks.js*',async route=>{
  const response=await route.fetch(),source=await response.text();
  const declaration=/export function createAirportDockWater\(\{[^}]*\}\s*=\s*\{\}\)\s*\{/;
  expect(source.match(declaration)).toBeTruthy();
  const body=source.replace(declaration,match=>match+"throw new Error('fixture: dock init unavailable');");injected=true;
  await route.fulfill({response,body});
 });
 await ready(page);await page.waitForFunction(()=>window.__ug.scene.getObjectByName('canals'));
 expect(injected).toBe(true);
 const state=await page.evaluate(()=>{
  const u=window.__ug;u.camera.position.set(12985.115,335.069,-129.185);u.controls.target.set(12841.115,23.248,-237.185);u.camera.lookAt(u.controls.target);u.camera.updateMatrixWorld(true);
  return{error:u.airportDockInitError,dock:u.airportDockGroup,masked:u.scene.children.some(m=>m.material?.userData?.airportDockMask)||u.scene.getObjectByName('canals').children.some(m=>m.material.userData.airportDockMask)};
 });
 expect(state.error).toContain('fixture: dock init unavailable');expect(state.dock).toBeNull();expect(state.masked).toBe(false);
 const size=page.viewportSize();await page.mouse.move(size.width/2+70,size.height/2+30);await page.mouse.move(size.width/2,size.height/2);await page.waitForTimeout(250);
 await expect(page.locator('#hoverTip')).toContainText('Canal');
});
