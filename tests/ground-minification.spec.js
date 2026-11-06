import { test, expect } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

// The T3 probe, not a sampler-property-only assertion: exercise the real GPU,
// compare a one-metre pan, and keep a magnified near-ground control.
test('ground mipmaps calm the distant motion without blurring magnified ground', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), held = [];
    window.__holdGround = false;
    window.requestAnimationFrame = cb => window.__holdGround && cb.name === 'tick'
      ? (held.push(cb), 0) : raf(() => cb(1000));
    window.__stepGround = () => { for (let i = 0; i < 4; i++) held.shift()?.(1000); };
  });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => {
    const u = window.__ug, s = u?.bakedStats;
    return u?.groundReady && u.lateLayers?.settled() && s?.tilesTotal > 0 && s.tilesBuilt === s.tilesTotal;
  });
  await page.evaluate(() => {
    const u = window.__ug;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    u.controls.enableDamping = false; window.__holdGround = true;
  });
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, r = u.composer.renderer, gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const terrain = u.scene.getObjectByName('terrainMesh'), tex = terrain.material.userData.surfaceTex;
    const saved = { min: tex.minFilter, mip: tex.generateMipmaps };
    const visibility = u.scene.children.map(o => [o, o.visible]);
    const pose = (p, t) => {
      u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update(); window.__stepGround();
    };
    const grab = () => {
      u.composer.render(0); const a = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a;
    };
    const rms = (a, b, far = true) => {
      let sum = 0, n = 0;
      for (let y = far ? Math.floor(H * .31) : 0; y < (far ? H * .43 : H); y++)
        for (let x = far ? Math.floor(W * .1) : 0; x < (far ? W * .9 : W); x++)
          for (let c = 0; c < 3; c++) { const i = (y * W + x) * 4 + c; sum += (a[i] - b[i]) ** 2; n++; }
      return Math.sqrt(sum / n);
    };
    const setMip = on => {
      tex.minFilter = on ? T.LinearMipmapLinearFilter : T.LinearFilter;
      tex.generateMipmaps = on; tex.needsUpdate = true;
    };
    try {
      for (const [o] of visibility) if (!o.isLight && o !== terrain && !['analyticSky', 'sunLight'].includes(o.name)) o.visible = false;
      const motion = () => {
        pose([0, 20000, 18000], [0, 0, 0]); const a = grab();
        pose([1, 20000, 18000], [1, 0, 0]); return rms(a, grab());
      };
      const candidate = motion(); setMip(false); const original = motion();
      const g = u.getTerrainMeshSurfaceY({ x: -3500, z: -800 });
      pose([-3500, g + 500, -800], [-3500, g, -800.01]); const a = grab();
      setMip(true); const near = rms(a, grab(), false);
      return { mip: saved.mip, min: saved.min, trilinear: T.LinearMipmapLinearFilter, candidate, original, near };
    } finally {
      tex.minFilter = saved.min; tex.generateMipmaps = saved.mip; tex.needsUpdate = true;
      for (const [o, v] of visibility) o.visible = v;
    }
  });
  expect(result.mip).toBe(true);
  expect(result.min).toBe(result.trilinear);
  expect(result.original).toBeGreaterThan(0);
  expect(result.candidate).toBeLessThan(result.original * .95);
  expect(result.near).toBe(0);
});
