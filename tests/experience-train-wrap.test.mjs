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
// s25:H (D-039): trains follow a timetable that is a pure function of elapsed
// simulation time, so a long frame no longer drops the time left over at the
// first station it reaches. The 37 s frame now serves every stop in order:
// forward from .4, arrive .8 at 4 s, dwell to 24 s, wrap, arrive .2 at 28 s
// and dwell there (11 s left at 37 s); reverse from .4, arrive .2 at 2 s, dwell
// to 22 s, wrap, arrive .8 at 26 s (9 s left). The intent is unchanged: a long
// frame still stops the train at a station and keeps its dwell.
for(const dir of[-1,1])test(`full circuit reaches next station and preserves dwell in direction ${dir}`,()=>{
 const {train,system,sim}=fixture({dir,stations:[.2,.8],nextStationIndex:dir===1?1:0});
 updateTrains(system,sim,null,37);
 assert.equal(train.userData.t,dir===1?.2:.8);
 assert.ok(Math.abs(train.userData._pausedLeft-(dir===1?11:9))<1e-9);
 const phase=train.userData.t,left=train.userData._pausedLeft;updateTrains(system,sim,null,.5);
 assert.equal(train.userData.t,phase);assert.ok(Math.abs(train.userData._pausedLeft-(left-.5))<1e-9);
});
for(const dir of[-1,1])test(`ordinary motion and station crossing remain unchanged in direction ${dir}`,()=>{
 const {train,system,sim}=fixture({dir,t:.5,stations:[.4,.6],nextStationIndex:dir===1?1:0});
 updateTrains(system,sim,null,.1);
 assert.ok(Math.abs(train.userData.t-(.5+dir*.01))<1e-12);assert.equal(train.userData._pausedLeft,0);
 // s25:H (D-039): arrival at 1.0 s, so 0.1 s of the 20 s dwell is already spent at 1.1 s.
 updateTrains(system,sim,null,1);
 assert.equal(train.userData.t,dir===1?.6:.4);assert.ok(Math.abs(train.userData._pausedLeft-19.9)<1e-9);
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
 // s25:H (D-039): the frame's time is kept, not dropped at arrival, so part of
 // the dwell is already spent. Reached from the timetable, paced by the
 // branch's plan-view length (vertical resnaps leave it unchanged): stops at
 // w 0 and 1 (reverse), anchor at w .4665, after the w 0 stop.
 let plan=0;const P0=new THREE.Vector3(),P1=curve.getPoint(0);
 for(let j=1;j<=4000;j++){curve.getPoint(j/4000,P0);plan+=Math.hypot(P0.x-P1.x,P0.z-P1.z);P1.copy(P0);}
 const T1=plan/captured.cruiseMps,d=captured.dwellSec,P=T1+2*d;
 const tau=((1-captured.before)*T1+d+captured.dt*captured.timeScale)%P;
 assert.ok(tau<d,'dwelling at the u 1 stop');
 // 10 ms: the app measures plan length with fewer chords than this check does.
 assert.ok(Math.abs(train.userData._pausedLeft-(d-tau))<1e-2);
 assert.ok(train.userData._pausedLeft>0&&train.userData._pausedLeft<=captured.dwellSec);
 assert.ok(train.position.toArray().every(Number.isFinite));
 // The production startup resnap reuses this phase against a rebuilt curve.
 assert.doesNotThrow(()=>curve.clone().getPointAt(train.userData.t));
});
