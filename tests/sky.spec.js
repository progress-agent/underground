// sky.spec.js: Lane S (sprint 24Sep26h, D-038). Visible sun disc and analytic
// sky in the running app.
//
// Pinned here:
//   1. The disc is centred exactly on the sun light's direction and is 0.53
//      degrees across, at every Master height (the sky ignores exaggeration).
//   2. Sky and disc are never drawn underground or underwater.
//   3. The sky responds to the Dawn-to-Dusk slider, and the GPU matches the
//      CPU mirror (sky.js skyRadianceAt) that the fog coupling relies on.
//   4. ?sky=<name> selects a look without skipping the opening; the hidden
//      Sky row switches looks live.
//   5. The air fog equals the sky's own colour on the horizon (default look).
//   6. With bloom, no look at any sun position produces a NaN or black frame.
//
// Deliberately NOT measured: frame times (the GPU is shared during the sprint).

import { test, expect } from '@playwright/test';

async function boot(page, url = '/?fast=1&buildings=baked') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSun && window.__ugSky && window.__ug.groundReady),
    null, { timeout: 60000 });
}

const frames = (page, n = 3) => page.evaluate(n => new Promise(r => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);

function place(page, [x, y, z], [tx, ty, tz]) {
  return page.evaluate(([p, t]) => {
    const u = window.__ug;
    u.fpsControls.enabled = false;
    u.camera.position.set(...p);
    u.controls.target.set(...t);
  }, [[x, y, z], [tx, ty, tz]]);
}

async function setSun(page, t) {
  await page.evaluate(t => window.__ugSun.setTime(t ?? window.__ugSun.DEFAULT_SUN_TIME, { persist: false }), t);
  await frames(page, 3);
}

// Render the live scene (no post-processing) into a float target through a
// narrow camera aimed at the sun's display direction; return disc statistics.
const measureDisc = (page, { fovDeg = 2, size = 256 } = {}) => page.evaluate(({ fovDeg, size }) => {
  const u = window.__ug, T = window.__ugTHREE, r = u.composer.renderer, cam = u.camera;
  const sunLight = u.scene.getObjectByName('sunLight');
  const light = sunLight.position.clone().sub(sunLight.target.position).normalize();
  const uni = window.__ugSky.mesh.material.uniforms;
  const ratio = cam.userData.masterHeightController?.ratio ?? 1;
  const saved = { fov: cam.fov, aspect: cam.aspect, pos: cam.position.clone(), quat: cam.quaternion.clone() };
  // Canonical look direction whose DISPLAY direction (vertical-scale.js) is the sun's.
  const look = new T.Vector3(light.x, light.y / ratio, light.z).normalize();
  cam.fov = fovDeg; cam.aspect = 1; cam.updateProjectionMatrix();
  cam.lookAt(cam.position.clone().add(look));
  cam.updateMatrixWorld(true);
  const rt = new T.WebGLRenderTarget(size, size, { type: T.FloatType });
  r.setRenderTarget(rt); r.render(u.scene, cam);
  const px = new Float32Array(size * size * 4);
  r.readRenderTargetPixels(rt, 0, 0, size, size, px);
  r.setRenderTarget(null); rt.dispose();
  cam.fov = saved.fov; cam.aspect = saved.aspect; cam.updateProjectionMatrix();
  cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.updateMatrixWorld(true);
  let n = 0, sx = 0, sy = 0, nan = 0, maxSky = 0;
  const lum = i => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  for (let i = 0; i < size * size; i++) {
    const l = lum(i);
    if (!Number.isFinite(l)) { nan++; continue; }
    if (l > 2) { n++; sx += i % size + 0.5; sy += Math.floor(i / size) + 0.5; }
  }
  const focal = (size / 2) / Math.tan(fovDeg / 2 * Math.PI / 180);
  // Sky outside the disc and its one-pixel anti-aliased rim stays under bloom.
  const rimPx = focal * Math.tan(0.265 * Math.PI / 180) + 2;
  for (let i = 0; i < size * size; i++) {
    const dx = i % size + 0.5 - size / 2, dy = Math.floor(i / size) + 0.5 - size / 2;
    if (Math.hypot(dx, dy) > rimPx && Number.isFinite(lum(i))) maxSky = Math.max(maxSky, lum(i));
  }
  return {
    pixels: n, nan, maxSky,
    diameterPx: Math.sqrt(4 * n / Math.PI),
    expectedPx: 2 * focal * Math.tan(0.265 * Math.PI / 180),
    cx: n ? sx / n : null, cy: n ? sy / n : null, centre: size / 2,
    lightVsUniformDeg: light.angleTo(uni.uSunDir.value) * 180 / Math.PI,
    visible: window.__ugSky.mesh.visible,
  };
}, { fovDeg, size });

test('the disc sits on the light direction at 0.53 degrees, at any Master height', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  await place(page, [0, 12000, 0], [0, 11000, 3000]);
  for (const t of [0, null, 0.5, 1]) {
    await setSun(page, t);
    for (const mh of [1.1, 5, 10]) {
      await page.evaluate(v => window.__ug.camera.userData.masterHeightController.setValue(v), mh);
      await frames(page, 2);
      const d = await measureDisc(page);
      const tag = `t=${t} mh=${mh}`;
      expect(d.visible, tag).toBe(true);
      expect(d.nan, tag).toBe(0);
      expect(d.lightVsUniformDeg, tag).toBeLessThan(1e-4);
      expect(Math.abs(d.cx - d.centre), tag).toBeLessThan(1);
      expect(Math.abs(d.cy - d.centre), tag).toBeLessThan(1);
      expect(d.diameterPx / d.expectedPx, tag).toBeGreaterThan(0.95);
      expect(d.diameterPx / d.expectedPx, tag).toBeLessThan(1.05);
      expect(d.maxSky, tag).toBeLessThan(0.88); // only the disc can bloom
    }
  }
  await page.evaluate(() => window.__ug.camera.userData.masterHeightController.setValue(1.1));
  expect(errors).toEqual([]);
});

