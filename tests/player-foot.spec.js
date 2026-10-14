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
    out.push({ visible: v, color: o.material.color.toArray(), instanced: !!o.isInstancedMesh });
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
    expect(meshes.some((m) => m.instanced), 'drawn with plain per-mesh colour, never per-instance colour').toBe(false);
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

  for (const pressV of [false, true]) {
    test(`stations: first person in the shaft and the tunnel whatever V says; the street returns the choice (V ${pressV ? 'pressed first' : 'untouched'})`, async ({ browser }) => {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const third = () => p.evaluate(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson());
      const phase = () => p.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug().phase);
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
        if (pressV) { await p.keyboard.press('v'); await p.waitForTimeout(500); expect(await third()).toBe(false); } else expect(await third()).toBe(true);
        await p.keyboard.press('e');
        await p.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 10000 });
        await p.evaluate(() => window.__ug.modes.registry.get('pedestrian').chooseRow(0));
        const seen = [];
        for (let i = 0; i < 400; i++) {
          await p.waitForTimeout(40);
          const s = { phase: await phase(), third: await third() };
          seen.push(s);
          if (s.phase === 'tunnel') break;
        }
        expect(seen.at(-1).phase).toBe('tunnel');
        const firstShaft = seen.findIndex((s) => s.phase === 'shaft');
        expect(firstShaft).toBeGreaterThanOrEqual(0);
        expect(seen.slice(firstShaft).some((s) => s.third), 'first person on every sampled frame of the shaft and the tunnel').toBe(false);
        // V in the tunnel changes the choice and nothing else
        await p.keyboard.press('v');
        await p.keyboard.press('v');
        await p.waitForTimeout(200);
        expect(await third()).toBe(false);
        // up to the street: the arrival card's first row
        await p.keyboard.press('e');
        await p.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 15000 });
        await p.evaluate(() => window.__ug.modes.registry.get('pedestrian').chooseRow(0));
        await p.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
        await p.waitForTimeout(1000);
        expect(await third(), 'back at the street: the choice').toBe(!pressV);
      } finally { await p.close(); }
    });
  }
});

