// Two-setup measurement harness (sprint 25Sep26f, D-039, Lane H). Every lane
// and the integrator measure with this; grown from the step-0 perf.mjs.
//
// THE TWO SETUPS (Jordan's protocol, 25Sep26f)
//   as-lived  Apple M5 with Jordan's normal apps left open (Eagle, Resolve,
//             Chrome). Headless Chromium on ANGLE Metal (real GPU), 1440x900
//             CSS at DPR 2, vsync-paced, Automatic quality.
//   weak      The same page at DPR 1 with the CPU throttled 4x through CDP
//             (Emulation.setCPUThrottlingRate). Pass bar: Automatic holds at
//             least 30 fps at the five standard views. GPU throttling is not
//             possible on the M5, so this mainly catches processor cost.
//
// VIEWS: the five standard views (overview, streetBank, riverGreenwich,
// m25Edge, heathrow) plus 'arrival': Automatic pushed to level 3 or deeper at
// street by synthetic GPU-bound frames on a held render loop, then flown to
// the river at Greenwich (does it climb back to shadows?). Since D-040 the
// trace also records whether Automatic has thinned the clouds (6th column).
//
// Per view it records: the settled rung (most frequent level over the last 8s),
// fps over a 2.5s live window after the settle, rung changes in the last 8s,
// time to first shadows, and the full 250ms trace [ms, level, scale, samples, shadows].
//
// USAGE (run from a checkout with node_modules; needs a DEV server: window.__ug
// is stripped from production builds, so point it at `npx vite`, never at
// under-ground.pages.dev):
//
//   node scripts/measure-setups.mjs run <as-lived|weak|both> <origin> [options]
//       --label <text>      name recorded in the JSON (default: the origin)
//       --out <file.json>   write results (default: stdout summary only)
//       --views a,b,c       subset of views (default: all six)
//       --settle <s>        settle/trace seconds per view (default 24)
//       --arrival-s <s>     trace seconds for the arrival case (default: --settle)
//   node scripts/measure-setups.mjs compare <before-origin> <after-origin> [options]
//       Measures both origins on each setup (order alternates per round to
//       cancel drift) and prints before/after per view.
//       --setup <as-lived|weak|both>  (default both)   --rounds <n> (default 1)
//       --out <dir>         also write one JSON per run into this directory
//       --views, --settle, --arrival-s as above
//   node scripts/measure-setups.mjs compare --files <before.json> <after.json>
//       Prints the same table from two saved runs (same setup).
//
// Examples:
//   node scripts/measure-setups.mjs run both http://localhost:5208 --label s25-H --out /tmp/h.json
//   node scripts/measure-setups.mjs run weak http://localhost:5208 --views arrival --arrival-s 60
//   node scripts/measure-setups.mjs compare http://localhost:5173 http://localhost:5208 --setup weak
//
// Numbers taken while other agents share the GPU are indicative only; the
// integrator measures serially with the GPU idle. The JSON records the load
// average and the busiest processes so a reader can see what "as lived" was.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const VIEWS = {
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  streetBank: { p: [2952.9, 337.8, -732.9], t: [1910.1, 196.2, -783.7] },
  riverGreenwich: { p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
  m25Edge: { p: [4910.7, 634.3, -18445.1], t: [6239.5, 102.8, -20483.9] },
  heathrow: { p: [-19493.3, 1606.7, 4622.3], t: [-22570.2, 120, 4688.2] },
  arrival: null, // street, pushed several rungs down, then flown to riverGreenwich
};
export const SETUPS = {
  'as-lived': { dpr: 2, cpuThrottle: 1 },
  weak: { dpr: 1, cpuThrottle: 4 },
};
export const WEAK_FPS_BAR = 30;
const VIEWPORT = { width: 1440, height: 900 };

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'files') { opt.files = [argv[++i], argv[++i]]; continue; }
      opt[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opt };
}

/** Reduce a 250ms trace to the settled rung, its label and changes over the last 8s. */
export function summariseTrace(trace, tailSamples = 32) {
  const tail = trace.slice(-tailSamples);
  const counts = {}, levels = {};
  for (const r of tail) {
    const k = `${r[2]}/${r[3]}x/${r[4] ? 'shadows' : 'noshadows'}${r[5] ? '/thinclouds' : ''}`;
    counts[k] = (counts[k] || 0) + 1; levels[r[1]] = (levels[r[1]] || 0) + 1;
  }
  const settled = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const level = Number(Object.entries(levels).sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN);
  let changes = 0; for (let i = 1; i < tail.length; i++) if (tail[i][1] !== tail[i - 1][1]) changes++;
  const firstShadowsMs = trace.find(r => r[4] === 1)?.[0] ?? null;
  return { settled, level, changesLast8s: changes, levelsLast8s: counts, firstShadowsMs };
}

