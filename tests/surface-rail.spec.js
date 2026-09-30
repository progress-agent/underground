import { test, expect } from '@playwright/test';
import { overgroundFingerprint } from './helpers/overground-fingerprint.js';

// Open-air Tube and DLR drawn as surface railway (sprint 30Sep26w, D-041
// item 2, Lane R). Jordan, 27Sep26u: "yes to the dlr, much of which is
// elevated above ground level which should be represented accurately, and yes
// the overground parts of the underground lines should appear like the other
// overground lines". 30Sep26w: exactly like the Overground, stripe included;
// shared track drawn once with both colours side by side; below-ground
// sections keep the underground look and stay hidden from above ground.

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

const TUBE_LINES = ['bakerloo', 'central', 'circle', 'district', 'hammersmith-city', 'jubilee', 'metropolitan', 'northern', 'piccadilly', 'victoria', 'waterloo-city', 'dlr'];

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held = []; let lastTs = 0;
    window.requestAnimationFrame = cb => {
      if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
      return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
    };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
  });
  await page.goto('/?fast=1&buildings=baked&mh=1.1');
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal && window.__ug.groundReady
    && window.__ug.overground?.userData.stationsAttached && window.__ug.surfaceRail?.stationLayers.size > 0
    && window.__ug.lineBranchCenterPts?.get('dlr')?.length, null, { timeout: 180000 });
  await page.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.renderQuality.set({ scale: 1, samples: 4 }); window.__ug.sim.paused = true; });
});
test.afterAll(async () => { await page?.close(); });

/** Camera beside a line's drawn track near a place: `side` m left of its direction, `back` m behind, `up` m high. */
async function trackPose({ track, lat, lon, side, back, up, ahead }) {
  return page.evaluate(async ({ track, lat, lon, side, back, up, ahead }) => {
    window.__thaw();
    const u = window.__ug, c = u.llToXZ(lat, lon), g = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
    const paths = track.startsWith('og:') ? u.overground.userData.linePaths.get(track.slice(3)).filter(Boolean) : u.surfaceRail.paths.get(track).filter(Boolean);
    let best = null;
    for (const path of paths) for (let i = 1; i < path.length - 1; i++) { if (path[i].cls === 'tunnel') continue; const d = Math.hypot(path[i].x - c.x, path[i].z - c.z); if (!best || d < best.d) best = { d, path, i }; }
    const { path, i } = best, a = path[Math.max(0, i - 3)], b = path[Math.min(path.length - 1, i + 3)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const p = path[i], cx = p.x - dz * side - dx * back, cz = p.z + dx * side - dz * back;
    u.camera.position.set(cx, g(cx, cz) + up * 5, cz);
    const tx = p.x + dx * ahead, tz = p.z + dz * ahead;
    u.controls.target.set(tx, g(tx, tz) + 10, tz); u.controls.update();
    await new Promise(r => setTimeout(r, 1500));
    window.__freeze = true; await new Promise(r => setTimeout(r, 80)); window.__step(2);
    return { x: p.x, z: p.z };
  }, { track, lat, lon, side, back, up, ahead });
}

test('the surface railway is one top-level group per line, and no group named line:* is added', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, top = u.scene.children;
    let nestedLine = 0;
    for (const g of u.surfaceRail.groups.values()) g.traverse(o => { if (o !== g && o.name?.startsWith('line:')) nestedLine++; });
    return {
      lineGroups: top.filter(c => c.name?.startsWith('line:')).map(c => c.name.slice(5)).sort(),
      rail: top.filter(c => c.name?.startsWith('surface-rail-')).map(c => c.name).sort(),
      railNamedLine: [...u.surfaceRail.groups.values()].filter(g => g.name.startsWith('line:')).length,
      nestedLine, allTop: [...u.surfaceRail.groups.values()].filter(g => g.children.length).every(g => g.parent === u.scene),
    };
  });
  // Exactly the underground lines' own groups, as before this sprint.
  expect(r.lineGroups).toEqual([...TUBE_LINES].sort());
  expect(r.railNamedLine).toBe(0);
  expect(r.nestedLine).toBe(0);
  expect(r.allTop).toBe(true);
  // Every line with open-air track; the Victoria and the Waterloo & City run wholly in tunnel.
  expect(r.rail).toEqual(TUBE_LINES.filter(l => !['victoria', 'waterloo-city'].includes(l)).map(l => `surface-rail-${l}`).sort());
});

