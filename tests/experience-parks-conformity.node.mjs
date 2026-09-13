import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {installNodeEnv} from '../scripts/bake-node-env.mjs';
import {tryCreateTerrainMesh,getTerrainMeshSurfaceY,getTerrainSurfaceTriangles,getTerrainRiverBed,getTerrainBounds} from '../src/terrain.js';
import {initThamesMask} from '../src/thames-mask.js';
import {createParkLabels} from '../src/park-labels.js';

installNodeEnv();
const thames=JSON.parse(await readFile(new URL('../public/data/thames.json',import.meta.url)));
initThamesMask(thames.points);
const terrain=await tryCreateTerrainMesh({thamesData:thames});
assert.ok(terrain?.mesh);
const data=JSON.parse(await readFile(new URL('../public/data/park-labels.json',import.meta.url)));
const metrics=JSON.parse(await readFile(new URL('./experience-parks-atlas-metrics.json',import.meta.url)));
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({measureText:ch=>metrics.characters[ch],fillText(){}})})};
let queryCount=0;
const group=await createParkLabels({getSurfaceY:getTerrainMeshSurfaceY,data,getTrianglesForBounds:box=>{queryCount++;return getTerrainSurfaceTriangles(box);}});

test('query reads the final indexed wet-edge triangles without changing terrain',()=>{
  const {geometry,position:offset}=terrain.mesh,index=geometry.index.array,pos=geometry.attributes.position.array;
  const digest=()=>createHash('sha256').update(Buffer.from(pos.buffer)).update(Buffer.from(index.buffer)).digest('hex');
  const before=digest(),bed=getTerrainRiverBed().triangles[0];
  const box={minX:Math.min(...bed.map(p=>p.x))-.1,maxX:Math.max(...bed.map(p=>p.x))+.1,minZ:Math.min(...bed.map(p=>p.z))-.1,maxZ:Math.max(...bed.map(p=>p.z))+.1};
  const queried=getTerrainSurfaceTriangles(box),expected=[];
  for(let i=0;i<index.length;i+=3) {
    const vertices=[index[i],index[i+1],index[i+2]].map(k=>[pos[k*3]+offset.x,pos[k*3+1]+offset.y,pos[k*3+2]+offset.z]);
    if(vertices.every(p=>p[0]<box.minX)||vertices.every(p=>p[0]>box.maxX)||vertices.every(p=>p[2]<box.minZ)||vertices.every(p=>p[2]>box.maxZ))continue;
    expected.push({triangleIndex:i/3,vertices});
  }
  assert.deepEqual(queried,expected);
  const bounds=getTerrainBounds(),originalVertices=bounds.columns*bounds.rows;
  assert.ok(queried.some(t=>[0,1,2].some(k=>index[t.triangleIndex*3+k]>=originalVertices)),'query must include refined appended geometry');
  assert.equal(digest(),before);
});

test('every rendered glyph patch stays at its signed lift over real terrain, including interiors across old creases',()=>{
  assert.equal(queryCount,15,'one final-triangle query per footprint, reused by both faces');
  assert.equal(group.children.length,30);
  let triangles=0,samples=0,minimum=Infinity,maximum=-Infinity;
  for(const mesh of group.children) {
    const p=mesh.geometry.attributes.position,idx=mesh.geometry.index.array,side=mesh.userData.side;
    assert.equal(mesh.material.depthTest,true);assert.equal(mesh.material.depthWrite,false);
    for(let i=0;i<idx.length;i+=3) {
      const vertices=[idx[i],idx[i+1],idx[i+2]].map(k=>[p.getX(k),p.getY(k),p.getZ(k)]);
      triangles++;
      // Vertices, edges and interior barycentric samples include creases which
      // the previous corner-only test never examined.
      for(let u=0;u<=4;u++)for(let v=0;v<=4-u;v++) {
        const weights=[u/4,v/4,1-(u+v)/4],point=[0,1,2].map(axis=>vertices.reduce((s,p,k)=>s+p[axis]*weights[k],0));
        const surface=getTerrainMeshSurfaceY({x:point[0],z:point[2]});
        assert.ok(Number.isFinite(surface));const clearance=(point[1]-surface)*side;
        assert.ok(Math.abs(clearance-2)<.03,`${mesh.name} triangle ${i/3}: clearance ${clearance}`);
        minimum=Math.min(minimum,clearance);maximum=Math.max(maximum,clearance);samples++;
      }
    }
  }
  assert.ok(triangles>5000);assert.ok(triangles<40000,'terrain conformity must remain a bounded geometry cost');
  console.log(JSON.stringify({parkTriangles:triangles,samples,minCanonicalClearance:minimum,maxCanonicalClearance:maximum}));
});

test('neutral glyph ranges cover every finite vertex/index and preserve complete original atlas cells',()=>{
  for(const mesh of group.children) {
    const g=mesh.geometry,uv=g.attributes.uv,index=g.index.array,ranges=g.userData.glyphRanges;
    let nextVertex=0,nextIndex=0;
    assert.equal(ranges.length,mesh.userData.glyphs);
    for(const range of ranges) {
      assert.equal(range.firstVertex,nextVertex);assert.equal(range.firstIndex,nextIndex);
      assert.ok(range.indexCount>=3&&range.indexCount%3===0);
      for(let i=range.firstIndex;i<range.firstIndex+range.indexCount;i++)assert.ok(index[i]>=range.firstVertex&&index[i]<range.firstVertex+range.vertexCount);
      const glyphIndex="ABCDEFGHIJKLMNOPQRSTUVWXYZ'.-".indexOf(range.character),cellX=glyphIndex%8,cellY=Math.floor(glyphIndex/8);
      const u0=cellX/8,u1=(cellX+1)/8,v0=1-(cellY+1)/4,v1=1-cellY/4;
      let uvArea=0;
      for(let i=range.firstIndex;i<range.firstIndex+range.indexCount;i+=3) {
        const [a,b,c]=[index[i],index[i+1],index[i+2]].map(k=>[uv.getX(k),uv.getY(k)]);
        uvArea+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
        for(const [u,v]of[a,b,c])assert.ok(u>=u0-1e-7&&u<=u1+1e-7&&v>=v0-1e-7&&v<=v1+1e-7);
      }
      assert.ok(Math.abs(uvArea-(u1-u0)*(v1-v0))<1e-6,'clipping must neither omit nor duplicate atlas coverage');
      nextVertex+=range.vertexCount;nextIndex+=range.indexCount;
    }
    assert.equal(nextVertex,g.attributes.position.count);assert.equal(nextIndex,index.length);
    assert.ok(mesh.userData.repetitions>=4);
  }
});
