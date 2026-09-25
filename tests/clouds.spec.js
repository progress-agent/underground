// clouds.spec.js: Lane C (sprint 25Sep26f, D-039). The cloud layer in the running app.
//
// Pinned here:
//   1. Above ground the clouds are drawn and the lit shaders carry the cloud
//      shadow; the positions the browser draws are the field model's, a pure
//      function of time (cross-checked against the node model).
//   2. Nothing is visible underground or underwater: no sprites, no shadows.
//   3. Cloud shadows darken part of the city above ground (rendered pixels).
//   4. The Dawn to Dusk slider changes only the light on the clouds.
//   5. Clouds fade at the M25 edge: none are drawn whose centre is faded out.
//
// Deliberately NOT measured: frames per second (the GPU is shared during the
// sprint; the integrator measures serially).

import { test, expect } from '@playwright/test';
import UPNG from 'upng-js';
import { CLOUD_FIELD, buildCloudLayout, cloudPositionsAt, sampleEdgeFade } from '../src/clouds-field.js';

async function boot(page, url = '/?fast=1&buildings=baked') {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSun && window.__ugClouds && window.__ug.groundReady),
    null, { timeout: 90000 });
  await page.evaluate(() => { window.__ug.fpsControls.enabled = false; window.__ugClouds.setTimeOverride(900); });
  return errors;
}

function place(page, p, t) {
  return page.evaluate(([p, t]) => {
    const u = window.__ug;
    u.camera.position.set(...p);
    u.controls.target.set(...t);
    u.controls.update();
  }, [p, t]);
}

const frames = (page, n = 3) => page.evaluate(n => new Promise(r => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);

const status = page => page.evaluate(() => {
  const c = window.__ugClouds;
  return { ...c.status, drift: { ...c.status.drift }, meshVisible: c.mesh.visible };
});

test('above ground: clouds drawn, lit shaders carry the cloud shadow, positions match the model', async ({ page }) => {
  const errors = await boot(page);
  await place(page, [0, 20000, 18000], [0, 0, 0]);
  await frames(page, 4);
  const s = await status(page);
  expect(s.meshVisible).toBe(true);
  expect(s.opacity).toBe(1);
  expect(s.instances).toBeGreaterThan(1000);
  expect(s.shadowStrength).toBeGreaterThan(0);
  expect(s.shadowsPatched).toBe(true);
  // A lit city material compiled with the cloud shade.
  const compiled = await page.evaluate(() => {
    const u = window.__ug, r = u.composer.renderer, gl = r.getContext();
    let terrain = null; u.scene.traverse(o => { if (o.name === 'terrainMesh') terrain = o; });
    const prog = r.properties.get(terrain.material).currentProgram;
    return gl.getShaderSource(prog.fragmentShader).includes('ugCloudSunFactor');
  });
  expect(compiled).toBe(true);
  // The browser's positions are the node model's, for any time.
  const layout = buildCloudLayout();
  for (const t of [0, 900, 4321.5]) {
    const browser = await page.evaluate(t => window.__ugClouds.positionsAt(t).slice(0, 25), t);
    const node = cloudPositionsAt(layout, t);
    // The node helper packs into a Float32Array (about 2 mm at 20 km).
    browser.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(node[2 * i], 1);
      expect(z).toBeCloseTo(node[2 * i + 1], 1);
    });
  }
  expect(errors).toEqual([]);
});

test('nothing visible underground or underwater', async ({ page }) => {
  await boot(page, '/?fast=1');
  // Underground: shallow clay, deep chalk, tunnel depth away from the centre.
  // Underwater: mid-channel at the Cutty Sark reach.
  for (const [p, label] of [[[0, -100, 0], 'clay'], [[0, -330, 0], 'chalk'], [[-6000, -60, 3000], 'tunnel'], [[8161, 6, 2340], 'river']]) {
    await place(page, p, [p[0], p[1], p[2] + 500]);
    await frames(page, 5);
    const s = await status(page);
    expect(s.opacity, label).toBe(0);
    expect(s.meshVisible, label).toBe(false);
    expect(s.shadowStrength, label).toBe(0);
    const shadowUniform = await page.evaluate(() => {
      let t = null; window.__ug.scene.traverse(o => { if (o.name === 'terrainMesh') t = o; });
      const u = window.__ug.composer.renderer.properties.get(t.material).uniforms;
      return u?.ugCloudA?.value.elements[11];
    });
    expect(shadowUniform, label).toBe(0);
  }
});

