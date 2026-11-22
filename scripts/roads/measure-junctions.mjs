#!/usr/bin/env node
// R1, whole asset. Re-bakes both live-width/cap rules and corrected rules from
// the same cached OSM and current terrain. Measures the stored (quantised)
// desktop pavement-band triangles, clipping against the union of every OTHER
// same-level carriageway. Union subtraction avoids double-counting crossings.
// Usage: node scripts/roads/measure-junctions.mjs /absolute/output-dir
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('Pass an absolute scratch output directory');
fs.mkdirSync(out,{recursive:true});
const results={method:'stored pavement triangle area intersecting union of other same-layer carriageways, desktop full and aerial topology, separately and combined; m²'};
for(const mode of ['legacy','corrected']){
  const dir=path.join(out,mode);const log=execFileSync(process.execPath,[path.join(root,'scripts/roads/prepare.mjs'),'--out',dir,'--audit',...(mode==='legacy'?['--legacy']:[])],{timeout:2400000,maxBuffer:5e6});
  fs.writeFileSync(path.join(out,mode+'.log'),log);results[mode]=JSON.parse(fs.readFileSync(path.join(dir,'junction-audit.json')));
}
results.pass=results.corrected.percent<=.5;
fs.writeFileSync(path.join(out,'junction-comparison.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
