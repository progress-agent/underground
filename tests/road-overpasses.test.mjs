import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roadOverpassConstraints,overpassDatum} from '../scripts/roads/overpasses.mjs';
test('a source-mapped road crossing gets clearance and continuous landings without lifting a canal chord',()=>{
  const bridge={id:1,bridge:true,layer:1,p:[[0,0],[100,0]]};
  const lower={id:2,layer:0,p:[[40,-20],[40,20]]};
  const constraints=roadOverpassConstraints([bridge,lower],()=>100);
  assert.deepEqual(constraints.get(bridge),[{t:.4,y:130,lowerWay:2}]);
  assert.equal(overpassDatum(0,100,105,constraints.get(bridge)),100);
  assert.equal(overpassDatum(1,100,105,constraints.get(bridge)),105);
  assert.equal(overpassDatum(.4,100,105,constraints.get(bridge)),130);
  assert.ok(overpassDatum(.001,100,105,constraints.get(bridge))<100.01);
  assert.equal(overpassDatum(.5,100,110),105,'without a road intersection the terrain chord stays unchanged');
  for(const other of [{...lower,tunnel:true},{...lower,layer:1},{...lower,p:[[0,-20],[0,20]]}])
    assert.equal(roadOverpassConstraints([bridge,other],()=>100).size,0);
});
