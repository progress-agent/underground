import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTidewayPlatforms,TIDEWAY_PLATFORM_DATA,createTidewayBuildingExclusion} from '../src/tideway-platforms.js';
import {createVerticalScaleController} from '../src/vertical-scale.js';
import {bindMasterController} from '../src/true-proportion.js';
import {approachSideFaces} from '../src/tideway-approaches.js';
import {createSolidWorld} from '../src/modes/solids.js';
const ll=(lat,lon)=>({x:(lon+.12)*69300,z:-(lat-51.5)*111132});
const expected={putney:1,chelsea:2,heathwall:1,'albert-isle':2,'albert-quay':2,victoria:2,blackfriars:3,kemp:5,chambers:3};
const make=()=>createTidewayPlatforms({llToXZ:ll,floorAt:(x,z)=>-20+x*.001-z*.002,isDryLand:()=>true});
test('eight researched sites, Albert has two structures; Chambers is on land with a separate wall',()=>{
 const g=make();assert.equal(new Set(TIDEWAY_PLATFORM_DATA.sites.map(s=>s.siteId)).size,8);assert.equal(g.userData.registry.size,9);
 for(const [id,r] of g.userData.registry){assert.equal(r.columns.length,expected[id],id);assert.ok(r.detail.geometry.attributes.position.count>0);assert.ok(r.data.sources.figures);assert.ok(r.data.shaftDiameter>0);}
 const c=g.userData.registry.get('chambers');assert.equal(c.data.publicAccess,false);assert.equal(c.data.riverEdges.length,0);assert.equal(c.data.riverWall.length,2);g.userData.dispose();
});
test('merged real geometry is finite, opaque, and the complete position/color/normal buffer lengths agree',()=>{
 const g=make();g.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;assert.ok(p.count>0);assert.equal(o.geometry.attributes.color.count,p.count);assert.equal(o.geometry.attributes.normal.count,p.count);for(const v of p.array)assert.ok(Number.isFinite(v));assert.equal(o.material.transparent,false);});g.userData.dispose();
});
test('columns and deck freeboard keep their real proportions at Master 1, 1.1 and 10; walls meet the physical bed',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1});const off=bindMasterController(master);const g=make();
 for(const m of [1,1.1,10]) {master.setValue(m);g.updateMatrixWorld(true);
  for(const [id,r] of g.userData.registry){assert.ok(Math.abs(r.group.scale.y*m/5-1)<1e-9,id);assert.ok(Math.abs((r.deckY-12)*m/5-(r.data.deckAOD-2.4))<1e-8,id);for(const p of r.wallSamples)assert.ok(p.bottomY<=p.floorY+1e-6,id);}
 }
 g.userData.dispose();off();master.dispose();
});
test('all decks support a landing and all columns/water walls stop body segments at each Master',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1});const off=bindMasterController(master);const g=make(),scene=new THREE.Scene();scene.add(g);
 const world=createSolidWorld({getGroundY:()=>-20,getHeightScale:()=>1/master.value});world.setSources({tideway:()=>g});
 for(const m of [1,1.1,10]) {master.setValue(m);world.update();
  for(const [id,r] of g.userData.registry){
    // Choose the shaft-cover point, inside the actual deck footprint, and query the shared collision path.
    const x=r.anchor.x+r.data.shaft[0],z=r.anchor.z-r.data.shaft[1];const stand=world.standOn(x,z,Infinity,0);assert.ok(stand>=r.deckY-1e-6,id);
    for(const c of r.columns){const a={x:c.x-3,z:c.z},q={x:c.x+3,z:c.z};const y=12+(c.baseLocal+2)*5/m;assert.notEqual(world.segmentHits(a.x,y,a.z,q.x,y,q.z),null,`${id} column`);}
    const deck=r.solids.find(s=>s.kind==='deck');const a=deck.ring[0],b=deck.ring[1],mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
    assert.notEqual(world.segmentHits(mx-5,Math.min(10,r.deckY-1),mz,mx+5,Math.min(10,r.deckY-1),mz),null,`${id} swimmer wall`);
  }
 }
 g.userData.dispose();off();master.dispose();
});

