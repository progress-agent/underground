import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {applySurfaceTexture,setSurfaceTextureEnabled} from '../src/surface-texture.js';
import {registerGroundNight} from '../src/night-scene.js';
import {applyNightToSunState} from '../src/night.js';
import {sunState,DEFAULT_SUN_TIME,createSunSystem,airWeightFor} from '../src/sun.js';

test('the existing ground-artwork setting controls both the day and night programs',()=>{
 const material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();
 applySurfaceTexture(material,texture,{minU:0,minV:0,maxU:1,maxV:1});
 const night=registerGroundNight(material,{minX:0,maxX:100,minZ:0,maxZ:100});
 const shader=()=>({uniforms:{},vertexShader:'#include <common>\nvoid main(){\n#include <uv_vertex>\n}',fragmentShader:'void main(){\n#include <color_fragment>\n#include <emissivemap_fragment>\n}'});
 const dayShader=shader(),nightShader=shader();material.onBeforeCompile(dayShader);night.onBeforeCompile(nightShader);
 setSurfaceTextureEnabled(material,false);
 assert.equal(dayShader.uniforms.surfaceEnabled.value,0);assert.equal(nightShader.uniforms.surfaceEnabled.value,0);
 setSurfaceTextureEnabled(material,true);
 assert.equal(dayShader.uniforms.surfaceEnabled.value,1);assert.equal(nightShader.uniforms.surfaceEnabled.value,1);
});

test('cool moonlight carries about one twelfth of the default direct-light luminance',()=>{
 const state=sunState(DEFAULT_SUN_TIME),luma=c=>.2126*c.r+.7152*c.g+.0722*c.b;
 const day=luma(state.sunColor)*state.sunFactor;
 state.night=1;applyNightToSunState(state);
 const ratio=luma(state.sunColor)*state.sunFactor/day;
 assert.ok(Math.abs(ratio-1/12)<.01,`actual direct-light ratio ${ratio}`);
});

test('night is fully moonlit at walking eye height, while daylight and below-surface air weights stay unchanged',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),light=new THREE.DirectionalLight();
 const sun=createSunSystem({renderer:{shadowMap:{}},scene,lights:{sun:light},prefs:{clockHour:23}});
 camera.position.set(0,8.5,0);camera.lookAt(0,8.5,-100);camera.updateMatrixWorld(true);
 sun.update({camera,surfaceY:0});assert.equal(sun.status.airWeight,1);
 sun.setHour(12,{persist:false});sun.update({camera,surfaceY:0});
 assert.equal(sun.status.airWeight,airWeightFor({heightAboveSurface:8.5}));
 sun.setHour(23,{persist:false});camera.position.y=-1;sun.update({camera,surfaceY:0});assert.equal(sun.status.airWeight,0);
 camera.position.y=8.5;sun.update({camera,surfaceY:0,submergedBlend:1});assert.equal(sun.status.airWeight,0);
});

test('making the night ground material shares its texture metadata without serialising image pixels',()=>{
 const material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();let serialisations=0;
 texture.toJSON=()=>{serialisations++;return{};};
 applySurfaceTexture(material,texture,{minU:0,minV:0,maxU:1,maxV:1});
 const night=registerGroundNight(material,{minX:0,maxX:100,minZ:0,maxZ:100});
 assert.equal(serialisations,0);assert.equal(night.userData.surfaceTex,texture);
});
