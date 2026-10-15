// player-vehicles.spec.js: the Drone and the Balloon seen from outside (sprint 14Oct26w, lane D, D-053 items 2 and 3):
// the drone at half a metre across with the over-the-shoulder camera, drag orbiting and the drone flying where the camera
// faces, scroll and the arrows, V for today's first person; the balloon at 16 m with the figure standing in its basket,
// the camera at 40 m coming down to the basket as it is scrolled in; line of sight for the board, the Drone and the
// Balloon; the names hidden behind them; the assets and the cold load.
//
// One page boots once and the tests share it (serial). Timing is on the mode clock; keys through the keyboard or
// fpsControls.keys. Units: display metres = canonical Y x masterHeight.ratio; physics metres = canonical Y / 5.
import { test, expect } from '@playwright/test';
import { POSES, api } from './player-vehicles-helpers.mjs';

test.describe.configure({ mode: 'serial' });

let page, h;
const errors = [];
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const reg = (id) => `window.__ug.modes.registry.get('${id}')`;

/** The camera's display-space numbers relative to a canonical point. */
const camTo = (pt) => h.ev((pt) => {
  const u = window.__ug, T = window.__ugTHREE, ratio = u.masterHeight.ratio, cam = u.camera;
  cam.updateMatrixWorld(true);
  const f = new T.Vector3(); cam.getWorldDirection(f);
  const hx = pt[0] - cam.position.x, hz = pt[2] - cam.position.z;
  const hl = Math.hypot(hx, hz), fl = Math.hypot(f.x, f.z);
  const ndc = new T.Vector3(pt[0], pt[1], pt[2]).project(cam);
  return {
    dist: Math.hypot(hx, (pt[1] - cam.position.y) * ratio, hz), above: (cam.position.y - pt[1]) * ratio,
    dot: hl > 1e-9 ? (f.x * hx + f.z * hz) / (fl * hl) : 1, yaw: Math.atan2(-f.x, -f.z), ndc: [ndc.x, ndc.y], ratio,
    focal: u.lensSystem.getFocalLength(), look: u.modes.look.mode, fov: cam.fov, aspect: cam.aspect,
  };
}, pt);
const dronePos = () => h.ev(() => { const p = window.__ug.modes.registry.get('drone').debug().pos; return [p.x, p.y, p.z]; });
const balloonFloor = () => h.ev(() => { const p = window.__ug.modes.registry.get('balloon').debug().pos; return [p.x, p.y - 7.5, p.z]; });
const bone = (n) => h.ev((n) => { const v = new window.__ugTHREE.Vector3(); window.__ug.player.figure.boneWorldPosition(n, v); return v.toArray(); }, n);
const cameraYaw = () => h.ev(() => { const f = new window.__ugTHREE.Vector3(); window.__ug.camera.getWorldDirection(f); return Math.atan2(-f.x, -f.z); });

async function toDrone(x = 164.9, z = -2507.9, upCanonical = 150, yaw = 0) {
  await h.releaseKeys();
  await h.ev(() => window.__ug.modes.activate('deity'));
  await page.keyboard.press('3');
  await h.wait(300);
  await h.ev(([x, z, up, yaw]) => { const u = window.__ug, g = u.modes.collision.groundHeightAt(x, z) ?? 0; u.modes.registry.get('drone').place({ x, y: g + up, z, yaw, pitch: 0 }); }, [x, z, upCanonical, yaw]);
  await h.wait(2000);
}
async function toBalloon(x = 885.1, z = -145.1) {
  await h.releaseKeys();
  await h.ev(() => window.__ug.modes.activate('deity'));
  await page.keyboard.press('4');
  await h.wait(300);
  await h.ev(([x, z]) => { const u = window.__ug, w = u.modes.ctx.waterSurfaceAt(x, z) ?? 0; u.modes.registry.get('balloon').place({ x, y: w + 151.5 * 5, z, dT: 60, vy: 0 }); }, [x, z]);
  await h.wait(1800);
}
const wheel = async (total, step = 100) => {
  await page.mouse.move(720, 450);
  const n = Math.round(Math.abs(total) / step);
  for (let i = 0; i < n; i++) await page.mouse.wheel(0, Math.sign(total) * step);
  await h.wait(250);
};
const rigDistance = (id) => h.ev((id) => window.__ug.modes.registry.get(id).debug().view.rig.distance, id);

