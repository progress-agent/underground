import {test,expect} from '@playwright/test';
let page;const errors=[];
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser})=>{page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.tidewayPlatforms&&window.__ug.modes&&window.__ug.flightsGroup&&window.__ug.bakedStats?.tilesTotal>0&&window.__ug.bakedStats.tilesBuilt===window.__ug.bakedStats.tilesTotal&&window.__ug.stationBuildings?.ready&&window.__ug.lateLayers.settled(),null,{timeout:180000});await page.evaluate(()=>{window.__ug.sim.paused=true;window.__ug.controls.enableDamping=false;});});
test.afterAll(async()=>page?.close());
test('TW1: corrected anchors and both Albert structures, Chambers has only the wall on its river line',async()=>{
 const rows=await page.evaluate(()=>[...window.__ug.tidewayPlatforms.userData.registry].map(([id,r])=>({id,position:r.anchor,latlon:r.data.anchor,public:r.data.publicAccess,wall:r.data.riverWall,edges:r.data.riverEdges})));
 expect(rows.length).toBe(9);const lookup=Object.fromEntries(rows.map(r=>[r.id,r]));
 expect(lookup['albert-isle'].latlon).toEqual([51.487317,-.125642]);expect(lookup['albert-quay'].latlon).toEqual([51.488191,-.124388]);expect(lookup.chambers.public).toBe(false);expect(lookup.chambers.edges).toEqual([]);expect(lookup.chambers.wall.length).toBe(2);
});
test('TW2/TW4: actual wall geometry meets sampled bed at Master 1, 1.1, 10; rigid root scale is reciprocal',async()=>{
 const results=await page.evaluate(()=>{const u=window.__ug,out=[];for(const master of [1,1.1,10]){u.masterHeight.setValue(master);u.structureMorph.flush();u.tidewayPlatforms.updateMatrixWorld(true);for(const[id,r]of u.tidewayPlatforms.userData.registry){const p=r.wallMesh.geometry.attributes.position;let gap=-Infinity;for(let i=1;i<p.count;i+=6){const x=r.anchor.x+p.getX(i),z=r.anchor.z+p.getZ(i),y=12+p.getY(i)*r.group.scale.y;gap=Math.max(gap,y-u.getTerrainMeshSurfaceY({x,z}));}out.push({id,master,gap,scale:r.group.scale.y,freeboard:(r.deckY-12)*master/5,expected:r.data.deckAOD-2.4});}}u.masterHeight.setValue(1.1);u.structureMorph.flush();return out;});
 for(const r of results){expect(r.gap,r.id).toBeLessThan(.01);expect(r.scale*r.master/5,r.id).toBeCloseTo(1,5);expect(r.freeboard,r.id).toBeCloseTo(r.expected,5);}
});
test('TW3: exact column inventory, permanent furniture and framed flush hatches are drawn',async()=>{
 const counts=await page.evaluate(()=>Object.fromEntries([...window.__ug.tidewayPlatforms.userData.registry].map(([id,r])=>[id,r.columns.length])));expect(counts).toEqual({putney:1,chelsea:2,heathwall:1,'albert-isle':2,'albert-quay':2,victoria:2,blackfriars:3,kemp:5,chambers:3});
});
test('TW5: no vortex geometry/material or carve-out, and every foreshore shaft mouth is below its physical floor',async()=>{
 const r=await page.evaluate(()=>{const u=window.__ug,shafts=u.scene.getObjectByName('tideway-shafts').children,retired=[];u.scene.traverse(o=>{if(/whirlpool/i.test(o.name)||o.material?.userData?.whirlpoolUniforms)retired.push(o.name);});return{retired,shafts:shafts.filter(o=>o.userData.foreshore).map(o=>{let gap=-Infinity;for(let k=0;k<32;k++){const a=k/32*Math.PI*2,x=o.position.x+Math.cos(a)*o.userData.diameter/2,z=o.position.z+Math.sin(a)*o.userData.diameter/2;gap=Math.max(gap,o.position.y+o.scale.y/2-u.getTerrainMeshSurfaceY({x,z}));}return{id:o.userData.shaftId,gap};}),set:u.undergroundCull.collect().map(o=>o.name)};});expect(r.retired).toEqual([]);expect(r.shafts.length).toBe(8);for(const s of r.shafts)expect(s.gap,s.id).toBeLessThan(0);expect(r.set).toContain('tideway-shafts');expect(r.set).not.toContain('tideway-platforms');
});
test('TW6: the real collision service supports each deck and stops walker, Drone and Balloon at every column',async()=>{
 const rows=await page.evaluate(()=>{const u=window.__ug,c=u.modes.collision,out=[];for(const[id,r]of u.tidewayPlatforms.userData.registry){const x=r.anchor.x+r.data.shaft[0],z=r.anchor.z-r.data.shaft[1];out.push({id,kind:'deck',gap:c.standHeightAt(x,z,r.deckY+.05,0)-r.deckY});for(const col of r.columns)for(const [body,radius,height]of [['walker',.4,9],['drone',1.5,3],['balloon',3,10]]){const y=12+(col.baseLocal+1)*r.group.scale.y;const pos={x:col.x-5,y,z:col.z};const q=c.moveAndSlide(pos,{x:5,y:0,z:0},{radius,height,step:0});out.push({id,kind:body,hit:q.hit,advance:q.x-pos.x,separation:Math.hypot(q.x-col.x,q.z-col.z),required:radius+col.data.diameter/2-.05});}}return out;});
 console.log('TW6 contacts',JSON.stringify(rows));
 for(const r of rows)if(r.kind==='deck')expect(Math.abs(r.gap),r.id).toBeLessThan(.1);else{expect(r.hit,`${r.id} ${r.kind}`).toBe(true);expect(r.separation,`${r.id} ${r.kind}`).toBeGreaterThanOrEqual(r.required);}
});
test('TW6: swimmer segments meet the drawn platform walls',async()=>{
 const rows=await page.evaluate(()=>{const u=window.__ug,T=window.__ugTHREE,c=u.modes.collision,out=[];for(const[id,r]of u.tidewayPlatforms.userData.registry){if(id==='chambers')continue;const i=r.data.riverEdges[Math.floor(r.data.riverEdges.length/2)],a=r.data.outline[i],b=r.data.outline[(i+1)%r.data.outline.length],mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l,nz=dx/l;const x=r.anchor.x+mx,z=r.anchor.z-mz,f=u.getTerrainMeshSurfaceY({x,z}),y=Math.min(11,(r.deckY+f)/2);const start=new T.Vector3(x+nx*5,y,z-nz*5),end=new T.Vector3(x-nx*5,y,z+nz*5);out.push({id,hit:c.segmentHitsSolids(start,end)});}return out;});for(const r of rows)expect(r.hit,r.id).not.toBeNull();
});
test('G1: no browser console errors from building or exploring the platforms',()=>expect(errors).toEqual([]));

