// cross-lane-walks-s02.spec.js: the integration of sprint 02Oct26f (lanes F, T, O, B), in the real app.
//
// Each lane was checked on its own branch. These are the seams between them, walked in the Pedestrian on the merged
// build (Working/sprint-02Oct26f/I/brief.md, "Cross-lane checks"):
//   1. Cards (B's building contact listing O's Overground rows): King's Cross lists Tube lines; Highbury & Islington
//      Tube and Overground; Stratford Tube, DLR and Overground; Dalston Junction the Overground only; a raised DLR
//      pavilion (South Quay) the DLR.
//   2. The Weaver from Liverpool Street to Cheshunt, through Theobalds Grove (O's network on T's track, past the old
//      edge hold): every stop in order, then "Up to the street" at Cheshunt (B's exit pose, on T's hidden ground), a walk
//      on the hidden ground, and a touch of Cheshunt's building that opens its card.
//   3. The Central from Debden to Epping and the Metropolitan from Moor Park to Amersham and to Chesham: every stop has
//      its building, and the street exit at each terminus stands on the hidden ground, outside, facing away.
//   4. The Hainault loop walked (F's joins on T's merged data); the DLR from Stratford International through Stratford and
//      from Stratford to Canning Town (F's 16/17 opening and deck blend under the walker): no step in the walker's height.
//   5. From 15,000 m at Master 1.1 over central London and over Amersham (F's dome against T's beyond-edge regimes): the
//      map fills the ground, the white buildings and the beyond-edge track are drawn, and no bore ribbon shows.
//   6. The default URL is the baked city with the station buildings; ?buildings=live keeps them, with their boxes hidden.
// UG_XL_SHOTS names the folder for the screenshots (default test-results/xl-s02).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

const VE = 5;
const SHOTS = process.env.UG_XL_SHOTS || 'test-results/xl-s02';
const TUBE = new Set(['bakerloo', 'central', 'circle', 'district', 'hammersmith-city', 'jubilee', 'metropolitan', 'northern', 'piccadilly', 'victoria', 'waterloo-city']);
const netOf = (lineId) => (lineId?.startsWith('og:') ? 'og' : lineId === 'dlr' ? 'dlr' : TUBE.has(lineId) ? 'tube' : 'other');

let page;
const errors = [];
const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 80 }); };

async function bootWalk(p) {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
  await p.goto('/?skip=1&buildings=baked&mh=1.1');
  await p.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await p.waitForFunction(() => {
    const u = window.__ug, b = u.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && u.lineBranchCenterPts.size > 11
      && u.trainSystem?.allTrains.length > 100 && u.modes.ctx.tubeRoutes?.size > 11 && u.surfaceRail && u.surfaceTrains
      && u.overground?.userData?.linePaths?.size === 6 && u.modes.ctx.tubeRoutes.has('og:weaver')
      && u.stationBuildings?.ready && u.termini?.corridor.ready;
  }, null, { timeout: 240000 });
}

async function enterWalk() {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  if (await page.evaluate(() => window.__ug.modes.activeId) === 'pedestrian') return;
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}
async function leaveCard() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

/** Stand `back` m beyond the site's exit pose, facing the building (B's stationExitPose faces away from it). */
const placeFacing = (name, back = 0) => page.evaluate(async ([name, back]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, key = sb.siteKeyOf(name), pose = sb.stationExitPose(key);
  m.place(pose.x - Math.sin(pose.yaw) * back, pose.z - Math.cos(pose.yaw) * back, { yaw: pose.yaw + Math.PI, pitch: 0 });
  await new Promise(r => requestAnimationFrame(r));
  return { pose, key };
}, [name, back]);