function fmtView(v) {
  if (!v) return '-';
  if (v.error) return `error: ${v.error}`;
  return `L${v.level} ${v.settled} ${v.fps.toFixed(1)}fps ch${v.changesLast8s}`;
}
/** Before/after table for two runs of the same setup. */
export function compareRuns(before, after) {
  const names = [...new Set([...Object.keys(before.views || {}), ...Object.keys(after.views || {})])];
  const rows = names.map(name => {
    const b = before.views[name], a = after.views[name];
    const dfps = b?.fps != null && a?.fps != null ? a.fps - b.fps : null;
    return { view: name, before: fmtView(b), after: fmtView(a), dfps,
      weakPass: before.setup === 'weak' ? { before: b?.fps >= WEAK_FPS_BAR, after: a?.fps >= WEAK_FPS_BAR } : undefined };
  });
  const w = [16, 38, 38];
  const line = (c) => c.map((x, i) => String(x).padEnd(w[i] ?? 10)).join(' ');
  const out = [`setup ${before.setup}: ${before.label} -> ${after.label}`, line(['view', 'before', 'after', 'dfps'])];
  for (const r of rows) {
    const pass = r.weakPass ? `  >=${WEAK_FPS_BAR}fps: ${r.weakPass.before ? 'yes' : 'NO'} -> ${r.weakPass.after ? 'yes' : 'NO'}` : '';
    out.push(line([r.view, r.before, r.after, r.dfps == null ? '-' : (r.dfps >= 0 ? '+' : '') + r.dfps.toFixed(1)]) + pass);
  }
  return { rows, text: out.join('\n') };
}