test('sky and disc are never drawn underground or underwater', async ({ page }) => {
  await boot(page);
  // Clay, chalk, tunnel depth outside the centre: all below the local surface.
  for (const pose of [[0, -100, 0], [0, -330, 0], [-6000, -60, 3000]]) {
    await place(page, pose, [pose[0], pose[1] + 50, pose[2] + 500]);
    for (const t of [0, null, 1]) {
      await setSun(page, t);
      await frames(page, 2);
      const s = await page.evaluate(() => ({ visible: window.__ugSky.mesh.visible, ...window.__ugSky.status }));
      expect(s.visible, `${pose}`).toBe(false);
      expect(s.discWeight).toBe(0);
    }
  }
  // Inside the Thames between London Bridge and Tower Bridge, looking up at the sun.
  const water = await page.evaluate(() => {
    const u = window.__ug;
    // Highest submerged sample, then a little deeper (well inside the blend).
    for (let x = 3000; x <= 3500; x += 25) for (let z = -120; z <= 120; z += 20) {
      for (let y = 80; y > -40; y -= 1) {
        if (u.isSubmergedAt(x, y, z)) return u.isSubmergedAt(x, y - 8, z) ? [x, y - 8, z] : null;
      }
    }
    return null;
  });
  expect(water).not.toBeNull();
  await place(page, water, [water[0] + 300, water[1] + 200, water[2]]);
  await frames(page, 4);
  const s = await page.evaluate(() => ({ visible: window.__ugSky.mesh.visible, ...window.__ugSky.status, air: window.__ugSun.status.airWeight }));
  expect(s.air).toBe(0);
  expect(s.visible).toBe(false);
  // Back in the air it returns.
  await place(page, [water[0], 400, water[2]], [water[0] + 1000, 450, water[2]]);
  await frames(page, 4);
  expect(await page.evaluate(() => window.__ugSky.mesh.visible)).toBe(true);
});

// Sky radiance on the GPU along a few directions (float target, no post), set
// against the CPU mirror.
const skySamples = page => page.evaluate(() => {
  const u = window.__ug, T = window.__ugTHREE, r = u.composer.renderer, K = window.__ugSky;
  const cam = new T.PerspectiveCamera(60, 1, 1, 50000);
  cam.position.set(0, 12000, 0);
  const out = [];
  for (const [az, el] of [[0, 45], [90, 20], [180, 5], [270, 1.5], [135, 60]]) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    const d = new T.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
    cam.lookAt(cam.position.clone().add(d)); cam.updateMatrixWorld(true);
    const rt = new T.WebGLRenderTarget(8, 8, { type: T.FloatType });
    r.setRenderTarget(rt); r.render(u.scene, cam);
    const px = new Float32Array(4); r.readRenderTargetPixels(rt, 4, 4, 1, 1, px);
    r.setRenderTarget(null); rt.dispose();
    // Direction of the centre of pixel (4,4) of an 8x8 target.
    const ndc = new T.Vector3((4.5 / 8) * 2 - 1, (4.5 / 8) * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
    out.push({ gpu: [px[0], px[1], px[2]], cpu: K.sample(ndc).toArray() });
  }
  return out;
});

