// Cold production boots: real WebGL program calls and RAF intervals, without DEV hooks.
// Run through the project's GPU lock, against isolated live/new preview servers:
// node scripts/measure-opening-programs.mjs <out> <reps> live=<url> new=<url>
//   [--cpu=4 --dpr=1] [--saved=night] [--after=10000]
// The scored visible interval starts at cover-lifted; the descent starts at
// descent-begin. gate-reveal occurs later and must never narrow either window.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const pos = args.filter(a => !a.startsWith('--'));
const [out, repsArg, ...targets] = pos;
const reps = Number(repsArg);
const mbps = flags.mbps ? Number(flags.mbps) : null, rtt = flags.rtt ? Number(flags.rtt) : 0;
const query = flags.query ?? '';
const afterMs = flags.after ? Number(flags.after) : 10000;
await mkdir(out, { recursive: true });

const INIT = (afterMs) => {
  try { performance.setResourceTimingBufferSize(5000); } catch (_) {}
  const R = window.__prof = { compiles:[],programs:[],phases:[],frames: [], events: {}, longtasks: [], loaf: [], barDoneAt: null, barVeilGoneAt: null };
  const rec = ts => { R.frames.push(ts); if (!R.events.introDone || ts - R.events.introDone < afterMs + 300) requestAnimationFrame(rec); };
  R.late = [];for(const C of [WebGLRenderingContext,WebGL2RenderingContext])for(const [method,field]of [['compileShader','compiles'],['createProgram','programs']]){const original=C.prototype[method];C.prototype[method]=function(...args){R[field].push(performance.now());if(!R.gpu){const ext=this.getExtension('WEBGL_debug_renderer_info');R.gpu=ext?this.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';}return original.apply(this,args)}};addEventListener('ug:opening-phase',e=>R.phases.push({at:performance.now(),detail:e.detail}));
  window.addEventListener('ug:late-layer', e => { R.late.push({ id: e.detail.id, state: e.detail.state, at: +performance.now().toFixed(0) }); });
  window.addEventListener('ug:late-layers-done', e => { R.events.lateDone = performance.now(); try { R.lateDetail = JSON.parse(JSON.stringify(e.detail)); } catch (_) {} });
  requestAnimationFrame(rec);
  window.addEventListener('ug:opening-reveal', e => {
    R.events.reveal = performance.now();
    try { R.revealDetail = JSON.parse(JSON.stringify(e.detail)); } catch (_) {}
  }, { once: true });
  window.addEventListener('ug:intro-done', () => { R.events.introDone = performance.now(); }, { once: true });
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) R.longtasks.push({ s: e.startTime, d: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) R.loaf.push({ s: e.startTime, d: e.duration, block: e.blockingDuration,
      render: e.renderStart, style: e.styleAndLayoutStart,
      scripts: e.scripts.map(s => ({ inv: s.invoker, t: s.invokerType, fn: s.sourceFunctionName, url: s.sourceURL, pos: s.sourceCharPosition, s: s.startTime, d: s.duration, fl: s.forcedStyleAndLayoutDuration })) }); })
      .observe({ type: 'long-animation-frame', buffered: true });
  } catch (_) {}
  const watch = () => {
    const el = document.getElementById('loadingBar');
    if (!el) return;
    const check = () => { if (!R.barDoneAt && el.classList.contains('done')) R.barDoneAt = performance.now(); };
    check();
    new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
};

async function boot(label, base, i) {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  try { return await bootIn(browser, label, base, i); } finally { await browser.close().catch(() => {}); } // s21:L: a failed boot used to leak its browser and hold the GPU lock
}
async function bootIn(browser, label, base, i) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: flags.dpr ? Number(flags.dpr) : 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (mbps) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: mbps * 1e6 / 8, uploadThroughput: 10e6 / 8 });
  if (flags.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(flags.cpu) });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', e => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp }));
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
  cdp.on('Network.loadingFailed', e => { const r = reqs.get(e.requestId); if (r) { r.failed = e.errorText; r.t1 = e.timestamp; } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e.message)); page.on('console', m=> {if(m.type()==='error') errors.push('console '+m.text())});
  if(flags.saved==='night')await page.addInitScript(()=>localStorage.setItem('ug:prefs:v2',JSON.stringify({clockHour:23})));await page.addInitScript(INIT, afterMs);
  const navT = Date.now();
  await page.goto(base.includes('?') ? base : `${base}/${query ? '?' + query : ''}`, { waitUntil: 'commit', timeout: 60000 });
  let timedOut = false;
  try {
    await page.waitForFunction((after) => window.__prof?.events.introDone && performance.now() - window.__prof.events.introDone > after, afterMs, { timeout: 280000, polling: 250 });
  } catch (e) { timedOut = true; }
  const r = await page.evaluate((afterMs) => {
    const R = window.__prof, nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map(e => ({ name: e.name.replace(location.origin, ''), s: +e.startTime.toFixed(0), e: +e.responseEnd.toFixed(0), tx: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize, type: e.initiatorType }));
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, +p.startTime.toFixed(0)]));
    // Frame gaps in windows: before reveal, during descent.
    const reveal = R.events.reveal ?? R.barDoneAt, done = R.events.introDone;
    const phaseAt=name=>R.phases.find(p=>p.detail.phase===name)?.at;
    const firstView=phaseAt('cover-lifted'),descent=phaseAt('descent-begin'),landed=phaseAt('landed')??done;
    const gapsIn = (a, b) => { const g = []; for (let i = 1; i < R.frames.length; i++) { const t = R.frames[i]; if (t > a && t <= b) g.push(t - R.frames[i - 1]); } return g; };
    const summ = g => { const s = g.slice().sort((x, y) => x - y); return s.length ? { n: s.length, worst: +s.at(-1).toFixed(3), p95: +s[Math.floor(s.length * .95)].toFixed(0), p50: +s[Math.floor(s.length / 2)].toFixed(1), over50: s.filter(x => x > 50).length, over100: s.filter(x => x > 100).length, sumOver50: +s.filter(x => x > 50).reduce((a, b) => a + b, 0).toFixed(0) } : null; };
    return {
      gpu:R.gpu,firstViewAt:firstView,descentBeginAt:descent,landedAt:landed,
      visiblePrograms:R.programs.filter(t=>t>=firstView&&t<=landed).length,
      visibleCompileShaderCalls:R.compiles.filter(t=>t>=firstView&&t<=landed).length,
      opening: window.__ugOpening ?? null, frames: R.frames,compiles:R.compiles,programs:R.programs,phases:R.phases,savedClock:localStorage.getItem('ug:prefs:v2'),
      nav: { responseEnd: +nav.responseEnd.toFixed(0), dcl: +nav.domContentLoadedEventEnd.toFixed(0), load: +nav.loadEventEnd.toFixed(0) },
      paint, firstRaf: R.frames.length ? +R.frames[0].toFixed(0) : null,
      revealAt: R.events.reveal != null ? +R.events.reveal.toFixed(0) : null,
      barDoneAt: R.barDoneAt != null ? +R.barDoneAt.toFixed(0) : null,
      introDoneAt: done != null ? +done.toFixed(0) : null,
      revealDetail: R.revealDetail ?? null,
      gapsPreReveal: summ(gapsIn(0, reveal ?? done ?? Infinity)),
      gapsDescent: descent != null && landed != null ? summ(gapsIn(descent, landed)) : null,
      gapsGateToLanding: reveal != null && done != null ? summ(gapsIn(reveal, done)) : null,
      gapsAfter: done != null ? summ(gapsIn(done, done + afterMs)) : null,
      bigGapsAfter: done != null ? (() => { const g = []; for (let i = 1; i < R.frames.length; i++) { const t = R.frames[i]; if (t > done && t <= done + afterMs && t - R.frames[i - 1] > 40) g.push({ at: +(t - done).toFixed(0), gap: +(t - R.frames[i - 1]).toFixed(0) }); } return g; })() : null,
      late: R.late, lateDetail: R.lateDetail ?? null, lateDoneAt: R.events.lateDone != null ? +R.events.lateDone.toFixed(0) : null,
      longtasks: R.longtasks, loaf: R.loaf.filter(l => l.d >= 100), res,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(0) : null,
    };
  }, afterMs);
  const list = [...reqs.values()];
  r.label = label; r.rep = i; r.base = base; r.timedOut = timedOut; r.errors = errors.slice(0, 8);
  r.netMB = +(list.reduce((a, x) => a + (x.bytes || 0), 0) / 1e6).toFixed(2);
  r.netRequests = list.length;
  r.netBig = list.filter(x => (x.bytes || 0) > 200e3).map(x => ({ url: x.url.replace(base, ''), MB: +(x.bytes / 1e6).toFixed(2), s: Math.round((x.t0 - list[0].t0) * 1000), e: x.t1 ? Math.round((x.t1 - list[0].t0) * 1000) : null }));
  r.machine = null; r.wallMs = Date.now() - navT;
  const lt = r.longtasks.reduce((a, x) => a + x.d, 0);
  console.log(`${label}#${i}: first view ${r.firstViewAt} landed ${r.landedAt} visible programs ${r.visiblePrograms} | descent gaps ${JSON.stringify(r.gapsDescent)} | longtask total ${lt.toFixed(0)}ms (${r.longtasks.length}) | ${r.netMB}MB ${r.netRequests} req | errors ${errors.length}${timedOut ? ' TIMEOUT' : ''}`);
  return r;
}

const results = [];
for (let i = 1; i <= reps; i++) {
  for (const t of targets) {
    const eq=t.indexOf('='); const label=t.slice(0,eq), base=t.slice(eq+1);
    try { results.push(await boot(label, base, i)); }
    catch (e) { console.log(`${label}#${i} FAILED ${e.message}`); results.push({ label, rep: i, failed: e.message }); }
    await writeFile(`${out}/results.json`, JSON.stringify({ flags, query, results }, null, 1));
  }
}
