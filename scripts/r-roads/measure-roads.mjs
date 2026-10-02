// R3 roads proof (sprint 02Oct26f, lane R): measurement and capture harness for the roads and buses proof.
// Run every command under /Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/ug-gpu.sh <label> ...
// (headless Chromium on ANGLE Metal, one GPU owner). Needs a DEV server (window.__ug), never production.
//
//   node scripts/r-roads/measure-roads.mjs measure <origin> [--setup weak|as-lived] [--cases "name=flags;name=flags"]
//        [--views overview,streetBank,...] [--settle 5] [--window 4] [--quality manual|auto] [--uncapped 0|1] [--out file.json]
//   node scripts/r-roads/measure-roads.mjs capture <origin> --flags "buses=real" --poses "name:view;name:{json}" --outdir <dir> [--setup as-lived]
//
// Cases are URL flag strings appended to ?fast=1&buildings=baked ("base" = none). The weak setup is the Studio protocol
// of measure-setups.mjs (DPR 1, CPU throttled 4x through CDP, 1440x900 CSS). Numbers taken while other agents share the
// machine are indicative; the load average is recorded in the JSON.
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { VIEWS as STD_VIEWS, SETUPS } from '../measure-setups.mjs';

const VIEWPORT = { width: 1440, height: 900 };
// Extra poses: canonical scene units (x east, y canonical height = real metres x 5, z south). Centre is Trafalgar Square.
export const VIEWS = {
  ...STD_VIEWS,
  city4km: { p: [0, 3200, 4200], t: [0, 0, 0] },       // about 700 m real height, looking down the Thames corridor at central London
  city1500: { p: [500, 1100, 1800], t: [0, 0, 0] },    // street-scale oblique over the centre
};

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  return { pos, opt };
}
async function launch(setup, uncapped) {
  const { chromium } = await import('@playwright/test');
  const S = SETUPS[setup]; if (!S) throw new Error(`unknown setup ${setup}`);
  const args = ['--use-gl=angle', '--use-angle=metal'];
  if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: S.dpr });
  const errors = [], warnings = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__ts = [];
    window.requestAnimationFrame = cb => raf(ts => { const s = performance.now(); cb(ts); if (cb.name === 'tick') window.__ts.push([ts, performance.now() - s]); });
  });
  return { browser, page, S, errors };
}
async function load(page, origin, flags, expectProof) {
  const t0 = Date.now();
  await page.goto(`${origin}/?fast=1&buildings=baked${flags ? '&' + flags : ''}`);
  await page.waitForFunction(() => window.__ug, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup && window.__ug.landmarkGroup?.children.length, null, { timeout: 300000 });
  if (expectProof) await page.waitForFunction(() => window.__ug.rRoads || window.__ug.rRoadsError, null, { timeout: 300000 });
  return Date.now() - t0;
}
const sceneInfo = () => {
  const u = window.__ug, T = window.__ugTHREE; const cam = u.camera; cam.updateMatrixWorld(); const fr = new T.Frustum(); fr.setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  let drawn = 0, tris = 0, inst = 0; const sph = new T.Sphere();
  u.scene.traverseVisible(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
    let p = o; while (p) { if (p.visible === false) return; p = p.parent; }
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    if (o.frustumCulled && !o.isInstancedMesh) { sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(sph)) return; }
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3; const n = o.isInstancedMesh ? o.count : 1;
    if (o.isInstancedMesh && !n) return; drawn++; tris += per * n; inst += o.isInstancedMesh ? n : 0;
  });
  return { drawCallsApprox: drawn, trianglesApprox: Math.round(tris), instances: inst };
};
async function measureView(page, name, pose, settleS, windowS, setup) {
  return await page.evaluate(async ({ pose, settleS, windowS }) => {
    const u = window.__ug, sleep = ms => new Promise(r => setTimeout(r, ms));
    u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
    await sleep(settleS * 1000); window.__ts.length = 0; await sleep(windowS * 1000);
    const rows = window.__ts.slice(1), iv = []; for (let i = 1; i < rows.length; i++) iv.push(rows[i][0] - rows[i - 1][0]);
    const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), sorted = [...iv].sort((a, b) => a - b);
    const r = u.rRoads?.userData.stats;
    return { fps: 1000 / mean(iv), intervalMs: mean(iv), intervalP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null, tickCpuMs: mean(rows.map(x => x[1])), frames: rows.length,
      quality: u.adaptiveQuality.get(), fleet: r ? { buses: r.buses, near: r.near, far: r.far, culled: r.culled, triangles: r.triangles, drawCalls: r.drawCalls, updateMs: +r.updateMs.toFixed(3), nearMs: +r.nearMs.toFixed(3) } : null };
  }, { pose, settleS, windowS }).then(async r => ({ ...r, scene: await page.evaluate(sceneInfo) }));
}
async function measure(origin, opt) {
  const setup = opt.setup ?? 'weak', settleS = +(opt.settle ?? 5), windowS = +(opt.window ?? 4), uncapped = (opt.uncapped ?? '0') === '1', qual = opt.quality ?? 'manual';
  const cases = (opt.cases ?? 'base').split(';').map(c => { const [n, ...f] = c.split('='); return { name: n, flags: f.join('=') }; });
  const views = (opt.views ?? 'overview,streetBank,riverGreenwich,city4km,city1500').split(',');
  const out = { tool: 'r-roads/measure-roads', when: new Date().toISOString(), origin, setup, quality: qual, uncapped, settleS, windowS, host: os.hostname(), cpuModel: os.cpus()[0]?.model, loadavgStart: os.loadavg().map(x => +x.toFixed(2)), cases: {} };
  for (const c of cases) {
    const { browser, page, S, errors } = await launch(setup, uncapped);
    try {
      const loadMs = await load(page, origin, c.flags, /roads=|buses=/.test(c.flags));
      const info = await page.evaluate(q => { const u = window.__ug; u.controls.enableDamping = false; u.setRenderQualityMode(q); const gl = u.composer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, dpr: devicePixelRatio, build: u.rRoads?.userData.stats.buildMs ?? null, ribbons: u.rRoads?.userData.stats.ribbons ?? null, rRoadsError: u.rRoadsError, buses: u.rRoads?.userData.stats.buses ?? 0, paths: u.rRoads?.userData.stats.busPaths ?? 0, shortfall: u.rRoads?.userData.stats.syntheticShortfall ?? null }; }, qual);
      if (S.cpuThrottle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle }); }
      const res = {};
      for (const v of views) { if (!VIEWS[v]) { res[v] = { error: 'unknown view' }; continue; } res[v] = await measureView(page, v, VIEWS[v], settleS, windowS, setup);
        const x = res[v]; console.log(`${c.name.padEnd(22)} ${setup} ${v.padEnd(15)} ${x.fps.toFixed(1)}fps  interval ${x.intervalMs.toFixed(1)}ms  tick ${x.tickCpuMs.toFixed(2)}ms  calls~${x.scene.drawCallsApprox} tris~${(x.scene.trianglesApprox / 1e6).toFixed(2)}M` + (x.fleet ? `  near ${x.fleet.near} far ${x.fleet.far} culled ${x.fleet.culled} pass ${x.fleet.updateMs}ms` : '')); }
      out.cases[c.name] = { flags: c.flags, loadMs, info, errors, views: res };
    } finally { await browser.close(); }
  }
  out.loadavgEnd = os.loadavg().map(x => +x.toFixed(2));
  if (opt.out) { await writeFile(opt.out, JSON.stringify(out, null, 1)); console.log('wrote', opt.out); }
}
async function capture(origin, opt) {
  const setup = opt.setup ?? 'as-lived', outdir = opt.outdir; await mkdir(outdir, { recursive: true });
  const { browser, page, errors } = await launch(setup, false);
  try {
    await load(page, origin, opt.flags ?? '', /roads=|buses=/.test(opt.flags ?? ''));
    await page.evaluate(() => { const u = window.__ug; u.controls.enableDamping = false; u.setRenderQualityMode('manual'); });
    for (const spec of (opt.poses ?? '').split(';').filter(Boolean)) {
      const [name, json] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
      const pose = json.startsWith('{') ? JSON.parse(json) : VIEWS[json];
      const info = await page.evaluate(async ({ pose, settle }) => {
        const u = window.__ug, sleep = ms => new Promise(r => setTimeout(r, ms));
        let p = pose;
        if (pose.follow !== undefined || pose.among) { // camera behind and above a bus, looking along its heading
          let fi = pose.follow;
          if (fi === undefined) { // first bus in [lo,hi] whose position satisfies minX/maxX (buses are numbered 25 first, then 73)
            for (let i = pose.among[0]; i <= pose.among[1] && fi === undefined; i++) { const q = u.rRoads.userData.busAt(i); if ((pose.minX === undefined || q.x >= pose.minX) && (pose.maxX === undefined || q.x <= pose.maxX)) fi = i; }
            if (fi === undefined) fi = pose.among[0];
          }
          const b = u.rRoads.userData.busAt(fi);
          p = { p: [b.x - b.dx * pose.back + (pose.side || 0) * b.dz, b.y + pose.up, b.z - b.dz * pose.back - (pose.side || 0) * b.dx], t: [b.x + b.dx * 30, b.y + (pose.lookUp ?? 8), b.z + b.dz * 30] };
        } else if (pose.densest) { // over the 1.5 km cell holding the most buses
          const R = u.rRoads.userData, N = R.N, C = 1500, cnt = new Map(); let best = null;
          for (let i = 0; i < N; i++) { const b = R.busAt(i), k = Math.floor(b.x / C) + ',' + Math.floor(b.z / C), v = (cnt.get(k) || 0) + 1; cnt.set(k, v); if (!best || v > best.v) best = { v, x: (Math.floor(b.x / C) + .5) * C, z: (Math.floor(b.z / C) + .5) * C }; }
          p = { p: [best.x, pose.up, best.z + pose.back], t: [best.x, 0, best.z], densest: best };
        } else if (pose.route) { const rp = u.rRoads.userData.routePoint(pose.route, pose.d), ahead = u.rRoads.userData.routePoint(pose.route, pose.d + 40);
          const hx = rp.dx, hz = rp.dz; // camera behind and above the route point, looking at it
          p = { p: [rp.x - hx * pose.back + (pose.side || 0) * hz, rp.y + pose.up, rp.z - hz * pose.back - (pose.side || 0) * hx], t: [ahead.x, ahead.y + (pose.lookUp || 0), ahead.z] }; }
        u.camera.position.fromArray(p.p); u.controls.target.fromArray(p.t); u.controls.update();
        await sleep(settle * 1000);
        const r = u.rRoads?.userData.stats; return { pose: p, fleet: r ? { buses: r.buses, near: r.near, far: r.far } : null };
      }, { pose, settle: +(opt.settle ?? 5) });
      await page.screenshot({ path: `${outdir}/${name}.png` });
      console.log(name, JSON.stringify(info));
    }
    console.log('errors', errors.length, errors.slice(0, 3));
  } finally { await browser.close(); }
}
const [cmd, origin, ...rest] = process.argv.slice(2);
const { opt } = parse(rest);
if (cmd === 'measure') await measure(origin, opt); else if (cmd === 'capture') await capture(origin, opt); else console.log('usage: measure|capture <origin> ...');