function machineNote() {
  let busiest = [];
  try {
    busiest = execSync('ps -Ao pcpu=,comm= -r', { encoding: 'utf8' }).trim().split('\n').slice(0, 6)
      .map(l => { const m = l.trim().match(/^([\d.]+)\s+(.*)$/); return m ? { cpu: +m[1], proc: m[2].split('/').pop() } : null; }).filter(Boolean);
  } catch { /* ps unavailable */ }
  return { host: os.hostname(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, loadavg: os.loadavg().map(x => +x.toFixed(2)), busiest };
}

/** Measure one setup on one origin. */
export async function measure({ setup, origin, label = origin, views = Object.keys(VIEWS), settleS = 24, arrivalS = settleS }) {
  const { chromium } = await import('@playwright/test');
  const S = SETUPS[setup]; if (!S) throw new Error(`unknown setup ${setup}`);
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  const machineBefore = machineNote();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: S.dpr });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__ts = []; window.__paused = false; const held = [];
      window.requestAnimationFrame = cb => {
        if (window.__paused && cb.name === 'tick') { held.push(cb); return 0; }
        return raf(ts => { const s = performance.now(); cb(ts); if (cb.name === 'tick') window.__ts.push([ts, performance.now() - s]); });
      };
      window.__resume = () => { window.__paused = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
    });
    const t0 = Date.now();
    await page.goto(`${origin}/?fast=1&buildings=baked`);
    try {
      await page.waitForFunction(() => window.__ug, null, { timeout: 60000 });
    } catch {
      throw new Error(`${origin} exposes no window.__ug: production builds strip it; measure a dev server`);
    }
    await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
      && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup && window.__ug.landmarkGroup?.children.length, null, { timeout: 240000 });
    const loadMs = Date.now() - t0;
    const info = await page.evaluate(() => {
      const u = window.__ug; u.controls.enableDamping = false; u.setRenderQualityMode('auto');
      const gl = u.composer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, dpr: devicePixelRatio };
    });
    if (S.cpuThrottle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle }); }
    // Warm-up: visit every standard view once so programs and uploads are settled.
    for (const [name, v] of Object.entries(VIEWS)) {
      if (!v || !views.some(x => x === name || (x === 'arrival' && (name === 'streetBank' || name === 'riverGreenwich')))) continue;
      await page.evaluate(pose => { const u = window.__ug; u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update(); }, v);
      await page.waitForTimeout(1500);
    }
    const results = {};
    for (const name of views) {
      if (!(name in VIEWS)) { results[name] = { error: 'unknown view' }; continue; }
      const arrival = VIEWS[name] === null, pose = VIEWS[name] ?? VIEWS.riverGreenwich;
      const ticks = Math.round((arrival ? arrivalS : settleS) * 4);
      const r = await page.evaluate(async ({ pose, arrival, street, ticks }) => {
        const u = window.__ug, sleep = ms => new Promise(res => setTimeout(res, ms));
        let arrivedAt = null;
        if (arrival) {
          u.camera.position.fromArray(street.p); u.controls.target.fromArray(street.t); u.controls.update();
          await sleep(1500);
          // Hold the render loop; feed Automatic GPU-bound frames whose cost follows
          // resolution (as the node tests' model({cpu:6,gpu:24})) until 85% or deeper (level 4
          // since D-040 added the thinned-clouds rung; level 3 before),
          // then realign the controller's clock to real time and fly to the river.
          window.__paused = true; await sleep(100);
          const E = { 4: 1, 2: 0.8, 0: 0.62 }; let t = performance.now();
          for (let i = 0; i < 4000 && u.adaptiveQuality.get().scale > 0.85; i++) {
            const q = u.adaptiveQuality.get(); const ms = Math.max(6, 24 * q.scale * q.scale * E[q.samples] + (q.shadows ? 2 : 0));
            t += ms; u.adaptiveQuality.update(ms, t);
          }
          arrivedAt = u.adaptiveQuality.get().level;
          u.adaptiveQuality.reset(performance.now()); window.__resume();
        }
        u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
        const trace = [];
        for (let i = 0; i < ticks; i++) { await sleep(250); const q = u.adaptiveQuality.get(); trace.push([i * 250, q.level, q.scale, q.samples, q.shadows ? 1 : 0, q.clouds === 'thin' ? 1 : 0]); }
        window.__ts.length = 0; await sleep(2500);
        const rows = window.__ts.slice(1), iv = [];
        for (let i = 1; i < rows.length; i++) iv.push(rows[i][0] - rows[i - 1][0]);
        const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        const sorted = [...iv].sort((a, b) => a - b);
        return { interval: mean(iv), intervalP95: sorted[Math.floor(sorted.length * 0.95)] ?? null, cpuMs: mean(rows.map(x => x[1])),
          frames: rows.length, arrivedAt, trace,
          calls: u.composer.renderer.info.render.calls };
      }, { pose, arrival, street: VIEWS.streetBank, ticks });
      const s = summariseTrace(r.trace);
      results[name] = { ...s, fps: 1000 / r.interval, interval: r.interval, intervalP95: r.intervalP95, cpuMs: r.cpuMs, frames: r.frames, calls: r.calls,
        ...(arrival ? { arrivedAt: r.arrivedAt } : {}),
        ...(setup === 'weak' ? { pass30: 1000 / r.interval >= WEAK_FPS_BAR } : {}), trace: r.trace };
      const v = results[name];
      console.log(`${label} ${setup} ${name.padEnd(15)} L${v.level} ${v.settled} ${v.fps.toFixed(1)}fps changes ${v.changesLast8s}` +
        (arrival ? ` arrivedAt L${v.arrivedAt} firstShadows ${v.firstShadowsMs ?? '-'}ms` : '') + (setup === 'weak' ? (v.pass30 ? '  >=30 ok' : '  BELOW 30') : ''));
    }
    return { tool: 'measure-setups', version: 1, setup, label, origin, when: new Date().toISOString(), viewport: VIEWPORT,
      dpr: S.dpr, cpuThrottle: S.cpuThrottle, settleS, arrivalS, loadMs, info, machine: { before: machineBefore, after: machineNote() }, errors, views: results };
  } finally { await browser.close(); }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const views = opt.views ? opt.views.split(',') : Object.keys(VIEWS);
  const settleS = +(opt.settle ?? process.env.TRACE_S ?? 24), arrivalS = +(opt['arrival-s'] ?? settleS);
  const setupsOf = s => (s === 'both' ? ['as-lived', 'weak'] : [s]);
  if (cmd === 'run') {
    const [setup, origin] = pos;
    if (!setup || !origin) throw new Error('usage: run <as-lived|weak|both> <origin> [--label] [--out] [--views] [--settle] [--arrival-s]');
    const runs = [];
    for (const s of setupsOf(setup)) runs.push(await measure({ setup: s, origin, label: opt.label ?? origin, views, settleS, arrivalS }));
    if (opt.out) await writeFile(opt.out, JSON.stringify(runs.length === 1 ? runs[0] : { runs }, null, 1));
    return;
  }
  if (cmd === 'compare') {
    if (opt.files) {
      const [b, a] = await Promise.all(opt.files.map(async f => JSON.parse(await readFile(f, 'utf8'))));
      const list = x => (x.runs ?? [x]);
      for (const rb of list(b)) { const ra = list(a).find(r => r.setup === rb.setup); if (ra) console.log(compareRuns(rb, ra).text + '\n'); }
      return;
    }
    const [before, after] = pos;
    if (!before || !after) throw new Error('usage: compare <before-origin> <after-origin> [--setup] [--rounds] [--out]  |  compare --files <before.json> <after.json>');
    if (opt.out) await mkdir(opt.out, { recursive: true });
    const rounds = +(opt.rounds ?? 1);
    for (const s of setupsOf(opt.setup ?? 'both')) {
      for (let k = 0; k < rounds; k++) {
        const order = k % 2 === 0 ? [['before', before], ['after', after]] : [['after', after], ['before', before]];
        const got = {};
        for (const [tag, origin] of order) {
          got[tag] = await measure({ setup: s, origin, label: `${tag}:${origin}`, views, settleS, arrivalS });
          if (opt.out) await writeFile(`${opt.out}/${s}-${tag}-r${k + 1}.json`, JSON.stringify(got[tag], null, 1));
        }
        console.log('\n' + compareRuns(got.before, got.after).text + `  (round ${k + 1})\n`);
      }
    }
    return;
  }
  console.log('usage: see the header of scripts/measure-setups.mjs');
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}
