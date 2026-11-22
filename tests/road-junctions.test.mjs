import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import {dimensions,WIDTHS,buildNetwork,pairCarriageways,readRoadNetwork} from '../scripts/roads/network.mjs';
import {carriagewayIndex,trimJunction,area,cut,split} from '../scripts/roads/polygons.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('width precedence: explicit metres, lanes at estimated 3.2m, one-way half, class fallback',()=>{
  assert.equal(dimensions({width:'7.1',lanes:'4',oneway:'yes'},2).width,7.1);
  assert.ok(Math.abs(dimensions({lanes:'3',oneway:'yes'},2).width-9.6)<1e-10);
  for(let cls=0;cls<8;cls++){
    assert.equal(dimensions({oneway:'yes'},cls).width,WIDTHS[cls]/2);
    assert.equal(dimensions({oneway:'-1'},cls).width,WIDTHS[cls]/2);
    assert.equal(dimensions({},cls).width,WIDTHS[cls]);
  }
  assert.equal(dimensions({lanes:'bad'},2).width,9);
  assert.deepEqual(dimensions({oneway:'yes'},1),{width:5,left:2,right:2});
  assert.deepEqual(dimensions({oneway:'yes',sidewalk:'no'},1),{width:5,left:0,right:0});
});
test('five real dual carriageways follow source widths and suppress the inner pavement',()=>{
  const net=buildNetwork(root,[[-80000,-80000],[80000,-80000],[80000,80000],[-80000,80000]]);
  const source=new Map();for(const f of fs.readdirSync(path.join(root,'scripts/.cache/roads-overpass')).filter(f=>/^blk_.*\.json\.gz$/.test(f)).sort())
    for(const w of JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'scripts/.cache/roads-overpass',f)))).elements)if(w.type==='way'&&!source.has(w.id))source.set(w.id,w);
  for(const name of ['North Circular Road','Great West Road','Eastern Avenue','Western Avenue','Watford Way']){
    const roads=net.roads.filter(r=>r.name===name&&r.pairedWith);assert.ok(roads.length>0,name);
    for(const r of roads){const tags=source.get(r.id).tags;
      assert.equal(r.width,dimensions(tags,r.cls).width,`${name} ${r.id}`);
      assert.ok(r.left===0||r.right===0,`inner pavement: ${name} ${r.id}`);
      assert.ok(r.pairedWith.every(id=>source.has(id)));
    }
  }
  assert.ok(net.stats.unpairedOneWayWays>0,'unpaired ways are counted honestly');
});
test('junction clipping removes pavement across a T and marks the carriageway overlap',()=>{
  const r={id:1,p:[[-20,0],[20,0]],width:6,left:2,right:2,layer:0,bridge:false};
  const other={...r,id:2,p:[[0,-20],[0,20]]};
  const index=carriagewayIndex([r,other]);
  // Across metres = z for the eastbound ribbon.
  const triangles=[[[-20,-5,-5],[20,-5,-5],[20,5,5]],[[-20,-5,-5],[20,5,5],[-20,5,5]]];
  let pavement=0,junction=0;
  for(const t of triangles)for(const p of trimJunction(t,r,index)){
    if(!p.junction)for(const band of [split(p.polygon,v=>-3-v[2])[0],split(p.polygon,v=>v[2]-3)[0]])if(band.length){
      pavement+=area(band);for(const f of index([-20,-5,20,5]).filter(f=>f.r.id!==r.id))assert.equal(cut(band,f.polygon).inside.length,0);
    }
    if(p.junction)junction+=area(p.polygon);
  }
  assert.ok(Math.abs(pavement-136)<1e-6);assert.ok(Math.abs(junction-36)<1e-6);
});
test('a disjoint convex clip preserves the original face rather than fragmenting it on infinite edge lines',()=>{
  const triangle=[[0,0],[10,0],[0,10]],clip=[[9,9],[11,9],[11,11],[9,11]];
  assert.deepEqual(cut(triangle,clip),{inside:[],outside:[triangle]});
});

test('opposing carriageways keep only their geometric outer pavement; unpaired ways keep both',()=>{
  const a={id:1,oneway:true,direction:1,name:'Fixture',ref:'A1',cls:2,layer:0,bridge:false,width:4.5,left:2,right:2,p:[[0,0],[20,0]]};
  const b={...a,id:2,p:[[20,10],[0,10]]},c={...a,id:3,name:'Unpaired',ref:null,p:[[0,100],[20,100]]};
  assert.deepEqual(pairCarriageways([a,b,c]),{pairedOneWayWays:2,unpairedOneWayWays:1});
  assert.deepEqual([a.left,a.right,b.left,b.right,c.left,c.right],[2,0,2,0,2,2]);
});
test('the published compact network is fully consumed and includes the five dual carriageways',()=>{
  const roads=readRoadNetwork(path.join(root,'public/data/roads/network.bin.gz'));
  assert.ok(roads.length>300000);for(const id of [1203,2145852,2969394,101596,367928]){
    const r=roads.find(r=>r.id===id);assert.ok(r,String(id));assert.ok(r.width>0&&r.p.length>1);assert.ok(r.left===0||r.right===0);
  }
});
