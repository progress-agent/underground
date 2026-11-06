import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildWaterBody,offsetRing,inRing,triangleSampler} from '../src/water-body-geometry.js';
import {habitatFor,createLakeSeaLife} from '../src/lake-sea-life.js';
import * as THREE from 'three';
import {createDeepWaterSteps} from '../src/deep-water.js';
const data=JSON.parse(await readFile(new URL('../public/data/deep-water.json',import.meta.url)));
const square=[[-200,-200],[200,-200],[200,200],[-200,200]];
const spec={id:'test',name:'Test basin',kind:'reservoir',depth:{renderM:12},bank:{heightM:14,freeboardM:1.5}};
test('basin and bank navigation follows its actual sloped triangles, at a referenced real level',()=>{
  const b=buildWaterBody({...spec,level:{aodM:23},bank:{...spec.bank,crestAodM:24.5}},square,()=>10*5);
  assert.equal(b.waterY,115);assert.equal(b.crestY,122.5);assert.equal(b.bedAt(0,0),55);
  assert.ok(b.bedAt(190,0)>55&&b.bedAt(190,0)<115);
  assert.equal(b.bankAt(206,0),122.5);
  assert.ok(b.bankAt(230,0)>50&&b.bankAt(230,0)<122.5);
  assert.equal(b.groundAt(300,0),null);
  assert.ok(b.contains({x:0,y:60,z:0}));assert.ok(!b.contains({x:0,y:54,z:0}));assert.ok(!b.contains({x:0,y:115,z:0}));
});
test('independent floor and banks are clipped to the actual map edge, not just water',()=>{
 const map=[[-500,-500],[0,-500],[0,500],[-500,500]];
 const b=buildWaterBody(spec,square,()=>50,{mapRing:map});
 for(const arr of [b.basinPos,b.bankPos,b.topPos])for(let i=0;i<arr.length;i+=3)assert.ok(arr[i]<=0.001);
 assert.ok(b.containsXZ(-10,0));assert.ok(!b.containsXZ(10,0));
});
test('inventory accounts for every legacy alias, including split basins, and cites every rendered depth',async()=>{
 const legacy=JSON.parse(await readFile(new URL('../public/data/reservoirs.json',import.meta.url)));
 const ids=new Set(data.bodies.flatMap(b=>b.legacyIds));
 for(const f of legacy.features)assert.ok(ids.has(f.id),f.id);
 for(const b of data.bodies){assert.ok(b.area.source.startsWith('https://'));assert.ok(b.reason.length>10);if(b.mode==='VOLUME')assert.ok(b.depth.renderM>0&&b.depth.source.startsWith('https://'));else assert.ok(!b.seaLife);}
 assert.equal(data.bodies.filter(b=>b.name.startsWith('Staines ')).length,2);
 assert.equal(data.bodies.filter(b=>b.name.startsWith('King George V Reservoir')).length,2);
});
test('every generated volume has a floor in its deep central habitat and no animal enters a bank, bed or air',()=>{
 for(const s of data.bodies.filter(b=>b.mode==='VOLUME'))for(const ring of s.rings){
   const b=buildWaterBody(s,ring,()=>50),h=habitatFor(b);
   if(!h)continue;
   const c=h.anchor,bed=b.bedAt(c.x,c.z);assert.ok(bed!=null,s.name);
   assert.ok(Math.abs((b.waterY-bed)/5-s.depth.renderM)<s.depth.renderM*.1,s.name);
   if(!s.seaLife)continue;
   const life=createLakeSeaLife(b);
   assert.ok(life.ids.includes('blue-whale'),s.name);
   for(const t of [0,17,60,300,900])for(const id of life.ids)for(const p of life.probes(id,t)){
      assert.ok(b.containsXZ(p.x,p.z),`${s.name} ${id} shore ${t} ${JSON.stringify(p)}`);
      assert.ok(p.y>=b.bedAt(p.x,p.z)-0.05,`${s.name} ${id} bed ${t}`);
      assert.ok(p.y<=b.waterY+0.05,`${s.name} ${id} air ${t}`);
   }
   const before=life.scaleY;life.setScaleY(before/5);assert.equal(life.scaleY,1);life.dispose();
 }
});
test('a common divider bank cannot occupy the neighbouring mapped water',()=>{
 const neighbour=[[204,-250],[600,-250],[600,250],[204,250]];
 const b=buildWaterBody(spec,square,()=>50,{otherWater:[neighbour]});
 for(let i=0;i<b.bankPos.length;i+=9){const p=b.bankPos,x=(p[i]+p[i+3]+p[i+6])/3,z=(p[i+2]+p[i+5]+p[i+8])/3;assert.ok(!inRing(x,z,neighbour));}
});
test('mapped islands stay dry in the water top, floor and navigation',()=>{
 const hole=[[-20,-20],[20,-20],[20,20],[-20,20]];
 const b=buildWaterBody({...spec,holes:[hole],shoreSlope:0},square,()=>50);
 assert.ok(!b.containsXZ(0,0));assert.equal(b.bedAt(0,0),null);
 assert.equal(triangleSampler(b.topPos)(0,0),null);
 assert.ok(b.containsXZ(40,0));assert.ok(b.bedAt(40,0)!=null);
});
test('the shipped walker physics climbs each measured bank, crosses its crest, and enters swimming',async()=>{
 const {createCollisionService}=await import('../src/modes/collision.js');
 const {createBody,stepBody,PEDESTRIAN_TUNABLES}=await import('../src/modes/pedestrian-body.js');
 const P=Object.fromEntries(PEDESTRIAN_TUNABLES.map(p=>[p.key,p.default]));
 for(const s of data.bodies.filter(b=>b.bank)) {
  const g=s.bank.groundAodM*5,b=buildWaterBody(s,s.rings[0],()=>g);
  let longest=0,j=0;
  for(let i=0;i<b.original.length;i++){const a=b.original[i],c=b.original[(i+1)%b.original.length],l=Math.hypot(a[0]-c[0],a[1]-c[1]);if(l>longest){longest=l;j=i;}}
  const k=(j+1)%b.original.length,a=[(b.original[j][0]+b.original[k][0])/2,(b.original[j][1]+b.original[k][1])/2],o=[(b.outer[j][0]+b.outer[k][0])/2,(b.outer[j][1]+b.outer[k][1])/2];
  const len=Math.hypot(a[0]-o[0],a[1]-o[1]),dx=(a[0]-o[0])/len,dz=(a[1]-o[1])/len;
  const col=createCollisionService({getGroundY:(x,z)=>b.groundAt(x,z)??g,getWaterSurfaceY:(x,z)=>b.containsXZ(x,z)?b.waterY:null,isSubmerged:(x,y,z)=>b.contains({x,y,z})});
  const walker=createBody();Object.assign(walker,{x:o[0]-dx*2,z:o[1]-dz*2,y:g});
  let peak=g,swim=false;
  for(let t=0;t<2400;t++) {
   stepBody(walker,{forward:1,yaw:Math.atan2(-dx,-dz)},1/60,col,P,5);
   peak=Math.max(peak,walker.y);if(walker.state==='swim'){swim=true;break;}
   assert.ok(walker.y>=(col.groundHeightAt(walker.x,walker.z)??g)-.01,s.name+' through ground');
  }
  assert.ok(peak>=b.crestY-.02,s.name+' reaches crest');assert.ok(swim,s.name+' enters water');
 }
});