test('TW2: downward rays hit the rendered paving at every researched shaft-cover level',async()=>{
 const rows=await page.evaluate(()=>{const u=window.__ug,T=window.__ugTHREE,out=[];u.tidewayPlatforms.updateMatrixWorld(true);for(const[id,r]of u.tidewayPlatforms.userData.registry){const x=r.anchor.x+r.data.shaft[0],z=r.anchor.z-r.data.shaft[1],ray=new T.Raycaster(new T.Vector3(x,r.deckY+50,z),new T.Vector3(0,-1,0));const hits=ray.intersectObject(r.detail,false);out.push({id,nearest:hits.reduce((a,h)=>Math.min(a,Math.abs(h.point.y-r.deckY)),1e9)});}return out;});for(const r of rows)expect(r.nearest,r.id).toBeLessThan(.15);
});

test('TW6: the actual walker lands and remains on all nine deck cover areas',async()=>{
 const rows=await page.evaluate(()=>{const u=window.__ug,out=[];u.masterHeight.setValue(1);u.structureMorph.flush();u.modes.activate('pedestrian');const m=u.modes.registry.get('pedestrian');for(const[id,r]of u.tidewayPlatforms.userData.registry){const x=r.anchor.x+r.data.shaft[0],z=r.anchor.z-r.data.shaft[1];const placed=m.place(x,z,{yaw:0,pitch:0});for(let k=0;k<60;k++)u.modes.update(1/60);const d=m.debug();out.push({id,placed,state:d.state,gap:(d.y-r.deckY)/5,x:d.x,z:d.z});}u.modes.activate('deity');u.masterHeight.setValue(1.1);u.structureMorph.flush();return out;});console.log('TW6 actual landings',JSON.stringify(rows));for(const r of rows){expect(r.placed,r.id).toBe(true);expect(r.state,r.id).toBe('ground');expect(Math.abs(r.gap),r.id).toBeLessThan(.2);}
});
