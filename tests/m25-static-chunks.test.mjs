import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import {createMotorway} from '../src/m25-motorway.js';
const sha=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function triangles(g){const rows=new Map();for(const m of g.userData.pickables){const a=m.geometry.attributes.position.array,n=m.geometry.attributes.normal,b=m.geometry.attributes.motorwayBase.array;
 for(let i=m.geometry.drawRange.start*3;i<Math.min(a.length,(m.geometry.drawRange.start+m.geometry.drawRange.count)*3);i+=9){const row=new Float32Array(12);row.set(a.subarray(i,i+9));row.set(b.subarray(i/3,i/3+3),9);const key=m.userData.part+':'+sha(row),old=rows.get(key);const normal=[];for(let j=i/3;j<i/3+3;j++)normal.push(n.getX(j),n.getY(j),n.getZ(j));rows.set(key,{count:(old?.count||0)+1,normal});}}
 return rows;}
test('phone M25 chunks retain the exact authored triangles and pivots, with bounded packed-normal error',()=>{
 const opts={getSurfaceY:({x,z})=>40+20*Math.sin(x/700)*Math.cos(z/900),initialUpdate:false};
 const live=createMotorway(opts),phone=createMotorway({...opts,spatialChunks:true});
 const want=triangles(live),got=triangles(phone);assert.equal(got.size,want.size);let maxNormalError=0;
 for(const [key,v] of want){const actual=got.get(key);assert.ok(actual,key);assert.equal(actual.count,v.count);for(let i=0;i<9;i++)maxNormalError=Math.max(maxNormalError,Math.abs(actual.normal[i]-v.normal[i]));}
 assert.ok(maxNormalError<=2/32767,`normal error ${maxNormalError}`);
 const roads=phone.userData.pickables.filter(m=>m.userData.part==='road');assert.ok(roads.length>50);
 for(const m of roads){assert.ok(m.geometry.boundingBox.max.x-m.geometry.boundingBox.min.x<2200);}
 const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x112233,10,3000);scene.add(phone);
 const camera=new THREE.PerspectiveCamera(55,1,1,50000);camera.position.set(0,400,0);camera.lookAt(1,400,0);camera.updateMatrixWorld(true);
 phone.userData.revalidate(camera);
 assert.ok(phone.userData.pickables.some(m=>!m.visible),'chunks wholly past opaque fog are culled');
 live.userData.dispose();phone.userData.dispose();
});
