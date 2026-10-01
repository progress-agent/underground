// clouds.spec.js: Lane C (sprint 25Sep26f, D-039; sprint 30Sep26w, D-041).
// The cloud layer in the running app.
//
// Pinned here:
//   1. Above ground the clouds are drawn and the lit shaders carry the cloud
//      shadow; the positions the browser draws are the field model's, a pure
//      function of time (cross-checked against the node model).
//   2. Nothing is visible underground or underwater: no sprites, no shadows.
//   3. Cloud shadows darken part of the city above ground (rendered pixels),
//      about half as much of it as at the old cover.
//   4. The Dawn to Dusk slider changes only the light on the clouds.
//   5. Clouds fade at the M25 edge: none are drawn whose centre is faded out
//      (the edge fade is the only thing that leaves a cloud out, D-043).
//   6. No rings and no bright rim at dawn and dusk (D-041).
//
// Deliberately NOT measured: frames per second (the GPU is shared during the
// sprint; the integrator measures serially).

import { test, expect } from '@playwright/test';
import UPNG from 'upng-js';
import { writeFileSync } from 'node:fs';
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
  // Recalibrated for 1.25 oktas (D-041; 0.03 to 0.6 before): this pose and
  // world time shaded 0.455 of the city at 2.5 oktas (c820ea9) and 0.193 at
  // 1.25 (30Sep26w, Mac Studio), so the band holds the new cover and would
  // not pass the old one.
  console.log('shaded fraction', (darker / n).toFixed(4), 'lighter', (lighter / n).toFixed(4));
  expect(darker / n).toBeGreaterThan(0.1);    // real patches of shade
  expect(darker / n).toBeLessThan(0.3);       // about half the old cover's
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
  // Faded out means a fade of exactly 0. Until D-043 the cut was 0.004, the
  // shader's collapse line; a cloud drifting in across the edge then joined
  // the drawn set at up to 1.2% opacity (tests/clouds-no-pop.spec.js, drift),
  // so the cut is now 0 in both places and a cloud joins at zero opacity.
  for (const [x, z] of drawn) expect(sampleEdgeFade(layout, x, z)).toBeGreaterThan(0);
  // And the converse (D-043): every cloud the edge leaves in is drawn, however
  // far it is from this camera (up to about 40 km here).
  const unique = await page.evaluate(() => {
    const g = window.__ugClouds.mesh.geometry, a = g.getAttribute('aCloud'), seen = new Set();
    for (let i = 0; i < g.instanceCount; i++) seen.add(`${a.getX(i)},${a.getY(i)}`);
    return seen.size;
  });
  const pos = cloudPositionsAt(layout, 900);
  const inside = layout.clouds.filter((c, i) => sampleEdgeFade(layout, pos[2 * i], pos[2 * i + 1]) > 0).length;
  expect(unique).toBe(inside);
});

// ── Sprint 30Sep26w (D-041): the dawn and dusk rings ───────────────────────
//
// Until D-041 each puff was lit as its own ball (a hemisphere normal per puff)
// with a silver rim added where the puff was thin (1 - alpha), so from below,
// towards a low sun, puffs showed as bright rings round dark cores: the faint
// rings on some clouds at dawn and dusk. Now each cloud is lit as one heap.
//
// One cloud is isolated (the others are dropped from the instance buffer, which
// is not rewritten while the camera and the world time stand still) and seen
// from 330 m with the sun behind it, as in the dusk view where the rings showed.
// Two measures:
//   - RINGS. The cloud alone is rendered into a float target over transparent
//     black, so colour / alpha is its own light, free of the sky. For every
//     puff, the light of its core is compared with eight sectors of its
//     annulus. A ring is radial: every sector brighter (or every one darker)
//     than the core. Ringness is how far the nearest sector still stands from
//     the core, as a fraction of it; smooth light, even with a bend in it,
//     leaves sectors on both sides and scores 0. On c820ea9 this rig measured
//     0.23 and 0.12 at dawn and 0.33 at dusk (every direction at least a third
//     brighter than the core); after D-041, 0 for every puff.
//   - RIM. Luminance profiles from the cloud's centre out across its edge,
//     against the sky alone: no bright bump inside the cloud, and the band
//     where the cloud meets the sky never brighter than both the body inside
//     it and the sky beyond it (a silver-lining rim round the whole cloud).

