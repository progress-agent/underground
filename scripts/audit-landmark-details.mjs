import { LANDMARK_INFO } from '../src/landmark-info.js';
import { chromium } from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.argv[2];await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/?buildings=baked&skip=1');
 await page.waitForFunction(()=>window.__ug?.landmarkGroup?.parent&&window.__ug.overground?.userData.stationsAttached&&document.getElementById('loadingBar').classList.contains('done'));
 const stations=await page.evaluate(()=>window.__ug.overground.userData.stationSets.map(s=>({line:s.id,count:s.stations.length,stations:s.stations.map(p=>({name:p.name,offset:p.railOffsetM,position:p.pos.toArray(),surfaceY:p.surfaceY,terminus:p.isTerminus}))})));
 const hovers=[];
 const ids=await page.evaluate(()=>[...new Set(window.__ug.landmarkGroup.userData.pickables.map(m=>m.userData.landmarkId))]);
 await page.evaluate(()=>{const u=window.__ug;u.setRenderQualityMode('manual');u.controls.enabled=false;u.controls.enableDamping=false;const input=document.getElementById('buildingHeight');input.value='1';input.dispatchEvent(new Event('input'));});
 for(const id of ids) {
  const candidates=await page.evaluate(id=>{
   const u=window.__ug,T=window.__ugTHREE,meshes=u.landmarkGroup.userData.pickables.filter(m=>m.userData.landmarkId===id);
   const box=new T.Box3().setFromObject(meshes[0].parent),centre=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),distance=Math.max(size.x,size.y,size.z)*2.4;
   u.camera.position.copy(centre).add(new T.Vector3(distance*.8,distance*.8,distance));u.controls.target.copy(centre);u.camera.lookAt(centre);u.camera.updateMatrixWorld(true);
   return meshes.flatMap(m=>{const p=m.geometry.attributes.position,points=[];for(let i=0;i<p.count;i+=Math.max(3,Math.floor(p.count/90/3)*3)) {
     const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld).project(u.camera);
     if(v.x>-.8&&v.x<.8&&v.y>-.8&&v.y<.8)points.push({x:(v.x+1)*600,y:(1-v.y)*450});
   }return points;});
  },id);
  await page.waitForTimeout(300);
  let text='';
  for(const point of candidates.slice(0,120)) {
   await page.mouse.move(point.x,point.y);text=await page.locator('#hoverTip').innerText();
   if(text.includes(LANDMARK_INFO[id].name.toUpperCase())&&(text.includes('COMPLETED')||text.includes('BUILT')))break;
  }
  if(!text.includes(LANDMARK_INFO[id].name.toUpperCase()))throw Error(`No real hover for ${id}: ${text}`);
  hovers.push({id,text});await page.screenshot({path:`${out}/${id}-hover.png`});
 }
 await page.evaluate(()=>{const u=window.__ug,T=window.__ugTHREE,s=u.overground.userData.stationSets.find(l=>l.id==='mildmay').stations.find(s=>s.name.startsWith('Hackney Central'));u.camera.position.copy(s.pos).add(new T.Vector3(300,1500,700));u.controls.target.copy(s.pos);u.camera.lookAt(s.pos);u.camera.updateMatrixWorld(true);});
 await page.mouse.move(5,450);await page.waitForTimeout(1000);await page.screenshot({path:`${out}/overground-hackney.png`});
 const result={stations,hovers,errors};await writeFile(`${out}/detail-audit.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({stations:stations.map(l=>({line:l.line,count:l.count,maxOffset:Math.max(...l.stations.map(s=>s.offset))})),worst:stations.flatMap(l=>l.stations).sort((a,b)=>b.offset-a.offset).slice(0,8),hovers,errors}));
}finally{await browser.close();}
