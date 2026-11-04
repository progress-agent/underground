// Reconciled Balloon protocol: see docs/balloon-measurement.md. Never detach a CDP session during a throttled run.
import {measure} from './measure-setups.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const [out,...origins]=process.argv.slice(2);if(!out||!origins.length)throw Error('usage: measure-balloon.mjs <out-dir> <live-origin> <new-origin>');
await mkdir(out,{recursive:true});
for(let round=1;round<=3;round++)for(let i=0;i<origins.length;i++){
 const data=await measure({origin:origins[i],setup:'weak',label:`${i?'new':'live'}-r${round}`,views:['playerBalloon'],settleS:60,profile:false});
 await writeFile(`${out}/${i?'new':'live'}-r${round}.json`,JSON.stringify(data));
}
