// true-proportion.spec.js: D-039 in the running app (sprint 25Sep26f, Lane S).
//
// Jordan, 25Sep26f: structures are always expressed at true proportions; the
// Structure slider is removed; Master (floor 1.0) stretches only the landscape:
// terrain relief, the river bed, geology and how deep things sit.
//
// Display space is canonical y x Master / 5 (vertical-scale.js). Every check
// below converts to display space and asserts on what the viewer sees.
import { test, expect } from '@playwright/test';

const MASTERS = [1, 1.1, 3, 10];

async function ready(page, query = '') {
  await page.goto(`/?fast=1&buildings=baked${query}`);
  await page.waitForFunction(() => {
    const u = window.__ug;
    return u?.bakedStats?.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal && u.groundReady
      && u.landmarkGroup?.children.length && u.bridgeRegistry?.size === 41 && u.motorwayGroup && u.airportsGroup
      && u.trainSystem?.allTrains.length > 50 && u.lineBranchCenterPts?.get('dlr')?.length;
  }, null, { timeout: 240000 });
}

// Sets Master through the real HUD input and lands every structure morph.
const setMasterSrc = `(m)=>{const el=document.getElementById('masterHeight');el.value=String(m);el.dispatchEvent(new Event('input',{bubbles:true}));window.__ug.structureMorph.flush();}`;

test('the Structure slider is gone and bh= / a saved Structure choice are ignored', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ug:prefs:v2', JSON.stringify({ buildingHeight: 4.7 }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/?fast=1&mh=1.1&bh=5');
  await page.waitForFunction(() => window.__ug?.masterHeight);
  const r = await page.evaluate(() => ({
    slider: !!document.getElementById('buildingHeight'),
    factor: window.__ug.getBuildingHeightScale(),
    share: new URL(window.__ug.getShareUrl()).searchParams.has('bh'),
    saved: JSON.parse(localStorage.getItem('ug:prefs:v2')).buildingHeight,
    hint: document.getElementById('heightExplanation').textContent,
  }));
  expect(r.slider).toBe(false);
  expect(r.factor).toBeCloseTo(1 / 1.1, 12);
  expect(r.share).toBe(false);
  expect(r.saved).toBeUndefined();
  expect(r.hint).toContain('true proportions');
  await page.goto('/?fast=1&mh=1.1&bh=1');
  await page.waitForFunction(() => window.__ug?.masterHeight);
  expect(await page.evaluate(() => window.__ug.getBuildingHeightScale())).toBeCloseTo(1 / 1.1, 12);
});