/** Hold the keys for up to `frames` frames, logging each; stops early once the card is open. */
const push = (frames = 300, keys = ['w'], stopOnCard = true) => page.evaluate(async ([frames, keys, stopOnCard]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const log = [];
  for (const k of keys) u.fpsControls.keys.add(k);
  try {
    for (let i = 0; i < frames; i++) {
      await frame();
      const d = m.debug(), hit = sb.contactAt(d.x, d.z, 60);
      log.push({ x: d.x, y: d.y, z: d.z, state: d.state, d: hit ? hit.d : null, key: hit?.building.key ?? null, card: d.card?.kind ?? null, open: d.chooser.open,
        g: u.termini.hiddenGround.terrainY(d.x, d.z) });
      if (stopOnCard && d.chooser.open) break;
    }
  } finally { for (const k of keys) u.fpsControls.keys.delete(k); }
  return log;
}, [frames, keys, stopOnCard]);

const cardNets = () => page.evaluate(() => {
  const d = window.__ug.modes.registry.get('pedestrian').debug();
  return { kind: d.card?.kind ?? null, rows: d.chooser.detail.map(r => ({ label: r.label, kind: r.kind, lineId: r.lineId })) };
});

// O's helpers (tests/pedestrian-overground.spec.js): place at a stop facing the next station; ride with the keys.
const placeAt = (lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
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
  if (best && best.dot > 0) { m.placeInTunnel({ path: best.path, s: best.s, dir: best.dir }); return { path: best.path, s: best.s, dir: best.dir }; }
  // Else (a stop at a path's end, whose next station's merged entrance lies off the heading): T's placement, by the next
  // station along the path (tests/termini.spec.js placeAt).
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    const st = p.stops.find(x => clean(x.stop.name) === from);
    if (!st) continue;
    for (const dir of [1, -1]) {
      const nx = dir > 0 ? p.stations.find(x => x.s > st.s + 1e-6) : [...p.stations].reverse().find(x => x.s < st.s - 1e-6);
      if (nx && clean(nx.name) === toward) { m.placeInTunnel({ path: p.id, s: st.s, dir }); return { path: p.id, s: st.s, dir, by: 'next' }; }
    }
  }
  return null;
}, [lineId, from, toward]);

function ride({ lineId, until, keys = ['w', 'shift'], maxMs = 90000, via = null }) {
  return page.evaluate(async ({ lineId, until, keys, maxMs, via }) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const net = m.network, c0 = m.debug().clock;
    const since = (d) => d.arrivals.filter(a => a.at > c0);
    const posOf = (name) => net.entrances.filter(en => en.names.includes(name) && en.stops.some(x => x.lineId === lineId));
    const frames = [];
    for (const k of keys) ug.fpsControls.keys.add(k);
    const t0 = performance.now();
    let vi = 0;
    try {
      while (performance.now() - t0 < maxMs * 2 && m.debug().clock - c0 < maxMs / 1000) {
        if (via) {
          const d0 = m.debug(), c = ug.camera.position;
          while (vi < via.length && since(d0).some(a => a.name === via[vi])) vi++;
          let e = null;
          for (let k = vi; k < via.length && !e; k++) {
            const best = posOf(via[k]).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
            if (best && Math.hypot(best.x - c.x, best.z - c.z) > 150) e = best;
          }
          if (e) { const want = Math.atan2(-(e.x - c.x), -(e.z - c.z)); m.turn(Math.atan2(Math.sin(want - d0.yaw), Math.cos(want - d0.yaw)), 0); }
        }
        await frame();
        const d = m.debug(), c = ug.camera.position;
        frames.push({ clock: d.clock, phase: d.phase, regime: d.regime, path: d.tunnel?.path ?? null, speed: d.tunnel?.speed ?? null,
          x: c.x, y: c.y, z: c.z, g: ug.modes.ctx.getTerrainY(c.x, c.z), card: d.card?.kind ?? null, edge: d.atEdge,
          hint: document.getElementById('ug-mode-hint')?.textContent ?? '', bridged: !!d.shown?.bridged, cut: d.openAir.cut?.kind ?? null });
        if (d.phase !== 'tunnel') break;
        if (until && since(d).some(a => a.name === until)) break;
        if (d.atEdge && d.tunnel.speed === 0) break;
      }
    } finally { for (const k of keys) ug.fpsControls.keys.delete(k); }
    const d = m.debug();
    return { frames, arrivals: since(d).map(a => ({ name: a.name, regime: a.regime })), ratio: ug.surfaceTrains.ratio,
      end: { regime: d.regime, card: d.card?.kind ?? null, atEdge: d.atEdge, hint: document.getElementById('ug-mode-hint')?.textContent ?? '' } };
  }, { lineId, until, keys, maxMs, via });
}

