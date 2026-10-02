// capture-overground-walk.mjs: the captures of the Pedestrian walk on the Overground (sprint 02Oct26f, lane O).
//
//   node scripts/capture-overground-walk.mjs <devUrl> <outDir> [--before <e0675d7DevUrl>] [--only a,b,c]
//
// Every GPU command goes through the sprint's lock (ug-gpu.sh), headless with the ANGLE Metal flags.
// Writes PNGs and o-weak-200.json into <outDir>, and a poses.json beside them (file, pose, what it shows)
// that captures.md is made from.
//   weaver     o-weaver-deck-hackney-downs.png (+ -before.png from e0675d7 in orbit view when --before is given)
//   flare      o-rotherhithe-flare.png
//   card       o-card-highbury.png
//   pass       o-overground-pass.png
//   barking    o-barking-riverside.png
//   weak       o-weak-200.png and o-weak-200.json (4x CPU throttle, DPR 1, Automatic quality; Lioness at 200 m/s for 20 s)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [base, out] = pos;
const before = flag('--before');
const only = (flag('--only') || 'weaver,flare,card,pass,barking,weak').split(',');
fs.mkdirSync(out, { recursive: true });
const poses = JSON.parse(fs.existsSync(path.join(out, 'poses.json')) ? fs.readFileSync(path.join(out, 'poses.json'), 'utf8') : '{}');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });

async function open(url, { throttle = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 200)));
  await page.goto(`${url}/?skip=1&buildings=baked&mh=1.1`);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.modes.ctx.tubeRoutes?.size > 11
      && window.__ug.surfaceRail && window.__ug.surfaceTrains;
  }, null, { timeout: 180000 });
  await page.evaluate(() => {
    // Freeze and thaw the frame loop, so a frame can be photographed where it was drawn.
    const orig = window.requestAnimationFrame.bind(window);
    window.__raf = orig;
    window.__freeze = () => { window.__held = []; window.requestAnimationFrame = (cb) => { window.__held.push(cb); return 0; }; };
    window.__thaw = () => { window.requestAnimationFrame = orig; const h = window.__held || []; window.__held = []; for (const cb of h) orig(cb); };
    window.__frame = () => new Promise((r) => orig(r));
  });
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  return { page, errs };
}
const enterPedestrian = async (page) => {
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
  await page.waitForFunction(() => Object.values(window.__ug.modes.registry.get('pedestrian').openAirReport().lines).every(v => !v.paths || v.mapped === v.paths), null, { timeout: 60000 });
};
const snap = async (page, file, why) => {
  await page.evaluate(() => window.__freeze());
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, file) });
  await page.evaluate(() => window.__thaw());
  console.log('wrote', file, why || '');
};
/**
 * Place the walker at rest at the stop of `lineId` named `from`, facing toward `toward` (the next expected station): the path and
 * sense are the ones whose heading there has the best positive dot product with the plan direction to that station's entrance.
 */
const placeAt = (page, lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
  const m = window.__ug.modes.registry.get('pedestrian');
  const net = m.rebuildNetwork();
  m.openAir.ensureLine(net, lineId);
  const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '').replace(/ Station$/, '');
  const target = net.entrances.filter(en => en.names.includes(toward) && en.stops.some(x => x.lineId === lineId));
  let best = null;
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    for (const { s, stop } of p.stops) {
      if (clean(stop.name) !== from) continue;
      for (const dir of [1, -1]) {
        if (dir > 0 ? s >= p.length - 1e-6 : s <= 1e-6) continue;
        const h = m.openAir.headingOf(p, s, dir), q = m.openAir.present(p, s, 0, {});
        for (const en of target) {
          const l = Math.hypot(en.x - q.x, en.z - q.z) || 1, dot = (h.x * (en.x - q.x) + h.z * (en.z - q.z)) / l;
          if (!best || dot > best.dot) best = { path: p.id, s, dir, dot };
        }
      }
    }
  }
  if (!best || best.dot <= 0) return null;
  m.placeInTunnel({ path: best.path, s: best.s, dir: best.dir });
  return { path: best.path, s: best.s, dir: best.dir };
}, [lineId, from, toward]);

