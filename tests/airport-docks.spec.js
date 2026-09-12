import {test,expect} from '@playwright/test';
import * as THREE from 'three';
import {AIRPORT_DOCK_DATA,createAirportDockWater,getAirportDockAt,getAirportDockInfo,getAirportDockSurfaceY,installAirportDockTerrainMask} from '../src/airport-docks.js';
import {applyM25Mask} from '../src/m25.js';
import {createWaterMaterial,getWaterTuningSurface} from '../src/water-material.js';

test('water follows both exact closed-source wet polygons and keeps the airport island dry',()=>{
 expect(AIRPORT_DOCK_DATA.docks.map(d=>d.osm)).toEqual(['way/121158887','way/190792949']);expect(AIRPORT_DOCK_DATA.docks.map(d=>d.points.length)).toEqual([53,72]);
 const root=createAirportDockWater();expect(root.children).toHaveLength(2);
 for(let k=0;k<2;k++){const dock=AIRPORT_DOCK_DATA.docks[k],mesh=root.children[k],p=mesh.geometry.attributes.position;
  const area=Math.abs(dock.points.reduce((n,a,i)=>{const b=dock.points[(i+1)%dock.points.length];return n+a[0]*b[1]-b[0]*a[1];},0))/2;let triangles=0;
  for(let i=0;i<p.count;i+=3){const cross=(p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i));triangles+=Math.abs(cross)/2;expect(cross).toBeLessThan(0);const point={x:(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z:(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3};expect(getAirportDockAt(point)?.osm).toBe(dock.osm);}
  expect(Math.abs(triangles-area)/area).toBeLessThan(.00001);expect(mesh.geometry.attributes.normal.getY(0)).toBe(1);
 }
 // London City runway centre and terminal are land between/along the docks.
 for(const point of [{x:13300,z:260},{x:12290,z:70},{x:0,z:0}])expect(getAirportDockAt(point)).toBeNull();
 const material=root.children[0].material;expect(getWaterTuningSurface().materials.has(material)).toBe(true);root.userData.dispose();expect(getWaterTuningSurface().materials.has(material)).toBe(false);
});

test('published physical reference is separate from rendering lift and structure scaling',()=>{
 const d=AIRPORT_DOCK_DATA.docks[0],t=THREE.ShapeUtils.triangulateShape(d.points.map(p=>new THREE.Vector2(...p)),[])[0],point={x:t.reduce((n,i)=>n+d.points[i][0]/3,0),z:t.reduce((n,i)=>n+d.points[i][1]/3,0)};
 expect(getAirportDockInfo(point)).toMatchObject({referenceLevelM:4.26,kind:'dock'});expect(getAirportDockInfo(point).levelMeaning).toContain('not a live measurement or bathymetry');expect(getAirportDockSurfaceY(point)).toBeCloseTo(23.3);expect(getAirportDockSurfaceY(point,1)).toBeCloseTo(6.26);expect(getAirportDockSurfaceY({x:0,z:0})).toBeNull();
});

test('exact wet mask chains M25 clipping, preserves geometry and can be removed',()=>{
 const material=new THREE.MeshStandardMaterial();applyM25Mask(material,new THREE.Texture());const previous=material.onBeforeCompile,dispose=installAirportDockTerrainMask(material);expect(installAirportDockTerrainMask(material)).toBe(dispose);
 const shader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>\n#include <begin_vertex>\n}',fragmentShader:'void main() {\n#include <clipping_planes_fragment>\n}'};
 material.onBeforeCompile(shader);expect(shader.fragmentShader).toContain('m25Alpha < 0.5');expect(shader.fragmentShader).toContain('if(inAirportDock0(vAirportDockXZ)||inAirportDock1(vAirportDockXZ))discard;');expect(shader.vertexShader).toContain('(modelMatrix*vec4(transformed,1.0)).xz');expect(shader.uniforms.airportDock0.value.map(p=>p.toArray())).toEqual(AIRPORT_DOCK_DATA.docks[0].points);expect(material.customProgramCacheKey()).toContain(AIRPORT_DOCK_DATA.sourceSha256);dispose();expect(material.onBeforeCompile).toBe(previous);material.dispose();
});


test('dock opacity prevents exposed chalk tint without changing other water presets',()=>{
 const root=createAirportDockWater(),dock=root.children[0].material,reservoir=createWaterMaterial('reservoir');
 expect(dock.opacity).toBe(1);expect(reservoir.opacity).toBe(.52);expect(root.children[1].material).toBe(dock);
 expect(dock.color.getHex()).toBe(reservoir.color.getHex());expect(dock.roughness).toBe(reservoir.roughness);expect(dock.userData.waterKind).toBe('reservoir');expect(getWaterTuningSurface().materials.has(dock)).toBe(true);
 for(const mesh of root.children){expect(mesh.userData.referenceLevelM).toBe(4.26);expect(mesh.geometry.attributes.waterDepth.array.every(v=>v===0)).toBe(true);}
 root.userData.dispose();getWaterTuningSurface().materials.delete(reservoir);reservoir.dispose();
});
