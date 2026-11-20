import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodeRoadBlock,createRoadMaterial} from '../src/roads.js';

test('aerial road indices share the original vertices, retain upward triangles and never index outside a block',()=>{
  const dir=new URL('../public/data/roads/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir))),material=createRoadMaterial();
  let nearCount=0,farCount=0;
  try{for(const r of manifest.records){
    const raw=gunzipSync(fs.readFileSync(new URL(r.file,dir))),mesh=decodeRoadBlock(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),material,material,r);
    const near=mesh.userData.roadNearGeometry,far=mesh.userData.roadFarGeometry;
    if(r.tier!=='desktop'){assert.equal(far,undefined);near.dispose();continue;}
    assert.ok(far);assert.equal(far.attributes.position,near.attributes.position);assert.equal(far.attributes.roadData,near.attributes.roadData);
    assert.ok(far.index.count<=near.index.count);
    const p=near.attributes.position;
    for(let i=0;i<far.index.count;i+=3){
      const ids=[far.index.getX(i),far.index.getX(i+1),far.index.getX(i+2)];
      assert.ok(ids.every(j=>j<p.count),r.file);
      const[a,b,c]=ids,ny=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
      assert.ok(ny>=0,r.file);
    }
    nearCount+=near.index.count;farCount+=far.index.count;near.dispose();far.dispose();
  }
  assert.ok(farCount<nearCount,'the additional index must actually reduce drawing');
  }finally{material.dispose();}
});