/** The box helpers the line-of-sight checks share: inside a box, and a segment through one (canonical coordinates). */
const LOS_SRC = `
const c = u.modes.collision; c.sync();
const inside = (p, r) => { for (const b of c.buildingsNear(p.x, p.z, r)) if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y > b.baseY && p.y < b.roofY) return true; return false; };
const segHits = (a, b) => {
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, rad = Math.hypot(a.x - b.x, a.z - b.z) / 2 + 2;
  for (const bx of c.buildingsNear(mx, mz, rad)) {
    let t0 = 0, t1 = 1; const d = [b.x - a.x, b.y - a.y, b.z - a.z], lo = [bx.minX, bx.baseY, bx.minZ], hi = [bx.maxX, bx.roofY, bx.maxZ], p = [a.x, a.y, a.z];
    let hit = true;
    for (let k = 0; k < 3 && hit; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (p[k] < lo[k] || p[k] > hi[k]) hit = false; continue; }
      let ta = (lo[k] - p[k]) / d[k], tb = (hi[k] - p[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 >= t1) hit = false;
    }
    if (hit) return true;
  }
  return false;
};`;
const losProbe = (subject) => `${LOS_SRC}
const cam = u.camera.position, ratio_ = u.masterHeight.ratio;
const subj = ${subject};
const g = c.groundHeightAt(cam.x, cam.z);
return { t, inCamera: inside({ x: cam.x, y: cam.y, z: cam.z }, 2), cut: segHits({ x: cam.x, y: cam.y, z: cam.z }, subj), low: g === null ? 0 : (cam.y - g) * ratio_, cam: [cam.x, cam.y, cam.z], subj: [subj.x, subj.y, subj.z], subjInside: inside(subj, 2) };`;

