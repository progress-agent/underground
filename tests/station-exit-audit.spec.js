// station-exit-audit.spec.js: Lane F (sprint 02Oct26f, D-047 walk-street-exit; D-048 item 9).
//
// The yardstick for Lane B's station exits. For a fixed sample of about 30 stations covering
// every kind it places the walker on the platform at rest, opens the arrival card, takes "Up to the
// street" through the real flow, and records the pose and a screenshot. Six checks per exit:
//   1 ground  on the ground (feet within 0.5 m true of the terrain), not on a roof, not in water;
//   2 box     not inside any collision box (and, in assert mode, no station-building footprint);
//   3 near    within 25 m of the station (its building in assert mode, else the station's point);
//   4 fan     no solid thing within 10 m in a fan of +-25 degrees ahead at eye height (collision
//             boxes spanning the eye, and station structures in plan: surface station markers and
//             glass shafts; in assert mode Lane B's buildings too);
//   5 facing  facing away from the station, within 90 degrees of outward;
//   6 rearm   the card does not re-open while the walker stands still at the exit (3 s).
//
// SURVEY mode runs on any build (it is the only mode on e0675d7 and on a branch without Lane B): it
// records and fails only if fewer than 25 of the 30 core stations complete the flow. It writes
// UG_AUDIT_OUT (default test-results/exit-audit.json) with { sha, mode, stations, summary } and
// the screenshots beside it. UG_AUDIT_SHA names the build served when it is not this checkout.
//
// ASSERT mode turns on when Lane B's window.__ug.stationBuildings (or window.__ug.stationExitPose)
// exposes stationExitPose(siteKey). It then also runs checks 1 to 5 on every site key B exposes
// (its own key list, else every key of public/data/station-buildings.json) WITHOUT walking, and it
// FAILS on any violation, in the walked sample as well. Assert mode that finds zero site keys is a
// failure, never a pass. Without Lane B the assert part is skipped with one message.
//
// Overground-only and beyond-the-M25 stations are active only where the walk network has a stop of
// that name (after Lanes O and T): otherwise the row is recorded inactive with its reason.

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SAMPLE = [
  // [kind, lineId, name]
  ...[['victoria', 'Oxford Circus'], ['northern', 'Bank'], ['northern', 'Hampstead'], ['jubilee', 'Westminster'],
    ['piccadilly', 'Covent Garden'], ['bakerloo', 'Lambeth North'], ['central', 'Tottenham Court Road'], ['northern', 'Angel']]
    .map(([l, n]) => ['deep', l, n]),
  ...[['district', 'Upminster'], ['northern', 'Golders Green'], ['metropolitan', 'Wembley Park'], ['central', 'Hainault'],
    ['district', 'Richmond'], ['jubilee', 'Stanmore'], ['piccadilly', 'Hounslow West'], ['bakerloo', 'Kensal Green']]
    .map(([l, n]) => ['surface', l, n]),
  ...['Canning Town', 'Poplar', 'Pontoon Dock', 'Shadwell', 'Royal Victoria'].map(n => ['dlr', 'dlr', n]),
  ...[['piccadilly', "King's Cross"], ['bakerloo', 'Paddington'], ['central', 'Liverpool Street'], ['victoria', 'Victoria'], ['northern', 'Euston']]
    .map(([l, n]) => ['terminus', l, n]),
  ...[['jubilee', 'Stratford'], ['jubilee', 'Canary Wharf'], ['metropolitan', 'Baker Street'], ['jubilee', 'London Bridge']]
    .map(([l, n]) => ['interchange', l, n]),
];
const CONDITIONAL = [
  ['overground', null, 'Hackney Central'], ['overground', null, 'Dalston Junction'], ['overground', null, 'Rotherhithe'],
  ['beyond', null, 'Amersham'], ['beyond', null, 'Chesham'], ['beyond', null, 'Cheshunt'],
];
const CORE = SAMPLE.length;

const OUT = process.env.UG_AUDIT_OUT || 'test-results/exit-audit.json';
const SHOTS = OUT.replace(/\.json$/, '') + '-shots';

