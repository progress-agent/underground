import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import proj4 from 'proj4';
import {createDlrProfile} from '../src/dlr-profile.js';
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const origin=proj4('EPSG:4326','EPSG:27700',[-.1278,51.5074]);
const project=(lat,lon)=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return{x:e-origin[0],z:origin[1]-n}};
const topology=JSON.parse(await readFile(new URL('../public/data/tfl/route-sequence/dlr.json',import.meta.url),'utf8'));
const id=s=>'940GZZDL'+s;
test('mapped station platforms fix entrance-coordinate errors and preserve tunnels',()=>{
 const profile=createDlrProfile({project,sampleSurfaceY:()=>50});
 for(const scale of [.2,1]){
  for(const suffix of ['EIN','BLA']){const p=profile.station({id:id(suffix),structureScale:scale});expect(p.y).toBeGreaterThan(50+4.5);expect(p._dlrProfile.classification).toBe('elevated');expect(p._dlrProfile.needsShaft).toBe(false);expect(p._depthM).toBeLessThan(0);expect(p._dlrProfile.surveyed).toBe(false);}
  for(const suffix of ['BNK','ISL','CUT','WLA']){const p=profile.station({id:id(suffix)});expect(p.y).toBeLessThan(50);expect(p._dlrProfile.needsShaft).toBe(true);}
  for(const suffix of ['GRE','DEV','BOW'])expect(profile.station({id:id(suffix)})._dlrProfile.classification).toBe('surface');
 }
});
test('all TfL branches use connected dense source paths and only actual platforms are stops',()=>{
 const profile=createDlrProfile({project,sampleSurfaceY:()=>0});
 for(const sequence of topology.stopPointSequences){
  const route=profile.buildBranch({points:sequence.stopPoint});expect(route.stationPoints.length).toBe(sequence.stopPoint.length);expect(route.stationUs[0]).toBe(0);expect(route.stationUs.at(-1)).toBe(1);
  expect(route.points.filter(p=>p.stationId).length).toBe(sequence.stopPoint.length);
  for(let i=1;i<route.points.length;i++){let a=route.points[i-1],b=route.points[i];expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThanOrEqual(20.01);expect(Number.isFinite(b.y)).toBe(true);}
  route.stationPoints.forEach((p,i)=>{const independent=profile.station({id:sequence.stopPoint[i].id,nodeIndex:p._dlrProfile.nodeIndex});expect(p.distanceTo(independent)).toBe(0);});
  const reverse=profile.buildBranch({points:[...sequence.stopPoint].reverse()});expect(reverse.stationPoints.map(p=>p.stationId).reverse()).toEqual(route.stationPoints.map(p=>p.stationId));
 }
});
test('terrain refresh, independent structure morph and roundtrips preserve platform alignment',()=>{
 let ground=null;const profile=createDlrProfile({project,sampleSurfaceY:()=>ground});const route=profile.buildBranch({points:topology.stopPointSequences[0].stopPoint});expect(route.terrainPending).toBe(true);
 ground=35;profile.resnap(route.points,{structureScale:1});expect(profile.terrainPending).toBe(false);const original=route.points.map(p=>p.y);
 profile.resnap(route.points,{structureScale:.2});for(let i=0;i<route.points.length;i++){const p=route.points[i];if(p._dlrProfile.classification==='tunnel')expect(p.y).toBe(original[i]);if(p.stationId)expect(p.y).toBe(profile.station({id:p.stationId,nodeIndex:p._dlrProfile.nodeIndex}).y);}
 profile.resnap(route.points,{structureScale:1});expect(route.points.map(p=>p.y)).toEqual(original);
 expect(()=>profile.station({id:'not-a-station'})).toThrow();expect(profile.sample({x:-99999,z:-99999})).toBeNull();expect(()=>profile.refresh({structureScale:NaN})).toThrow();
});
test('aboveground terrain spike is distance-tapered, while short underpasses and real portal nodes survive',()=>{
 const flat=createDlrProfile({project,sampleSurfaceY:()=>0});let east=flat.station({id:id('EIN')});
 const profile=createDlrProfile({project,sampleSurfaceY:({x,z})=>Math.hypot(x-east.x,z-east.z)<30?120:0});
 const route=profile.buildBranch({points:[{id:id('BLA')},{id:id('EIN')},{id:id('CGT')}]});
 for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],d=Math.hypot(a.x-b.x,a.z-b.z);if(!['portal','tunnel'].includes(a._dlrProfile.classification)&&!['portal','tunnel'].includes(b._dlrProfile.classification))expect(Math.abs(a.y-b.y)/5/(d||1)).toBeLessThanOrEqual(.08001);}
 const kinds=new Set();for(const seq of topology.stopPointSequences)for(const p of flat.buildBranch({points:seq.stopPoint}).points)kinds.add(p._dlrProfile.classification);expect(kinds.has('cutting')).toBe(true);expect(kinds.has('portal')).toBe(true);
 const branch=flat.buildBranch({points:[{id:id('CYP')},{id:id('BPK')}]});expect(branch.points.some(p=>p._dlrProfile.classification==='tunnel')).toBe(true);
});
