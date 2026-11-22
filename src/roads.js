// All roads, D-065. Geometry is generated offline against the app's own terrain and bridge
// morphs. Each block is already indexed and bounded: a browser only creates typed-array views.
import * as THREE from 'three';
import {roadRasterWeight,roadLook} from './road-style.js';
import {nightUniforms} from './night.js';

// Canonical VE5 clearance, matching prepare.mjs LIFT. It follows landscape Master.
export const ROAD_CLEARANCE_CANON = 0.30;
import {groundCueStrength,groundCueWeight,installGroundCue} from './ground-cue.js';

export function roadBlockWanted(rec,{phone=false,x=0,z=0,height=0,inView=true}={}) {
  if(!inView)return false;
  const b=rec.bounds??[rec.x,rec.z,0,rec.x+rec.size,rec.z+rec.size,0];
  const dx=Math.max(b[0]-x,0,x-b[3]),dz=Math.max(b[1]-z,0,z-b[4]);
  const nearby=dx*dx+dz*dz<=1800*1800;
  if(rec.lod){
    if(rec.tier!==(phone?'major':'desktop'))return false;
    const detailed=height<(phone?350:120)&&nearby;
    return rec.lod==='near'?detailed:!detailed;
  }
  if(!phone)return rec.tier==='desktop'; // older assets / fixture compatibility
  if(rec.tier==='major')return true;
  return rec.tier==='near'&&height<=350&&nearby;
}

/** Lane K hook: chain this material's onBeforeCompile and key; vRoadWorld is canonical X/Z in
 * real horizontal metres. vRoad = (signed across-road metres, ribbon half-width, left pavement,
 * right pavement). Across is negative on OSM left. No new meshes/attributes needed by the cue. */