test('structures keep true proportions at every Master: buildings, London Eye, a bridge span, a train, a bore', async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  const rows = await page.evaluate(async ({ MASTERS, setMasterSrc }) => {
    const u = window.__ug, T = window.__ugTHREE, setMaster = eval(setMasterSrc), VE = u.VERTICAL_EXAGGERATION;
    u.sim.paused = true;
    // A sample of baked buildings (instance matrices hold VE-authored height).
    const baked = []; u.scene.traverse(o => { if (o.isInstancedMesh && o.name.startsWith('baked-buildings-') && baked.length < 3) baked.push(o); });
    const eye = u.landmarkGroup.getObjectByName('landmark-site-london-eye').children.find(a => a.userData.primary);
    const tower = u.bridgeRegistry.get('tower');
    const train = u.trainSystem.allTrains.find(t => t.userData.lineId === 'central');
    const bore = []; u.scene.traverse(o => { if (o.isMesh && o.userData.type === 'tube-line' && o.userData.lineId === 'northern' && o.geometry.type === 'TubeGeometry') bore.push(o); });
    const tube = bore[0];
    const out = [];
    for (const m of MASTERS) {
      setMaster(m);
      const ratio = u.masterHeight.ratio, hs = u.getBuildingHeightScale();
      // Buildings: display height and aspect (height / side) against the real record.
      let worstBuilding = 0;
      for (const mesh of baked) for (let i = 0; i < Math.min(mesh.count, 200); i++) {
        const a = mesh.instanceMatrix.array, o = i * 16, realH = a[o + 5] / VE;
        worstBuilding = Math.max(worstBuilding, Math.abs(a[o + 5] * hs * ratio - realH));
      }
      // London Eye: display bounds of the authored wheel and supports.
      eye.updateWorldMatrix(true, true);
      const eb = new T.Box3().setFromObject(eye);
      const eyeHeight = (eb.max.y - eb.min.y) * ratio, eyeWidth = Math.hypot(eb.max.x - eb.min.x, eb.max.z - eb.min.z);
      // Tower Bridge: height of the architecture above its deck against the span.
      tower.group.updateWorldMatrix(true, true);
      const tb = new T.Box3().setFromObject(tower.group);
      const towerAbove = (tb.max.y - tower.deckY) * ratio;
      // A Central line train: the displayed matrix is a pure rotation times its true size.
      train.updateMatrix();
      const D = new T.Matrix4().makeScale(1, ratio, 1).multiply(train.matrix), e = D.elements;
      const col = i => new T.Vector3(e[4 * i], e[4 * i + 1], e[4 * i + 2]);
      const trainCols = [col(0).length(), col(1).length(), col(2).length()];
      const trainSkew = Math.max(Math.abs(col(0).dot(col(1))), Math.abs(col(1).dot(col(2))), Math.abs(col(0).dot(col(2))));
      // A Northern line bore: the shader's axis unscale, through the display ratio.
      const p = tube.geometry.attributes.position, ax = tube.geometry.attributes.trueAxisY, k = window.__ug.trueProportion.trueProportionUniform.value;
      const ring = Math.floor(p.count / 11 / 2) * 11, pts = [];
      for (let j = 0; j < 10; j++) { const i = ring + j, a = ax.getX(i); pts.push(new T.Vector3(p.getX(i), (a + (p.getY(i) - a) * k) * ratio, p.getZ(i))); }
      const c = pts.reduce((s, q) => s.add(q), new T.Vector3()).multiplyScalar(0.1);
      const radii = pts.map(q => q.distanceTo(c));
      out.push({ m, worstBuilding, eyeHeight, eyeAspect: eyeHeight / eyeWidth, towerAbove, towerAspect: towerAbove / tower.deckSpan.length,
        trainCols, trainSkew, boreMin: Math.min(...radii), boreMax: Math.max(...radii), boreDepth: c.y, boreParam: tube.geometry.parameters.radius,
        boreMaterial: tube.material.userData.trueProportion });
    }
    return out;
  }, { MASTERS, setMasterSrc });
  const first = rows[0];
  for (const r of rows) {
    expect(r.worstBuilding, `buildings at Master ${r.m}`).toBeLessThan(1e-3);
    expect(r.eyeHeight, `Eye height at Master ${r.m}`).toBeCloseTo(first.eyeHeight, 3);
    expect(r.eyeAspect, `Eye aspect at Master ${r.m}`).toBeCloseTo(first.eyeAspect, 4);
    expect(r.towerAbove, `Tower Bridge height above deck at Master ${r.m}`).toBeCloseTo(first.towerAbove, 3);
    expect(r.towerAspect).toBeCloseTo(first.towerAspect, 5);
    r.trainCols.forEach((v, i) => expect(v, `train axis ${i} at Master ${r.m}`).toBeCloseTo(first.trainCols[i], 6));
    expect(r.trainSkew).toBeLessThan(1e-6);
    expect(r.boreMaterial).toBe('axis');
    expect(r.boreMin, `bore round at Master ${r.m}`).toBeGreaterThan(r.boreParam - 1e-3);
    expect(r.boreMax).toBeLessThan(r.boreParam + 1e-3);
  }
  // True sizes, not just invariance: the Eye stands 135m, the Northern bore is 3.56m across.
  expect(first.eyeHeight).toBeGreaterThan(125); expect(first.eyeHeight).toBeLessThan(150);
  expect(first.boreParam).toBeCloseTo(3.56 / 2, 6);
  // A tube train fills its true bore as it always did (section about 3m, length 96m).
  expect(first.trainCols[0]).toBeLessThan(2 * first.boreParam);
  expect(first.trainCols[2]).toBeCloseTo(1, 9);
});