test('from an above-ground camera the new track is drawn, and every below-ground section stays culled', async () => {
  await trackPose({ track: 'metropolitan', lat: 51.5930, lon: -0.3810, side: 150, back: 250, up: 60, ahead: 200 }); // Pinner
  const r = await page.evaluate(() => {
    const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
    const rail = u.scene.getObjectByName('surface-rail-metropolitan');
    const grab = on => { rail.visible = on; u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0)); rr.setRenderTarget(null);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); rail.visible = true; return b; };
    const A = grab(true), B = grab(false);
    let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 2) n++;
    const set = u.undergroundCull.collect();
    const lineGroups = u.scene.children.filter(c => c.name?.startsWith('line:'));
    const railObjects = []; for (const g of u.surfaceRail.groups.values()) g.traverse(o => railObjects.push(o));
    const railMarkers = [...u.surfaceRail.stationLayers.values()].map(l => l.stationsLayer.mesh);
    return { pct: n / (A.length / 4) * 100, above: u.aboveGroundView, active: u.undergroundCull.status.active,
      linesCulled: lineGroups.every(g => set.includes(g)), lines: lineGroups.length,
      railCulled: railObjects.some(o => set.includes(o)) || railMarkers.some(m => set.includes(m)) };
  });
  expect(r.above && r.active).toBe(true);
  expect(r.pct).toBeGreaterThan(0.05); // the Metropolitan's track is on screen
  expect(r.lines).toBe(12);
  expect(r.linesCulled).toBe(true);    // every underground section still hidden from above
  expect(r.railCulled).toBe(false);    // and nothing of the surface railway is
});

test('the surface railway draws nothing below the ground: no tunnel, and D-024 holds', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, VE = u.VERTICAL_EXAGGERATION;
    let total = 0, buried = 0, grazing = 0;
    for (const g of u.surfaceRail.groups.values()) g.traverse(o => {
      if (!o.isMesh || !['stripe', 'band', 'ballast', 'masonry'].includes(o.userData.part)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        const t = u.getTerrainMeshSurfaceY({ x: pos.getX(i), z: pos.getZ(i) });
        if (!Number.isFinite(t)) continue;
        const above = (pos.getY(i) - t) / VE; total++;
        if (above < -0.5) buried++; else if (above < 0.05) grazing++;
      }
    });
    return { total, buried, grazing };
  });
  console.log(`surface rail census: ${r.total} vertices, buried ${(100 * r.buried / r.total).toFixed(3)}%, grazing ${(100 * r.grazing / r.total).toFixed(3)}%`);
  expect(r.total).toBeGreaterThan(20000);
  // The Overground allows 9% buried (its tunnels are drawn 20 m down); the Tube
  // and DLR draw no tunnel at all, so beyond a sliver where a 5 m pier or a
  // viaduct edge meets a steep terrain cell, nothing is below ground.
  expect(r.buried / r.total).toBeLessThan(0.002);
  expect(r.grazing / r.total).toBeLessThan(0.02);
});

