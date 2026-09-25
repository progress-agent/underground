import * as THREE from 'three';
import data from './airport-docks-data.json' with {type:'json'};
import {createWaterMaterial,getWaterTuningSurface} from './water-material.js';
import {RENDER_ORDER,WATER_LIFT} from './render-layers.js';
import {getStructuralSurfaceY} from './terrain.js';

// ── Dock bed and quay walls (sprint 25Sep26f, D-039, Lane W) ─────────────
// The terrain is masked open over each wet polygon, so a flat, non-depth-
// writing water sheet let the underground (and the pale chalk) show through
// from above and left the dock a bottomless hole from below. The water now
// draws opaque and writes depth, and each dock is a closed basin: vertical
// quay walls from the surrounding ground down to a flat bed. The bed depth is
// the documented design depth of each dock below its impounded water level,
// an illustrative flat floor, not surveyed bathymetry.
export const DOCK_DEPTHS={
 'way/121158887':{depthM:8.2,note:'Royal Albert Dock, 27 ft deep as built (1880)',source:'https://www.gracesguide.co.uk/Royal_Albert_Dock'},
 'way/190792949':{depthM:11.6,note:'King George V Dock, 38 ft deep as built (1921)',source:'https://alondoninheritance.com/london-infrastructure/king-george-v-dock-the-last-of-the-royals/'},
};
const DEFAULT_DOCK_DEPTH_M=8;
export function getAirportDockBedY(point,VE=5){const dock=getAirportDockAt(point);if(!dock)return null;const d=DOCK_DEPTHS[dock.osm]?.depthM??DEFAULT_DOCK_DEPTH_M;return (dock.referenceLevelM-d)*VE;}
function dockBasinMaterials(){
 const wall=new THREE.MeshStandardMaterial({color:0x6b665d,roughness:0.92,metalness:0,side:THREE.DoubleSide});wall.name='airport-dock-wall';
 const bed=new THREE.MeshStandardMaterial({color:0x3f3a31,roughness:1,metalness:0,side:THREE.DoubleSide});bed.name='airport-dock-bed';
 return {wall,bed};
}
function buildDockBasin(dock,ring,triangles,VE,surfaceAt,mats){
 const waterY=dock.referenceLevelM*VE+WATER_LIFT,bedY=((dock.referenceLevelM-(DOCK_DEPTHS[dock.osm]?.depthM??DEFAULT_DOCK_DEPTH_M))*VE);
 const bedPos=triangles.flatMap(t=>{const [a,b,c]=t.map(i=>ring[i]);const tt=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0?[...t].reverse():t;return tt.flatMap(i=>[ring[i].x,bedY,ring[i].y]);});
 const bedGeo=new THREE.BufferGeometry();bedGeo.setAttribute('position',new THREE.Float32BufferAttribute(bedPos,3));bedGeo.computeVertexNormals();bedGeo.computeBoundingSphere();
 const bed=new THREE.Mesh(bedGeo,mats.bed);bed.name=`airport-dock-bed-${dock.osm.replace('/','-')}`;
 // Wall tops meet the ground cut by the terrain mask, never below the water.
 const top=ring.map(p=>{const y=surfaceAt?.({x:p.x,z:p.y});return Math.max(waterY,Number.isFinite(y)?y+0.3:waterY);});
 const w=[];
 for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length,a=ring[i],b=ring[j];
  w.push(a.x,top[i],a.y, a.x,bedY,a.y, b.x,bedY,b.y,  a.x,top[i],a.y, b.x,bedY,b.y, b.x,top[j],b.y);}
 const wallGeo=new THREE.BufferGeometry();wallGeo.setAttribute('position',new THREE.Float32BufferAttribute(w,3));wallGeo.computeVertexNormals();wallGeo.computeBoundingSphere();
 const walls=new THREE.Mesh(wallGeo,mats.wall);walls.name=`airport-dock-walls-${dock.osm.replace('/','-')}`;
 for(const m of [bed,walls]){m.raycast=()=>{};m.userData={type:'airport-dock-basin',bedY,waterY,depthM:(waterY-WATER_LIFT-bedY)/VE};}
 return {bed,walls,bedY};
}

export const AIRPORT_DOCK_DATA=data;
const inside=(x,z,points)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
 const a=points[i],b=points[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
}return hit;};
export function getAirportDockAt({x,z}){return data.docks.find(d=>inside(x,z,d.points))||null;}
/** Canonical rendered water Y includes the shared water separation lift. For HUD
 * physical elevation use getAirportDockInfo().referenceLevelM, never divide this
 * rendering offset back into a purported survey measurement. */
export function getAirportDockSurfaceY(point,VE=5){const dock=getAirportDockAt(point);return dock?dock.referenceLevelM*VE+WATER_LIFT:null;}
export function getAirportDockInfo(point){const d=getAirportDockAt(point);return d?{name:d.name,kind:'dock',osm:d.osm,referenceLevelM:d.referenceLevelM,datum:d.datum,levelMeaning:d.levelMeaning,sourceUrl:d.levelSource}:null;}

