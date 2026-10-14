// player-foot.spec.js: the figure on foot, the over-the-shoulder camera, the view rules (sprint 14Oct26w, lane P,
// D-053 items 2 and 3). The Quaternius mannequin is the Pedestrian's body above ground, drawn from over its
// shoulder at 22 mm; drag orbits, scroll and pinch change the distance, V switches to first person and back, and
// shafts, tunnels and the open-air ride stay first person.
//
// One page boots once and the tests share it (serial), as the other Pedestrian specs do. Poses are fixed places
// in the real baked city, placed with ped.place(x, z, { yaw }); yaw 0 faces north (-Z).
import { test, expect } from '@playwright/test';

const POSES = {
  KX: [164.9, -2507.9, 0],              // open ground south of King's Cross
  ALLEY: [2870.0, -719.6, Math.PI / 2], // a narrow street east of Bank, facades 2 to 6 m away
  BANK: [2743.9, -760.9, Math.PI],      // the playerFoot view's street
  THAMES: [885.1, -145.1, 0],           // mid-river by Waterloo Bridge
};

test.describe.configure({ mode: 'serial' });

let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const place = async (name) => {
  const [x, z, yaw] = POSES[name];
  await ev(([x, z, yaw]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw }), [x, z, yaw]);
  await wait(1000);
};
const setMaster = (v) => ev((v) => {
  const el = document.getElementById('masterHeight');
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  window.__ug.structureMorph.flush();
}, v);

/** Everything the camera checks need, in display metres. */
const camInfo = () => ev(() => {
  const u = window.__ug, T = window.__ugTHREE, ped = u.modes.registry.get('pedestrian'), ratio = u.masterHeight.ratio;
  const cam = u.camera, st = ped.playerState();
  cam.updateMatrixWorld(true);
  const bone = (n) => { const v = new T.Vector3(); u.player.figure.boneWorldPosition(n, v); return v; };
  const disp = (v) => new T.Vector3(v.x, v.y * ratio, v.z);
  // camera.getWorldDirection is the canonical direction (the display transform re-inflates y); the display pitch
  // scales y by the ratio, exactly as vertical-scale.js does
  const f = new T.Vector3(); cam.getWorldDirection(f);
  const fd = new T.Vector3(f.x, f.y * ratio, f.z).normalize();
  const neck = bone('neck_01'), pelvis = bone('pelvis');
  const cp = disp(cam.position);
  const toFeet = new T.Vector3(st.x - cam.position.x, 0, st.z - cam.position.z).normalize();
  const hf = Math.hypot(f.x, f.z);
  return {
    third: ped.isThirdPerson(), focal: u.lensSystem.getFocalLength(), look: u.modes.look.mode,
    dNeck: cp.distanceTo(disp(neck)), above: (cam.position.y - st.y) * ratio,
    behind: (f.x * toFeet.x + f.z * toFeet.z) / hf,
    neckNdc: neck.clone().project(cam).toArray(), pelvisNdc: pelvis.clone().project(cam).toArray(),
    yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(fd.y), ratio,
  };
});
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const drag = async (dx, dy, steps = 5) => {
  const x0 = 1440 * 0.6, y0 = 450;
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps);
  await page.mouse.up(); await wait(250);
};
const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
const player = () => ev(() => window.__ug.player.debug());
const bodyState = () => ev(() => ({ ...window.__ug.modes.registry.get('pedestrian').playerState() }));

/** The figure's skinned meshes (never the shadow's) and whether each is visible through its ancestors. */
const figureMeshes = () => ev(() => {
  const u = window.__ug, out = [];
  u.scene.children.find((c) => c.name === 'player').traverse((o) => {
    if (!o.isSkinnedMesh || o.name.startsWith('player-shadow')) return;
    let a = o, v = true; while (a) { if (!a.visible) v = false; a = a.parent; }
    out.push({ visible: v, color: o.material.color.toArray(), instanceColor: !!o.instanceColor });
  });
  return out;
});
const figureBox = () => ev(() => {
  const u = window.__ug, T = window.__ugTHREE, ratio = u.masterHeight.ratio, st = u.modes.registry.get('pedestrian').playerState();
  const box = new T.Box3();
  u.scene.children.find((c) => c.name === 'player').traverse((o) => { if (o.isSkinnedMesh && !o.name.startsWith('player-shadow')) box.expandByObject(o, true); });
  return { h: (box.max.y - box.min.y) * ratio, dx: box.max.x - box.min.x, dz: box.max.z - box.min.z,
    feet: Math.abs(box.min.y - st.y) * ratio, cx: (box.min.x + box.max.x) / 2 - st.x, cz: (box.min.z + box.max.z) / 2 - st.z };
});

