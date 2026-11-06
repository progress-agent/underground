import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTidewayPlatforms,TIDEWAY_PLATFORM_DATA,createTidewayBuildingExclusion} from '../src/tideway-platforms.js';
import {createVerticalScaleController} from '../src/vertical-scale.js';
import {bindMasterController} from '../src/true-proportion.js';
import {createSolidWorld} from '../src/modes/solids.js';
const ll=(lat,lon)=>({x:(lon+.12)*69300,z:-(lat-51.5)*111132});
const expected={putney:1,chelsea:2,heathwall:1,'albert-isle':2,'albert-quay':2,victoria:2,blackfriars:3,kemp:5,chambers:3};
const make=()=>createTidewayPlatforms({llToXZ:ll,floorAt:(x,z)=>-20+x*.001-z*.002});
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