function currentSha() {
  if (process.env.UG_AUDIT_SHA) return process.env.UG_AUDIT_SHA;
  try { return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim(); } catch { return 'unknown'; }
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(20 * 60 * 1000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Proof that assert mode cannot pass silently (acceptance 8.5): UG_AUDIT_INJECT=1 makes a fake
  // window.__ug.stationBuildings appear as soon as window.__ug exists, whose stationExitPose returns the centre of a
  // collision box near Oxford Circus (inside a box), with no key list (so "no site keys" fails); UG_AUDIT_INJECT=keys
  // also lists one key, so the walk reaches check 2 (box). Either must make this spec FAIL; neither is a real Lane B.
  if (process.env.UG_AUDIT_INJECT) {
    await page.addInitScript((withKeys) => {
      const iv = setInterval(() => {
        if (!window.__ug) return;
        clearInterval(iv);
        const fake = { stationExitPose: () => {
          const col = window.__ug.modes?.ctx?.collision, b = col?.buildingsNear(-1000.8, -845.1, 300)?.[0];
          return b ? { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, yaw: 0 } : { x: -1000.8, z: -845.1, yaw: 0 };
        } };
        if (withKeys) fake.keys = ['fake-site'];
        window.__ug.stationBuildings = fake;
      }, 5);
    }, process.env.UG_AUDIT_INJECT === 'keys');
  }
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.unifiedShaftLayer && window.__ug.trainSystem?.allTrains.length > 100
      && window.__ug.modes.ctx.tubeRoutes?.size > 11 && window.__ug.surfaceRail
      && window.__ug.overground?.userData?.stationsAttached;
  }, null, { timeout: 180000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(async () => { await page?.close(); });

// ── in-page geometry (one function so the walked sample and Lane B's poses use the same checks) ──
const ANALYSE = ({ x, y, z, yaw, station, buildingFootprints }) => {
  const u = window.__ug, col = u.modes.ctx.collision, VE = 5;
  const eyeY = y + 1.7 * VE, fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const out = { x, y, z, yaw };
  // 1 ground: feet within 0.5 m (true) of the terrain, no roof above it, no water.
  const g = col.groundHeightAt(x, z), roof = col.roofHeightAt(x, z), water = col.waterAt(x, z);
  out.ground = { pass: g !== null && Math.abs(y - g) <= 0.5 * VE && (roof === null || roof <= g + 0.5 * VE) && !water,
    feetOverGroundM: g === null ? null : (y - g) / VE, roofOverGroundM: roof === null ? null : (roof - g) / VE, water: !!water };
  // 2 box: inside no collision box; in assert mode inside no station-building footprint either.
  const inside = col.buildingsNear(x, z, 0).filter(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  const inFoot = (buildingFootprints || []).filter(poly => {
    let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    } return c;
  });
  out.box = { pass: inside.length === 0 && inFoot.length === 0, boxes: inside.length, footprints: inFoot.length };
  // 3 near: within 25 m of the station (building or point).
  const dStation = station ? Math.hypot(x - station.x, z - station.z) : null;
  out.near = { pass: dStation !== null && dStation <= 25, distanceM: dStation, unchecked: dStation === null };
  // 4 fan: nothing solid within 10 m in +-25 degrees ahead at eye height.
  const things = [];
  const L = 40;
  for (const b of col.buildingsNear(x, z, L)) if (b.baseY <= eyeY && eyeY <= b.roofY) things.push({ kind: 'box', box: b });
  u.scene.traverse(o => {
    if (o.userData?.kind === 'station-markers' && o.isInstancedMesh) {
      o.geometry.computeBoundingSphere();
      const r = o.geometry.boundingSphere.radius, m = new window.__ugTHREE.Matrix4(), p = new window.__ugTHREE.Vector3();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const gy = col.groundHeightAt(p.x, p.z);
        // Only the markers that stand at the surface (the deep ones sit at their platforms).
        if (gy === null || p.y < gy - 2 * VE) continue;
        if (Math.hypot(p.x - x, p.z - z) < L + r) things.push({ kind: 'marker', x: p.x, z: p.z, r });
      }
    } else if (o.userData?.type === 'station-shaft') {
      // Integration 02Oct26f: "ahead at eye height", as for the boxes: a glass shaft whose top is flush with the street
      // (shafts.js tops every shaft at the ground) is under the walker's eye, and is not drawn above ground anyway (D-040).
      const gy = col.groundHeightAt(o.position.x, o.position.z), top = o.position.y + o.scale.y / 2;
      if (gy !== null && top >= eyeY && Math.hypot(o.position.x - x, o.position.z - z) < L + o.scale.x) things.push({ kind: 'shaft', x: o.position.x, z: o.position.z, r: o.scale.x });
    }
  });
  // Integration 02Oct26f: a station building is its footprint polygon, not the polygon's axis-aligned bounds (the bounds of a
  // turned building reach round its own exit, which stands outside the polygon facing away from it).
  for (const p of (buildingFootprints || [])) things.push({ kind: 'station-building', poly: p });
  const hit = (dx, dz, maxM) => {
    let best = null;
    for (const t of things) {
      let d = null;
      if (t.poly) {
        for (let i = 0, n = t.poly.length; i < n; i++) {
          const [ax, az] = t.poly[i], [bx, bz] = t.poly[(i + 1) % n], ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-12) continue;
          const s = ((ax - x) * ez - (az - z) * ex) / den, w = ((ax - x) * dz - (az - z) * dx) / den;
          if (s >= 0 && s <= maxM && w >= 0 && w <= 1 && (d === null || s < d)) d = s;
        }
      } else if (t.box) {
        const b = t.box; let t0 = 0, t1 = maxM, ok = true;
        for (const [o, dd, lo, hi] of [[x, dx, b.minX, b.maxX], [z, dz, b.minZ, b.maxZ]]) {
          if (Math.abs(dd) < 1e-9) { if (o < lo || o > hi) ok = false; }
          else { let a = (lo - o) / dd, c = (hi - o) / dd; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
        }
        if (ok && t0 <= t1) d = t0;
      } else {
        // Ray to circle in plan.
        const ox = x - t.x, oz = z - t.z, bq = ox * dx + oz * dz, cq = ox * ox + oz * oz - t.r * t.r, disc = bq * bq - cq;
        // A walker who comes up the glass shaft stands on its flat top: that is not a surface ahead. (Standing inside a
        // marker ball is: it is solid, and the exit should not land there.)
        if (cq <= 0 && t.kind === 'shaft') continue;
        if (disc >= 0) { const s = -bq - Math.sqrt(disc); if (s >= 0 && s <= maxM) d = s; else if (cq <= 0) d = 0; }
      }
      if (d !== null && d <= maxM && (!best || d < best.d)) best = { d, kind: t.kind };
    }
    return best;
  };
  let fanNearest = null;
  for (let k = 0; k <= 10; k++) {
    const a = yaw + ((-25 + 5 * k) * Math.PI) / 180, h = hit(-Math.sin(a), -Math.cos(a), 10);
    if (h && (!fanNearest || h.d < fanNearest.d)) fanNearest = h;
  }
  let frontNearest = null;
  for (let deg = -90; deg <= 90; deg += 15) {
    const a = yaw + (deg * Math.PI) / 180, h = hit(-Math.sin(a), -Math.cos(a), L);
    if (h && (!frontNearest || h.d < frontNearest.d)) frontNearest = h;
  }
  out.fan = { pass: !fanNearest, nearestM: fanNearest?.d ?? null, kind: fanNearest?.kind ?? null };
  out.frontNearestM = frontNearest ? { d: frontNearest.d, kind: frontNearest.kind } : null;
  // 5 facing: within 90 degrees of outward (the exit minus the station).
  if (station) {
    const ox = x - station.x, oz = z - station.z, ol = Math.hypot(ox, oz);
    if (ol < 0.5) out.facing = { pass: true, angleDeg: null, note: 'on the station point' };
    else { const cos = (fwd.x * ox + fwd.z * oz) / ol; out.facing = { pass: cos >= 0, angleDeg: Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI }; }
  } else out.facing = { pass: true, angleDeg: null, unchecked: true };
  return out;
};

async function stationPoint(page, lineId, name) {
  return page.evaluate(([lineId, name]) => {
    const norm = s => s.replace(/[‘’]/g, "'").toLowerCase();
    const m = window.__ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
    for (const p of net.paths) {
      if (lineId && p.lineId !== lineId) continue;
      const st = p.stops.find(x => norm(x.stop.name).startsWith(norm(name)));
      if (st) return { path: p.id, s: st.s, lineId: p.lineId, x: st.stop.x, z: st.stop.z, name: st.stop.name };
    }
    return null;
  }, [lineId, name]);
}

async function walkOne(page, kind, lineId, name) {
  const rec = { kind, line: lineId, name, active: false };
  const st = await stationPoint(page, lineId, name);
  if (!st) { rec.reason = lineId ? `no stop named "${name}" on the ${lineId} walk network` : `no stop named "${name}" in the walk network yet (needs Lane ${kind === 'beyond' ? 'T' : 'O'})`; return rec; }
  rec.active = true; rec.line = st.lineId; rec.stop = { name: st.name, x: st.x, z: st.z };
  try {
    await page.evaluate(({ path, s }) => {
      const m = window.__ug.modes.registry.get('pedestrian');
      m.placeInTunnel({ path, s, dir: 1 });
    }, st);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').press('use'));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 15000 });
    const station = await page.evaluate(() => ({ chooser: window.__ug.modes.registry.get('pedestrian').debug().chooser.rows }));
    rec.cardRows = station.chooser;
    // The real flow: click the "Up to the street" row (row 0).
    const row = page.locator('#ug-platform-chooser button.row').first();
    await row.click({ timeout: 5000 });
    await page.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body'; }, null, { timeout: 40000 });
    // Station point on the drawn track, when the step reports it; else the stop's own point.
    const pose = await page.evaluate(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return { x: d.x, y: d.y, z: d.z, yaw: d.yaw }; });
    const stationPt = { x: st.x, z: st.z };
    // 6 rearm: the card stays closed for 3 s with the walker standing still (every frame sampled).
    const rearm = await page.evaluate(() => new Promise(resolve => {
      const m = window.__ug.modes.registry.get('pedestrian'), t0 = performance.now();
      let opened = 0, frames = 0, x0 = m.debug().x, z0 = m.debug().z, moved = 0;
      const step = () => {
        const d = m.debug(); frames++;
        if (d.card) opened++;
        moved = Math.max(moved, Math.hypot(d.x - x0, d.z - z0));
        if (performance.now() - t0 >= 3000) resolve({ frames, opened, movedM: moved }); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
    // Integration 02Oct26f: in assert mode (lane B present) the walked exit is checked against its station BUILDING, as the
    // header defines checks 2, 3 and 5 for assert mode: the point of the building nearest the exit and its footprint. The
    // stop's point on the track lies inside or far from a big building (Euston, London Bridge) and is not where B's exit is.
    const bld = await page.evaluate(([name]) => {
      const sb = window.__ug.stationBuildings;
      if (!sb?.stationExitPose || !sb.centreOf) return null;
      const key = sb.siteKeyOf(name);
      return { key, station: sb.centreOf(key), foot: sb.footprintOf(key) };
    }, [st.name]);
    rec.building = bld ? { key: bld.key } : null;
    const a = await page.evaluate(ANALYSE_SRC, { ...pose, station: bld?.station ?? stationPt, buildingFootprints: bld?.foot ? [bld.foot] : null });
    a.rearm = { pass: rearm.opened === 0, framesWithCard: rearm.opened, frames: rearm.frames, movedM: rearm.movedM };
    const file = path.join(SHOTS, `${kind}-${(st.lineId || lineId || 'x')}-${name.replace(/[^A-Za-z0-9]+/g, '-')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
    Object.assign(rec, { pose, station: stationPt, screenshot: path.relative(path.dirname(path.resolve(OUT)), file), complete: true },   // the screenshot path is relative to the JSON beside it
      { ground: a.ground, box: a.box, near: a.near, fan: a.fan, facing: a.facing, rearm: a.rearm, frontNearest: a.frontNearestM });
    rec.violations = ['ground', 'box', 'near', 'fan', 'facing', 'rearm'].filter(k => rec[k] && rec[k].pass === false);
  } catch (e) {
    rec.complete = false; rec.error = String(e.message || e).split('\n')[0];
    await page.evaluate(() => { try { window.__ug.modes.registry.get('pedestrian').chooser.close?.(); } catch { /* ignore */ } });
  }
  return rec;
}
// The analyser is passed as source so the walked sample and B's poses use the same code.
const ANALYSE_SRC = ANALYSE;

test('the exit audit: survey of the sample, assert on Lane B\'s poses when they exist', async () => {
  const stations = [];
  for (const [kind, lineId, name] of [...SAMPLE, ...CONDITIONAL]) {
    const rec = await walkOne(page, kind, lineId, name);
    stations.push(rec);
    console.log(`[exit-audit] ${kind.padEnd(11)} ${(rec.line ?? '-').padEnd(12)} ${name.padEnd(22)} ${rec.active ? (rec.complete ? `violations: ${rec.violations.join(',') || 'none'}` : `FLOW FAILED: ${rec.error}`) : `inactive: ${rec.reason}`}`);
  }
  const core = stations.slice(0, CORE), completed = core.filter(s => s.active && s.complete);

  // ── assert mode ─────────────────────────────────────────────────────────────────────────────
  const b = await page.evaluate(() => {
    const sb = window.__ug.stationBuildings;
    const fn = sb?.stationExitPose || window.__ug.stationExitPose;
    return { present: typeof fn === 'function', keys: sb?.keys ? [...sb.keys] : (sb?.siteKeys ? [...sb.siteKeys] : null) };
  });
  const mode = b.present ? 'assert' : 'survey';
  let sites = null, assertViolations = [];
  if (b.present) {
    let keys = b.keys;
    if (!keys?.length) {
      keys = await page.evaluate(async () => {
        try { const r = await fetch('/data/station-buildings.json'); if (!r.ok) return []; const j = await r.json(); return (Array.isArray(j) ? j : (j.sites || j.stations || Object.values(j))).map(e => e.key).filter(Boolean); } catch { return []; }
      });
    }
    sites = [];
    for (const key of keys) {
      const r = await page.evaluate(([key, src]) => {
        const sb = window.__ug.stationBuildings, fn = sb?.stationExitPose || window.__ug.stationExitPose;
        const p = fn(key);
        if (!p) return { key, missing: true };
        const col = window.__ug.modes.ctx.collision, y = col.groundHeightAt(p.x, p.z);
        const analyse = new Function('arg', `return (${src})(arg)`);
        const foot = sb?.footprintOf ? sb.footprintOf(key) : null;          // Lane B's footprint, if it exposes one
        const centre = sb?.centreOf ? sb.centreOf(key) : null;              // and its centre
        return { key, pose: { x: p.x, z: p.z, yaw: p.yaw }, ...analyse({ x: p.x, y: y ?? 0, z: p.z, yaw: p.yaw, station: centre, buildingFootprints: foot ? [foot] : null }), groundMissing: y === null };
      }, [key, ANALYSE.toString()]);
      sites.push(r);
    }
    for (const s of sites) {
      const bad = s.missing ? ['missing'] : ['ground', 'box', 'near', 'fan', 'facing'].filter(k => s[k] && s[k].pass === false && !s[k].unchecked);
      if (bad.length) assertViolations.push({ key: s.key, bad });
    }
    for (const s of stations) if (s.active && s.complete && s.violations.length) assertViolations.push({ key: `${s.line} ${s.name} (walked)`, bad: s.violations });
  }

  const summary = {
    core: CORE, coreActiveComplete: completed.length,
    inactive: stations.filter(s => !s.active).map(s => ({ name: s.name, reason: s.reason })),
    perCheckFailures: Object.fromEntries(['ground', 'box', 'near', 'fan', 'facing', 'rearm'].map(k => [k, stations.filter(s => s.complete && s[k]?.pass === false).map(s => s.name)])),
    frontHalfWithin10m: stations.filter(s => s.complete && s.frontNearest && s.frontNearest.d <= 10).map(s => `${s.name}: ${s.frontNearest.kind} ${s.frontNearest.d.toFixed(1)} m`),
    sites: sites ? { count: sites.length, violations: assertViolations.length } : null,
  };
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ sha: currentSha(), mode, stations, sites, summary }, null, 2));
  console.log(`[exit-audit] mode=${mode} core complete ${completed.length}/${CORE}; failures per check ${JSON.stringify(Object.fromEntries(Object.entries(summary.perCheckFailures).map(([k, v]) => [k, v.length])))}; wrote ${OUT}`);

  expect(completed.length, `core stations that completed the flow (${stations.filter(s => s.active && !s.complete).map(s => `${s.name}: ${s.error}`).join('; ')})`).toBeGreaterThanOrEqual(25);
  if (mode === 'assert') {
    expect(sites.length, 'assert mode found no site keys: Lane B must expose its key list or public/data/station-buildings.json').toBeGreaterThan(0);
    expect(assertViolations, 'exit violations').toEqual([]);
  } else {
    console.log('[exit-audit] assert mode skipped: Lane B\'s window.__ug.stationBuildings.stationExitPose does not exist on this build');
  }
});
