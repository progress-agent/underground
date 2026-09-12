import {test,expect} from '@playwright/test';
async function ready(page){
 await page.goto('/?buildings=baked&skip=1');
 await page.waitForFunction(()=>window.__ug?.bridgeRegistry?.size===41&&window.__ug.overground?.userData.stationsAttached&&document.getElementById('loadingBar').classList.contains('done'));
}

test('all bridge decks scale from water, retain XZ and restore their full geometry',async({page})=>{
 await ready(page);
 const result=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE,slider=document.getElementById('buildingHeight');
  const set=n=>{slider.value=String(n);slider.dispatchEvent(new Event('input'));};set(5);
  const snapshots=[...u.bridgeRegistry].map(([id,r])=>({id,r,deck:r.deckY,arrays:r.group.children.map(m=>m.geometry.attributes.position.array.slice()),height:new T.Box3().setFromObject(r.group).max.y}));
  set(1);
  const rows=snapshots.map(({id,r,deck,arrays,height})=>{
   let xzError=0,finite=true,centreDeckError=Infinity;
   r.group.children.forEach((m,j)=>{const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){xzError=Math.max(xzError,Math.abs(p.getX(i)-arrays[j][3*i]),Math.abs(p.getZ(i)-arrays[j][3*i+2]));finite&&=Number.isFinite(p.getY(i));if(m===r.deckMesh&&Math.abs(p.getX(i)-r.deckSpan.centerX)<15)centreDeckError=Math.min(centreDeckError,Math.abs(p.getY(i)-r.deckY));}});
   return {id,deck:r.deckY,expected:r.waterSurfaceY+(deck-r.waterSurfaceY)/5,xzError,finite,height,smallHeight:new T.Box3().setFromObject(r.group).max.y,centreDeckError};
  });set(5);
  let restore=0;for(const s of snapshots)s.r.group.children.forEach((m,j)=>{const a=m.geometry.attributes.position.array;for(let i=0;i<a.length;i++)restore=Math.max(restore,Math.abs(a[i]-s.arrays[j][i]));});
  return {rows,restore};
 });
 expect(result.rows).toHaveLength(41);expect(result.restore).toBe(0);
 for(const r of result.rows){expect(r.finite,r.id).toBe(true);expect(r.xzError,r.id).toBe(0);expect(r.deck,r.id).toBeCloseTo(r.expected,4);expect(r.smallHeight,r.id).toBeLessThan(r.height);expect(r.centreDeckError,r.id).toBeLessThan(2);}
});

test('rail grades are bounded by their mapped class at both heights; tunnels keep their depth',async({page})=>{
 await ready(page);
 const result=await page.evaluate(()=>{
  const u=window.__ug,slider=document.getElementById('buildingHeight'),limits={surface:1,cutting:1,embankment:4,viaduct:9};
  const tunnels=u.overground.userData.paths.flat().filter(p=>p.cls==='tunnel'&&p.liftM<0).map(p=>({p,y:p.y}));
  const rows=[];
  for(const scale of [1,5]){slider.value=String(scale);slider.dispatchEvent(new Event('input'));let error=0,gap=0,count=0,approachError=0;
   for(const path of u.overground.userData.paths)for(let i=0;i<path.length;i++){const p=path[i];if(i)gap=Math.max(gap,Math.hypot(p.x-path[i-1].x,p.z-path[i-1].z));if(p.cls==='tunnel')continue;if(i&&path[i-1].cls!=='tunnel'){const prev=path[i-1];approachError=Math.max(approachError,Math.abs(p.liftM-prev.liftM)-.04*Math.hypot(p.x-prev.x,p.z-prev.z));}const h=p.y-u.getTerrainMeshSurfaceY(p);error=Math.max(error,scale-h,h-limits[p.cls]*scale);count++;}
   rows.push({scale,error,gap,count,approachError,tunnelError:Math.max(...tunnels.map(({p,y})=>Math.abs(p.y-y)))});
  }return rows;
 });
 for(const r of result){expect(r.error).toBeLessThan(.001);expect(r.approachError).toBeLessThan(.001);expect(r.gap).toBeLessThanOrEqual(12.001);expect(r.count).toBeGreaterThan(15000);expect(r.tunnelError).toBe(0);}
});

