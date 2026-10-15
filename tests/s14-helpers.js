// Shared helpers for the lane S browser specs (sprint 14Oct26w). Not a spec: Playwright only runs *.spec.js.
// installLib() runs INSIDE the page and defines window.__s14 on top of the dev handles (window.__ug, __ugTHREE).

export const VE = 5;

export async function boot(page, { motorway = true } = {}) {
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
  await page.waitForFunction((m) => {
    const ug = window.__ug, b = ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && ug.bridgeRegistry.size === 41
      && ug.stationBuildings.ready && ug.buildingInstanceCount > 100000
      && (!m || !!ug.scene.getObjectByName('m25Motorway'));
  }, motorway, { timeout: 150000 });
  await page.evaluate(installLib);
}

export async function enter(page, key = '2') {
  await page.keyboard.press(key);
  const id = { 2: 'pedestrian', 3: 'drone', 4: 'balloon' }[key];
  await page.waitForFunction((id) => window.__ug.modes.activeId === id
    && (id !== 'pedestrian' || window.__ug.modes.registry.get('pedestrian').debug().phase === 'body'), id, { timeout: 30000 });
}

export async function setMaster(page, value) {
  await page.evaluate(async (v) => {
    const el = document.getElementById('masterHeight');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    window.__ug.structureMorph.flush();
    for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r));
  }, value);
}

export async function installLib() {
  const ug = window.__ug, T = window.__ugTHREE, VE = 5;
  const col = () => ug.modes.collision;
  const ray = new T.Raycaster();
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const lib = window.__s14 = {};
  const bridgesModule = await import('/src/bridges.js');
  lib.piers = (rec) => bridgesModule.bridgePierAnchors(rec.data);

  lib.frame = (rec, vOff = 0) => {
    const a = rec.deckEndpoints.a, b = rec.deckEndpoints.b;
    const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    return { a, b, L, ux, uz, nx: -uz, nz: ux, vOff };
  };
  lib.at = (f, u, v) => ({ x: f.a.x + f.ux * u + f.nx * (v + f.vOff), z: f.a.z + f.uz * u + f.nz * (v + f.vOff) });
  lib.yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  lib.deckTop = (rec, x, z, y0 = 1e5) => {
    ray.set(V(x, y0, z), V(0, -1, 0)); ray.far = 2e5;
    const h = ray.intersectObject(rec.deckMesh, false)[0];
    return h ? h.point.y : null;
  };
  lib.undersideAbove = (rec, x, y0, z) => {
    ray.set(V(x, y0, z), V(0, 1, 0)); ray.far = 2e5;
    const h = ray.intersectObject(rec.deckMesh, false)[0];
    return h ? h.point.y : null;
  };
  lib.drawnBridgeMeshes = (rec) => rec.group.children.filter(m => !m.name.endsWith(':cables'));
  lib.halfWidth = (rec, f) => {
    const mid = lib.at(f, f.L / 2, 0);
    const top = lib.deckTop(rec, mid.x, mid.z);
    if (top === null) return null;
    const y = top - 0.1 * VE;
    let e = 0;
    for (const s of [1, -1]) {
      ray.set(V(mid.x + f.nx * s * 80, y, mid.z + f.nz * s * 80), V(-f.nx * s, 0, -f.nz * s)); ray.far = 160;
      const h = ray.intersectObject(rec.deckMesh, false)[0];
      if (!h) return null;
      e += 80 - h.distance;
    }
    return e / 2;
  };
  lib.solidBridges = () => [...ug.bridgeRegistry.entries()].filter(([, r]) => r.group.visible);

  /** Walk W from (x0, z0) facing (dx, dz) for up to maxSteps; collect what the walker did. */
  lib.walk = ({ x0, z0, dx, dz, maxSteps = 8000, stop = null, onStep = null }) => {
    const m = ug.modes.registry.get('pedestrian');
    m.place(x0, z0, { yaw: lib.yawOf(dx, dz), pitch: 0 });
    ug.fpsControls.keys.add('w');
    const out = { steps: 0, swim: false, airRun: 0, airMax: 0, trace: [], last: null };
    for (let i = 0; i < maxSteps; i++) {
      ug.modes.update(1 / 60);
      const d = m.debug();
      out.steps = i + 1; out.last = d;
      if (d.state === 'swim') out.swim = true;
      out.airRun = d.state === 'air' ? out.airRun + 1 : 0;
      if (out.airRun > out.airMax) out.airMax = out.airRun;
      if (onStep) onStep(d, i, out);
      if (stop && stop(d, i, out)) break;
    }
    ug.fpsControls.keys.delete('w');
    return out;
  };

  /** S-01 / S-02 for one bridge deck. */
  lib.bridgeWalk = (slug, vOff) => {
    const rec = ug.bridgeRegistry.get(slug), f = lib.frame(rec, vOff), c = col();
    const hw = lib.halfWidth(rec, { ...f }) ?? rec.data.deckWidthM / 2;
    // The approach: from 20 m before the deck end, along the axis, unless a map box or water is in the way.
    let blocked = false;
    for (let s = -20; s <= 0; s++) {
      const p = lib.at(f, s, 0);
      if (c.buildingsNear(p.x, p.z, 0.4).length || c.waterAt(p.x, p.z)) { blocked = true; break; }
    }
    const start = lib.at(f, blocked ? -2 : -20, 0);
    let furthest = -Infinity, minRel = Infinity, maxRel = -Infinity, noHit = 0, maxOff = 0, onDeckSteps = 0;
    const out = lib.walk({
      x0: start.x, z0: start.z, dx: f.ux, dz: f.uz, maxSteps: 8000,
      onStep: (d) => {
        const u = (d.x - f.a.x) * f.ux + (d.z - f.a.z) * f.uz, v = (d.x - f.a.x) * f.nx + (d.z - f.a.z) * f.nz - vOff;
        if (u > furthest) furthest = u;
        if (u >= 0 && u <= f.L) {
          onDeckSteps++;
          const top = lib.deckTop(rec, d.x, d.z, d.y + 2.5 * VE);
          if (top === null) noHit++;
          else { const rel = (d.y - top) / VE; if (rel < minRel) minRel = rel; if (rel > maxRel) maxRel = rel; }
          if (Math.abs(v) > maxOff) maxOff = Math.abs(v);
        }
      },
      stop: (d) => ((d.x - f.a.x) * f.ux + (d.z - f.a.z) * f.uz) >= f.L + 3 || !!d.card,
    });
    return { slug, vOff, blocked, hw, L: f.L, furthest, minRel, maxRel, noHit, maxOff, onDeckSteps,
      steps: out.steps, swim: out.swim, airMax: out.airMax, card: !!out.last?.card, end: [out.last.x, out.last.y, out.last.z] };
  };
}