test.describe('the figure on foot', () => {
  const errors = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto('/?fast=1&buildings=baked');
    await page.waitForFunction(() => {
      const b = window.__ug?.bakedStats;
      return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady;
    }, null, { timeout: 240000 });
    await ev(() => window.__ug.modes.activate('pedestrian'));
    await page.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 30000 });
  });
  test.afterAll(async () => { expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  test('drawn in its original colours, at the walker, in the scene', async () => {
    await place('KX');
    const meshes = await figureMeshes();
    expect(meshes.length).toBe(2);
    expect(meshes.some((m) => m.visible)).toBe(true);
    const has = (c) => meshes.some((m) => m.color.every((v, i) => Math.abs(v - c[i]) < 0.01));
    expect(has([0.799, 0.402, 0.042])).toBe(true);
    expect(has([0.402, 0.133, 0.708])).toBe(true);
    expect(meshes.some((m) => m.instanceColor)).toBe(false);
    expect(await ev(() => window.__ug.scene.children.some((c) => c.name === 'player'))).toBe(true);
  });

  test('true size, 1.78 m at Master 1 and at Master 1.5, standing on the walker', async () => {
    for (const master of [1, 1.5]) {
      await setMaster(master);
      await wait(700);
      const b = await figureBox();
      expect(b.h, `height at Master ${master}`).toBeGreaterThan(1.7);
      expect(b.h).toBeLessThan(1.86);
      expect(b.dx).toBeLessThanOrEqual(1.2);
      expect(b.dz).toBeLessThanOrEqual(1.2);
      expect(b.feet).toBeLessThanOrEqual(0.15);
      expect(Math.abs(b.cx)).toBeLessThan(0.35);
      expect(Math.abs(b.cz)).toBeLessThan(0.35);
    }
    await setMaster(1);
    await wait(500);
  });

  test('the clip follows the state: idle, run, walk, jump, and the pose moves', async () => {
    await place('KX');
    await wait(800);
    expect((await player()).clip).toBe('Idle_Loop');
    await page.keyboard.down('w');
    await wait(1500);
    expect((await player()).clip).toBe('Jog_Fwd_Loop');
    const spread = await ev(async () => {
      const u = window.__ug, v = new window.__ugTHREE.Vector3(), hs = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        u.player.figure.boneWorldPosition('foot_l', v);
        hs.push(v.y * u.masterHeight.ratio);
      }
      return Math.max(...hs) - Math.min(...hs);
    });
    await page.keyboard.up('w');
    expect(spread, 'the left foot lifts as the figure runs').toBeGreaterThanOrEqual(0.05);
    await ev(() => window.__ug.modes.physics.set('pedestrian', 'speed', 2));
    await page.keyboard.down('w');
    await wait(1500);
    expect((await player()).clip).toBe('Walk_Loop');
    await page.keyboard.up('w');
    await ev(() => window.__ug.modes.physics.set('pedestrian', 'speed', 6));
    await place('KX');
    const jump = await ev(async () => {
      const ped = window.__ug.modes.registry.get('pedestrian');
      ped.press('jump');
      let air = false, jumpClip = false;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (ped.playerState().state === 'air') { air = true; if (window.__ug.player.debug().clip === 'Jump_Loop') jumpClip = true; }
      }
      return { air, jumpClip };
    });
    expect(jump).toEqual({ air: true, jumpClip: true });
  });

  test('the camera is over the shoulder at 22 mm, with the cursor free', async () => {
    await place('KX');
    await wait(500);
    const c = await camInfo();
    expect(c.third).toBe(true);
    expect(Math.abs(c.focal - 22)).toBeLessThan(0.01);
    expect(c.look).toBe('drag');
    expect(c.dNeck).toBeGreaterThan(3.7);
    expect(c.dNeck).toBeLessThan(4.8);
    expect(c.above).toBeGreaterThan(1.5);
    expect(c.above).toBeLessThan(2.9);
    expect(c.behind).toBeGreaterThan(0.9);
    expect(c.neckNdc[0], 'right-shoulder camera: the figure stands left of centre').toBeGreaterThan(-0.35);
    expect(c.neckNdc[0]).toBeLessThan(-0.03);
    expect(Math.abs(c.pelvisNdc[0])).toBeLessThan(0.6);
    expect(c.pelvisNdc[1]).toBeGreaterThan(-0.9);
    expect(c.pelvisNdc[1]).toBeLessThan(0.3);
  });

  test('drag orbits; the figure walks where the camera points', async () => {
    await place('KX');
    await wait(500);
    const a = await camInfo();
    await drag(100, 0);
    const b = await camInfo();
    const turn = wrap(b.yaw - a.yaw);
    expect(turn, 'dragging right turns the view right').toBeLessThan(-0.35);
    expect(turn).toBeGreaterThan(-0.65);
    expect(Math.abs(b.dNeck - a.dNeck)).toBeLessThan(0.3);
    await drag(0, 600);
    const down = (await camInfo()).pitch;
    await drag(0, -1500, 15);
    const up = (await camInfo()).pitch;
    // the rig's display pitch is clamped to -1.20 and 0.70 rad
    expect(down).toBeGreaterThan(-1.25);
    expect(down).toBeLessThan(-1.1);
    expect(up).toBeGreaterThan(0.55);
    expect(up).toBeLessThan(0.75);
    const p0 = await bodyState();
    await hold('w', 1000);
    const p1 = await bodyState();
    const moved = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
    expect(Math.abs(wrap(moved - (await camInfo()).yaw))).toBeLessThan(0.2);
  });

  test('scroll and pinch change the distance without zooming the page', async () => {
    await place('KX');
    await wait(500);
    await page.mouse.move(720, 450);
    await ev(() => { window.__wheels = []; window.addEventListener('wheel', (e) => window.__wheels.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented })); });
    const d0 = (await camInfo()).dNeck;
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
    await wait(300);
    const d1 = (await camInfo()).dNeck;
    expect(d1).toBeGreaterThan(d0 * 1.3);
    for (let i = 0; i < 50; i++) await page.mouse.wheel(0, 100);
    await wait(300);
    const far = (await camInfo()).dNeck;
    expect(far).toBeGreaterThan(10.5);
    expect(far).toBeLessThan(13.0);
    for (let i = 0; i < 80; i++) await page.mouse.wheel(0, -100);
    await wait(500);
    const near = (await camInfo()).dNeck;
    expect(near).toBeGreaterThan(1.5);
    expect(near).toBeLessThan(2.4);
    // a trackpad pinch is a wheel event with ctrlKey: it moves the camera and the page does not zoom
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 100);
    await wait(300);
    const before = (await camInfo()).dNeck;
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await wait(300);
    expect((await camInfo()).dNeck).toBeLessThan(before);
    const log = await ev(() => window.__wheels.filter((w) => w.ctrl));
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((w) => w.prevented)).toBe(true);
    expect(await ev(() => window.visualViewport.scale)).toBe(1);
  });

  test('V switches to first person at the eye and back; the lens and the look input follow', async () => {
    await place('KX');
    await wait(500);
    await page.keyboard.press('v');
    await wait(600);
    const first = await ev(() => {
      const u = window.__ug, ped = u.modes.registry.get('pedestrian'), st = ped.playerState(), ratio = u.masterHeight.ratio;
      return { third: ped.isThirdPerson(), eye: (u.camera.position.y - st.y) * ratio, dx: u.camera.position.x - st.x, dz: u.camera.position.z - st.z,
        focal: u.lensSystem.getFocalLength(), slider: Number(document.getElementById('focalLength').value), look: u.modes.look.mode,
        view: ped.debug().view, view2: u.modes.ctx.playerView.isThirdPerson() };
    });
    expect(first.third).toBe(false);
    expect(first.view2).toBe(false);
    expect(first.eye).toBeGreaterThan(1.69);
    expect(first.eye).toBeLessThan(1.71);
    expect(Math.abs(first.dx)).toBeLessThan(0.05);
    expect(Math.abs(first.dz)).toBeLessThan(0.05);
    expect(Math.abs(first.focal - first.slider)).toBeLessThan(0.01);
    expect(first.look).toBe('lock');
    expect((await figureMeshes()).some((m) => m.visible)).toBe(false);
    await page.keyboard.press('v');
    await wait(700);
    const c = await camInfo();
    expect(c.third).toBe(true);
    expect(Math.abs(c.focal - 22)).toBeLessThan(0.01);
    expect(c.look).toBe('drag');
  });

  test('heading follows the run: forward, then back', async () => {
    await place('KX');
    await wait(500);
    await page.keyboard.down('w');
    await wait(1500);
    let heading = (await bodyState()).heading, yaw = (await camInfo()).yaw;
    await page.keyboard.up('w');
    expect(Math.abs(wrap(heading - yaw))).toBeLessThan(0.15);
    await page.keyboard.down('s');
    await wait(1500);
    heading = (await bodyState()).heading; yaw = (await camInfo()).yaw;
    await page.keyboard.up('s');
    expect(Math.abs(wrap(heading - (yaw + Math.PI)))).toBeLessThan(0.3);
  });

  test('playerState and ctx.playerView', async () => {
    await place('KX');
    await wait(500);
    await page.keyboard.down('w');
    await wait(1500);
    const s = await ev(() => {
      const ped = window.__ug.modes.registry.get('pedestrian'), st = ped.playerState(), b = ped.body;
      return { st, bx: b.x, bz: b.z, by: b.y, third: ped.isThirdPerson(), pv: window.__ug.modes.ctx.playerView.isThirdPerson(), loaded: window.__ug.modes.ctx.playerView.figureLoaded() };
    });
    await page.keyboard.up('w');
    for (const k of ['x', 'y', 'z', 'heading', 'state', 'speed', 'jet', 'jetLevel', 'underwater', 'thirdPerson']) expect(s.st, k).toHaveProperty(k);
    expect(s.st.x).toBe(s.bx);
    expect(s.st.z).toBe(s.bz);
    expect(Math.abs(s.st.y - s.by)).toBeLessThan(1e-6);
    expect(s.st.speed).toBeGreaterThan(5.5);
    expect(s.st.speed).toBeLessThan(6.5);
    expect(s.st.state).toBe('ground');
    expect(s.st.jet).toBe(false);
    expect(s.st.jetLevel).toBe(0);
    expect(s.st.underwater).toBe(false);
    expect(s.st.thirdPerson).toBe(s.third);
    expect(s.pv).toBe(true);
    expect(s.loaded).toBe(true);
    await ev(() => window.__ug.modes.activate('deity'));
    expect(await ev(() => window.__ug.modes.ctx.playerView.isThirdPerson())).toBe(false);
    await ev(() => window.__ug.modes.activate('pedestrian'));
    await page.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
  });

  test('swimming in the Thames is third person, with the swim clips', async () => {
    await place('THAMES');
    const s = await bodyState();
    expect(s.state).toBe('swim');
    expect(s.thirdPerson).toBe(true);
    expect((await player()).clip).toBe('Swim_Idle_Loop');
    await page.keyboard.down('w');
    await wait(1500);
    expect((await player()).clip).toBe('Swim_Fwd_Loop');
    await page.keyboard.up('w');
  });
});

