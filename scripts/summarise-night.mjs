// summarise-night.mjs: table of measure-night.mjs results (R night proof, THROWAWAY).
//   node scripts/summarise-night.mjs <dir-of-json> [--md]
// Averages the per-run mean ms over rounds; prints ms per frame and the change against `day`.
import { readdir, readFile } from 'node:fs/promises';
const dir = process.argv[2]; const md = process.argv.includes('--md');
const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
const acc = {};
for (const f of files) {
  const j = JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
  for (const [view, v] of Object.entries(j.views)) {
    const k = `${j.setup}|${j.label}|${view}`;
    (acc[k] ??= []).push(v.mean);
  }
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => Math.sqrt(avg(a.map(x => (x - avg(a)) ** 2)));
const setups = [...new Set(Object.keys(acc).map(k => k.split('|')[0]))];
const labels = ['base', 'day', 'night', 'nostars', 'nowin', 'noglow', 'nomoon', 'night-noshadow', 'day-noshadow'];
const views = ['overview', 'streetBank', 'riverGreenwich'];
for (const s of setups) {
  console.log(`\n${md ? '### ' : ''}${s}`);
  if (md) console.log('| variant | ' + views.join(' | ') + ' |\n|---|' + views.map(() => '---|').join(''));
  for (const l of labels) {
    const cells = views.map(v => {
      const a = acc[`${s}|${l}|${v}`]; const d = acc[`${s}|day|${v}`];
      if (!a) return '-';
      const m = avg(a); const delta = d ? ` (${m - avg(d) >= 0 ? '+' : ''}${(m - avg(d)).toFixed(2)})` : '';
      return `${m.toFixed(2)}${l === 'day' ? '' : delta} n${a.length}`;
    });
    console.log(md ? `| ${l} | ${cells.join(' | ')} |` : `${l.padEnd(16)} ${cells.map(c => c.padEnd(22)).join('')}`);
  }
}
