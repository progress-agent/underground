// sun.spec.js: Lane D (sprint 23Sep26w, D-037). Time-of-day slider and
// near-camera shadows in the running app.
//
// Pinned here:
//   1. The Dawn-to-Dusk slider changes the sun's direction and colour in the air.
//   2. Shadows default ON, the toggle persists, and so does the slider.
//   3. An underground camera's lighting (lights, fog, clear colour) does not
//      change with the slider, and no shadow map is rendered there.
//   4. Automatic quality drops shadows first, before resolution.
//   5. With shadows on, a street-level frame is darker than with them off and
//      is never black (the NaN-through-bloom trap).
//
// Deliberately NOT measured: frames per second. The GPU is shared during the
// sprint; integration measures shadows on versus off serially.

import { test, expect } from '@playwright/test';

async function boot(page, url = '/?fast=1&buildings=baked') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSun && window.__ug.groundReady),
    null, { timeout: 60000 });
}

function place(page, [x, y, z], [tx, ty, tz]) {
  return page.evaluate(([p, t]) => {
    const u = window.__ug;
    u.fpsControls.enabled = false;
    u.camera.position.set(...p);
    u.controls.target.set(...t);
  }, [[x, y, z], [tx, ty, tz]]);
}

const frames = (page, n = 3) => page.evaluate(n => new Promise(r => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);

async function setSlider(page, value) {
  await page.evaluate(v => {
    document.getElementById('hudDetails').open = true;
    const e = document.getElementById('sunTime');
    e.value = String(v);
    e.dispatchEvent(new Event('input'));
  }, value);
  await frames(page, 3);
}

// Everything the lighting regime writes, read back from the live scene.
const snapshot = page => page.evaluate(() => {
  const u = window.__ug, s = u.scene;
  const sun = s.getObjectByName('sunLight'), amb = s.getObjectByName('ambientLight');
  const hemi = s.getObjectByName('hemiFill'), und = s.getObjectByName('undergroundLight');
  const dir = sun.position.clone().sub(sun.target.position).normalize().toArray().map(v => +v.toFixed(9));
  const clear = new (window.__ugTHREE.Color)(); u.composer.renderer.getClearColor(clear);
  return {
    dir, sun: [sun.color.getHex(), +sun.intensity.toFixed(9)],
    ambient: [amb.color.getHex(), +amb.intensity.toFixed(9)],
    hemi: [hemi.color.getHex(), +hemi.intensity.toFixed(9)], under: +und.intensity.toFixed(9),
    fog: [s.fog.color.getHex(), +s.fog.near.toFixed(6), +s.fog.far.toFixed(6)], clear: clear.getHex(),
  };
});

test('slider moves and recolours the sun; shadows default on; both persist', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, '/?skipintro=1');
  await place(page, [0, 400, 0], [0, 400, 600]);
  await frames(page, 5);

  // Defaults: the legacy sun, shadows on.
  await expect(page.locator('#sunShadows')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => ({
    enabled: window.__ug.composer.renderer.shadowMap.enabled,
    cast: window.__ug.scene.getObjectByName('sunLight').castShadow,
    on: window.__ugSun.shadowsEnabled, chunk: window.__ugSun.status.chunkPatched,
  }))).toEqual({ enabled: true, cast: true, on: true, chunk: true });
  const legacy = await snapshot(page);
  const legacyDir = [2000, 600, 1500].map(v => v / Math.hypot(2000, 600, 1500));
  legacy.dir.forEach((v, i) => expect(v).toBeCloseTo(legacyDir[i], 6));
  expect(legacy.sun[0]).toBe(0xfff4e6);

  await setSlider(page, 0);
  const dawn = await snapshot(page);
  await setSlider(page, 500);
  const noon = await snapshot(page);
  await setSlider(page, 1000);
  const dusk = await snapshot(page);
  const angle = (a, b) => Math.acos(Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0))) * 180 / Math.PI;
  expect(angle(dawn.dir, noon.dir)).toBeGreaterThan(20);
  expect(angle(dawn.dir, dusk.dir)).toBeGreaterThan(90);
  expect(dawn.dir[1]).toBeGreaterThan(0); // no night
  expect(dusk.dir[1]).toBeGreaterThan(0);
  expect(new Set([dawn.sun[0], noon.sun[0], dusk.sun[0]]).size).toBe(3);
  expect(dawn.sun[1]).toBeLessThan(noon.sun[1]);
  expect(dawn.clear).not.toBe(noon.clear);

  // Toggle off, then reload: slider and toggle come back as left.
  await page.click('#sunShadows');
  await expect(page.locator('#sunShadows')).toHaveAttribute('aria-pressed', 'false');
  await frames(page, 3);
  expect(await page.evaluate(() => window.__ugSun.status.active)).toBe(false);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('ug:prefs:v2')));
  expect(prefs.sunTime).toBe(1);
  expect(prefs.sunShadows).toBe(false);
  await page.reload();
  await page.waitForFunction(() => !!window.__ugSun);
  await expect(page.locator('#sunShadows')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#sunTime').inputValue()).toBe('1000');
  expect(await page.evaluate(() => window.__ugSun.time)).toBe(1);
  expect(errors).toEqual([]);
});

