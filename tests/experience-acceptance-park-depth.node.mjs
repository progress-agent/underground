import test from 'node:test';import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';
import{installNodeEnv}from'../scripts/bake-node-env.mjs';installNodeEnv();
const terrain=await import('../src/terrain.js');const{initThamesMask}=await import('../src/thames-mask.js');const{loadM25Data,initM25Boundary}=await import('../src/m25.js');const{createParkLabels}=await import('../src/park-labels.js');
const registry=JSON.parse(await readFile(new URL('../public/data/park-labels.json',import.meta.url)));const metrics=JSON.parse(await readFile(new URL('./experience-parks-atlas-metrics.json',import.meta.url)));
const thames=JSON.parse(await readFile(new URL('../public/data/thames.json',import.meta.url)));initThamesMask(thames.points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints||m25.points);
const actual=await terrain.tryCreateTerrainMesh({thamesData:thames});assert.ok(actual);
const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({measureText:ch=>metrics.characters[ch],fillText(){}})})};
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const area=p=>p.slice(1,-1).reduce((sum,a,i)=>sum+cross(p[0],a,p[i+2]),0)/2;
function clip(poly,a,b,sign){const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],d=cross(a,b,p)*sign,e=cross(a,b,q)*sign;if(d>=-1e-8)out.push(p);if(d*e<0){const t=d/(d-e);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t})}}return out;}
function height(tri,p){const d=cross(...tri);return (cross(tri[1],tri[2],p)*tri[0].y+cross(tri[2],tri[0],p)*tri[1].y+cross(tri[0],tri[1],p)*tri[2].y)/d;}
function bounds(p){return{minX:Math.min(...p.map(p=>p.x)),maxX:Math.max(...p.map(p=>p.x)),minZ:Math.min(...p.map(p=>p.z)),maxZ:Math.max(...p.map(p=>p.z))};}
const overlaps=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
// Independent spatial lookup built from the final mesh index and vertex buffer,
// not from the production triangle query being used by the new glyph layout.
const geo=actual.mesh.geometry,pos=geo.attributes.position,index=geo.index.array,triangles=[],bins=new Map(),size=128;
const parkBoxes=registry.parks.map(p=>{const b=bounds(p.rings.flat().map(([x,z])=>({x,z})));return{minX:b.minX-128,maxX:b.maxX+128,minZ:b.minZ-128,maxZ:b.maxZ+128}});
for(let i=0;i<index.length;i+=3){const tri=[0,1,2].map(k=>({x:pos.getX(index[i+k])+actual.mesh.position.x,y:pos.getY(index[i+k]),z:pos.getZ(index[i+k])+actual.mesh.position.z}));const box=bounds(tri);if(!parkBoxes.some(p=>overlaps(p,box)))continue;if(Math.abs(cross(...tri))<1e-9)continue;const id=triangles.push({tri,box})-1;for(let x=Math.floor(box.minX/size);x<=Math.floor(box.maxX/size);x++)for(let z=Math.floor(box.minZ/size);z<=Math.floor(box.maxZ/size);z++){const key=`${x},${z}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(id);}}
test('all actual park glyph triangles stay on their correct side of the exact rendered terrain',async()=>{
 const group=await createParkLabels({data:registry,getSurfaceY:terrain.getTerrainMeshSurfaceY,getTrianglesForBounds:terrain.getTerrainSurfaceTriangles});
 let patchCount=0,intersections=0,minClearance=Infinity,maxClearance=-Infinity,uncoveredArea=0,totalArea=0;const failures=[];
 try{for(const mesh of group.children){const p=mesh.geometry.attributes.position,idx=mesh.geometry.index.array;let side;
  for(let i=0;i<idx.length;i+=3){const tri=[0,1,2].map(k=>({x:p.getX(idx[i+k])+mesh.position.x,y:p.getY(idx[i+k])+mesh.position.y,z:p.getZ(idx[i+k])+mesh.position.z})),box=bounds(tri);if(Math.abs(cross(...tri))<1e-8)continue;
   side??=Math.sign(tri[0].y-terrain.getTerrainMeshSurfaceY(tri[0]));assert.ok(side===1||side===-1);
   const candidates=new Set();for(let x=Math.floor(box.minX/size);x<=Math.floor(box.maxX/size);x++)for(let z=Math.floor(box.minZ/size);z<=Math.floor(box.maxZ/size);z++)for(const id of bins.get(`${x},${z}`)||[])candidates.add(id);
   let covered=0;
   for(const id of candidates){const t=triangles[id];if(!overlaps(box,t.box))continue;let poly=tri;const sign=Math.sign(cross(...t.tri));for(let e=0;e<3&&poly.length;e++)poly=clip(poly,t.tri[e],t.tri[(e+1)%3],sign);if(poly.length<3||Math.abs(area(poly))<1e-7)continue;covered+=Math.abs(area(poly));intersections++;
    for(const vertex of poly){const clearance=(height(tri,vertex)-height(t.tri,vertex))*side;minClearance=Math.min(minClearance,clearance);maxClearance=Math.max(maxClearance,clearance);if(clearance<1.98||clearance>2.02){if(failures.length<12)failures.push({mesh:mesh.name,triangle:i/3,vertex,clearance});}}
   }
   uncoveredArea+=Math.max(0,Math.abs(area(tri))-covered);totalArea+=Math.abs(area(tri));
   assert.ok(covered+1e-6>=Math.abs(area(tri))*.999,`${mesh.name}: full glyph triangle has terrain coverage ${JSON.stringify({i,covered,area:Math.abs(area(tri)),tri})}`);patchCount++;
  }
 }
 console.log(JSON.stringify({meshes:group.children.length,patchCount,intersections,minClearance,maxClearance,uncoveredArea,totalArea,failures}));assert.ok(uncoveredArea/totalArea<1e-7,'Unresolved clipping dust is below floating-point area tolerance');assert.equal(failures.length,0,'Every point must retain the intended ±2 canonical terrain lift, including triangle-interior extrema');
 }finally{group.userData.dispose();globalThis.document=previous;}
});
