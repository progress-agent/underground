import {test,expect} from '@playwright/test';
import {Matrix4,PerspectiveCamera,Vector3} from 'three';
import proj4 from 'proj4';
import {createSchematicMapping,schematicViewCone,schematicEdgePath,miniMapPoseKey} from '../src/mini-map.js';
import data from '../src/mini-map-data.json' with {type:'json'};

proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const origin=proj4('EPSG:4326','EPSG:27700',[-.1278,51.5074]);
const projectStation=(lat,lon)=>{const p=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return {x:p[0]-origin[0],z:origin[1]-p[1]};};
const mapping=createSchematicMapping({projectStation});
const anchors=[['Westminster / Thames',51.5007,-.1246],['Canary Wharf river bend',51.5048,-.0195],['Stratford',51.5418,-.00346],['Heathrow',51.4712,-.4523],['Network west edge',51.55,-.6],['Open space between stations',51.488,-.07]];

test('diagram retains all eleven Tube lines, DLR and genuine branch topology',()=>{
  expect(data.lines.map(l=>l.id).sort()).toEqual(['bakerloo','central','circle','district','dlr','hammersmith-city','jubilee','metropolitan','northern','piccadilly','victoria','waterloo-city']);
  expect(data.lines.find(l=>l.id==='waterloo-city').edges).toEqual([['Bank','Waterloo']]);
  for(const line of data.lines) for(const [a,b]of line.edges) {
    expect(mapping.nodes.has(a)).toBe(true);expect(mapping.nodes.has(b)).toBe(true);
  }
  for(const name of ['Amersham','Chesham','Watford','Uxbridge','Epping','Hainault','Heathrow Airport Terminal 5','Woolwich Arsenal','Battersea Power Station']) expect(mapping.nodes.has(name),name).toBe(true);
  expect(data.provenance.snapshot).toBe('2026-02-04T18:00:00.000Z');
});

test('all diagram segments are octilinear and station markers use the geographic transform',()=>{
  for(const node of data.nodes) {
    const p=projectStation(node.lat,node.lon),mapped=mapping.map(p.x,p.z),drawn=mapping.nodes.get(node.id);
    expect(mapped.x).toBeCloseTo(drawn.x,10);expect(mapped.y).toBeCloseTo(drawn.y,10);
  }
  for(const line of data.lines) for(const [a,b]of line.edges) {
    const points=schematicEdgePath(mapping.nodes.get(a),mapping.nodes.get(b)).split(' ').map(p=>p.slice(1).split(',').map(Number));
    for(let i=1;i<points.length;i++) {
      const dx=Math.abs(points[i][0]-points[i-1][0]),dy=Math.abs(points[i][1]-points[i-1][1]);
      expect(Math.min(dx,dy,Math.abs(dx-dy))).toBeLessThan(.021);
    }
  }
});

test('continuous transform has positive orientation throughout London and network exterior',()=>{
  // Independent finite-difference Jacobian, rather than trusting its diagnostic.
  let minDet=Infinity,maxStep=0;
  for(let lat=51.25;lat<=51.9;lat+=.008) for(let lon=-.9;lon<=.55;lon+=.012) {
    const p=projectStation(lat,lon),a=mapping.map(p.x,p.z),b=mapping.map(p.x+.5,p.z),c=mapping.map(p.x,p.z+.5);
    const determinant=((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))/.25;
    minDet=Math.min(minDet,determinant);maxStep=Math.max(maxStep,Math.hypot(b.x-a.x,b.y-a.y));
    expect(determinant,`${lat},${lon}`).toBeGreaterThan(0);
  }
  expect(maxStep).toBeLessThan(.1);
  expect(minDet).toBeGreaterThan(1e-7);
});

test('river, airport and off-network motion never snaps and outside coverage is explicit',()=>{
  for(const [name,lat,lon] of anchors) {
    const p=projectStation(lat,lon);
    let previous=mapping.map(p.x-200,p.z);
    for(let offset=-199;offset<=200;offset++) {
      const current=mapping.map(p.x+offset,p.z);
      expect(Math.hypot(current.x-previous.x,current.y-previous.y),name).toBeLessThan(.1);
      previous=current;
    }
  }
  const outside=projectStation(51.1,1.2);
  expect(mapping.map(outside.x,outside.z).outside).toBe(true);
  for(const value of [1e6,1e12,-1e12]) {
    const result=mapping.map(value,value);
    expect(Number.isFinite(result.x)&&Number.isFinite(result.y)).toBe(true);
    expect(result.outside).toBe(true);
  }
});

