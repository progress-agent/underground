// Independent serial acceptance. Run only after root grants the GPU token.
// node scripts/review-experience.mjs <dev-origin> <evidence-dir>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const [origin, out] = process.argv.slice(2);
if (!origin || !out) throw Error('Expected dev origin and evidence directory');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const report = { origin, viewport: [1440, 900], dpr: 2, errors: [], warnings: [], sourceRequests: [], captures: [], probes: {} };
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
  page.on('request', r => { if (/\/surface\/tiles\/(?!manifest).*\.json/.test(r.url())) report.sourceRequests.push(r.url()); });
  await page.addInitScript(() => {
    window.__acceptanceOpening = { done: false };
    window.addEventListener('ug:intro-done', () => { window.__acceptanceOpening = { done: true, at: performance.now() }; });
  });
  await page.goto(`${origin}/?buildings=baked&mh=1.1&bh=2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !window.__acceptanceOpening.done && Number(document.getElementById('ug-readout-alt')?.textContent) > 1000);
  await page.screenshot({ path: `${out}/opening.png` });
  await page.waitForFunction(() => window.__acceptanceOpening.done, null, { timeout: 30000 });
  report.opening = await page.evaluate(() => window.__acceptanceOpening);
  if (report.opening.at < 8000) throw Error('Opening skipped or shortened');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.parkLabelsGroup && window.__ug.thamesMesh &&
    window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal && document.getElementById('loadingBar')?.classList.contains('done'),
  null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  report.vertexBuffers=await page.evaluate(()=>{
    const u=window.__ug,result=[];
    for(const name of ['terrainMesh','terrainUnderside','thamesRiver','thamesInteriorShell']){
      const m=u.scene.getObjectByName(name),g=m?.geometry;if(!g)throw Error(`Missing live ${name}`);
      let maxIndex=-1;for(const index of g.index?.array||[])maxIndex=Math.max(maxIndex,index);
      const attributes={};for(const [key,a]of Object.entries(g.attributes)){
        if(a.count<=maxIndex)throw Error(`${name}.${key} buffer is too short`);
        for(const value of a.array)if(!Number.isFinite(value))throw Error(`${name}.${key} is nonfinite`);
        attributes[key]=a.count;
      }result.push({name,maxIndex,attributes});
    }return result;
  });
  report.gpu = await page.evaluate(() => {
    const u = window.__ug, gl = u.composer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), master: u.masterHeight.value,
      structure: u.getBuildingHeightScale() * 5, quality: u.renderQuality.get(), mode: u.renderQualityMode };
  });
  await page.screenshot({ path: `${out}/landing.png` });
  const beforeFlight = await page.evaluate(() => window.__ug.camera.position.toArray());
  await page.keyboard.down('KeyE'); await page.waitForTimeout(1600); await page.keyboard.up('KeyE');
  const afterFlight = await page.evaluate(() => window.__ug.camera.position.toArray());
  report.flight = { before: beforeFlight, after: afterFlight };
  if (afterFlight[1] <= beforeFlight[1]) throw Error('Real keyboard flight failed');
  await page.screenshot({ path: `${out}/keyboard-flight.png` });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: .75, samples: 2 }); u.controls.enableDamping = false; });
  const describe = () => page.evaluate(() => {
    const u = window.__ug;
    const labels = [...document.querySelectorAll('.station-label')].map(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { text: el.textContent, font: Number.parseFloat(style.fontSize), opacity: +style.opacity,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display };
    }).filter(r => r.width && r.height && r.opacity > .2 && r.x < innerWidth && r.y < innerHeight && r.x + r.width > 0 && r.y + r.height > 0);
    const overlaps = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) overlaps.push([a.text, b.text]);
    }
    return { position: u.camera.position.toArray(), target: u.controls.target.toArray(), share: u.getShareUrl(), labels, overlaps,
      substrate: u.classifySubstrateAt(u.camera.position), water: u.submergedBlend, parksVisible: u.parkLabelsGroup.visible,
      mapVisible: !!document.getElementById('ug-mini-map')?.getBoundingClientRect().width,
      samples: [u.composer.renderTarget1.samples, u.composer.renderTarget2.samples],
      canvas: [u.composer.renderer.domElement.width, u.composer.renderer.domElement.height],
      mask: [u.underwaterSurface.maskTarget.width, u.underwaterSurface.maskTarget.height],
      sceneDepth: [u.composer.renderTarget1.depthTexture.image.width, u.composer.renderTarget1.depthTexture.image.height] };
  });
  const pose = async (name, position, target) => {
    await page.evaluate(({ position, target }) => {
      const u = window.__ug; u.fpsControls.keys.clear(); u.materialResistance.cancel();
      u.camera.position.set(...position); u.controls.target.set(...target); u.controls.update(); u.camera.updateMatrixWorld(true);
    }, { position, target });
    await page.waitForTimeout(300);
    const state = await describe();
    await page.screenshot({ path: `${out}/${name}.png` });
    report.captures.push({ name, ...state }); await save();
    console.log(JSON.stringify({ capture: name, substrate: state.substrate, labels: state.labels.length, overlaps: state.overlaps.length }));
    return state;
  };
  const station = await page.evaluate(() => {
    for (const { stationsLayer } of window.__ug.lineShaftLayers.values()) {
      const station = stationsLayer?.stations.find(s => /^Oxford Circus/.test(s.name));
      if (station) return { name: station.name, position: station.pos.toArray(), surface: station.surfaceY };
    }
    throw Error('Actual Oxford Circus station missing');
  });
  report.station = station;
  for (const mode of ['surface', 'underground']) for (const distance of [1500, 800, 250]) {
    const [x, y, z] = station.position, anchor = mode === 'surface' ? station.surface : y;
    await pose(`station-${mode}-${distance}`, [x, anchor + (mode === 'surface' ? 30 : 0), z - distance], [x, anchor, z]);
  }
  const river = await page.evaluate(() => {
    const u = window.__ug, a = u.thamesMesh.geometry.attributes.position.array, results = [];
    for (const [name, lat, lon] of [['kew',51.4876,-.2867],['westminster',51.5009,-.1217],['tower-bridge',51.5055,-.0754],['woolwich',51.4971,.0646]]) {
      const wanted=u.llToXZ(lat,lon);
      let best, score = Infinity;
      for (let i = 0; i < a.length - 12; i += 12) {
        const x = (a[i] + a[i + 3]) / 2, z = (a[i + 2] + a[i + 5]) / 2;
        const bed = u.getTerrainMeshSurfaceY({ x, z }), chain = u.nearestThamesSegment(x, z);
        if (bed === null) continue;
        if (Math.hypot(x-wanted.x,z-wanted.z) < score) {
          score = Math.hypot(x-wanted.x,z-wanted.z); best = { name, x, z, bed, top: u.WATER_TOP_Y, chain, distanceToGeographicTarget:score,
            dx: (a[i + 12] + a[i + 15]) / 2 - x, dz: (a[i + 14] + a[i + 17]) / 2 - z,
            left: [a[i], a[i + 2]], right: [a[i + 3], a[i + 5]] };
        }
      }
      if (!best || score>250) throw Error(`No geographically matched river section at ${name}: distance ${score}`);
      if ((best.top-best.bed)*u.masterHeight.ratio<2*u.camera.near) throw Error(`Physical river column too thin at ${name}: ${best.top-best.bed} canonical units`);
      results.push(best);
    }
    return results;
  });
  report.river = river;
  report.geometry = await page.evaluate(river => {
    const u=window.__ug,T=window.__ugTHREE,mesh=u.scene.getObjectByName('terrainMesh');
    mesh.updateWorldMatrix(true,false);
    const ray=new T.Raycaster(), points=[];
    for(const section of river) for(const fraction of [.08,.3,.5,.7,.92]) {
      const x=section.left[0]+fraction*(section.right[0]-section.left[0]),z=section.left[1]+fraction*(section.right[1]-section.left[1]);
      ray.set(new T.Vector3(x,20000,z),new T.Vector3(0,-1,0));
      const hits=ray.intersectObject(mesh,false),sample=u.getTerrainMeshSurfaceY({x,z});
      if(!hits.length)throw Error(`No actual terrain triangle under ${section.name}/${fraction}`);
      const visible=hits[0].point.y,error=Math.abs(visible-sample);
      if(error>.02)throw Error(`Visible floor and classifier disagree ${section.name}/${fraction}: ${visible}/${sample}`);
      points.push({name:section.name,fraction,x,z,sample,visible,error,below:u.classifySubstrateAt({x,y:visible-.1,z}),above:u.classifySubstrateAt({x,y:(visible+u.WATER_TOP_Y)/2,z})});
    }
    return {points,terrainTriangles:mesh.geometry.index.count/3,refinedTriangles:u.getTerrainRiverBed().triangles.length};
  },river);
  for (const [index, r] of river.entries()) {
    const p = [r.x, (r.bed + r.top) / 2, r.z];
    await pose(`river-${r.name}-along`, p, [r.x + r.dx * 5, p[1], r.z + r.dz * 5]);
    await pose(`river-${r.name}-up`, p, [r.x + r.dx, p[1] + 1000, r.z + r.dz]);
    await pose(`river-${r.name}-bed`, p, [r.x + r.dx, r.bed - 1000, r.z + r.dz]);
    if(r.name==='westminster'||r.name==='tower-bridge'){
      const dx=r.left[0]-r.x,dz=r.left[1]-r.z,n=Math.hypot(dx,dz),nx=dx/n,nz=dz/n;
      await pose(`river-${r.name}-near-bank-up`,[r.left[0]-nx*10,p[1],r.left[1]-nz*10],
        [r.left[0]+nx*50,r.top+300,r.left[1]+nz*50]);
    }
  }
  for (const id of ['hyde-park', 'regents-park', 'victoria-park', 'richmond-park']) {
    const park = await page.evaluate(id => {
      const u = window.__ug, p = u.parkLabelsGroup.userData.registry.parks.find(p => p.id === id), ring = p.rings[0];
      const xs = ring.map(v => v[0]), zs = ring.map(v => v[1]);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
      return { x, z, surface: u.getTerrainMeshSurfaceY({ x, z }), chalk: u.getChalkSurfaceY(x, z),
        span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) };
    }, id);
    await pose(`${id}-top`, [park.x, park.surface + park.span * 8, park.z + park.span * .3], [park.x, park.surface, park.z]);
    await pose(`${id}-clay`, [park.x, park.chalk + 100, park.z + 10], [park.x, park.surface, park.z]);
    if (id === 'hyde-park' || id === 'regents-park') {
      await pose(`${id}-chalk`, [park.x, park.chalk - 400, park.z + 10], [park.x, park.surface, park.z]);
      await pose(`${id}-underside-overview`, [park.x, park.surface-park.span*8, park.z+park.span*.3], [park.x,park.surface,park.z]);
    }
  }
  const dock=await page.evaluate(()=>{
    const m=window.__ug.airportDockGroup.children[0],p=m.geometry.attributes.position;m.geometry.computeBoundingBox();
    const b=m.geometry.boundingBox;return{x:(b.min.x+b.max.x)/2,z:(b.min.z+b.max.z)/2,y:p.getY(0),span:b.max.x-b.min.x,reference:m.userData};
  });report.dock=dock;
  await pose('airport-dock-overview',[dock.x,dock.y+dock.span*8,dock.z+dock.span*.3],[dock.x,dock.y,dock.z]);
  await pose('whole-city', [0, 20000, 18000], [0, 0, 0]);
  // Preserve exact source-derived poses for subsequent built-baseline ABBA runs.
  await writeFile(`${out}/poses.json`, JSON.stringify(report.captures.map(({ name, position, target, share }) => ({ name, position, target, share })), null, 2));
  report.complete = true;
  await save();
} catch (error) { report.failure = error.stack; await save(); throw error; }
finally { await browser.close(); }
