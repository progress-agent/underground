import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameTimeReadout} from '../src/frame-time-readout.js';
test('readout reports a five-second median and p95, evicts stale frames and shows the rung',()=>{
 const element={style:{},setAttribute(){},remove(){this.removed=true;}},document={createElement:()=>element,body:{append(){}}};
 const readout=createFrameTimeReadout({getRung:()=>3,document});
 let t=0;readout.update(t);for(let i=0;i<100;i++){t+=i%10===0?50:20;readout.update(t);}
 t+=500;readout.update(t);assert.match(element.textContent,/median 20.0 ms/);assert.match(element.textContent,/p95 50.0 ms/);assert.match(element.textContent,/Auto 3/);
 for(let i=0;i<400;i++){t+=16;readout.update(t);}
 assert.match(element.textContent,/median 16.0 ms/);assert.match(element.textContent,/p95 16.0 ms/);readout.dispose();assert.equal(element.removed,true);
});