test('cone headings follow local schematic directions at multiple anchors and cardinal bearings',()=>{
  const camera=new PerspectiveCamera(55,16/9,.1,100000);
  for(const [,lat,lon] of anchors) for(const [dx,dz]of [[0,-1],[1,0],[0,1],[-1,0]]) {
    const p=projectStation(lat,lon);camera.position.set(p.x,100,p.z);
    camera.lookAt(p.x+dx*100,100,p.z+dz*100);camera.updateMatrixWorld(true);
    const cone=schematicViewCone(camera,mapping);
    const a=mapping.map(p.x,p.z),b=mapping.map(p.x+dx*.1,p.z+dz*.1);
    const expected=new Vector3(b.x-a.x,b.y-a.y,0).normalize();
    const actual=new Vector3(...cone[8],0).normalize();
    expect(actual.dot(expected)).toBeGreaterThan(.999999);
  }
});

test('actual lens, viewport and pitch alter the cone without a vertical-view instability',()=>{
  const camera=new PerspectiveCamera(55,16/9,.1,100000);
  camera.position.set(0,100,0);camera.lookAt(0,100,-100);camera.updateMatrixWorld(true);
  const width=()=> {const c=schematicViewCone(camera,mapping);return Math.hypot(c[0][0]-c[16][0],c[0][1]-c[16][1]);};
  camera.setFocalLength(20);const wide=width();camera.setFocalLength(85);expect(width()).toBeLessThan(wide*.5);
  camera.aspect=.6;camera.updateProjectionMatrix();const narrow=width();camera.aspect=2;camera.updateProjectionMatrix();expect(width()).toBeGreaterThan(narrow);
  camera.lookAt(0,100-Math.sqrt(3)*100,-100);camera.updateMatrixWorld(true);expect(schematicViewCone(camera,mapping)).not.toBeNull();
  camera.lookAt(0,-100,0);camera.updateMatrixWorld(true);expect(schematicViewCone(camera,mapping)).toBeNull();
});

test('cone matches independently unprojected screen rays through a non-rigid master view',()=>{
  const camera=new PerspectiveCamera(63,1.7,.1,100000);
  camera.position.set(1400,600,700);camera.lookAt(1900,-500,-600);
  camera.setViewOffset(1600,1000,40,15,1440,900);camera.updateMatrixWorld(true);
  camera.matrixWorld.premultiply(new Matrix4().makeScale(1,.2,1));
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const cone=schematicViewCone(camera,mapping);
  const origin=new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const start=mapping.map(origin.x,origin.z);
  for(const i of [0,8,16]) {
    const ray=new Vector3(-1+2*i/16,0,.5).unproject(camera).sub(origin).normalize();
    const end=mapping.map(origin.x+ray.x*.1,origin.z+ray.z*.1);
    const expected=new Vector3(end.x-start.x,end.y-start.y,0).normalize();
    expect(new Vector3(...cone[i],0).normalize().dot(expected)).toBeGreaterThan(.999999);
  }
});

test('integrated mini-map is compact, tracks the lens and isolates keyboard focus',async({page})=>{
  await page.goto('/?skip=1');
  await page.waitForFunction(()=>window.__ug?.miniMap?.root);
  await page.evaluate(()=>window.__ug.miniMap.setCollapsed(false));
  const map=page.locator('#ug-mini-map');await expect(map).toBeVisible();
  const rect=await map.boundingBox();expect(rect.width).toBeGreaterThanOrEqual(240);expect(rect.width).toBeLessThanOrEqual(320);
  const before=await page.evaluate(()=>window.__ug.camera.position.toArray());
  await map.locator('button').focus();await page.keyboard.down('w');await page.waitForTimeout(250);await page.keyboard.up('w');
  const after=await page.evaluate(()=>window.__ug.camera.position.toArray());expect(after).toEqual(before);
  const path=await page.locator('[data-mini-cone]').getAttribute('d');
  await page.evaluate(()=>{window.__ug.camera.setFocalLength(85);});await page.waitForTimeout(100);
  expect(await page.locator('[data-mini-cone]').getAttribute('d')).not.toBe(path);
  await page.setViewportSize({width:700,height:390});await expect(map).toHaveAttribute('data-collapsed','true');
  await map.locator('button').click();await expect(map).toHaveAttribute('data-collapsed','false');
  const small=await map.boundingBox();expect(small.x).toBeGreaterThanOrEqual(0);expect(small.x+small.width).toBeLessThanOrEqual(700);
  await page.evaluate(()=>{document.getElementById('hudDetails').open=true;});await expect(map).toBeHidden();
});


test('vertical lens shift invalidates the cone cache at a pitched camera',()=>{
  const camera=new PerspectiveCamera(60,1.6,.1,10000);
  camera.position.set(0,100,0);camera.lookAt(0,0,-100);camera.updateMatrixWorld(true);
  camera.setViewOffset(1600,1000,0,0,1600,1000);
  const key=miniMapPoseKey(camera),cone=schematicViewCone(camera,mapping);
  camera.setViewOffset(1600,1000,0,150,1600,1000);
  expect(miniMapPoseKey(camera)).not.toBe(key);
  expect(schematicViewCone(camera,mapping)).not.toEqual(cone);
});