test('the Overground builds exactly what c820ea9 built, and draws the same pixels with the Tube railway beside it', async () => {
  // Fingerprint (tests/helpers/overground-fingerprint.js: every track mesh's
  // positions, vertex count, render order and material) measured on
  // c820ea9 and on this branch, Mac Studio, 30Sep26w, at mh=1.1: identical.
  // overground.js now builds from surface-rail.js; a changed number anywhere
  // in the archetypes changes this. The pixel diffs at three poses against
  // c820ea9 are in the lane's captures (Working/sprint-30Sep26w/R/).
  const fp = await page.evaluate(overgroundFingerprint);
  expect({ total: fp.total, meshes: fp.meshes, vertices: fp.vertices }).toEqual({ total: '53a95c03', meshes: 21, vertices: 201408 });
  await trackPose({ track: 'og:lioness', lat: 51.5701, lon: -0.3081, side: 110, back: 190, up: 40, ahead: 160 });
  const r = await page.evaluate(() => {
    const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
    // The Overground alone (lights kept, trains hidden: their phase is time).
    const hide = [];
    for (const c of u.scene.children) if (c !== u.overground && !c.isLight && c.visible) { c.visible = false; hide.push(c); }
    u.overground.traverse(o => { if (o.name?.startsWith('overground-trains-') && o.visible) { o.visible = false; hide.push(o); } });
    const grab = () => { u.composer.render(0); rr.setRenderTarget(null); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
    const A = grab();
    // Detach the whole surface railway, render again: the Overground's pixels
    // must not depend on it (shared materials, shared archetype code).
    const detached = [...u.surfaceRail.groups.values()].filter(g => g.parent);
    for (const g of detached) u.scene.remove(g);
    const B = grab();
    for (const g of detached) u.scene.add(g);
    for (const o of hide) o.visible = true;
    let n = 0, lit = 0; for (let i = 0; i < A.length; i += 4) { if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++; if (A[i] + A[i + 1] + A[i + 2] > 30) lit++; }
    return { differ: n, lit };
  });
  expect(r.lit).toBeGreaterThan(1000); // the Overground is on screen
  expect(r.differ).toBe(0);
});

test('shared track is drawn once, with each line\'s colour side by side', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster();
    const beds = ['ballast', 'masonry'];
    const railMeshes = []; for (const g of u.surfaceRail.groups.values()) g.traverse(o => { if (o.isMesh) railMeshes.push(o); });
    const ogMeshes = []; u.overground.traverse(o => { if (o.isMesh && !o.isInstancedMesh) ogMeshes.push(o); });
    const all = [...railMeshes, ...ogMeshes];
    // Offsets across the stripe, from the path's own normal.
    const across = (path, i, off) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let nx = -(b.z - a.z), nz = b.x - a.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      return { x: path[i].x + nx * off, z: path[i].z + nz * off };
    };
    const down = ({ x, z }) => { ray.set(new T.Vector3(x, 20000, z), new T.Vector3(0, -1, 0)); return ray.intersectObjects(all, false); };
    const check = (path, i0, i1, lines) => {
      const N = lines.length, w = 9 / N, out = { samples: 0, bedOwnerOnly: 0, bedded: 0, bands: 0 };
      for (let i = i0 + 2; i < i1 - 2; i += Math.max(1, Math.floor((i1 - i0) / 40))) {
        if (path[i].cls === 'tunnel') continue;
        out.samples++;
        const hits = down(across(path, i, 0));
        // Beds under the centreline, by the line that drew them. A second
        // corridor would bring a second line's bed; the owner's own bed can
        // appear twice where two of its runs overlap by a sample, and the
        // Overground's viaducts draw no bed at all (see docs/tube-surface-rail.md).
        const owners = new Set(hits.filter(h => beds.includes(h.object.userData.part)).map(h => h.object.userData.lineId));
        if ([...owners].every(l => l === lines[0])) out.bedOwnerOnly++;
        if (owners.size) out.bedded++;
        // Each sharing line's colour at the middle of its band (band k spans 4.5-k*w .. 4.5-(k+1)*w).
        let ok = true;
        for (let k = 1; k < N; k++) {
          const hk = down(across(path, i, 4.5 - (k + 0.5) * w));
          if (!hk.some(h => h.object.userData.part === 'band' && h.object.userData.lineId === lines[k])) ok = false;
        }
        if (ok) out.bands++;
      }
      return out;
    };
    const data = u.surfaceRail.data;
    // Bakerloo on the Lioness (Overground-owned).
    const og = data.overgroundShared.filter(b => b.overground === 'lioness' && b.lines.includes('bakerloo'));
    const ogPath = u.overground.userData.linePaths.get('lioness')[og[0].branch];
    const pr = (path, b) => { let i0 = -1, i1 = -1; path.forEach((p, i) => { if (p.src >= b.j0 && p.src < b.j1) { if (i0 < 0) i0 = i; i1 = i; } }); return [i0, i1]; };
    const lioness = og.map(b => check(ogPath, ...pr(ogPath, b), b.lines)).reduce((a, b) => ({ samples: a.samples + b.samples, bedOwnerOnly: a.bedOwnerOnly + b.bedOwnerOnly, bedded: a.bedded + b.bedded, bands: a.bands + b.bands }));
    // Metropolitan on the Jubilee (Tube-owned, Finchley Road to Wembley Park).
    const jub = data.lines.find(l => l.id === 'jubilee');
    const bi = jub.branches.findIndex(b => b.bands?.some(x => x.lines.includes('metropolitan')));
    const band = jub.branches[bi].bands.filter(x => x.lines.includes('metropolitan')).sort((a, b) => (b.j1 - b.j0) - (a.j1 - a.j0))[0];
    const jPath = u.surfaceRail.paths.get('jubilee')[bi];
    const jubilee = check(jPath, ...pr(jPath, band), band.lines);
    const bakerlooOwnBed = railMeshes.filter(m => m.userData.lineId === 'bakerloo' && beds.includes(m.userData.part));
    return { lioness, jubilee, lionessKm: og.reduce((s, b) => s + b.j1 - b.j0, 0), bakerlooBedVerts: bakerlooOwnBed.reduce((s, m) => s + m.geometry.attributes.position.count, 0) };
  });
  console.log('shared track', JSON.stringify(r));
  for (const k of ['lioness', 'jubilee']) {
    expect(r[k].samples, k).toBeGreaterThan(10);
    // Drawn once: never a second line's bed under the shared stretch.
    expect(r[k].bedOwnerOnly, k).toBe(r[k].samples);
    expect(r[k].bedded / r[k].samples, k).toBeGreaterThan(0.9);
    // And every sharing line's colour in its own band across the stripe.
    expect(r[k].bands / r[k].samples, k).toBeGreaterThan(0.95);
  }
});