/** A leg: placed at `from` facing `toward`, ridden until `until`; the arrivals (distinct consecutive names) are the expected slice. */
async function leg({ line, from, toward, until, order, maxMs = 90000, label, steer = true }) {
  expect(await placeAt(line, from, toward), `${label}: ${from} on ${line} facing ${toward}`).not.toBeNull();
  // (steer: face the next station's entrance before a fork, as O's spec does; off where the line has no fork on the leg and a
  // merged interchange entrance lies off the track's heading, as Stratford's does for the DLR from Stratford International)
  const r = await ride({ lineId: line, until, maxMs, via: steer ? order.slice(order.indexOf(from) + 1) : null });
  const names = r.arrivals.map(a => a.name).filter((n, i, A) => i === 0 || n !== A[i - 1]);
  const expected = order.slice(order.indexOf(from) + 1, order.indexOf(until) + 1);
  console.log(`[xl-s02] ${label}: ${JSON.stringify(names)} (${r.frames.filter(f => f.regime === 'open').length} open, ${r.frames.filter(f => f.regime === 'bore').length} bore frames); end ${JSON.stringify(r.end)}`);
  expect(names, `${label}: stops in order`).toEqual(expected);
  expect(r.frames.some(f => /The map ends here/.test(f.hint)), `${label}: never held at a map edge`).toBe(false);
  expect(r.frames.every(f => f.card === null || f.card === 'arrival'), `${label}: no card but the arrival's`).toBe(true);
  for (const f of r.frames.filter(f => f.regime === 'open' && f.phase === 'tunnel')) {
    expect(f.y, `${label}: above the ground at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeGreaterThanOrEqual(f.g + 0.5 * VE * r.ratio - 1e-6);
  }
  return r;
}

/** Every named stop has a station building; returns the records. */
const buildingsFor = (names) => page.evaluate((names) => {
  const sb = window.__ug.stationBuildings;
  return names.map(n => { const b = sb.index.buildingForName(n); return { name: n, building: b?.key ?? null, kind: b?.kind ?? null }; });
}, names);

/** Take "Up to the street" from the arrival card and report the walker against B's exit pose and T's hidden ground. */
async function upToStreet(name, label) {
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
  expect((await dbg()).chooser.rows[0], `${label}: the first row`).toBe('Up to the street');
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate((name) => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, d = m.debug(), col = u.modes.collision;
    const key = sb.siteKeyOf(name), pose = sb.stationExitPose(key), b = sb.index.buildingForSite(key), hit = sb.contactAt(d.x, d.z, 60);
    return { key, pose, d: { x: d.x, y: d.y, z: d.z, yaw: d.yaw, state: d.state }, card: d.card?.kind ?? null, building: b?.key ?? null,
      hidden: u.termini.hiddenGround.terrainY(d.x, d.z), ground: col.groundHeightAt(d.x, d.z), water: col.waterAt(d.x, d.z),
      dist: hit?.d ?? null, hitKey: hit?.building.key ?? null,
      facing: hit ? (-Math.sin(d.yaw)) * (d.x - hit.x) / Math.max(hit.d, 1e-9) + (-Math.cos(d.yaw)) * (d.z - hit.z) / Math.max(hit.d, 1e-9) : null };
  }, name);
  console.log(`[xl-s02] ${label}: street exit ${JSON.stringify(r)}`);
  expect(r.d.state, `${label}: on the ground`).toBe('ground');
  expect(Math.hypot(r.d.x - r.pose.x, r.d.z - r.pose.z), `${label}: at B's exit pose`).toBeLessThan(0.5);
  expect(Math.abs(r.d.y - r.hidden), `${label}: on the (hidden) ground`).toBeLessThanOrEqual(0.05);
  expect(r.water, `${label}: not in water`).toBeFalsy();
  expect(r.hitKey, `${label}: beside its own building`).toBe(r.building);
  expect(r.dist, `${label}: outside the building`).toBeGreaterThanOrEqual(5);
  expect(r.facing, `${label}: facing away from the building`).toBeGreaterThanOrEqual(0.7);
  expect(r.card, `${label}: no card at the exit`).toBeNull();
  return r;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await bootWalk(page);
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode?.('manual'); u.renderQuality?.set?.({ scale: 1, samples: 4 }); });
});
test.afterAll(async () => { await page?.close(); });

