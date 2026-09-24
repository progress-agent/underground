import * as THREE from 'three';
import source from './m25-motorway-data.json' with { type: 'json' };
import { WATER_LIFT } from './render-layers.js';
import { VEHICLE_TYPES, VEHICLE_COLOURS, TRAFFIC_SPEED_MPS, buildTrafficLayout, vehicleChainage, laneFor, buildVehicleGeometry } from './m25-traffic.js';

export const MOTORWAY_DATA=source;
export const MOTORWAY_TERRAIN_MARGIN_M=40;
export const MOTORWAY_REPLACED_BRIDGES=['qe2','runnymede'];
// Vehicle colours live in m25-traffic.js (sprint 23Sep26w); these are the road's.
const PALETTE={road:0x626667,edge:0xc3bba6,marking:0xe4e5dd,barrier:0xb9c7c6,foundation:0x807d70,pylon:0xcbd3d2,cable:0x839499};
const mod=(a,b)=>(a%b+b)%b;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const widthFor=w=>(w.lanes*3.5+2.4)*1.18;
/** Rendered carriageway width (lanes plus hard shoulder, x1.18 legibility). */
export const motorwayRoadWidth=widthFor;
const byId=new Map(source.roads.map(w=>[w.id,w]));
const defaultViewportHeight = () => typeof window === 'undefined' ? 900 : window.innerHeight * (window.devicePixelRatio || 1);
const LOD_FAR_PX = 2.5, LOD_NEAR_PX = 3.5;
function trafficProjection(camera, heightPx) {
  if (!camera?.matrixWorldInverse || !camera?.projectionMatrix) return null;
  const v=camera.matrixWorldInverse.elements,m=camera.matrixWorld.elements,q=camera.projectionMatrix.elements;
  const widthPx=heightPx*(camera.aspect || 1);
  const factor=Math.max(Math.abs(q[0])*widthPx*Math.hypot(v[0],v[4],v[8]),Math.abs(q[5])*heightPx*Math.hypot(v[1],v[5],v[9]));
  const right=new THREE.Vector3(m[0],m[1],m[2]).normalize(),up=new THREE.Vector3(m[4],m[5],m[6]).normalize();
  return {v,m,q,factor,right,up,depthFactor:Math.hypot(v[2],v[6],v[10]),key:[heightPx,...v,...q].join(',')};
}
function vehiclePixelSize(projection,point,radius) {
  if(!projection)return Infinity;
  const v=projection.v,depth=-(v[2]*point.x+v[6]*point.y+v[10]*point.z+v[14]);
  if(depth<=0)return 0;
  return projection.factor*radius/Math.max(.001,depth-radius*projection.depthFactor);
}
/** Conservative native-pixel diameter; independent of adaptive render scale.
 * Canonical camera view rows include the full-scene master transform. */
export function motorwayVehiclePixelSize(camera,point,{VE=5,heightScale=1,viewportHeightPx=defaultViewportHeight()}={}) {
  return vehiclePixelSize(trafficProjection(camera,viewportHeightPx),point,Math.hypot(1.05,1.125*VE*heightScale,2.2));
}

/** Buffer is supplied separately from the real road alignment. Use these canonical
 * points for BOTH clipping mask and edge curtain; never move the road to its buffer. */
export function getMotorwayBoundary(margin=MOTORWAY_TERRAIN_MARGIN_M){
 const ring=source.boundary.points.slice(0,-1);let area=0;for(let i=0;i<ring.length;i++){const b=ring[(i+1)%ring.length];area+=ring[i][0]*b[1]-b[0]*ring[i][1];}const sign=area>0?1:-1;
 const out=ring.map((p,i)=>{const a=ring[mod(i-1,ring.length)],b=ring[(i+1)%ring.length],l1=Math.hypot(p[0]-a[0],p[1]-a[1]),l2=Math.hypot(b[0]-p[0],b[1]-p[1]);const n1=[sign*(p[1]-a[1])/l1,-sign*(p[0]-a[0])/l1],n2=[sign*(b[1]-p[1])/l2,-sign*(b[0]-p[0])/l2],sx=n1[0]+n2[0],sz=n1[1]+n2[1],l=Math.hypot(sx,sz)||1,nx=sx/l,nz=sz/l,k=Math.min(margin*2,margin/Math.max(.5,nx*n1[0]+nz*n1[1]));return [p[0]+nx*k,p[1]+nz*k];});out.push([...out[0]]);
 // Remove tiny inward loops created when buffering a sharp mapped lane split.
 // This is polygon-offset repair, never a replacement road alignment.
 for(let pass=0;pass<8;pass++){let repaired=false;outer:for(let i=1;i<out.length;i++)for(let j=i+2;j<out.length;j++){if(i===1&&j===out.length-1)continue;const a=out[i-1],b=out[i],c=out[j-1],d=out[j],rx=b[0]-a[0],rz=b[1]-a[1],sx=d[0]-c[0],sz=d[1]-c[1],den=rx*sz-rz*sx;if(Math.abs(den)<1e-8)continue;const t=((c[0]-a[0])*sz-(c[1]-a[1])*sx)/den,u=((c[0]-a[0])*rz-(c[1]-a[1])*rx)/den;if(t>0&&t<1&&u>0&&u<1){if(j-i>12)throw new Error('Unexpected large self-crossing in motorway support margin');out.splice(i,j-i,[a[0]+t*rx,a[1]+t*rz]);repaired=true;break outer;}}if(!repaired)break;}return out;
}