// ── the rest of lane P: line of sight, the shadow, the flames and the flying pose, the label cover ─────────────
test.describe('the figure in the street', () => {
  const errors = [];
  let pg;
  const pev = (fn, arg) => pg.evaluate(fn, arg);
  const pwait = (ms) => pg.waitForTimeout(ms);
  const pplace = async (name) => {
    const [x, z, yaw] = POSES[name];
    await pev(([x, z, yaw]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw }), [x, z, yaw]);
    await pwait(1000);
  };
  /** One frame of flame and pose data per animation frame. */
  const sample = (frames) => pev(async (n) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const d = window.__ug.player.debug(), ped = window.__ug.modes.registry.get('pedestrian'), st = ped.playerState();
      rows.push({ state: st.state, jet: ped.body.jet, count: d.flames.count, lengths: d.flames.lengthM.slice(), fly: d.poseWeights.fly, clip: d.clip });
    }
    return rows;
  }, frames);

  test.beforeAll(async ({ browser }) => {
    pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pg.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await pg.goto('/?fast=1&buildings=baked');
    await pg.waitForFunction(() => {
      const b = window.__ug?.bakedStats;
      return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady;
    }, null, { timeout: 240000 });
    await pev(() => window.__ug.modes.activate('pedestrian'));
    await pg.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 30000 });
    await pg.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 30000 });
  });
  test.afterAll(async () => { expect(errors, 'no console or page errors').toEqual([]); await pg.close(); });

  test('line of sight: in a narrow street the camera is pulled in and never inside or behind a facade', async () => {
    await pplace('ALLEY');
    const probe = () => pev(() => {
      const u = window.__ug, T = window.__ugTHREE, ratio = u.masterHeight.ratio, c = u.modes.collision, cp = u.camera.position;
      const nk = new T.Vector3(); u.player.figure.boneWorldPosition('neck_01', nk);
      const inside = c.buildingsNear(cp.x, cp.z, 2).some((b) => cp.x >= b.minX && cp.x <= b.maxX && cp.z >= b.minZ && cp.z <= b.maxZ && cp.y >= b.baseY && cp.y <= b.roofY);
      const half = Math.hypot(cp.x - nk.x, cp.z - nk.z) / 2 + 2;
      const d = [nk.x - cp.x, nk.y - cp.y, nk.z - cp.z], f = [cp.x, cp.y, cp.z];
      let crosses = false;
      for (const b of c.buildingsNear((cp.x + nk.x) / 2, (cp.z + nk.z) / 2, half)) {
        const lo = [b.minX, b.baseY, b.minZ], hi = [b.maxX, b.roofY, b.maxZ];
        let t0 = 0, t1 = 1, ok = true;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(d[a]) < 1e-12) { if (f[a] < lo[a] || f[a] > hi[a]) ok = false; continue; }
          let s = (lo[a] - f[a]) / d[a], e = (hi[a] - f[a]) / d[a];
          if (s > e) [s, e] = [e, s];
          t0 = Math.max(t0, s); t1 = Math.min(t1, e);
          if (t0 > t1) ok = false;
        }
        if (ok) crosses = true;
      }
      return { inside, crosses, dist: new T.Vector3(cp.x, cp.y * ratio, cp.z).distanceTo(new T.Vector3(nk.x, nk.y * ratio, nk.z)) };
    });
    const first = await probe();
    expect(first.inside).toBe(false);
    expect(first.crosses).toBe(false);
    expect(first.dist, 'pulled in').toBeGreaterThan(0.45);
    expect(first.dist).toBeLessThan(3.9);
    // a full turn in 24 drags: the camera never enters a box and never loses the figure behind one
    for (let k = 0; k < 24; k++) {
      await pg.mouse.move(864, 450); await pg.mouse.down();
      for (let i = 1; i <= 5; i++) await pg.mouse.move(864 + 10 * i, 450);
      await pg.mouse.up(); await pwait(120);
      const r = await probe();
      expect(r.inside, `turn ${k}`).toBe(false);
      expect(r.crosses, `turn ${k}`).toBe(false);
    }
  });

  test('line of sight: lane S\'s hook can shorten the view', async () => {
    await pplace('KX');
    const r = await pev(() => {
      const c = window.__ug.modes.collision, a = { x: 164.9, y: 130, z: -2507.9 }, b = { x: 164.9, y: 130, z: -2497.9 };
      const open = c.lineOfSight(a, b);
      c.setExtraSegmentHit(() => 0.5);
      const hooked = c.lineOfSight(a, b);
      c.setExtraSegmentHit(() => false);
      return { open: open.clear, hookedClear: hooked.clear, t: hooked.t, after: c.lineOfSight(a, b).clear };
    });
    expect(r.open).toBe(true);
    expect(r.hookedClear).toBe(false);
    expect(r.t).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(r.after).toBe(true);
  });

  test('the shadow: visible on the street at noon, off in first person and in the river', async () => {
    await pev(() => { window.__ugSun.setTime(0.5, { persist: false }); window.__ug.setRenderQualityMode('manual'); });
    await pplace('KX');
    await pwait(1000);
    const r = await pev(() => {
      const u = window.__ug, gl = u.composer.renderer.getContext(), cv = u.composer.renderer.domElement;
      const read = () => { u.composer.render(); const px = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      u.player.setShadowEnabled(true); const A = read();
      u.player.setShadowEnabled(false); const B = read();
      u.player.setShadowEnabled(true);
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < cv.width * cv.height; i++) {
        const la = A[i * 4] + A[i * 4 + 1] + A[i * 4 + 2], lb = B[i * 4] + B[i * 4 + 1] + B[i * 4 + 2];
        if (lb > 30 && la < lb * 0.92) { n++; sx += i % cv.width; sy += Math.floor(i / cv.width); }
      }
      const st = u.modes.registry.get('pedestrian').playerState();
      const v = new window.__ugTHREE.Vector3(st.x, st.y, st.z).project(u.camera);
      return { n, cx: sx / Math.max(1, n), cy: cv.height - sy / Math.max(1, n), fx: (v.x * 0.5 + 0.5) * cv.width, fy: (1 - (v.y * 0.5 + 0.5)) * cv.height };
    });
    expect(r.n, 'darker pixels with the shadow on').toBeGreaterThanOrEqual(400);
    expect(r.n).toBeLessThanOrEqual(60000);
    expect(Math.hypot(r.cx - r.fx, r.cy - r.fy)).toBeLessThan(250);
    expect((await pev(() => window.__ug.player.debug().shadow)).visible).toBe(true);
    await pg.keyboard.press('v');
    await pwait(500);
    expect((await pev(() => window.__ug.player.debug().shadow)).visible).toBe(false);
    await pg.keyboard.press('v');
    await pplace('THAMES');
    expect((await pev(() => window.__ug.player.debug().shadow)).visible).toBe(false);
  });

  test('the figure costs about 13.7k triangles, and its shadow about as many again', async () => {
    await pplace('KX');
    const r = await pev(async () => {
      const u = window.__ug, rr = u.composer.renderer;
      rr.info.autoReset = false;
      const count = async () => { rr.info.reset(); for (let i = 0; i < 20; i++) await new Promise((x) => requestAnimationFrame(x)); return rr.info.render.triangles / 20; };
      u.player.setShadowEnabled(false);
      const withFigure = await count();
      u.player.group.visible = false;
      const without = await count();
      u.player.group.visible = true;
      u.player.setShadowEnabled(true);
      await new Promise((x) => requestAnimationFrame(x)); await new Promise((x) => requestAnimationFrame(x));
      const withShadow = await count();
      rr.info.autoReset = true;
      return { figure: withFigure - without, shadow: withShadow - withFigure };
    });
    expect(r.figure).toBeGreaterThan(13000);
    expect(r.figure).toBeLessThan(15000);
    expect(r.shadow).toBeGreaterThan(12000);
    expect(r.shadow).toBeLessThan(15500);
  });

  test('flames: none on a tap of Space; four, sized by thrust, on both hands and both feet while it fires', async () => {
    await pplace('KX');
    await pg.keyboard.down(' '); await pwait(80); await pg.keyboard.up(' ');
    const tap = await sample(90);
    expect(tap.some((r) => r.state === 'air')).toBe(true);
    expect(tap.every((r) => r.count === 0)).toBe(true);
    expect(tap.some((r) => r.jet)).toBe(false);
    await pwait(1000);
    await pg.keyboard.down(' ');
    await pwait(1000);
    const hold = await pev(async () => {
      const u = window.__ug, T = window.__ugTHREE, v = new T.Vector3(), names = ['hand_l', 'hand_r', 'foot_l', 'foot_r'], rows = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const d = u.player.debug(), ratio = u.masterHeight.ratio;
        rows.push({ jet: u.modes.registry.get('pedestrian').body.jet, count: d.flames.count, lengths: d.flames.lengthM,
          off: d.flames.base.map((b, k) => { u.player.figure.boneWorldPosition(names[k], v); return Math.hypot(b[0] - v.x, (b[1] - v.y) * ratio, b[2] - v.z); }),
          dirY: d.flames.dir.map((x) => x[1]) });
      }
      return rows;
    });
    for (const r of hold) {
      expect(r.jet).toBe(true);
      expect(r.count).toBe(4);
      for (const l of r.lengths) expect(l).toBeGreaterThanOrEqual(0.12);
      for (const o of r.off) expect(o).toBeLessThan(0.2);
      for (const y of r.dirY) expect(y).toBeLessThan(-0.8);
    }
    // thrust: the level the body reports sizes the flame
    const mean = (lvl) => pev(async (l) => {
      const ls = [];
      for (let i = 0; i < 60; i++) {
        const ped = window.__ug.modes.registry.get('pedestrian');
        ped.body.jetLevel = l;
        await new Promise((r) => requestAnimationFrame(r));
        if (ped.body.jet) ls.push(window.__ug.player.debug().flames.lengthM.reduce((a, b) => a + b, 0) / 4);
      }
      return ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length);
    }, lvl);
    const low = await mean(0.3), high = await mean(1.0);
    await pev(() => { delete window.__ug.modes.registry.get('pedestrian').body.jetLevel; });
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(0.8 * high);
    await pg.keyboard.up(' ');
  });

  test('flying pose: held while firing, arms down and palms to the ground, held until landing, gone after', async () => {
    await pg.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').playerState().state === 'ground', null, { timeout: 60000 });
    await pplace('KX');
    await pg.keyboard.down(' ');
    await pwait(900);
    const pose = await pev(() => {
      const u = window.__ug, T = window.__ugTHREE, r = u.masterHeight.ratio, st = u.modes.registry.get('pedestrian').playerState(), v = new T.Vector3();
      const h = (n) => { u.player.figure.boneWorldPosition(n, v); return (v.y - st.y) * r; };
      return { fly: u.player.debug().poseWeights.fly, clip: u.player.debug().clip, hl: h('hand_l'), hr: h('hand_r'), ual: h('upperarm_l'), uar: h('upperarm_r'),
        foot: Math.max(h('foot_l'), h('foot_r')), lowestOther: Math.min(h('hand_l'), h('hand_r'), h('pelvis')) };
    });
    expect(pose.fly).toBeGreaterThanOrEqual(0.95);
    expect(pose.clip).toBe('Jump_Loop');
    for (const [hand, arm] of [[pose.hl, pose.ual], [pose.hr, pose.uar]]) {
      expect(hand).toBeGreaterThan(0.45);
      expect(hand).toBeLessThan(1.1);
      expect(arm - hand).toBeGreaterThanOrEqual(0.25);
    }
    expect(pose.foot, 'the feet are the lowest').toBeLessThan(pose.lowestOther);
    await pwait(700);
    await pg.keyboard.up(' ');
    const rows = await pev(async () => {
      const ped = window.__ug.modes.registry.get('pedestrian'), rows = [];
      for (let i = 0; i < 1500; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        rows.push({ state: ped.playerState().state, jet: ped.body.jet, fly: window.__ug.player.debug().poseWeights.fly });
        if (rows.filter((x) => x.state === 'ground').length > 50) break;
      }
      return rows;
    });
    const landed = rows.findIndex((r) => r.state === 'ground');
    expect(landed).toBeGreaterThan(0);
    for (const r of rows.filter((x) => x.state === 'air' && !x.jet)) expect(r.fly, 'held until landing').toBeGreaterThanOrEqual(0.95);
    const after = rows.slice(landed);
    for (let i = 1; i < after.length; i++) expect(after[i].fly).toBeLessThanOrEqual(after[i - 1].fly + 1e-9);
    expect(after[Math.min(after.length - 1, 40)].fly, 'gone within 0.6 s of landing').toBeLessThanOrEqual(0.05);
    // a plain jump never fires it
    await pwait(500);
    await pg.keyboard.down(' '); await pwait(80); await pg.keyboard.up(' ');
    const plain = await sample(100);
    expect(Math.max(...plain.map((r) => r.fly))).toBe(0);
  });

  test('no flames in the river', async () => {
    await pplace('THAMES');
    await pg.keyboard.down(' ');
    const rows = await sample(90);
    await pg.keyboard.up(' ');
    expect(rows.every((r) => r.count === 0)).toBe(true);
  });

  test('label cover: the figure\'s rectangle contains it, the cover hides a name behind it, and V clears it', async () => {
    await pplace('KX');
    await pwait(500);
    const r = await pev(() => {
      const u = window.__ug, T = window.__ugTHREE, rect = u.player.screenRect;
      if (!rect) return null;
      const proj = (n) => { const v = new T.Vector3(); u.player.figure.boneWorldPosition(n, v); v.project(u.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (1 - (v.y * 0.5 + 0.5)) * innerHeight]; };
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, cover = u.s14pLabelCover;
      return { rect, pts: ['Head', 'foot_l', 'foot_r'].map(proj), hit: cover({ x: cx - 10, y: cy - 5, w: 20, h: 10 }, u.camera), miss: cover({ x: cx + 300, y: cy, w: 20, h: 10 }, u.camera) };
    });
    expect(r).not.toBeNull();
    expect(r.rect.w).toBeGreaterThan(40);
    expect(r.rect.w).toBeLessThan(600);
    expect(r.rect.h).toBeGreaterThan(100);
    expect(r.rect.h).toBeLessThan(900);
    for (const [x, y] of r.pts) {
      expect(x).toBeGreaterThanOrEqual(r.rect.x - 12);
      expect(x).toBeLessThanOrEqual(r.rect.x + r.rect.w + 12);
      expect(y).toBeGreaterThanOrEqual(r.rect.y - 12);
      expect(y).toBeLessThanOrEqual(r.rect.y + r.rect.h + 12);
    }
    expect(r.hit).toBe(true);
    expect(r.miss).toBe(false);
    await pg.keyboard.press('v');
    await pwait(500);
    expect(await pev(() => window.__ug.player.screenRect)).toBeNull();
    await pg.keyboard.press('v');
  });
});
