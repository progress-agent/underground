import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createParkLabels, createParkLayout, parkContainsPoint, parkFootprintsOverlap } from '../src/park-labels.js';
import { relationRings, validateSimpleRing } from '../scripts/prepare-park-labels.mjs';
import { createSurfaceTexture, rasteriseTile, getParkBoundaryRepair } from '../src/surface-texture.js';
import { applyParkUndersideTexture } from '../src/terrain.js';

const data=JSON.parse(await readFile(new URL('../public/data/park-labels.json',import.meta.url)));
const source=JSON.parse(await readFile(new URL('../scripts/sources/park-boundary-repair-osm.json',import.meta.url)));
const atlasMetrics=JSON.parse(await readFile(new URL('./experience-parks-atlas-metrics.json',import.meta.url)));
const capHeight=atlasMetrics.characters.H.actualBoundingBoxAscent;
const actualMetrics=ch=>{const m=atlasMetrics.characters[ch];return {advance:m.width/capHeight,minX:-m.actualBoundingBoxLeft/capHeight,maxX:m.actualBoundingBoxRight/capHeight,minY:-(m.actualBoundingBoxDescent+capHeight/2)/capHeight,maxY:(m.actualBoundingBoxAscent-capHeight/2)/capHeight};};

test('all fourteen sourced parks have simple rings; relation islands are not connected by invented lines',()=>{
  assert.equal(data.parks.length,14);
  for(const park of data.parks)for(const ring of [...park.rings,...park.holes])assert.doesNotThrow(()=>validateSimpleRing(ring,park.name));
  assert.equal(relationRings(source,1384127).length,3);
  assert.equal(relationRings(source,1384127,'inner').length,4);
  assert.equal(relationRings(source,11127855).length,2);
  assert.throws(()=>validateSimpleRing([[0,0],[20,20],[0,20],[20,0]]),/intersecting/);
});

test('each named footprint has whole repeated inscriptions inside its boundary on both faces',()=>{
  for(const park of data.parks)for(const [index,ring]of park.rings.entries()) {
    if(park.id==='regents-park'&&index>0)continue;
    for(const side of [1,-1]) {
      const layout=createParkLayout({...park,ring},{side});
      assert.ok(layout.repetitions>=4,`${park.name} ${side}: too few complete inscriptions`);
      const expected=park.label.replaceAll(' ','');
      for(const repeat of new Set(layout.glyphs.map(g=>g.repeat))) {
        const glyphs=layout.glyphs.filter(g=>g.repeat===repeat);
        assert.equal(glyphs.map(g=>g.character).join(''),expected);
        for(const g of glyphs) {
          assert.ok(parkContainsPoint(ring,g.x,g.z));
          assert.ok(!park.holes.some(h=>parkContainsPoint(h,g.x,g.z)));
          // A rightward baseline crossed with upward type points at the viewer
          // on either face, proving opposite readable frames, not mirrored UVs.
          const normalY=g.tangent[1]*g.inward[0]-g.tangent[0]*g.inward[1];
          assert.ok(normalY*side>.99);
        }
      }
    }
  }
});

test('actual browser ink metrics give no glyph overlap anywhere in the fourteen parks, on either face',()=>{
  // Independently check polygon edge intersections and containment, rather than
  // using the production separating-axis function to verify its own decisions.
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function intersects(a,b) {
    if(a.some(p=>parkContainsPoint(b,...p))||b.some(p=>parkContainsPoint(a,...p)))return true;
    for(let i=0;i<4;i++)for(let j=0;j<4;j++) {
      const p=a[i],q=a[(i+1)%4],r=b[j],s=b[(j+1)%4];
      if(cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)return true;
    }
    return false;
  }
  let checked=0;
  for(const park of data.parks)for(const [index,ring]of park.rings.entries()) {
    if(park.id==='regents-park'&&index>0)continue;
    for(const side of [1,-1]) {
      const layout=createParkLayout({...park,ring},{side,metrics:actualMetrics});
      assert.ok(layout.repetitions>=4,`${park.name}: actual font leaves too few whole phrases`);
      assert.equal(layout.height,Math.min(24,Math.max(12,Math.sqrt(park.areaM2)*.019)),'physical type size must not be reduced to pass');
      for(const repeat of new Set(layout.glyphs.map(g=>g.repeat)))assert.equal(layout.glyphs.filter(g=>g.repeat===repeat).map(g=>g.character).join(''),park.label.replaceAll(' ',''));
      for(let i=0;i<layout.glyphs.length;i++) {
        const a=layout.glyphs[i];
        for(const point of a.footprint)assert.ok(parkContainsPoint(ring,...point),`${park.name}: glyph edge outside park`);
        for(let j=i+1;j<layout.glyphs.length;j++){assert.equal(intersects(a.footprint,layout.glyphs[j].footprint),false,`${park.name} ${side}: glyphs ${i}/${j} overlap`);checked++;}
      }
      if(park.id==='regents-park')assert.ok(layout.diagnostics.rejectedCollision+layout.diagnostics.rejectedTurn>0,'Regent tight corners must exercise rejection');
    }
  }
  assert.ok(checked>100000);
});

