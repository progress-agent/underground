// Compile with tiny representatives, independently of the city's geometry.
// The real factories own every shader hook and cache key, including night.
import * as THREE from 'three';
import {getDayBuildingMaterial, nightBuildingMat} from './surface-geometry.js';
import {buildingDepthMaterial} from './sun.js';
import {createStationBuildingMeshes} from './station-buildings.js';
import {createParkLabelMaterial} from './park-labels.js';
import {createBeyondEdgeMaterial} from './tube-surface-rail.js';
import {applySurfaceTexture} from './surface-texture.js';
import {applyParkUndersideTexture} from './terrain.js';
import {installGroundGlow} from './night.js';
import {createRibbonMaterial} from './crown-ribbon.js';
import {createSeaLifeMaterials} from './sea-life.js';
import {injectVertexAlpha} from './geology-exterior.js';
import {createWaterfallMaterial} from './m25.js';
import {createWaterMaterial} from './water-material.js';
import {installAirportDockTerrainMask} from './airport-docks.js';

export function createOpeningPrograms({renderer, composer, scene, camera, undergroundCull, tubeMaterial, stars}) {
  const seen = new WeakMap(), retained = [];
  const reflected = new WeakSet();
  function finishPrograms() {
    // r161 compile() links programs but leaves uniforms/attributes lazy.
    // Their first-use driver queries belong under the existing cover too.
    for (const program of renderer.info?.programs ?? []) if (!reflected.has(program)) {
      program.getUniforms(); // r161 onFirstUse fills both reflection caches
      reflected.add(program);
    }
  }
  const proxies = new THREE.Group(), depthProxies = new THREE.Group();
  const shadowScene = Object.create(scene); shadowScene.fog = null;
  const geometry = new THREE.BoxGeometry(1,1,1);
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*3).fill(1),3));
  const texture = new THREE.Texture();
  const bounds = {minU:0,minV:0,maxU:1,maxV:1};
  let stopped = false, seeded = false;
  function add(material, instanced = false, geo = geometry) {
    const proxy = instanced ? new THREE.InstancedMesh(geo,material,1) : new THREE.Mesh(geo,material);
    proxy.receiveShadow = true;
    proxies.add(proxy);
    return proxy;
  }
  function variants(material, instanced = false, geo = geometry) {
    // RenderObject draws transparent DoubleSide in back/front passes.
    // Instanced batches have distinct program booleans.
    for (const side of material.transparent && material.side === THREE.DoubleSide ? [THREE.DoubleSide,THREE.FrontSide,THREE.BackSide] : [material.side]) {
      const m = Object.create(material); m.side = side; m._listeners = {};
      retained.push(m); add(m,instanced,geo);

    }
  }
  function depth(material, instanced=false, alphaTest=0) {
    const m=Object.create(material);m.side=THREE.BackSide;m.alphaTest=alphaTest;m._listeners={};retained.push(m);
    const proxy=instanced?new THREE.InstancedMesh(geometry,m,1):new THREE.Mesh(geometry,m);
    depthProxies.add(proxy);
  }

  function seed() {
    for (const instanced of [false,true]) for (const side of [THREE.FrontSide,THREE.DoubleSide]) {
      const m=new THREE.MeshStandardMaterial({side});retained.push(m);add(m,instanced);
    }
    for (const props of [{map:texture},{vertexColors:true,side:THREE.DoubleSide},{vertexColors:true}]) {
      const m=new THREE.MeshStandardMaterial(props);retained.push(m);add(m);
    }
    const windowMaterial = new THREE.MeshBasicMaterial({map:texture,alphaTest:.5,toneMapped:false,side:THREE.DoubleSide});
    retained.push(windowMaterial);add(windowMaterial);add(windowMaterial,true);
    const trainWindow=new THREE.MeshBasicMaterial();retained.push(trainWindow);add(trainWindow,true);
    // Motorway traffic uses instancing with vertex colours; its distant
    // silhouettes are opaque, double-sided Basic materials without a map.
    const traffic=new THREE.MeshStandardMaterial({vertexColors:true});retained.push(traffic);add(traffic,true);
    const distantTraffic=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});retained.push(distantTraffic);add(distantTraffic,true);
    for (const m of [getDayBuildingMaterial(),nightBuildingMat]) variants(m,true);
    variants(tubeMaterial);
    const ribbon=createRibbonMaterial(0xffffff);retained.push(ribbon);variants(ribbon);
    for(const m of Object.values(createSeaLifeMaterials())) {retained.push(m);variants(m);variants(m,true);}
    const column=new THREE.MeshStandardMaterial({vertexColors:true,transparent:true,depthWrite:false});
    injectVertexAlpha(column);retained.push(column);variants(column);
    const fall=createWaterfallMaterial();retained.push(fall);variants(fall);
    const clippedWater=createWaterMaterial('canal');installAirportDockTerrainMask(clippedWater);retained.push(clippedWater);variants(clippedWater);
    const glass = new THREE.MeshPhysicalMaterial({transparent:true,clearcoat:.15,side:THREE.DoubleSide});
    retained.push(glass);variants(glass);
    const station = createStationBuildingMeshes({data:{version:1,sites:{},buildings:[]},atlas:null,getStructuralY:()=>0});
    station.group.traverse(o=>{if(o.material) {retained.push(o.material);variants(o.material);if(o.customDepthMaterial){retained.push(o.customDepthMaterial);depth(o.customDepthMaterial);depth(o.customDepthMaterial,false,.5);}}});
    const park = createParkLabelMaterial({texture},1,{pixelScale:{value:1}});retained.push(park);variants(park);
    const edge = createBeyondEdgeMaterial();retained.push(edge);variants(edge);
    const depthMaterial = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});retained.push(depthMaterial);
    for (const m of [depthMaterial,buildingDepthMaterial]) {depth(m);depth(m,true);}
    if(stars?.points) proxies.add(stars.points.clone());
    seeded = true;
  }
  function prepare() {
    if (stopped) return;
    proxies.clear();
    if (!seeded) seed();
    scene.traverse(object => {
      if (!object.material) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const key = `${material.version}:${object.isInstancedMesh ? 1 : 0}`;
        if (seen.get(material) === key) continue;
        seen.set(material,key);
        variants(material,object.isInstancedMesh,object.geometry);
        if (object.name === 'terrainMesh' && !material.userData.surfaceEnabledUniform) {
          const m = new material.constructor().copy(Object.assign(Object.create(material),{userData:{}}));
          m.userData={...material.userData};m.onBeforeCompile=material.onBeforeCompile;m.customProgramCacheKey=()=>material.customProgramCacheKey().replace(material.onBeforeCompile.toString(),m.onBeforeCompile.toString());
          applySurfaceTexture(m,texture,bounds);retained.push(m);variants(m,false,object.geometry);
          const n=Object.create(m);n.userData={...m.userData};n._listeners={};
          installGroundGlow(n,{minX:0,minZ:0,maxX:1,maxZ:1});retained.push(n);variants(n,false,object.geometry);
        }
        if (object.name === 'terrainUnderside' && !material.userData.parkUnderside) {
          const m=Object.create(material);m.userData={...material.userData};m._listeners={};
          applyParkUndersideTexture(m,texture,bounds);retained.push(m);variants(m,false,object.geometry);
        }
      }
    });
    if (!proxies.children.length) { finishPrograms(); return; }
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(composer.readBuffer);
      if(depthProxies.children.length)renderer.compile(depthProxies,camera,shadowScene);
      renderer.compile(proxies,camera,scene);
      undergroundCull.render('full',()=>renderer.compile(proxies,camera,scene));
      finishPrograms();
    } finally {
      renderer.setRenderTarget(previous);
      for (const proxy of proxies.children) if (proxy.isInstancedMesh) proxy.dispose();
      proxies.clear();
      for(const proxy of depthProxies.children)if(proxy.isInstancedMesh)proxy.dispose();
      depthProxies.clear();
    }
  }
  return {prepare, ready: () => Promise.resolve(), get active() {return !stopped;}, stop() {stopped=true;proxies.clear();}};
}