export function createMotorway({getSurfaceY,VE=5,heightScale=1,vehicleSpacing=28,viewportHeightPx=defaultViewportHeight}={}){
 if(typeof getSurfaceY!=='function')throw new Error('Motorway requires canonical getSurfaceY');
 const sample=(x,z)=>{const y=getSurfaceY({x,z});if(!Number.isFinite(y))throw new Error(`Missing motorway terrain at ${x},${z}`);return y;};
 const root=new THREE.Group();root.name='m25Motorway';const waterY=2*VE+WATER_LIFT;let scale=heightScale,elapsed=0,frame=0;
 const materials=Object.fromEntries(Object.entries(PALETTE).map(([k,color])=>[k,new THREE.MeshStandardMaterial({color,roughness:k==='roof'?.45:.87,metalness:k==='barrier'?.2:0,fog:true,side:THREE.DoubleSide})]));
 const roadPaths=new Map();
 function makeRoad(w){const samples=[];let distance=0;for(let i=1;i<w.points.length;i++){const a=w.points[i-1],b=w.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const count=Math.ceil(len/12),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,half=widthFor(w)/2;for(let j=0;j<count;j++){const t=j/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;const edgeGroundY=[sample(x+dz*half,z-dx*half),sample(x-dz*half,z+dx*half)];const groundY=Math.max(sample(x,z),...edgeGroundY);samples.push({x,z,dx,dz,distance:distance+len*t,groundY,edgeGroundY,baseY:groundY,deltaY:.8,road:w.id,tunnel:w.tunnel,bridge:Boolean(w.bridge)});}distance+=len;}
 const last=w.points.at(-1),prev=samples.at(-1);if(!prev)throw new Error(`Empty motorway way ${w.id}`);const half=widthFor(w)/2,edgeGroundY=[sample(last[0]+prev.dz*half,last[1]-prev.dx*half),sample(last[0]-prev.dz*half,last[1]+prev.dx*half)],groundY=Math.max(sample(...last),...edgeGroundY);samples.push({...prev,x:last[0],z:last[1],distance,groundY,edgeGroundY,baseY:groundY});return {road:w,samples,length:distance};}
 // A 12m chord can cut through a ridge between terrain triangles. Refine only
 // ordinary-road chords whose measured interior rises above the endpoint envelope.
 // Side vectors interpolate without renormalising, retaining the exact strip rails.
 let adaptiveSamples=0,maximumClearanceAdjustmentY=0;
 function refineRoad(rp){
  if(rp.road.tunnel||rp.road.bridge)return;
  const half=widthFor(rp.road)/2;
  const groundAt=s=>{
   s.edgeGroundY=[sample(s.x+s.dz*half,s.z-s.dx*half),sample(s.x-s.dz*half,s.z+s.dx*half)];
   s.groundY=Math.max(...s.edgeGroundY,...[-.5,0,.5].map(side=>sample(s.x-s.dz*side*half,s.z+s.dx*side*half)));
   s.baseY=s.groundY;return s;
  };
  for(const s of rp.samples)groundAt(s);
  const between=(a,b,t)=>groundAt({...a,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,dx:a.dx+(b.dx-a.dx)*t,dz:a.dz+(b.dz-a.dz)*t,distance:a.distance+(b.distance-a.distance)*t});
  const refined=[];
  function visit(a,b,depth){
   const interior=[.25,.5,.75].map(t=>between(a,b,t));
   const excess=Math.max(...interior.map((p,i)=>p.groundY-(a.groundY+(b.groundY-a.groundY)*(i+1)/4)));
   if(excess<=.05){refined.push(a);return;}
   if(depth===6){
    // At the bounded subdivision limit, use only the measured residual required
    // for this short segment. Foot elevations remain their actual edge samples.
    a.groundY+=excess;b.groundY+=excess;a.baseY=a.groundY;b.baseY=b.groundY;
    maximumClearanceAdjustmentY=Math.max(maximumClearanceAdjustmentY,excess);refined.push(a);return;
   }
   adaptiveSamples++;visit(a,interior[1],depth+1);visit(interior[1],b,depth+1);
  }
  for(let i=1;i<rp.samples.length;i++)visit(rp.samples[i-1],rp.samples[i],0);
  refined.push(rp.samples.at(-1));rp.samples=refined;
 }
 for(const w of source.roads)roadPaths.set(w.id,makeRoad(w));
 for(const rp of roadPaths.values())refineRoad(rp);
 // Build each complete source circuit, then calculate the raised/sunken transition
 // profiles across way boundaries. Each unique road is drawn once below.
 const routes=[];
 for(const r of source.routes){let distance=0;const path=[];for(const id of r.wayIds){const rp=roadPaths.get(id);for(const s of rp.samples.slice(0,-1))path.push({...s,distance:distance+s.distance});distance+=rp.length;}path.push({...path[0],distance});routes.push({...r,path,length:distance});}
 function profile(route){const p=route.path,n=p.length-1;let i=0;while(i<n){if(!p[i].bridge&&!p[i].tunnel){i++;continue;}const tunnel=p[i].tunnel,bridge=p[i].bridge,start=i;while(i<n&&p[i].tunnel===tunnel&&p[i].bridge===bridge)i++;const end=i-1,first=p[start],last=p[end],r=byId.get(first.road),isDartford=tunnel&&r.ref==='A282',qe2=!tunnel&&r.id===20003982;
 const transition=tunnel?0:qe2?0:110;let a=start,b=end;while(a>0&&first.distance-p[a].distance<transition)a--;while(b<n-1&&p[b].distance-last.distance<transition)b++;const span=p[b].distance-p[a].distance||1;
 for(let j=a;j<=b;j++){const s=p[j],t=(s.distance-p[a].distance)/span,linear=p[a].groundY+(p[b].groundY-p[a].groundY)*t;let y;
 if(tunnel){const depth=isDartford?Math.max(25*VE,(linear-waterY)+25*VE):6*VE;y=linear-depth*Math.sin(Math.PI*t);s.baseY=y;s.deltaY=.8;}
 else if(qe2){const envelope=smooth(Math.min(t,1-t)/.35);y=Math.max(s.groundY+.8,waterY+(54*VE+3)*envelope);s.baseY=waterY;s.deltaY=y-waterY;}
 else {const envelope=Math.sin(Math.PI*t)**2;y=Math.max(s.groundY+.8,linear+6*VE*envelope+.8);s.baseY=s.groundY;s.deltaY=y-s.groundY;}
 s.profileY=y;s.profileKind=tunnel?'tunnel':qe2?'qe2':'bridge';}
 }
 }
 for(const r of routes)profile(r);
 // Choose representative routes by direction and Dartford bore. Both northbound
 // tunnel alignments carry cars, while shared stretches are not rendered twice.
 const representative=[];const keys=new Set();for(const r of routes){const key=r.direction+':'+r.wayIds.filter(id=>byId.get(id).tunnel&&byId.get(id).ref==='A282').join(',');if(keys.has(key))continue;keys.add(key);representative.push(r);}
 // Apply a consistent profile to each shared source point using its first circuit.
 const profileMap=new Map();for(const r of routes)for(const s of r.path)if(!profileMap.has(`${s.road}:${s.x}:${s.z}`))profileMap.set(`${s.road}:${s.x}:${s.z}`,s);
 for(const rp of roadPaths.values())for(const s of rp.samples){const mapped=profileMap.get(`${s.road}:${s.x}:${s.z}`);if(mapped){s.baseY=mapped.baseY;s.deltaY=mapped.deltaY;s.profileKind=mapped.profileKind;}}
 // Every terminal road sample inherits the next way's shared endpoint profile.
 const endpointMap=new Map();for(const rp of roadPaths.values()){const s=rp.samples[0];endpointMap.set(`${s.x}:${s.z}`,s);}for(const rp of roadPaths.values()){const s=rp.samples.at(-1),next=endpointMap.get(`${s.x}:${s.z}`);if(next){s.baseY=next.baseY;s.deltaY=next.deltaY;s.profileKind=next.profileKind;}}
 // Joined ways can have different widths and tangents. Reconcile their shared
 // deck datum against every ordinary-road edge, rather than inheriting a narrower
 // neighbour's clearance. Both rendered roads and traffic use this same profile.
 const junctions=new Map();for(const rp of roadPaths.values())for(const s of [rp.samples[0],rp.samples.at(-1)]){const key=`${s.x}:${s.z}`;if(!junctions.has(key))junctions.set(key,[]);junctions.get(key).push({s,ordinary:!rp.road.tunnel&&!rp.road.bridge});}
 for(const entries of junctions.values()){const ordinary=entries.filter(e=>e.ordinary);if(!ordinary.length)continue;const baseY=Math.max(...entries.map(e=>e.s.baseY),...ordinary.map(e=>e.s.groundY));const top=Math.max(baseY+.8,...entries.map(e=>e.s.baseY+e.s.deltaY));for(const {s}of entries){s.baseY=baseY;s.deltaY=top-baseY;}}
 const finalProfiles=new Map();for(const rp of roadPaths.values())for(const s of rp.samples)finalProfiles.set(`${s.road}:${s.x}:${s.z}`,s);for(const r of routes)for(const s of r.path){const final=finalProfiles.get(`${s.road}:${s.x}:${s.z}`);s.baseY=final.baseY;s.deltaY=final.deltaY;}
 const batches=new Map(),staticMeshes=[];const ensure=mat=>{if(!batches.has(mat))batches.set(mat,{positions:[],bases:[]});return batches.get(mat);};
 const vertex=(mat,x,y,z,base)=>{const b=ensure(mat);b.positions.push(x,y,z);b.bases.push(base);};
 const quad=(mat,ps)=>{for(const i of [0,1,2,0,2,3])vertex(mat,...ps[i]);};
 const v=(s,side,dy=0)=>[s.x-s.dz*side,s.baseY+s.deltaY+dy,s.z+s.dx*side,s.baseY];
 function strip(a,b,l,r,mat,dy=0){quad(mat,[v(a,l,dy),v(b,l,dy),v(b,r,dy),v(a,r,dy)]);}
 function verticalStrip(a,b,side,lo,hi,mat){quad(mat,[v(a,side,lo),v(b,side,lo),v(b,side,hi),v(a,side,hi)]);}
 for(const rp of roadPaths.values()){const w=rp.road,p=rp.samples,half=widthFor(w)/2;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];strip(a,b,-half,half,'road');for(const side of [-1,1]){strip(a,b,side*half-.16,side*half+.16,'marking',.08);verticalStrip(a,b,side*(half+.3),0,.85*VE,'barrier');strip(a,b,side*(half+.3)-.13,side*(half+.3)+.13,'barrier',.85*VE);if(!w.tunnel&&!w.bridge){
 // The deck clears the highest transverse sample, but each foundation foot
 // must meet its own edge terrain. Its scale pivot is also that edge datum.
 const edge=side>0?1:0,groundA=a.edgeGroundY[edge],groundB=b.edgeGroundY[edge];const loA=Math.min(groundA-.4,a.baseY+a.deltaY),loB=Math.min(groundB-.4,b.baseY+b.deltaY);quad('foundation',[v(a,side*half),v(b,side*half),[b.x-b.dz*side*half,loB,b.z+b.dx*side*half,groundB],[a.x-a.dz*side*half,loA,a.z+a.dx*side*half,groundA]]);}}
 for(let lane=1;lane<w.lanes;lane++)if(Math.floor(a.distance/12)%2===0){const offset=-half+(2.4*1.18)/2+(3.5*1.18)*lane;strip(a,b,offset-.12,offset+.12,'marking',.09);}
 // Short supports under real tagged bridge decks, never under a whole ordinary road.
 if(w.bridge&&(w.id!==20003982||i<p.length*.35||i>p.length*.65)&&i%5===0){const y=a.baseY+a.deltaY,height=y-a.groundY;if(height>4)verticalStrip(a,{...a,x:a.x+a.dx*2.3,z:a.z+a.dz*2.3},0,-height,0,'foundation');}
 }}
 // QEII towers/cables follow the actual southern carriageway. Existing curated
 // bridge supplied the54m clearance and86m pylon proportions, not surveyed road Z.
 const qe=roadPaths.get(20003982);if(qe){const p=qe.samples;for(const fraction of [.5-225/qe.length,.5+225/qe.length]){const i=Math.floor((p.length-1)*fraction),s=p[i],deck=s.baseY+s.deltaY,top=deck+86*VE;for(const side of [-1,1]){const offset=widthFor(qe.road)/2+1.4;const x=s.x-s.dz*side*offset,z=s.z+s.dx*side*offset;for(const [ax,az,bx,bz]of [[-2.2,-2.2,2.2,-2.2],[2.2,-2.2,2.2,2.2],[2.2,2.2,-2.2,2.2],[-2.2,2.2,-2.2,-2.2]])quad('pylon',[[x+ax,s.groundY,z+az,s.groundY],[x+bx,s.groundY,z+bz,s.groundY],[x+bx,top,z+bz,s.baseY],[x+ax,top,z+az,s.baseY]]);for(let k=1;k<=7;k++)for(const sign of [-1,1]){const j=Math.max(0,Math.min(p.length-1,i+sign*k*4)),q=p[j],qx=q.x-q.dz*side*offset,qz=q.z+q.dx*side*offset;const cy=deck+(86*VE)*(.5+.5*k/7);quad('cable',[[x-.16,cy,z,s.baseY],[x+.16,cy,z,s.baseY],[qx+.16,q.baseY+q.deltaY,qz,q.baseY],[qx-.16,q.baseY+q.deltaY,qz,q.baseY]]);}}}}
 for(const [mat,b]of batches){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));g.setAttribute('motorwayBase',new THREE.Float32BufferAttribute(b.bases,1));g.computeVertexNormals();g.userData.original=new Float32Array(g.attributes.position.array);const mesh=new THREE.Mesh(g,materials[mat]);mesh.name=`m25-${mat}`;mesh.userData={type:'motorway',name:'M25 / A282 orbital motorway',part:mat};root.add(mesh);staticMeshes.push(mesh);}
 // ── Traffic (sprint 23Sep26w, D-037 Lane B) ─────────────────────────────
 // Stable identities: one per `vehicleSpacing` metres of each direction, the
 // anticlockwise count shared by its two Dartford-bore circuits (unchanged).
 // Placement, class and speed variation come from m25-traffic.js: a hashed,
 // deterministic renewal process per carriageway, so no platoons, no overlaps.
 const localUp=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),forward=new THREE.Vector3(),sideVector=new THREE.Vector3(),carriers=[];
 materials.traffic=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.1,fog:true});
 VEHICLE_COLOURS.forEach(c=>{
  // Unlit far silhouettes read a little brighter than the lit bodies; dim them.
  materials['far-'+c.id]=new THREE.MeshBasicMaterial({color:new THREE.Color(c.hex).multiplyScalar(.82),fog:true,side:THREE.DoubleSide});
 });
 let nextVehicleId=0,lastCamera=null,lastProjectionKey=null,lastElapsed=NaN;
 const trafficStats={near:0,far:0,triangles:0,drawCalls:0,updateMs:0,farBelowPx:LOD_FAR_PX,nearAbovePx:LOD_NEAR_PX};
 const nearMeshes=[],farMeshes=[];
 function buildTraffic(){
  for(const route of representative){
   const sharedDirection=route.direction==='anticlockwise'?2:1,count=Math.ceil(route.length/vehicleSpacing/sharedDirection);
   carriers.push({route,count,idOffset:nextVehicleId,lod:new Uint8Array(count)});
   nextVehicleId+=count;
  }
  const wayLength=id=>roadPaths.get(id).length;
  for(const direction of ['clockwise','anticlockwise']){
   const group=carriers.filter(c=>c.route.direction===direction);if(!group.length)continue;
   buildTrafficLayout(group,wayLength).forEach((layout,j)=>{group[j].layout=layout;});
  }
  // Capacity per mesh = identities of that class; every mesh is shared by all
  // carriers, so draw calls do not multiply with circuits.
  const nearCap=new Int32Array(VEHICLE_TYPES.length*VEHICLE_COLOURS.length),farCap=new Int32Array(VEHICLE_COLOURS.length);
  for(const c of carriers)for(let i=0;i<c.count;i++){nearCap[c.layout.type[i]*VEHICLE_COLOURS.length+c.layout.colour[i]]++;farCap[c.layout.colour[i]]++;}
  VEHICLE_TYPES.forEach((type,t)=>VEHICLE_COLOURS.forEach((colour,k)=>{
   const cap=Math.max(1,nearCap[t*VEHICLE_COLOURS.length+k]);
   const mesh=new THREE.InstancedMesh(buildVehicleGeometry(type.id,colour.hex),materials.traffic,cap);
   mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;mesh.visible=false;
   mesh.name=`m25-cars-near-${type.id}-${colour.id}`;
   mesh.userData={type:'motorway',name:'Slow motorway traffic',part:'traffic',lod:'near',vehicleType:type.id,colour:colour.id,trianglesPerVehicle:mesh.geometry.index.count/3,vehicleIds:new Int32Array(cap)};
   root.add(mesh);nearMeshes.push(mesh);
  }));
  VEHICLE_COLOURS.forEach((colour,k)=>{
   const cap=Math.max(1,farCap[k]);
   const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),materials['far-'+colour.id],cap);
   mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;mesh.visible=false;
   mesh.name=`m25-cars-far-${colour.id}`;
   mesh.userData={type:'motorway',name:'Slow motorway traffic',part:'traffic',lod:'far',colour:colour.id,trianglesPerVehicle:2,vehicleIds:new Int32Array(cap)};
   root.add(mesh);farMeshes.push(mesh);
  });
 }
 buildTraffic();
 function pointAt(route,distance,out={}){const p=route.path,d=mod(distance,route.length);let lo=0,hi=p.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(p[m].distance<=d)lo=m;else hi=m;}const a=p[lo],b=p[hi],t=(d-a.distance)/(b.distance-a.distance||1);out.x=a.x+(b.x-a.x)*t;out.z=a.z+(b.z-a.z)*t;out.y=(a.baseY+(b.baseY-a.baseY)*t)+((a.deltaY+(b.deltaY-a.deltaY)*t)*scale);out.dx=b.x-a.x;out.dz=b.z-a.z;const l=Math.hypot(out.dx,out.dz)||1;out.dx/=l;out.dz/=l;out.dy=((b.baseY+b.deltaY*scale)-(a.baseY+a.deltaY*scale))/l;out.road=a.road;out.tunnel=a.tunnel;return out;}
 const scratch={};
 function vehicleAt(c,i,out={}) {
  const L=c.layout,distance=vehicleChainage(L,i,elapsed),p=pointAt(c.route,distance,out),w=byId.get(p.road);
  // Lane 0 is the inside (left) lane: offsets are negative to the left of travel.
  const lane=laneFor(L.type[i],L.lanePick[i],w.lanes),offset=(lane-(w.lanes-1)/2)*3.5*1.18;
  p.x-=p.dz*offset;p.z+=p.dx*offset;p.id=c.idOffset+i;p.routeId=c.route.id;p.distance=mod(distance,c.route.length);p.lane=lane;
  p.vehicleType=VEHICLE_TYPES[L.type[i]].id;p.colour=VEHICLE_COLOURS[L.colour[i]].id;return p;
 }
 function writeMatrix(mesh,index,id,x,y,z,ax,ay,az,bx,by,bz,cx,cy,cz){
  const a=mesh.instanceMatrix.array,o=index*16;
  a[o]=ax;a[o+1]=ay;a[o+2]=az;a[o+3]=0;a[o+4]=bx;a[o+5]=by;a[o+6]=bz;a[o+7]=0;
  a[o+8]=cx;a[o+9]=cy;a[o+10]=cz;a[o+11]=0;a[o+12]=x;a[o+13]=y;a[o+14]=z;a[o+15]=1;
  mesh.userData.vehicleIds[index]=id;
 }
 const nearCounts=new Int32Array(VEHICLE_TYPES.length*VEHICLE_COLOURS.length),farCounts=new Int32Array(VEHICLE_COLOURS.length);
 // ── s24:R ── Frustum culling by route chunk (sprint 24Sep26h, D-038).
 // Off by default so the module keeps its whole-fleet partition contract; the
 // app switches it on. A vehicle outside the view frustum draws no pixels, so
 // skipping its recompute and upload leaves the picture unchanged. Positions
 // remain a pure function of elapsed time, so a skipped vehicle reappears
 // exactly where it would have been. Its near/far LOD state is simply held.
 // Fog cull (fix round 1): with THREE.Fog the fragment colour is exactly the
 // fog colour once view depth reaches fog.far (smoothstep saturates at 1), and
 // every surface behind a road vehicle there is fogged to the same colour, so
 // a chunk whose nearest point lies beyond fog.far is skipped as well.
 // revalidate(camera) runs just before the frame is drawn: if the camera or
 // the fog has changed since the last recompute (between the every-3rd-frame
 // updates, or after updateEnvironment moved fog.far) so that a skipped chunk
 // could now show, it writes that chunk from the SAME elapsed time and camera
 // snapshot the last recompute used. The frame is then the one the unculled
 // path would have drawn.
 const CHUNK_SAMPLES=32,CULL_MARGIN=60;
 let lastCulled=false,lastCullProjection=null,fogCullOn=true;
 const viewCentre=new THREE.Vector3();
 const sceneFog=()=>{let o=root;while(o.parent)o=o.parent;const f=o.isScene?o.fog:null;return f&&f.isFog&&Number.isFinite(f.far)?f:null;};
 let cullToFrustum=false,uploadRanges=false,skipHidden=false,chunkScale=NaN;
 const shown=()=>{for(let o=root;o;o=o.parent)if(o.visible===false)return false;return true;};
 const frustum=new THREE.Frustum(),viewProjection=new THREE.Matrix4(),sphere=new THREE.Sphere();
 const chunksByRoute=new Map();
 for(const c of carriers){if(chunksByRoute.has(c.route))continue;const p=c.route.path,list=[];
  for(let i0=0;i0<p.length-1;i0+=CHUNK_SAMPLES){const i1=Math.min(p.length-1,i0+CHUNK_SAMPLES);list.push({i0,i1,d0:p[i0].distance,cx:0,cy:0,cz:0,r:0,visible:true});}
  chunksByRoute.set(c.route,{list,starts:Float64Array.from(list,k=>k.d0)});}
 function chunkBounds(){
  chunkScale=scale;
  for(const [route,{list}] of chunksByRoute){const p=route.path;for(const k of list){
   let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
   for(let i=k.i0;i<=k.i1;i++){const s=p[i],y=s.baseY+s.deltaY*scale;if(s.x<minX)minX=s.x;if(s.x>maxX)maxX=s.x;if(y<minY)minY=y;if(y>maxY)maxY=y;if(s.z<minZ)minZ=s.z;if(s.z>maxZ)maxZ=s.z;}
   k.cx=(minX+maxX)/2;k.cy=(minY+maxY)/2;k.cz=(minZ+maxZ)/2;k.r=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)/2+CULL_MARGIN+2*VE*scale;}}
 }
 const viewKey=new Float64Array(33);let viewKeyKind=0; // 0 none stored, 1 no camera, 2 numbers
 function storeViewKey(camera,height){
  if(!camera?.matrixWorldInverse||!camera?.projectionMatrix){viewKeyKind=1;return;}
  const v=camera.matrixWorldInverse.elements,q=camera.projectionMatrix.elements;viewKey[0]=height;
  for(let i=0;i<16;i++){viewKey[1+i]=v[i];viewKey[17+i]=q[i];}viewKeyKind=2;
 }
 function sameViewKey(camera,height){
  if(!camera?.matrixWorldInverse||!camera?.projectionMatrix)return viewKeyKind===1;
  if(viewKeyKind!==2||viewKey[0]!==height)return false;
  const v=camera.matrixWorldInverse.elements,q=camera.projectionMatrix.elements;
  for(let i=0;i<16;i++)if(viewKey[1+i]!==v[i]||viewKey[17+i]!==q[i])return false;
  return true;
 }
 function chunkCanShow(k,fog,view,viewScale){
  sphere.center.set(k.cx,k.cy,k.cz);sphere.radius=k.r;
  if(!frustum.intersectsSphere(sphere))return false;
  if(fog){const depth=-viewCentre.set(k.cx,k.cy,k.cz).applyMatrix4(view).z;if(depth-k.r*viewScale>=fog.far){trafficStats.fogCulledChunks++;return false;}}
  return true;
 }
 function prepareCull(camera){
  if(chunkScale!==scale)chunkBounds();
  viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(viewProjection);
  return fogCullOn?sceneFog():null;
 }
 function markVisibleChunks(camera){
  const fog=prepareCull(camera),view=camera.matrixWorldInverse,viewScale=view.getMaxScaleOnAxis();
  let any=false;trafficStats.fogCulledChunks=0;
  for(const {list} of chunksByRoute.values())for(const k of list){k.visible=chunkCanShow(k,fog,view,viewScale);any||=k.visible;}
  return any;
 }
 // Before the draw: widen the written set to any chunk that can now show.
 function revalidate(camera=lastCamera){
  if(!lastCulled||!cullToFrustum||!camera?.projectionMatrix||!lastCullProjection)return false;
  if(skipHidden&&!shown())return false;
  const fog=prepareCull(camera),view=camera.matrixWorldInverse,viewScale=view.getMaxScaleOnAxis();
  let grew=false;
  for(const {list} of chunksByRoute.values())for(const k of list)if(!k.visible&&chunkCanShow(k,fog,view,viewScale)){k.visible=true;grew=true;}
  if(!grew)return false;
  const now=elapsed;elapsed=lastElapsed;
  try{writeFleet(lastCullProjection,true);}finally{elapsed=now;}
  trafficStats.revalidations=(trafficStats.revalidations||0)+1;
  return true;
 }
 function chunkVisible(route,distance){
  const {list,starts}=chunksByRoute.get(route);let lo=0,hi=starts.length-1;
  while(lo<hi){const m=(lo+hi+1)>>1;if(starts[m]<=distance)lo=m;else hi=m-1;}
  return list[lo].visible;
 }
 // ── /s24:R ──
 function update(dt,camera,force=false){
  if(Number.isFinite(dt)&&dt>0)elapsed+=dt;
  if(camera)lastCamera=camera;
  // ── s24:R ── hidden layer: time advances, nothing is recomputed or uploaded
  if(skipHidden&&!force&&!shown()){lastProjectionKey=null;trafficStats.skippedHidden=(trafficStats.skippedHidden||0)+1;return;}
  // ── /s24:R ──
  frame++;trafficStats.frame=frame;if(!force&&frame%3)return; // s24:R: frame exposed for cadence tests
  const height=typeof viewportHeightPx==='function'?viewportHeightPx():viewportHeightPx;
  // ── s24:R ── a still camera on a paused clock returns before the projection
  // (and its 33-number key string) is built: no allocation when nothing moved.
  if(!force&&elapsed===lastElapsed&&lastProjectionKey!==null&&sameViewKey(lastCamera,height))return;
  // ── /s24:R ──
  const projection=trafficProjection(lastCamera,height),key=projection?.key||'none';
  if(!force&&elapsed===lastElapsed&&key===lastProjectionKey)return;
  const start=performance.now();lastElapsed=elapsed;lastProjectionKey=key;
  storeViewKey(lastCamera,height); // s24:R
  // ── s24:R ──
  const culling=cullToFrustum&&!!lastCamera?.projectionMatrix;
  if(!culling)trafficStats.fogCulledChunks=0;
  if(culling){markVisibleChunks(lastCamera);lastCullProjection=projection&&{...projection,v:projection.v.slice(),m:projection.m.slice(),q:projection.q.slice()};}
  lastCulled=culling;
  writeFleet(projection,culling);
  trafficStats.updateMs=performance.now()-start;
 }
 function writeFleet(projection,culling){
  // ── /s24:R ──
  trafficStats.near=0;trafficStats.far=0;trafficStats.triangles=0;trafficStats.drawCalls=0;
  // LOD radius stays the car's, so the switch is identical for every identity.
  const radius=Math.hypot(1.05,1.125*VE*scale,2.2),verticalScale=VE*scale;
  nearCounts.fill(0);farCounts.fill(0);
  trafficStats.culled=0; // s24:R
  for(const c of carriers){
   const L=c.layout;
   for(let i=0;i<c.count;i++){
    // ── s24:R ──
    if(culling&&!chunkVisible(c.route,mod(vehicleChainage(L,i,elapsed),c.route.length))){trafficStats.culled++;continue;}
    // ── /s24:R ──
    const p=vehicleAt(c,i,scratch),pixels=vehiclePixelSize(projection,p,radius);
    if(c.lod[i]){if(pixels>LOD_NEAR_PX)c.lod[i]=0;}else if(pixels<LOD_FAR_PX)c.lod[i]=1;
    const type=L.type[i],colour=L.colour[i];
    if(c.lod[i]){
     trafficStats.far++;
     // Face the view, with the long axis following the projected source-road
     // heading. The two-triangle silhouette retains one record per vehicle,
     // scaled to its type's width and length.
     const v=projection.v,right=projection.right,camUp=projection.up,T=VEHICLE_TYPES[type];
     let sx=(v[0]*p.dx+v[4]*p.dy+v[8]*p.dz),sy=(v[1]*p.dx+v[5]*p.dy+v[9]*p.dz);
     const length=Math.hypot(sx,sy);if(length>1e-8){sx/=length;sy/=length;}else{sx=0;sy=1;}
     const ax=right.x*sy-camUp.x*sx,ay=right.y*sy-camUp.y*sx,az=right.z*sy-camUp.z*sx;
     const bx=right.x*sx+camUp.x*sy,by=right.y*sx+camUp.y*sy,bz=right.z*sx+camUp.z*sy;
     const mesh=farMeshes[colour];
     writeMatrix(mesh,farCounts[colour]++,p.id,p.x,p.y+.88*verticalScale,p.z,ax*T.width,ay*T.width,az*T.width,bx*T.length,by*T.length,bz*T.length,ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx);
    }else{
     trafficStats.near++;
     forward.set(p.dx,p.dy,p.dz).normalize();sideVector.crossVectors(up,forward).normalize();localUp.crossVectors(forward,sideVector).normalize();
     const slot=type*VEHICLE_COLOURS.length+colour,mesh=nearMeshes[slot];
     writeMatrix(mesh,nearCounts[slot]++,p.id,p.x,p.y+.88*verticalScale,p.z,sideVector.x,sideVector.y,sideVector.z,localUp.x*verticalScale,localUp.y*verticalScale,localUp.z*verticalScale,forward.x,forward.y,forward.z);
    }
   }
  }
  const finish=(mesh,count)=>{
   mesh.count=count;mesh.visible=count>0;
   if(count){
    // ── s24:R ── upload only the live instances (the rest are never drawn)
    if(uploadRanges){mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,count*16);}
    // ── /s24:R ──
    mesh.instanceMatrix.needsUpdate=true;trafficStats.drawCalls++;trafficStats.triangles+=count*mesh.userData.trianglesPerVehicle;}
  };
  nearMeshes.forEach((m,k)=>finish(m,nearCounts[k]));farMeshes.forEach((m,k)=>finish(m,farCounts[k]));
 }
 root.userData.setHeightScale=value=>{if(!Number.isFinite(value)||value<=0)throw new Error('Motorway height scale must be positive');scale=value;for(const m of staticMeshes){const g=m.geometry,p=g.attributes.position,base=g.attributes.motorwayBase,original=g.userData.original;for(let i=0;i<p.count;i++)p.array[i*3+1]=base.array[i]+(original[i*3+1]-base.array[i])*scale;p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();}update(0,lastCamera,true);};
 root.userData.update=update;root.userData.trafficLod=trafficStats;
 // ── s24:R ──
 root.userData.setEconomies=({frustumCulling=cullToFrustum,fogCulling=fogCullOn,instanceRanges=uploadRanges,hiddenSkip=skipHidden}={})=>{const changed=frustumCulling!==cullToFrustum||fogCulling!==fogCullOn;cullToFrustum=!!frustumCulling;fogCullOn=!!fogCulling;uploadRanges=!!instanceRanges;skipHidden=!!hiddenSkip;if(changed)lastProjectionKey=null;};
 root.userData.getEconomies=()=>({frustumCulling:cullToFrustum,fogCulling:fogCullOn,instanceRanges:uploadRanges,hiddenSkip:skipHidden});
 root.userData.revalidate=revalidate;
 // ── /s24:R ──
 root.userData.vehicleAt=id=>{const c=carriers.find(c=>id>=c.idOffset&&id<c.idOffset+c.count);return c?vehicleAt(c,id-c.idOffset,{}):null;};root.userData.pointAt=(routeId,d)=>pointAt(representative.find(r=>r.id===routeId)||representative[0],d,{});root.userData.routes=representative;root.userData.roadPaths=roadPaths;root.userData.getElapsed=()=>elapsed;root.userData.vehicleChainageAt=(id,t)=>{const c=carriers.find(c=>id>=c.idOffset&&id<c.idOffset+c.count);return c?mod(vehicleChainage(c.layout,id-c.idOffset,t),c.route.length):null;};root.userData.carriers=carriers;root.userData.pickables=staticMeshes;root.userData.stats={sourceWays:source.roads.length,circuits:representative.length,vehicles:carriers.reduce((n,c)=>n+c.count,0),get drawCalls(){return staticMeshes.length+trafficStats.drawCalls;},allocatedDrawCalls:root.children.length,trafficMetresPerSecond:TRAFFIC_SPEED_MPS,vehicleTypes:VEHICLE_TYPES.map(t=>t.id),vehicleColours:VEHICLE_COLOURS.map(c=>c.id),geometrySampleMetres:12,adaptiveSamples,maximumClearanceAdjustmentY,widthExaggeration:1.18};root.userData.dispose=()=>{root.traverse(m=>{if(m.isMesh)m.geometry.dispose();});for(const m of Object.values(materials))m.dispose();root.removeFromParent();};root.userData.setHeightScale(heightScale);return root;
}