// ── 1. Cards ─────────────────────────────────────────────────────────────────────────────────────

const CARDS = [
  ["King's Cross St. Pancras", ['tube'], 'kings-cross'],
  ['Highbury & Islington', ['og', 'tube'], 'highbury'],
  ['Stratford', ['dlr', 'og', 'tube'], 'stratford'],
  ['Dalston Junction', ['og'], 'dalston-junction'],
  ['South Quay', ['dlr'], 'south-quay-viaduct'],
];
for (const [name, nets, slug] of CARDS) {
  test(`1. touching ${name} opens a card listing ${nets.join(', ')} and nothing else`, async () => {
    await enterWalk();
    const at = await placeFacing(name, 4);
    const log = await push(400, ['w']);
    const i = log.findIndex(f => f.open);
    expect(i, `${name}: the card opened on contact`).toBeGreaterThan(-1);
    expect(log[i].key, `${name}: touching its own building`).toBe((await page.evaluate((k) => window.__ug.stationBuildings.index.buildingForSite(k)?.key, at.key)));
    expect(Math.min(...log.map(f => f.d ?? 99)), `${name}: never inside the footprint`).toBeGreaterThanOrEqual(0.33);
    const c = await cardNets();
    await shot(`card-${slug}`);
    const platformRows = c.rows.filter(r => r.lineId);
    const got = [...new Set(platformRows.map(r => netOf(r.lineId)))].sort();
    console.log(`[xl-s02] card ${name}: ${JSON.stringify(c.rows.map(r => r.label))}`);
    expect(c.kind).toBe('shaft');
    expect(got, `${name}: networks on the card`).toEqual(nets);
    if (name.startsWith("King's Cross")) expect(new Set(platformRows.map(r => r.lineId)).size).toBeGreaterThanOrEqual(5);
    if (slug === 'south-quay-viaduct') {
      const kind = await page.evaluate(() => window.__ug.stationBuildings.index.buildingForName('South Quay').kind);
      expect(kind, 'South Quay is a raised DLR pavilion').toBe('pavilion-viaduct');
    }
    await leaveCard();
  });
}

// ── 2. The Weaver to Cheshunt ────────────────────────────────────────────────────────────────────

const WEAVER = ['London Liverpool Street', 'Bethnal Green', 'Cambridge Heath (London)', 'London Fields', 'Hackney Downs', 'Rectory Road', 'Stoke Newington',
  'Stamford Hill', 'Seven Sisters', 'Bruce Grove', 'White Hart Lane', 'Silver Street', 'Edmonton Green', 'Southbury', 'Turkey Street', 'Theobalds Grove', 'Cheshunt'];

