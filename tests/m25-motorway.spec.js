import {test,expect} from '@playwright/test';
import {createMotorway,getMotorwayBoundary,MOTORWAY_DATA} from '../src/m25-motorway.js';
import airportData from '../src/airport-data.json' with {type:'json'};
const inside=(p,ring)=>{const[x,z]=p;let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>z)!==(ring[j][1]>z)&&x<(ring[j][0]-ring[i][0])*(z-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])hit=!hit;return hit;};
const byId=new Map(MOTORWAY_DATA.roads.map(w=>[w.id,w]));
test('directed circuits join exact source nodes, include both Dartford bores and have credible orbital length',()=>{
 for(const r of MOTORWAY_DATA.routes){expect(r.lengthM).toBeGreaterThan(185000);expect(r.lengthM).toBeLessThan(195000);let maxGap=0;for(let i=0;i<r.wayIds.length;i++){const a=byId.get(r.wayIds[i]),b=byId.get(r.wayIds[(i+1)%r.wayIds.length]);maxGap=Math.max(maxGap,Math.hypot(a.points.at(-1)[0]-b.points[0][0],a.points.at(-1)[1]-b.points[0][1]));}expect(maxGap).toBeLessThan(.01);}
 expect(new Set(MOTORWAY_DATA.routes.flatMap(r=>r.wayIds.filter(id=>byId.get(id).ref==='A282'&&byId.get(id).tunnel))).size).toBe(2);expect(MOTORWAY_DATA.roads.some(w=>w.id===20003982&&w.bridge)).toBeTruthy();
});
test('support boundary is simple and contains every source road and airport runway vertex',()=>{
 const ring=getMotorwayBoundary();expect(ring[0]).toEqual(ring.at(-1));let outside=0;for(const w of MOTORWAY_DATA.roads)for(const p of w.points)if(!inside(p,ring))outside++;for(const a of airportData.airports)for(const r of a.runways)for(const p of r.points)if(!inside(p,ring))outside++;expect(outside).toBe(0);
 const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);let intersections=0;for(let i=1;i<ring.length;i++)for(let j=i+2;j<ring.length;j++){if(i===1&&j===ring.length-1)continue;const a=ring[i-1],b=ring[i],c=ring[j-1],d=ring[j];if(orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0)intersections++;}expect(intersections).toBe(0);
});
test('motorway geometry is finite and batched, clear of terrain outside genuine tunnels',()=>{
 const g=createMotorway({getSurfaceY:()=>40});expect(g.userData.stats.drawCalls).toBeLessThan(24);expect(g.userData.stats.vehicles).toBeGreaterThan(10000);let bad=0,buried=0;g.traverse(m=>{if(!m.isMesh)return;expect(m.instanceColor).toBeFalsy();for(const p of m.geometry.attributes.position.array)if(!Number.isFinite(p))bad++;});
 for(const rp of g.userData.roadPaths.values())for(const p of rp.samples)if(!rp.road.tunnel&&p.baseY+p.deltaY<39.9)buried++;expect(bad).toBe(0);expect(buried).toBe(0);g.userData.dispose();
});
test('slow traffic advances in both directed routes and preserves pause, distant phase and loop seam',()=>{
 const g=createMotorway({getSurfaceY:()=>20}),routes=g.userData.routes;expect(new Set(routes.map(r=>r.direction)).size).toBe(2);const before=g.userData.getElapsed();g.userData.update(0,{position:{x:1e6,y:0,z:1e6}});expect(g.userData.getElapsed()).toBe(before);g.userData.update(10,{position:{x:1e6,y:0,z:1e6}});expect(g.userData.getElapsed()).toBe(10);
 for(const r of routes){const a=g.userData.pointAt(r.id,0),b=g.userData.pointAt(r.id,25),seam=g.userData.pointAt(r.id,r.length);expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeCloseTo(25,0);expect(seam.x).toBeCloseTo(a.x,5);expect(seam.z).toBeCloseTo(a.z,5);}g.userData.dispose();
});
test('structure height roundtrips without drift and never triggers per-frame terrain queries',()=>{
 let calls=0;const g=createMotorway({getSurfaceY:()=>{calls++;return 30;}}),mesh=g.children.find(m=>m.name==='m25-road'),p=mesh.geometry.attributes.position.array,initial=new Float32Array(p);const builtCalls=calls;g.userData.setHeightScale(.2);g.userData.setHeightScale(1);let error=0;for(let i=0;i<p.length;i++)error=Math.max(error,Math.abs(p[i]-initial[i]));expect(error).toBe(0);for(let i=0;i<12;i++)g.userData.update(1/60,{position:{x:0,y:0,z:0}});expect(calls).toBe(builtCalls);g.userData.dispose();
});
test('missing terrain fails explicitly',()=>{expect(()=>createMotorway({getSurfaceY:()=>null})).toThrow('Missing motorway terrain');});