test('every DLR raised segment has a measured or a flagged fallback deck, and the drawn deck follows it at every Master', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster();
    const deckAt = () => {
      const paths = u.surfaceRail.paths.get('dlr').filter(Boolean);
      const raised = paths.flat().filter(p => p.cls === 'viaduct' || p.cls === 'embankment');
      const sources = {}; let flagged = true, surveyedOk = true;
      for (const p of raised) {
        const s = p.deck?.source ?? 'none'; sources[s] = (sources[s] || 0) + 1;
        if (s === 'none') flagged = false;
        if (p.deck && (p.deck.surveyed !== (s === 'lidar'))) surveyedOk = false;
      }
      // The drawn deck against the profile: raycast every 25th viaduct sample.
      const masonry = u.surfaceRail.groups.get('dlr').children.filter(m => m.userData.part === 'masonry');
      // Where two branches run side by side their 21 m decks overlap and the
      // ray can meet the neighbour's first (seen near Canning Town, Custom
      // House and Poplar), so the drawn deck is looked for among the hits.
      let checked = 0, within = 0;
      raised.filter(p => p.cls === 'viaduct').forEach((p, k) => {
        if (k % 25) return;
        ray.set(new T.Vector3(p.x, 20000, p.z), new T.Vector3(0, -1, 0));
        const hits = ray.intersectObjects(masonry, false); if (!hits.length) return;
        const prof = u.dlrProfile.sample({ x: p.x, z: p.z, structureScale: u.getBuildingHeightScale(), kinds: ['elevated'], maxDistance: 40 });
        if (!prof) return;
        const want = Math.max(prof.y, p.terrainY + 5 * u.getBuildingHeightScale());
        checked++; if (hits.some(h => Math.abs(h.point.y - want) / 5 < 0.3)) within++;
      });
      return { raised: raised.length, sources, flagged, surveyedOk, checked, within };
    };
    const setMaster = v => { const el = document.getElementById('masterHeight'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush(); };
    const at11 = deckAt();
    setMaster('3'); const at3 = deckAt();
    setMaster('1.1'); const back = deckAt();
    return { at11, at3, back };
  });
  console.log('DLR deck', JSON.stringify(r));
  const { at11, at3, back } = r;
  expect(at11.raised).toBeGreaterThan(500);
  expect(at11.flagged).toBe(true);        // lidar, interpolated or fallback: never unaccounted
  expect(at11.surveyedOk).toBe(true);     // only a LiDAR deck reads as surveyed
  expect((at11.sources.lidar ?? 0) / at11.raised).toBeGreaterThan(0.75);
  for (const s of [at11, at3, back]) {
    expect(s.checked).toBeGreaterThan(20);
    expect(s.within).toBe(s.checked); // drawn where the shared profile says, within 0.3 m
  }
});

