import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportFace,conformRoadTriangle,raiseRoadDeck} from '../scripts/roads/support.mjs';
const face=p=>supportFace(p);
const ground=[face([[0,0,0],[10,0,0],[0,10,0]])];
const area=t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]))/2;
test('a bank ridge between road edges is present in triangle interiors without floating chords',()=>{
  const road=[[0,0,-1,0],[10,0,1,0],[0,10,-1,0]];
  const banks=[face([[2,0,0],[4,0,8],[2,6,0]]),face([[4,0,8],[6,0,0],[2,6,0]])];
  const triangles=conformRoadTriangle(road,ground,banks);
  assert.ok(triangles.length>3);
  assert.ok(Math.abs(triangles.reduce((s,t)=>s+area(t),0)-50)<1e-7,'clipping preserves the road footprint');
  let high=0;
  for(const t of triangles)for(const w of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){
    const p=[0,1,2,3].map(k=>t.reduce((s,v,i)=>s+w[i]*v[k],0));
    const candidates=banks.filter(f=>{const [a,b,c]=f.points;const cross=(a,b)=> (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);return cross(a,b)>=-1e-7&&cross(b,c)>=-1e-7&&cross(c,a)>=-1e-7;});
    const expected=Math.max(0,...candidates.map(f=>f.height(p[0],p[1])));
    assert.ok(Math.abs(p[3]-expected)<1e-7,`support at ${p}`);
    assert.ok(Math.abs(p[2]-(p[0]/5-1))<1e-7,'pavement coordinate survives interior clipping');
    high=Math.max(high,p[3]);
  }
  assert.ok(high>4,'the old edge-only ribbon would miss the ridge entirely');
});
test('overlapping dry banks split at their height crossover and select the higher support',()=>{
  const a=face([[0,0,0],[10,0,10],[0,10,0]]),b=face([[0,0,10],[10,0,0],[0,10,10]]);
  const tris=conformRoadTriangle([[0,0,-1,0],[10,0,1,0],[0,10,-1,0]],ground,[a,b]);
  assert.ok(Math.abs(tris.reduce((s,t)=>s+area(t),0)-50)<1e-7);
  for(const t of tris){const p=[0,1,2,3].map(k=>t.reduce((s,v)=>s+v[k]/3,0));assert.ok(Math.abs(p[3]-Math.max(a.height(...p),b.height(...p)))<1e-7);}
});
test('a bridge crossing a bank boundary retains a separate support and physical rise on each side',()=>{
  const road=[[0,0,-1,0],[10,0,1,0],[0,10,-1,0]],bank=face([[2,0,8],[4,0,8],[2,6,8]]),deck=face([[0,0,10],[10,0,10],[0,10,10]]);
  const tris=raiseRoadDeck(conformRoadTriangle(road,ground,[bank]),deck);
  let low=false,high=false;
  for(const t of tris){const y=t.reduce((s,v)=>s+v[3]/3,0),rise=t.reduce((s,v)=>s+v[4]/3,0);assert.ok(Math.abs(y-10)<1e-7);if(Math.abs(rise-10)<1e-7)low=true;if(Math.abs(rise-2)<1e-7)high=true;}
  assert.ok(low&&high,'the deck is level while both independent support planes retain their true clearance');
});