test('both foundation feet meet their actual edge terrain on cross-slopes at structure1x and5x',()=>{
 // A2% physical cross-slope becomes0.1 scene-Y per horizontal metre at VE5.
 // Test rendered feet against the analytic ground, independently of retained samples.
 const terrain=({x,z})=>100+x*.1+z*.035;
 const g=createMotorway({getSurfaceY:terrain});
 const geometry=g.children.find(m=>m.name==='m25-foundation').geometry;
 const positions=geometry.attributes.position,bases=geometry.attributes.motorwayBase;
 const original=geometry.userData.original;
 const feet=[];
 for(let i=0;i<positions.count;i++)if(Math.abs(original[i*3+1]-(bases.getX(i)-.4))<.02)feet.push(i);
 expect(feet.length).toBeGreaterThan(100000);
 for(const scale of [.2,1]){
  g.userData.setHeightScale(scale);
  let highestGap=-Infinity,largestDepth=0;
  for(const i of feet){const ground=terrain({x:positions.getX(i),z:positions.getZ(i)}),gap=positions.getY(i)-ground;highestGap=Math.max(highestGap,gap);largestDepth=Math.max(largestDepth,-gap);}
  expect(highestGap).toBeLessThan(-.05);
  expect(largestDepth).toBeLessThan(.42);
 }
 g.userData.dispose();
});


test('joined full-width road endpoints clear sloping terrain and match traffic profiles',()=>{
 const terrain=({x,z})=>100+x*.1+z*.035;
 const g=createMotorway({getSurfaceY:terrain});
 let lowestClearance=Infinity,maxJoinGap=0,maxTrafficGap=0;
 const starts=new Map();
 for(const rp of g.userData.roadPaths.values()){const s=rp.samples[0];starts.set(`${s.x}:${s.z}`,s);}
 for(const rp of g.userData.roadPaths.values()){
  const half=(rp.road.lanes*3.5+2.4)*1.18/2;
  if(!rp.road.tunnel&&!rp.road.bridge)for(const s of rp.samples)for(const side of [-1,1])for(const scale of [.2,1]){
   const ground=terrain({x:s.x-s.dz*side*half,z:s.z+s.dx*side*half});
   lowestClearance=Math.min(lowestClearance,s.baseY+s.deltaY*scale-ground);
  }
  const s=rp.samples.at(-1),next=starts.get(`${s.x}:${s.z}`);
  if(next)maxJoinGap=Math.max(maxJoinGap,Math.abs(s.baseY+s.deltaY-next.baseY-next.deltaY));
 }
 for(const r of g.userData.routes)for(const s of r.path.slice(0,-1)){
  const rp=g.userData.roadPaths.get(s.road),rendered=rp.samples.find(p=>p.x===s.x&&p.z===s.z);
  maxTrafficGap=Math.max(maxTrafficGap,Math.abs(s.baseY+s.deltaY-rendered.baseY-rendered.deltaY));
 }
 expect(lowestClearance).toBeGreaterThan(.15);
 expect(maxJoinGap).toBeLessThan(1e-8);
 expect(maxTrafficGap).toBeLessThan(1e-8);
 g.userData.dispose();
});


