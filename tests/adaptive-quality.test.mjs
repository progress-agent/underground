import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveQuality,QUALITY_LEVELS,FIRST_UNSHADOWED} from '../src/adaptive-quality.js';

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
const levelOf=(scale,samples)=>QUALITY_LEVELS.findIndex(q=>q.scale===scale&&q.samples===samples&&!q.shadows);
// D-040: thinned clouds save a little frame time in these models too.
const CLOUDS_THIN_SAVES=0.8;

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
 // Budget fits at 85%/2x but not at 85%/4x.
 const h=harness();const cost=model({cpu:6,gpu:27});
 h.sim(cost,20000);const low=h.controller.get().level;assert.equal(low,levelOf(0.85,2));
 const probes=h.controller.state().history.filter(e=>e.why==='probe').length;
 assert.ok(probes>=1,'it probed');
 assert.ok(h.controller.state().history.some(e=>e.why==='probe failed'),'the probe failed and was undone');
 // Backoff: over the next 60s it retries rarely, never oscillating every few seconds.
 const before=h.changes.length;h.sim(cost,60000);
 assert.equal(h.controller.get().level,low);
 assert.ok(h.changes.length-before<=6,`changes in 60s: ${h.changes.length-before}`);
});

test('clouds thin first, then shadows go, and no lower rung brings either back',()=>{
 const h=harness();h.sim(model({cpu:6,gpu:30}),6000);
 const pick=c=>({scale:c.scale,samples:c.samples,shadows:c.shadows,clouds:c.clouds});
 assert.deepEqual(pick(h.changes[1]),{scale:1,samples:4,shadows:true,clouds:'thin'});
 assert.deepEqual(pick(h.changes[2]),{scale:1,samples:4,shadows:false,clouds:'thin'});
 assert.deepEqual(QUALITY_LEVELS[0],{scale:1,samples:4,shadows:true,clouds:'full'});
 assert.equal(FIRST_UNSHADOWED,2);
 for(const q of QUALITY_LEVELS.slice(1))assert.equal(q.clouds,'thin');
 for(const q of QUALITY_LEVELS.slice(FIRST_UNSHADOWED))assert.equal(q.shadows,false);
});
test('a view that fits with thin clouds keeps its shadows, and does not bounce',()=>{
 // Full clouds push the frame to 19.7ms (past the 19ms shadow line); thinned
 // clouds bring it to 18.2ms, inside it. Shadows stay; the clouds stay thin.
 const h=harness();const cost=(q,k)=>17+(q.clouds==='full'?1.5:0)+(q.shadows?1.2:0)+0.2*Math.sin(k*0.05);
 h.sim(cost,20000);assert.deepEqual(h.controller.get(),{level:1,...QUALITY_LEVELS[1]});
 const settle=h.changes.length;h.sim(cost,90000);
 assert.equal(h.controller.get().level,1);
 assert.ok(h.changes.length-settle<=6,`changes in 90s: ${h.changes.length-settle}`);
});
test('full clouds come back once the view is light again',()=>{
 const h=harness();h.sim((q,k)=>17+(q.clouds==='full'?1.5:0)+(q.shadows?1.2:0)+0.2*Math.sin(k*0.05),20000);
 assert.equal(h.controller.get().level,1);
 h.sim((q,k)=>13+(q.clouds==='full'?1.5:0)+(q.shadows?1.2:0)+0.2*Math.sin(k*0.05),30000);
 assert.equal(h.controller.get().level,0);
});
test('rungs are fine: no step removes more than a quarter of the pixels',()=>{
 for(let i=1;i<QUALITY_LEVELS.length;i++){
  const a=QUALITY_LEVELS[i-1],b=QUALITY_LEVELS[i];
  assert.ok(pixels(b)>=pixels(a)*0.72,`rung ${i}: ${pixels(a)} -> ${pixels(b)}`);
  assert.ok(b.scale<=a.scale&&b.samples<=a.samples,'monotone');
 }
 assert.ok(QUALITY_LEVELS.length>=12);
});
test('CPU-bound: dropping that does not help is undone and held, not followed to the floor',()=>{
 // Constant 25ms whatever the resolution (the street/river case in the profile).
 const h=harness();const levels=h.sim(()=>25,120000);
 assert.equal(h.controller.get().level,FIRST_UNSHADOWED,'shadows off, full resolution');
 assert.ok(h.controller.state().history.some(e=>e.why==='revert: dropping did not help'));
 const lowTime=levels.filter(([,l])=>l>FIRST_UNSHADOWED).reduce((s,[ms])=>s+ms,0);
 assert.ok(lowTime<0.2*120000,`time below the no-shadow rung: ${lowTime}ms`);
 const deepest=Math.max(...levels.map(([,l])=>l));
 assert.ok(deepest<=FIRST_UNSHADOWED+4&&QUALITY_LEVELS[deepest].scale>=0.8,`never deeper than a trial descent: ${deepest}`);
});
test('noisy GPU-bound view: fine rungs that each help only a little still descend to the budget',()=>{
 // Each fine rung helps less than frame noise, but together they do help.
 const h=harness();h.sim(model({cpu:8,gpu:28,shadowMs:1}),60000,{jitter:.08});
 const q=h.controller.get();
 assert.ok(q.scale<1&&q.scale>=0.6,`settled at ${JSON.stringify(q)}`);
});
test('60Hz display, heavy street-like view: settles at 85% or 75%, not 50%',()=>{
 // 45 fps at full quality, frames paced by a 60Hz display with a little jitter.
 const h=harness();const levels=h.sim(model({cpu:9,gpu:22,shadowMs:2}),45000,{hz:60,jitter:.06});
 const q=h.controller.get();
 assert.ok(q.scale>=0.75,`settled at ${JSON.stringify(q)}`);
 // Settled: in the last 20s at most one upward probe (and its return), and
 // at least 90% of the time at the settled level.
 const probes=h.controller.state().history.filter(e=>e.why==='probe'&&e.at>h.now-20000).length;
 assert.ok(probes<=1,`late probes ${probes}`);
 let t=0,at=0;for(let i=levels.length-1;i>=0&&t<20000;i--){t+=levels[i][0];if(levels[i][1]===q.level)at+=levels[i][0];}
 assert.ok(at/t>=0.9,`time at settled level ${(at/t).toFixed(2)}`);
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
// Integration fix, 24Sep26h (verifier FAIL): river at Greenwich runs at about
// 17.7 to 18ms with shadows on the M5, and its window means wander above the
// 1.10 band (18.3ms). The e367efd controller (p75 over 19ms) kept shadows
// there in every run; the shadows rung must be at least as tolerant.
// Clouds were not in the view these tests model; the thin rung saves nothing here.
const riverLike=(base)=>(q,k)=>(q.shadows?base:base-1.5)+0.7*Math.sin(k*0.02);
test('a ~56 fps view with shadows (river at Greenwich) keeps them',()=>{
 for(const base of [17.7,17.9,18.1]){
  const h=harness();h.sim(riverLike(base),60000);
  assert.equal(h.controller.get().level,0,`base ${base}: ${JSON.stringify(h.controller.state().history)}`);
  assert.equal(h.changes.length,1,`base ${base}: no changes`);
 }
});
test('a probe back up to shadows at ~56 fps holds',()=>{
 // Pushed off shadows by a heavy moment, then back at the river view.
 const h=harness();h.sim(()=>24,6000);assert.ok(h.controller.get().level>=FIRST_UNSHADOWED);
 h.sim(riverLike(17.9),90000);
 assert.equal(h.controller.get().shadows,true,JSON.stringify(h.controller.state().history.slice(-6)));
});
test('shadows go straight after the clouds once a view is clearly below ~52 fps',()=>{
 const h=harness();h.sim((q,k)=>(q.shadows?20.5:17)+0.3*Math.sin(k*0.02),10000);
 assert.equal(h.changes[1].clouds,'thin');assert.equal(h.changes[2].shadows,false);
 assert.equal(h.controller.get().level,FIRST_UNSHADOWED);
});
test('arriving at a ~56 fps view without shadows probes back up to them',()=>{
 // River without shadows runs at about 17.1 to 17.3ms: above the 1.03 probe
 // line (17.17ms), below the old controller's 17.5ms. Shadows cost ~0.8ms more.
 for(const base of [17.1,17.3]){
  // A heavy moment with shadows on (21ms) pushes it off shadows and no further.
  const h=harness();h.sim(q=>q.shadows?21:base,6000);assert.equal(h.controller.get().level,FIRST_UNSHADOWED);
  h.sim((q,k)=>(q.shadows?base+0.8:base)+(q.clouds==='full'?CLOUDS_THIN_SAVES:0)+0.1*Math.sin(k*0.02),40000);
  assert.equal(h.controller.get().shadows,true,`base ${base}: ${JSON.stringify(h.controller.state().history.slice(-4))}`);
 }
});
test('a view that cannot afford shadows does not flicker them at the looser probe line',()=>{
 // Without shadows 17.4ms (inside the probe line), shadows push it to 19.6ms.
 const h=harness();const cost=(q,k)=>(q.shadows?19.6:17.4)+0.1*Math.sin(k*0.02);
 h.sim(cost,20000);const settle=h.changes.length;h.sim(cost,90000);
 assert.equal(h.controller.get().level,FIRST_UNSHADOWED);
 assert.ok(h.changes.length-settle<=6,`changes in 90s: ${h.changes.length-settle}`);
});
// Step 0 of sprint 25Sep26f (verifier gap, 24Sep26h): the looser probe line
// applied only from level 1. A camera that arrives at a CPU-bound ~56 fps view
// several rungs down (a GPU-heavy street moment, then the river at Greenwich)
// sat inside the band at 92% or 85% resolution without shadows for good, since
// its noisy 17.1 to 17.9ms windows rarely cleared the 1.03 line four in a row.
test('arriving several rungs down at a CPU-bound ~56 fps view climbs all the way back to shadows',()=>{
 for(const base of [17.1,17.4,17.7]){
  // GPU-heavy moment: resolution helps, so it descends past the no-shadow rung.
  const h=harness();h.sim(model({cpu:6,gpu:24,shadowMs:2}),8000);
  const arrived=h.controller.get().level;assert.ok(arrived>FIRST_UNSHADOWED,`base ${base}: arrived at ${arrived}`);
  // River: CPU-bound (resolution does nothing), shadows cost ~0.8ms, noisy windows.
  h.sim((q,k)=>(q.shadows?base+0.8:base)+0.4*Math.sin(k*0.05),60000);
  assert.equal(h.controller.get().shadows,true,`base ${base}: ${JSON.stringify(h.controller.state().history.slice(-6))}`);
 }
});
// Step 0 measurement, 25Sep26f (M5 as lived): with the looser line, river
// bounced 2<->3 every ~3.5s. The probe passed its first window on noise, then
// drifted over budget two windows later; that drop escaped the probe backoff.
test('a probe that passes its first window but drifts over soon after still backs off',()=>{
 // 92% averages ~18.5ms, 85% ~17.6ms; noise lets 92% pass one window.
 const h=harness();const cost=(q,k)=>(q.scale>=0.92?18.5:17.6)+0.9*Math.sin(k*0.09);
 h.sim(q=>q.scale>=0.85?25*q.scale:10,6000);
 h.sim(cost,20000);const settle=h.changes.length;h.sim(cost,90000);
 assert.ok(h.changes.length-settle<=8,`changes in 90s: ${h.changes.length-settle} ${JSON.stringify(h.controller.state().history.slice(-8).map(e=>[Math.round(e.at),e.from,e.to,e.why]))}`);
});
