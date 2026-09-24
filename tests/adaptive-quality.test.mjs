import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveQuality,QUALITY_LEVELS} from '../src/adaptive-quality.js';

// Sprint 24Sep26h (D-038, Lane R). The 11Sep26f tests drove the controller
// with constant frame times, i.e. a machine on which lowering resolution never
// helps. The new controller deliberately stops dropping in exactly that case
// (the CPU-bound street and river views of the 24Sep26h profile), so the
// overload cases now use a frame-time model that responds to resolution, and
// the constant-frame case is its own test ("CPU-bound ... is held").
const MSAA={4:1,2:.8,0:.62};
// frame cost = cpu + gpu at full quality scaled by pixels and edge samples (+ shadows)
const model=({cpu=6,gpu=30,shadowMs=2})=>q=>Math.max(cpu,gpu*q.scale*q.scale*MSAA[q.samples]+(q.shadows?shadowMs:0));
const vsync=(cost,hz=60)=>{const p=1000/hz;return Math.max(1,Math.ceil(cost/p-1e-9))*p;};

function harness(){
 let now=0;const changes=[];let current=QUALITY_LEVELS[0];
 const controller=createAdaptiveQuality({apply:q=>{current=q;changes.push({...q,at:now});}});
 controller.start(now);
 return{controller,changes,get now(){return now;},
  run(ms,duration){const end=now+duration;while(now<end){now+=ms;controller.update(ms,now)}},
  // cost(q, k) -> frame cost for the current quality; display paces it
  sim(cost,duration,{hz=0,jitter=0}={}){const end=now+duration;let k=0;const levels=[];while(now<end){k++;let c=cost(current,k);if(jitter)c*=1+jitter*Math.sin(k*1.7);const ms=hz?vsync(c,hz):c;now+=ms;controller.update(ms,now);levels.push([ms,controller.get().level]);}return levels;},
  pause(ms){now+=ms;controller.update(ms,now)}};
}
const pixels=q=>q.scale*q.scale;

test('sustained whole-city overload lowers quality, bounded at the floor',()=>{
 // GPU-bound: 200ms at full quality, only the 35% floor fits the budget.
 const h=harness();h.sim(model({cpu:6,gpu:200}),40000);
 assert.deepEqual(h.controller.get(),{level:QUALITY_LEVELS.length-1,...QUALITY_LEVELS.at(-1)});
 assert.ok(h.changes.length<=QUALITY_LEVELS.length+1,`changes ${h.changes.length}`);
});
test('a light view recovers quality after overload',()=>{
 const h=harness();h.sim(model({cpu:6,gpu:200}),40000);h.run(8.33,25000);assert.equal(h.controller.get().level,0);
});
test('normal 60Hz frames and a tab-resume gap do not reduce quality',()=>{
 const h=harness();h.run(16.67,8000);h.pause(5000);h.run(16.67,8000);assert.equal(h.changes.length,1);
});
test('consistently very slow hardware is not mistaken for isolated stalls',()=>{
 // Every frame is long (>80ms) and resolution does help: it must adapt down.
 const h=harness();h.sim(model({cpu:6,gpu:180}),60000);assert.ok(h.controller.get().level>=QUALITY_LEVELS.length-2,`level ${h.controller.get().level}`);
});
test('a failed upward probe restores the sustainable level and backs off',()=>{
 // Budget fits at 85%/2x (level 4) but not at 85%/4x (level 3).
 const h=harness();const cost=model({cpu:6,gpu:27});
 h.sim(cost,20000);const low=h.controller.get().level;assert.equal(low,4);
 const probes=h.controller.state().history.filter(e=>e.why==='probe').length;
 assert.ok(probes>=1,'it probed');
 assert.ok(h.controller.state().history.some(e=>e.why==='probe failed'),'the probe failed and was undone');
 // Backoff: over the next 60s it retries rarely, never oscillating every few seconds.
 const before=h.changes.length;h.sim(cost,60000);
 assert.equal(h.controller.get().level,low);
 assert.ok(h.changes.length-before<=6,`changes in 60s: ${h.changes.length-before}`);
});

test('shadows are the first thing to go, and no lower rung brings them back',()=>{
 const h=harness();h.sim(model({cpu:6,gpu:30}),6000);
 assert.deepEqual({scale:h.changes[1].scale,samples:h.changes[1].samples,shadows:h.changes[1].shadows},{scale:1,samples:4,shadows:false});
 assert.equal(QUALITY_LEVELS[0].shadows,true);
 for(const q of QUALITY_LEVELS.slice(1))assert.equal(q.shadows,false);
});
test('rungs are fine: no step removes more than a quarter of the pixels',()=>{
 for(let i=1;i<QUALITY_LEVELS.length;i++){
  const a=QUALITY_LEVELS[i-1],b=QUALITY_LEVELS[i];
  assert.ok(pixels(b)>=pixels(a)*0.72,`rung ${i}: ${pixels(a)} -> ${pixels(b)}`);
  assert.ok(b.scale<=a.scale&&b.samples<=a.samples,'monotone');
 }
 assert.ok(QUALITY_LEVELS.length>=12);
});
test('CPU-bound: a drop that does not help is reverted and held, not followed to the floor',()=>{
 // Constant 25ms whatever the resolution (the street/river case in the profile).
 const h=harness();const levels=h.sim(()=>25,60000);
 assert.equal(h.controller.get().level,1,'shadows off, full resolution');
 assert.ok(h.controller.state().history.some(e=>e.why==='revert: drop did not help'));
 const lowTime=levels.filter(([,l])=>l>1).reduce((s,[ms])=>s+ms,0);
 assert.ok(lowTime<0.12*60000,`time below level 1: ${lowTime}ms`);
 assert.ok(Math.max(...levels.map(([,l])=>l))<=2,'never falls more than one rung below');
});
test('60Hz display, heavy street-like view: settles at 85% or 75%, not 50%',()=>{
 // 45 fps at full quality, frames paced by a 60Hz display with a little jitter.
 const h=harness();h.sim(model({cpu:9,gpu:22,shadowMs:2}),45000,{hz:60,jitter:.06});
 const q=h.controller.get();
 assert.ok(q.scale>=0.75,`settled at ${JSON.stringify(q)}`);
 // Settled: at most one change in the last 20s.
 const late=h.changes.filter(c=>c.at>h.now-20000).length;
 assert.ok(late<=1,`late changes ${late}`);
});
test('60Hz display: a partly CPU-bound view stops where resolution stops helping',()=>{
 // CPU 15ms floor; GPU 30ms at full. Below ~70% the frame no longer gets faster.
 const h=harness();h.sim(model({cpu:15.5,gpu:30}),60000,{hz:60,jitter:.05});
 assert.ok(h.controller.get().scale>=0.6,`settled at ${JSON.stringify(h.controller.get())}`);
});
test('hysteresis: a view inside the band never changes quality',()=>{
 const h=harness();h.run(17.8,60000);assert.equal(h.changes.length,1);
});
test('uncapped fast display with ample headroom does not bounce between rungs',()=>{
 // Fits comfortably at level 2 (about 12ms), fails at level 1 (about 19ms).
 const h=harness();const cost=q=>q.scale>=1?(q.shadows?21:19):12;
 h.sim(cost,20000);const settle=h.changes.length;h.sim(cost,60000);
 assert.ok(h.changes.length-settle<=6,`changes in 60s: ${h.changes.length-settle}`);
});
