// player-vehicles-helpers.mjs: what lane D's two specs share (sprint 14Oct26w, D-053 items 2 and 3). Not a spec and not
// a node test (neither glob matches the name). Every function takes the shared page.

export const POSES = {
  KX: [164.9, -2507.9, 0],              // open ground south of King's Cross, 118 m clear north
  ALLEY: [2870.0, -719.6, Math.PI / 2], // a narrow street east of Bank, facades 2 to 6 m away
  BANK: [2743.9, -760.9, Math.PI],      // street, 82 m clear to the south, 9 m to the north
  THAMES: [885.1, -145.1, 0],           // mid-river by Waterloo Bridge
  WHITEHALL: [110, 350, 0],
};

export const api = (page) => {
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const h = { ev, wait };

  h.boot = async (url = '/?fast=1&buildings=baked') => {
    await page.goto(url);
    await page.waitForFunction(() => {
      const b = window.__ug?.bakedStats;
      return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady;
    }, null, { timeout: 240000 });
    await ev(() => window.__ug.setRenderQualityMode('manual'));
  };
  h.activatePedestrian = async () => {
    await ev(() => window.__ug.modes.activate('pedestrian'));
    await page.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 60000 });
  };
  h.place = async (name, o = {}) => {
    const [x, z, yaw] = POSES[name];
    await ev(([x, z, yaw]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw }), [o.x ?? x, o.z ?? z, o.yaw ?? yaw]);
    await wait(o.settle ?? 600);
  };
  h.setMaster = (v) => ev((v) => {
    const el = document.getElementById('masterHeight');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    window.__ug.structureMorph.flush();
  }, v);
  h.drag = async (dx, dy, steps = 5) => {
    const x0 = 1440 * 0.6, y0 = 450;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps);
    await page.mouse.up(); await wait(250);
  };
  h.keysDown = (...ks) => ev((ks) => { for (const k of ks) window.__ug.fpsControls.keys.add(k); }, ks);
  h.keysUp = (...ks) => ev((ks) => { for (const k of ks) window.__ug.fpsControls.keys.delete(k); }, ks);
  h.releaseKeys = () => ev(() => window.__ug.fpsControls.keys.clear());

  /**
   * Run frames until the mode clock has advanced by `seconds`, calling the in-page `probe` source each frame with
   * (t, u) and collecting what it returns. `probe` is a function body string; it sees `u` (window.__ug), `ped`, `T`
   * (THREE) and `ratio`. `at` maps time offsets (s) to key changes: [{ t, down: [...], up: [...], press: 'jump' | 'use' }].
   */
  h.sample = (seconds, probe, at = []) => ev(async ({ seconds, probe, at }) => {
    const u = window.__ug, ctx = u.modes.ctx, T = window.__ugTHREE, ped = u.modes.registry.get('pedestrian');
    const fn = new Function('t', 'u', 'ped', 'T', 'ratio', 'dt', probe);
    const keys = u.fpsControls.keys, out = [], t0 = ctx.time, pending = at.map((a) => ({ ...a, done: false }));
    let last = t0;
    for (let i = 0; i < 8000 && ctx.time - t0 < seconds; i++) {
      for (const a of pending) if (!a.done && ctx.time - t0 >= a.t) { a.done = true; for (const k of a.down ?? []) keys.add(k); for (const k of a.up ?? []) keys.delete(k); if (a.press) ped.press(a.press); }
      const t = ctx.time - t0;
      const r = fn(t, u, ped, T, u.masterHeight.ratio, ctx.time - last);
      last = ctx.time;
      if (r !== undefined) out.push(r);
      await new Promise((res) => requestAnimationFrame(res));
    }
    return out;
  }, { seconds, probe, at });

  /** The mannequin's meshes (never the shadow's) and whether each is visible through its ancestors. */
  h.figureMeshes = () => ev(() => {
    const u = window.__ug, out = [];
    u.scene.children.find((c) => c.name === 'player').traverse((o) => {
      if (!o.isSkinnedMesh || o.name.startsWith('player-shadow')) return;
      let a = o, v = true; while (a) { if (!a.visible) v = false; a = a.parent; }
      out.push(v);
    });
    return out;
  });
  h.figureVisible = async () => (await h.figureMeshes()).some(Boolean);

  /** Visible meshes under a named group of the player (the group and every ancestor visible). */
  h.visibleUnder = (name) => ev((name) => {
    const player = window.__ug.scene.children.find((c) => c.name === 'player');
    let n = 0;
    player.traverse((g) => {
      if (g.name !== name) return;
      g.traverse((o) => {
        if (!o.isMesh) return;
        let a = o, v = true; while (a) { if (!a.visible) v = false; a = a.parent; }
        if (v) n++;
      });
    });
    return n;
  }, name);

  /** A named group's box: min/max in canonical axes, the centre, the display sizes. */
  h.groupBox = (name) => ev((name) => {
    const u = window.__ug, T = window.__ugTHREE, ratio = u.masterHeight.ratio;
    const player = u.scene.children.find((c) => c.name === 'player');
    let g = null; player.traverse((o) => { if (o.name === name) g = o; });
    if (!g) return null;
    g.updateWorldMatrix(true, true);
    const b = new T.Box3().expandByObject(g, true);
    const s = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
    return { min: b.min.toArray(), max: b.max.toArray(), centre: c.toArray(), dx: s.x, dz: s.z, dyDisplay: s.y * ratio, ratio };
  }, name);

  return h;
};
