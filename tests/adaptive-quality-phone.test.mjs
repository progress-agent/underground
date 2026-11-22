import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createAdaptiveQuality} from '../src/adaptive-quality.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/aq-phone-intervals.json',import.meta.url)));
function replay(frames,tuning,duration=30000){const c=createAdaptiveQuality({apply(){},tuning});c.start(0);let now=0,i=0;while(now<duration){const ms=frames[i++%frames.length];now+=ms;c.update(ms,now);}return c;}
test('phone p95 steps down within 10s despite an in-budget mean, desktop does not',()=>{
 const frames=fixture.cases.intoTown,mean=frames.reduce((a,b)=>a+b)/frames.length;
 assert.ok(mean<1000/30*1.14);
 const phone=replay(frames,fixture.tuning),desktop=replay(frames,{targetMs:1000/30});
 const drops=phone.state().history.filter(e=>e.why.startsWith('drop'));
 assert.ok(drops.length>0);assert.ok(drops[0].at<10000);
 assert.equal(desktop.state().history.length,0);
 assert.ok(phone.state().history.filter(e=>e.why.startsWith('revert')).length<=1, 'did-it-help holds prevent repeated descents');
});
test('phone steady out-of-town p95 stays below trigger with no step down',()=>{
 const c=replay(fixture.cases.outOfTown,fixture.tuning);
 assert.equal(c.get().level,0);assert.equal(c.state().history.length,0);
});
test('slow-frame pressure is judged for benefit and backs off on a CPU-bound distribution',()=>{
 const c=replay(fixture.cases.intoTown,fixture.tuning,120000);
 assert.ok(c.state().history.some(e=>e.why.startsWith('revert')));
 assert.ok(c.get().scale>=.85);
});

test('recorded forced-load phone intervals cannot trigger a multi-rung futile rebound',()=>{
 const recorded=JSON.parse(readFileSync(new URL('./fixtures/aq-phone-recorded-intervals.json',import.meta.url)));
 for(const [name,frames] of Object.entries(recorded.cases)){
  const c=createAdaptiveQuality({apply(){},tuning:fixture.tuning});c.start(0);let now=0;
  for(const ms of frames){now+=ms;c.update(ms,now);}
  const reverts=c.state().history.filter(h=>h.why.startsWith('revert'));
  if(name==='in1500Night')assert.ok(reverts.length>0,name+' must exercise the benefit check');
  assert.ok(reverts.every(h=>h.from-h.to<=1),name+' must judge a phone rung before a deeper descent');
 }
});
