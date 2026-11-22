#!/usr/bin/env node
// Whole-bake verification: replay source identity/filter order, derive true area
// and minimum-area rectangle again, and compare every vertical field to UGB1.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { installNodeEnv, ROOT } from './bake-node-env.mjs';
import { isSuppressed } from './landmarks.mjs';
import { createAirportSuppression } from '../src/airport-suppression.js';
import { readBuildingRecord } from '../src/building-record.js';
import { cleanRing,hull,minRect,signedArea } from './buildings/geom.mjs';
installNodeEnv();
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f)));
const dir=path.join(ROOT,'public/data/surface/baked');
const bin=fs.readFileSync(path.join(dir,'buildings.bin')),square=fs.readFileSync(path.join(dir,'buildings-square.bin'));
const meta=read('public/data/surface/baked/meta.json');
assert.equal(createHash('sha256').update(bin).digest('hex'),meta.payloadSha256);
assert.equal(bin.readUInt32LE(0),0x32424755);assert.equal(bin.readUInt16LE(4),2);
const n=bin.readUInt32LE(8),nt=bin.readUInt16LE(6);
assert.equal(bin.length,12+nt*16+n*14);assert.equal(n,square.readUInt32LE(8));
const v=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
const {initThamesMask,isInThames}=await import('../src/thames-mask.js');
const {loadM25Data,initM25Boundary,isInsideM25}=await import('../src/m25.js');
initThamesMask(read('public/data/thames.json').points);const m25=await loadM25Data();initM25Boundary(m25.supportPoints||m25.points);
const airport=createAirportSuppression(read('src/airport-data.json'));
const placed=new Set(),files=read('public/data/surface/tiles/manifest.json').tiles.sort((a,b)=>a.file.localeCompare(b.file));
let tile=0,checked=0,maxAreaError=0,maxAngleDegrees=0,maxCentreError=0,verticalDifferences=0,sourceCentreDifferences=0;
for(const file of files){
 const records=[];
 for(const b of read('public/data/surface/tiles/'+file.file).buildings||[]){
  if(!isInsideM25(b.cx,b.cz)||isInThames(b.cx,b.cz)||airport(b)||isSuppressed(b.cx,b.cz))continue;
  const key=`${Math.round(b.cx/5)*5},${Math.round(b.cz/5)*5},${Math.round(b.height)}`;
  if(placed.has(key))continue;placed.add(key);
  if(!Number.isFinite(b.height)||!Number.isFinite(b.area)||b.area<=0)continue;
  records.push(b);
 }
 if(!records.length)continue;
 const d=12+tile*16,t={minX:bin.readInt32LE(d),minZ:bin.readInt32LE(d+4)},off=bin.readUInt32LE(d+8),so=square.readUInt32LE(d+8);
 assert.equal(records.length,bin.readUInt32LE(d+12),file.file);
 for(let i=0;i<records.length;i++){
  const b=records[i],o=off+i*14,r=readBuildingRecord(v,o,t,2),ring=cleanRing(b.footprint),area=Math.abs(signedArea(ring)),mr=minRect(hull(ring));
  maxAreaError=Math.max(maxAreaError,Math.abs(r.width*r.depth/area-1));
  maxAngleDegrees=Math.max(maxAngleDegrees,Math.abs(r.theta-mr.theta)*180/Math.PI);
  maxCentreError=Math.max(maxCentreError,Math.abs(r.x-mr.cx),Math.abs(r.z-mr.cz));
  if(bin.readUInt16LE(o+4)!==square.readUInt16LE(so+i*10+4)||bin.readInt16LE(o+8)!==square.readInt16LE(so+i*10+8))verticalDifferences++;
  const sx=square.readInt32LE(d)+square.readUInt16LE(so+i*10)*.1,sz=square.readInt32LE(d+4)+square.readUInt16LE(so+i*10+2)*.1;
  if(Math.abs(sx-b.cx)>.0500001||Math.abs(sz-b.cz)>.0500001)sourceCentreDifferences++;
  checked++;
 }
 tile++;
}
const result={checked,tiles:tile,maxAreaError,maxAngleDegrees,maxCentreError,verticalDifferences,sourceCentreDifferences};
console.log(JSON.stringify(result,null,2));
assert.equal(checked,n);assert.ok(maxAreaError<=.01);assert.ok(maxAngleDegrees<=1);assert.ok(maxCentreError<=.0500001);assert.equal(verticalDifferences,0);assert.equal(sourceCentreDifferences,0);
console.log('PASS: every UGB2 record matches true area/orientation and UGB1 vertical fields');
