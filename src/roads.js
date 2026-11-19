// All roads, D-065. Geometry is generated offline against the app's own terrain and bridge
// morphs. Each block is already indexed and bounded: a browser only creates typed-array views.
import * as THREE from 'three';
import {nightUniforms} from './night.js';
import {groundCueStrength,groundCueWeight,installGroundCue} from './ground-cue.js';

export function roadBlockWanted(rec,{phone=false,x=0,z=0,height=0}={}) {
  if(!phone)return rec.tier==='desktop';
  if(rec.tier==='major')return true;
  if(rec.tier!=='near'||height>120)return false;
  const dx=Math.max(rec.x-x,0,x-rec.x-rec.size),dz=Math.max(rec.z-z,0,z-rec.z-rec.size);
  return dx*dx+dz*dz<=1800*1800; // exceeds the 1km walker guarantee, even across a block boundary
}

/** Lane K hook: chain this material's onBeforeCompile and key; vRoadWorld is canonical X/Z in
 * real horizontal metres. vRoad = (signed across-road metres, ribbon half-width, left pavement,
 * right pavement). Across is negative on OSM left. No new meshes/attributes needed by the cue. */
export function createRoadMaterial({ratio={value:1}}={}) {
  const material=new THREE.MeshLambertMaterial({color:0x55504b,
    side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  material.name='road-surface';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uRoadRatio=ratio;
    shader.uniforms.uNightAmt=nightUniforms.uNightAmt;
    shader.uniforms.uNightGlowGain=nightUniforms.uNightGlowGain;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec3 roadData;
#ifdef ROAD_BRIDGE
attribute float roadRise;
#endif
uniform float uRoadRatio;
varying vec4 vRoad;
varying vec2 vRoadWorld;`)
      .replace('#include <beginnormal_vertex>','vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef ROAD_BRIDGE
transformed.y += roadRise * (uRoadRatio - 1.0);
#endif
vRoad = vec4((step(128.0,roadData.y)*2.0-1.0) * roadData.x / 4.0, roadData.x / 4.0, mod(roadData.y,128.0)/10.0,roadData.z/10.0);
vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec4 vRoad;
varying vec2 vRoadWorld;
uniform float uNightAmt;
uniform float uNightGlowGain;
float roadHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float roadNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(roadHash(i),roadHash(i+vec2(1,0)),f.x),mix(roadHash(i+vec2(0,1)),roadHash(i+vec2(1)),f.x),f.y); }`)
      .replace('#include <color_fragment>',`#include <color_fragment>
// A band is in the carriageway mesh, with its width carried per road. K adds the fine detail.
float roadPavement = step(vRoad.x, -vRoad.y + vRoad.z) * step(.01,vRoad.z)
                   + step(vRoad.y - vRoad.w,vRoad.x) * step(.01,vRoad.w);
// Lane K colours the pavement bands with the ground cue. The R base is uniform asphalt.`)
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
  material.customProgramCacheKey=()=> 'road-surface-v4';
  return material;
}

export function decodeRoadBlock(buffer,material,bridgeMaterial,record=null) {
  const v=new DataView(buffer);
  if(v.byteLength<32||v.getUint32(0,true)!==0x34524755)throw Error('Invalid UGR4 road block');
  const n=v.getUint32(4,true),ni=v.getUint32(8,true),bridge=!!v.getUint32(20,true);
  const expected=32+n*(bridge?11:9)+(n%2)+ni*2;
  if(!n||n>65000||ni%3||expected!==v.byteLength)throw Error('Invalid UGR4 road buffer lengths');
  const g=new THREE.BufferGeometry();let offset=32;
  g.setAttribute('position',new THREE.BufferAttribute(new Uint16Array(buffer,offset,n*3),3));offset+=n*6;
  g.setAttribute('roadData',new THREE.BufferAttribute(new Uint8Array(buffer,offset,n*3),3));offset+=n*3+(n%2);
  if(bridge){g.setAttribute('roadRise',new THREE.BufferAttribute(new Int16Array(buffer,offset,n),1));offset+=n*2;}
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer,offset,ni),1));
  if(record?.bounds) {
    const [x,z,lo,x1,z1,hi]=record.bounds, ox=v.getInt32(12,true),oz=v.getInt32(16,true);
    g.boundingBox=new THREE.Box3(new THREE.Vector3((x-ox)*8,(Math.min(lo,bridge?0:lo)+500)*20,(z-oz)*8),new THREE.Vector3((x1-ox)*8,(hi+500)*20,(z1-oz)*8));
  } else { g.computeBoundingBox(); }
  g.boundingSphere=new THREE.Sphere();g.boundingBox.getBoundingSphere(g.boundingSphere);
  const mesh=new THREE.Mesh(g,bridge?bridgeMaterial:material);
  mesh.position.set(v.getInt32(12,true),-500,v.getInt32(16,true));mesh.scale.set(.125,.05,.125);
  mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.renderOrder=1;mesh.receiveShadow=true;
  mesh.raycast=()=>{}; // road meshes are visual landscape; picking stays with terrain and infrastructure
  return mesh;
}