const poseOf = (page) => page.evaluate(() => {
  const ug = window.__ug, d = ug.modes.registry.get('pedestrian').debug(), c = ug.camera.position;
  const f = new ug.camera.position.constructor(); ug.camera.getWorldDirection(f);
  return { master: +(document.getElementById('masterHeight')?.value ?? NaN), ratio: ug.surfaceTrains.ratio, lineId: d.tunnel?.lineId ?? null, path: d.tunnel?.path ?? null,
    s: d.tunnel?.s != null ? +d.tunnel.s.toFixed(1) : null, regime: d.regime,
    camera: [c.x, c.y, c.z].map(v => +v.toFixed(1)), lookAt: [c.x + f.x * 100, c.y + f.y * 100, c.z + f.z * 100].map(v => +v.toFixed(1)) };
});

if (only.includes('weaver')) {
  const { page, errs } = await open(base);
  await enterPedestrian(page);
  // The Weaver deck 300 m south of Hackney Downs (larger scene z), facing north, at rest.
  const at = await page.evaluate(() => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork(), oa = m.openAir;
    oa.ensureLine(net, 'og:weaver');
    const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '');
    let best = null;
    for (const p of net.paths) {
      if (p.lineId !== 'og:weaver') continue;
      const st = p.stops.find(x => clean(x.stop.name) === 'Hackney Downs');
      if (!st) continue;
      for (const sg of [1, -1]) {
        const s = st.s + sg * 300;
        if (s < 0 || s > p.length) continue;
        const q = oa.present(p, s, 0, {});
        const h0 = oa.present(p, st.s, 0, {});
        if (!q.open || q.bridged) continue;
        if (q.z > h0.z && (!best || q.z > best.z)) best = { path: p.id, s, z: q.z, dir: sg > 0 ? -1 : 1 };   // walk back toward Hackney Downs: north
      }
    }
    if (!best) return null;
    m.placeInTunnel({ path: best.path, s: best.s, dir: best.dir });
    return best;
  });
  if (!at) throw new Error('no Weaver deck found');
  await page.evaluate(async () => { for (let i = 0; i < 20; i++) await window.__frame(); });
  const pose = await poseOf(page);
  await snap(page, 'o-weaver-deck-hackney-downs.png', JSON.stringify(pose));
  poses['o-weaver-deck-hackney-downs.png'] = { ...pose, what: 'The Weaver viaduct deck 300 m south of Hackney Downs, facing north along the track, at rest, in the walker\'s lane.' };
  const cls = await page.evaluate(([x, z]) => {
    let best = { d: Infinity };
    for (const P of window.__ug.overground.userData.linePaths.get('weaver').filter(Boolean)) for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; let t = L2 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0; t = Math.min(1, Math.max(0, t)); const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)); if (d < best.d) best = { d, cls: t < .5 ? a.cls : b.cls }; }
    return best;
  }, [pose.camera[0], pose.camera[2]]);
  poses['o-weaver-deck-hackney-downs.png'].track = cls;
  fs.writeFileSync(path.join(out, 'weaver-pose.json'), JSON.stringify({ pose, at }));
  console.log('weaver errors', errs.length);
  await page.close();
}
if (only.includes('weaver') && before && fs.existsSync(path.join(out, 'weaver-pose.json'))) {
  const { pose } = JSON.parse(fs.readFileSync(path.join(out, 'weaver-pose.json'), 'utf8'));
  const { page } = await open(before);
  await page.evaluate(([cam, look]) => {
    const ug = window.__ug;
    ug.camera.position.set(cam[0], cam[1], cam[2]);
    ug.controls.target.set(look[0], look[1], look[2]);
    ug.controls.update();
    ug.camera.updateMatrixWorld(true);
  }, [pose.camera, pose.lookAt]);
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) await window.__frame(); });
  await snap(page, 'o-weaver-deck-hackney-downs-before.png', 'e0675d7 orbit view');
  poses['o-weaver-deck-hackney-downs-before.png'] = { camera: pose.camera, lookAt: pose.lookAt, master: 1.1, what: 'e0675d7 in orbit view: the same camera position, controls.target 100 m ahead along the track (the Overground is only a drawn corridor there, with no walk).' };
  await page.close();
}

