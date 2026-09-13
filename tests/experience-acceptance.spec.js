import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.UG_ACCEPTANCE_OUT || new URL('../test-results/experience-acceptance/', import.meta.url).pathname;

test('saved deliberate height choices survive, URL wins, and Reset restores the new defaults', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('acceptance-pref-seeded')) {
      localStorage.setItem('ug:prefs:v2', JSON.stringify({ masterHeight: 3.2, buildingHeight: 4.7, renderMode: 'manual', renderScale: .5, edgeSamples: 0 }));
      sessionStorage.setItem('acceptance-pref-seeded', 'yes');
    }
  });
  const read = () => page.evaluate(() => ({ master: window.__ug.masterHeight.value, structure: window.__ug.getBuildingHeightScale() * 5 }));
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.masterHeight);
  expect(await read()).toEqual({ master: 3.2, structure: 4.7 });
  await page.goto('/?fast=1&buildings=baked&mh=1.1&bh=2');
  await page.waitForFunction(() => window.__ug?.masterHeight);
  expect(await read()).toEqual({ master: 1.1, structure: 2 });
  await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
  await Promise.all([page.waitForNavigation(), page.locator('#resetPrefs').click()]);
  await page.waitForFunction(() => window.__ug?.masterHeight);
  expect(await read()).toEqual({ master: 1.1, structure: 2 });
  expect(new URL(page.url()).searchParams.has('mh')).toBe(false);
  expect(new URL(page.url()).searchParams.has('bh')).toBe(false);
});

