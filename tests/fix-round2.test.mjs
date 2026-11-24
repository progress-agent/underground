import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAdaptiveQuality} from '../src/adaptive-quality.js';
import {installNodeEnv} from '../scripts/bake-node-env.mjs';
installNodeEnv();
const {applyOutlinePlacementsSteps}=await import('../src/outline-buildings.js');

test('phone p95 pressure reacts promptly while every sliding 30 s interval spans at most one rung',()=>{
 let now=0,quality;const changes=[];
 const controller=createAdaptiveQuality({apply:q=>{quality=q;changes.push({at:now,level:controller?.get().level??0});},tuning:{targetMs:1000/30,slowFrameRatio:1,maxDescentRungs:1,rungWindowMs:30000}});
 controller.start(now);let firstDrop=null;
 for(let k=0;now<90000;k++){
  // Low average, sustained slow tail; then a light patch to provoke recovery.
  const ms=k%900===899?1200:now%24000<16000?(k%8===0?48:22):12;now+=ms;controller.update(ms,now);
  if(controller.get().level>0&&firstDrop===null)firstDrop=now;
  const rows=changes.filter((c,i)=>i===changes.length-1||changes[i+1].at>now-30000);
  assert.ok(Math.max(...rows.map(r=>r.level))-Math.min(...rows.map(r=>r.level))<=1,JSON.stringify(rows));
 }
 assert.ok(firstDrop!==null&&firstDrop<10000,'slow p95 needs a response within 10 seconds');
 assert.ok(changes.some(c=>c.level>0));assert.ok(quality);
});

test('sliced outline datum and bounding scans match native geometry even for a large ring',()=>{
 const n=4096,data=new Float32Array(n*8);
 for(let i=0;i<n;i++){const a=i/(n/2)*2*Math.PI;data[i*8]=Math.cos(a)*30;data[i*8+1]=i%2?15:2;data[i*8+2]=Math.sin(a)*7;}
 const g=new THREE.BufferGeometry(),ib=new THREE.InterleavedBuffer(data,8);g.setAttribute('position',new THREE.InterleavedBufferAttribute(ib,3,0));
 const records=[{start:0,n:n/2-1,base:2,height:13}],placements=new Map([[records[0],{base:75,height:50}]]);
 const it=applyOutlinePlacementsSteps(g,records,placements,16);let step,yields=0;do{step=it.next();if(!step.done)yields++;}while(!step.done);
 assert.ok(yields>n/16,'placement plus both bound passes must yield');
 const box=g.boundingBox.clone(),sphere=g.boundingSphere.clone();g.computeBoundingBox();g.computeBoundingSphere();
 assert.deepEqual(g.boundingBox,box);assert.ok(g.boundingSphere.center.distanceTo(sphere.center)<1e-12);assert.ok(Math.abs(g.boundingSphere.radius-sphere.radius)<1e-12);
 assert.equal(g.attributes.position.getY(0),75);assert.equal(g.attributes.position.getY(1),125);assert.equal(records[0].h,50);
});

test('drawn Tideway decks carve only touching map boxes at accessible heights',async()=>{
 const {createSolidWorld}=await import('../src/modes/solids.js');
 const scene=new THREE.Scene(),group=new THREE.Group();scene.add(group);
 group.userData={version:1,solidRecords:[{ring:[[-2,-8],[2,-8],[2,8],[-2,8]],minX:-2,maxX:2,minZ:-8,maxZ:8,base:10,h:2,absolute:true,deck:true}]};
 const world=createSolidWorld();world.setSources({tideway:()=>group});world.update();
 const corridors=[];assert.equal(world.corridorsAt(0,0,12,1,corridors).length,1);
 assert.equal(world.boxTouches(corridors,-1,1,-1,1),true);
 assert.equal(world.boxTouches(corridors,3,4,-1,1),false);
 assert.equal(world.corridorsAt(0,0,5,1,[]).length,0,'below-deck boxes remain solid');
 group.userData.solidRecords[0].entryClearanceM=1;group.userData.version++;world.update();
 assert.equal(world.corridorsAt(2.5,0,12,1,[]).length,1,'the dry entry step clears an intersecting map box');
 assert.equal(world.corridorsAt(3.1,0,12,1,[]).length,0,'the entry carve is bounded');
 group.visible=false;world.update();assert.equal(world.corridorsAt(0,0,12,1,[]).length,0,'hidden platforms cannot carve boxes');
});