test('source north maps to negative scene Z: actual deck triangles meet every shaft-cover point',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1.1});const off=bindMasterController(master),g=make();g.updateMatrixWorld(true);
 for(const [id,r]of g.userData.registry){const x=r.anchor.x+r.data.shaft[0],z=r.anchor.z-r.data.shaft[1];const ray=new THREE.Raycaster(new THREE.Vector3(x,r.deckY+50,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(r.detail,false);assert.ok(hits.some(h=>Math.abs(h.point.y-r.deckY)<.15),id);}
 g.userData.dispose();off();master.dispose();
});

test('Tyburn entrance terrace is a metre below the raised viewing platform, as the research specifies',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1});const off=bindMasterController(master),g=make(),r=g.userData.registry.get('victoria');g.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(new THREE.Vector3(r.anchor.x-12,100,r.anchor.z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(r.detail,false);assert.ok(hits.some(h=>Math.abs(h.point.y-22)<.1),'4.4 m AOD entrance paving');assert.equal(r.deckY,27,'5.4 m AOD raised deck');g.userData.dispose();off();master.dispose();
});

test('Chambers paving and above-ground plant stay behind its river wall; only its ecological ledge projects',()=>{
 const g=make(),r=g.userData.registry.get('chambers'),a=ll(...r.data.riverWall[0]),b=ll(...r.data.riverWall[1]),dx=b.x-a.x,dz=b.z-a.z;
 const sign=Math.sign(dx*(r.anchor.z-a.z)-dz*(r.anchor.x-a.x));const side=(x,z)=>sign*(dx*(z-a.z)-dz*(x-a.x));
 const p=r.detail.geometry.attributes.position,level=r.data.deckAOD-2.4;
 for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i)-level)<1e-4)assert.ok(side(r.anchor.x+p.getX(i),r.anchor.z+p.getZ(i))>=-1,'operational paving and plant base are on land');
 for(const c of r.columns)assert.ok(side(c.x,c.z)>0,'vent column on land');g.userData.dispose();
});


test('Chambers replacement predicate matches both building paths and keeps neighbours',()=>{
 const excludes=createTidewayBuildingExclusion(ll),p=ll(51.50074,-.06549);
 assert.equal(excludes({x:p.x+4.4,z:p.z-8.2}),true,'baked legacy box centre in operational paving');
 assert.equal(excludes({cx:p.x+4.4,cz:p.z-8.2}),true,'same live record');
 for(const[x,z]of[[p.x+70,p.z],[p.x-50,p.z],[p.x,p.z+50],[p.x,p.z-80]])assert.equal(excludes({x,z}),false,'neighbour retained');
 assert.equal(createTidewayBuildingExclusion(ll),excludes,'constant cached predicate, no per-building projection');
});

test('sourced walkable approach levels preserve the deck/path relationship independently of the terrain',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1});const off=bindMasterController(master),g=make();
 const expected={putney:1,chelsea:-1.05,heathwall:0,'albert-isle':0,'albert-quay':.5,victoria:1,blackfriars:0,kemp:0,chambers:0};
 for(const m of [1,1.1]){master.setValue(m);g.updateMatrixWorld(true);for(const[id,r]of g.userData.registry){
  const a=r.approach,f=a.frame;
  const x=r.anchor.x+f.x+f.nx*6,z=r.anchor.z-f.z-f.nz*6,y=12+a.landingY*r.group.scale.y;
  const ray=new THREE.Raycaster(new THREE.Vector3(x,y+10,z),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(r.approachMesh,false).some(h=>Math.abs(h.point.y-y)<1e-5),`${id} actual paved approach`);
  assert.ok(Math.abs((r.deckY-y)/r.group.scale.y-expected[id])<1e-8,`${id} researched relationship`);
  for(let i=1;i<a.slabs.length;i++)assert.ok(Math.abs(a.slabs[i].y-a.slabs[i-1].y)<=.150001,`${id} real-size riser`);
  const bounds=new THREE.Box3().setFromObject(r.approachMesh);assert.ok(r.builtBounds.containsBox(bounds),`${id} full extent includes approach`);
 }}g.userData.dispose();off();master.dispose();
});

