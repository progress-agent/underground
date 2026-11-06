import {test,expect} from '@playwright/test';
test.use({deviceScaleFactor:2});

// Immutable reference: the production star fragment shader at 22ef6ef.
// Compare final drawn peaks through the game's bloom, lens and OutputPass;
// a radiance-only assertion missed the regression in the first build.
const liveFragment=`uniform float uWeight; varying float vAlpha; varying vec3 vTint;
void main(){float r=length(gl_PointCoord-0.5)*2.0; if(r>1.0)discard; gl_FragColor=vec4(vTint,uWeight*vAlpha*(1.0-smoothstep(0.1,1.0,r)));}`;

test('the final star peaks rise 15 to 40 percent with the original positions and point size',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(()=>{
  const raf=requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(t=>{if(!window.holdStars||cb.name!=='tick')cb(t);});
 });
 await page.goto('/?skip=1');
 await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ugSun,null,{timeout:90000});
 await page.evaluate(()=>{
  // Pin the acceptance date so the selected catalogue stars stay reproducible.
  const NativeDate=Date,instant=NativeDate.parse('2026-11-06T23:00:00Z');
  window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}};
  const u=window.__ug;u.masterHeight.setValue(5);u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:4});window.__ugSun.setHour(23,{persist:false});
 });
 await page.waitForFunction(()=>window.__ug.scene.getObjectByName('real-stars').geometry.attributes.position.count===925);
 await page.evaluate(()=>{window.holdStars=true;});await page.waitForTimeout(100);
 const result=await page.evaluate(reference=>{
  const u=window.__ug,T=window.__ugTHREE,stars=u.scene.getObjectByName('real-stars'),g=stars.geometry,p=g.attributes.position,m=g.attributes.magnitude;
  const original={fragment:stars.material.fragmentShader,vertex:stars.material.vertexShader,pixels:stars.material.uniforms.uPixels.value,positions:Array.from(p.array)};
  const rows=[];for(let i=0;i<p.count;i++)if(p.getY(i)>.03)rows.push({i,mag:m.getX(i),dir:[p.getX(i),p.getY(i),p.getZ(i)]});rows.sort((a,b)=>a.mag-b.mag);
  for(const c of u.scene.children)if(!c.isLight)c.visible=c===stars;u.scene.background=new T.Color(0);stars.visible=true;
  const gl=u.composer.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,px=new Uint8Array(16*16*4);
  const measure=fragment=>{
   u.composer.passes.find(p=>p.name==='catalogue-star-lift').enabled=fragment!==reference;
   stars.material.fragmentShader=fragment;stars.material.needsUpdate=true;
   return rows.slice(0,100).map(row=>{
    u.camera.position.set(0,0,0);u.camera.lookAt(...row.dir);u.camera.updateMatrixWorld(true);stars.material.uniforms.uRotation.value.setFromMatrix4(u.camera.matrixWorldInverse);g.setDrawRange(row.i,1);u.composer.render(0);
    gl.readPixels(Math.floor(W/2)-8,Math.floor(H/2)-8,16,16,gl.RGBA,gl.UNSIGNED_BYTE,px);
    let peak=0,litPixels=0;for(let i=0;i<px.length;i+=4){const l=.2126*px[i]+.7152*px[i+1]+.0722*px[i+2];peak=Math.max(peak,l);if(l>1)litPixels++;}
    return{peak,litPixels,pointDiameter:original.pixels*(2+Math.max(0,3-row.mag)*.6)};
   });
  };
  const live=measure(reference),next=measure(original.fragment),mean=a=>a.reduce((s,v)=>s+v.peak,0)/a.length;
  // A post-bloom star draw must still respect the world's original depth.
  const blocker=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicMaterial({color:0,side:T.DoubleSide}));
  blocker.position.copy(u.camera.getWorldDirection(new T.Vector3())).multiplyScalar(10);blocker.lookAt(u.camera.position);u.scene.add(blocker);u.composer.render(0);
  gl.readPixels(Math.floor(W/2)-8,Math.floor(H/2)-8,16,16,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const occluded=px.every((v,i)=>i%4===3||v===0);
  const samplesRestored=u.composer.renderTarget1.samples===4&&u.composer.renderTarget2.samples===0;
  return{lift:mean(next.slice(0,50))/mean(live.slice(0,50))-1,faintLift:mean(next.slice(50))/mean(live.slice(50))-1,allBrighter:next.every((v,i)=>v.peak>live[i].peak),compact:next.every((v,i)=>v.litPixels<=Math.max(live[i].litPixels,(Math.ceil(v.pointDiameter)+2)**2)),occluded,samplesRestored,positionsUnchanged:original.positions.every((v,i)=>v===p.array[i]),vertexUnchanged:original.vertex===stars.material.vertexShader,pixelsUnchanged:original.pixels===stars.material.uniforms.uPixels.value};
 },liveFragment);
 expect(result.lift).toBeGreaterThanOrEqual(.15);expect(result.lift).toBeLessThanOrEqual(.40);
 expect(result.faintLift).toBeGreaterThanOrEqual(.15);expect(result.faintLift).toBeLessThanOrEqual(.40);
 expect(result.allBrighter).toBe(true);expect(result.positionsUnchanged).toBe(true);expect(result.vertexUnchanged).toBe(true);expect(result.pixelsUnchanged).toBe(true);
 expect(result.compact,'the lift stays inside the existing glow or original point footprint').toBe(true);
 expect(result.occluded,'opaque world geometry also hides the added star light').toBe(true);
 expect(result.samplesRestored,'the scene retains 4x MSAA and the post buffer stays plain').toBe(true);
});
