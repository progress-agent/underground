import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RESERVOIR_FEET,correctedReservoirElevation} from '../src/reservoir-feet.js';
import {offsetRing,openRing} from '../src/water-body-geometry.js';
const inventory=JSON.parse(fs.readFileSync(new URL('../public/data/deep-water.json',import.meta.url)));
test('the four foot surveys are exact subsets of the cited inventory, with unchanged crests',()=>{
 assert.equal(RESERVOIR_FEET.length,4);
 for(const s of RESERVOIR_FEET){const b=inventory.bodies.find(b=>b.id===s.id);assert.deepEqual(s.bank,b.bank);assert.deepEqual(s.ring,b.rings[0]);assert.ok(s.bank.source.startsWith('https://environment.data.gov.uk/'));}
});
test('corrected outer feet achieve each surveyed rise, even at the Staines shared divider',()=>{
 for(const s of RESERVOIR_FEET){const foot=offsetRing(openRing(s.ring),s.bank.freeboardM*3+4+s.bank.heightM*3);
 const levels=foot.map(([x,z])=>correctedReservoirElevation(x,z,25));
 assert.ok(Math.abs(s.bank.crestAodM-Math.min(...levels)-s.bank.heightM)<.01,`${s.name}: ${Math.min(...levels)}`);}
});
test('far terrain is bit identical; the estimated blend has no boundary step',()=>{
 assert.equal(correctedReservoirElevation(0,0,12.345),12.345);
 const s=RESERVOIR_FEET[0],x=s.maxX+1,z=s.maxZ+1;
 assert.equal(correctedReservoirElevation(x,z,12),12);
 const p=s.ring.reduce((a,b)=>a[0]>b[0]?a:b),samples=[];
 for(let d=0;d<700;d+=.1)samples.push(correctedReservoirElevation(p[0]+d,p[1],25));
 assert.ok(samples.every(Number.isFinite));
 assert.ok(Math.max(...samples.slice(1).map((y,i)=>Math.abs(y-samples[i])))<.01);
});