test('actual keyboard boundary matrix and complete label/shader integration', async ({ page }) => {
  test.setTimeout(180000);
  await mkdir(out, { recursive: true });
  const report = { cases: [], errors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('/?fast=1&buildings=baked&mh=1.1&bh=2');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.parkLabelsGroup &&
    window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal &&
    document.getElementById('loadingBar')?.classList.contains('done'));
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: .5, samples: 0 }); u.controls.enableDamping = false; });
  const setPose = async (position, target) => {
    await page.evaluate(({ position, target }) => {
      const u = window.__ug; u.fpsControls.keys.clear(); u.materialResistance.cancel();
      u.camera.position.set(...position); u.controls.target.set(...target); u.controls.update(); u.camera.updateMatrixWorld(true);
    }, { position, target });
    await page.waitForTimeout(100);
  };
  const record = async (name, keys, duration) => {
    await page.evaluate(() => {
      window.__acceptanceSamples = []; window.__acceptanceRecording = true;
      const start = performance.now();
      function frame(t) {
        const u = window.__ug, state = u.materialResistance.state;
        window.__acceptanceSamples.push({ t: t - start, p: u.camera.position.toArray(), kind: state?.kind ?? null,
          elapsed: state?.elapsed ?? null, substrate: u.classifySubstrateAt(u.camera.position) });
        if (window.__acceptanceRecording) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    for (const key of keys.slice().reverse()) await page.keyboard.up(key);
    const samples = await page.evaluate(() => { window.__acceptanceRecording = false; return window.__acceptanceSamples; });
    const row = { name, keys, samples }; report.cases.push(row);
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    return samples;
  };
  const ground = await page.evaluate(() => { const u = window.__ug; return { surface: u.getTerrainMeshSurfaceY({ x: 0, z: 0 }), chalk: u.getChalkSurfaceY(0, 0) }; });
  for (const [name, boundary, direction] of [
    ['air-to-clay', ground.surface, -1], ['clay-to-air', ground.surface, 1],
    ['clay-to-chalk', ground.chalk, -1], ['chalk-to-clay', ground.chalk, 1],
  ]) {
    const y = boundary - direction * 2;
    await setPose([0, y, 0], [100, y, 0]);
    const samples = await record(name, [direction > 0 ? 'KeyE' : 'KeyQ'], 1250);
    const slow = samples.filter(s => s.kind === 'slow');
    expect.soft(slow.length, `${name} has actual resistance`).toBeGreaterThan(4);
    if (slow.length) {
      const end = samples.find(s => s.t > slow.at(-1).t && s.kind !== 'slow');
      expect.soft((end?.t ?? Infinity) - slow[0].t, `${name} resistance duration`).toBeGreaterThan(570);
      expect.soft((end?.t ?? Infinity) - slow[0].t, `${name} resistance duration`).toBeLessThan(850);
    }
    expect.soft(samples.at(-1).kind, `${name} recovers on continuing held input`).toBe(null);
  }
  await setPose([0, ground.chalk - 500, 0], [100, ground.chalk - 500, 0]);
  const cruise = await record('chalk-cruise', ['KeyW'], 900);
  const speeds = cruise.slice(1).map((s, i) => Math.hypot(...s.p.map((v, j) => v - cruise[i].p[j])) * 1000 / (s.t - cruise[i].t)).filter(Number.isFinite).sort((a, b) => a - b);
  expect.soft(speeds[Math.floor(speeds.length / 2)], 'Ordinary500unit/s chalk cruise').toBeGreaterThan(480);
  expect.soft(speeds[Math.floor(speeds.length / 2)]).toBeLessThan(520);
  const river = await page.evaluate(() => {
    const u = window.__ug, wanted = u.llToXZ(51.5009, -.1217), a = u.thamesMesh.geometry.attributes.position.array;
    let best, score = Infinity;
    for (let i = 0; i < a.length - 12; i += 12) {
      const x = (a[i] + a[i + 3]) / 2, z = (a[i + 2] + a[i + 5]) / 2, d = Math.hypot(x - wanted.x, z - wanted.z);
      if (d < score) { score = d; best = { x, z, bed: u.getTerrainMeshSurfaceY({ x, z }), top: u.WATER_TOP_Y, left: [a[i], a[i + 2]], right: [a[i + 3], a[i + 5]] }; }
    }
    return best;
  });
  report.river = river;
  const y = (river.bed + river.top) / 2;
  for (const [name, position, key] of [
    ['air-to-water', [river.x, river.top + .2, river.z], 'KeyQ'],
    ['water-to-air', [river.x, river.top - .2, river.z], 'KeyE'],
    ['clay-to-water', [river.x, river.bed - .2, river.z], 'KeyE'],
  ]) {
    await setPose(position, [position[0] + 100, position[1], position[2]]);
    const samples = await record(name, [key], 100);
    expect.soft(samples.some(s => s.kind === 'slow'), `${name} is free`).toBe(false);
  }
  const bedStart = [river.x, river.bed + .2, river.z];
  await setPose(bedStart, [river.x + 100, bedStart[1], river.z]);
  const held = await record('bed-early-release', ['KeyQ'], 330);
  expect.soft(held.some(s => s.kind === 'hold')).toBe(true);
  expect.soft(held.at(-1).substrate).toBe('WATER');
  const released = await page.evaluate(() => ({ state: window.__ug.materialResistance.state, p: window.__ug.camera.position.toArray() }));
  expect.soft(released.state).toBe(null);
  await page.waitForTimeout(780);
  expect.soft(await page.evaluate(() => window.__ug.camera.position.toArray())).toEqual(released.p);
  const pushed = await record('bed-repress-sustained', ['KeyQ'], 1150);
  expect.soft(pushed.at(-1).substrate).toBe('CLAY');
  const lastWater = pushed.filter(s => s.substrate === 'WATER').at(-1);
  expect.soft(lastWater?.t ?? 0, 'Repress starts a complete new hold').toBeGreaterThan(570);
  const dx = river.left[0] - river.x, dz = river.left[1] - river.z, length = Math.hypot(dx, dz);
  const nx = dx / length, nz = dz / length;
  const wallStart = [river.left[0] - nx, y, river.left[1] - nz];
  for (const [name, keys, duration] of [
    ['wall-early', ['KeyW'], 300], ['wall-oblique-slide', ['KeyW', 'KeyA'], 350],
    ['wall-sprint-sustained', ['Shift', 'KeyW'], 1100],
  ]) {
    await setPose(wallStart, [wallStart[0] + nx * 100, y, wallStart[2] + nz * 100]);
    const samples = await record(name, keys, duration);
    expect.soft(samples.some(s => s.kind === 'hold'), name).toBe(true);
    if (duration < 500) expect.soft(samples.at(-1).substrate, name).toBe('WATER');
    else expect.soft(samples.at(-1).substrate, name).not.toBe('WATER');
    if (name.includes('slide')) {
      const a = samples[0].p, b = samples.at(-1).p;
      expect.soft(Math.abs((b[0] - a[0]) * -nz + (b[2] - a[2]) * nx), 'Tangential wall travel retained').toBeGreaterThan(20);
    }
  }
  await setPose([river.x, y, river.z], [river.x + 50, y + 80, river.z]);
  report.water = await page.evaluate(() => {
    const u = window.__ug;
    return { labels: [...document.querySelectorAll('.station-label')].filter(e => e.getBoundingClientRect().width > 0).length,
      parks: u.parkLabelsGroup.visible, map: document.getElementById('ug-mini-map').getBoundingClientRect().width,
      underBed: u.classifySubstrateAt({ x: u.camera.position.x, y: u.getTerrainMeshSurfaceY(u.camera.position) - .1, z: u.camera.position.z }) };
  });
  expect.soft(report.water.labels).toBe(0); expect.soft(report.water.parks).toBe(false);
  expect.soft(report.water.map).toBeGreaterThan(0); expect.soft(report.water.underBed).not.toBe('WATER');
  report.raster = [];
  for (const viewport of [{ width: 960, height: 640 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const samples of [0, 2, 4]) {
      await page.evaluate(samples => window.__ug.renderQuality.set({ scale: .75, samples }), samples);
      await page.waitForTimeout(180);
      const raster = await page.evaluate(() => {
        const u = window.__ug, renderer = u.composer.renderer, gl = renderer.getContext();
        const width = renderer.domElement.width, height = renderer.domElement.height;
        const frame = () => { u.composer.render(0); const p = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
        const amount = u.underwaterSurface.uniforms.uUnderwaterAmount;
        const original = amount.value; amount.value = 0; const before = frame(); amount.value = 1; const after = frame(); amount.value = original;
        const target = u.underwaterSurface.maskTarget, mask = new Uint8Array(target.width * target.height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, mask);
        let covered = 0, changed = 0, outsideChanged = 0;
        for (let i = 0; i < mask.length; i += 4) if (mask[i] > 200) covered++;
        // Conservative interior/exterior mask pixels avoid fractional silhouette edges.
        for (let y = 4; y < height - 4; y += 4) for (let x = 4; x < width - 4; x += 4) {
          const i = (y * width + x) * 4;
          const delta = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
          if (delta > 3) {
            changed++;
            const mx = Math.floor(x / width * target.width), my = Math.floor(y / height * target.height);
            if (mask[(my * target.width + mx) * 4] === 0) outsideChanged++;
          }
        }
        return { samples: [u.composer.renderTarget1.samples, u.composer.renderTarget2.samples], size: [width, height],
          sceneDepth: [u.composer.renderTarget1.depthTexture.image.width, u.composer.renderTarget1.depthTexture.image.height],
          maskSize: [target.width, target.height], coverage: covered / (mask.length / 4), changed, outsideChanged, glError: gl.getError() };
      });
      report.raster.push(raster);
      expect.soft(raster.samples).toEqual([samples, 0]);
      expect.soft(raster.sceneDepth).toEqual(raster.size);
      expect.soft(Math.max(...raster.maskSize)).toBeLessThanOrEqual(768);
      expect.soft(raster.glError).toBe(0);
      expect.soft(raster.coverage, 'Actual water top rasterises in an upward view').toBeGreaterThan(.02);
    }
  }
  expect.soft(report.errors).toEqual([]);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
});

test('actual mouse orbit and touch pan cross material boundaries without keyboard resistance', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:1000,height:700},hasTouch:true});
  const page=await context.newPage();
  try {
    await page.goto('/?fast=1&buildings=baked&mh=1.1&bh=2');
    await page.waitForFunction(()=>window.__ug?.groundReady&&document.getElementById('loadingBar')?.classList.contains('done'));
    await page.evaluate(()=>{const u=window.__ug;u.setRenderQualityMode('manual');u.renderQuality.set({scale:.5,samples:0});u.controls.enableDamping=false;});
    const reset=()=>page.evaluate(()=>{const u=window.__ug,surface=u.getTerrainMeshSurfaceY({x:0,z:0});u.camera.position.set(0,surface+1,100);u.controls.target.set(0,surface,0);u.controls.update();u.materialResistance.cancel();window.__pointerSubstrates=[];window.__pointerStates=[];window.__pointerRecording=true;function frame(){window.__pointerSubstrates.push(u.classifySubstrateAt(u.camera.position));window.__pointerStates.push(u.materialResistance.state?.kind??null);if(window.__pointerRecording)requestAnimationFrame(frame)}requestAnimationFrame(frame);});
    const result=()=>page.evaluate(()=>{window.__pointerRecording=false;return{substrates:[...new Set(window.__pointerSubstrates)],states:window.__pointerStates.filter(Boolean)}});
    await reset();await page.mouse.move(500,350);await page.mouse.down();await page.mouse.move(500,560,{steps:20});await page.mouse.move(500,140,{steps:40});await page.mouse.up();
    const mouse=await result();expect(mouse.states).toEqual([]);expect(mouse.substrates).toContain('AIR');expect(mouse.substrates).toContain('CLAY');
    await reset();
    // Production single-finger control is ground-plane PAN, not orbit. Cross
    // the actual horizontal Westminster bank at constant submerged height.
    await page.evaluate(()=>{const u=window.__ug;u.camera.position.set(530.2144486408156,-14,717.1084189187284);u.controls.target.set(530.2144486408156,-14,617.1084189187284);u.controls.update();});
    await page.waitForTimeout(50);const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:500,y:350}]});
    for(const x of [550,600,650,700,750,700,650,600,550,500,450,400,350,300,250]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:350}]});await page.waitForTimeout(20)}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const touch=await result();
    expect(touch.states).toEqual([]);expect(touch.substrates).toContain('WATER');expect(touch.substrates).toContain('CLAY');
    await mkdir(out,{recursive:true});await writeFile(`${out}/pointer-bypass.json`,JSON.stringify({mouse,touch},null,2));
  } finally {await context.close()}
});
