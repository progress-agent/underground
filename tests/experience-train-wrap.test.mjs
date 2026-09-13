import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import captured from './experience-acceptance-train-stall.json' with {type:'json'};
import {updateTrains} from '../src/trains.js';
function fixture({dir=1,t=.4,stations=[],nextStationIndex=0}={}){
 const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0),new THREE.Vector3(100,0,0)]);
 const train=new THREE.Group();train.userData={curve,curveLengthM:100,cruiseMps:10,dir,t,
  stationUs:stations,nextStationIndex,dwellSec:20,_pausedLeft:0};
 return {train,system:{allTrains:[train]},sim:{paused:false,timeScale:1}};
}
for(const dir of[-1,1])test(`multiple full circuits remain finite in direction ${dir}`,()=>{
 const {train,system,sim}=fixture({dir});updateTrains(system,sim,null,37);
 const expected=((.4+dir*3.7)%1+1)%1;
 assert.ok(Math.abs(train.userData.t-expected)<1e-12);
 assert.ok(train.position.toArray().every(Number.isFinite));
});
for(const dir of[-1,1])test(`full circuit reaches next station and preserves dwell in direction ${dir}`,()=>{
 const {train,system,sim}=fixture({dir,stations:[.2,.8],nextStationIndex:dir===1?1:0});
 updateTrains(system,sim,null,37);
 assert.equal(train.userData.t,dir===1?.8:.2);
 assert.equal(train.userData._pausedLeft,20);
 const phase=train.userData.t;updateTrains(system,sim,null,.5);
 assert.equal(train.userData.t,phase);assert.equal(train.userData._pausedLeft,19.5);
});
for(const dir of[-1,1])test(`ordinary motion and station crossing remain unchanged in direction ${dir}`,()=>{
 const {train,system,sim}=fixture({dir,t:.5,stations:[.4,.6],nextStationIndex:dir===1?1:0});
 updateTrains(system,sim,null,.1);
 assert.ok(Math.abs(train.userData.t-(.5+dir*.01))<1e-12);assert.equal(train.userData._pausedLeft,0);
 updateTrains(system,sim,null,1);
 assert.equal(train.userData.t,dir===1?.6:.4);assert.equal(train.userData._pausedLeft,20);
});
test('paused simulation retains phase and dwell',()=>{
 const {train,system,sim}=fixture();train.userData._pausedLeft=12;sim.paused=true;
 updateTrains(system,sim,null,60);assert.equal(train.userData.t,.4);assert.equal(train.userData._pausedLeft,12);
});
test('captured published DLR startup stall arrives at its next station without corrupting the spline phase',()=>{
 const curve=new THREE.CatmullRomCurve3(captured.sourcePoints.map(p=>new THREE.Vector3(...p)));
 assert.ok(Math.abs(curve.getLength()-captured.curveLength)<1e-8);
 const train=new THREE.Group();train.userData={curve,curveLengthM:captured.curveLength,
  cruiseMps:captured.cruiseMps,dir:captured.dir,t:captured.before,stationUs:captured.stationUs,
  nextStationIndex:captured.nextStationIndex,dwellSec:captured.dwellSec,_pausedLeft:0};
 updateTrains({allTrains:[train]},{paused:false,timeScale:captured.timeScale},null,captured.dt);
 assert.equal(train.userData.t,1);assert.equal(train.userData.nextStationIndex,0);
 assert.equal(train.userData._pausedLeft,captured.dwellSec);
 assert.ok(train.position.toArray().every(Number.isFinite));
 // The production startup resnap reuses this phase against a rebuilt curve.
 assert.doesNotThrow(()=>curve.clone().getPointAt(train.userData.t));
});
