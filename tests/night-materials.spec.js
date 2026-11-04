import {test,expect} from '@playwright/test';
test.setTimeout(180000);
async function boot(page){
 await page.goto('/');
 await page.waitForFunction(()=>window.__ug?.intro?.getPhase()==='done'&&window.__ug?.lateLayers?.settled(),null,{timeout:150000});
 await page.evaluate(()=>{const u=window.__ug;document.getElementById('hudDetails').open=true;u.controls.enableDamping=false;u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:4});u.camera.position.set(2952.9,337.8,-732.9);u.controls.target.set(1910.1,196.2,-783.7);u.controls.update();});
 await page.waitForTimeout(2000);
}
test('the existing Solo control switches ground artwork off and on in both daylight and night',async({page})=>{
 await boot(page);
 for(const hour of [12,23,12])for(const [solo,enabled]of [['surface-geometry',0],['all',1]]){
  await page.evaluate(h=>window.__ugSun.setHour(h,{persist:false}),hour);
  await page.selectOption('#soloLine',solo);
  await page.evaluate(()=>{const u=window.__ug;u.camera.position.set(2952.9,337.8,-732.9);u.controls.target.set(1910.1,196.2,-783.7);u.controls.update();});
  await expect.poll(()=>page.evaluate(()=>{const u=window.__ug,m=u.scene.getObjectByName('terrainMesh').material;return u.composer.renderer.properties.get(m).uniforms?.surfaceEnabled?.value;})).toBe(enabled);
 }
});
test('prepared night materials and stars need no shader compilation on the first dusk switch',async({page})=>{
 await page.addInitScript(()=>{window.nightCompiles=[];for(const C of [WebGLRenderingContext,WebGL2RenderingContext]){const fn=C.prototype.compileShader;C.prototype.compileShader=function(s){nightCompiles.push({at:performance.now(),source:this.getShaderSource(s)});return fn.call(this,s)}}});
 await boot(page);const before=await page.evaluate(()=>nightCompiles.length);
 await page.evaluate(()=>window.__ugSun.setHour(23,{persist:false}));
 await page.waitForFunction(()=>window.__ug.scene.getObjectByName('real-stars')?.geometry.attributes.position.count===925);
 await page.waitForTimeout(2000);
 const added=await page.evaluate(n=>nightCompiles.slice(n).map(x=>x.source),before);
 expect(added,'all air-side night shaders are prepared after landing').toEqual([]);
});
