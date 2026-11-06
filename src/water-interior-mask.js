// Reuse the existing exact water-top screen mask while submerged. Material
// variants are installed ONLY around the render call, so the atmosphere/night
// owners still see their original materials and every outside view pays zero
// terrain-shader cost. No extra scene pass and no per-fragment polygon loop.
import * as THREE from 'three';
export function createLakeInteriorMask(underwaterSurface) {
  const uniforms={uLakeTopY:{value:0},uLakeScreenSize:{value:new THREE.Vector2(1,1)},uLakeScreenMask:underwaterSurface.uniforms.uWaterSurfaceMask};
  const variants=new WeakMap(),targets=[];let active=null;
  function install(material,mesh) {if(material&&mesh&&!targets.includes(mesh))targets.push(mesh);}
  function variant(original) {
    if(variants.has(original))return variants.get(original);
    // Material.copy JSON-clones userData, which can hold a 64MB texture.
    const view=Object.create(original);view.userData={};
    const material=new original.constructor().copy(view);material.userData={...original.userData};
    const previous=original.onBeforeCompile,key=original.customProgramCacheKey;
    material.onBeforeCompile=function(shader,renderer) {
      previous.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=shader.vertexShader.replace('void main() {','varying float vLakeTerrainY;\nvoid main() {').replace('#include <begin_vertex>','#include <begin_vertex>\n vLakeTerrainY=(modelMatrix*vec4(transformed,1.0)).y;');
      shader.fragmentShader=shader.fragmentShader.replace('void main() {','uniform float uLakeTopY;uniform vec2 uLakeScreenSize;uniform sampler2D uLakeScreenMask;varying float vLakeTerrainY;\nvoid main() {').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(vLakeTerrainY<uLakeTopY && texture2D(uLakeScreenMask,gl_FragCoord.xy/uLakeScreenSize).r>0.5)discard;');
    };
    material.customProgramCacheKey=()=>`${key.call(original)}|lake-interior-screen-v2`;
    variants.set(original,material);return material;
  }
  function update(renderer,body) {active=body;uniforms.uLakeTopY.value=body?.waterY??0;renderer.getDrawingBufferSize(uniforms.uLakeScreenSize.value);}
  function render(draw) {
    if(!active)return draw();
    const saved=targets.map(mesh=>[mesh,mesh.material]);
    for(const [mesh,original]of saved)mesh.material=variant(original);
    try{return draw();}finally{for(const [mesh,original]of saved)mesh.material=original;}
  }
  function proxies() {return targets.map(mesh=>{const p=new THREE.Mesh(mesh.geometry,variant(mesh.material));p.receiveShadow=mesh.receiveShadow;return p;});}
  return {install,update,render,proxies,uniforms};
}