export function createRoads({scene,phone=false,isOpen=()=>true,getRatio=()=>1,getBridges=()=>null,compile=null,onError=console.warn,groundCue=null}={}) {
  const group=new THREE.Group();group.name='roads';group.matrixAutoUpdate=false;
  const ratio={value:getRatio()},material=createRoadMaterial({ratio}),bridgeMaterial=createRoadMaterial({ratio});
  bridgeMaterial.defines={ROAD_BRIDGE:1};bridgeMaterial.customProgramCacheKey=()=> 'road-surface-v4-bridge';
  const cue={value:0},cueOrigin={value:new THREE.Vector2()};let cueStrength=groundCueStrength(groundCue);
  for(const m of [material,bridgeMaterial])installGroundCue(m,cue,cueOrigin);
  const stats={state:'waiting',loaded:0,pending:0,bytes:0,vertices:0,maxAttachMs:0,maxWidthMs:0,errors:[],disposed:0,manifest:null};
  let enabled=true,started=false,dead=false,records=[],lastX=Infinity,lastZ=Infinity,lastHeight=Infinity;
  const resident=new Map(),inflight=new Map(),ready=[],wanted=new Set();
  let attachPromise=null,compiled=false,widthReady=false,widthJob=null,widthPending=null,loadController=null,generation=0;
  const report=e=>{stats.errors.push(String(e));onError('Roads unavailable:',e);};
  const remove=(file,mesh)=>{group.remove(mesh);mesh.geometry.dispose();stats.bytes-=mesh.userData.roadBytes;stats.vertices-=mesh.geometry.attributes.position.count;resident.delete(file);stats.disposed++;stats.loaded=resident.size;};
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
    wanted.clear();for(const r of records)if(roadBlockWanted(r,{phone,x,z,height}))wanted.add(r.file);
    for(const[file,mesh]of resident)if(!wanted.has(file))remove(file,mesh);
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
    const mesh=decodeRoadBlock(buffer,material,bridgeMaterial,rec);mesh.name='roads:'+rec.file;mesh.userData.roadBytes=rec.bytes;
    // Both variants are precompiled offscreen after landing, before the first visible road.
    const attach=()=>{if(dead||!enabled||!wanted.has(rec.file)){mesh.geometry.dispose();return;}group.add(mesh);resident.set(rec.file,mesh);stats.bytes+=rec.bytes;stats.vertices+=rec.vertices;stats.loaded=resident.size;};
    if(!group.parent)scene.add(group);
    if(!compiled && compile) {
      const proxies=new THREE.Group();
      for(const m of [material,bridgeMaterial]){const p=new THREE.Mesh(mesh.geometry,m);p.receiveShadow=true;proxies.add(p);}
      attachPromise=Promise.resolve(compile(proxies)).then(()=>{compiled=true;attach();}).catch(e=>{mesh.geometry.dispose();report(e);}).finally(()=>{attachPromise=null;proxies.clear();});
    } else attach();
    stats.maxAttachMs=Math.max(stats.maxAttachMs,performance.now()-t);
  }
  return {group,material,bridgeMaterial,stats,
    groundCue:{setStrength(v){cueStrength=groundCueStrength(v);},get strength(){return cueStrength;},get weight(){return cue.value;}},
    setEnabled(v){enabled=!!v;group.visible=enabled&&widthReady;if(!enabled){generation++;loadController?.abort();widthJob=null;widthPending=null;widthReady=false;getBridges()?.userData.clearRoadWidths?.();started=false;records=[];wanted.clear();for(const c of inflight.values())c.abort();inflight.clear();ready.length=0;for(const[f,m]of resident)remove(f,m);lastX=Infinity;}},
    get enabled(){return enabled;},
    update({x,z,height=0,belowSurface=false,submerged=false,airborne=false}={}){
      const viewAllowed=enabled&&!belowSurface&&!submerged;group.visible=viewAllowed&&widthReady;ratio.value=getRatio();
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
      if(Math.hypot(x-lastX,z-lastZ)>100||(height>120)!==(lastHeight>120)) {select(x,z,height);lastX=x;lastZ=z;lastHeight=height;}
      attachNext();fetchMore();
      if(!inflight.size&&!ready.length&&!attachPromise&&resident.size===wanted.size)stats.state=stats.errors.length?'failed':'ready';
    },
    coverage:()=>({wanted:[...wanted],resident:[...resident.keys()]}),
    dispose(){dead=true;generation++;loadController?.abort();widthPending=null;widthJob=null;getBridges()?.userData.clearRoadWidths?.();for(const c of inflight.values())c.abort();inflight.clear();ready.length=0;for(const[f,m]of resident)remove(f,m);material.dispose();bridgeMaterial.dispose();group.removeFromParent();},
  };
}