test('the sky follows the slider and the GPU matches the CPU mirror', async ({ page }) => {
  await boot(page);
  await place(page, [0, 12000, 0], [0, 12000, -1000]);
  const at = {};
  for (const [name, t] of [['dawn', 0], ['morning', null], ['dusk', 1]]) {
    await setSun(page, t);
    at[name] = await skySamples(page);
    for (const s of at[name]) {
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(s.gpu[i] - s.cpu[i]), `${name} ${JSON.stringify(s)}`).toBeLessThan(0.01 + 0.02 * s.cpu[i]);
      }
    }
  }
  const differs = (a, b) => a.some((s, k) => s.gpu.some((v, i) => Math.abs(v - b[k].gpu[i]) > 0.01));
  expect(differs(at.dawn, at.morning)).toBe(true);
  expect(differs(at.dusk, at.morning)).toBe(true);
  expect(differs(at.dawn, at.dusk)).toBe(true);
});

test('?sky= selects a look, keeps the opening, and the hidden row switches looks', async ({ page }) => {
  test.setTimeout(240000); // three page loads
  await page.goto('/?buildings=baked&sky=steel');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSky), null, { timeout: 60000 });
  // D-028: a render setting must not skip the opening's high start.
  expect(await page.evaluate(() => window.__ug.intro.isRunning())).toBe(true);
  expect(await page.evaluate(() => window.__ugSky.look)).toBe('steel');
  await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
  await expect(page.locator('#skyLookRow')).toBeVisible();
  await page.selectOption('#skyLook', 'haze');
  expect(await page.evaluate(() => window.__ugSky.look)).toBe('haze');
  expect(new URL(page.url()).searchParams.get('sky')).toBe('haze');

  // Without ?sky= the row is hidden and the default look applies; a
  // double-click on the Sun label reveals it.
  await boot(page);
  const def = await page.evaluate(() => window.__ugSky.look);
  expect(['clear', 'haze', 'steel']).toContain(def);
  await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
  await expect(page.locator('#skyLookRow')).toBeHidden();
  await page.dblclick('label[for="sunTime"]');
  await expect(page.locator('#skyLookRow')).toBeVisible();
  await page.goto('/?fast=1&buildings=baked&sky=nonsense');
  await page.waitForFunction(() => !!window.__ugSky, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__ugSky.look)).toBe(def);
});

test('the air fog is the sky colour on the horizon ahead', async ({ page }) => {
  await boot(page);
  for (const [pose, target] of [[[3200, 130, -10], [4200, 150, -10]], [[0, 20000, 18000], [0, 0, 0]], [[-8000, 900, 6000], [-8000, 700, 0]]]) {
    await place(page, pose, target);
    for (const t of [0, null, 0.5, 1]) {
      await setSun(page, t);
      const r = await page.evaluate(() => {
        const u = window.__ug, K = window.__ugSky, T = window.__ugTHREE;
        const f = new T.Vector3(); u.camera.getWorldDirection(f);
        const h = new T.Vector3(f.x, 0, f.z).normalize();
        const sky = K.sample(h);
        const l = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b;
        return { look: K.look, fog: u.scene.fog.color.toArray(), sky: sky.toArray(), l, cap: K.params.fogMaxLum, coupling: K.params.fogCoupling, air: window.__ugSun.status.airWeight };
      });
      expect(r.air).toBe(1);
      if (r.coupling < 1 || r.l > r.cap) continue; // glare-capped toward a low sun (covered in sky.test.mjs)
      for (let i = 0; i < 3; i++) expect(Math.abs(r.fog[i] - r.sky[i]), `${pose} t=${t}`).toBeLessThan(0.01);
    }
  }
});

test('no look at any sun position gives a NaN or black frame through bloom', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await boot(page);
  await page.evaluate(() => window.__ug.setRenderQualityMode('manual'));
  const frame = () => page.evaluate(() => {
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
  for (const look of ['clear', 'haze', 'steel', 'flat']) {
    await page.evaluate(l => window.__ugSky.setLook(l, { syncUrl: false }), look);
    for (const t of [0, null, 0.5, 1]) {
      await setSun(page, t);
      // Low over the Pool of London, facing the sun.
      await page.evaluate(() => {
        const u = window.__ug, d = window.__ugSun.state.direction, h = Math.hypot(d.x, d.z);
        u.fpsControls.enabled = false;
        u.camera.position.set(3200, 130, -10);
        u.controls.target.set(3200 + d.x / h * 1000, 180, -10 + d.z / h * 1000);
      });
      await frames(page, 4);
      const f = await frame();
      expect(f.mean, `${look} t=${t}`).toBeGreaterThan(20);
      expect(f.blackFraction, `${look} t=${t}`).toBeLessThan(0.05);
    }
  }
});
