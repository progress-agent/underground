// Serial interleaved measurements, median of three. Invoke the entire command through ug-gpu.sh.
import {run} from './measure-night.mjs';
import {measure} from './measure-setups.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const [kind,out,live='http://localhost:5328',candidate='http://localhost:5330']=process.argv.slice(2);
await mkdir(out,{recursive:true});
const views=['overview','streetBank','riverGreenwich','m25Edge','heathrow','arrival','playerFoot','playerSkate','playerDrone','playerBalloon'];
if(kind==='cost'){
 for(const setup of ['as-lived','weak'])for(let round=1;round<=3;round++)for(const [label,origin,hour] of [['live',live,null],['day',candidate,null],['night',candidate,23]]){
  const r=await run({origin,setup,label,views,frames:90,hour});await writeFile(`${out}/${setup}-${label}-r${round}.json`,JSON.stringify(r));
 }
}else if(kind==='automatic'){
 for(const setup of ['as-lived','weak'])for(let round=1;round<=3;round++)for(const [label,origin,hour] of [['live',live,null],['night',candidate,23]]){
  const r=await measure({origin,setup,label,views,settleS:60,hour});await writeFile(`${out}/${setup}-${label}-r${round}.json`,JSON.stringify(r));
 }
}else if(kind==='phone'){
 for(let round=1;round<=3;round++)for(const [label,origin,hour]of [['live',live,null],['night',candidate,23]]){
  const r=await measure({origin,setup:'weak',label,views:views.slice(0,3),settleS:60,hour,phone:true});await writeFile(`${out}/phone-${label}-r${round}.json`,JSON.stringify(r));
 }
}else throw Error('usage: measure-sprint-night.mjs cost|automatic|phone <out-dir> [live-origin] [new-origin]');
