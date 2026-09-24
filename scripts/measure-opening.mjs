// Opening load and descent measurement (sprint 24Sep26h, lane O).
//
// Cold (HTTP cache disabled) and warm boots of the review URL at 1440x900 CSS,
// DPR2, headless Chromium on ANGLE Metal. Records, per boot:
//   firstDescentMs  navigation start -> first frame of the descent (the bar lets go)
//   stage timeline  layers ready, shaders compiled, warm-up done (gate clock)
//   readiness       when each item settled
//   frame gaps      worst / p95 / count over 50 and 100ms, descent window only
//   pathOk          sampled poses at 1s, 4.5s and 8s against intro.poseAt()
// Needs a DEV server (window.__ug). Serial, one GPU owner: quote numbers only
// from a run with the GPU otherwise idle.
//
// Usage: node scripts/measure-opening.mjs <origin> <outDir> [reps=2] [mbps] [query]
//   e.g. node scripts/measure-opening.mjs http://localhost:5191 /tmp/opening 3
//        node scripts/measure-opening.mjs http://localhost:5191 /tmp/opening 2 50
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const [origin = 'http://localhost:5173', out = '/tmp/ug-opening', repsArg = '2', mbps = '', query = 'buildings=baked'] = process.argv.slice(2);
const reps = Number(repsArg);
await mkdir(out, { recursive: true });

const RECORDER = () => {
  window.__audioContexts = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (!Orig) continue;
    window[name] = class extends Orig { constructor(...a) { super(...a); window.__audioContexts++; } };
  }
  window.__frames = [];
  const rec = ts => {
    const i = window.__ug?.intro;
    if (i) {
      const p = window.__ug.camera.position;
      window.__frames.push({ ts, phase: i.getPhase(), played: i.getPlayedMs(), x: p.x, y: p.y, z: p.z });
    } else window.__frames.push({ ts, phase: 'boot' });
    if (!i || i.getPhase() !== 'done') requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
  window.addEventListener('ug:opening-reveal', e => { window.__reveal = { at: performance.now(), detail: e.detail }; }, { once: true });
};

async function boot(browser, label, cold) {
  const ctx = browser.__ctx ?? (browser.__ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (cold) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (mbps) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: Number(mbps) * 1e6 / 8, uploadThroughput: 10e6 / 8 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(RECORDER);
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => window.__ug?.intro?.getPhase() === 'done', null, { timeout: 240000 });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const u = window.__ug, frames = window.__frames, gate = u.openingGate.getState();
    const playing = frames.filter(f => f.phase === 'playing');
    const first = frames.indexOf(playing[0]);
    const last = frames.findIndex((f, i) => i > first && f.phase === 'done');
    const win = frames.slice(first, last + 1);
    const gaps = [];
    for (let i = 1; i < win.length; i++) gaps.push(win[i].ts - win[i - 1].ts);
    const sorted = gaps.slice().sort((a, b) => a - b);
    // Loading-phase gaps (behind the bar) are reported, not judged.
    const load = frames.slice(0, first);
    let loadWorst = 0;
    for (let i = 1; i < load.length; i++) loadWorst = Math.max(loadWorst, load[i].ts - load[i - 1].ts);
    const sample = t => {
      const f = playing.reduce((a, b) => Math.abs(b.played - t) < Math.abs(a.played - t) ? b : a);
      const e = u.intro.poseAt(f.played);
      return { t, played: +f.played.toFixed(1), err: +Math.hypot(f.x - e.x, f.y - e.y, f.z - e.z).toFixed(4) };
    };
    return {
      firstDescentMs: Math.round(window.__reveal.at),
      descentWallMs: Math.round(win.at(-1).ts - win[0].ts),
      gaps: { frames: win.length, worst: +Math.max(...gaps).toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
        p50: +sorted[Math.floor(sorted.length / 2)].toFixed(1), over50: gaps.filter(g => g > 50).length, over100: gaps.filter(g => g > 100).length },
      loadingWorstGapMs: Math.round(loadWorst),
      samples: [1000, 4500, 8000].map(sample),
      timeline: gate.timeline, compile: gate.compile,
      items: Object.fromEntries(gate.readiness.items.map(i => [i.id, `${i.status}@${i.at}`])),
      audioContexts: window.__audioContexts,
    };
  });
  r.label = label; r.cold = cold; r.mbps = mbps || null; r.MB = +(bytes / 1e6).toFixed(1); r.errors = errors.slice(0, 5);
  console.log(`${label}: first descent frame ${r.firstDescentMs}ms | gate layers ${r.timeline.layersReady} compiled ${r.timeline.compiled} (${r.compile.ms}ms, ${r.compile.programsBefore}->${r.compile.programsAfter} programs) warmed ${r.timeline.warmed} | descent ${r.descentWallMs}ms worst gap ${r.gaps.worst} p95 ${r.gaps.p95} >50:${r.gaps.over50} >100:${r.gaps.over100} | loading worst gap ${r.loadingWorstGapMs} | ${r.MB}MB | audio ${r.audioContexts}`);
  await page.close();
  return r;
}

const results = [];
for (let i = 0; i < reps; i++) {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  results.push(await boot(browser, `cold#${i + 1}`, true));
  results.push(await boot(browser, `warm#${i + 1}`, false));
  await browser.close();
}
const med = (k, cold) => {
  const v = results.filter(r => r.cold === cold).map(r => r[k]).sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
};
const summary = { coldFirstDescentMedianMs: med('firstDescentMs', true), warmFirstDescentMedianMs: med('firstDescentMs', false),
  worstDescentGapMs: Math.max(...results.map(r => r.gaps.worst)), mbps: mbps || null, query };
console.log(JSON.stringify(summary));
await writeFile(`${out}/opening${mbps ? `-${mbps}mbps` : ''}.json`, JSON.stringify({ summary, results }, null, 1));
