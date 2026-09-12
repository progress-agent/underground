import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import proj4 from 'proj4';
const source=JSON.parse(readFileSync(new URL('../public/data/overground.json',import.meta.url)));
const projection='+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs';
const origin=proj4('EPSG:4326',projection,[-.1278,51.5074]);
async function ready(page){
 await page.goto('/?buildings=baked&skip=1');
 await page.waitForFunction(()=>window.__ug?.landmarkGroup?.parent&&window.__ug.overground?.userData.stationsAttached&&document.getElementById('loadingBar').classList.contains('done'));
}

test('wheel plane and pitches agree with independently mapped grid bearings',async({page})=>{
 await ready(page);
 const bearings=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE;
  return ['london-eye','wembley','london-stadium'].map(id=>{
   const anchor=u.landmarkGroup.getObjectByName(`landmark-site-${id}`).children.find(a=>a.userData.primary);
   const mesh=anchor.getObjectByName(id==='london-eye'?'landmark-glass':'landmark-pitch');
   mesh.updateWorldMatrix(true,false);
   const p=mesh.geometry.attributes.position,points=[];
   for(let i=0;i<p.count;i++)points.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld));
   const mx=points.reduce((s,p)=>s+p.x,0)/points.length,mz=points.reduce((s,p)=>s+p.z,0)/points.length;
   let xx=0,zz=0,xz=0;for(const p of points){xx+=(p.x-mx)**2;zz+=(p.z-mz)**2;xz+=(p.x-mx)*(p.z-mz);}
   const angle=.5*Math.atan2(2*xz,xx-zz),bearing=(90+angle*180/Math.PI+180)%180;
   return {id,bearing};
  });
 });
 // OSM wheel way204068874, pitches116539074/576808926; tolerances allow capsule shape/triangulation.
 const expected={'london-eye':5.841,'wembley':88.4415,'london-stadium':179.6701};
 for(const {id,bearing} of bearings){const d=Math.abs(bearing-expected[id]);expect(Math.min(d,180-d)).toBeLessThan(.5);}
});

test('London Eye hover reports real dimensions at both scales, then disappears with the model',async({page})=>{
 await ready(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const scale of [1,5]){
  const point=await page.evaluate(scale=>{
   const u=window.__ug,T=window.__ugTHREE;
   u.controls.enabled=false;u.controls.enableDamping=false;
   const input=document.getElementById('buildingHeight');input.value=String(scale);input.dispatchEvent(new Event('input'));
   const anchor=u.landmarkGroup.getObjectByName('landmark-site-london-eye').children.find(a=>a.userData.primary);
   anchor.updateWorldMatrix(true,true);
   const point=anchor.localToWorld(new T.Vector3(0,75,0));
   const normal=new T.Vector3(0,0,1).applyAxisAngle(new T.Vector3(0,1,0),anchor.rotation.y);
   u.camera.position.copy(point).addScaledVector(normal,400*scale);u.controls.target.copy(point);u.camera.lookAt(point);u.camera.updateMatrixWorld(true);
   const screen=point.project(u.camera);return {x:(screen.x+1)*innerWidth/2,y:(1-screen.y)*innerHeight/2};
  },scale);
  await page.mouse.move(point.x-2,point.y);await page.mouse.move(point.x,point.y);
  await expect(page.locator('#hoverTip')).toContainText('London Eye');
  await expect(page.locator('#hoverTip')).toContainText('135m');
  await expect(page.locator('#hoverTip')).toContainText('1999');
 }
 await page.evaluate(()=>window.__ug.setBuildingsPath('live'));
 await page.mouse.move(641,361);await page.mouse.move(640,360);
 await expect.poll(()=>page.locator('#hoverTip').evaluate(el=>getComputedStyle(el).display==='none'||!el.textContent.includes('London Eye'))).toBe(true);
 expect(errors).toEqual([]);
});

test('all six Overground lines retain source station locations and obey shared visibility controls',async({page})=>{
 await ready(page);
 const layers=await page.evaluate(()=>window.__ug.overground.userData.stationSets.map(({id})=>({id,stations:window.__ug.lineShaftLayers.get(id).stationsLayer.stations.map(s=>({id:s.id,x:s.pos.x,z:s.pos.z,y:s.pos.y}))})));
 expect(layers).toHaveLength(6);
 for(const line of source.lines){
  const layer=layers.find(l=>l.id===line.id);expect(layer.stations).toHaveLength(line.stations.length);
  for(const station of line.stations){
   const actual=layer.stations.find(s=>s.id===station.naptan),[e,n]=proj4('EPSG:4326',projection,[station.lon,station.lat]);
   expect(actual.x).toBeCloseTo(e-origin[0],3);expect(actual.z).toBeCloseTo(origin[1]-n,3);expect(Number.isFinite(actual.y)).toBe(true);
  }
 }
 await expect(page.locator('.station-label-surface').filter({hasText:/^Richmond$/})).toHaveCount(1);
 await expect(page.locator('.station-label-surface').filter({hasText:/^Bethnal Green \(Overground\)$/})).toHaveCount(1);
 await page.evaluate(()=>document.getElementById('hudDetails').open=true);
 await page.locator('#victoriaStations').uncheck();
 expect(await page.evaluate(()=>window.__ug.overground.userData.stationSets.every(s=>!window.__ug.lineShaftLayers.get(s.id).stationsLayer.mesh.visible))).toBe(true);
 await page.locator('#victoriaLabels').uncheck();
 expect(await page.locator('.station-layer-surface:visible').count()).toBe(0);
 await page.locator('#victoriaStations').check();await page.locator('#victoriaLabels').check();
 expect(await page.evaluate(()=>window.__ug.overground.userData.stationSets.every(s=>window.__ug.lineShaftLayers.get(s.id).stationsLayer.mesh.visible))).toBe(true);
});