test('all six fleets have multi-car services, advance while distant, and respect pause',async({page})=>{
 await ready(page);
 const result=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE;
  return u.overground.userData.fleets.map(f=>{
   const trains=f.userData.trains,before=trains.map(t=>t.phase);f.userData.update(1,{position:new T.Vector3(1e7,1e7,1e7)},5);
   const moved=trains.every((t,i)=>t.phase!==before[i]),hidden=trains.every(t=>!t.visible),hold=trains.map(t=>t.phase);
   f.userData.update(0,u.camera,5);
   return {name:f.name,count:trains.length,moved,hidden,held:trains.every((t,i)=>t.phase===hold[i]),minCars:Math.min(...trains.map(t=>t.cars)),short:trains.some(t=>t.total<5000)};
  });
 });
 expect(result).toHaveLength(6);
 for(const r of result){expect(r.count,r.name).toBeGreaterThanOrEqual(2);expect(r.moved,r.name).toBe(true);expect(r.hidden,r.name).toBe(true);expect(r.held,r.name).toBe(true);expect(r.minCars,r.name).toBeGreaterThan(1);}
 expect(result.some(r=>r.short)).toBe(true);
 await page.evaluate(()=>document.getElementById('hudDetails').open=true);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const phases=()=>page.evaluate(()=>window.__ug.overground.userData.fleets.flatMap(f=>f.userData.trains.map(t=>t.phase)));
 const before=await phases();await page.waitForTimeout(400);expect(await phases()).toEqual(before);
 await page.getByRole('button',{name:'Resume',exact:true}).click();await expect.poll(phases).not.toEqual(before);
});

test('Overground track accepts real pointer hover with line and network labels',async({page})=>{
 await ready(page);
 const candidates=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE;
  u.controls.enabled=false;u.controls.enableDamping=false;
  const path=u.overground.userData.fleets.find(f=>f.name.includes('mildmay')).userData.trains.find(t=>t.total>5000).path;
  const point=path[Math.floor(path.length*.4)],target=new T.Vector3(point.x,point.y,point.z);
  u.camera.position.copy(target).add(new T.Vector3(0,400,10));u.controls.target.copy(target);u.camera.lookAt(target);u.camera.updateMatrixWorld(true);
  return path.map(p=>new T.Vector3(p.x,p.y+.8,p.z).project(u.camera)).filter(p=>Math.abs(p.x)<.8&&Math.abs(p.y)<.8).map(p=>({x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2}));
 });
 let found=false;for(const p of candidates){await page.mouse.move(p.x,p.y);const text=await page.locator('#hoverTip').innerText();if(/Mildmay line/i.test(text)&&/London Overground/i.test(text)){found=true;break;}}
 expect(found).toBe(true);
});


test('pitched train bodies keep roofs and windows attached in carriage coordinates',async({page})=>{
 await ready(page);
 const result=await page.evaluate(()=>{
  const u=window.__ug,T=window.__ugTHREE;let alignment=1,pitched=0,cars=0;
  for(const f of u.overground.userData.fleets){
   f.userData.update(0,null,5);const [body,roof,windows]=f.userData.meshes;
   for(let i=0;i<body.count;i++){
    const b=new T.Matrix4();body.getMatrixAt(i,b);const up=new T.Vector3().setFromMatrixColumn(b,1).normalize(),centre=new T.Vector3().setFromMatrixPosition(b);
    if(Math.abs(up.y)<.9999)pitched++;
    for(const part of [roof,windows]){const m=new T.Matrix4();part.getMatrixAt(i,m);const offset=new T.Vector3().setFromMatrixPosition(m).sub(centre).normalize();alignment=Math.min(alignment,offset.dot(up));}cars++;
   }
  }return {alignment,pitched,cars};
 });
 expect(result.cars).toBeGreaterThan(100);expect(result.pitched).toBeGreaterThan(10);expect(result.alignment).toBeGreaterThan(.9999);
});
