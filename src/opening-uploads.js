// Prepare buffers and a real draw pipeline in a tiny matching render target,
// without drawing into the city or disturbing its camera. Zero-instance draws
// return before GL, and zero-vertex draws need not exercise the driver pipeline.
import * as THREE from 'three';
import {prepareBoxMeshBounds} from './station-buildings.js';

export function createOpeningUploads({renderer, camera, renderTarget = null, materialsFor = object => [object.material],
  renderPrepared = (world,view) => renderer.render(world,view)}) {
  const target = renderTarget?.clone() ?? new THREE.WebGLRenderTarget(2,2,{type:THREE.HalfFloatType,depthBuffer:true});
  // Texture.clone shares its Source in r161. The city depth attachment must
  // never share the warm target's resized image or GL storage.
  if(target.depthTexture)target.depthTexture.source=new THREE.Source({...target.depthTexture.image,width:2,height:2});
  target.setSize(2,2);
  const warmChildren = [];
  let world = null;
  const material = new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,depthTest:false});
  const seen = new WeakSet(), materials = new WeakSet(), queue = [];
  const drawn = new WeakMap();
  let cursor = 0, scans = 0, finished = false;
  const stats={queued:0,uploaded:0,skipped:0,skippedDrawn:0,remaining:0,maxMs:0};
  const keyOf = object => object.isInstancedMesh ? object.instanceMatrix : object.geometry;
  function remember(object, material) {
    const key = keyOf(object);
    if (!key) return;
    let set = drawn.get(key);
    if (!set) { set = new Set(); drawn.set(key, set); }
    set.add(material);
  }
  // The watched tilt already draws most building buffers. Observe the real
  // draws and avoid preparing those same buffers/materials a second time.
  const direct = renderer.renderBufferDirect;
  const observeDraw = typeof direct === 'function' ? function (camera, scene, geometry, material, object, group) {
    const result = direct.call(this, camera, scene, geometry, material, object, group);
    const available=Math.min(geometry.drawRange.count,(geometry.index?.count??geometry.attributes.position?.count??0)-geometry.drawRange.start);
    const primitive=object.isPoints?1:object.isLine?2:3;
    if(available>=primitive && (!object.isInstancedMesh||object.count>0) && (!geometry.isInstancedBufferGeometry||geometry.instanceCount>0))remember(object, material);
    return result;
  } : null;
  let observing = false;
  function observe() {
    if (observeDraw && !observing) { renderer.renderBufferDirect = observeDraw; observing = true; }
  }
  function stop() {
    if (observeDraw && renderer.renderBufferDirect === observeDraw) renderer.renderBufferDirect = direct;
    if (!finished) stats.unprepared = queue.length - cursor;
    finished = true; queue.length = 0; cursor = 0;
  }
  function render(object, material = object.material) {
    if(object.isInstancedMesh && /^(baked-)?buildings-/.test(object.name)) prepareBoxMeshBounds(object);
    const Type = object.isPoints ? THREE.Points : object.isLineSegments ? THREE.LineSegments : object.isLineLoop ? THREE.LineLoop : object.isLine ? THREE.Line : THREE.Mesh;
    const proxy=object.isInstancedMesh ? new THREE.InstancedMesh(object.geometry,material,1) : new Type(object.geometry,material);
    if(object.isInstancedMesh) {proxy.instanceMatrix=object.instanceMatrix;proxy.count=Math.min(1,object.instanceMatrix.count);}
    proxy.receiveShadow=object.receiveShadow;
    proxy.frustumCulled=false;
    const range=object.geometry.drawRange, count=range.count;
    const instances=object.geometry.isInstancedBufferGeometry?object.geometry.instanceCount:null;
    const previous=renderer.getRenderTarget(), shadow=renderer.shadowMap.needsUpdate;
    const autoShadow=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
    const children=world.children;
    warmChildren.push(proxy);proxy.parent=world;world.children=warmChildren;
    const available = (object.geometry.index?.count ?? object.geometry.attributes.position.count) - range.start;
    range.count=Math.min(count,Math.max(0,available),object.isPoints?1:object.isLine?2:3);
    if(instances!==null)object.geometry.instanceCount=Math.min(1,instances);
    // Automatic may change MSAA during the watched tilt. Match the current
    // scene attachment; the tiny target never changes the visible quality.
    if(renderTarget && target.samples!==renderTarget.samples){target.dispose();target.samples=renderTarget.samples;}
    try {renderer.setRenderTarget(target);renderPrepared(world,camera);remember(object,material);}
    finally {if(instances!==null)object.geometry.instanceCount=instances;range.count=count;world.children=children;warmChildren.pop();proxy.parent=null;renderer.setRenderTarget(previous);renderer.shadowMap.needsUpdate=shadow;renderer.shadowMap.autoUpdate=autoShadow;}
    // Do not dispose an instance proxy: its matrix buffer belongs to the city.
  }
  function lights(scene) {
    world=scene;warmChildren.length=0;
    scene.traverseVisible(o=>{if(o.isLight)warmChildren.push(o);});
  }
  function prime(scene) {
    observe();
    lights(scene);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
    render(new THREE.Mesh(geometry,material));
    const instance=new THREE.InstancedMesh(geometry,material,1);render(instance);
  }
  function frame(scene,budgetMs=4,complete=false) {
    if(finished)return;
    observe();
    if(complete || scans++%4===0)scene.traverseVisible(object=>{
      if(!object.geometry?.attributes.position || object.isSkinnedMesh)return;
      const key=object.isInstancedMesh?object.instanceMatrix:object.geometry;
      const mats=Array.isArray(object.material)?object.material:[object.material];
      const fresh=mats.some(m=>m&&!materials.has(m));
      if(!seen.has(key)||fresh) {seen.add(key);for(const m of mats)if(m)materials.add(m);queue.push(object);}
    });
    let haveLights = false;
    const start=performance.now();
    while(cursor<queue.length) {
      const object=queue[cursor++];
      let parent=object;while(parent && parent!==scene)parent=parent.parent;
      if(!parent){stats.skipped++;continue;}
      const required = materialsFor(object), previous = drawn.get(keyOf(object));
      const pending = required.filter(material => !previous?.has(material));
      if (!pending.length) { stats.skippedDrawn++; continue; }
      if (!haveLights) { lights(scene); haveLights = true; }
      const at=performance.now();
      for (const material of pending) render(object,material);
      const ms=performance.now()-at;
      if(ms>stats.maxMs){stats.maxMs=ms;stats.worstObject=object.name;}stats.uploaded++;
      if(performance.now()-start>=budgetMs)break;
    }
    stats.queued=queue.length;stats.remaining=queue.length-cursor;
    if(complete && !stats.remaining){
      stats.finishedAt=performance.now();stop();
    }
  }
  return {prime,frame,stop,stats};
}