test('shadow policy distinguishes caster changes from receiver-only shader flags',async()=>{
 const {applyShadowPolicy}=await import('../src/sun.js');const terrain=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial());terrain.name='terrainMesh';
 let casters=0;assert.equal(applyShadowPolicy(terrain,()=>casters++),1);assert.equal(casters,0);assert.equal(terrain.receiveShadow,true);assert.equal(terrain.castShadow,false);
 const root=new THREE.Group();root.name='landmarks';const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());root.add(mesh);
 assert.equal(applyShadowPolicy(root,()=>casters++),1);assert.equal(casters,1);
 mesh.receiveShadow=false;assert.equal(applyShadowPolicy(root,()=>casters++),1);assert.equal(casters,1,'a receiver flag cannot change the depth map');
 mesh.castShadow=false;assert.equal(applyShadowPolicy(root,()=>casters++),1);assert.equal(casters,2,'caster changes still invalidate');
});


test('park labels reuse the exact window height independently of canvas and render DPR',async()=>{
 const {createPhoneViewport}=await import('../src/phone-viewport.js');
 let reads=0,height=932,resize,notify;
 const view={get innerHeight(){reads++;return height},devicePixelRatio:3,addEventListener(_,fn){resize=fn},removeEventListener(){}};
 const canvas={clientWidth:430,clientHeight:800};
 class Observer{constructor(fn){notify=fn}observe(){}disconnect(){}}
 const viewport=createPhoneViewport(canvas,{view,Observer});
 for(let i=0;i<1000;i++){assert.equal(viewport.windowHeight,932);assert.equal(viewport.state.nativeHeight,2796);}
 assert.equal(reads,1,'flying cannot force a fresh window layout');
 notify([{target:canvas,contentRect:{width:932,height:700}}]);height=1000;resize();
 assert.equal(viewport.state.h,700);assert.equal(viewport.windowHeight,1000);assert.equal(viewport.state.nativeHeight,3000);assert.equal(reads,2);
 viewport.dispose();
});


test('an overhanging box shortens the shoulder before it can pull the camera into the figure',async()=>{
 const {createCameraRig}=await import('../src/player/camera-rig.js');
 for(const ratio of [.2,1,2]){
 const box=new THREE.Box3(new THREE.Vector3(-1,1.5/ratio,-.6),new THREE.Vector3(-.2,5/ratio,.3));
 const segment=(a,b)=>{
  const start=new THREE.Vector3(a.x,a.y,a.z),delta=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z),length=delta.length();
  const hit=new THREE.Ray(start,delta.normalize()).intersectBox(box,new THREE.Vector3());
  return hit&&hit.distanceTo(start)<length?{clear:false,t:hit.distanceTo(start)/length}:{clear:true,t:1};
 };
 const rig=createCameraRig({THREE,lineOfSight:segment,ratio});rig.reset({yaw:Math.PI});rig.follow({x:0,y:0,z:0},0,{snap:true});
 const camera=new THREE.PerspectiveCamera();rig.place(camera);
 assert.ok(Math.hypot(camera.position.x,camera.position.z)>1,'the camera must stay off the body');
 assert.equal(box.containsPoint(camera.position),false,'the camera must stay outside the raised box');
 assert.equal(segment({x:0,y:1.45/ratio,z:0},camera.position).clear,true,'the complete fallback sightline must be clear');
 assert.ok(rig.distance>4,'the open centred view retains the authored distance');
 }
});


test('replacing nested bridge caster geometry invalidates an otherwise identical shadow signature',async()=>{
 const {casterVersionOf}=await import('../src/shadow-cache.js');
 const root=new THREE.Group(),bridge=new THREE.Group(),deck=new THREE.Mesh(new THREE.BoxGeometry());deck.castShadow=true;bridge.add(deck);root.add(bridge);
 const before=casterVersionOf([root]);deck.geometry=new THREE.BoxGeometry(4,1,1);root.userData.casterGeometryVersion=1;
 assert.notEqual(casterVersionOf([root]),before);assert.equal(casterVersionOf([root]),casterVersionOf([root]));
});