/** Luminance profiles across one isolated cloud with the sun behind it. */
async function rimProfiles(page, sunT) {
  const geo = await page.evaluate(async (sunT) => {
    const u = window.__ug, c = window.__ugClouds, V = u.camera.position.constructor;
    const frames = n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    window.__ugSun.setTime(sunT, { persist: false });
    c.setEnabled(true); c.setShadowsEnabled(false);
    const s = window.__ugSun.state.direction, h = Math.hypot(s.x, s.z), sx = s.x / h, sz = s.z / h;
    const ratio = u.masterHeight.ratio, master = ratio * 5;
    const pos = c.positionsAt(900);
    let pick = -1;
    for (let i = 0; i < c.layout.clouds.length && pick < 0; i++) {
      const cl = c.layout.clouds[i], [x, z] = pos[i];
      if (cl.width >= 1300 && cl.width <= 1900 && Math.hypot(x, z) < 9000 && c.edgeFadeAt(x, z) > 0.999) pick = i;
    }
    const cl = c.layout.clouds[pick], [x, z] = pos[pick];
    const midY = (cl.base * master + cl.height * 0.45) / ratio;   // canonical
    // From below, as in the dusk capture where the rings showed: 330 m up
    // (display), 3.5 km short of the cloud on the side away from the sun.
    const D = 3500;
    u.camera.position.set(x - sx * D, 330 / ratio, z - sz * D);
    u.controls.target.set(x, midY, z); u.controls.update();
    await frames(4);
    // Keep only this cloud's puffs.
    const g = c.mesh.geometry, attrs = ['aPuff', 'aCloud', 'aMisc', 'aShape'].map(k => g.getAttribute(k)).filter(Boolean);
    const aC = g.getAttribute('aCloud'), keep = [];
    for (let i = 0; i < g.instanceCount; i++) if (aC.getX(i) === Math.fround(cl.cx) && aC.getY(i) === Math.fround(cl.cz)) keep.push(i);
    const rows = keep.map(i => attrs.map(a => [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)]));
    rows.forEach((row, j) => attrs.forEach((a, k) => a.setXYZW(j, ...row[k])));
    g.instanceCount = rows.length; attrs[0].data.needsUpdate = true;
    await frames(4);
    const proj = (px, py, pz) => { const v = new V(px, py, pz).project(u.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
    // The cloud's own light, free of the sky behind it: the isolated cloud
    // alone into a float target over transparent black (linear, before tone
    // mapping), so colour / alpha is the light of the (layered) puffs there.
    const r = u.composer.renderer, W = r.domElement.width, H = r.domElement.height;
    const rt = new (u.composer.renderTarget1.constructor)(W, H, { type: 1015 }); // FloatType
    const hidden = u.scene.children.filter(o => o !== c.mesh && o.visible);
    hidden.forEach(o => { o.visible = false; });
    const bg = u.scene.background, Col = c.material.uniforms.uSunCol.value.constructor;
    const cc = r.getClearColor(new Col()), ca = r.getClearAlpha();
    u.scene.background = null; r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear();
    u.camera.updateMatrixWorld(); r.render(u.scene, u.camera);
    const buf = new Float32Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null); r.setClearColor(cc, ca); u.scene.background = bg; hidden.forEach(o => { o.visible = true; }); rt.dispose();
    // Per puff: the light in its core (r < 0.3) against eight sectors of its
    // annulus (0.55 to 0.85), over opaque pixels only. A ring is radial: every
    // sector brighter than the core (or every one darker). Light that varies
    // smoothly over the cloud, even with a bend in it, leaves some sectors on
    // each side of the core. Ringness is how far the nearest sector still
    // stands from the core, as a fraction of it (0 when the sectors straddle).
    const rings = [];
    const aP = g.getAttribute('aPuff'), fy = H / 2 / Math.tan(u.camera.fov * Math.PI / 360);
    for (let j = 0; j < g.instanceCount; j++) {
      const pc = new V(x + aP.getX(j), (cl.base * master + aP.getY(j)) / ratio, z + aP.getZ(j));
      const depth = -pc.clone().applyMatrix4(u.camera.matrixWorldInverse).z;
      const R = aP.getW(j) * fy / depth;          // physical pixels
      if (R < 12) continue;
      const v = pc.project(u.camera), px = (v.x + 1) / 2 * W, py = (v.y + 1) / 2 * H; // buffer rows run upwards
      let core = 0, nc = 0;
      const sec = new Float64Array(8), ns = new Float64Array(8);
      for (let yy = Math.floor(py - R); yy <= py + R; yy++) for (let xx = Math.floor(px - R); xx <= px + R; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = Math.hypot(xx - px, yy - py) / R, i = (yy * W + xx) * 4, al = buf[i + 3];
        if (al < 0.6) continue;
        const L = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / al;
        if (d < 0.3) { core += L; nc++; } else if (d > 0.55 && d < 0.85) {
          const k = Math.floor(((Math.atan2(yy - py, xx - px) / (2 * Math.PI)) + 1) % 1 * 8) % 8;
          sec[k] += L; ns[k]++;
        }
      }
      if (nc < 20 || Array.from(ns).some(n => n < 6)) continue;
      const c0 = core / nc, rel = Array.from(sec, (v, k) => (v / ns[k] - c0) / c0);
      rings.push(+Math.max(0, Math.min(...rel), -Math.max(...rel)).toFixed(3));
    }
    const e = u.camera.matrixWorld.elements, right = [e[0], e[2]], rl = Math.hypot(...right);
    const centre = proj(x, midY, z);
    const side = proj(x + right[0] / rl * cl.width / 2, midY, z + right[1] / rl * cl.width / 2);
    const top = proj(x, (cl.base * master + cl.height) / ratio, z);
    return { puffs: rows.length, rings, centre, halfW: Math.abs(side[0] - centre[0]), halfH: Math.abs(centre[1] - top[1]) };
  }, sunT);
  const lum = async (save) => {
    const png = await page.locator('canvas').first().screenshot();
    // RIM_SHOTS=<dir> keeps the isolated cloud's frame (captures for the report).
    if (save && process.env.RIM_SHOTS) writeFileSync(`${process.env.RIM_SHOTS}/rim-${sunT}.png`, png);
    const img = UPNG.decode(png);
    const px = new Uint8Array(UPNG.toRGBA8(img)[0]);
    return { w: img.width, at: (x, y) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; } };
  };
  const on = await lum(true);
  await page.evaluate(() => window.__ugClouds.setEnabled(false));
  await frames(page, 4);
  const off = await lum();
  await page.evaluate(() => window.__ugClouds.setEnabled(true));
  const [cx, cy] = geo.centre;
  const profile = (dx, dy, len) => {
    const a = [], b = [];
    for (let t = 0; t <= len; t++) { a.push(on.at(cx + dx * t, cy + dy * t)); b.push(off.at(cx + dx * t, cy + dy * t)); }
    return { on: a, off: b };
  };
  return {
    geo,
    right: profile(1, 0, Math.min(geo.halfW * 1.8, on.w - cx - 2)),
    left: profile(-1, 0, Math.min(geo.halfW * 1.8, cx - 2)),
    up: profile(0, -1, Math.min(geo.halfH * 2.2, cy - 2)),
  };
}

