import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)); // repo root, whatever the launch directory
let server, api;
test.beforeAll(async()=>{server=await createServer({root:ROOT,server:{middlewareMode:true,hmr:{port:24831}},appType:'custom'});api=await server.ssrLoadModule('/src/airports.js');});
test.afterAll(async()=>{await server?.close();});
test('nine airports retain mapped source layouts and four current Heathrow terminal groups',()=>{
 expect(api.AIRPORT_DATA.airports.map(a=>a.id)).toEqual(['heathrow','london-city','biggin-hill','northolt','elstree','denham','stapleford','kenley','damyns-hall']);
 const h=api.AIRPORT_DATA.airports[0];expect(h.runways).toHaveLength(2);for(const name of ['Terminal 2A','Terminal 3','Terminal 4','Heathrow Terminal 5'])expect(h.buildings.some(b=>b.name===name)).toBeTruthy();expect(h.buildings.some(b=>b.name==='Terminal 1')).toBeFalsy();
 for(const s of api.AIRPORT_DATA.airports){expect(s.runways.length).toBeGreaterThan(0);expect(s.buildings.length).toBeGreaterThan(0);for(const b of s.buildings)expect(b.osm).toMatch(/^(node|way|relation)\//);}
});
test('airport geometry is finite, batched and carries stationary stand and queue aircraft',()=>{
 const g=api.createAirports({getSurfaceY:({x,z})=>x*.001+z*.0001});expect(g.userData.stats.drawCalls).toBeLessThan(100);expect(g.userData.stats.queued).toBe(3);
 for(const s of g.children)expect(s.userData.aircraft.length).toBeGreaterThan(0);
 g.traverse(m=>{if(m.isMesh){expect(m.instanceColor).toBeUndefined();expect([...m.geometry.attributes.position.array].every(Number.isFinite)).toBeTruthy();expect([...m.geometry.attributes.normal.array].every(Number.isFinite)).toBeTruthy();}});
 const h=g.children[0];for(const a of h.userData.aircraft.filter(a=>a.state==='queued')){expect(a.source).toMatch(/^way\//);for(const r of h.userData.runways){const p=r.points[0],q=r.points.at(-1),d=Math.abs((q[0]-p[0])*(a.z-p[1])-(q[1]-p[1])*(a.x-p[0]))/Math.hypot(q[0]-p[0],q[1]-p[1]);expect(d).toBeGreaterThan(r.width/2+a.length/2);}}
 expect(g.userData.update).toBeUndefined();g.userData.dispose();
});
test('structure scaling pivots at terrain; surfaces stay fixed; refresh preserves aircraft ground offset',()=>{
 let rise=0;const g=api.createAirports({getSurfaceY:()=>50+rise});const mesh=g.children[0].children.find(m=>m.userData.part==='architecture'),ground=g.children[0].children.find(m=>m.userData.part==='surface');const initial=new Float32Array(mesh.geometry.attributes.position.array),groundInitial=new Float32Array(ground.geometry.attributes.position.array);
 g.userData.setHeightScale(.2);g.userData.setHeightScale(1);expect(mesh.geometry.attributes.position.array).toEqual(initial);expect(ground.geometry.attributes.position.array).toEqual(groundInitial);
 rise=25;g.userData.refreshTerrain();let maxError=0;for(let i=0;i<initial.length;i+=3)maxError=Math.max(maxError,Math.abs(mesh.geometry.attributes.position.array[i+1]-initial[i+1]-25));expect(maxError).toBeLessThan(.001);expect(ground.geometry.attributes.position.array[1]-groundInitial[1]).toBeCloseTo(25,3);g.userData.dispose();
});
test('suppression is bounded by replaced footprints and hover facts belong to exact features',()=>{
 const h=api.AIRPORT_DATA.airports[0],tower=h.buildings.find(b=>b.kind==='tower');expect(api.isAirportBuilding({x:tower.points[0][0],z:tower.points[0][1]})).toBeTruthy();expect(api.isAirportBuilding({x:0,z:0})).toBeFalsy();expect(api.isAirportBuilding({x:h.runways[0].points[0][0],z:h.runways[0].points[0][1]})).toBeFalsy();
 const g=api.createAirports({getSurfaceY:()=>0});const mesh=g.children[0].children.find(m=>m.userData.features?.some(f=>f.heightM===87));const f=mesh.userData.features.find(f=>f.heightM===87);expect(api.getAirportHoverInfo(mesh,f.start/3)).toMatchObject({name:'Control Tower',heightM:87});const terminal=g.children[0].children.find(m=>m.userData.features?.some(f=>f.name==='Terminal 3'));const tf=terminal.userData.features.find(f=>f.name==='Terminal 3');expect(api.getAirportHoverInfo(terminal,tf.start/3).heightM).toBeUndefined();g.userData.dispose();
});
test('missing or invalid terrain fails before airport suppression is activated by caller',()=>{expect(()=>api.createAirports({getSurfaceY:()=>null})).toThrow('No airport terrain');});


test('Stapleford retains grass beyond its published600m hard insert and renders both surfaces',()=>{
 const site=api.AIRPORT_DATA.airports.find(a=>a.id==='stapleford'),r=site.runways.find(r=>r.osm==='way/4279102');
 expect(r.surface).toBe('grass');expect(r.width).toBe(46);expect(r.pavedInserts).toHaveLength(1);
 const insert=r.pavedInserts[0];expect(insert.width).toBe(18);expect(insert.length).toBe(600);
 const length=p=>p.slice(1).reduce((n,b,i)=>n+Math.hypot(b[0]-p[i][0],b[1]-p[i][1]),0);
 expect(length(insert.points)).toBeCloseTo(600,1);expect(length(r.points)-length(insert.points)).toBeGreaterThan(450);
 expect(insert.points[0]).toEqual(r.points.reduce((a,b)=>a[1]<b[1]?a:b));
 const g=api.createAirports({getSurfaceY:()=>0}),group=g.children.find(g=>g.name==='airport-stapleford');
 const a=r.points.at(-2),b=r.points.at(-1),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
 // The southern grass continuation must not acquire paved runway geometry.
 const contains=(m,x,z)=>{const p=m.geometry.attributes.position;for(let i=0;i<p.count;i+=3){const cross=(j,k)=>(p.getX(i+j)-x)*(p.getZ(i+k)-z)-(p.getZ(i+j)-z)*(p.getX(i+k)-x),v=[cross(0,1),cross(1,2),cross(2,0)];if(v.every(v=>v>=-1e-6)||v.every(v=>v<=1e-6))return true;}return false;};
 expect(contains(group.children.find(m=>m.name==='airport-surface-stapleford-grass'),x,z)).toBe(true);
 expect(contains(group.children.find(m=>m.name==='airport-surface-stapleford-pavement'),x,z)).toBe(false);
 g.userData.dispose();
});

test('Kenley uses static engineless gliders and Damyns retains three sourced grass runways',()=>{
 const kenley=api.AIRPORT_DATA.airports.find(a=>a.id==='kenley'),damyns=api.AIRPORT_DATA.airports.find(a=>a.id==='damyns-hall');
 expect(kenley.taxiways).toHaveLength(5);expect(kenley.buildings.map(b=>b.osm)).toEqual(['way/946841283','way/946841284','way/1297142054']);expect(kenley.buildings.every(b=>b.kind==='support')).toBe(true);
 expect(damyns.runways).toHaveLength(3);expect(damyns.runways.every(r=>r.surface==='grass')).toBe(true);expect(damyns.runways.find(r=>r.name==='07/25')).toMatchObject({length:480,sourceUrl:'https://www.damynshall.co.uk/flying_in'});expect(damyns.runways.some(r=>r.osm==='way/207445303')).toBe(false);
 const root=api.createAirports({getSurfaceY:()=>100}),group=root.children.find(g=>g.userData.airport==='kenley');expect(group.userData.aircraft.length).toBeGreaterThan(0);for(const a of group.userData.aircraft){expect(a.model).toBe('glider');expect(a.engines).toBe(0);expect(a.width/a.length).toBeGreaterThan(2);expect(a.state).toBe('parked');}
 root.userData.dispose();
});