test('2. the Weaver from Liverpool Street to Cheshunt, through Theobalds Grove beyond the edge; up to the street; the hidden ground; the card', async () => {
  await enterWalk();
  await leg({ line: 'og:weaver', from: 'London Liverpool Street', toward: 'Bethnal Green', until: 'Seven Sisters', order: WEAVER, label: 'Weaver 1' });
  await leg({ line: 'og:weaver', from: 'Seven Sisters', toward: 'Bruce Grove', until: 'Edmonton Green', order: WEAVER, label: 'Weaver 2' });
  const r3 = await leg({ line: 'og:weaver', from: 'Edmonton Green', toward: 'Southbury', until: 'Cheshunt', order: WEAVER, label: 'Weaver 3' });
  expect(r3.arrivals.at(-1).regime, 'Cheshunt is arrived at in the open').toBe('open');
  const outside = await page.evaluate(async (pts) => { const { isOffMapEdge } = await import('/src/m25-edge.js').catch(() => ({})); return isOffMapEdge ? pts.map(([x, z]) => isOffMapEdge({ x, z })) : null; },
    r3.frames.filter((f, i) => i % 20 === 0).map(f => [f.x, f.z]));
  if (outside) expect(outside.some(Boolean), 'part of the last leg runs beyond the edge').toBe(true);
  const ex = await upToStreet('Cheshunt', 'Cheshunt');
  await shot('weaver-cheshunt-exit');
  // Walk 30 m on along the exit's facing, every frame on the hidden ground.
  const out = await push(Math.ceil(30 / 0.1) + 60, ['w'], false);
  const walked = Math.hypot(out.at(-1).x - ex.d.x, out.at(-1).z - ex.d.z);
  expect(walked, 'walked away from the building').toBeGreaterThanOrEqual(12);
  for (const f of out) { expect(f.state).toBe('ground'); expect(Math.abs(f.y - f.g), 'on the hidden ground').toBeLessThanOrEqual(0.05); }
  // Turn back and walk into the building: the card opens (re-armed past exit + 5 m).
  await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  await page.waitForTimeout(200);
  await shot('weaver-cheshunt-building');
  const back = await push(900, ['w']);
  const i = back.findIndex(f => f.open);
  expect(i, 'the card opens on touching Cheshunt\'s building').toBeGreaterThan(-1);
  expect(back[i].key).toBe(ex.building);
  const c = await cardNets();
  console.log(`[xl-s02] Cheshunt card: ${JSON.stringify(c.rows.map(r => r.label))}`);
  expect(c.rows.some(r => r.lineId === 'og:weaver'), 'the Weaver row').toBe(true);
  await shot('weaver-cheshunt-card');
  await leaveCard();
});

// ── 3. The Central to Epping, the Metropolitan to Amersham and Chesham ──────────────────────────

const CENTRAL = ['Debden', 'Theydon Bois', 'Epping'];
const MET_A = ['Moor Park', 'Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Amersham'];
const MET_C = ['Moor Park', 'Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Chesham'];

for (const [line, order, label, maxMs] of [['central', CENTRAL, 'Epping', 90000], ['metropolitan', MET_A, 'Amersham', 120000], ['metropolitan', MET_C, 'Chesham', 150000]]) {
  test(`3. ${line} ${order[0]} to ${label}: a building at every stop, and the street exit at ${label} stands outside on the hidden ground`, async () => {
    await enterWalk();
    await leg({ line, from: order[0], toward: order[1], until: label, order, maxMs, label: `${line} to ${label}` });
    const b = await buildingsFor(order);
    console.log(`[xl-s02] buildings ${JSON.stringify(b)}`);
    for (const x of b) expect(x.building, `${x.name} has its building`).not.toBeNull();
    const drawn = await page.evaluate(() => { const g = window.__ug.scene.getObjectByName('station-buildings'); return !!g && g.visible && !!g.parent; });
    expect(drawn, 'the station buildings are drawn').toBe(true);
    await upToStreet(label, label);
    await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
    await page.waitForTimeout(300);
    await shot(`terminus-${label.toLowerCase()}`);
    await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  });
}

// ── 4. The Hainault loop; the DLR through Stratford and Canning Town ─────────────────────────────

