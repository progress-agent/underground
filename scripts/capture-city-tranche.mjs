// Independent serial real-GPU review harness. Run only after the coordinator
// freezes source and grants the browser slot. This file changes no app state on disk.
// node scripts/capture-city-tranche.mjs --run --out /absolute/evidence/path
// Optional: --url http://127.0.0.1:5174 --baseline --only street,overview,m25-west
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const baseline=args.includes('--baseline'),base=arg('--url','http://127.0.0.1:5173');
const out=arg('--out',null),only=arg('--only','').split(',').filter(Boolean);
const qualityMode=arg('--quality','auto'),qualityScale=Number(arg('--quality-scale','1')),qualitySamples=Number(arg('--quality-samples','4'));
const warmupMs=Number(arg('--warmup-ms','500')),benchmarkMs=Number(arg('--benchmark-ms','4000'));
if(!['auto','manual'].includes(qualityMode)||!Number.isFinite(warmupMs)||warmupMs<0||warmupMs>60000||!Number.isFinite(benchmarkMs)||benchmarkMs<500||benchmarkMs>60000)throw Error('Invalid quality or measurement timing');
if(!args.includes('--run')||!out||!path.isAbsolute(out))throw Error('Requires --run after the granted serial GPU slot and --out /absolute/path');
const poses=[
 {id:'street',target:[0,0],offset:[0,250,700],targetLift:40,benchmark:true},
 {id:'overview',target:[0,0],offset:[0,30000,26000],benchmark:true},
 {id:'stratford-m5-s5',target:[8256,-4250],offset:[1000,1900,2300],targetLift:45},
 {id:'stratford-m1-s1',target:[8256,-4250],offset:[1000,1900,2300],targetLift:45,mh:1,bh:1},
 {id:'stratford-m10-s5',target:[8256,-4250],offset:[1000,1900,2300],targetLift:45,mh:10},
 {id:'east-india-m5-s5',ll:[51.5091,-.0021],offset:[650,800,850],targetLift:50},
 {id:'east-india-m1-s1',ll:[51.5091,-.0021],offset:[650,800,850],targetLift:50,mh:1,bh:1},
 {id:'heathrow-overhead',target:[-22549,4688],offset:[0,11000,1],benchmark:true},
 {id:'heathrow-oblique',target:[-22549,4688],offset:[3000,4200,4300]},
 {id:'heathrow-m1-s5',target:[-22549,4688],offset:[3000,4200,4300],mh:1,bh:5},
 {id:'east-india-m1-s5',ll:[51.5091,-.0021],offset:[650,800,850],targetLift:50,mh:1,bh:5},
 {id:'heathrow-m1-s1',target:[-22549,4688],offset:[3000,4200,4300],mh:1,bh:1},
 {id:'heathrow-m10-s5',target:[-22549,4688],offset:[3000,4200,4300],mh:10},
 {id:'heathrow-fleet-support',target:[-21169,4702],offset:[-400,1100,1000],targetLift:50},
 ...[['london-city',12346,-64],['biggin-hill',11703,19318],['northolt',-20320,-4706],['elstree',-14061,-16083],['denham',-26914,-8350],['stapleford',19220,-16622]].map(([id,x,z])=>({id,target:[x,z],offset:[900,3000,1800]})),
 {id:'kenley',target:[2791.47,22450.2],offset:[650,1800,1100]},
 {id:'kenley-m1-s5',target:[2791.47,22450.2],offset:[650,1800,1100],mh:1,bh:5},
 {id:'damyns-hall',target:[25796.18,-3129.59],offset:[500,1400,950]},
 {id:'damyns-hall-m1-s5',target:[25796.18,-3129.59],offset:[500,1400,950],mh:1,bh:5},
 {id:'city-docks-close',target:[12911,-176],offset:[400,500,650]},
 {id:'city-docks-m1-s5',target:[12911,-176],offset:[400,500,650],mh:1,bh:5},
 {id:'m25-lod-near',target:[-28501,9511],offset:[-60,100,140]},
 {id:'m25-lod-transition',target:[-28501,9511],offset:[-100,400,600]},
 {id:'m25-lod-far',target:[-28501,9511],offset:[-300,1300,1600]},
 {id:'m25-lod-wide',target:[-28501,9511],offset:[-100,400,600],lens:18},
 {id:'m25-lod-long',target:[-28501,9511],offset:[-100,400,600],lens:70},
 {id:'m25-lod-m1',target:[-28501,9511],offset:[-100,400,600],mh:1},
 {id:'m25-lod-m10',target:[-28501,9511],offset:[-100,400,600],mh:10},
 {id:'m25-west',target:[-28501,9511],offset:[-350,900,1100],benchmark:true},
 {id:'m25-north',target:[-10846,-22954],offset:[400,900,-1000]},
 {id:'m25-south',target:[-5405,27948],offset:[300,1100,1600]},
 {id:'m25-south-m1-s1',target:[-5405,27948],offset:[300,1100,1600],mh:1,bh:1},
 {id:'m25-south-m10-s5',target:[-5405,27948],offset:[300,1100,1600],mh:10},
 {id:'m25-southeast-support',target:[20511,20243],offset:[-300,850,900]},
 {id:'m25-ridge-clearance',target:[-20924.733,21793.113],offset:[-70,180,200],targetLift:5},
 {id:'dartford',target:[26781,4365],offset:[1600,2500,2500],targetLift:150},
 {id:'dartford-m1-s1',target:[26781,4365],offset:[1600,2500,2500],targetLift:150,mh:1,bh:1},
 {id:'dartford-m10-s5',target:[26781,4365],offset:[1600,2500,2500],targetLift:150,mh:10},
 {id:'compact-map',target:[8256,-4250],offset:[1000,1900,2300],viewport:{width:700,height:450}},
 {id:'portrait-orientation',target:[8256,-4250],offset:[1000,1900,2300],viewport:{width:390,height:844}},
 {id:'map-wide-lens',target:[0,0],offset:[0,500,1000],lens:18},
 {id:'map-long-lens',target:[0,0],offset:[0,500,1000],lens:70},
];
const poseSource=arg('--poses-from',null),referencePoses=poseSource?JSON.parse(await readFile(poseSource,'utf8')):null;
if(referencePoses)for(const p of poses){const saved=referencePoses.views.find(v=>v.id===p.id);if(saved)p.absolutePose={camera:saved.live.camera,target:saved.live.target};}
const selected=poses.filter(p=>(!baseline||p.benchmark)&&(!only.length||only.includes(p.id)));
await mkdir(out,{recursive:true});
const result={base,baseline,configuration:{qualityMode,qualityScale,qualitySamples,warmupMs,benchmarkMs,dpr:Number(arg('--dpr','1'))},started:new Date().toISOString(),gpu:null,opening:null,views:[],checks:{},errors:[],warnings:[],requests:[]};
const save=()=>writeFile(path.join(out,'capture-results.json'),JSON.stringify(result,null,2));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:Number(arg('--dpr','1'))});
 const page=await context.newPage();let current='opening';
 if(args.includes('--dock-unavailable'))await page.route('**/src/airport-docks.js*',async route=>{const response=await route.fetch(),body=await response.text(),pattern=/export function createAirportDockWater\(\{[^}]*\}\s*=\s*\{\}\)\s*\{/g,matches=[...body.matchAll(pattern)];if(matches.length!==1)throw Error('Dock failure fixture must replace exactly one factory');result.checks.dockFailureFixture={url:route.request().url(),substitutions:matches.length};await route.fulfill({response,body:body.replace(pattern,match=>match+"throw new Error('fixture: dock init unavailable');")});});

 page.on('pageerror',error=>result.errors.push({view:current,message:error.stack||error.message}));
 page.on('console',message=>{if(message.type()==='warning'||message.type()==='error')result.warnings.push({view:current,type:message.type(),message:message.text(),location:message.location()});});
 page.on('requestfailed',request=>result.requests.push({view:current,url:request.url(),failure:request.failure()}));
 await page.addInitScript(()=>{window.__reviewErrorStacks=[];const original=console.error;console.error=function(...args){window.__reviewErrorStacks.push({message:args.map(String).join(' '),stack:new Error().stack});return original.apply(this,args);};window.__reviewOpeningFrames=[];let last=-Infinity;const record=t=>{const u=window.__ug;if(u?.camera&&t-last>=100){last=t;window.__reviewOpeningFrames.push({ms:t,camera:u.camera.position.toArray(),running:u.intro?.isRunning()??null,loadingDone:document.getElementById('loadingBar')?.classList.contains('done')??false});}if(t<45000)requestAnimationFrame(record);};requestAnimationFrame(record);});
 const start=Date.now();await page.goto(`${base}/?buildings=baked&mh=5`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ug?.camera&&window.__ug?.controls,{timeout:90000});
 if(!baseline&&only.includes('opening'))for(let i=0;i<10;i++){await page.screenshot({path:path.join(out,`opening-${String(i).padStart(2,'0')}.png`)});await page.waitForTimeout(900);}
 await page.waitForFunction(()=>!window.__ug.intro?.isRunning(),{timeout:60000});
 await page.waitForFunction(()=>document.getElementById('loadingBar')?.classList.contains('done'),{timeout:120000});
 await page.waitForFunction(()=>window.__ug.groundReady&&window.__ug.bakedStats?.tilesBuilt===window.__ug.bakedStats?.tilesTotal,{timeout:120000});
 if(!baseline)await page.waitForFunction(()=>window.__ug.airportsGroup&&window.__ug.motorwayGroup,{timeout:60000});
 result.gpu=await page.evaluate(()=>{const renderer=window.__ug.composer.renderer,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION)};});
 if(/swiftshader|llvmpipe|software/i.test(result.gpu.renderer))throw Error(`Rejected software GPU: ${result.gpu.renderer}`);
 result.opening=await page.evaluate(()=>({camera:window.__ug.camera.position.toArray(),target:window.__ug.controls.target.toArray(),groundReady:window.__ug.groundReady,baked:window.__ug.bakedStats,quality:window.__ug.renderQualityMode,airportError:window.__ug.airportInitError,motorwayError:window.__ug.motorwayInitError}));
 result.opening.frames=await page.evaluate(()=>window.__reviewOpeningFrames);result.opening.readyMs=Date.now()-start;await page.screenshot({path:path.join(out,'opening.png')});
 await page.evaluate(()=>{const u=window.__ug;if(u.sim)u.sim.paused=true;else if(document.getElementById('simStatus')?.textContent!=='Paused')document.getElementById('togglePause')?.click();u.controls.enableDamping=false;u.controls.autoRotate=false;u.fpsControls.keys.clear();});
 await page.evaluate(({mode,scale,samples})=>{const u=window.__ug;u.setRenderQualityMode(mode);if(mode==='manual')u.renderQuality.set({scale,samples});},{mode:qualityMode,scale:qualityScale,samples:qualitySamples});
 async function setPose(p){
  await page.setViewportSize(p.viewport||{width:1440,height:900});
  return page.evaluate(p=>{const u=window.__ug;for(const [id,value]of [['masterHeight',p.mh??5],['buildingHeight',p.bh??5]]){const el=document.getElementById(id);if(el){el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}}
   u.lensSystem.setFocalLength(p.lens??35);const point=p.target?{x:p.target[0],z:p.target[1]}:u.llToXZ(...p.ll);const ground=u.getTerrainMeshSurfaceY(point);if(!Number.isFinite(ground))throw Error(`No terrain at ${p.id}`);const target=p.absolutePose?.target??[point.x,ground+(p.targetLift??0),point.z],camera=p.absolutePose?.camera??[point.x+p.offset[0],ground+p.offset[1],point.z+p.offset[2]];u.controls.target.set(...target);u.camera.position.set(...camera);u.controls.update();u.camera.updateMatrixWorld(true);return {camera,target,ground,mh:p.mh??5,bh:p.bh??5,lens:p.lens??35};},p);
 }
 async function settle(){let previous=null,stable=0;const start=Date.now();while(Date.now()-start<30000){const st=await page.evaluate(()=>window.__ug.surfaceLoaderStats);if(st.loading===0&&st.loaded===previous)stable++;else stable=0;previous=st.loaded;if(stable===3)return {settled:true,waitMs:Date.now()-start};await page.waitForTimeout(400);}return {settled:false,waitMs:Date.now()-start};}
 async function metrics(duration){return page.evaluate(duration=>new Promise(resolve=>{const u=window.__ug,renderer=u.composer.renderer,info=renderer.info,original=u.composer.render,auto=info.autoReset;const draws=[],deltas=[],qualityHistory=[];let previous=performance.now(),start=previous,lastQuality=-Infinity;info.autoReset=false;u.composer.render=function(...args){info.reset();const value=original.apply(this,args);draws.push({...info.render});return value;};const frame=now=>{if(now-lastQuality>=500){qualityHistory.push({ms:now-start,quality:u.renderQuality.get(),adaptive:u.adaptiveQuality?.get?.()??null});lastQuality=now;}deltas.push(now-previous);previous=now;if(now-start<duration){requestAnimationFrame(frame);return;}u.composer.render=original;info.autoReset=auto;deltas.shift();const ordered=deltas.toSorted((a,b)=>a-b),at=q=>ordered[Math.min(ordered.length-1,Math.floor(ordered.length*q))];resolve({qualityHistory,sampleMs:now-start,frames:ordered.length,frameMs:{mean:ordered.reduce((a,b)=>a+b,0)/ordered.length,p50:at(.5),p95:at(.95),max:ordered.at(-1)},render:{callsMean:draws.reduce((a,b)=>a+b.calls,0)/draws.length,trianglesMean:draws.reduce((a,b)=>a+b.triangles,0)/draws.length,pointsMean:draws.reduce((a,b)=>a+b.points,0)/draws.length},qualityMode:u.renderQualityMode,renderQuality:u.renderQuality.get?.()??null,adaptiveQuality:u.adaptiveQuality?.get?.()??null,pixelRatio:renderer.getPixelRatio(),drawingBuffer:[renderer.domElement.width,renderer.domElement.height],memory:{...info.memory}});};requestAnimationFrame(frame);}),duration);}
 for(const p of selected){current=p.id;console.log(`Capturing ${baseline?'baseline':'candidate'} ${p.id}`);const pose=await setPose(p),settled=await settle();await page.waitForTimeout(warmupMs);const measurement=await metrics(p.benchmark?benchmarkMs:700);const live=await page.evaluate(()=>{const u=window.__ug;return {camera:u.camera.position.toArray(),target:u.controls.target.toArray(),share:u.getShareUrl?.()??null,airports:u.airportsGroup?.userData.stats??null,motorway:u.motorwayGroup?.userData.stats??null,miniMap:document.getElementById('ug-mini-map')?.getBoundingClientRect().toJSON()??null,bodyScrollWidth:document.body.scrollWidth,viewportWidth:innerWidth,hoverVisible:document.querySelector('#hoverTip')?.textContent??null};});const share=new URL(live.share||base);share.searchParams.set('view',[...live.camera,...live.target].map(v=>v.toFixed(3)).join(','));share.searchParams.set('mh',String(p.mh??5));share.searchParams.set('bh',String(p.bh??5));share.searchParams.set('fl',String(p.lens??35));const image=`${p.id}.png`;await page.screenshot({path:path.join(out,image)});result.views.push({id:p.id,pose,live,url:String(share),settled,measurement,image});await save();}
 if(!baseline&&!only.length){
  current='keyboard-and-roundtrip';await setPose({id:'flight',target:[0,0],offset:[0,1000,1500]});await page.evaluate(()=>document.activeElement?.blur());
  const before=await page.evaluate(()=>window.__ug.camera.position.toArray());await page.keyboard.down('w');await page.waitForTimeout(700);await page.keyboard.up('w');const after=await page.evaluate(()=>window.__ug.camera.position.toArray());result.checks.keyboardFlight={before,after,moved:Math.hypot(...after.map((v,i)=>v-before[i]))};
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;});await page.locator('#masterHeight').focus();const focusBefore=await page.evaluate(()=>window.__ug.camera.position.toArray());await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');const focusAfter=await page.evaluate(()=>window.__ug.camera.position.toArray());result.checks.focusPreventsFlight={before:focusBefore,after:focusAfter,moved:Math.hypot(...focusAfter.map((v,i)=>v-focusBefore[i]))};await page.evaluate(()=>document.activeElement?.blur());
  result.checks.heightRoundtrip=await page.evaluate(()=>{const u=window.__ug,before={camera:u.camera.position.toArray(),target:u.controls.target.toArray()};for(let i=0;i<5;i++)for(const v of [1,10,5]){const el=document.getElementById('masterHeight');el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));}return {before,after:{camera:u.camera.position.toArray(),target:u.controls.target.toArray()}};});
  const phase=()=>page.evaluate(()=>window.__ug.motorwayGroup.userData.getElapsed());const phase0=await phase();await page.waitForTimeout(350);const phase1=await phase();await page.evaluate(()=>{window.__ug.sim.paused=false;window.__ug.sim.timeScale=2;});await page.waitForTimeout(1100);const phase2=await phase();await page.evaluate(()=>window.__ug.sim.paused=true);result.checks.motorwayPauseSpeed={pausedDelta:phase1-phase0,runningDeltaAtSpeed2:phase2-phase1,wallApprox:1.1};
 }
 if(args.includes('--targeted-checks')){
  current='targeted-pointer-checks';await page.setViewportSize({width:1440,height:900});
  const targets=await page.evaluate(()=>{const u=window.__ug;
   const site=u.airportsGroup.children.find(g=>g.userData.airport==='heathrow'),plane=site.userData.aircraft[0];
   function highest(kind){let selected=null;for(const m of site.children){const a=m.geometry?.attributes.position,anchor=m.geometry?.attributes.airportAnchor;if(!a||!anchor)continue;for(const f of m.userData.features||[]){if(kind==='tower'?f.heightM!==87:f.kind!=='aircraft')continue;for(let i=f.start;i<f.end;i+=3){if(kind==='aircraft'&&Math.hypot(anchor.getX(i)-plane.x,anchor.getY(i)-plane.z)>.01)continue;const p=[0,0,0];for(let j=0;j<3;j++){p[0]+=a.getX(i+j)/3;p[1]+=a.getY(i+j)/3;p[2]+=a.getZ(i+j)/3;}if(!selected||p[1]>selected.point[1])selected={id:kind,point:p,expected:f.name,pitches:kind==='tower'?[-60,60]:[-60]};}}}return selected;}
   const station=u.lineShaftLayers.get('dlr').stationsLayer.stations.find(s=>/^East India/.test(s.name));
   const dock=u.airportDockGroup.children[0],a=dock.geometry.attributes.position;let best=null;for(let i=0;i<a.count;i+=3){const area=Math.abs((a.getX(i+1)-a.getX(i))*(a.getZ(i+2)-a.getZ(i))-(a.getZ(i+1)-a.getZ(i))*(a.getX(i+2)-a.getX(i)));if(!best||area>best.area)best={area,point:[(a.getX(i)+a.getX(i+1)+a.getX(i+2))/3,a.getY(i),(a.getZ(i)+a.getZ(i+1)+a.getZ(i+2))/3]};}
   return [highest('tower'),highest('aircraft'),{id:'east-india',point:station.pos.toArray(),expected:'East India',pitches:[-60,60]},{id:'dock',point:best.point,expected:dock.userData.name,pitches:[-60],referenceLevelM:dock.userData.referenceLevelM}];
  });
  result.checks.actualPointers=[];
  for(const t of targets)for(const mh of [1,5,10])for(const pitch of t.pitches){
   const id=`pointer-${t.id}-m${mh}-pitch${pitch}`;console.log(`Checking ${id}`);
   const pose=await page.evaluate(({t,mh,pitch})=>{const u=window.__ug,el=document.getElementById('masterHeight');el.value=String(mh);el.dispatchEvent(new Event('input',{bubbles:true}));u.lensSystem.setFocalLength(35);u.fpsControls.keys.clear();const h=180,dy=-Math.tan(pitch*Math.PI/180)*h;u.controls.target.set(...t.point);u.camera.position.set(t.point[0]+h*.8,t.point[1]+dy,t.point[2]+h*.6);u.controls.update();u.camera.updateMatrixWorld(true);return {camera:u.camera.position.toArray(),target:u.controls.target.toArray(),url:u.getShareUrl()};},{t,mh,pitch});
   await page.waitForTimeout(200);await page.mouse.move(680,430);await page.mouse.move(720,450);await page.waitForTimeout(150);
   const tip=await page.locator('#hoverTip').evaluate(el=>({text:el.innerText,visible:getComputedStyle(el).display!=='none'}));
   const pass=tip.visible&&tip.text.toLowerCase().includes(t.expected.toLowerCase())&&(t.id!=='dock'||tip.text.includes('4.26'))&&(t.id!=='east-india'||/elevated/i.test(tip.text));
   await page.screenshot({path:path.join(out,id+'.png')});result.checks.actualPointers.push({id,expected:t.expected,mh,pitch,pose,tip,pass});await save();
  }
  const dock=targets.find(t=>t.id==='dock');result.checks.dockAltitude=[];
  for(const mh of [1,5,10])for(const heightM of [10,-1]){
   const pose=await page.evaluate(({dock,mh,heightM})=>{const u=window.__ug,el=document.getElementById('masterHeight');el.value=String(mh);el.dispatchEvent(new Event('input',{bubbles:true}));const y=(dock.referenceLevelM+heightM)*5;u.camera.position.set(dock.point[0],y,dock.point[2]);u.controls.target.set(dock.point[0]+100,y,dock.point[2]);u.controls.update();u.camera.updateMatrixWorld(true);return {camera:u.camera.position.toArray(),target:u.controls.target.toArray(),url:u.getShareUrl()};},{dock,mh,heightM});await page.waitForTimeout(250);
   const readout=await page.evaluate(()=>({alt:document.getElementById('ug-readout-alt').textContent,sign:document.getElementById('ug-readout-sign').textContent,substrate:document.getElementById('ug-readout-sub').textContent}));result.checks.dockAltitude.push({mh,heightM,pose,readout,pass:Number(readout.alt)===Math.abs(heightM)&&readout.substrate===(heightM<0?'WATER':'AIR')&&readout.sign===(heightM<0?'−':'+')});
  }
 }
 if(args.includes('--dock-boundary-checks')){
  result.checks.canalBoundary=[];
  const targets=await page.evaluate(()=>{const u=window.__ug,g=u.scene.getObjectByName('canals'),targets=[];for(const mesh of g.children){const a=mesh.geometry?.attributes.position;if(!a)continue;const p=[];for(let i=0;i<a.count-1;i+=2){const q=[(a.getX(i)+a.getX(i+1))/2,(a.getY(i)+a.getY(i+1))/2,(a.getZ(i)+a.getZ(i+1))/2];if(!u.getAirportDockInfo({x:q[0],z:q[2]}))p.push(q);}if(mesh.userData.name==='Canal 1085535988'&&p.length)targets.push({id:'dock-canal-outside-end',point:p[0],name:mesh.userData.name});if(targets.length===0&&p.length&&/Regent/i.test(mesh.userData.name||''))targets.push({id:'regents-canal',point:p[Math.floor(p.length/2)],name:mesh.userData.name});}return targets.slice(0,2);});
  if(args.includes('--dock-unavailable'))targets.push({id:'dock-failure-retained-canal',point:[12841.115234375,23.2483222575,-237.18500773112],name:'Canal 1085535988'});
  for(const t of targets){current=t.id;const pose=await page.evaluate(t=>{const u=window.__ug,el=document.getElementById('masterHeight');el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));u.lensSystem.setFocalLength(35);u.camera.position.set(t.point[0]+24,t.point[1]+100,t.point[2]+18);u.controls.target.set(...t.point);u.controls.update();u.camera.updateMatrixWorld(true);return {camera:u.camera.position.toArray(),target:u.controls.target.toArray(),url:u.getShareUrl()};},t);await page.waitForTimeout(200);await page.mouse.move(680,430);await page.mouse.move(720,450);await page.waitForTimeout(150);const tip=await page.locator('#hoverTip').evaluate(el=>({text:el.innerText,visible:getComputedStyle(el).display!=='none'}));result.checks.canalBoundary.push({...t,pose,tip,pass:tip.visible&&/CANAL/i.test(tip.text)});await page.screenshot({path:path.join(out,t.id+'.png')});}
  result.checks.dockFallbackState=await page.evaluate(()=>{const u=window.__ug,g=u.scene.getObjectByName('canals');return {dockPresent:!!u.airportDockGroup?.parent,dockError:u.airportDockInitError,canalCount:g.children.length,maskedCanals:g.children.filter(m=>m.material?.userData.airportDockMask).length,terrainMask:!!u.scene.getObjectByName('terrainMesh')?.material?.userData.airportDockMask};});
 }
 if(args.includes('--dock-diagnostic')){
  current='dock-diagnostic';await setPose(poses.find(p=>p.id==='city-docks-close'));await page.waitForTimeout(300);
  result.checks.dockDiagnostic=await page.evaluate(()=>{const u=window.__ug,T=window.__ugTHREE,point=new T.Vector3(12841.115234375,23.3,-237.18500773112),ray=new T.Raycaster(new T.Vector3(point.x,2000,point.z),new T.Vector3(0,-1,0)),list=[];u.scene.updateMatrixWorld(true);const hits=ray.intersectObjects(u.scene.children,true);for(const h of hits.slice(0,40)){const m=h.object,mat=m.material;list.push({name:m.name,type:m.userData.type,userData:{type:m.userData.type,name:m.userData.name,osm:m.userData.osm},point:h.point.toArray(),distance:h.distance,material:mat&&{type:mat.type,color:mat.color?.getHexString(),opacity:mat.opacity,transparent:mat.transparent,waterKind:mat.userData.waterKind},parent:m.parent?.name});}return {hits:list,docks:u.airportDockGroup.children.map(m=>({name:m.name,data:m.userData,material:{type:m.material.type,color:m.material.color.getHexString(),opacity:m.material.opacity,waterKind:m.material.userData.waterKind,uniforms:!!m.material.userData.waterUniforms}}))};});
  await save();await page.screenshot({path:path.join(out,'dock-diagnostic-original.png')});
  await page.evaluate(()=>{const u=window.__ug;u.scene.traverse(m=>{if(m.userData.type==='canal'){m.userData.reviewOldVisible=m.visible;m.visible=false;}});});await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'dock-canals-hidden.png')});
  await page.evaluate(()=>{const u=window.__ug;u.scene.traverse(m=>{if(m.userData.reviewOldVisible!==undefined){m.visible=m.userData.reviewOldVisible;delete m.userData.reviewOldVisible;}});u.airportDockGroup.visible=false;});await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'dock-new-water-hidden.png')});
  await page.evaluate(()=>window.__ug.airportDockGroup.visible=true);
  await page.evaluate(()=>window.__ug.airportDockGroup.children.forEach(m=>{m.userData.reviewOrder=m.renderOrder;m.renderOrder=3;}));await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'dock-order-three.png')});await page.evaluate(()=>window.__ug.airportDockGroup.children.forEach(m=>{m.renderOrder=m.userData.reviewOrder;delete m.userData.reviewOrder;}));
  await page.evaluate(()=>{const m=window.__ug.airportDockGroup.children[0].material;m.userData.reviewOpacity=m.opacity;m.opacity=1;});await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'dock-opacity-one.png')});
  await page.evaluate(()=>{const m=window.__ug.airportDockGroup.children[0].material;m.opacity=m.userData.reviewOpacity;delete m.userData.reviewOpacity;window.__ug.scene.traverse(o=>{if(/chalk|geology/.test(o.name)||['chalk','geology'].includes(o.userData.type)){o.userData.reviewGeoVisible=o.visible;o.visible=false;}});});await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'dock-geology-hidden.png')});

 }
 if(args.includes('--water-diagnostic')){
  result.checks.waterDiagnostic=await page.evaluate(()=>{const u=window.__ug,list=[];u.scene.traverse(m=>{const materials=Array.isArray(m.material)?m.material:[m.material];if(materials.some(v=>v?.userData?.waterKind)){list.push({name:m.name,type:m.userData.type,visible:m.visible});m.userData.reviewVisible=m.visible;m.visible=false;}});return list;});await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'water-hidden.png')});
  await page.evaluate(()=>window.__ug.scene.traverse(m=>{if(m.userData.reviewVisible!==undefined){m.visible=m.userData.reviewVisible;delete m.userData.reviewVisible;}}));
  await page.evaluate(()=>{window.__ug.bloomPass.enabled=false;});await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'bloom-disabled.png')});await page.evaluate(()=>{window.__ug.bloomPass.enabled=true;});
 }
 result.consoleErrorStacks=await page.evaluate(()=>window.__reviewErrorStacks);
 await context.close();
}catch(error){result.failure=error.stack||error.message;process.exitCode=1;console.error(result.failure);}
finally{result.finished=new Date().toISOString();await save();await browser.close();}