/** Two exact mapped water polygons. No terrain vertices or bathymetry change. */
export function createAirportDockWater({VE=5,surfaceAt=getStructuralSurfaceY}={}){
 if(!Number.isFinite(VE)||VE<=0)throw Error('Dock vertical exaggeration must be positive');
 const root=new THREE.Group();root.name='airport-dock-water';
 // The exact wet mask exposes bright chalk, not a known dock bed. Opaque
 // dock water prevents that unrelated layer tinting the surface. Retain the
 // shared palette/ripples without inventing bathymetry or changing reservoirs.
 const material=createWaterMaterial('reservoir',{opacity:1});
 // Solid water: opaque queue and depth writes, so nothing beneath is composited
 // over it (the underground infra draws later in the transparent queue).
 material.transparent=false;material.depthWrite=true;
 const basin=dockBasinMaterials();
 for(const dock of data.docks){const ring=dock.points.map(p=>new THREE.Vector2(...p)),triangles=THREE.ShapeUtils.triangulateShape(ring,[]),y=dock.referenceLevelM*VE+WATER_LIFT;
  const positions=triangles.flatMap(t=>{const [a,b,c]=t.map(i=>ring[i]);if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0)t.reverse();return t.flatMap(i=>[ring[i].x,y,ring[i].y]);});
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const count=positions.length/3;geometry.setAttribute('waterDepth',new THREE.BufferAttribute(new Float32Array(count),1));geometry.setAttribute('waterEdge',new THREE.BufferAttribute(new Float32Array(count),1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=`airport-dock-${dock.osm.replace('/','-')}`;mesh.renderOrder=RENDER_ORDER.SURFACE_WATER;
  mesh.userData={type:'airport-dock',name:dock.name,kind:'dock',osm:dock.osm,referenceLevelM:dock.referenceLevelM,datum:dock.datum,levelMeaning:dock.levelMeaning,sourceUrl:dock.levelSource,renderLiftY:WATER_LIFT};root.add(mesh);
  const b=buildDockBasin(dock,ring,triangles,VE,surfaceAt,basin);mesh.userData.bedY=b.bedY;mesh.add(b.bed,b.walls);
 }
 root.userData.pickables=[...root.children];root.userData.dispose=()=>{for(const mesh of root.children){mesh.geometry.dispose();for(const c of mesh.children)c.geometry.dispose();}basin.wall.dispose();basin.bed.dispose();getWaterTuningSurface().materials.delete(material);material.dispose();root.removeFromParent();};return root;
}

/** Install after applyM25Mask on terrain top and underside. Existing shader hooks
 * are chained. This is a bounded visual wet-surface mask, not a terrain carve:
 * physical source elevations and all outside-polygon land are unchanged. */
export function installAirportDockTerrainMask(material){
 if(material.userData.airportDockMask)return material.userData.airportDockMask.dispose;
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
 const declarations=['varying vec2 vAirportDockXZ;'];const tests=[];
 for(let k=0;k<data.docks.length;k++){
  const dock=data.docks[k],n=dock.points.length,x=dock.points.map(p=>p[0]),z=dock.points.map(p=>p[1]);
  declarations.push(`uniform vec2 airportDock${k}[${n}];\nbool inAirportDock${k}(vec2 p){\n if(p.x<${Math.min(...x).toFixed(3)}||p.x>${Math.max(...x).toFixed(3)}||p.y<${Math.min(...z).toFixed(3)}||p.y>${Math.max(...z).toFixed(3)})return false;\n bool hit=false;\n for(int i=0;i<${n};i++){vec2 a=airportDock${k}[i];vec2 b=airportDock${k}[(i+${n-1})%${n}];if((a.y>p.y)!=(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}`);
  tests.push(`inAirportDock${k}(vAirportDockXZ)`);
 }
 material.onBeforeCompile=function(shader,renderer){
  previous?.call(this,shader,renderer);
  for(let k=0;k<data.docks.length;k++)shader.uniforms[`airportDock${k}`]={value:data.docks[k].points.map(p=>new THREE.Vector2(...p))};
  shader.vertexShader=shader.vertexShader.replace('void main() {','varying vec2 vAirportDockXZ;\nvoid main() {').replace('#include <begin_vertex>','#include <begin_vertex>\n vAirportDockXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
  shader.fragmentShader=shader.fragmentShader.replace('void main() {',declarations.join('\n')+'\nvoid main() {').replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>\n if(${tests.join('||')})discard;`);
 };
 material.customProgramCacheKey=function(){return `${previousKey.call(this)}|airport-wet-dock-v1-${data.sourceSha256}`;};
 const dispose=()=>{material.onBeforeCompile=previous;material.customProgramCacheKey=previousKey;delete material.userData.airportDockMask;material.needsUpdate=true;};
 material.userData.airportDockMask={dispose,meaning:'Visual exact wet-polygon mask; no bathymetry'};material.needsUpdate=true;return dispose;
}