test.describe('the view rules, with the figure held back and in the tunnel', () => {
  test('before the figure lands the view is first person; it changes to third person once when it lands', async ({ browser }) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let release; const gate = new Promise((r) => { release = r; });
    await p.route('**/models/player/*.glb', (route) => gate.then(() => route.continue()));
    try {
      await p.goto('/?fast=1&buildings=baked');
      await p.waitForFunction(() => {
        const b = window.__ug?.bakedStats;
        return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady;
      }, null, { timeout: 240000 });
      await p.evaluate(() => window.__ug.modes.activate('pedestrian'));
      await p.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
      await p.waitForTimeout(1500);
      const before = await p.evaluate(() => {
        const u = window.__ug, ped = u.modes.registry.get('pedestrian'), st = ped.playerState(), r = u.masterHeight.ratio;
        return { third: ped.isThirdPerson(), loaded: u.modes.ctx.playerView.figureLoaded(), eye: (u.camera.position.y - st.y) * r };
      });
      expect(before.third).toBe(false);
      expect(before.loaded).toBe(false);
      expect(before.eye).toBeGreaterThan(1.65);
      release();
      const seq = await p.evaluate(async () => {
        const ped = window.__ug.modes.registry.get('pedestrian'), out = [], t0 = performance.now();
        while (performance.now() - t0 < 5000) { await new Promise((r) => requestAnimationFrame(r)); out.push(ped.isThirdPerson()); }
        return out;
      });
      let up = 0, down = 0;
      for (let i = 1; i < seq.length; i++) { if (!seq[i - 1] && seq[i]) up++; if (seq[i - 1] && !seq[i]) down++; }
      expect(up, 'one false-to-true change').toBe(1);
      expect(down).toBe(0);
      expect(seq.at(-1)).toBe(true);
    } finally { release(); await p.close(); }
  });

  test('V pressed twice before the figure lands keeps first person afterwards', async ({ browser }) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let release; const gate = new Promise((r) => { release = r; });
    await p.route('**/models/player/*.glb', (route) => gate.then(() => route.continue()));
    try {
      await p.goto('/?fast=1&buildings=baked');
      await p.waitForFunction(() => {
        const b = window.__ug?.bakedStats;
        return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady;
      }, null, { timeout: 240000 });
      await p.evaluate(() => window.__ug.modes.activate('pedestrian'));
      await p.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
      await p.keyboard.press('v');
      await p.keyboard.press('v');
      release();
      await p.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 30000 });
      const seq = await p.evaluate(async () => {
        const ped = window.__ug.modes.registry.get('pedestrian'), out = [], t0 = performance.now();
        while (performance.now() - t0 < 3000) { await new Promise((r) => requestAnimationFrame(r)); out.push(ped.isThirdPerson()); }
        return out;
      });
      expect(seq.some(Boolean)).toBe(false);
    } finally { release(); await p.close(); }
  });

  test('the GLB is fetched after the opening has landed, once', async ({ browser }) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.addInitScript(() => { window.addEventListener('ug:intro-done', () => { window.__introDoneAt = performance.now(); }); });
    try {
      await p.goto('/');
      await p.waitForFunction(() => window.__introDoneAt !== undefined, null, { timeout: 150000 });
      await p.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /models\/player\/.*\.glb/.test(e.name)), null, { timeout: 60000 });
      const r = await p.evaluate(() => ({
        introDone: window.__introDoneAt,
        glb: performance.getEntriesByType('resource').filter((e) => /models\/player\/.*\.glb/.test(e.name)).map((e) => ({ name: e.name, start: e.startTime })),
      }));
      expect(r.glb.length).toBe(1);
      expect(r.glb[0].start).toBeGreaterThan(r.introDone);
      await p.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 30000 });
    } finally { await p.close(); }
  });

  test('stations: first person in the shaft and the tunnel whatever V says; the street returns the choice', async ({ browser }) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await p.goto('/?fast=1&buildings=baked');
      await p.waitForFunction(() => {
        const b = window.__ug?.bakedStats;
        return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady && window.__ug.lineBranchCenterPts.size > 5;
      }, null, { timeout: 240000 });
      await p.evaluate(() => window.__ug.modes.activate('pedestrian'));
      await p.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
      await p.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 30000 });
      // a real station: stand at its entrance, E opens the chooser, row 1 is the first platform
      const at = await p.evaluate(() => {
        const ped = window.__ug.modes.registry.get('pedestrian'), n = ped.network;
        const stop = n.paths.find((q) => !q.lineId.startsWith('og:') && q.stops.length)?.stops.find((x) => x.stop.depthM > 10)?.stop;
        return stop ? { x: stop.x, z: stop.z } : null;
      });
      expect(at).not.toBeNull();
      await p.evaluate(({ x, z }) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw: 0 }), at);
      await p.waitForTimeout(800);
      expect(await p.evaluate(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson())).toBe(true);
      await p.keyboard.press('e');
      await p.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 10000 });
      await p.evaluate(() => window.__ug.modes.registry.get('pedestrian').chooseRow(0));
      const seen = [];
      for (let i = 0; i < 200; i++) {
        await p.waitForTimeout(40);
        const s = await p.evaluate(() => { const ped = window.__ug.modes.registry.get('pedestrian'); return { phase: ped.debug().phase, third: ped.isThirdPerson() }; });
        seen.push(s);
        if (s.phase === 'tunnel') break;
      }
      expect(seen.some((s) => s.phase === 'shaft')).toBe(true);
      // never third person once the shaft has begun (the first frames of the descent may still be the street's)
      const firstShaft = seen.findIndex((s) => s.phase === 'shaft');
      expect(seen.slice(firstShaft).every((s) => s.phase !== 'shaft' && s.phase !== 'tunnel' ? true : !s.third)).toBe(true);
      expect(seen.at(-1).phase).toBe('tunnel');
      await p.keyboard.press('v');
      await p.keyboard.press('v');
      expect(await p.evaluate(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson())).toBe(false);
    } finally { await p.close(); }
  });
});
