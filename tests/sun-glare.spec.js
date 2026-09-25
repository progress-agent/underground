// sun-glare.spec.js: sprint 25Sep26f, Lane L (D-039). Sun glare and the blue
// line in the running app, measured on the frame the viewer sees (after bloom,
// the lens pass and tone mapping) or on the linear scene where noted.
//
// Pinned here:
//   1. The disc is bounded: a modest level over the bloom threshold, never the
//      old ~38x the sun colour.
//   2. No bloom square: round the sun the final frame falls off radially and
//      is as bright on the diagonals as on the axes (a square halo is brighter
//      on the diagonals, out to 1.4x its half-width).
//   3. The water glint is clamped: looking into a low sun over the Thames no
//      patch of the river saturates.
//   4. The blue line is gone: no dotted column of dark pixels in the sky
//      opposite the sun (the NaN from pow() of a negative base).
//   5. No NaN or black frames at dawn, morning or dusk from the overview and
//      street.
//
// Deliberately NOT measured: frame times (the GPU is shared during the sprint).

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function boot(page) {
  await page.setViewportSize({ width: 1200, height: 750 });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSun && window.__ugSky && window.__ug.groundReady),
    null, { timeout: 60000 });
  await page.evaluate(() => {
    const u = window.__ug;
    u.setRenderQualityMode('manual');
    u.renderQuality.set({ scale: 1, samples: 4 });
    u.controls.enableDamping = false;
    u.fpsControls.enabled = false;
    if (u.flightsGroup) u.flightsGroup.visible = false; // an aircraft crossing the sun is not glare
  });
}

const frames = (page, n = 3) => page.evaluate(n => new Promise(r => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);

async function setSun(page, t) {
  await page.evaluate(t => window.__ugSun.setTime(t ?? window.__ugSun.DEFAULT_SUN_TIME, { persist: false }), t);
  await frames(page, 3);
}

/** Aim the camera at `pos` along the sun's displayed direction, pitched by `dPitchDeg`. */
function faceSun(page, pos, { dPitchDeg = 0, away = false } = {}) {
  return page.evaluate(({ pos, dPitchDeg, away }) => {
    const u = window.__ug, T = window.__ugTHREE, s = window.__ugSun.state.direction;
    const ratio = u.camera.userData.masterHeightController?.ratio ?? 1;
    const h = Math.hypot(s.x, s.z), sign = away ? -1 : 1;
    const el = Math.atan2(s.y * ratio, h) * (away ? 0 : 1) + dPitchDeg * Math.PI / 180;
    u.camera.position.set(...pos);
    // Display-space direction to canonical: y divides by the Master ratio.
    u.controls.target.set(pos[0] + sign * s.x / h * 1000, pos[1] + Math.tan(el) * 1000 / ratio, pos[2] + sign * s.z / h * 1000);
    u.controls.update();
    return new T.Vector3().copy(u.controls.target).sub(u.camera.position).length();
  }, { pos, dPitchDeg, away });
}

/** The final frame (composer output) as 8-bit luminance, plus the sun's pixel. */
const readFrame = page => page.evaluate(() => {
  const u = window.__ug, T = window.__ugTHREE, r = u.composer.renderer, gl = r.getContext();
  u.composer.render(0);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const L = new Float32Array(w * h);
  let sum = 0, black = 0;
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
    L[i] = l; sum += l; if (l < 2) black++;
  }
  // Where the light direction lands on screen (row 0 at the top).
  const sl = u.scene.getObjectByName('sunLight');
  const dir = sl.position.clone().sub(sl.target.position).normalize();
  const p = u.camera.position.clone().add(dir.multiplyScalar(1000)).project(u.camera);
  window.__frameL = L; window.__frameW = w; window.__frameH = h;
  return { w, h, mean: sum / (w * h), blackFraction: black / (w * h), sunX: (p.x + 1) / 2 * w, sunY: (1 - p.y) / 2 * h, sunFront: p.z < 1 };
});

// Luminance at screen (x, y), row 0 at the top, from the last readFrame.
const sampleRays = (page, cx, cy, radii) => page.evaluate(({ cx, cy, radii }) => {
  const L = window.__frameL, w = window.__frameW, h = window.__frameH;
  const at = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    let s = 0, n = 0; // 3x3 mean
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s += L[(h - 1 - (y + dy)) * w + (x + dx)]; n++; }
    return s / n;
  };
  const rays = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    rays.push(radii.map(r => at(cx + Math.cos(a) * r, cy + Math.sin(a) * r)));
  }
  return rays;
}, { cx, cy, radii });