test('Master still stretches the landscape: terrain relief, tunnel depth and roofs follow it; bores stay round', async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  const rows = await page.evaluate(async ({ setMasterSrc }) => {
    const u = window.__ug, setMaster = eval(setMasterSrc);
    const hill = { x: 1500, z: -9000 }, river = { x: 0, z: 700 }; // Hampstead side vs Thames bed
    const tube = []; u.scene.traverse(o => { if (o.isMesh && o.userData.type === 'tube-line' && o.userData.lineId === 'victoria' && o.geometry.type === 'TubeGeometry') tube.push(o); });
    const axis = tube[0].geometry.attributes.trueAxisY, deepest = Math.min(...Array.from(axis.array));
    const out = [];
    for (const m of [1, 2, 10]) {
      setMaster(m);
      const ratio = u.masterHeight.ratio;
      const relief = (u.getTerrainMeshSurfaceY(hill) - u.getTerrainMeshSurfaceY(river)) * ratio;
      out.push({ m, relief, depth: deepest * ratio, canonicalAxis: Math.min(...Array.from(axis.array)) });
    }
    return out;
  }, { setMasterSrc });
  expect(rows[0].relief).toBeGreaterThan(10);
  for (const r of rows) {
    expect(r.relief / r.m, `relief scales with Master ${r.m}`).toBeCloseTo(rows[0].relief, 6);
    expect(r.depth / r.m, `tunnel depth scales with Master ${r.m}`).toBeCloseTo(rows[0].depth, 6);
    expect(r.canonicalAxis).toBe(rows[0].canonicalAxis);
  }
  // Pedestrian collision roofs stand at the true building height above the
  // stretched ground (roofY = base + authored x factor).
  const roof = await page.evaluate(async ({ setMasterSrc }) => {
    const u = window.__ug, setMaster = eval(setMasterSrc), c = u.modes.collision, VE = u.VERTICAL_EXAGGERATION;
    c.sync();
    // A free-standing 15m+ building in the central baked tiles.
    let mesh = null, i = -1;
    u.scene.traverse(o => {
      if (mesh || !o.isInstancedMesh || !o.name.startsWith('baked-buildings-')) return;
      const a = o.instanceMatrix.array;
      for (let j = 0; j < o.count; j++) if (a[j * 16 + 5] / VE >= 15 && a[j * 16] >= 12) { mesh = o; i = j; break; }
    });
    const a = mesh.instanceMatrix.array;
    const x = a[i * 16 + 12], base = a[i * 16 + 13], z = a[i * 16 + 14], real = a[i * 16 + 5] / VE;
    mesh.updateWorldMatrix(true, false);
    const w = new window.__ugTHREE.Vector3(x, base, z).applyMatrix4(mesh.matrixWorld);
    const out = [];
    for (const m of [1, 1.1, 10]) { setMaster(m); c.sync(); const r = c.roofHeightAt(w.x, w.z); out.push({ m, shown: (r - w.y) * u.masterHeight.ratio, real, hit: r !== null }); }
    return out;
  }, { setMasterSrc });
  for (const r of roof) { expect(r.hit).toBe(true); expect(r.shown, `roof at Master ${r.m}`).toBeGreaterThanOrEqual(r.real - 1e-3); }
  expect(roof[0].shown).toBeCloseTo(roof[2].shown, 3);
});

test('every bridge deck meets its banks at Master 1, 1.1 and the maximum', async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  const rows = await page.evaluate(async ({ setMasterSrc }) => {
    const u = window.__ug, T = window.__ugTHREE, setMaster = eval(setMasterSrc), out = [];
    for (const m of [1, 1.1, u.masterHeight.max]) {
      setMaster(m);
      const ratio = u.masterHeight.ratio;
      for (const [slug, rec] of u.bridgeRegistry) {
        if (!rec.group.visible) continue; // QE2 / Runnymede replaced by the M25 model
        const v = new T.Vector3(), p = rec.deckMesh.geometry.attributes.position; rec.deckMesh.updateWorldMatrix(true, false);
        const end = { a: -Infinity, b: -Infinity };
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(rec.deckMesh.matrixWorld);
          for (const k of ['a', 'b']) if (Math.hypot(v.x - rec.deckEndpoints[k].x, v.z - rec.deckEndpoints[k].z) < 20) end[k] = Math.max(end[k], v.y);
        }
        for (const k of ['a', 'b']) out.push({ m, slug, k, gap: (end[k] - u.getTerrainMeshSurfaceY(rec.deckEndpoints[k])) * ratio,
          clearance: (rec.deckY - rec.waterSurfaceY) * ratio, dataClearance: rec.data.clearanceM });
      }
    }
    return out;
  }, { setMasterSrc });
  expect(rows.length).toBeGreaterThan(3 * 2 * 35);
  for (const r of rows) {
    // Deck top (parapets included) within a few real metres of the bank: it
    // lands on it, neither hanging over it nor sunk into it.
    expect(r.gap, `${r.slug} end ${r.k} at Master ${r.m}`).toBeGreaterThan(0);
    expect(r.gap, `${r.slug} end ${r.k} at Master ${r.m}`).toBeLessThan(5);
  }
  // Mid-span the deck stands at the same true clearance over the water at every Master.
  const bySlug = new Map();
  for (const r of rows) { if (!bySlug.has(r.slug)) bySlug.set(r.slug, r.clearance); expect(r.clearance, r.slug).toBeCloseTo(bySlug.get(r.slug), 4); }
});