test('adaptive road strips clear an interior terrain ridge at both structure scales',()=>{
 const way=MOTORWAY_DATA.roads.find(w=>w.id===419236485);
 const a=way.points[0],b=way.points[1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.ceil(length/12),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
 const centre={x:a[0]+(b[0]-a[0])/count*.5,z:a[1]+(b[1]-a[1])/count*.5};
 // A piecewise planar crest lies between the previous12m road samples.
 const terrain=({x,z})=>30+Math.max(0,6-Math.abs((x-centre.x)*dx+(z-centre.z)*dz)*2);
 const g=createMotorway({getSurfaceY:terrain}),rp=g.userData.roadPaths.get(way.id),half=(way.lanes*3.5+2.4)*1.18/2;
 expect(g.userData.stats.adaptiveSamples).toBeGreaterThan(0);
 let maximumBurial=-Infinity;
 for(let i=1;i<rp.samples.length;i++){const a=rp.samples[i-1],b=rp.samples[i];for(let k=1;k<32;k++)for(const side of [-1,-.5,0,.5,1])for(const scale of [.2,1]){
  const t=k/32,x=(a.x-a.dz*side*half)*(1-t)+(b.x-b.dz*side*half)*t,z=(a.z+a.dx*side*half)*(1-t)+(b.z+b.dx*side*half)*t;
  const y=(a.baseY+a.deltaY*scale)*(1-t)+(b.baseY+b.deltaY*scale)*t;
  maximumBurial=Math.max(maximumBurial,terrain({x,z})-y);
 }}
 expect(maximumBurial).toBeLessThan(.05);
 // Newly inserted source-distance points must also reach the traffic paths.
 for(const r of g.userData.routes)if(r.wayIds.includes(way.id))expect(r.path.filter(p=>p.road===way.id)).toHaveLength(rp.samples.length-1);
 g.userData.dispose();
});

test('projected vehicle LOD partitions every stable identity once and preserves lane position, colour and phase',async()=>{
 const {PerspectiveCamera}=await import('three');
 const g=createMotorway({getSurfaceY:()=>30,viewportHeightPx:1800});
 const camera=new PerspectiveCamera(55,1.6,1,100000),total=g.userData.stats.vehicles;
 const update=()=>{camera.updateMatrixWorld(true);for(let i=0;i<3;i++)g.userData.update(0,camera);};
 const checkPartition=()=>{
  const ids=[],colour=[];let far=0,near=0,maxPositionError=0;
  for(const mesh of g.children.filter(m=>m.isInstancedMesh)){
   expect(mesh.instanceColor).toBeFalsy();expect(mesh.visible).toBe(mesh.count>0);
   for(let i=0;i<mesh.count;i++){
    const id=mesh.userData.vehicleIds[i],p=g.userData.vehicleAt(id),a=mesh.instanceMatrix.array,o=i*16;
    ids.push(id);colour.push([id,mesh.userData.colour]);
    if(mesh.userData.lod==='far')far++;else near++;
    maxPositionError=Math.max(maxPositionError,Math.abs(a[o+12]-p.x),Math.abs(a[o+14]-p.z),Math.abs(a[o+13]-(p.y+.88*5)));
   }
  }
  expect(maxPositionError).toBeLessThan(.003);
  expect(ids.length).toBe(total);expect(new Set(ids).size).toBe(total);
  expect(Math.min(...ids)).toBe(0);expect(Math.max(...ids)).toBe(total-1);
  expect(g.userData.trafficLod.near).toBe(near);expect(g.userData.trafficLod.far).toBe(far);
  return colour.sort((a,b)=>a[0]-b[0]);
 };
 camera.position.set(0,30067,26000);camera.lookAt(0,67,0);update();
 const colour=checkPartition();expect(g.userData.trafficLod.far).toBe(total);expect(g.userData.trafficLod.triangles).toBe(total*2);
 const phases=Array.from({length:total},(_,id)=>g.userData.vehicleAt(id).distance);
 const first=g.userData.vehicleAt(0);camera.position.set(first.x,first.y+60,first.z+40);camera.lookAt(first.x,first.y,first.z);update();
 expect(g.userData.trafficLod.near).toBeGreaterThan(0);expect(checkPartition()).toEqual(colour);
 let phaseError=0;for(let id=0;id<total;id++)phaseError=Math.max(phaseError,Math.abs(g.userData.vehicleAt(id).distance-phases[id]));expect(phaseError).toBe(0);
 g.userData.update(4,camera);expect(g.userData.getElapsed()).toBe(4);
 // Sprint 23Sep26w: each vehicle now carries a bounded speed variation, so
 // 4s no longer advances exactly 10m. The position must equal the pure
 // function of (identity, elapsed) and stay within the variation bound of
 // the common 2.5 m/s advance.
 for(const id of [0,100,total-1]){const p=g.userData.vehicleAt(id),r=g.userData.routes.find(r=>r.id===p.routeId);expect(p.distance).toBeCloseTo(g.userData.vehicleChainageAt(id,4),7);const advance=((p.distance-phases[id])%r.length+r.length)%r.length;expect(Math.abs(advance-10)).toBeLessThan(2*3+.05);}
 g.userData.dispose();
});

test('vehicle detail responds to lens and Master view with native-pixel hysteresis',async()=>{
 const {PerspectiveCamera}=await import('three');
 const {createVerticalScaleController}=await import('../src/vertical-scale.js');
 const {motorwayVehiclePixelSize}=await import('../src/m25-motorway.js');
 const camera=new PerspectiveCamera(55,1.6,1,100000),g=createMotorway({getSurfaceY:()=>30,viewportHeightPx:1800}),p=g.userData.vehicleAt(0);
 const radius=Math.hypot(1.05,1.125*5,2.2),factor=camera.projectionMatrix.elements[5]*1800;
 const detail=()=>g.children.find(m=>m.isInstancedMesh&&Array.from(m.userData.vehicleIds.subarray(0,m.count)).includes(0)).userData.lod;
 const setPixels=pixels=>{camera.position.set(p.x,p.y,p.z+radius+factor*radius/pixels);camera.lookAt(p.x,p.y,p.z);camera.updateMatrixWorld(true);for(let i=0;i<3;i++)g.userData.update(0,camera);};
 setPixels(3);expect(detail()).toBe('near');setPixels(2);expect(detail()).toBe('far');setPixels(3);expect(detail()).toBe('far');setPixels(4);expect(detail()).toBe('near');
 const pixels=()=>motorwayVehiclePixelSize(camera,p,{viewportHeightPx:1800});
 camera.setFocalLength(20);const wide=pixels();camera.setFocalLength(100);expect(pixels()).toBeGreaterThan(wide*4);
 const master=createVerticalScaleController({camera,value:5});const normal=pixels();master.setValue(10);expect(pixels()).toBeGreaterThan(normal*1.9);
 master.dispose();g.userData.dispose();
});
