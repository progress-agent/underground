// Material swaps are transitions, never a per-building frame loop. Streaming tiles use the active shared material.
import * as THREE from 'three';
import { nightUniforms, installGroundGlow } from './night.js';
import { litFraction } from './night-clock.js';
import { setNightBuildings, nightBuildingMat, getDayBuildingMaterial } from './surface-geometry.js';
const grounds = [], trains = new Set();
const trainDay = new THREE.Color(0x24384b), trainNight = new THREE.Color(1.0,0.78,0.46);
let current = -1, active = false, groundVersion = 0, seenVersion = -1;
export function registerTrainWindows(material) { trains.add(material); material.color.copy(trainDay).lerp(trainNight, Math.max(0,current)); return material; }
export function registerGroundNight(material, bbox) {
  // Material.copy JSON-clones userData. This metadata contains the 64 MB ground texture.
  // Copy material properties through a metadata-free view, then share the metadata references.
  const descriptor = Object.create(material);
  descriptor.userData = {};
  const night = new material.constructor().copy(descriptor);
  night.userData = { ...material.userData };
  night.onBeforeCompile = material.onBeforeCompile;
  night.customProgramCacheKey = material.customProgramCacheKey.bind(material);
  night.name = 'night-ground';
  installGroundGlow(night,bbox);grounds.push({day:material,night});groundVersion++;
  return night;
}
export function updateNightScene({scene,sun,phone=false}) {
  const amount = (sun.state.night ?? 0) * sun.status.airWeight;
  nightUniforms.uNightAmt.value = amount;
  nightUniforms.uNightLit.value = litFraction(sun.hour);
  nightUniforms.uWindowBlend.value = phone ? 2.5 : 1.7;
  const on = amount > 0;
  // Keep the existing chipless names readable over bright night windows.
  if(on !== active && typeof document !== 'undefined') document.body.classList.toggle('ug-night',on);
  setNightBuildings(on,scene);
  if(on !== active || seenVersion !== groundVersion){
    for(const pair of grounds) scene.traverse(o=>{if(o.material===(on?pair.day:pair.night))o.material=on?pair.night:pair.day});
    active=on;seenVersion=groundVersion;
  }
  if(amount !== current){for(const m of trains)m.color.copy(trainDay).lerp(trainNight,amount);current=amount;}
}

let preparation = null;
/** Prepare material variants in the existing gate. Their proxies never enter the rendered scene. */
export function prepareNightScene({scene,renderer,composer,camera,undergroundCull,stars}) {
  if (preparation) return preparation;
  const proxies = new THREE.Group();
  const original = scene.getObjectByName('surfaceGeometry')?.children.find(o=>o.isInstancedMesh && (o.name.startsWith('baked-buildings-') || o.name.startsWith('buildings-')));
  const ground = scene.getObjectByName('terrainMesh');
  if (!original || !ground || !grounds.length) return null;
  if(original) for(const material of [nightBuildingMat,getDayBuildingMaterial()]) {
    const proxy = new THREE.InstancedMesh(original.geometry,material,1);proxy.receiveShadow=original.receiveShadow;proxy.castShadow=false;proxies.add(proxy);
  }
  if(ground) for(const pair of grounds){const proxy=new THREE.Mesh(ground.geometry,pair.night);proxy.receiveShadow=ground.receiveShadow;proxies.add(proxy);}
  if(stars?.points){const proxy=stars.points.clone();proxy.visible=true;proxies.add(proxy);}
  const compile=()=>{
    const old=renderer.getRenderTarget();
    try { renderer.setRenderTarget(composer.readBuffer); return renderer.compileAsync(proxies,camera,scene); }
    finally { renderer.setRenderTarget(old); }
  };
  preparation=Promise.resolve(compile()).then(()=>undergroundCull ? undergroundCull.render('full',compile) : null)
    .finally(()=>{for(const o of proxies.children)if(o.isInstancedMesh)o.dispose();proxies.clear();});
  return preparation;
}