test('cloud shadows darken part of the city above ground', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setTime(0.5, { persist: false });
  });
  await place(page, [0, 15000, 6000], [0, 0, 1500]);
  const shot = async on => {
    // Sprites hidden so only the ground's lighting is compared.
    await page.evaluate(on => {
      window.__ugClouds.setShadowsEnabled(on); const c = window.__ugClouds; const o = c.update; c.update = a => { o(a); c.mesh.visible = false; }; c._restore = () => { c.update = o; };
    }, on);
    await frames(page, 4);
    const png = await page.locator('canvas').first().screenshot();
    await page.evaluate(() => window.__ugClouds._restore());
    const img = UPNG.decode(png), px = new Uint8Array(UPNG.toRGBA8(img)[0]);
    const l = new Float32Array(px.length / 4);
    for (let i = 0; i < l.length; i++) l[i] = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
    return l;
  };
  const off = await shot(false), on = await shot(true);
  let darker = 0, lighter = 0, n = 0;
  for (let i = 0; i < off.length; i++) {
    if (off[i] < 12) continue; // skip black water and deep shade: no ratio to read
    n++;
    if (on[i] < off[i] * 0.85) darker++;
    if (on[i] > off[i] * 1.05 + 1) lighter++;
  }
  expect(darker / n).toBeGreaterThan(0.03);   // real patches of shade
  expect(darker / n).toBeLessThan(0.6);       // not an overcast wash
  expect(lighter / n).toBeLessThan(0.01);     // shade only ever removes light
});

test('the Dawn to Dusk slider changes only the light on the clouds', async ({ page }) => {
  await boot(page);
  await place(page, [-3000, 1500, 3000], [5000, 7200, -1000]);
  const read = async t => {
    await page.evaluate(t => window.__ugSun.setTime(t, { persist: false }), t);
    await frames(page, 3);
    return page.evaluate(() => {
      const c = window.__ugClouds, u = c.material.uniforms;
      return { pos: c.positionsAt(900).slice(0, 40), drift: [c.status.drift.x, c.status.drift.z],
        sun: u.uSunCol.value.toArray(), amb: u.uAmbTop.value.toArray() };
    });
  };
  const dawn = await read(0.02), noon = await read(0.5), dusk = await read(0.98);
  expect(noon.pos).toEqual(dawn.pos);
  expect(dusk.pos).toEqual(dawn.pos);
  expect(noon.drift).toEqual(dawn.drift);
  // Warmer, dimmer light at dawn than at noon; the colours do change.
  expect(noon.sun).not.toEqual(dawn.sun);
  expect(dawn.sun[0] / dawn.sun[2]).toBeGreaterThan(noon.sun[0] / noon.sun[2]);
  expect(dusk.sun).not.toEqual(noon.sun);
});

test('clouds fade out at the M25 edge: no faded-out cloud is drawn', async ({ page }) => {
  await boot(page);
  await place(page, [3000, 12000, -4000], [5000, 0, -21000]);
  await frames(page, 4);
  const drawn = await page.evaluate(F => {
    const c = window.__ugClouds, g = c.mesh.geometry;
    const a = g.getAttribute('aCloud'), d = c.status.drift;
    const wrap = (v, o) => o + (((v - o) % F.size) + F.size) % F.size;
    const out = [];
    for (let i = 0; i < g.instanceCount; i += 7) out.push([wrap(a.getX(i) + d.x, F.originX), wrap(a.getY(i) + d.z, F.originZ)]);
    return out;
  }, { ...CLOUD_FIELD });
  const layout = buildCloudLayout();
  expect(drawn.length).toBeGreaterThan(100);
  for (const [x, z] of drawn) expect(sampleEdgeFade(layout, x, z)).toBeGreaterThanOrEqual(0.004);
});