test('no per-instance colour anywhere in the scene (D-015)', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug; let instanced = 0, coloured = 0, railVertexColours = 0;
    u.scene.traverse(o => { if (o.isInstancedMesh) { instanced++; if (o.instanceColor) coloured++; } });
    for (const g of u.surfaceRail.groups.values()) g.traverse(o => { if (o.isMesh && (o.material.vertexColors || o.geometry.attributes.color)) railVertexColours++; });
    const markers = [...u.surfaceRail.stationLayers.values()].filter(l => l.stationsLayer.mesh.instanceColor).length;
    return { instanced, coloured, railVertexColours, markers };
  });
  expect(r.instanced).toBeGreaterThan(10);
  expect(r.coloured).toBe(0);
  expect(r.markers).toBe(0);
  expect(r.railVertexColours).toBe(0);
});

test('hover over the surface railway names its lines', async () => {
  // Formatter: a band on the Jubilee's track names both lines; the DLR's deck
  // gives its measured height.
  const f = await page.evaluate(() => {
    const u = window.__ug, rail = u.surfaceRail;
    const band = rail.groups.get('metropolitan').children.find(m => m.userData.part === 'band');
    const jub = rail.data.lines.find(l => l.id === 'jubilee'), bi = jub.branches.findIndex(b => b.bands?.some(x => x.lines.includes('metropolitan')));
    const bnd = jub.branches[bi].bands.find(x => x.lines.includes('metropolitan'));
    const path = rail.paths.get('jubilee')[bi], p = path.find(q => q.src >= bnd.j0 + 2 && q.src < bnd.j1);
    const dlrDeck = rail.groups.get('dlr').children.find(m => m.userData.part === 'masonry');
    const v = rail.paths.get('dlr').filter(Boolean).flat().find(q => q.cls === 'viaduct' && q.deck?.source === 'lidar');
    return { band: u.formatInfraTooltip(band, { x: p.x, y: p.y, z: p.z }), dlr: u.formatInfraTooltip(dlrDeck, { x: v.x, y: v.y, z: v.z }) };
  });
  expect(f.band).toMatch(/Metropolitan line/);
  expect(f.band).toMatch(/Jubilee line/);
  expect(f.band).toMatch(/Shared track/);
  expect(f.dlr).toMatch(/DLR/);
  expect(f.dlr).toMatch(/above ground \(LiDAR\)/);
  // A real pointer over the District's open-air track towards Upminster.
  const at = await trackPose({ track: 'district', lat: 51.5580, lon: 0.2300, side: -120, back: 160, up: 40, ahead: 120 });
  await page.evaluate(() => window.__thaw());
  const pts = await page.evaluate(({ at }) => {
    const u = window.__ug, path = u.surfaceRail.paths.get('district').flat().filter(p => p.cls !== 'tunnel' && Math.hypot(p.x - at.x, p.z - at.z) < 250);
    return path.filter((_, i) => i % 3 === 0).map(p => { const v = new window.__ugTHREE.Vector3(p.x, p.y, p.z).project(u.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, z: v.z }; })
      .filter(s => s.z < 1 && s.x > 40 && s.x < innerWidth - 40 && s.y > 40 && s.y < innerHeight - 40);
  }, { at });
  expect(pts.length).toBeGreaterThan(3);
  let text = '';
  for (const p of pts) {
    await page.mouse.move(p.x + 30, p.y + 30); await page.waitForTimeout(60);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(160);
    text = await page.evaluate(() => document.getElementById('hoverTip')?.textContent ?? '');
    if (/District line/.test(text) && /surface railway|Shared track/.test(text)) break;
  }
  expect(text).toMatch(/District line/);
  expect(text).toMatch(/surface railway|Shared track/); // the surface railway's own tooltip, not the bore's
});