if (only.includes('flare') || only.includes('card') || only.includes('pass') || only.includes('barking')) {
  const { page, errs } = await open(base);
  await enterPedestrian(page);

  if (only.includes('card')) {
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = window.__frame;
      const net = m.rebuildNetwork();
      const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '');
      for (const p of net.paths) {
        if (p.lineId !== 'victoria') continue;
        const st = p.stops.find(x => clean(x.stop.name) === 'Highbury & Islington');
        if (!st) continue;
        m.placeInTunnel({ path: p.id, s: st.s, dir: 1 });
        for (let i = 0; i < 3; i++) await frame();
        m.press('use');
        for (let i = 0; i < 30; i++) { await frame(); if (m.debug().card?.kind === 'arrival') break; }
        for (let i = 0; i < 10; i++) await frame();
        return { rows: m.chooser.rows.map(x => x.label) };
      }
      return null;
    });
    const pose = await poseOf(page);
    await snap(page, 'o-card-highbury.png', JSON.stringify(r));
    poses['o-card-highbury.png'] = { ...pose, rows: r?.rows, what: 'The arrival card at Highbury & Islington, Victoria line platform: Up to the street, and the changes to the Mildmay (two rows) and the Windrush, each with TfL\'s towards text.' };
    await page.keyboard.press('Escape');
  }

  if (only.includes('flare')) {
    await placeAt(page, 'og:windrush', 'Wapping', 'Rotherhithe');
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = window.__frame;
      const c0 = m.debug().clock;
      ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
      let rot = false;
      const t0 = performance.now();
      while (performance.now() - t0 < 60000) {
        await frame();
        const d = m.debug();
        if (d.arrivals.some(a => a.at > c0 && a.name === 'Rotherhithe')) rot = true;
        if (rot && d.regime === 'open' && d.openAir.cut?.kind === 'flare') break;
      }
      ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
      return { rot, cut: m.debug().openAir.cut };
    });
    const pose = await poseOf(page);
    await snap(page, 'o-rotherhithe-flare.png', JSON.stringify(r));
    poses['o-rotherhithe-flare.png'] = { ...pose, cut: r.cut, what: 'The first frames of the daylight flare as the walk leaves the Thames Tunnel bore south of Rotherhithe (Windrush, Wapping to Rotherhithe to Canada Water, walking at 200 m/s).' };
  }

  if (only.includes('pass')) {
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = window.__frame;
      const net = m.rebuildNetwork(), oa = m.openAir;
      for (const lineId of ['og:windrush', 'og:lioness', 'og:suffragette']) {
        oa.ensureLine(net, lineId);
        const fleet = ug.overground.userData.fleets.find(f => f.name === `overground-trains-${lineId.slice(3)}`);
        for (const t of fleet.userData.trains) {
          const x0 = t.position.x, z0 = t.position.z;
          await frame(); await frame();
          const mx = t.position.x - x0, mz = t.position.z - z0;
          if (Math.hypot(mx, mz) < 0.01) continue;
          let best = null;
          for (const p of net.paths) {
            if (p.lineId !== lineId) continue;
            for (let s = 0; s <= p.length; s += 20) { const q = oa.present(p, s, 0, {}); if (!q.open) continue; const d = Math.hypot(q.x - t.position.x, q.z - t.position.z); if (!best || d < best.d) best = { d, s, path: p, hx: q.hx, hz: q.hz }; }
          }
          if (!best || best.d > 15) continue;
          const dir = (mx * best.hx + mz * best.hz) > 0 ? 1 : -1;
          const s0 = best.s + dir * 500, p = best.path;
          if (s0 < 0 || s0 > p.length) continue;
          let ok = true;
          for (let s = Math.min(s0, best.s); s <= Math.max(s0, best.s); s += 20) if (!oa.isOpen(p, s)) { ok = false; break; }
          if (!ok) continue;
          m.placeInTunnel({ path: p.id, s: s0, dir: -dir, side: dir });
          await frame(); await frame();
          ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
          const t0 = performance.now();
          let hit = false;
          while (performance.now() - t0 < 12000) { await frame(); if (m.debug().lastPass?.inside) { hit = true; break; } }
          ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
          return { lineId, hit, rumble: m.debug().lastPass?.rumble };
        }
      }
      return null;
    });
    const pose = await poseOf(page);
    await snap(page, 'o-overground-pass.png', JSON.stringify(r));
    poses['o-overground-pass.png'] = { ...pose, pass: r, what: 'The walker inside an Overground train passing through it in the open (lastPass.inside), walking at 200 m/s towards it in its lane.' };
  }

  if (only.includes('barking')) {
    await placeAt(page, 'og:suffragette', 'Woodgrange Park', 'Barking');
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = window.__frame;
      const c0 = m.debug().clock;
      ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
      let got = null;
      const t0 = performance.now();
      while (performance.now() - t0 < 80000) {
        await frame();
        const d = m.debug();
        const a = d.arrivals.filter(x => x.at > c0 && x.name === 'Barking Riverside')[0];
        if (a) { got = a; break; }
        if (d.tunnel?.speed === 0 && d.arrivals.some(x => x.at > c0 && x.name === 'Barking')) { /* keep W held: the line goes on */ }
      }
      ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
      return { got };
    });
    // The banner is on screen at the arrival; photograph it at once.
    const pose = await poseOf(page);
    await snap(page, 'o-barking-riverside.png', JSON.stringify(r));
    poses['o-barking-riverside.png'] = { ...pose, arrival: r.got, what: 'Arrival at Barking Riverside, the end of the Suffragette, walking at 200 m/s: the arrival banner over the open-air view.' };
  }
  console.log('errors', errs.length, errs.slice(0, 3));
  await page.close();
}

