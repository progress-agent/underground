import {test,expect} from '@playwright/test';
test.describe.configure({mode:'serial'});
test.setTimeout(240000);
let page,errors=[];
test.beforeAll(async({browser})=>{
  page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.addInitScript(()=>{
    const raf=requestAnimationFrame.bind(window),held=[];
    window.__cueHold=false;
    window.requestAnimationFrame=cb=>window.__cueHold&&cb.name==='tick'?(held.push(cb),0):raf(cb);
    window.__cueResume=()=>{__cueHold=false;for(const cb of held.splice(0))requestAnimationFrame(cb)};
  });
  await page.goto('/?fast=1&buildings=baked&groundcue=.5');
  await page.waitForFunction(()=>window.__ug?.roads.stats.state==='ready'&&__ug.lateLayers.settled(),null,{timeout:180000});
  await page.evaluate(()=>{
    const u=__ug;u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:0});
    u.sim.paused=true;u.controls.enableDamping=false;
    // Cached OSM Bank carriageway, clear of building boxes.
    const x=2770.36,z=-731.13,g=u.getTerrainMeshSurfaceY({x,z});
    u.camera.position.set(x,g+1.7*5/1.1,z);
    u.controls.target.set(x-12,g+.4*5/1.1,z-2);u.controls.update();
  });
  await page.waitForTimeout(2000);
  await page.waitForFunction(()=>__ug.roads.stats.state==='ready',null,{timeout:180000});
  await page.evaluate(()=>{window.__cueHold=true});await page.waitForTimeout(100);
});
test.afterAll(async()=>page?.close());

test('street cue changes pixels using the same draws, geometry, textures and programs',async()=>{
  const r=await page.evaluate(()=>{
    const u=__ug,r=u.composer.renderer,gl=r.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
    const shot=strength=>{u.roads.groundCue.setStrength(strength);u.roads.update({x:u.camera.position.x,z:u.camera.position.z,height:1.7/1.1});
      u.undergroundCull.render(u.aboveGroundView,()=>u.composer.render(0));
      const data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);
      return{data,calls:r.info.render.calls,geometries:r.info.memory.geometries,textures:r.info.memory.textures,programs:r.info.programs.length};};
    shot(0);shot(.5);const a=shot(0),b=shot(.5);let changed=0;
    for(let i=0;i<a.data.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])))>8)changed++;
    delete a.data;delete b.data;return{a,b,changed,weight:u.roads.groundCue.weight};
  });
  expect(r.changed).toBeGreaterThan(100);expect(r.weight).toBe(.5);expect(r.a).toEqual(r.b);expect(errors).toEqual([]);
});

test('height, air-body, submerged and below-surface gates drive both material variants to zero',async()=>{
  const r=await page.evaluate(()=>{
    const u=__ug,results=[];u.roads.groundCue.setStrength(1);
    for(const master of [1,1.1,10]){u.masterHeight.setValue(master);u.structureMorph.flush();
      for(const height of [40,60,100,300]){u.roads.update({x:2770,z:-731,height:height/master});results.push(u.roads.groundCue.weight);}}
    for(const flags of [{belowSurface:true},{submerged:true},{airborne:true}]){u.roads.update({x:2770,z:-731,height:1,...flags});results.push(u.roads.groundCue.weight);}
    return{results,airRoadVisible:u.roads.group.visible,same:u.roads.material.userData.shader.uniforms.uGroundCue===u.roads.bridgeMaterial.userData.shader.uniforms.uGroundCue,
      emissive:[u.roads.material,u.roads.bridgeMaterial].map(m=>m.emissive.getHex())};
  });
  expect(r.results.every(v=>v===0)).toBe(true);expect(r.airRoadVisible).toBe(true);expect(r.same).toBe(true);expect(r.emissive).toEqual([0,0]);
});

test('crossing a derivative-origin boundary leaves the world paving in place',async()=>{
  const result=await page.evaluate(()=>{
    const u=__ug,r=u.composer.renderer,gl=r.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
    u.masterHeight.setValue(1.1);u.structureMorph.flush();
    u.roads.groundCue.setStrength(.5);u.roads.update({x:2770.36,z:-731.13,height:1.7/1.1});
    const origin=u.roads.material.userData.shader.uniforms.uGroundOrigin.value,old=origin.clone();
    const shot=()=>{u.undergroundCull.render(u.aboveGroundView,()=>u.composer.render(0));const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
    shot();const a=shot();origin.addScalar(4);shot();const b=shot();origin.copy(old);
    let changed=0;for(let i=0;i<a.length;i+=4){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(a[i+c]-b[i+c]));if(d>8)changed++;}
    return{changed,pixels:w*h};
  });
  expect(result.changed/result.pixels).toBeLessThanOrEqual(.00002);
});

test('URL switch selects exact off and bounded strength without changing desktop controls',async()=>{
  await page.evaluate(()=>__cueResume());
  for(const [value,expected] of [['0',0],['.75',.75],['2',1]]){
    await page.goto('/?fast=1&buildings=baked&groundcue='+value);
    await page.waitForFunction(()=>window.__ug?.roads);
    expect(await page.evaluate(()=>__ug.roads.groundCue.strength)).toBe(expected);
  }
  expect(errors).toEqual([]);
});

test('paving joints retain their 600 mm pitch at a fine Retina pixel footprint',async()=>{
  const result=await page.evaluate(async()=>{
    const T=window.__ugTHREE,{createRoads}=await import('/src/roads.js');
    const scene=new T.Scene(),r=new T.WebGLRenderer({antialias:false});
    r.setPixelRatio(2);r.setSize(1800,1200,false);
    const roads=createRoads({scene,isOpen:()=>false,groundCue:1});
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute([-2,0,-3,2,0,-3,-2,0,3,2,0,3],3));
    g.setAttribute('roadData',new T.Uint8BufferAttribute([12,20,20,12,20,20,12,148,20,12,148,20],3));
    g.setIndex([0,2,1,2,3,1]);g.computeVertexNormals();
    scene.add(new T.Mesh(g,roads.material),new T.AmbientLight(0xffffff,1));
    const camera=new T.OrthographicCamera(-1.2,1.2,.8,-.8,.01,10);
    camera.position.set(0,1.7,-2);camera.up.set(0,0,-1);camera.lookAt(0,0,-2);
    roads.update({x:0,z:-2,height:1.7});r.render(scene,camera);
    const gl=r.getContext(),w=gl.drawingBufferWidth,row=new Uint8Array(w*4);
    gl.readPixels(0,Math.floor(gl.drawingBufferHeight/2),w,1,gl.RGBA,gl.UNSIGNED_BYTE,row);
    const values=Array.from({length:w},(_,i)=>(row[i*4]+row[i*4+1]+row[i*4+2])/3);
    const median=[...values].sort((a,b)=>a-b)[Math.floor(w/2)],centres=[];
    for(let i=0;i<w;i++)if(values[i]<median-15){const a=i;while(i+1<w&&values[i+1]<median-15)i++;
      const c=(a+i)/2;if(c>20&&c<w-20)centres.push(c);}
    const gaps=centres.slice(1).map((x,i)=>(x-centres[i])*2.4/w);
    g.dispose();roads.dispose();r.dispose();
    return{width:w,centres,gaps,median,min:Math.min(...values)};
  });
  await test.info().attach('retina-pitch',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.centres.length,JSON.stringify(result)).toBeGreaterThanOrEqual(3);
  for(const gap of result.gaps)expect(Math.abs(gap-.6),JSON.stringify(result)).toBeLessThan(.006);
});