test('rotated footprint detector catches edge-crossing letters even with separate centres',()=>{
  const horizontal=[[-3,-.3],[3,-.3],[3,.3],[-3,.3]],vertical=[[-.3,-3],[.3,-3],[.3,3],[-.3,3]];
  assert.equal(parkFootprintsOverlap(horizontal,vertical),true);
  assert.equal(parkFootprintsOverlap(horizontal,vertical.map(([x,z])=>[x+10,z])),false);
});

test('raster repairs select East London Victoria only and preserve Regent inner holes',()=>{
  const victoria=data.parks.find(p=>p.id==='victoria-park'),regent=data.parks.find(p=>p.id==='regents-park');
  assert.equal(getParkBoundaryRepair({name:'Victoria Park',polygon:victoria.rings[0]}).id,'victoria-park');
  assert.equal(getParkBoundaryRepair({name:'Victoria Park',polygon:[[10000,10000],[10100,10000],[10100,10100]]}),undefined);
  const bbox={minX:-4000,maxX:1000,minZ:-6000,maxZ:0},size=700,state=createSurfaceTexture(bbox,size);
  rasteriseTile(state,{parks:[{name:regent.name,polygon:regent.rings[0]}]},{quiet:true});
  let testedHoles=0,testedGreen=0;
  for(let py=0;py<size;py+=3)for(let px=0;px<size;px+=3) {
    const x=bbox.minX+px/(size-1)*(bbox.maxX-bbox.minX),z=bbox.maxZ-py/(size-1)*(bbox.maxZ-bbox.minZ);
    const hole=regent.holes.some(r=>parkContainsPoint(r,x,z));
    if(hole){assert.equal(state.pixels[(py*size+px)*4+3],0);testedHoles++;}
    if(state.pixels[(py*size+px)*4+3])testedGreen++;
    assert.equal(state.pixels[(py*size+px)*4+2],0);
  }
  assert.ok(testedHoles>20);assert.ok(testedGreen>100);
  state.texture.dispose();
});

test('underside greenery chains prior masks, reads no road channel and keeps material depth/emission',()=>{
  const material=new THREE.MeshStandardMaterial({emissive:0x6b5842,emissiveIntensity:.2,depthWrite:false,side:THREE.BackSide});
  let previous=0;material.onBeforeCompile=shader=>{previous++;shader.fragmentShader+='\n// retained M25/dock mask';};
  const control=applyParkUndersideTexture(material,new THREE.Texture(),{minU:0,minV:0,maxU:1,maxV:1});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{});
  assert.equal(previous,1);assert.match(shader.fragmentShader,/retained M25\/dock mask/);
  assert.match(shader.fragmentShader,/texture2D\(parkUndersideTexture, parkUv\)\.a/);
  assert.doesNotMatch(shader.fragmentShader,/texture2D\(parkUndersideTexture, parkUv\)\.b/);
  assert.equal(material.depthWrite,false);assert.equal(material.emissiveIntensity,.2);
  control.setEnabled(false);assert.equal(shader.uniforms.parkUndersideEnabled.value,0);
  control.setEnabled(true);assert.equal(shader.uniforms.parkUndersideEnabled.value,1);
});

test('generated geometry tracks terrain on both faces and water suppression restores immediately',async()=>{
  const priorDocument=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({measureText:ch=>atlasMetrics.characters[ch],fillText(){}})})};
  try {
    const getSurfaceY=({x,z})=>x*.01+z*.02;
    const plane=[[-50000,0,-50000],[50000,0,-50000],[50000,0,50000],[-50000,0,50000]].map(([x,,z])=>[x,getSurfaceY({x,z}),z]);
    const group=await createParkLabels({getSurfaceY,data,getTrianglesForBounds:()=>[{triangleIndex:0,vertices:[plane[0],plane[1],plane[2]]},{triangleIndex:1,vertices:[plane[0],plane[2],plane[3]]}]});
    assert.equal(group.children.length,30); // two Victoria halves, others once
    for(const mesh of group.children) {
      const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
      assert.ok(mesh.userData.repetitions>=4,mesh.name);
      for(let i=0;i<p.count;i++) {
        assert.ok(Math.abs(p.getY(i)-getSurfaceY({x:p.getX(i),z:p.getZ(i)})-mesh.userData.side*2)<.002);
        assert.ok(n.getY(i)*mesh.userData.side>.99);
      }
    }
    const camera=new THREE.PerspectiveCamera();
    group.userData.update({camera,viewportHeight:900,submerged:true});assert.equal(group.visible,false);
    group.userData.update({camera,viewportHeight:900,submerged:false});assert.equal(group.visible,true);
    group.userData.update({camera,viewportHeight:900,labelsVisible:false});assert.equal(group.visible,false);
    group.userData.update({camera,viewportHeight:900,labelsVisible:true});assert.equal(group.visible,true);
    group.userData.dispose();
  } finally {globalThis.document=priorDocument;}
});