test('the disc is bounded: modest over the bloom threshold, never the old 38x', async ({ page }) => {
  await boot(page);
  await faceSun(page, [0, 12000, 0]);
  for (const t of [0, 0.1, null, 0.5, 0.9, 1]) {
    await setSun(page, t);
    await frames(page, 2);
    const r = await page.evaluate(() => {
      const u = window.__ug, T = window.__ugTHREE, r = u.composer.renderer, cam = u.camera;
      const c = window.__ugSky.mesh.material.uniforms.uDiscColor.value;
      const uniformLuma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      // The linear scene straight down the light, narrow field: the brightest pixel.
      const sl = u.scene.getObjectByName('sunLight');
      const light = sl.position.clone().sub(sl.target.position).normalize();
      const saved = { fov: cam.fov, aspect: cam.aspect, quat: cam.quaternion.clone() };
      cam.fov = 2; cam.aspect = 1; cam.updateProjectionMatrix();
      cam.lookAt(cam.position.clone().add(light)); cam.updateMatrixWorld(true);
      const S = 128, rt = new T.WebGLRenderTarget(S, S, { type: T.FloatType });
      r.setRenderTarget(rt); r.render(u.scene, cam);
      const px = new Float32Array(S * S * 4); r.readRenderTargetPixels(rt, 0, 0, S, S, px);
      r.setRenderTarget(null); rt.dispose();
      cam.fov = saved.fov; cam.aspect = saved.aspect; cam.updateProjectionMatrix();
      cam.quaternion.copy(saved.quat); cam.updateMatrixWorld(true);
      let max = 0, nan = 0;
      for (let i = 0; i < S * S; i++) {
        const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
        if (!Number.isFinite(l)) nan++; else max = Math.max(max, l);
      }
      return { uniformLuma, max, nan };
    });
    const tag = `t=${t}`;
    expect(r.nan, tag).toBe(0);
    expect(r.uniformLuma, tag).toBeGreaterThan(0.88 * 1.5);
    expect(r.uniformLuma, tag).toBeLessThanOrEqual(2.4 + 1e-6);
    // Disc plus the sky under it: well under the old ~38x the sun colour.
    expect(r.max, tag).toBeGreaterThan(0.88);
    expect(r.max, tag).toBeLessThan(2.4 + 0.9);
  }
});

test('no bloom square: the glow round the sun falls off radially and is round', async ({ page }) => {
  await boot(page);
  const radii = [];
  for (let r = 6; r <= 60; r += 3) radii.push(r);
  // Master 5 stands the sun high in open sky; Master 1.1 is the fresh visit.
  for (const [mh, t] of [[5, 0.5], [5, null], [1.1, 0.5]]) {
    await page.evaluate(v => window.__ug.camera.userData.masterHeightController.setValue(v), mh);
    await setSun(page, t);
    await faceSun(page, [0, 14000, 6000]);
    await frames(page, 4);
    const f = await readFrame(page);
    const tag = `mh=${mh} t=${t}`;
    expect(f.sunFront, tag).toBe(true);
    // The lens pass bends the frame a little off-centre, so find the disc's
    // brightest pixel near where the light lands.
    const c = await page.evaluate(({ x, y }) => {
      const L = window.__frameL, w = window.__frameW, h = window.__frameH;
      let best = -1, bx = x, by = y;
      for (let yy = Math.round(y) - 15; yy <= Math.round(y) + 15; yy++) for (let xx = Math.round(x) - 15; xx <= Math.round(x) + 15; xx++) {
        const l = L[(h - 1 - yy) * w + xx]; if (l > best) { best = l; bx = xx; by = yy; }
      }
      return { x: bx, y: by, peak: best };
    }, { x: f.sunX, y: f.sunY });
    const rays = await sampleRays(page, c.x, c.y, radii);
    const bg = Math.min(...rays.map(r => r[r.length - 1]));
    for (let i = 0; i < radii.length; i++) {
      const axis = [0, 2, 4, 6].map(k => rays[k][i]).reduce((a, b) => a + b) / 4;
      const diag = [1, 3, 5, 7].map(k => rays[k][i]).reduce((a, b) => a + b) / 4;
      const excess = Math.max(axis, diag) - bg;
      // Round: diagonals no brighter than the axes beyond noise, at every radius.
      expect(Math.abs(diag - axis), `${tag} r=${radii[i]} axis=${axis.toFixed(1)} diag=${diag.toFixed(1)} bg=${bg.toFixed(1)}`)
        .toBeLessThan(3 + 0.12 * excess);
    }
    // Falls off: along every ray, never brighter further out (3/255 of slack).
    for (const [k, ray] of rays.entries()) {
      for (let i = 1; i < ray.length; i++) expect(ray[i], `${tag} ray ${k} r=${radii[i]}`).toBeLessThan(ray[i - 1] + 3);
    }
    // And the glow is modest: close to the sky within about 40 px (~2.5 degrees here).
    const at40 = rays.map(r => r[radii.indexOf(39)]);
    expect(Math.max(...at40) - bg, `${tag} glow at 39px`).toBeLessThan(40);
    // The glow is the sky shader's, not the bloom's: switching bloom off
    // barely changes the frame beyond the disc's own rim.
    const bloomAdds = await page.evaluate(({ cx, cy }) => {
      const u = window.__ug, r = u.composer.renderer, gl = r.getContext();
      const w = window.__frameW, h = window.__frameH, withBloom = window.__frameL;
      u.bloomPass.enabled = false;
      u.composer.render(0);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      u.bloomPass.enabled = true;
      let max = 0;
      for (let y = cy - 80; y <= cy + 80; y++) for (let x = cx - 80; x <= cx + 80; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 10 || d > 80) continue;
        const i = (h - 1 - y) * w + x;
        const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
        max = Math.max(max, withBloom[i] - l);
      }
      return max;
    }, { cx: c.x, cy: c.y });
    expect(bloomAdds, `${tag} bloom's own contribution 10 to 80 px from the disc`).toBeLessThan(15);
  }
  await page.evaluate(() => window.__ug.camera.userData.masterHeightController.setValue(1.1));
});

