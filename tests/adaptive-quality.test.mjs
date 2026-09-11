import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveQuality,QUALITY_LEVELS} from '../src/adaptive-quality.js';
function harness(){let now=0;const changes=[];const controller=createAdaptiveQuality({apply:q=>changes.push({...q})});controller.start(now);return{controller,changes,run(ms,duration){const end=now+duration;while(now<end){now+=ms;controller.update(ms,now)}},pause(ms){now+=ms;controller.update(ms,now)}}}

test('sustained whole-city overload lowers quality, bounded at the floor',()=>{
 const h=harness();h.run(35,12000);assert.deepEqual(h.controller.get(),{level:QUALITY_LEVELS.length-1,...QUALITY_LEVELS.at(-1)});assert.ok(h.changes.length<8);
});
test('a light view recovers quality after overload',()=>{
 const h=harness();h.run(35,12000);h.run(8.33,25000);assert.equal(h.controller.get().level,0);
});
test('normal 60Hz frames and a tab-resume gap do not reduce quality',()=>{
 const h=harness();h.run(16.67,8000);h.pause(5000);h.run(16.67,8000);assert.equal(h.changes.length,1);
});
test('consistently very slow hardware is not mistaken for isolated stalls',()=>{
 const h=harness();h.run(120,14000);assert.equal(h.controller.get().level,QUALITY_LEVELS.length-1);
});
test('a failed upward probe restores the sustainable level and backs off',()=>{
 const h=harness();h.run(25,3500);h.run(16.67,1000);const low=h.controller.get().level;for(let i=0;i<400&&h.controller.get().level===low;i++)h.run(16.67,16.67);assert.equal(h.controller.get().level,low-1);for(let i=0;i<100&&h.controller.get().level!==low;i++)h.run(25,25);assert.equal(h.controller.get().level,low);const count=h.changes.length;h.run(16.67,8000);assert.equal(h.changes.length,count);
});
