import { test, expect } from '@playwright/test';
import { overgroundFingerprint } from './helpers/overground-fingerprint.js';
// s30:R fix round 1: the DLR's measured decks and their OSM nodes, to read the hover against.
import dlrDecks from '../src/dlr-deck-heights.json' with { type: 'json' };
import dlrProfileData from '../src/dlr-profile-data.json' with { type: 'json' };

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
      // The track surface: every stripe and band vertex (the bed sits 0.8
      // under its stripe; the dressing mesh also holds embankment skirt feet
      // and pier bases, which the Overground's archetypes set into the ground).
      if (!o.isMesh || !['stripe', 'band'].includes(o.userData.part)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
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
  // and DLR draw no tunnel at all. Measured 30Sep26w: 0.013% buried (a stripe
  // edge over a steep terrain cell), 0.039% grazing; bounds with headroom.
  expect(r.buried / r.total).toBeLessThan(0.001);
  expect(r.grazing / r.total).toBeLessThan(0.005);
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
    const beds = ['ballast', 'masonry', 'dressing']; // the Overground's beds; the Tube's dressing mesh
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
      const masonry = u.surfaceRail.groups.get('dlr').children.filter(m => m.userData.part === 'dressing');
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

test('no per-instance colour anywhere in the scene (D-015); colour on the railway is per line or baked', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug; let instanced = 0, coloured = 0, railInstanced = 0, otherVertexColours = 0, baked = 0;
    u.scene.traverse(o => { if (o.isInstancedMesh) { instanced++; if (o.instanceColor) coloured++; } });
    for (const g of u.surfaceRail.groups.values()) g.traverse(o => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) railInstanced++;
      if (o.userData.part === 'dressing') { if (o.material.vertexColors && o.geometry.attributes.color) baked++; }
      else if (o.material.vertexColors || o.geometry.attributes.color) otherVertexColours++;
    });
    const markers = [...u.surfaceRail.stationLayers.values()].filter(l => l.stationsLayer.mesh.instanceColor).length;
    return { instanced, coloured, railInstanced, otherVertexColours, baked, markers };
  });
  expect(r.instanced).toBeGreaterThan(10);
  expect(r.coloured).toBe(0);
  expect(r.markers).toBe(0);
  expect(r.railInstanced).toBe(0);
  // The four dressing archetypes are one mesh per line with their colours
  // baked into the vertices (allowed: variants are separate meshes or baked
  // vertex colour); the stripes and bands are per-line materials.
  expect(r.baked).toBe(10);
  expect(r.otherVertexColours).toBe(0);
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
    const dlrDeck = rail.groups.get('dlr').children.find(m => m.userData.part === 'dressing');
    const v = rail.paths.get('dlr').filter(Boolean).flat().find(q => q.cls === 'viaduct' && q.deck?.source === 'lidar');
    return { band: u.formatInfraTooltip(band, { x: p.x, y: p.y, z: p.z }), dlr: u.formatInfraTooltip(dlrDeck, { x: v.x, y: v.y, z: v.z }) };
  });
  expect(f.band).toMatch(/Metropolitan line/);
  expect(f.band).toMatch(/Jubilee line/);
  expect(f.band).toMatch(/Shared track/);
  expect(f.dlr).toMatch(/DLR/);
  expect(f.dlr).toMatch(/above ground \(LiDAR[;)]/); // the value is pinned at every measured node in the next test
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