test('4a. the Hainault loop, Leytonstone round by Hainault to Woodford, every stop in order', async () => {
  await enterWalk();
  const order = ['Leytonstone', 'Wanstead', 'Redbridge', 'Gants Hill', 'Newbury Park', 'Barkingside', 'Fairlop', 'Hainault', 'Grange Hill', 'Chigwell', 'Roding Valley', 'Woodford'];
  await leg({ line: 'central', from: 'Leytonstone', toward: 'Wanstead', until: 'Woodford', order, maxMs: 120000, label: 'Hainault loop' });
});

test('4b. the DLR from Stratford International through Stratford, and from Stratford to Canning Town: the walker\'s height never steps', async () => {
  await enterWalk();
  const a = await leg({ line: 'dlr', from: 'Stratford International', toward: 'Stratford', until: 'Stratford', order: ['Stratford International', 'Stratford'], label: 'DLR to Stratford', steer: false });
  const order = ['Stratford', 'Stratford High Street', 'Abbey Road', 'West Ham', 'Star Lane', 'Canning Town'];
  const b = await leg({ line: 'dlr', from: 'Stratford', toward: 'Stratford High Street', until: 'Canning Town', order, label: 'DLR to Canning Town', steer: false });
  for (const [r, label] of [[a, 'Stratford'], [b, 'Canning Town']]) {
    let worst = 0, at = null;
    const F = r.frames.filter(f => f.phase === 'tunnel');
    for (let k = 1; k < F.length; k++) {
      const p = F[k - 1], f = F[k];
      if (p.regime !== 'open' || f.regime !== 'open' || f.path !== p.path || f.cut || p.cut) continue;
      const step = Math.abs(f.y - p.y) / VE / r.ratio, run = Math.hypot(f.x - p.x, f.z - p.z) / VE / r.ratio;
      const excess = step - 0.1 * run;            // a 10% grade is a ramp, not a step
      if (excess > worst) { worst = excess; at = { x: Math.round(f.x), z: Math.round(f.z), step, run }; }
    }
    console.log(`[xl-s02] DLR ${label}: worst height step beyond a 10% grade ${worst.toFixed(3)} m at ${JSON.stringify(at)}`);
    expect(worst, `DLR ${label}: no step in the walker's height`).toBeLessThanOrEqual(0.5);
  }
});

// ── 5. From 15,000 m ─────────────────────────────────────────────────────────────────────────────

