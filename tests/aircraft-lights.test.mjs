import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { aircraftLightLayout, aircraftPhase, flashLevel, createAircraftLightBatch } from '../src/aircraft-lights.js';
import { AIRCRAFT_TYPES, createFlights, createTrafficModel } from '../src/flights.js';
import { createHash } from 'node:crypto';
import { nightUniforms } from '../src/night.js';
const terrain = () => 100;

test('fittings follow all eight airframes: port red, starboard green, aft white and two window rows', () => {
  for (const type of Object.values(AIRCRAFT_TYPES)) {
    const lights = aircraftLightLayout(type.length, type), nav = lights.filter(l => l.kind === 'nav');
    assert.equal(nav.length, 3); assert.ok(nav[0].p[0] < 0 && nav[1].p[0] > 0);
    assert.deepEqual(nav.map(l => l.color), [[1,.012,.003],[.005,1,.08],[1,1,1]]);
    assert.ok(nav[2].p[2] > type.length * .49);
    assert.equal(lights.filter(l => l.kind === 'strobe').length, 2);
    const beacons = lights.filter(l => l.kind === 'beacon'); assert.ok(beacons[0].p[1] > beacons[1].p[1]);
    if (type.variant === 'turboprop') assert.ok(beacons[0].p[2] > 2 * type.length / 60, 'upper beacon clears the high wing');
    for (const side of [-1,1]) assert.ok(lights.filter(l => l.kind === 'window' && Math.sign(l.p[0]) === side).length >= 4);
  }
});
test('strobes are 72 flashes/min, beacons 54/min, fleet phases differ and do not depend on sim speed', () => {
  for (const [kind,want] of [['strobe',72],['beacon',54]]) {
    let before = 0, starts = 0;
    for (let i=0;i<60000;i++) { const v=flashLevel(kind,i/1000,.37); if(v&&!before)starts++;before=v; }
    assert.equal(starts,want);
  }
  assert.equal(new Set(Array.from({length:100},(_,i)=>aircraftPhase(`heathrow-arrivals-${i}`))).size,100);
  assert.notEqual(flashLevel('strobe',0,.01),flashLevel('strobe',0,.5));
});
test('24-hour flow and every flight pose equal production, including 23:00', () => {
  const a=createTrafficModel({getSurfaceY:terrain});
  // Captured from production 22ef6ef, synthetic terrain 100. No worktree dependency.
  const gold=['b904ae501096a96dd6e105dfdf34c38d318a75f1018447069546656288315e50','129b18a34a0df81720ba78ac19776610a73a13babbc7b262b102d668814347d0','348b6ed7612dba7bc3cdb2ac31dfad7b746b8bba5ace38799f42580b8283eaeb','03167365f7abb8d95964863250c46282844d5bc8d766a2872e569c87f77a4cfd','2abe1963d32bd22f3bf3147a743c1da9c158a5731199b5d52232b7ffe13739b2'];
  let i=0;
  for(const t of [0,3600,43200,82800,86399]) {
    const fields=['id','x','y','z','heading','bank','pitch','onGround','onFinal','model','livery'];
    const select=m=>m.flightsAt(t).map(f=>Object.fromEntries(fields.map(k=>[k,f[k]])));
    assert.equal(createHash('sha256').update(JSON.stringify(select(a))).digest('hex'),gold[i++]);
  }
});
test('landing lights cover the whole 18km final, landing roll, takeoff roll and climb below 3000m, off in cruise', () => {
  const m=createTrafficModel({getSurfaceY:terrain});const seen=new Set();
  for(let t=0;t<7200;t+=5) for(const f of m.flightsAt(t,{includeHidden:true})) {
    seen.add(f.phase);
    if(f.kind==='arrival') assert.equal(f.landingLights, f.onGround||f.onFinal);
    if(f.kind==='departure') assert.equal(f.landingLights, f.onGround||f.altM-f.elevationM<=3000);
    if(f.phase==='cruise'||f.phase==='circuit') assert.equal(f.landingLights,false);
    if(f.kind==='arrival'&&f.onFinal&&f.distanceToAimM>=5000)seen.add('5km');
  }
  for(const p of ['final','rollout','takeoff-roll','climb','cruise','circuit','5km'])assert.ok(seen.has(p),p);
});
test('night flight airframe bases stay true scale at every Master; daylight matrices restore exactly and lights draw zero', () => {
  const cam=new THREE.PerspectiveCamera(50,1.6,1,400000);cam.position.set(0,20000,30000);cam.lookAt(0,0,0);cam.updateMatrixWorld(true);
  for(const master of [1,1.1,4,10]) {
    const g=createFlights({getSurfaceY:terrain,getHeightScale:()=>1/master});const u=g.userData;
    nightUniforms.uNightAmt.value=0;u.setElapsed(1000);u.update(0,cam);
    const day=Object.values(u.meshes).map(m=>Array.from(m.instanceMatrix.array));
    assert.equal(u.lights.points.visible,false);assert.equal(u.stats.lightPoints,0);
    nightUniforms.uNightAmt.value=.5;u.update(0,cam);
    assert.equal(u.lights.points.material.uniforms.amount.value,.5);assert.ok(u.lights.count>100);
    assert.ok(u.flights.every(f=>f.displayScale===1));
    for(const mesh of Object.values(u.meshes))for(let i=0;i<mesh.count;i++){
      const e=new THREE.Matrix4();mesh.getMatrixAt(i,e);
      for(const j of [0,4,8])assert.ok(Math.abs(Math.hypot(e.elements[j],e.elements[j+1]*master/5,e.elements[j+2])-1)<1e-6);
    }
    nightUniforms.uNightAmt.value=0;u.update(0,cam);
    assert.deepEqual(Object.values(u.meshes).map(m=>Array.from(m.instanceMatrix.array)),day);
    assert.equal(u.lights.points.visible,false);u.dispose();
  }
});
test('point glow transforms only lamp centres; batching uses no instance colours and keeps depth occlusion', () => {
  const b=createAircraftLightBatch(2,'test'),l=aircraftLightLayout(60)[0];
  b.add(l,new THREE.Matrix4().makeTranslation(100,200,300),.3);b.finish(.4);
  assert.equal(b.count,1);assert.equal(b.points.geometry.drawRange.count,1);
  assert.equal(b.points.geometry.attributes.instanceColor,undefined);
  assert.ok(b.points.material.depthTest);assert.equal(b.points.material.depthWrite,false);
  assert.ok(Math.abs(b.points.geometry.attributes.position.getX(0)-(100+l.p[0]))<1e-4);
  b.setAmount(0);assert.equal(b.points.visible,false);b.dispose();
});