test('the water glint is clamped: a low sun over the Thames saturates no patch of river', async ({ page }) => {
  await boot(page);
  // Dusk and morning over the City, the river between the camera and the sun.
  for (const [t, pos] of [[1, [2952.9, 337.8, -732.9]], [null, [-600, 960, 300]], [0.9, [2952.9, 337.8, -732.9]]]) {
    await setSun(page, t);
    await faceSun(page, pos, { dPitchDeg: -6 });
    await frames(page, 4);
    const f = await readFrame(page);
    const hot = await page.evaluate(({ sx, sy }) => {
      const L = window.__frameL, w = window.__frameW, h = window.__frameH;
      let n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (Math.hypot(x - sx, y - sy) < 40) continue; // the disc itself
        if (L[(h - 1 - y) * w + x] >= 245) n++;
      }
      return n / (w * h);
    }, { sx: f.sunX, sy: f.sunY });
    // Before the clamp the morning view had about 0.09% of the frame saturated.
    expect(hot, `t=${t} ${pos}`).toBeLessThan(0.0002);
  }
});

test('the blue line is gone: no dark column in the sky opposite the sun', async ({ page }) => {
  await boot(page);
  // Jordan's two views: north-west over Finchley under the morning sun, and
  // north over Wood Green under a near-noon sun; both faced the anti-solar
  // azimuth, where the column stood.
  for (const [t, ll, alt] of [[null, [51.585, -0.235], 99], [0.45, [51.545, -0.108], 563], [0.02, [51.5, -0.1], 300]]) {
    await setSun(page, t);
    await page.evaluate(({ ll, alt }) => {
      const u = window.__ug, s = window.__ugSun.state.direction, h = Math.hypot(s.x, s.z);
      const c = u.llToXZ(ll[0], ll[1]), y = 400 + alt * 5;
      u.camera.position.set(c.x, y, c.z);
      u.controls.target.set(c.x - s.x / h * 1000, y + 90, c.z - s.z / h * 1000);
      u.controls.update();
    }, { ll, alt });
    await frames(page, 4);
    await readFrame(page);
    const r = await page.evaluate(() => {
      const L = window.__frameL, w = window.__frameW, h = window.__frameH;
      // Dark outliers against their neighbours 3 px either side, in the upper
      // sky, across the middle third of the frame.
      let n = 0; const cols = new Map();
      for (let y = 20; y < Math.round(h * 0.35); y++) for (let x = Math.round(w / 3); x < Math.round(2 * w / 3); x++) {
        const i = (h - 1 - y) * w + x;
        if ((L[i - 3] + L[i + 3]) / 2 - L[i] > 8) { n++; cols.set(x, (cols.get(x) || 0) + 1); }
      }
      return { n, worstColumn: Math.max(0, ...cols.values()) };
    });
    expect(r.worstColumn, `t=${t} ${ll}`).toBeLessThan(4);
  }
});

test('no NaN or black frames at dawn, morning and dusk from the overview and street', async ({ page }) => {
  await boot(page);
  for (const t of [0, null, 1]) {
    await setSun(page, t);
    for (const [name, pos] of [['overview', null], ['street', [2952.9, 337.8, -732.9]]]) {
      if (name === 'overview') {
        await page.evaluate(() => {
          const u = window.__ug, s = window.__ugSun.state.direction, h = Math.hypot(s.x, s.z);
          u.camera.position.set(-s.x / h * 18000, 20000, -s.z / h * 18000);
          u.controls.target.set(0, 0, 0); u.controls.update();
        });
      } else {
        await faceSun(page, pos, { dPitchDeg: -4 });
      }
      await frames(page, 4);
      const f = await readFrame(page);
      expect(f.mean, `${name} t=${t}`).toBeGreaterThan(20);
      expect(f.blackFraction, `${name} t=${t}`).toBeLessThan(0.05);
    }
  }
});
