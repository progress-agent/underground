// B1 is a whole-city test, not a few favourable fixtures. The verifier replays
// all source filters and checks every rectangle against its actual outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
test('every baked footprint keeps true area/orientation and original vertical fields', {timeout:180000},()=>{
 const root=path.resolve(import.meta.dirname,'..');
 const output=execFileSync(process.execPath,[path.join(root,'scripts/verify-bake.mjs')],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024});
 assert.match(output,/PASS: every UGB2 record/);console.log(output.trim());
});