if (only.includes('weak')) {
  const { page, errs } = await open(base, { throttle: 4 });
  await enterPedestrian(page);
  await placeAt(page, 'og:lioness', 'Kensal Green', 'Willesden Junction');
  const frames = [];
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const ts = [], regimes = [];
    ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
    const t0 = performance.now();
    let last = null;
    while (performance.now() - t0 < 20000) {
      const t = await new Promise((res) => window.__raf(res));
      ts.push(t);
      if ((ts.length % 10) === 0) regimes.push(m.debug().regime);
    }
    ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
    return { ts, regimes, end: m.debug().tunnel, arrivals: m.debug().arrivals.slice(-6).map(a => a.name), quality: window.__ug.renderQualityMode };
  });
  const dts = r.ts.slice(1).map((t, i) => t - r.ts[i]);
  const secs = (r.ts.at(-1) - r.ts[0]) / 1000;
  const sorted = dts.slice().sort((a, b) => a - b);
  const summary = { frames: r.ts.length, seconds: +secs.toFixed(2), meanFps: +((r.ts.length - 1) / secs).toFixed(2), p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    medianFrameMs: +sorted[sorted.length >> 1].toFixed(2), maxFrameMs: +sorted.at(-1).toFixed(1), throttle: 4, dpr: 1, viewport: '1440x900', quality: r.quality,
    line: 'og:lioness', from: 'Kensal Green', toward: 'Willesden Junction, Harlesden... Harrow & Wealdstone', arrivals: r.arrivals, regimeShare: Object.fromEntries([...new Set(r.regimes)].map(k => [k, r.regimes.filter(x => x === k).length])) };
  fs.writeFileSync(path.join(out, 'o-weak-200.json'), JSON.stringify({ summary, frameTimesMs: dts.map(x => +x.toFixed(2)) }));
  console.log('weak', JSON.stringify(summary));
  await page.keyboard.press('Escape');
  await snap(page, 'o-weak-200.png', JSON.stringify(summary));
  poses['o-weak-200.png'] = { ...(await poseOf(page)), summary, what: 'A frame at the end of the weak-setup ride: 4x CPU throttle, DPR 1, Automatic quality, Lioness at 200 m/s for 20 s from Kensal Green.' };
  console.log('errors', errs.length);
  await page.close();
}

fs.writeFileSync(path.join(out, 'poses.json'), JSON.stringify(poses, null, 2));
await browser.close();