test('5. from 15,000 m at Master 1.1 over central London and over Amersham: map, white buildings and beyond-edge track drawn, no bore ribbon', async () => {
  await page.keyboard.press('1');
  await page.waitForTimeout(500);
  const res = {};
  // Over Amersham the camera looks twice: down at the terminus (the beyond-edge track and its white building; no ground is
  // drawn beyond the edge) and east to London (the map on the horizon, not painted over by the dome).
  for (const [label, X, Z, lookX, lookZ] of [['central', 0, 6000, 0, -6000], ['amersham', -33658, -9000, -33658, -17800], ['amershamToLondon', -33658, -17800, 0, 0]]) {
    res[label] = await page.evaluate(async ([X, Z, lookX, lookZ]) => {
      const u = window.__ug, T = window.__ugTHREE, rend = u.composer.renderer, cam = u.camera;
      u.sim.paused = true;   // trains and the clock still between the shots (a control shot measures what still moves)
      const el = document.getElementById('masterHeight'); el.value = '1.1'; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
      u.fpsControls.enabled = false;
      const y = 75 + 5 * 15000;
      // The target 1,000 units along the view (as tests/altitude-map.spec.js does): OrbitControls clamps the camera to
      // maxDistance from its target, so a far target would pull the camera down from 15,000 m.
      const dx = lookX - X, dy = -y, dz = lookZ - Z, n = Math.hypot(dx, dy, dz);
      cam.position.set(X, y, Z); u.controls.target.set(X + 1000 * dx / n, y + 1000 * dy / n, Z + 1000 * dz / n); u.controls.update();
      await new Promise(r => { let i = 0; const f = () => (++i >= 20 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const W = 1440, H = Math.round(W / cam.aspect);
      const shoot = (setup, magenta) => {
        const all = []; u.scene.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push(o); });
        const saved = new Map(all.map(o => [o, o.visible]));
        const sc = new T.Color(); rend.getClearColor(sc); const sa = rend.getClearAlpha();
        setup(all);
        if (magenta) rend.setClearColor(0xff00ff, 1);
        const rt = new T.WebGLRenderTarget(W, H, { type: T.FloatType });
        rend.setRenderTarget(rt);
        rend.shadowMap.needsUpdate = true;   // the shadow cache re-renders only on demand: every shot draws its own shadows
        let lines = 0;
        u.undergroundCull.render(true, () => { u.scene.traverse(o => { if (/^line:/.test(o.name || '') && o.visible) lines++; }); rend.render(u.scene, cam); });
        const px = new Float32Array(W * H * 4); rend.readRenderTargetPixels(rt, 0, 0, W, H, px);
        rend.setRenderTarget(null); rt.dispose(); rend.setClearColor(sc, sa);
        for (const [o, v] of saved) o.visible = v;
        return { px, lines };
      };
      const d3 = (a, b, k) => Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
      const diff = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (d3(a, b, k) > 0.003) n++; return n; };
      // What an object adds: pixels that change when it is hidden and are otherwise stable between two identical shots.
      const adds = (a, hidden, a2) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (d3(a, a2, k) <= 0.003 && d3(a, hidden, k) > 0.003) n++; return n; };
      const dome = u.scene.getObjectByName('skyDome'), sky = window.__ugSky.mesh;
      const geom = shoot(() => { dome.visible = false; sky.visible = false; }, true);
      const app = shoot(() => {}, false);
      const domeOnly = shoot((all) => { for (const o of all) o.visible = o === dome; }, true);
      let nGeom = 0, nOcc = 0, below = 0, nAll = 0;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 4, g = geom.px, a = app.px, d = domeOnly.px;
        const isGeom = !(Math.abs(g[k] - 1) < 0.02 && g[k + 1] < 0.02 && Math.abs(g[k + 2] - 1) < 0.02);
        if (isGeom) nAll++;
        if (j < H * 0.45) { below++; if (isGeom) nGeom++; }
        const dGA = Math.max(Math.abs(a[k] - g[k]), Math.abs(a[k + 1] - g[k + 1]), Math.abs(a[k + 2] - g[k + 2]));
        const dAD = Math.max(Math.abs(a[k] - d[k]), Math.abs(a[k + 1] - d[k + 1]), Math.abs(a[k + 2] - d[k + 2]));
        if (isGeom && dGA > 0.01 && dAD < 0.005) nOcc++;
      }
      const sbg = u.scene.getObjectByName('station-buildings');
      shoot(() => {}, false);   // (the first shot after the frames differs in a few thousand pixels from every later one)
      const withB = shoot(() => {}, false), again = shoot(() => {}, false), noB = shoot(() => { sbg.visible = false; }, false);
      sbg.visible = true;   // (shoot restores meshes; a group hidden by its setup is restored here)
      const met = u.scene.getObjectByName('surface-rail-metropolitan');
      const noMet = met ? shoot(() => { met.visible = false; }, false) : null;
      if (met) met.visible = true;
      return { altM: Math.round((cam.position.y - (u.getTerrainMeshSurfaceY({ x: cam.position.x, z: cam.position.z }) ?? 0)) / 5), linesDrawn: app.lines, groundShareLowerRows: nGeom / below, geomShare: nAll / (W * H), occluded: nOcc, occludedShare: nOcc / Math.max(1, nAll), noisePx: diff(withB.px, again.px), buildingsPx: adds(withB.px, noB.px, again.px),
        metPx: noMet ? adds(withB.px, noMet.px, again.px) : null, metName: met?.name ?? null, far: cam.far, aboveGround: u.aboveGroundView };
    }, [X, Z, lookX, lookZ]);
    await shot(`altitude-15000-${label}`);
  }
  console.log(`[xl-s02] altitude ${JSON.stringify(res)}`);
  for (const [label, r] of Object.entries(res)) {
    expect(Math.abs(r.altM - 15000), `${label}: the camera is at 15,000 m (${r.altM})`).toBeLessThan(400);
    // (lane F's acceptance for the dome: at most 0.5 percent of the drawn map overpainted, tests/altitude-map.spec.js)
    expect(r.occludedShare, `${label}: the dome paints over the map (${r.occluded} px)`).toBeLessThanOrEqual(0.005);
    expect(r.linesDrawn, `${label}: no bore ribbon (line:* group) drawn from above`).toBe(0);
  }
  expect(res.central.groundShareLowerRows, 'central: the map fills the lower frame').toBeGreaterThan(0.95);
  expect(res.central.buildingsPx, 'central: the white station buildings are drawn').toBeGreaterThan(0);
  expect(res.amersham.buildingsPx, 'over Amersham: its white building is drawn').toBeGreaterThan(0);
  expect(res.amersham.metPx, 'over Amersham: the beyond-edge Metropolitan track is drawn').toBeGreaterThan(0);
  expect(res.amershamToLondon.geomShare, 'from over Amersham: the map is drawn toward London').toBeGreaterThan(0.2);
});

