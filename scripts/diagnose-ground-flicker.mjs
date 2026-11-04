// Controlled sampler/depth ablations on a frozen scene. Diagnostic only; restore all state before closing.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const [origin,out]=process.argv.slice(2);await mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
await p.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window),held=[];window.requestAnimationFrame=cb=>window.hold&&cb.name==='tick'?(held.push(cb),0):raf(()=>cb(1000));window.step=n=>{for(let i=0;i<n;i++)held.shift()?.(1000)};});
await p.goto(`${origin}/?fast=1&buildings=baked`);await p.waitForFunction(()=>window.__ug?.lateLayers?.settled()&&window.__ug.groundReady,{},{timeout:180000});
await p.evaluate(()=>{const u=window.__ug;u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:4});u.controls.enableDamping=false;window.hold=true;});await p.waitForTimeout(200);
const data=await p.evaluate(()=>{
 const u=window.__ug,T=window.__ugTHREE,r=u.composer.renderer,gl=r.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;
 const terrain=u.scene.getObjectByName('terrainMesh'),tex=terrain.material.userData.surfaceTex;
 const saved={min:tex.minFilter,mips:tex.generateMipmaps,near:u.camera.near,far:u.camera.far};
 const visibility=u.scene.children.map(o=>[o,o.visible]);
 for(const [o]of visibility)if(!o.isLight&&o!==terrain&&o.name!=='analyticSky'&&o.name!=='sunLight')o.visible=false;
 const pose=(dx=0)=>{u.camera.position.set(dx,20000,18000);u.controls.target.set(dx,0,0);u.controls.update();window.step(4)};
 const grab=()=>{u.composer.render(0);const a=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,a);return a};
 const diff=(a,b)=>{let count=0,max=0,sumSq=0,n=0;for(let y=Math.floor(H*.35);y<H*.7;y++)for(let x=Math.floor(W*.1);x<W*.9;x++){const i=(y*W+x)*4;let d=0;for(let j=0;j<3;j++){const v=a[i+j]-b[i+j];sumSq+=v*v;d=Math.max(d,Math.abs(v));}if(d){count++;max=Math.max(max,d)}n++;}return{count,max,rms:Math.sqrt(sumSq/(n*3)),pct:count/n*100,pixels:n}};
 const result={sampler:{width:tex.image.width,height:tex.image.height,minFilter:saved.min,generateMipmaps:saved.mips},region:[.1,.35,.9,.7],tests:[]};
 for(const [name,mips,near]of [['original',false,1],['mipmaps',true,1],['near-10',false,10],['near-50',false,50]]){
  tex.generateMipmaps=mips;tex.minFilter=mips?T.LinearMipmapLinearFilter:saved.min;tex.needsUpdate=true;
  pose();u.camera.near=near;u.camera.updateProjectionMatrix();const a=grab();
  const values=[];
  for(const dx of [.02,.1,.5,1]){pose(dx);u.camera.near=near;u.camera.updateProjectionMatrix();values.push({dx,...diff(a,grab())});}
  result.tests.push({name,near,values});
 }
 tex.minFilter=saved.min;tex.generateMipmaps=saved.mips;tex.needsUpdate=true;u.camera.near=saved.near;u.camera.far=saved.far;u.camera.updateProjectionMatrix();for(const[o,v]of visibility)o.visible=v;pose();
 return result;
});
await writeFile(`${out}/motion-ablation.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data));await b.close();
