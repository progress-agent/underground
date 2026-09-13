import * as THREE from 'three';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import { sceneThamesPoints } from './thames-profile.js';

// Mapped bridge axes from public/data/bridges.json, OSM ways retained here as
// provenance. Re-project their actual centres onto the loaded course; named
// reach-table chainages predate that course and are not a geographic authority.
export const RIVER_MATERIAL_ANCHORS = [
  {name:'Battersea Bridge',e:526997.5,n:177381.5,osmWays:[23017704]},
  {name:'Lambeth Bridge',e:530409,n:178958.5,osmWays:[201619353]},
  {name:'Tower Bridge',e:533672.5,n:180264.5,osmWays:[97440715]},
];
const masonryBounds={value:new THREE.Vector4(0,1,2,3)};
export function configureRiverMaterialReach(points){
  const source=sceneThamesPoints(points);
  const chainages=RIVER_MATERIAL_ANCHORS.map(anchor=>{
    const x=anchor.e-BNG_REF_E,z=-(anchor.n-BNG_REF_N);
    let travelled=0,best=Infinity,result=null;
    for(let i=1;i<source.length;i++){
      const a=source[i-1],b=source[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(len*len||1)));
      const distance=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
      if(distance<best){best=distance;result=travelled+t*len;}
      travelled+=len;
    }
    if(result===null||best>500)throw Error(`River material anchor missing from course: ${anchor.name}`);
    return result;
  });
  // Authored gradual transition: masonry is full from Lambeth through Pool
  // of London, then eases to natural mud over the next four kilometres.
  masonryBounds.value.set(chainages[0],chainages[1],chainages[2]+1000,chainages[2]+5000);
  return {anchors:chainages,bounds:masonryBounds.value.toArray()};
}

const bedUniforms = {
  uRiverSubmerged: { value: 0 },
  uRiverBedMask: { value: null },
  uRiverBedBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Broad authored material progression, using existing named-reach chainages:
// Westminster and Pool of London masonry, feathered into adjoining reaches.
export const riverCentrality = chain => {
  const b=masonryBounds.value;return smooth(b.x,b.y,chain)*(1-smooth(b.z,b.w,chain));
};

export function initialiseRiverBedMask(positions, totalChain) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 2048, 2048);
  const count = positions.length / 12;
  const drawPoint = (index, first) => {
    const x = (positions[index * 3] - minX) / (maxX - minX) * 2048;
    const y = (1 - (positions[index * 3 + 2] - minZ) / (maxZ - minZ)) * 2048;
    if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  };
  for (let i = 0; i < count - 1; i++) {
    const central = riverCentrality((i + 0.5) / (count - 1) * totalChain);
    ctx.fillStyle = `rgb(255,${Math.round(central * 255)},0)`;
    ctx.beginPath();
    drawPoint(i * 4, true); drawPoint((i + 1) * 4, false);
    drawPoint((i + 1) * 4 + 1, false); drawPoint(i * 4 + 1, false);
    ctx.closePath(); ctx.fill();
  }
  bedUniforms.uRiverBedMask.value?.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  bedUniforms.uRiverBedMask.value = texture;
  bedUniforms.uRiverBedBounds.value.set(minX, minZ, maxX - minX, maxZ - minZ);
}

export function setRiverMaterialSubmerged(value) { bedUniforms.uRiverSubmerged.value = value ? 1 : 0; }

export function applyRiverBedMaterial(material) {
  if (!material || material.userData.riverBedApplied) return;
  material.userData.riverBedApplied = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, bedUniforms);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying vec3 vRiverBedPosition;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiverBedPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
uniform float uRiverSubmerged;
uniform sampler2D uRiverBedMask;
uniform vec4 uRiverBedBounds;
varying vec3 vRiverBedPosition;
void main() {`).replace('#include <color_fragment>', `#include <color_fragment>
  vec2 riverUv=(vRiverBedPosition.xz-uRiverBedBounds.xy)/uRiverBedBounds.zw;
  vec2 riverMask=texture2D(uRiverBedMask,clamp(riverUv,0.0,1.0)).rg;
  float riverValid=step(0.0,riverUv.x)*step(riverUv.x,1.0)*step(0.0,riverUv.y)*step(riverUv.y,1.0);
  float grains=fract(sin(dot(floor(vRiverBedPosition.xz*2.5),vec2(12.9898,78.233)))*43758.5453);
  vec3 sediment=mix(vec3(0.20,0.135,0.075),vec3(0.31,0.275,0.205),riverMask.g);
  sediment*=0.83+0.34*grains;
  float bedMix=uRiverSubmerged*riverValid*smoothstep(0.1,0.75,riverMask.r);
  diffuseColor.rgb=mix(diffuseColor.rgb,sediment,bedMix);
`);
  };
  // Evaluate the captured predecessor at compile time. Its base Three key
  // reads the current onBeforeCompile, which changes when the async ground
  // atlas appends its hook. Freezing that string here reused a pre-atlas
  // program after roads/parks had arrived. Calling the captured function
  // also retains dock provenance without recursing into this wrapper.
  material.customProgramCacheKey = () => `${previousKey()}|river-bed-v1`;
  material.needsUpdate = true;
}

export function createRiverBankMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97,
    emissive: 0x494332, emissiveIntensity: 0.16, side: THREE.BackSide, depthWrite: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.uRiverMasonryBounds=masonryBounds;
    shader.vertexShader = shader.vertexShader.replace('void main() {', `attribute float riverChain;
varying vec3 vRiverBankPosition;
varying float vRiverChain;
void main() {`).replace('#include <begin_vertex>', `#include <begin_vertex>
vRiverBankPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
vRiverChain=riverChain;`);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `uniform vec4 uRiverMasonryBounds;
varying vec3 vRiverBankPosition;
varying float vRiverChain;
void main() {`).replace('#include <color_fragment>', `#include <color_fragment>
float central=smoothstep(uRiverMasonryBounds.x,uRiverMasonryBounds.y,vRiverChain)*(1.0-smoothstep(uRiverMasonryBounds.z,uRiverMasonryBounds.w,vRiverChain));
// Row heights are physical metres (canonical VE5), not structure scale.
float row=floor(vRiverBankPosition.y/3.5);
vec2 stoneUv=vec2(vRiverChain/2.2+mod(row,2.0)*0.5,vRiverBankPosition.y/3.5);
vec2 seam=min(fract(stoneUv),1.0-fract(stoneUv));
vec2 aa=max(fwidth(stoneUv),vec2(0.005));
float mortar=1.0-smoothstep(0.025,0.025+max(aa.x,aa.y),min(seam.x,seam.y));
float fleck=fract(sin(dot(floor(vRiverBankPosition.xz*1.4),vec2(12.9898,78.233)))*43758.5453);
vec3 stone=mix(vec3(0.32,0.30,0.255),vec3(0.14,0.13,0.11),mortar*0.7);
vec3 mud=vec3(0.19,0.13,0.075)*(0.85+0.3*fleck);
diffuseColor.rgb=mix(mud,stone,central);
`);
  };
  material.customProgramCacheKey = () => 'river-banks-v1';
  return material;
}
