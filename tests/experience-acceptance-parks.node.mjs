import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createParkLabels } from '../src/park-labels.js';
const registry = JSON.parse(await readFile(new URL('../public/data/park-labels.json', import.meta.url)));
const metrics = JSON.parse(await readFile(new URL('./experience-parks-atlas-metrics.json', import.meta.url)));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ'.-";
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function inside(p, ring) {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a[1] <= p[1] && b[1] > p[1] && cross(a, b, p) > 0) winding++;
    if (a[1] > p[1] && b[1] <= p[1] && cross(a, b, p) < 0) winding--;
  }
  return winding !== 0;
}
function crossing(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0) return true;
  }
  return false;
}
test('actual rendered glyph geometry with browser ink metrics has no collisions or boundary crossings', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: ch => metrics.characters[ch], fillText() {} }) }) };
  let group;
  try {
    // Y is irrelevant to this horizontal lettering proof. No claim about the
    // real terrain is made from this CPU-only creation; GPU raycasts test that.
    group = await createParkLabels({ data: registry, getSurfaceY: () => 0,
      getTrianglesForBounds: b => [
        { triangleIndex: 0, vertices: [[b.minX-1,0,b.minZ-1],[b.maxX+1,0,b.minZ-1],[b.maxX+1,0,b.maxZ+1]] },
        { triangleIndex: 1, vertices: [[b.minX-1,0,b.minZ-1],[b.maxX+1,0,b.maxZ+1],[b.minX-1,0,b.maxZ+1]] },
      ] });
    let checked = 0, glyphCount = 0;
    for (const mesh of group.children) {
      const park = registry.parks.find(p => p.id === mesh.userData.parkId), positions = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
      const polys = [], rendered = [];
      const index=mesh.geometry.index.array;
      const ranges=mesh.geometry.userData.glyphRanges;
      assert.ok(ranges?.length, `${mesh.name}: glyph index ranges are available for independent reconstruction`);
      let nextVertex=0,nextIndex=0;
      for (const range of ranges) {
        assert.equal(range.firstVertex,nextVertex);assert.equal(range.firstIndex,nextIndex);
        nextVertex+=range.vertexCount;nextIndex+=range.indexCount;
        let meanU=0,meanV=0;
        for(let j=range.firstVertex;j<nextVertex;j++){meanU+=uv.getX(j);meanV+=uv.getY(j);}
        meanU/=range.vertexCount;meanV/=range.vertexCount;
        const column=Math.floor(meanU*8),row=Math.floor((1-meanV)*4),character=alphabet[row*8+column];
        assert.equal(range.character,character,'Character comes from actual atlas UVs, independently of metadata');
        const m=metrics.characters[character],cap=metrics.characters.H.actualBoundingBoxAscent;
        assert.ok(m, `${mesh.name}: actual UV cell resolves a glyph`);
        let basis,maxArea=0,totalUvArea=0;
        for(let j=range.firstIndex;j<nextIndex;j+=3){
          const ids=[index[j],index[j+1],index[j+2]];
          for(const id of ids)assert.ok(id>=range.firstVertex&&id<nextVertex,'Every actual index belongs to this glyph');
          const coords=ids.map(id=>[uv.getX(id),uv.getY(id)]),signed=cross(...coords),size=Math.abs(signed)/2;
          totalUvArea+=size;if(size>maxArea){maxArea=size;basis={ids,coords,signed};}
        }
        assert.ok(maxArea>1e-12);assert.ok(Math.abs(totalUvArea-1/32)<1e-6,'All atlas-cell area survives terrain tessellation');
        const xmin=(64-m.actualBoundingBoxLeft)/128,xmax=(64+m.actualBoundingBoxRight)/128;
        const ymin=1-(64+cap/2+m.actualBoundingBoxDescent)/128,ymax=1-(64+cap/2-m.actualBoundingBoxAscent)/128;
        const polygon=[[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax]].map(([s,t])=>{
          const q=[(column+s)/8,1-(row+1)/4+t/4],c=basis.coords;
          const weights=[cross(c[1],c[2],q),cross(c[2],c[0],q),cross(c[0],c[1],q)].map(n=>n/basis.signed);
          return [weights.reduce((sum,w,i)=>sum+w*positions.getX(basis.ids[i]),0),weights.reduce((sum,w,i)=>sum+w*positions.getZ(basis.ids[i]),0)];
        });
        assert.ok(park.rings.some(ring => polygon.every(p => inside(p, ring)) && !crossing(polygon, ring)), `${mesh.name}: ink fits a genuine park ring`);
        for (const hole of park.holes) assert.ok(!polygon.some(p => inside(p, hole)) && !crossing(polygon, hole) && !inside(hole[0], polygon), `${mesh.name}: ink avoids source hole`);
        polys.push(polygon); rendered.push(character); glyphCount++;
      }
      assert.equal(nextVertex,positions.count);assert.equal(nextIndex,index.length);
      const phrase = park.label.replaceAll(' ', '');
      assert.ok(rendered.length / phrase.length >= 4, `${mesh.name}: at least four complete rendered names`);
      assert.equal(rendered.join(''), phrase.repeat(rendered.length / phrase.length), `${mesh.name}: no clipped/missing/reversed letters`);
      for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
        const a = polys[i], b = polys[j];
        assert.ok(!crossing(a, b) && !a.some(p => inside(p, b)) && !b.some(p => inside(p, a)), `${mesh.name}: actual ink polygons ${i}/${j} collide`);
        checked++;
      }
    }
    console.log(JSON.stringify({ renderedMeshes: group.children.length, renderedGlyphs: glyphCount, independentRenderedGlyphPairChecks: checked }));
  } finally { group?.userData.dispose(); globalThis.document = previous; }
});