test('the DLR hover reads the measured deck in true metres at every Master, and says where the drawn deck departs from it', async () => {
  // Fix round 1 (verifier, 30Sep26w): the hover printed (y - ground) / VE,
  // which is the deck x structureScale (1 / Master), so a LiDAR deck of
  // 7.92 m, drawn at 7.92 m, read "~7.2m above ground (LiDAR)" at Master 1.1
  // and "~2.6m" at Master 3, while the specs matched only the basis string.
  // Fix round 2 (verifier, 30Sep26w): this test then formatted the tooltip at
  // each node with a made-up hit (y 0, no face), and the hover sampled the
  // profile's nearest track in plan, so neither the flyover nor the shared
  // band could fail it. The hover now reads the piece of track the hit face
  // was built from, so every probe here is a real ray hit on the DLR's own
  // drawn track at the node. Where the drawn path passes through the node
  // itself (it keeps its OSM source points), the hover prints the node's
  // deck. The DLR is double track and the collapse draws one centreline per
  // corridor, so about half the nodes lie on the other running track, under
  // the deck drawn for it (or under a flyover): there the hover describes
  // that deck, which the next test pins against the drawn geometry, and
  // tests/tube-surface.test.mjs checks that every measured deck is drawn by
  // a centreline within the collapse's reach at its height.
  const nodes = dlrProfileData.nodes.flatMap((n, i) => { const d = dlrDecks.nodes[n.id]; return d?.source === 'lidar' && d.kind === 'elevated' ? [{ i, id: String(n.id), lat: n.lat, lon: n.lon, m: d.m }] : []; });
  const verifier = { 1752319982: 7.92, 1752475286: 9.14, 1752783321: 6.73, 1752475204: 6.56 };
  const r = await page.evaluate(({ nodes, verifier }) => {
    const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster();
    const setMaster = v => { const el = document.getElementById('masterHeight'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush(); };
    // The title names every line on the track.
    const RE = /^<b>DLR(?: · [^<]+)?<\/b><div class="sub">(?:Shared track · [^<]*? · )?(Elevated railway|Railway embankment) · ~(\d+\.\d)m above ground \((LiDAR|modelled)(?:; drawn ~(\d+\.\d)m above the terrain here)?\)<\/div>$/;
    const out = [];
    for (const master of ['1.1', '3', '10', '1.1']) {
      setMaster(master);
      const scale = u.getBuildingHeightScale(), s = { master, scale, checked: 0, drawnElsewhere: 0, underOther: 0, unreached: 0, offTrack: 0, portal: 0, bad: [], verifier: {} };
      // A Master change rebuilds the DLR's meshes from the profile: take them now.
      const own = u.surfaceRail.groups.get('dlr').children.filter(m => m.isMesh && m.userData.part !== 'band');
      for (const n of nodes) {
        // A measured node where a tunnel meets the viaduct is a portal in the profile, drawn at grade by design.
        if (!u.dlrProfile.sample({ x: 0, z: 0, nodeIndex: n.i, structureScale: scale })._dlrProfile.deckSource) { s.portal++; continue; }
        const c = u.llToXZ(n.lat, n.lon);
        ray.set(new T.Vector3(c.x, 1e5, c.z), new T.Vector3(0, -1, 0));
        // Among the DLR's own pieces under the node, the one drawn through it.
        const hits = ray.intersectObjects(own, false);
        let hit = null;
        for (const h of hits) {
          const d = u.surfaceRail.describe(h.object, h.point, h.faceIndex).dlrPoint;
          if (d && Math.hypot(d.x - c.x, d.z - c.z) < 0.05) { hit = h; break; }
        }
        if (!hit) {
          if (verifier[n.id]) {
            // The verifier's node is on the running track drawn as its twin's
            // centreline: the deck drawn for it is read there.
            let best = null;
            for (const path of u.surfaceRail.paths.get('dlr').filter(Boolean)) for (const p of path) { const dd = Math.hypot(p.x - c.x, p.z - c.z); if (!best || dd < best.dd) best = { dd, p }; }
            ray.set(new T.Vector3(best.p.x, 1e5, best.p.z), new T.Vector3(0, -1, 0));
            const h = ray.intersectObjects(own, false)[0];
            s.verifier[n.id] = `twin ${best.dd.toFixed(1)} m ${u.formatInfraTooltip(h.object, h.point, h.faceIndex)}`;
          }
          // On the other running track, under the deck drawn for it (or a flyover).
          if (!hits.length) { s.unreached++; continue; } // that deck's edge is more than 10.5 m off
          const html = u.formatInfraTooltip(hits[0].object, hits[0].point, hits[0].faceIndex);
          if (!/^<b>DLR/.test(html)) s.bad.push(`${n.id} under ${html}`);
          s.underOther++;
          continue;
        }
        const html = u.formatInfraTooltip(hit.object, hit.point, hit.faceIndex), k = html.match(RE);
        if (verifier[n.id]) s.verifier[n.id] = html;
        // A node at a viaduct's end can sit on a surface, cutting or portal segment too.
        if (!/<div class="sub">(?:Shared track · [^<]*? · )?(Elevated railway|Railway embankment) · /.test(html)) { s.offTrack++; continue; }
        if (!k) { s.bad.push(`unparsed ${n.id}: ${html}`); continue; }
        const d = u.surfaceRail.describe(hit.object, hit.point, hit.faceIndex).dlrPoint;
        const drawn = (d.yDrawn - u.getStructuralSurfaceY({ x: d.x, z: d.z })) / 5 / scale;
        s.checked++;
        // The deck printed is the node's (to the printed 0.1 m); a note gives the
        // drawn height where it departs by 0.05 m or more, and only then.
        if (Math.abs(+k[2] - n.m) > 0.051 || k[3] !== 'LiDAR') s.bad.push(`${n.id} deck ${n.m}: ${html}`);
        else if (k[4] !== undefined) { s.drawnElsewhere++; if (Math.abs(+k[4] - drawn) > 0.051 || Math.abs(drawn - n.m) < 0.05) s.bad.push(`${n.id} drawn ${drawn.toFixed(3)}: ${html}`); }
        else if (Math.abs(drawn - n.m) >= 0.05 && (+k[2]).toFixed(1) !== drawn.toFixed(1)) s.bad.push(`${n.id} drawn ${drawn.toFixed(3)} but no note: ${html}`);
      }
      out.push(s);
    }
    return out;
  }, { nodes, verifier });
  console.log('DLR hover', JSON.stringify(r.map(s => ({ master: s.master, checked: s.checked, drawnElsewhere: s.drawnElsewhere, underOther: s.underOther, unreached: s.unreached, offTrack: s.offTrack, portal: s.portal, bad: s.bad.length }))));
  for (const s of r) {
    expect(s.bad.slice(0, 5), `Master ${s.master}`).toEqual([]);
    // Measured 30Sep26w (fix round 2), at every Master: of the 1,499 nodes,
    // 713 on a centreline drawn through them, 664 under another DLR deck, 95
    // more than 10.5 m from one, 25 at a viaduct's end, 2 portals.
    expect(s.checked, `Master ${s.master}`).toBeGreaterThan(nodes.length * 0.45);
    expect(s.unreached, `Master ${s.master}`).toBeLessThan(nodes.length * 0.1);
    for (const [id, m] of Object.entries(verifier)) {
      const html = s.verifier[id];
      if (html?.startsWith('twin ')) {
        // 1752475204 (fix round 2): 8 m off the centreline drawn for its
        // running track, whose deck is its twin's, measured by the LiDAR too.
        const k = html.match(/^twin (\d+\.\d) m <b>DLR<\/b><div class="sub">Elevated railway · ~(\d+\.\d)m above ground \(LiDAR[;)]/);
        expect(k, `node ${id} at Master ${s.master}: ${html}`).toBeTruthy();
        expect(+k[1]).toBeLessThan(10);
        expect(Math.abs(+k[2] - m), `node ${id} at Master ${s.master}: ${html}`).toBeLessThanOrEqual(0.1);
        continue;
      }
      // At the review Master and at 3 the verifier found these drawn at their deck; at 10 only the deck is pinned.
      if (s.master !== '10') expect(html, `node ${id} at Master ${s.master}`).toBe(`<b>DLR</b><div class="sub">Elevated railway · ~${m.toFixed(1)}m above ground (LiDAR)</div>`);
      else expect(html).toContain(`Elevated railway · ~${m.toFixed(1)}m above ground (LiDAR`);
    }
  }
});

test('the DLR hover reports the geometry drawn under the pointer, on its own track and on shared track', async () => {
  // Fix round 2 (verifier, 30Sep26w): describe() sampled the profile's nearest
  // track in plan, so over the DLR's band on the Jubilee it printed the
  // flyover above it ("~8.8m above ground (LiDAR)" over a stripe drawn at
  // 1.2 m), and on about 290 m of viaduct it printed a neighbouring segment
  // ("Surface railway · ~2.6m" over a deck drawn at 5.8 m near Bow). Here a
  // ray comes straight down at every vertex of the DLR's own centrelines and
  // at every band, and the first thing it meets is described exactly as the
  // pointer would (formatInfraTooltip with the hit's point and face). The
  // height the text gives as drawn (the "drawn ~" note, or the height itself
  // where there is none) must be the height of the geometry under the hit:
  //   - the located track height (the centreline point the hover names,
  //     above the terrain there) equals what the text prints, to rounding;
  //   - the geometry under the hit is at that height: the DLR's own deck is
  //     flat across, so its stripe is 0.8 above the located rail head, to
  //     0.1 m plus 0.01 m per unit of Master (a hit on another piece's stripe,
  //     off its vertices, on a steep curved ramp: the strip's triangles bend
  //     the surface, and Master stretches it); a band is morphed over the terrain under each vertex (true
  //     proportions, D-039), so its height is read above the terrain under
  //     the hit, within the terrain's rise between the hit and the centreline
  //     (true metres), plus 0.05 m and 0.02 m per unit of Master for kinks in
  //     the terrain inside a triangle.
  const r = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster(), VE = 5, STRIPE_LIFT = 0.8, BAND_LIFT = 0.4;
    const setMaster = v => { const el = document.getElementById('masterHeight'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush(); };
    const RE = /<div class="sub">(?:Shared track · [^<]*? · )?(Elevated railway|Railway embankment|Surface railway|Railway cutting|Underground railway|Tunnel portal)(?: · ~(\d+\.\d)m (above|below) ground \((LiDAR|modelled)(?:; drawn ~(\d+\.\d)m (above|below) the terrain here)?\))?<\/div>$/;
    const out = [];
    for (const master of ['1.1', '3', '10']) {
      setMaster(master);
      const ss = u.getBuildingHeightScale();
      const rail = []; for (const g of u.surfaceRail.groups.values()) for (const m of g.children) if (m.isMesh) rail.push(m);
      const probes = [];
      for (const path of u.surfaceRail.paths.get('dlr').filter(Boolean)) for (const p of path) if (p.cls !== 'tunnel') probes.push(p);
      const band = u.surfaceRail.groups.get('dlr').children.find(m => m.userData.part === 'band');
      const bp = band.geometry.attributes.position;
      // Band quads start every 6 vertices; the middle of a quad's first edge lies on the band.
      for (let i = 0; i < bp.count; i += 6) probes.push({ x: (bp.getX(i) + bp.getX(i + 1)) / 2, z: (bp.getZ(i) + bp.getZ(i + 1)) / 2 });
      const s = { master, probes: probes.length, checked: { stripe: 0, band: 0, dressing: 0 }, noted: 0, other: 0, portal: 0, bad: [], worst: 0 };
      for (const P of probes) {
        ray.set(new T.Vector3(P.x, 1e5, P.z), new T.Vector3(0, -1, 0));
        const h = ray.intersectObjects(rail, false)[0];
        if (!h || h.object.userData.lineId !== 'dlr') { s.other++; continue; }
        const part = h.object.userData.part, html = u.formatInfraTooltip(h.object, h.point, h.faceIndex), k = html.match(RE);
        const d = u.surfaceRail.describe(h.object, h.point, h.faceIndex).dlrPoint;
        if (!k || !d) { s.bad.push(`unparsed ${part} at ${P.x.toFixed(0)},${P.z.toFixed(0)}: ${html}`); continue; }
        if (k[1] === 'Tunnel portal') { s.portal++; continue; }
        const said = k[5] !== undefined ? (k[6] === 'below' ? -k[5] : +k[5]) : (k[3] === 'below' ? -k[2] : +k[2]);
        if (k[5] !== undefined) s.noted++;
        const off = Math.hypot(d.x - h.point.x, d.z - h.point.z);
        const located = (d.yDrawn - u.getStructuralSurfaceY({ x: d.x, z: d.z })) / (VE * ss);
        let geom = null;
        if (part === 'stripe') geom = (h.point.y - STRIPE_LIFT - u.getStructuralSurfaceY({ x: d.x, z: d.z })) / (VE * ss);
        else if (part === 'band') geom = (h.point.y - (STRIPE_LIFT + BAND_LIFT) * ss - u.getStructuralSurfaceY({ x: h.point.x, z: h.point.z })) / (VE * ss);
        s.checked[part]++;
        // Without a note the figure is the deck (or the profile's height), which
        // the drawing may depart from by under 0.05 m: 0.1 m with the rounding.
        const eText = Math.abs(said - located), eGeom = geom === null ? 0 : Math.abs(geom - located);
        s.worst = Math.max(s.worst, eGeom);
        const rise = Math.abs(u.getStructuralSurfaceY({ x: d.x, z: d.z }) - u.getStructuralSurfaceY({ x: h.point.x, z: h.point.z })) / VE;
        const lim = part === 'band' ? rise + 0.05 + 0.02 * +master : 0.1 + 0.01 * +master;
        if (off > (part === 'dressing' ? 16 : 5) || eText > (k[5] !== undefined ? 0.051 : 0.101) || eGeom > lim) s.bad.push(`${part} (${P.x.toFixed(0)},${P.z.toFixed(0)}) off ${off.toFixed(1)} m, says ${said}, located ${located.toFixed(2)}, geometry ${geom?.toFixed(2)}: ${html}`);
      }
      s.worst = +s.worst.toFixed(3);
      out.push(s);
    }
    setMaster('1.1');
    return out;
  });
  console.log('DLR hover vs drawn', JSON.stringify(r.map(s => ({ ...s, bad: s.bad.length }))));
  for (const s of r) {
    expect(s.bad.slice(0, 5), `Master ${s.master}`).toEqual([]);
    expect(s.checked.stripe, `Master ${s.master}`).toBeGreaterThan(2500);
    expect(s.checked.band, `Master ${s.master}`).toBeGreaterThan(250);   // the DLR on the Jubilee and the Mildmay
    expect(s.other, `Master ${s.master}`).toBeLessThan(s.probes * 0.01);  // the DLR's own track is on top of it
  }
});

