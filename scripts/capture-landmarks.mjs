import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { LANDMARKS } from './landmarks.mjs';
const out=process.argv[2];if(!out)throw Error('Usage: node scripts/capture-landmarks.mjs <output-dir>');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
try{
  const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
  const errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());});
  await page.goto('http://127.0.0.1:5173/?buildings=baked&skip=1');
  await page.waitForFunction(()=>window.__ug?.landmarkGroup?.parent && window.__ug.bakedStats?.tilesBuilt===window.__ug.bakedStats?.tilesTotal);
  await page.waitForFunction(()=>document.getElementById('loadingBar')?.classList.contains('done'), null, { timeout: 90000 });
  await page.evaluate(()=>{window.__ug.setRenderQualityMode('manual');window.__ug.controls.enabled=false;window.__ug.controls.enableDamping=false;});
  const stats=[];
  for(const site of LANDMARKS){
    for(const scale of [1,5]){
      const data=await page.evaluate(({id,scale})=>{
        const u=window.__ug,T=window.__ugTHREE;
        const input=document.getElementById('buildingHeight');input.value=String(scale);input.dispatchEvent(new Event('input',{bubbles:true}));
        const group=u.landmarkGroup.getObjectByName(`landmark-site-${id}`),primary=group.children.find(c=>c.userData.primary);
        const box=new T.Box3().setFromObject(primary),size=box.getSize(new T.Vector3()),centre=box.getCenter(new T.Vector3());
        const distance=Math.max(size.x,size.y,size.z)*2.25;
        u.camera.position.set(centre.x+distance*.8,centre.y+distance*.6,centre.z+distance);u.camera.lookAt(centre);u.controls.target.copy(centre);u.camera.updateMatrixWorld(true);
        return {id,scale,size:size.toArray(),centre:centre.toArray()};
      },{id:site.id,scale});
      await page.waitForTimeout(900);await page.screenshot({path:`${out}/${site.id}-${scale}x.png`});stats.push(data);
    }
  }
  await writeFile(`${out}/result.json`,JSON.stringify({stats,errors,warnings},null,2));console.log(JSON.stringify({captures:stats.length,errors,warnings}));
}finally{await browser.close();}
