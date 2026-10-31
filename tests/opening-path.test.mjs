import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningPath,accelerateOpeningPath} from '../src/opening-path.js';
import {VISTA_BY_ID} from '../src/opening-vistas.js';
for (const height of [5000,18000,35000]) for (const id of ['kings-cross','bank','jubilee-thames']) {
 const p=createOpeningPath({...VISTA_BY_ID[id],startAltM:height,totalMs:10000,tauMs:800});
 const n=accelerateOpeningPath(p);
 test(`${id} at ${height}: half descent, identical stop, continuous speed and acceleration`,()=>{
   assert.equal(n.totalMs,5000);
   assert.ok(Math.abs(n.msAtArc(n.uC)-n.crossingMs)<1e-7);
   for(let k=0;k<=100;k++) {
     const t=n.crossingMs+(n.totalMs-n.crossingMs)*k/100;
     assert.ok(Math.abs(n.arcAt(t)-p.arcAt(t+n.savedMs))<1e-12);
     assert.ok(n.poseAt(t).distanceTo(p.poseAt(t+n.savedMs))<1e-7);
   }
   const h=.1,c=n.crossingMs;
   const left=(n.arcAt(c)-n.arcAt(c-h))/h,right=(n.arcAt(c+h)-n.arcAt(c))/h;
   assert.ok(Math.abs(left-right)/right<.002);
   const accLeft=(n.arcAt(c)-2*n.arcAt(c-h)+n.arcAt(c-2*h))/(h*h);
   const accRight=(n.arcAt(c+2*h)-2*n.arcAt(c+h)+n.arcAt(c))/(h*h);
   assert.ok(Math.abs(accLeft-accRight)/Math.abs(accRight)<.02);
   const speeds=[];for(let t=1;t<5000;t++)speeds.push(n.arcAt(t+.5)-n.arcAt(t-.5));
   const peak=Math.max(...speeds),i=speeds.indexOf(peak);
   assert.ok(speeds.every(s=>s>=0));
   assert.ok(speeds.slice(0,i).every((s,k)=>s<=speeds[k+1]+1e-12));
   assert.ok(speeds.slice(i).every((s,k)=>k===0||s<=speeds[i+k-1]+1e-12));
 });
}
test('an unchanged stop longer than the budget is refused',()=>{
 const p=createOpeningPath({...VISTA_BY_ID['kings-cross'],startAltM:18000,totalMs:10000,tauMs:800});
 assert.throws(()=>accelerateOpeningPath(p,1000),/unchanged stop needs/);
});