test('raised banks cannot cover any neighbouring unchanged 2D water',()=>{
 for(const s of data.bodies.filter(b=>b.bank)) {
  const other=data.bodies.filter(b=>b!==s).flatMap(b=>b.rings);
  const bank=buildWaterBody(s,s.rings[0],()=>50,{otherWater:other}).bankPos;
  for(const shallow of data.bodies.filter(b=>b.mode==='2D'))for(let i=0;i<bank.length;i+=9) {
   const x=(bank[i]+bank[i+3]+bank[i+6])/3,z=(bank[i+2]+bank[i+5]+bank[i+8])/3;
   assert.ok(!shallow.rings.some(r=>inRing(x,z,r)),s.name+' overlaps '+shallow.name);
  }
 }
});
test('off-screen basins and dormant animals leave render traversal, and return on a dive',()=>{
 const far=square.map(([x,z])=>[x+100000,z]);
 const source={...spec,mode:'VOLUME',rings:[square],level:{aodM:23},area:{ha:16},seaLife:true};
 const steps=createDeepWaterSteps({bodies:[source,{...source,id:'far',rings:[far]}]},()=>50,null);
 let r;do{r=steps.next();}while(!r.done);const water=r.value;
 let animalMatrixVisits=0;
 for(const b of water.bodies)b.life.group.traverse(o=>{if(o.isMesh){const update=o.updateMatrixWorld;o.updateMatrixWorld=function(force){animalMatrixVisits++;return update.call(this,force);};}});
 const camera=new THREE.PerspectiveCamera(55,1.6,1,50000);
 camera.position.set(0,1500,1000);camera.lookAt(0,115,0);water.update(0,camera);
 assert.ok(water.bodies[0].group.visible);assert.ok(!water.bodies[1].group.visible);
 water.group.updateMatrixWorld(true);assert.equal(animalMatrixVisits,0,'dormant animal meshes do no scene matrix work');
 const b=water.bodies[0];camera.position.set(0,90,0);camera.lookAt(100,80,0);
 water.update(0,camera,{submerged:true,belowSurface:true});water.group.updateMatrixWorld(true);
 assert.ok(b.group.visible);assert.ok(b.life.group.visible);assert.ok(animalMatrixVisits>0,'visible animals update their drawn world transforms');
 water.setSolo('canals');water.update(0,camera,{submerged:true,belowSurface:true});assert.ok(!b.group.visible);
 water.setSolo('all');animalMatrixVisits=0;camera.position.set(100000,1500,1000);camera.lookAt(100000,115,0);water.update(0,camera);
 assert.ok(!b.group.visible);assert.ok(water.bodies[1].group.visible);water.group.updateMatrixWorld(true);assert.equal(animalMatrixVisits,0);assert.ok(water.contains(0,90,0),'off-screen water retains physical membership');
 for(const b of water.bodies)b.life.dispose();
});