test.describe('the Drone and the Balloon from outside', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    h = api(page);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await h.boot();
    await h.activatePedestrian();
  });
  test.afterAll(async () => { expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  // ── drone ──────────────────────────────────────────────────────────────────────────────────────────────────────
  test('drone 1: it opens in third person at 22 mm with the cursor free, the drone drawn and no figure', async () => {
    await toDrone();
    const d = await camTo(await dronePos());
    expect(await h.ev(() => window.__ug.modes.registry.get('drone').isThirdPerson())).toBe(true);
    expect(d.look).toBe('drag');
    expect(Math.abs(d.focal - 22)).toBeLessThan(0.01);
    expect(await h.ev(() => window.__ug.modes.ctx.playerView.isThirdPerson())).toBe(true);
    expect(await h.visibleUnder('player-drone')).toBeGreaterThan(0);
    expect(await h.figureVisible()).toBe(false);
  });

  test('drone 2: true size at Master 1 and 1.5: about half a metre across, a few centimetres thick, at the drone', async () => {
    for (const master of [1, 1.5]) {
      await h.setMaster(master);
      await h.wait(800);
      const b = await h.groupBox('player-drone');
      const p = await dronePos();
      expect(Math.max(b.dx, b.dz), `across at Master ${master}`).toBeGreaterThanOrEqual(0.45);
      expect(Math.max(b.dx, b.dz)).toBeLessThanOrEqual(0.60);
      expect(b.dyDisplay).toBeGreaterThanOrEqual(0.05);
      expect(b.dyDisplay).toBeLessThanOrEqual(0.16);
      expect(Math.abs(b.centre[0] - p[0])).toBeLessThan(0.05);
      expect(Math.abs(b.centre[2] - p[2])).toBeLessThan(0.05);
    }
    await h.setMaster(1);
    await h.wait(500);
  });

  test('drone 3: the camera follows over the shoulder, the drone just below the middle of the view', async () => {
    const p = await dronePos();
    const c = await camTo(p);
    expect(c.dist).toBeGreaterThanOrEqual(1.9);
    expect(c.dist).toBeLessThanOrEqual(2.6);
    expect(c.dot).toBeGreaterThan(0.9);
    expect(c.above).toBeGreaterThanOrEqual(0.2);
    expect(c.above).toBeLessThanOrEqual(1.0);
    expect(Math.abs(c.ndc[0])).toBeLessThan(0.25);
    expect(c.ndc[1]).toBeGreaterThanOrEqual(-0.6);
    expect(c.ndc[1]).toBeLessThanOrEqual(0.2);
  });

  test('drone 4: a drag orbits the camera and the drone turns to fly where it faces; W flies level; E rises, Q sinks', async () => {
    const y0 = await cameraYaw();
    await h.drag(100, 0);
    const y1 = await cameraYaw();
    expect(-wrap(y1 - y0), 'dragging right turns the view right').toBeGreaterThanOrEqual(0.35);
    expect(-wrap(y1 - y0)).toBeLessThanOrEqual(0.65);
    await h.wait(1500);
    const dyaw = await h.ev(() => window.__ug.modes.registry.get('drone').debug().yaw);
    expect(Math.abs(wrap(dyaw - (await cameraYaw())))).toBeLessThan(0.15);
    const a = await h.ev(() => window.__ug.modes.registry.get('drone').debug().pos);
    const s = await h.sample(1.5, `const d = u.modes.registry.get('drone').debug(); return { speed: d.speed, x: d.pos.x, y: d.pos.y, z: d.pos.z };`, [{ t: 0, down: ['w'] }]);
    await h.releaseKeys();
    const b = s[s.length - 1];
    const cy = await cameraYaw();
    const move = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    expect(Math.abs(wrap(move - cy)), 'flies where the camera faces').toBeLessThan(0.25);
    expect(Math.max(...s.map((r) => r.speed))).toBeGreaterThan(10);
    expect(Math.abs(b.y - a.y) / 5).toBeLessThan(0.5);
    await h.wait(1500);
    const up0 = (await dronePos())[1];
    await h.sample(1, 'return 1', [{ t: 0, down: ['e'] }]);
    await h.releaseKeys();
    await page.waitForFunction(() => Math.abs(window.__ug.modes.registry.get('drone').debug().vel.y) < 0.05, null, { timeout: 15000 });
    const up1 = (await dronePos())[1];
    expect((up1 - up0) / 5, 'E rises').toBeGreaterThanOrEqual(3);
    await h.sample(1, 'return 1', [{ t: 0, down: ['q'] }]);
    await h.releaseKeys();
    await page.waitForFunction(() => Math.abs(window.__ug.modes.registry.get('drone').debug().vel.y) < 0.05, null, { timeout: 15000 });
    expect((up1 - (await dronePos())[1]) / 5, 'Q sinks').toBeGreaterThanOrEqual(3);
    await h.releaseKeys();
  });

  test('drone 5: scroll zooms between 1.4 and 12 m; Ctrl+wheel (a pinch) is cancelled and never zooms the page', async () => {
    await toDrone();
    const d0 = await rigDistance('drone');
    await wheel(500);
    const d1 = await rigDistance('drone');
    expect(d1 / d0).toBeGreaterThanOrEqual(1.3);
    await wheel(5000);
    const d2 = await rigDistance('drone');
    expect(d2).toBeGreaterThanOrEqual(10.5); expect(d2).toBeLessThanOrEqual(13.0);
    await wheel(-8000);
    const d3 = await rigDistance('drone');
    expect(d3).toBeGreaterThanOrEqual(1.3); expect(d3).toBeLessThanOrEqual(1.8);
    await h.ev(() => { window.__wheelSeen = []; window.addEventListener('wheel', (e) => window.__wheelSeen.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented })); });
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await h.wait(200);
    const seen = await h.ev(() => ({ seen: window.__wheelSeen, scale: window.visualViewport.scale }));
    expect(seen.seen.some((e) => e.ctrl && e.prevented)).toBe(true);
    expect(seen.scale).toBe(1);
    await toDrone();
  });

  test('drone 6: ArrowLeft turns the third-person view at about 90 degrees a second', async () => {
    const y0 = await cameraYaw();
    await h.sample(1, 'return 1', [{ t: 0, down: ['arrowleft'] }]);
    await h.releaseKeys();
    const turn = wrap((await cameraYaw()) - y0);
    expect(turn).toBeGreaterThanOrEqual(1.4);
    expect(turn).toBeLessThanOrEqual(1.75);
  });

  test('drone 7: V gives today\'s first-person Drone and back again', async () => {
    await toDrone();
    await page.keyboard.press('v');
    await h.wait(700);
    const p = await dronePos();
    const c = await h.ev(() => {
      const u = window.__ug, cam = u.camera, d = u.modes.registry.get('drone').debug();
      return { look: u.modes.look.mode, dx: Math.abs(cam.position.x - d.pos.x), dy: Math.abs(cam.position.y - d.pos.y), dz: Math.abs(cam.position.z - d.pos.z),
        fov: cam.fov, expected: 2 * Math.atan(Math.tan(55 * Math.PI / 180) / cam.aspect) * 180 / Math.PI, speed: d.speed, third: u.modes.registry.get('drone').isThirdPerson() };
    });
    expect(c.third).toBe(false);
    expect(c.look).toBe('lock');
    expect(Math.max(c.dx, c.dy, c.dz)).toBeLessThan(0.01);
    expect(c.speed).toBe(0);
    expect(Math.abs(c.fov - c.expected)).toBeLessThan(0.05);
    expect(await h.visibleUnder('player-drone')).toBe(0);
    expect(p).toBeTruthy();
    // a mouse turn at speed banks the first-person camera, as it always did
    await h.keysDown('w');
    let maxRight = -1;
    for (let i = 0; i < 12; i++) {
      await h.ev(() => window.__ug.modes.registry.look(-25, 0));
      await h.sample(1 / 30, 'return 1');
      maxRight = Math.max(maxRight, await h.ev(() => new window.__ugTHREE.Vector3(1, 0, 0).applyQuaternion(window.__ug.camera.quaternion).y));
    }
    await h.releaseKeys();
    expect(maxRight, 'the right side rises in a left bank').toBeGreaterThan(0);
    await page.keyboard.press('v');
    await h.wait(700);
    const t = await camTo(await dronePos());
    expect(Math.abs(t.focal - 22)).toBeLessThan(0.01);
    expect(t.look).toBe('drag');
    expect(await h.ev(() => window.__ug.modes.registry.get('drone').isThirdPerson())).toBe(true);
  });

  test('drone 8: leaving restores the field of view exactly, the orbit controls, and takes the drone away', async () => {
    await h.ev(() => window.__ug.modes.activate('deity'));
    await h.wait(300);
    const fov0 = await h.ev(() => window.__ug.camera.fov);
    await page.keyboard.press('3');
    await h.wait(700);
    await page.keyboard.press('1');
    await h.wait(300);
    expect(await h.ev(() => window.__ug.camera.fov)).toBe(fov0);
    expect(await h.ev(() => window.__ug.controls.enabled)).toBe(true);
    expect(await h.visibleUnder('player-drone')).toBe(0);
  });

  test('drone 9: its playerState has the shared shape', async () => {
    await toDrone();
    const s = await h.ev(() => ({ ...window.__ug.modes.registry.get('drone').playerState(), third: window.__ug.modes.registry.get('drone').isThirdPerson() }));
    for (const k of ['x', 'y', 'z', 'heading', 'state', 'speed', 'jet', 'jetLevel', 'underwater', 'thirdPerson', 'board', 'lean', 'push']) expect(s).toHaveProperty(k);
    expect(s.state).toBe('drone');
    expect(s.board).toBe(false);
    expect(s.thirdPerson).toBe(s.third);
  });

  // ── balloon ────────────────────────────────────────────────────────────────────────────────────────────────────
  test('balloon 1: it opens in third person at 22 mm with the cursor free', async () => {
    await toBalloon();
    const c = await camTo(await balloonFloor());
    expect(await h.ev(() => window.__ug.modes.registry.get('balloon').isThirdPerson())).toBe(true);
    expect(c.look).toBe('drag');
    expect(Math.abs(c.focal - 22)).toBeLessThan(0.01);
  });

  test('balloon 2: the figure stands in the basket, idle, and stays inside its walls as the view orbits', async () => {
    expect(await h.figureVisible()).toBe(true);
    const b = await h.ev(() => {
      const u = window.__ug, T = window.__ugTHREE, ratio = u.masterHeight.ratio, box = new T.Box3();
      u.player.figure.box(box);
      const fl = u.modes.registry.get('balloon').debug().pos.y - 7.5;
      return { lift: (box.min.y - fl) * ratio, height: (box.max.y - box.min.y) * ratio, clip: u.player.debug().clip };
    });
    expect(b.lift).toBeGreaterThanOrEqual(0.02); expect(b.lift).toBeLessThanOrEqual(0.12);
    expect(b.height).toBeGreaterThanOrEqual(1.70); expect(b.height).toBeLessThanOrEqual(1.86);
    expect(b.clip).toBe('Idle_Loop');
    const probe = `const bl = u.modes.registry.get('balloon').debug().pos; const fl = bl.y - 7.5; let worst = 0, under = Infinity;
      for (const n of ['Head', 'neck_01', 'pelvis', 'hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r']) {
        const v = new T.Vector3(); u.player.figure.boneWorldPosition(n, v);
        worst = Math.max(worst, Math.abs(v.x - bl.x), Math.abs(v.z - bl.z)); under = Math.min(under, v.y - fl);
      } return { worst, under };`;
    const run = h.sample(4, probe);
    for (let i = 0; i < 26; i++) { await h.drag(50, 0, 2); }
    const s = await run;
    expect(Math.max(...s.map((r) => r.worst))).toBeLessThanOrEqual(0.65);
    expect(Math.min(...s.map((r) => r.under))).toBeGreaterThan(0);
  });

  test('balloon 3: true size at Master 1 and 1.5: a 16 m envelope, 16.5 m tall, mouth 3.4 m up, top under 20.8 m', async () => {
    for (const master of [1, 1.5]) {
      await h.setMaster(master);
      await h.wait(900);
      const env = await h.groupBox('player-balloon-envelope'), all = await h.groupBox('player-balloon');
      const fl = (await balloonFloor())[1], ratio = env.ratio;
      expect(Math.max(env.dx, env.dz), `width at Master ${master}`).toBeGreaterThanOrEqual(15.0);
      expect(Math.max(env.dx, env.dz)).toBeLessThanOrEqual(17.0);
      expect(env.dyDisplay).toBeGreaterThanOrEqual(15.5); expect(env.dyDisplay).toBeLessThanOrEqual(17.5);
      expect((env.min[1] - fl) * ratio).toBeGreaterThanOrEqual(3.0); expect((env.min[1] - fl) * ratio).toBeLessThanOrEqual(3.8);
      expect((all.max[1] - fl) * ratio).toBeGreaterThanOrEqual(19.0); expect((all.max[1] - fl) * ratio).toBeLessThanOrEqual(20.8);
    }
    await h.setMaster(1);
    await h.wait(500);
  });

  test('balloon 4: the far camera is 40 m out with the whole balloon in the view', async () => {
    await toBalloon();
    const fl = await balloonFloor();
    const ratio = await h.ev(() => window.__ug.masterHeight.ratio);
    const c = await camTo([fl[0], fl[1] + 10.5 / ratio, fl[2]]);
    expect(c.dist).toBeGreaterThanOrEqual(36); expect(c.dist).toBeLessThanOrEqual(44);
    const basket = await camTo([fl[0], fl[1] + 0.6 / ratio, fl[2]]), top = await camTo([fl[0], fl[1] + 19.9 / ratio, fl[2]]);
    for (const q of [basket, top]) { expect(Math.abs(q.ndc[0])).toBeLessThanOrEqual(0.95); expect(Math.abs(q.ndc[1])).toBeLessThanOrEqual(0.95); }
  });

  test('balloon 5: scrolling in brings the camera down to the basket, the figure near the middle', async () => {
    await wheel(-1500);
    await h.wait(400);
    const fl = await balloonFloor();
    const neck = await bone('neck_01');
    const c = await camTo(neck);
    expect(c.dist).toBeGreaterThanOrEqual(4.0); expect(c.dist).toBeLessThanOrEqual(8.5);
    const cam = await camTo([fl[0], fl[1], fl[2]]);
    expect(cam.above, 'camera height above the floor').toBeGreaterThanOrEqual(1.0); expect(cam.above).toBeLessThanOrEqual(6.0);
    expect(Math.abs(c.ndc[0])).toBeLessThan(0.35);
    expect(Math.abs(c.ndc[1])).toBeLessThan(0.5);
  });

  test('balloon 6: the camera is never inside the envelope, at 6, 12 and 20 m or while scrolling in, through orbits and pitch drags', async () => {
    const probe = `const bl = u.modes.registry.get('balloon').debug().pos; const fl = bl.y - 7.5, ratio_ = u.masterHeight.ratio; const cam = u.camera.position;
      const env = u.scene.children.find((c) => c.name === 'player'); let mesh = null; env.traverse((o) => { if (o.name === 'player-balloon-envelope') mesh = o; });
      const camH = (cam.y - fl) * ratio_; let maxR = 0; const pa = mesh.geometry.attributes.position, v = new T.Vector3();
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld); const hh = (v.y - fl) * ratio_; if (Math.abs(hh - camH) <= 0.5) maxR = Math.max(maxR, Math.hypot(v.x - bl.x, v.z - bl.z)); }
      const horiz = Math.hypot(cam.x - bl.x, cam.z - bl.z);
      const ys = []; const tmp = new T.Box3().expandByObject(mesh, true);
      const outside = camH < (tmp.min.y - fl) * ratio_ || camH > (tmp.max.y - fl) * ratio_ || horiz > maxR + 0.2;
      return { outside, camH, horiz, maxR };`;
    for (const target of [6, 12, 20, null]) {
      await toBalloon();
      if (target !== null) {
        const cur = await rigDistance('balloon');
        await wheel(Math.round(Math.log(target / cur) / 0.0015));
      }
      await h.wait(300);
      const run = h.sample(5, probe);
      for (let i = 0; i < 26; i++) await h.drag(50, 0, 2);
      await h.drag(0, 600, 4); await h.drag(0, -600, 4);
      if (target === null) await wheel(-3000);
      const s = await run;
      expect(s.filter((r) => !r.outside), `inside the envelope at ${target}`).toEqual([]);
    }
  });

  test('balloon 7: E lights the burner and its flame, and it goes out when E is let go', async () => {
    await toBalloon();
    await h.keysDown('e');
    await h.wait(1000);
    expect(await h.ev(() => window.__ug.vehicles.debug().balloon.burnerFlame)).toBe(true);
    expect(await h.visibleUnder('player-balloon-flame')).toBeGreaterThan(0);
    await h.keysUp('e');
    await h.wait(300);
    expect(await h.ev(() => window.__ug.vehicles.debug().balloon.burnerFlame)).toBe(false);
  });

  test('balloon 8: V gives the basket\'s own eye and T still warps time; V again is third person', async () => {
    await toBalloon();
    await page.keyboard.press('v');
    await h.wait(1200);
    const c = await h.ev(() => {
      const u = window.__ug, cam = u.camera, d = u.modes.registry.get('balloon').debug();
      return { dx: Math.abs(cam.position.x - d.pos.x), dy: Math.abs(cam.position.y - d.pos.y), dz: Math.abs(cam.position.z - d.pos.z), look: u.modes.look.mode,
        focal: u.lensSystem.getFocalLength(), pref: Number(document.getElementById('focalLength').value), third: u.modes.registry.get('balloon').isThirdPerson() };
    });
    expect(c.third).toBe(false);
    expect(Math.max(c.dx, c.dy, c.dz)).toBeLessThan(0.01);
    expect(c.look).toBe('drag');
    expect(Math.abs(c.focal - c.pref)).toBeLessThan(0.01);
    expect(await h.figureVisible()).toBe(false);
    await page.keyboard.press('t');
    expect(await h.ev(() => window.__ug.modes.registry.get('balloon').warp)).toBe(true);
    await expect(page.locator('#ug-mode-hint')).toContainText('ON');
    await page.keyboard.press('t');
    await page.keyboard.press('v');
    await h.wait(1200);
    expect(await h.ev(() => window.__ug.modes.registry.get('balloon').isThirdPerson())).toBe(true);
  });

  test('balloon 9: with the figure still on its way the Balloon is first person, then one change to third', async ({ browser }) => {
    test.setTimeout(240000);
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const hh = api(p);
    let release = null;
    await p.route('**/models/player/*.glb', (route) => { if (/UAL1/.test(route.request().url())) { release = () => route.continue(); } else route.continue(); });
    await hh.boot();
    await p.evaluate(() => window.__ug.modes.activate('balloon'));
    await p.waitForTimeout(1500);
    expect(await p.evaluate(() => window.__ug.modes.registry.get('balloon').isThirdPerson())).toBe(false);
    const changes = await p.evaluate(() => { window.__chg = []; let last = window.__ug.modes.registry.get('balloon').isThirdPerson(); const id = setInterval(() => { const v = window.__ug.modes.registry.get('balloon').isThirdPerson(); if (v !== last) { window.__chg.push([last, v]); last = v; } }, 16); window.__chgStop = () => clearInterval(id); return 0; });
    void changes;
    expect(release, 'the figure request is waiting').toBeTruthy();
    release();
    await p.waitForFunction(() => window.__ug.modes.registry.get('balloon').isThirdPerson(), null, { timeout: 8000 });
    await p.waitForTimeout(800);
    const seen = await p.evaluate(() => { window.__chgStop(); return window.__chg; });
    expect(seen).toEqual([[false, true]]);
    await p.close();
  });

  test('balloon 10: leaving takes the figure and the balloon away; its playerState is the basket', async () => {
    await toBalloon();
    const st = await h.ev(() => ({ ...window.__ug.modes.registry.get('balloon').playerState() }));
    expect(st.state).toBe('basket');
    expect(st.board).toBe(false);
    await page.keyboard.press('1');
    await h.wait(400);
    expect(await h.figureVisible()).toBe(false);
    expect(await h.visibleUnder('player-balloon')).toBe(0);
  });

  // ── los ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('los 1: on the board in a narrow street the camera is never inside a box and never behind one', async () => {
    await h.releaseKeys();
    await h.ev(() => window.__ug.modes.activate('pedestrian'));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
    await h.place('ALLEY');
    await h.ev(() => window.__ug.modes.registry.get('pedestrian').setBoard(true));
    await h.wait(400);
    const probe = losProbe(`(() => { const v = new T.Vector3(); u.player.figure.boneWorldPosition('neck_01', v); return { x: v.x, y: v.y, z: v.z }; })()`);
    const all = [];
    for (let k = 0; k < 3; k++) {
      await h.place('ALLEY', { settle: 300 });
      all.push(...await h.sample(2, probe, [{ t: 0, down: ['w'] }]));
      await h.releaseKeys();
    }
    expect(all.filter((r) => r.inCamera)).toEqual([]);
    expect(all.filter((r) => r.cut)).toEqual([]);
    expect(Math.min(...all.map((r) => r.low))).toBeGreaterThanOrEqual(0.3 - 1e-3);
  });

  test('los 2: the Drone in a narrow street, orbited and flown at a facade, never has the camera inside or behind a box', async () => {
    await toDrone(POSES.ALLEY[0], POSES.ALLEY[1], 25, POSES.ALLEY[2]);
    const probe = losProbe(`(() => { const d = u.modes.registry.get('drone').debug().pos; return { x: d.x, y: d.y, z: d.z }; })()`);
    const run = h.sample(5, probe, [{ t: 3, down: ['w'] }]);
    for (let i = 0; i < 24; i++) await h.drag(50, 0, 2);
    const s = await run;
    await h.releaseKeys();
    expect(s.filter((r) => r.inCamera)).toEqual([]);
    expect(s.filter((r) => r.cut)).toEqual([]);
    expect(Math.min(...s.map((r) => r.low))).toBeGreaterThanOrEqual(0.3 - 1e-3);
  });

  test('los 3: the Balloon above the roofs, orbited and pitched, never has the camera inside or behind a box', async () => {
    await h.releaseKeys();
    await h.ev(() => window.__ug.modes.activate('deity'));
    await page.keyboard.press('4');
    await h.wait(300);
    await h.ev(([x, z]) => {
      const u = window.__ug, c = u.modes.collision; c.sync();
      let top = c.groundHeightAt(x, z) ?? 0;
      for (const b of c.buildingsNear(x, z, 40)) top = Math.max(top, b.roofY);
      u.modes.registry.get('balloon').place({ x, y: top + 20 * 5 + 7.5, z, dT: 60, vy: 0 });
    }, [POSES.ALLEY[0], POSES.ALLEY[1]]);
    await h.wait(1500);
    const probe = losProbe(`(() => { const b = u.modes.registry.get('balloon').debug().pos; return { x: b.x, y: b.y - 7.5 + 1.3 * 5, z: b.z }; })()`);
    const run = h.sample(6, probe);
    for (let i = 0; i < 26; i++) await h.drag(50, 0, 2);
    await h.drag(0, 600, 4);
    const s = await run;
    expect(s.filter((r) => r.inCamera)).toEqual([]);
    expect(s.filter((r) => r.cut)).toEqual([]);
    expect(Math.min(...s.map((r) => r.low))).toBeGreaterThanOrEqual(0.3 - 1e-3);
  });

  // ── labelcover ─────────────────────────────────────────────────────────────────────────────────────────────────
  test('labelcover 1: names are hidden behind the Drone and the Balloon, and in first person nothing is', async () => {
    await toDrone();
    const d = await h.ev(() => {
      const u = window.__ug, T = window.__ugTHREE, r = u.vehicles.screenRect, p = u.modes.registry.get('drone').debug().pos;
      if (!r) return null;
      const n = new T.Vector3(p.x, p.y, p.z).project(u.camera);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      return { r, nx: (n.x * 0.5 + 0.5) * innerWidth, ny: (1 - (n.y * 0.5 + 0.5)) * innerHeight,
        hide: u.s14dLabelCover({ x: cx - 10, y: cy - 5, w: 20, h: 10 }, u.camera), show: u.s14dLabelCover({ x: r.x + r.w + 40, y: cy - 5, w: 20, h: 10 }, u.camera) };
    });
    expect(d, 'a rectangle for the drone').not.toBeNull();
    expect(d.r.w).toBeGreaterThanOrEqual(20); expect(d.r.w).toBeLessThanOrEqual(900);
    expect(d.r.h).toBeGreaterThanOrEqual(20); expect(d.r.h).toBeLessThanOrEqual(900);
    expect(d.nx).toBeGreaterThanOrEqual(d.r.x); expect(d.nx).toBeLessThanOrEqual(d.r.x + d.r.w);
    expect(d.ny).toBeGreaterThanOrEqual(d.r.y); expect(d.ny).toBeLessThanOrEqual(d.r.y + d.r.h);
    expect(d.hide).toBe(true);
    expect(d.show).toBe(false);
    await page.keyboard.press('v');
    await h.wait(700);
    expect(await h.ev(() => window.__ug.vehicles.screenRect)).toBeNull();
    await toBalloon();
    const b = await h.ev(() => window.__ug.vehicles.screenRect);
    expect(b, 'a rectangle for the balloon').not.toBeNull();
    expect(b.w).toBeGreaterThanOrEqual(50); expect(b.h).toBeGreaterThanOrEqual(50);
    await page.keyboard.press('v');
    await h.wait(1200);
    expect(await h.ev(() => window.__ug.vehicles.screenRect)).toBeNull();
  });

  // ── assets ─────────────────────────────────────────────────────────────────────────────────────────────────────
  test('assets: the board, its texture and its licence are served as files, never the HTML fallback', async () => {
    for (const [path, type] of [['/models/player/skateboard.glb', null], ['/models/player/Textures/colormap.png', 'image/png'], ['/models/player/LICENSE-kenney-mini-skate.txt', null]]) {
      const r = await h.ev(async (path) => { const res = await fetch(path); return { status: res.status, type: res.headers.get('content-type') }; }, path);
      expect(r.status).toBe(200);
      expect(r.type).not.toMatch(/text\/html/);
      if (type) expect(r.type).toBe(type);
    }
  });
});