test('the DLR is drawn at its real elevated height where it flies over: Canning Town north, and the band beneath reads its own height', async () => {
  // Fix round 2 (verifier, 30Sep26w). North of Canning Town the DLR's
  // flyover (OSM ways 156792940 and 694613992, decks 3.3 m to 8.8 m: LiDAR on
  // the ramps, interpolated at the crown, where something stands over it)
  // crosses directly over the Jubilee, beside a lower viaduct (145452870, to
  // 4.1 m) and the DLR's at-grade track to Stratford, which shares the
  // Jubilee's corridor. The twin collapse had taken the flyover for the lower
  // viaduct's other running track (within 32 m, both 'viaduct'), so its deck
  // was drawn nowhere, and the hover of the band beneath read it. The
  // collapse now compares the DLR's decks (scripts/prepare-tube-surface.mjs).
  const r = await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster(), ss = u.getBuildingHeightScale();
    const dlr = u.surfaceRail.groups.get('dlr').children.filter(m => m.isMesh);
    const at = (x, z) => {
      ray.set(new T.Vector3(x, 1e5, z), new T.Vector3(0, -1, 0));
      return ray.intersectObjects(dlr, false).map(h => ({ part: h.object.userData.part, m: +((h.point.y - u.getStructuralSurfaceY({ x, z })) / 5 / ss).toFixed(2),
        html: u.formatInfraTooltip(h.object, h.point, h.faceIndex) }));
    };
    const node = id => { const n = u.dlrProfile.data.nodes.find(q => String(q.id) === id), c = u.llToXZ(n.lat, n.lon); return at(c.x, c.z); };
    // The DLR's band nearest a point: the middle of a band quad's first edge.
    const band = (x, z) => {
      const p = u.surfaceRail.groups.get('dlr').children.find(m => m.userData.part === 'band').geometry.attributes.position;
      let best = null;
      for (let i = 0; i < p.count; i += 6) { const bx = (p.getX(i) + p.getX(i + 1)) / 2, bz = (p.getZ(i) + p.getZ(i + 1)) / 2, d = Math.hypot(bx - x, bz - z); if (!best || d < best.d) best = { d, bx, bz }; }
      return at(best.bx, best.bz);
    };
    // On way 156792940: node 18037891 at the flyover's crown (8.83 m, interpolated
    // under what stands over it, so flagged), node 1690218787 on its ramp
    // (5.36 m, LiDAR). The band: where the verifier's pointer was, under the
    // flyover's ramp, and 30 m south.
    return { crown: node('18037891'), ramp: node('1690218787'), band: band(9458, -905), south: band(9440, -927) };
  });
  console.log('Canning Town north', JSON.stringify(r));
  expect(r.crown[0].part).toBe('stripe');
  expect(r.crown[0].m).toBeGreaterThan(8.7);                    // the stripe, 0.16 m above the 8.83 m deck
  expect(r.crown[0].html).toMatch(/^<b>DLR<\/b><div class="sub">Elevated railway · ~8\.8m above ground \(modelled[;)]/);
  expect(r.ramp[0].part).toBe('stripe');
  expect(r.ramp[0].html).toMatch(/^<b>DLR<\/b><div class="sub">Elevated railway · ~5\.4m above ground \(LiDAR[;)]/);
  // Under the flyover's deck, the DLR's band on the Jubilee: it reads the
  // DLR's own at-grade track, at the height it is drawn.
  for (const k of ['band', 'south']) {
    const band = r[k].find(h => h.part === 'band');
    expect(band, k).toBeTruthy();
    expect(band.m, k).toBeLessThan(1.5);
    expect(band.html, k).toMatch(/^<b>DLR · Jubilee line<\/b><div class="sub">Shared track · London Underground · (Surface railway|Railway cutting) · ~\d+\.\dm (above|below) ground \(modelled(; drawn ~1\.[0-2]m above the terrain here)?\)<\/div>$/);
    expect(band.html, k).not.toMatch(/Elevated railway|LiDAR/);
  }

  // A real pointer, where the verifier's pointer read the flyover's deck over
  // the band, and on the two viaducts it found reading a neighbouring segment
  // (near Bow, and by East India). The underground layer's bore of the DLR is
  // not drawn above ground (D-040) and no longer takes the hover from the
  // railway drawn there; the text gives the height of what the pointer is on.
  for (const [x, z] of [[9458, -905], [8015, -3348], [9689, -291]]) {
    const aim = await page.evaluate(async ([x, z]) => {
      window.__thaw();
      const u = window.__ug, T = window.__ugTHREE, t = u.getStructuralSurfaceY({ x, z });
      u.camera.position.set(x + 60, t + 120 * 5, z + 80); u.controls.target.set(x, t, z); u.controls.update();
      await new Promise(r => setTimeout(r, 1500));
      const ray = new T.Raycaster(); ray.set(new T.Vector3(x, 1e5, z), new T.Vector3(0, -1, 0));
      const rail = []; for (const g of u.surfaceRail.groups.values()) for (const m of g.children) if (m.isMesh) rail.push(m);
      const h = ray.intersectObjects(rail, false)[0], v = h.point.clone().project(u.camera);
      return { px: (v.x + 1) / 2 * innerWidth, py: (1 - v.y) / 2 * innerHeight, above: u.aboveGroundView, cull: u.undergroundCull.status.active };
    }, [x, z]);
    expect(aim.above && aim.cull, `${x},${z}`).toBe(true);
    await page.mouse.move(aim.px + 25, aim.py + 25); await page.waitForTimeout(80);
    await page.mouse.move(aim.px, aim.py); await page.waitForTimeout(300);
    const got = await page.evaluate(([px, py]) => {
      const u = window.__ug, T = window.__ugTHREE, ray = new T.Raycaster(), ss = u.getBuildingHeightScale();
      ray.setFromCamera(new T.Vector2(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1), u.camera);
      const rail = []; for (const g of u.surfaceRail.groups.values()) for (const m of g.children) if (m.isMesh) rail.push(m);
      const h = ray.intersectObjects(rail, false)[0], d = u.surfaceRail.describe(h.object, h.point, h.faceIndex).dlrPoint;
      return { tip: document.getElementById('hoverTip')?.innerHTML ?? '', line: h.object.userData.lineId,
        drawn: d ? +((d.yDrawn - u.getStructuralSurfaceY({ x: d.x, z: d.z })) / 5 / ss).toFixed(1) : null };
    }, [aim.px, aim.py]);
    console.log('pointer', x, z, JSON.stringify(got));
    expect(got.line, `${x},${z}`).toBe('dlr');
    expect(got.tip, `${x},${z}`).toMatch(/^<b>DLR/);
    const k = got.tip.match(/~(\d+\.\d)m (?:above|below) ground \((?:LiDAR|modelled)(?:; drawn ~(\d+\.\d)m above the terrain here)?\)/);
    expect(k, got.tip).toBeTruthy();
    expect(+(k[2] ?? k[1]), `${x},${z}: ${got.tip}`).toBeCloseTo(got.drawn, 1);
  }
  await page.mouse.move(5, 5);
});