test('flights and their glows use cached CSS height and the current render viewport without forcing layout',async()=>{
 const {createAircraftLightBatch}=await import('../src/aircraft-lights.js');const batch=createAircraftLightBatch(1,'viewport-regression');
 const hadWindow=Object.hasOwn(globalThis,'window'),previousWindow=globalThis.window;let reads=0;globalThis.window={get innerHeight(){reads++;return 932}};
 try{
  for(const h of [900,1864,2796,1080]){batch.finish(.5);batch.points.onBeforeRender({getCurrentViewport:v=>v.set(0,0,430,h)});assert.equal(batch.points.material.uniforms.pixels.value,h);}
  assert.equal(reads,0,'preparing a light batch cannot flush label layout');
  const {createFlights}=await import('../src/flights.js'),{nightUniforms}=await import('../src/night.js');const saved=nightUniforms.uNightAmt.value;nightUniforms.uNightAmt.value=0;
  const camera=new THREE.PerspectiveCamera(55,430/932,1,400000);camera.position.set(0,20000,30000);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const cached=createFlights({getSurfaceY:()=>100,viewportHeightCssPx:()=>932}),control=createFlights({getSurfaceY:()=>100});
  try{
   cached.userData.setElapsed(1000);cached.userData.update(0,camera);assert.equal(reads,0,'daytime aircraft cannot flush label layout either');
   control.userData.setElapsed(1000);control.userData.update(0,camera);assert.ok(reads>0,'the legacy default still reads its viewport');
   assert.deepEqual(Object.values(cached.userData.meshes).map(m=>Array.from(m.instanceMatrix.array)),Object.values(control.userData.meshes).map(m=>Array.from(m.instanceMatrix.array)));
  }finally{cached.userData.dispose();control.userData.dispose();nightUniforms.uNightAmt.value=saved;}
 }finally{if(hadWindow)globalThis.window=previousWindow;else delete globalThis.window;batch.dispose();}
});


test('outline planning bounds a dense matrix scan while preserving all placements',async()=>{
 const {planOutlineBoxes}=await import('../src/outline-buildings.js');
 const count=4096,values=new Float32Array(count*16),records=[];
 for(let i=0;i<count;i++){
  values[i*16+5]=50;values[i*16+12]=i*10+.25;values[i*16+13]=20+i%3;values[i*16+14]=.25;
  if(i%64===0)records.push({tile:0,x:i*10+.25,z:.25,rectX:i*10+.25,rectZ:.25,height:50});
 }
 const before=values.slice();let reads=0,maxReads=0;
 const array=new Proxy(values,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,target);}});
 const mesh={name:'baked-buildings-0',count,instanceMatrix:{array},geometry:{attributes:{}}};
 const steps=planOutlineBoxes(records,[mesh]);let step,yields=0;
 do{reads=0;step=steps.next();maxReads=Math.max(maxReads,reads);if(!step.done)yields++;}while(!step.done);
 assert.ok(maxReads<=32,`a planning step read ${maxReads} matrix values before yielding`);
 assert.ok(yields>count/16);assert.equal(step.value.hidden,64);assert.equal(step.value.placements.size,64);
 for(const r of records)assert.deepEqual(step.value.placements.get(r),{base:20+Math.round((r.x-.25)/10)%3,height:50});
 assert.deepEqual(values,before);assert.equal(mesh.count,count);assert.equal(step.value.items[0].placed,count-64);
});

test('bounded outline diagnostics retain an old over-budget maximum after samples are evicted',async()=>{
 const {recordOutlineSlice}=await import('../src/outline-buildings.js');
 const stats={slices:[],maxSliceMs:0,stageMax:{}};
 recordOutlineSlice(stats,12.5,'plan');
 for(let i=1;i<10000;i++)recordOutlineSlice(stats,.1,'placement');
 assert.equal(stats.sliceCount,10000);assert.ok(stats.slices.length<=2048);assert.equal(stats.sliceSamplesOmitted,10000-stats.slices.length);
 assert.equal(stats.maxSliceMs,12.5);assert.equal(stats.stageMax.plan,12.5);assert.equal(stats.stageMax.placement,.1);
});
