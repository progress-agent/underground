// Turn measure-roads.mjs JSON files into a markdown table of frame-cost deltas against the same run's base case.
//   node scripts/r-roads/summarise-measurements.mjs a.json [b.json ...]
// With several files of the same setup, each cell is the median of the runs. "noise" is |base2 - base| (the proof is
// inert in both), the honest floor under any delta.
import fs from 'node:fs';
const files = process.argv.slice(2);
const runs = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const views = Object.keys(runs[0].cases.base.views), cases = Object.keys(runs[0].cases).filter(c => c !== 'base');
const out = [`setup ${runs[0].setup}, quality ${runs[0].quality}, uncapped ${runs[0].uncapped}, ${runs.length} run(s); cells are frame interval in ms, delta against the same run's base in brackets`, '',
  '| case | ' + views.join(' | ') + ' |', '|---|' + views.map(() => '---').join('|') + '|'];
const row = (c) => '| ' + c + ' | ' + views.map(v => {
  const ds = [], vs = [];
  for (const r of runs) { const x = r.cases[c]?.views[v], b = r.cases.base.views[v]; if (x && b) { vs.push(x.intervalMs); ds.push(x.intervalMs - b.intervalMs); } }
  return vs.length ? `${med(vs).toFixed(1)} (${med(ds) >= 0 ? '+' : ''}${med(ds).toFixed(1)})` : '-';
}).join(' | ') + ' |';
out.push('| base | ' + views.map(v => med(runs.map(r => r.cases.base.views[v].intervalMs)).toFixed(1)).join(' | ') + ' |');
for (const c of cases) out.push(row(c));
console.log(out.join('\n'));