test('Chelsea has joined, planted end terraces totalling 8 m at each end, not a narrow generic river band',()=>{
 const g=make(),r=g.userData.registry.get('chelsea'),p=r.detail.geometry.attributes.position,c=r.detail.geometry.attributes.color;
 assert.equal(r.endTerraces.length,6);
 for(let end=0;end<2;end++){
  assert.ok(Math.abs(r.endTerraces.slice(end*3,end*3+3).reduce((a,s)=>a+s.widthM,0)-8)<1e-8);
  assert.deepEqual(r.endTerraces.slice(end*3,end*3+3).map(s=>s.levelAOD),[4.4,3.95,3.5]);
 }
 // Actual outward vertices at all shelf levels. A source-derived normal at
 // the west end makes this independent of the builder's extent metadata.
 const a=r.data.outline[7],b=r.data.outline[8],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len;
 let far=0,green=0;for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=-p.getZ(i),d=(x-a[0])*nx+(z-a[1])*nz;
  if(Math.abs(p.getY(i)-(3.5-2.4))<1e-4)far=Math.max(far,d);
  if(c.getY(i)>c.getX(i)&&c.getY(i)>c.getZ(i))green++;
 }
 assert.ok(far>=6&&far<=12,`actual outer west terrace ${far} m from its inner edge`);assert.ok(green>500,'beds and low rush clumps occupy the terraces');g.userData.dispose();
});

test('Chelsea planting shelves have closed end walls down to the physical floor',()=>{
 const camera=new THREE.PerspectiveCamera(),master=createVerticalScaleController({camera,value:1}),off=bindMasterController(master),g=make(),r=g.userData.registry.get('chelsea');g.updateMatrixWorld(true);
 // Cross the open end of the west shelf, away from its parallel outer face.
 const a=r.data.outline[6],b=r.data.outline[7],length=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/length,tz=(b[1]-a[1])/length,nx=tz,nz=-tx,mx=a[0]+nx*4/3,mz=a[1]+nz*4/3;
 const ray=new THREE.Raycaster(new THREE.Vector3(r.anchor.x+mx-tx*2,20,r.anchor.z-mz+tz*2),new THREE.Vector3(tx,0,-tz),0,4);
 assert.ok(ray.intersectObject(r.wallMesh,false).some(h=>Math.abs(h.distance-2)<1e-4),'the visible end face closes the solid shelf');g.userData.dispose();off();master.dispose();
});


test('walls and approaches share the actual rendered site mesh, with the wall range in its live buffer',()=>{
 const g=make();let meshes=0;g.traverse(o=>{if(o.isMesh)meshes++;});assert.equal(meshes,11);
 for(const[id,r]of g.userData.registry){
  assert.equal(r.wallMesh,r.detail,id);assert.equal(r.approachMesh,r.detail,id);assert.ok(r.group.children.includes(r.detail),id);
  const p=r.detail.geometry.attributes.position,{start,count}=r.wallVertexRange;assert.ok(start>0&&count>0&&start+count===p.count,id);assert.equal(count%6,0,id);
  for(let i=start;i<start+count;i+=6){assert.ok(p.getY(i)>=p.getY(i+1),id);assert.ok(p.getY(i)>=p.getY(i+2),id);}
 }g.userData.dispose();
});


test('joined approach volume retains exposed risers and lower faces, omitting only the covered interior',()=>{
 const slab=(a,b,y)=>({ring:[[a,1],[b,1],[b,-1],[a,-1]],y});
 for(const [heights,bases,expected]of [[[2,3],[0,0],[[2,3]]],[[2,3],[0,1],[[0,1],[2,3]]],[[3,2],[1,0],[[2,3],[0,1]]]]){
  const slabs=[slab(0,1,heights[0]),slab(1,2,heights[1])],faces=approachSideFaces(slabs,bases),seam=faces.filter(f=>f.a[0]===1&&f.b[0]===1);
  assert.deepEqual(seam.map(f=>[f.lo,f.hi]),expected);
  assert.equal(faces.filter(f=>f.edge===0||f.edge===2).length,4,'both continuous outer sides remain');
  assert.equal(faces.filter(f=>f.a[0]===0&&f.b[0]===0||f.a[0]===2&&f.b[0]===2).length,2,'both terminal caps remain');
 }
 const separated=[slab(0,1,2),slab(1.01,2,3)];assert.equal(approachSideFaces(separated,[0,0]).length,8,'unmatched edges retain all faces');
});