export function createRoadMaterial({ratio={value:1},look={value:2}}={}) {
  const material=new THREE.MeshLambertMaterial({color:0x55504b,
    side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  material.name='road-surface';
  // Unrefined ribbons use their original left/right rail. Locally clipped bank
  // faces carry the interpolated across-road coordinate for the same paving.
  material.defaultAttributeValues={roadAcross:[2]};
  material.onBeforeCompile=shader=>{
    shader.uniforms.uRoadRatio=ratio;
    shader.uniforms.uRoadLook=look;
    shader.uniforms.uNightAmt=nightUniforms.uNightAmt;
    shader.uniforms.uNightGlowGain=nightUniforms.uNightGlowGain;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec3 roadData;
attribute float roadAcross;
#ifdef ROAD_BRIDGE
attribute float roadRise;
#endif
uniform float uRoadRatio;
varying vec4 vRoad;
varying float vRoadMarkings;
varying vec2 vRoadWorld;`)
      .replace('#include <beginnormal_vertex>','vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef ROAD_BRIDGE
transformed.y += roadRise * (uRoadRatio - 1.0);
#endif
float across = roadAcross <= 1.0 ? roadAcross : step(128.0,roadData.y)*2.0-1.0;
// Two formerly spare side-byte bits keep half-widths to 1/16m, so a
// tagged 3.2m carriageway does not round down to 3m. Old UGR4 has zero bits.
float roadHalf = (roadData.x*4.0 + mod(floor(roadData.y/64.0),2.0) + 2.0*mod(floor(roadData.z/64.0),2.0))/16.0;
vRoad = vec4(across * roadHalf,roadHalf,mod(roadData.y,64.0)/10.0,mod(roadData.z,64.0)/10.0);
vRoadMarkings = 1.0-step(128.0,roadData.z);
vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec4 vRoad;
varying float vRoadMarkings;
varying vec2 vRoadWorld;
uniform float uRoadLook;
uniform float uNightAmt;
uniform float uNightGlowGain;
float roadHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float roadNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(roadHash(i),roadHash(i+vec2(1,0)),f.x),mix(roadHash(i+vec2(0,1)),roadHash(i+vec2(1)),f.x),f.y); }`)
      .replace('#include <color_fragment>',`#include <color_fragment>
// A band is in the carriageway mesh, with its width carried per road. K adds the fine detail.
float roadPavement = step(vRoad.x, -vRoad.y + vRoad.z) * step(.01,vRoad.z)
                   + step(vRoad.y - vRoad.w,vRoad.x) * step(.01,vRoad.w);
// Low-frequency pavement tone is independent of the human-scale cue and height.
float lkFw = max(fwidth(vRoad.x), .00001);
float lkPave = smoothstep(-lkFw*.5,lkFw*.5,-vRoad.y+vRoad.z-vRoad.x)*step(.01,vRoad.z)
             + smoothstep(-lkFw*.5,lkFw*.5,vRoad.x-vRoad.y+vRoad.w)*step(.01,vRoad.w);
vec3 lkCol = mix(vec3(.040,.040,.043),vec3(.30,.285,.26),clamp(lkPave,0.,1.));
if(uRoadLook>2.5) {
  // 100mm centre/edge lines: TSM ch5 fig2-1 (1008), fig2-6 (1012.1).
  // Continuous illustrative centre line, not a surveyed traffic-control plan.
  // Convolve with a pixel footprint, preserving average coverage as subpixel.
  float lkDraw=max(.10,lkFw);
  float lkCentre=(1.-smoothstep(lkDraw*.5-lkFw*.5,lkDraw*.5+lkFw*.5,abs(vRoad.x-(vRoad.z-vRoad.w)*.5)))*.10/lkDraw*step(5.,2.*vRoad.y-vRoad.z-vRoad.w);
  float lkEdgeL=(1.-smoothstep(lkDraw*.5-lkFw*.5,lkDraw*.5+lkFw*.5,abs(vRoad.x-(-vRoad.y+vRoad.z+.3))))*.10/lkDraw;
  float lkEdgeR=(1.-smoothstep(lkDraw*.5-lkFw*.5,lkDraw*.5+lkFw*.5,abs(vRoad.x-(vRoad.y-vRoad.w-.3))))*.10/lkDraw;
  float lkPaint=clamp(lkCentre+.7*(lkEdgeL+lkEdgeR),0.,1.)*step(.99,vRoadMarkings)*(1.-clamp(lkPave,0.,1.));
  lkCol=mix(lkCol,vec3(.55,.55,.52),lkPaint);
  float lkFoot=max(length(dFdx(vRoadWorld)),length(dFdy(vRoadWorld)))/1.7;
  lkCol*=1.+.08*(roadNoise(vRoadWorld/1.7)-.5)*(1.-smoothstep(.25,.75,lkFoot))*(1.-clamp(lkPave,0.,1.));
}
diffuseColor.rgb=lkCol;
// Ground cue colour hook.`)
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
// The same 34m amber pool/noise as night.js. This is incident light reflected by the
// surface, never emission: the cue and pavements are lit together; emissive stays zero.
if (uNightAmt > .001) {
  float roadFw = max(fwidth(vRoadWorld.x), fwidth(vRoadWorld.y)) / 34.0;
  // The atlas UV runs south to north, opposite world Z. Match night.js's pool phase exactly.
  vec2 roadWp = vec2(vRoadWorld.x + 32471.0, 26096.0 - vRoadWorld.y);
  float roadLamp = mix(.55, .12+1.6*smoothstep(.45,.85,roadNoise(roadWp/34.0)), 1.0-smoothstep(.35,.9,roadFw));
  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0,.6,.26) * roadLamp * uNightGlowGain * uNightAmt;
}`);
    material.userData.shader=shader;
  };
  material.customProgramCacheKey=()=> 'road-surface-v6-junction';
  return material;
}

export function decodeRoadBlock(buffer,material,bridgeMaterial,record=null) {
  const v=new DataView(buffer);
  if(v.byteLength<32||v.getUint32(0,true)!==0x34524755)throw Error('Invalid UGR4 road block');
  const n=v.getUint32(4,true),ni=v.getUint32(8,true),bridge=!!v.getUint32(20,true),farCount=v.getUint32(24,true);
  const flags=v.getUint32(28,true),support=!!(flags&1),floatPosition=!!(flags&2);
  const expected=32+n*((floatPosition?15:9)+(bridge?2:0))+(n%2)+(ni+farCount)*2+(support?n*2:0);
  if(!n||n>65000||ni%3||farCount%3||expected!==v.byteLength)throw Error('Invalid UGR4 road buffer lengths');
  const g=new THREE.BufferGeometry();let offset=32;
  g.setAttribute('position',new THREE.BufferAttribute(new (floatPosition?Float32Array:Uint16Array)(buffer,offset,n*3),3));offset+=n*(floatPosition?12:6);
  g.setAttribute('roadData',new THREE.BufferAttribute(new Uint8Array(buffer,offset,n*3),3));offset+=n*3+(n%2);
  if(bridge){g.setAttribute('roadRise',new THREE.BufferAttribute(new Int16Array(buffer,offset,n),1));offset+=n*2;}
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer,offset,ni),1));
  if(support)g.setAttribute('roadAcross',new THREE.BufferAttribute(new Int16Array(buffer,offset+(ni+farCount)*2,n),1,true));

  if(record?.bounds) {
    const [x,z,lo,x1,z1,hi]=record.bounds, ox=v.getInt32(12,true),oz=v.getInt32(16,true);
    g.boundingBox=new THREE.Box3(new THREE.Vector3((x-ox)*8,(Math.min(lo,bridge?0:lo)+500)*20,(z-oz)*8),new THREE.Vector3((x1-ox)*8,(hi+500)*20,(z1-oz)*8));
  } else { g.computeBoundingBox(); }
  g.boundingSphere=new THREE.Sphere();g.boundingBox.getBoundingSphere(g.boundingSphere);
  const mesh=new THREE.Mesh(g,bridge?bridgeMaterial:material);
  mesh.userData.roadNearGeometry=g;
  if(farCount){
    const far=new THREE.BufferGeometry();far.attributes={...g.attributes};
    far.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer,offset+ni*2,farCount),1));
    far.boundingBox=g.boundingBox;far.boundingSphere=g.boundingSphere;
    mesh.userData.roadFarGeometry=far;
  }
  mesh.position.set(v.getInt32(12,true),-500,v.getInt32(16,true));mesh.scale.set(.125,.05,.125);
  mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.renderOrder=1;mesh.receiveShadow=true;
  mesh.raycast=()=>{}; // road meshes are visual landscape; picking stays with terrain and infrastructure
  return mesh;
}

export function createRoads({scene,phone=false,isOpen=()=>true,getRatio=()=>1,getBridges=()=>null,compile=null,onError=console.warn,groundCue=null,look:initialLook=null,getCamera=null}={}) {
  const group=new THREE.Group();group.name='roads';group.matrixAutoUpdate=false;
  const look={value:roadLook(initialLook)},ratio={value:getRatio()},material=createRoadMaterial({ratio,look}),bridgeMaterial=createRoadMaterial({ratio,look});
  roadRasterWeight.value=1; // preserve the opening until the first ribbon is actually visible
  bridgeMaterial.defines={ROAD_BRIDGE:1};bridgeMaterial.customProgramCacheKey=()=> 'road-surface-v5-junction-bridge';
  const cue={value:0},cueOrigin={value:new THREE.Vector2()};let cueStrength=groundCueStrength(groundCue);
  for(const m of [material,bridgeMaterial])installGroundCue(m,cue,cueOrigin);
  const stats={state:'waiting',loaded:0,pending:0,bytes:0,vertices:0,maxAttachMs:0,maxCompileMs:0,maxWidthMs:0,errors:[],disposed:0,manifest:null};
  let enabled=true,started=false,dead=false,records=[],lastX=Infinity,lastZ=Infinity,lastHeight=Infinity;
  const viewFrustum=new THREE.Frustum(),viewMatrix=new THREE.Matrix4(),viewBox=new THREE.Box3();
  const lastView=new Float64Array(16);lastView.fill(Infinity);
  const rotationEntries=[0,1,2,4,5,6,8,9,10];
  const resident=new Map(),inflight=new Map(),ready=[],wanted=new Set();
  let attachPromise=null,compiled=false,widthReady=false,widthJob=null,widthPending=null,loadController=null,generation=0;
  const report=e=>{stats.errors.push(String(e));onError('Roads unavailable:',e);};
  const remove=(file,mesh)=>{group.remove(mesh);mesh.userData.roadNearGeometry.dispose();mesh.userData.roadFarGeometry?.dispose();stats.bytes-=mesh.userData.roadBytes;stats.vertices-=mesh.geometry.attributes.position.count;resident.delete(file);stats.disposed++;stats.loaded=resident.size;};
  async function bufferFrom(r) {
    if(!r.ok||!r.body)throw Error('Road asset HTTP '+r.status);
    return /gzip/i.test(r.headers.get('content-encoding')??'') ? r.arrayBuffer()
      : new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  async function start(){
    started=true;stats.state='loading';const token=++generation;
    loadController=new AbortController();const signal=loadController.signal;
    try{
      const r=await fetch('/data/roads/manifest.json',{signal});if(!r.ok)throw Error(`Road manifest ${r.status}`);
      const m=await r.json();if(m.format!=='UGR4')throw Error('Road manifest format');
      if(dead||!enabled||token!==generation)return;
      records=m.records;stats.manifest={...m,records:undefined};stats.state='streaming';lastX=Infinity;
      if(m.bridgeMorphs?.length){
        const buffer=await bufferFrom(await fetch('/data/roads/bridge-decks.bin.gz',{signal}));
        if(dead||!enabled||token!==generation)return;
        widthPending={records:m.bridgeMorphs,buffer};
      }else widthReady=true;
    }catch(e){if(!signal.aborted&&token===generation){report(e);stats.state='failed';}}
  }
  function select(x,z,height){
    stats.state='streaming';
    const camera=getCamera?.();
    if(camera){
      camera.updateMatrixWorld(true);viewMatrix.copy(camera.projectionMatrix);
      // Preload beyond the visible cone, so a small look/turn sees resident roads.
      viewMatrix.elements[0]*=.85;viewMatrix.elements[5]*=.85;
      viewMatrix.multiply(camera.matrixWorldInverse);viewFrustum.setFromProjectionMatrix(viewMatrix);
      lastView.set(camera.matrixWorldInverse.elements);
    }
    const visible=r=>{
      if(!camera||!r.bounds||r.lod==='near'||r.tier==='near')return true; // all nearby detail survives a turn
      const [x,z,lo,x1,z1,hi]=r.bounds,margin=250;
      viewBox.min.set(x-margin,Math.min(lo,0)-100,z-margin);
      viewBox.max.set(x1+margin,hi+100,z1+margin);
      return viewFrustum.intersectsBox(viewBox);
    };
    wanted.clear();for(const r of records)if(roadBlockWanted(r,{phone,x,z,height,inView:visible(r)}))wanted.add(r.file);
    // Keep the old LOD until its replacement attaches. Swapping is atomic in
    // attachNext, avoiding a blank road while another gzip file is in flight.
    const replacing=new Set(records.filter(r=>wanted.has(r.file)&&r.pair).map(r=>r.pair));
    for(const[file,mesh]of resident)if(!wanted.has(file)&&!replacing.has(mesh.userData.roadPair))remove(file,mesh);
    for(const[file,c]of inflight)if(!wanted.has(file)){c.abort();inflight.delete(file);}
    // Nearest blocks first. This only runs on a block/range change, never scans geometry per frame.
    records.sort((a,b)=>Math.hypot(a.x+a.size/2-x,a.z+a.size/2-z)-Math.hypot(b.x+b.size/2-x,b.z+b.size/2-z));
  }
  function fetchMore(){
    if(!enabled||dead||attachPromise)return;
    for(const rec of records){
      if(inflight.size+ready.length>=4)break;
      if(!wanted.has(rec.file)||resident.has(rec.file)||inflight.has(rec.file)||ready.some(r=>r.rec.file===rec.file))continue;
      const controller=new AbortController(),token=generation;inflight.set(rec.file,controller);
      fetch('/data/roads/'+rec.file,{signal:controller.signal}).then(bufferFrom).then(buffer=>{if(!dead&&enabled&&!controller.signal.aborted&&token===generation&&wanted.has(rec.file))ready.push({rec,buffer});}).catch(e=>{if(e.name!=='AbortError'&&!controller.signal.aborted&&token===generation){report(e);wanted.delete(rec.file);}}).finally(()=>{if(inflight.get(rec.file)===controller)inflight.delete(rec.file);});
    }
    stats.pending=inflight.size+ready.length;
  }
  function attachNext(){
    if(attachPromise||!ready.length||!widthReady)return;
    const {rec,buffer}=ready.shift();if(!wanted.has(rec.file))return;
    const t=performance.now();
    const mesh=decodeRoadBlock(buffer,material,bridgeMaterial,rec);mesh.name='roads:'+rec.file;mesh.userData.roadBytes=rec.bytes;mesh.userData.roadPair=rec.pair;
    // Both variants are precompiled offscreen after landing, before the first visible road.
    const attach=()=>{if(dead||!enabled||!wanted.has(rec.file)){mesh.geometry.dispose();return;}if(rec.pair)for(const [file,previous]of resident)if(previous.userData.roadPair===rec.pair)remove(file,previous);group.add(mesh);resident.set(rec.file,mesh);stats.bytes+=rec.bytes;stats.vertices+=rec.vertices;stats.loaded=resident.size;};
    if(!group.parent)scene.add(group);
    if(!compiled && compile) {
      const proxies=new THREE.Group();
      for(const m of [material,bridgeMaterial]){const p=new THREE.Mesh(mesh.geometry,m);p.receiveShadow=true;proxies.add(p);}
      // compileAsync still synchronously creates/links programs. Preparing both
      // variants inside this attachment used more than 8 ms on the weak setup.
      // Give each variant its own task; retain direct timings for those tasks as
      // well as attachment, so moving work cannot conceal an over-budget slice.
      const token=generation;
      const prepareOne=proxy=>new Promise((resolve,reject)=>setTimeout(()=>{
        if(dead||!enabled||token!==generation){resolve();return;}
        const t=performance.now();
        try { Promise.resolve(compile(proxy)).then(resolve,reject); }
        catch(e){reject(e);}
        finally { stats.maxCompileMs=Math.max(stats.maxCompileMs,performance.now()-t); }
      },0));
      attachPromise=proxies.children.reduce((p,proxy)=>p.then(()=>prepareOne(proxy)),Promise.resolve())
        .then(()=>{if(token===generation){compiled=true;attach();}else mesh.geometry.dispose();})
        .catch(e=>{mesh.geometry.dispose();report(e);}).finally(()=>{attachPromise=null;proxies.clear();});
    } else attach();
    stats.maxAttachMs=Math.max(stats.maxAttachMs,performance.now()-t);
  }
  return {group,material,bridgeMaterial,stats,
    setLook(value){look.value=roadLook(value);},get look(){return look.value;},
    groundCue:{setStrength(v){cueStrength=groundCueStrength(v);},get strength(){return cueStrength;},get weight(){return cue.value;}},
    setEnabled(v){enabled=!!v;if(!enabled)roadRasterWeight.value=1;group.visible=enabled&&widthReady;if(!enabled){generation++;loadController?.abort();widthJob=null;widthPending=null;widthReady=false;getBridges()?.userData.clearRoadWidths?.();started=false;records=[];wanted.clear();for(const c of inflight.values())c.abort();inflight.clear();ready.length=0;for(const[f,m]of resident)remove(f,m);lastX=Infinity;}},
    get enabled(){return enabled;},
    update({x,z,height=0,belowSurface=false,submerged=false,airborne=false}={}){
      const viewAllowed=enabled&&!belowSurface&&!submerged;group.visible=viewAllowed&&widthReady;ratio.value=getRatio();
      roadRasterWeight.value=viewAllowed&&isOpen()&&resident.size>0?0:1;
      // getRatio() is 1/Master. R's height is canonical/VE, hence divide by
      // that ratio to gate on displayed physical metres at every Master.
      cue.value=groundCueWeight(cueStrength,height/ratio.value,!viewAllowed||airborne);
      cueOrigin.value.set(Math.floor(x/4)*4,Math.floor(z/4)*4);
      getBridges()?.userData.activateRoadWidths?.(viewAllowed&&widthReady);
      if(!isOpen()||!enabled||dead)return;
      if(!started){start();return;}
      if(!records.length)return;
      if(widthPending&&getBridges()){
        widthJob=getBridges().userData.prepareRoadWidths(widthPending.records,widthPending.buffer);widthPending=null;
      }
      if(widthJob){const t=performance.now();try{if(widthJob.next().done){widthJob=null;widthReady=true;}}catch(e){widthJob=null;report(e);stats.state='failed';}
        stats.maxWidthMs=Math.max(stats.maxWidthMs,performance.now()-t);return;
      }
      const physicalHeight=height/ratio.value,cutoff=phone?350:120,camera=getCamera?.();
      const turned=camera&&rotationEntries.some(i=>Math.abs(camera.matrixWorldInverse.elements[i]-lastView[i])>.025);
      if(Math.hypot(x-lastX,z-lastZ)>100||Math.abs(physicalHeight-lastHeight)>50||(physicalHeight<cutoff)!==(lastHeight<cutoff)||turned) {
        select(x,z,physicalHeight);lastX=x;lastZ=z;lastHeight=physicalHeight;
      }
      attachNext();fetchMore();
      // Same vertex attributes, fewer triangles only beyond human-scale views.
      // Keep the full index resident and restore it before returning to the street.
      const far=height/ratio.value>=120;
      for(const mesh of resident.values()){
        mesh.geometry=far?(mesh.userData.roadFarGeometry??mesh.userData.roadNearGeometry):mesh.userData.roadNearGeometry;
      }
      if(!inflight.size&&!ready.length&&!attachPromise&&resident.size===wanted.size)stats.state=stats.errors.length?'failed':'ready';
    },
    coverage:()=>({wanted:[...wanted],resident:[...resident.keys()]}),
    dispose(){dead=true;generation++;loadController?.abort();widthPending=null;widthJob=null;getBridges()?.userData.clearRoadWidths?.();for(const c of inflight.values())c.abort();inflight.clear();ready.length=0;for(const[f,m]of resident)remove(f,m);material.dispose();bridgeMaterial.dispose();group.removeFromParent();},
  };
}
