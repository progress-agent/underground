import { test, expect } from '@playwright/test';

test.setTimeout(180000);
async function boot(page) {
  await page.goto('/?skip=1');
  await page.waitForFunction(() => window.__ug?.flightsGroup && window.__ug?.airportsGroup && window.__ug.lateLayers.settled(), null, {timeout:150000});
  await page.evaluate(() => {
    const u=window.__ug;u.sim.paused=true;u.controls.enableDamping=false;
    u.camera.position.set(-19493.3,1606.7,4622.3);u.controls.target.set(-22570.2,120,4688.2);u.controls.update();
  });
}

test('night activates every fleet fitting and parked beacon, then dawn restores the daytime fleet', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await boot(page);
  for(const hour of [12,23,12]){
    await page.evaluate(h=>window.__ugSun.setHour(h,{persist:false}),hour);
    await expect.poll(()=>page.evaluate(()=>window.__ug.flightsGroup.userData.lights.points.visible)).toBe(hour===23);
    const r=await page.evaluate(()=>{
      const u=window.__ug,f=u.flightsGroup.userData,p=u.airportsGroup.userData;
      const a=p.lights.points.geometry.attributes;
      return {points:f.stats.lightPoints,parked:p.lights.count,total:p.stats.aircraft,
        parkedVisible:p.lights.points.visible,scale:f.flights.map(x=>x.displayScale),
        beaconOnly:Array.from({length:p.lights.count},(_,i)=>a.timing.getX(i)===Math.fround(.9)
          &&a.lamp.getZ(i)<.61&&a.lampColor.getX(i)===1&&a.lampColor.getY(i)<.02).every(Boolean),
        amount:f.lights.points.material.uniforms.amount.value,air:window.__ugSun.status.airWeight};
    });
    if(hour===23){expect(r.points).toBeGreaterThan(100);expect(r.parked).toBe(r.total);expect(r.total).toBe(183);expect(r.beaconOnly).toBe(true);expect(r.scale.every(x=>x===1)).toBe(true);expect(r.amount).toBe(1);}
    else {expect(r.points).toBe(0);expect(r.parkedVisible).toBe(false);expect(r.scale.some(x=>x>1)).toBe(true);}
  }
  expect(errors).toEqual([]);
});

test('all aircraft fittings fade with the same night level and keep true proportions at Master 1 to 10', async ({page}) => {
  await boot(page);
  await page.evaluate(()=>window.__ugSun.setHour(23,{persist:false}));
  await expect.poll(()=>page.evaluate(()=>window.__ug.flightsGroup.userData.lights.points.visible)).toBe(true);
  const r=await page.evaluate(async()=>{
    const u=window.__ug,T=window.__ugTHREE,{nightUniforms}=await import('/src/night.js');const rows=[];
    for(const master of [1,1.1,4,10]){
      u.masterHeight.setValue(master);u.flightsGroup.userData.update(0,u.camera);
      let worst=0;const m=new T.Matrix4();
      for(const mesh of Object.values(u.flightsGroup.userData.meshes))for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,m);for(const o of [0,4,8])worst=Math.max(worst,Math.abs(Math.hypot(m.elements[o],m.elements[o+1]*master/5,m.elements[o+2])-1));
      }
      rows.push({master,worst,points:u.flightsGroup.userData.stats.lightPoints});
    }
    // Exercise actual batch inputs at fractional dusk independently of sky time.
    nightUniforms.uNightAmt.value=.35;u.flightsGroup.userData.update(0,u.camera);u.airportsGroup.userData.updateNight(.35);
    return {rows,flight:u.flightsGroup.userData.lights.points.material.uniforms.amount.value,parked:u.airportsGroup.userData.lights.points.material.uniforms.amount.value};
  });
  for(const x of r.rows){expect(x.worst).toBeLessThan(1e-5);expect(x.points).toBeGreaterThan(0);}
  expect(r.flight).toBe(.35);expect(r.parked).toBe(.35);
});

test('real GPU draws steady navigation colours and 72/54 flashes per real minute, with independent phases', async ({page}) => {
  await boot(page);
  const r=await page.evaluate(async()=>{
    const u=window.__ug,T=window.__ugTHREE,{createAircraftLightBatch}=await import('/src/aircraft-lights.js');
    const b=createAircraftLightBatch(1,'probe'),scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);
    camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);scene.add(b.points);
    const target=new T.WebGLRenderTarget(32,32,{type:T.UnsignedByteType}),pixel=new Uint8Array(4),old=u.composer.renderer.getRenderTarget(),clear=new T.Color();
    u.composer.renderer.getClearColor(clear);const alpha=u.composer.renderer.getClearAlpha();u.composer.renderer.setClearColor(0,1);
    function read(kind,color,seconds,phase=0,amount=1){
      b.reset();b.add({kind,p:[0,0,0],color,diameter:.2,floor:6,gain:1},new T.Matrix4(),phase);b.finish(amount,camera,seconds);
      u.composer.renderer.setRenderTarget(target);u.composer.renderer.render(scene,camera);u.composer.renderer.readRenderTargetPixels(target,16,16,1,1,pixel);return [...pixel];
    }
    try{
      const colors=[[1,0,0],[0,1,0],[1,1,1]].map(c=>read('nav',c,0));
      const flashes={};for(const kind of ['strobe','beacon']){let before=false,starts=0;for(let i=0;i<1200;i++){const on=read(kind,[1,1,1],i*.05,.37)[0]>0;if(on&&!before)starts++;before=on;}flashes[kind]=starts;}
      return {colors,flashes,phase:[read('strobe',[1,1,1],0,.01)[0],read('strobe',[1,1,1],0,.5)[0]],fade:[read('nav',[1,1,1],0,0,1)[0],read('nav',[1,1,1],0,0,.5)[0]],day:read('nav',[1,1,1],0,0,0)[0]};
    }finally{u.composer.renderer.setRenderTarget(old);u.composer.renderer.setClearColor(clear,alpha);b.dispose();target.dispose();}
  });
  expect(r.colors[0][0]).toBeGreaterThan(0);expect(r.colors[0][1]).toBe(0);
  expect(r.colors[1][1]).toBeGreaterThan(0);expect(r.colors[1][0]).toBe(0);
  expect(r.colors[2].slice(0,3).every(x=>x>0)).toBe(true);
  expect(r.flashes).toEqual({strobe:72,beacon:54});expect(r.phase[0]).toBeGreaterThan(0);expect(r.phase[1]).toBe(0);
  expect(r.fade[1]/r.fade[0]).toBeCloseTo(.5,1);expect(r.day).toBe(0);
});
