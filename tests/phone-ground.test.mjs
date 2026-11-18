import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';

globalThis.document = { createElement: () => ({ getContext: () => ({ createImageData: (w,h) => ({data:new Uint8ClampedArray(w*h*4)}) }) }) };
const {createSurfaceTexture,rasteriseTile,applySurfaceTexture}=await import('../src/surface-texture.js');
const {loadBakedGround,GROUND_HEADER,GROUND_MAGIC}=await import('../src/baked-ground.js');
const {applyParkUndersideTexture}=await import('../src/terrain.js');
const {installGroundGlow}=await import('../src/night.js');
const bbox={minX:0,maxX:1000,minZ:0,maxZ:1000};
const bounds={minU:0,minV:0,maxU:1,maxV:1};

test('phone retains every ground texel and both masks in half the CPU and GPU channels',()=>{
 const desktop=createSurfaceTexture(bbox),phone=createSurfaceTexture(bbox,4096,{compact:true});
 assert.equal(desktop.texture.format,THREE.RGBAFormat);assert.equal(desktop.channels,4);
 assert.equal(phone.texture.format,THREE.RGFormat);assert.equal(phone.size,desktop.size);
 assert.equal(phone.pixels.byteLength,33554432);assert.equal(desktop.pixels.byteLength,67108864);
 for(const key of ['minFilter','magFilter','generateMipmaps','flipY','wrapS','wrapT','colorSpace'])assert.equal(phone.texture[key],desktop.texture[key],key);
});

test('baked phone expansion preserves both bits of every source pixel, all 256 packed-byte patterns',async()=>{
 const size=4096,buffer=Buffer.alloc(GROUND_HEADER+size*size/4);
 buffer.writeUInt32LE(GROUND_MAGIC,0);buffer.writeUInt32LE(size,4);
 ['minX','maxX','minZ','maxZ'].forEach((k,i)=>buffer.writeDoubleLE(bbox[k],8+i*8));
 for(let i=GROUND_HEADER;i<buffer.length;i++)buffer[i]=(i-GROUND_HEADER)&255;
 const zipped=gzipSync(buffer),original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(zipped,{headers:{'content-type':'application/octet-stream'}});
 try {
  const state=await loadBakedGround(bbox,{paced:false,compact:true});
  assert.equal(state.pixels.length,size*size*2);
  // Independently decode packed input, without using the desktop expansion as oracle.
  for(let i=0;i<size*size;i++){
   const pair=(buffer[GROUND_HEADER+(i>>2)]>>((i&3)*2))&3;
   assert.equal(state.pixels[2*i],(pair&1)?255:0);assert.equal(state.pixels[2*i+1],(pair&2)?255:0);
  }
 } finally {globalThis.fetch=original;}
});

test('live fallback rasterises parks, supplementary greenery and roads identically in RG and BA',()=>{
 const a=createSurfaceTexture(bbox,64),b=createSurfaceTexture(bbox,64,{compact:true});
 const tile={parks:[{polygon:[[50,50],[400,50],[400,400],[50,400]]}],greenery:[{polygon:[[600,600],[900,600],[900,900],[600,900]]}],roads:[{points:[[50,500],[950,500]],width:40}]};
 for(const s of [a,b])rasteriseTile(s,tile,{quiet:true});
 let road=0,green=0;
 for(let i=0;i<64*64;i++) {assert.equal(b.pixels[2*i],a.pixels[4*i+2]);assert.equal(b.pixels[2*i+1],a.pixels[4*i+3]);road+=b.pixels[2*i];green+=b.pixels[2*i+1];}
 assert.ok(road>0);assert.ok(green>0);
});

function shaderFor(material){const s={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>\n}',fragmentShader:'void main() {\n#include <color_fragment>\n#include <emissivemap_fragment>\n}'};material.onBeforeCompile(s);return s;}
for(const compact of [false,true])test(`${compact?'phone RG':'desktop BA'}: surface, night and underside read the same masks and chain existing hooks`,()=>{
 const tex=createSurfaceTexture(bbox,16,{compact}).texture,top=new THREE.MeshStandardMaterial(),under=new THREE.MeshStandardMaterial();
 let calls=0;top.onBeforeCompile=()=>{calls++;};under.onBeforeCompile=()=>{calls++;};
 applySurfaceTexture(top,tex,bounds);installGroundGlow(top,bbox);applyParkUndersideTexture(under,tex,bounds);
 const a=shaderFor(top),b=shaderFor(under);assert.equal(calls,2);
 assert.ok(a.fragmentShader.includes(`float road   = sf.${compact?'r':'b'}`));
 assert.ok(a.fragmentShader.includes(`float park   = sf.${compact?'g':'a'}`));
 assert.ok(a.fragmentShader.includes(`texture2D( surfaceTex, nSuv ).${compact?'r':'b'}`));
 assert.ok(a.fragmentShader.includes(`texture2D( surfaceTex, nSuv + nPx ).${compact?'r':'b'}`));
 assert.ok(b.fragmentShader.includes(`texture2D(parkUndersideTexture, parkUv).${compact?'g':'a'}`));
 assert.equal(a.uniforms.surfaceTex.value,tex);assert.equal(b.uniforms.parkUndersideTexture.value,tex);
 if(compact){assert.match(top.customProgramCacheKey(),/surface-rg/);assert.match(under.customProgramCacheKey(),/park-rg/);}
});
