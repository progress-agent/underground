import test from 'node:test';import assert from 'node:assert/strict';
import {createPhoneViewport}from'../src/phone-viewport.js';
test('phone frame reads use cached canvas/native sizes; observer and resize update them',()=>{
 let reads=0,resize,notify;const canvas={get clientWidth(){reads++;return 430},get clientHeight(){reads++;return 932}};
 const view={innerHeight:932,devicePixelRatio:3,addEventListener(k,fn){resize=fn},removeEventListener(){}};
 class Observer{constructor(fn){notify=fn}observe(){}disconnect(){}}
 const cache=createPhoneViewport(canvas,{view,Observer});assert.equal(reads,2);
 for(let i=0;i<1000;i++){assert.equal(cache.state.w,430);assert.equal(cache.state.nativeHeight,2796)}assert.equal(reads,2);
 notify([{target:canvas,contentRect:{width:932,height:430}}]);view.innerHeight=430;resize();
 assert.deepEqual(cache.state,{w:932,h:430,nativeHeight:1290});assert.equal(reads,2);cache.dispose();
});