test('underground lighting is invariant to the slider and renders no shadow map', async ({ page }) => {
  await boot(page, '/?skipintro=1');
  // Shallow clay (clay clarity lifts this towards daylight), deep chalk, and
  // a tunnel-depth pose outside the centre: all below the local surface.
  for (const pose of [[0, -100, 0], [0, -330, 0], [-6000, -60, 3000]]) {
    await place(page, pose, [pose[0], pose[1], pose[2] + 500]);
    await setSlider(page, Math.round(1000 * await page.evaluate(() => window.__ugSun.DEFAULT_SUN_TIME)));
    await frames(page, 4);
    const status = await page.evaluate(() => ({ ...window.__ugSun.status, fit: undefined }));
    expect(status.airWeight).toBe(0);
    expect(status.active).toBe(false);
    const reference = await snapshot(page);
    for (const v of [0, 300, 500, 800, 1000]) {
      await setSlider(page, v);
      const rendered = await page.evaluate(() => window.__ugSun.status.rendered);
      await frames(page, 3);
      expect(await snapshot(page), `pose ${pose} slider ${v}`).toEqual(reference);
      expect(await page.evaluate(() => window.__ugSun.status.rendered)).toBe(rendered);
    }
  }
});

test('Automatic quality drops shadows first, before resolution', async ({ page }) => {
  await page.addInitScript(() => {
    const raf = requestAnimationFrame.bind(window); let synthetic;
    window.requestAnimationFrame = fn => raf(time => {
      if (fn.name === 'tick' && window.__slowFrameProbe) { synthetic ??= time; synthetic += 25; fn(synthetic); } else fn(time);
    });
  });
  await boot(page);
  await page.waitForFunction(() => window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal,
    null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__ug.renderQualityMode)).toBe('auto');
  await place(page, [0, 400, 0], [0, 300, 600]);
  await frames(page, 5);
  expect(await page.evaluate(() => window.__ug.adaptiveQuality.get().shadows)).toBe(true);
  expect(await page.evaluate(() => window.__ugSun.status.active)).toBe(true);
  await page.evaluate(() => { window.__slowFrameProbe = true; });
  // First observation without shadows (level 2; level 1 only thins the
  // clouds, D-040): resolution is still full.
  const first = await (await page.waitForFunction(() => {
    const u = window.__ug, a = u.adaptiveQuality.get();
    return a.shadows === false ? { level: a.level, shadows: a.shadows, clouds: a.clouds, scale: u.renderQuality.get().scale, samples: u.renderQuality.get().samples } : false;
  }, null, { timeout: 20000, polling: 'raf' })).jsonValue();
  expect(first).toEqual({ level: 2, shadows: false, clouds: 'thin', scale: 1, samples: 4 });
  await page.waitForFunction(() => window.__ugSun.status.adaptiveShadows === false && window.__ugSun.status.active === false);
  // The user's toggle is untouched: Automatic only suspends shadows.
  expect(await page.evaluate(() => window.__ugSun.shadowsEnabled)).toBe(true);
});

test('shadows darken a street-level view and never blacken the frame', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await boot(page);
  await page.waitForFunction(() => window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal,
    null, { timeout: 60000 });
  await page.evaluate(() => window.__ug.setRenderQualityMode('manual'));
  // Low over the City looking west along the river-side blocks, noon sun.
  await place(page, [1800, 420, 300], [900, 120, 200]);
  await setSlider(page, 500);
  const mean = () => page.evaluate(() => {
    const u = window.__ug, r = u.composer.renderer, gl = r.getContext();
    u.composer.render(0);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, black = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l; if (l < 2) black++;
    }
    return { mean: sum / (w * h), blackFraction: black / (w * h) };
  });
  await page.evaluate(() => window.__ugSun.setShadowsEnabled(true, { persist: false }));
  await frames(page, 6);
  expect(await page.evaluate(() => window.__ugSun.status.active)).toBe(true);
  const on = await mean();
  await page.evaluate(() => window.__ugSun.setShadowsEnabled(false, { persist: false }));
  await frames(page, 6);
  const off = await mean();
  expect(on.mean).toBeGreaterThan(20);
  expect(on.blackFraction).toBeLessThan(0.05);
  expect(on.mean).toBeLessThan(off.mean * 0.995);
});