/** Ring and rim measures of one centre-outwards profile (luminance, 0..255). */
function rimMeasures({ on, off }) {
  const box = a => a.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (a[i + k] !== undefined) { s += a[i + k]; n++; } return s / n; });
  const L = box(on), S = box(off);
  // The cloud's edge: the last point where it changes the picture.
  let edge = 0;
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i] - S[i]) > 2.5) edge = i;
  // Rings: bright bumps inside the cloud standing 4 levels above both sides.
  let bumps = 0;
  const W = Math.max(6, Math.round(edge * 0.12));
  for (let i = 1; i < edge; i++) {
    if (!(L[i] >= L[i - 1] && L[i] > L[i + 1])) continue;
    let lo = Infinity, hi = Infinity;
    for (let k = Math.max(0, i - W); k < i; k++) lo = Math.min(lo, L[k]);
    for (let k = i + 1; k <= Math.min(edge, i + W); k++) hi = Math.min(hi, L[k]);
    if (L[i] - Math.max(lo, hi) >= 4) bumps++;
  }
  // Rim: the outer fifth of the cloud against the body inside it and the sky beyond.
  const band = (a, f0, f1) => a.slice(Math.floor(edge * f0), Math.ceil(edge * f1) + 1);
  const rim = Math.max(...band(L, 0.8, 1));
  const body = Math.max(...band(L, 0.35, 0.75));
  const sky = S[Math.min(S.length - 1, edge + 3)];
  return { edge, bumps, rim: +(rim - Math.max(body, sky)).toFixed(1) };
}

test('no bright rim or rings across a cloud at dawn and dusk, looking towards the sun', async ({ page }) => {
  await boot(page);
  // The profiles read the page's pixels: let the loading bar finish and fade.
  await page.waitForFunction(() => document.querySelector('#loadingBar')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const u = window.__ug; u.controls.enableDamping = false;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
  });
  for (const [sunT, label] of [[0.02, 'dawn'], [0.98, 'dusk']]) {
    const p = await rimProfiles(page, sunT);
    console.log(label, 'puffs', p.geo.puffs, 'ringness', JSON.stringify(p.geo.rings));
    expect(p.geo.puffs, label).toBeGreaterThan(2);
    expect(p.geo.rings.length, `${label}: puffs measured`).toBeGreaterThanOrEqual(3);
    for (const ring of p.geo.rings) expect(ring, `${label}: a puff lit as a ring`).toBeLessThanOrEqual(0.05);
    for (const side of ['left', 'right', 'up']) {
      const m = rimMeasures(p[side]);
      console.log(label, side, JSON.stringify(m));
      expect(m.edge, `${label} ${side}: the profile crosses the cloud`).toBeGreaterThan(20);
      expect(m.bumps, `${label} ${side}: rings inside the cloud`).toBeLessThanOrEqual(1);
      expect(m.rim, `${label} ${side}: the edge outshines the body and the sky`).toBeLessThanOrEqual(4);
    }
  }
});