// ── 6. The default URL and the live path ─────────────────────────────────────────────────────────

test('6. the default URL is the baked city with the station buildings; ?buildings=live keeps them with their boxes hidden', async ({ browser }) => {
  const out = {};
  for (const url of ['/', '/?buildings=live']) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
    await p.goto(url);
    await p.waitForFunction(() => {
      const u = window.__ug;
      return !!(u && u.stationBuildings?.ready && (u.buildingsPath !== 'baked' || (u.bakedStats && u.bakedStats.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal))
        && ['done', 'bypassed'].includes(u.intro?.getPhase?.()));
    }, null, { timeout: 240000 });
    const kx = await p.evaluate(async () => {
      const u = window.__ug, sb = u.stationBuildings, b = sb.index.buildingForName("King's Cross St. Pancras"), gy = u.getTerrainMeshSurfaceY({ x: b.label.x, z: b.label.z });
      u.camera.position.set(b.label.x, gy + 300 * 5, b.label.z + 400); u.controls.target.set(b.label.x, gy, b.label.z); u.controls.update();
      await new Promise(r => setTimeout(r, 6000));
      const g = u.scene.getObjectByName('station-buildings');
      return { path: u.buildingsPath, search: location.search, hidden: { ...sb.hidden }, drawn: !!g && g.visible && !!g.parent, stats: { draws: sb.stats.draws } };
    });
    await p.screenshot({ path: path.join(SHOTS, `default-url-${url === '/' ? 'baked' : 'live'}.jpg`), type: 'jpeg', quality: 80 });
    out[url] = { ...kx, errors: errs };
    await p.close();
  }
  console.log(`[xl-s02] default URL ${JSON.stringify(out)}`);
  expect(out['/'].path).toBe('baked');
  expect(out['/'].search).toBe('');
  expect(out['/'].drawn).toBe(true);
  expect(out['/'].hidden.baked, 'baked boxes under station buildings are hidden').toBeGreaterThan(250);
  expect(out['/?buildings=live'].path).toBe('live');
  expect(out['/?buildings=live'].drawn).toBe(true);
  expect(out['/?buildings=live'].hidden.live, 'live boxes under station buildings are hidden').toBeGreaterThan(0);
  expect(out['/'].errors, 'no console error on the default URL').toEqual([]);
  expect(out['/?buildings=live'].errors, 'no console error on the live path').toEqual([]);
});

test('no console error over the whole walk', async () => {
  expect(errors).toEqual([]);
});
