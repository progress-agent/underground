// count-cloud-pops.mjs: how many clouds appear or vanish along the no-pop
// flights (sprint 01Oct26h, Lane C, D-043). Evidence for the report: the same
// three flights as tests/clouds-no-pop.spec.js, on any build.
//
// Usage: node scripts/count-cloud-pops.mjs <dev origin> [out.json]
//
// A D-043 build reads each drawn puff's opacity back from the GPU (the cloud
// system's probe). A build before D-043 (387dff0 and earlier) has no probe, so
// this script mirrors that build's vertex shader on the CPU instead, from its
// own uniforms and instance buffer: the per-cloud thinning above each cloud's
// top and its puff-rank drop, the distance detail (largest puffs only from
// 5 km) and fade (15 to 24 km), Automatic's edge-smoothing puff keep, and the
// instance buffer the 25.5 km cull leaves. The mirror evaluates the edge fade
// in floats where the GPU samples an 8-bit texture, so its opacities differ
// from the GPU's by up to about 0.004; the counts of steps above 0.03 do not
// depend on that.
//
// Per flight it prints: frames; the distinct numbers of puffs and clouds drawn
// (one value = never stepped); puffs that joined or left the drawn set; the
// number of (puff, frame) pairs whose cloud opacity jumped by more than 0.03
// in a frame, and the largest such jump.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { installTickHooks, flyLeg } from '../tests/helpers/cloud-flight.js';

const [origin = 'http://localhost:5234', out = ''] = process.argv.slice(2);
const DT = 1 / 30;
const LEGS = [
  { name: 'climb', kind: 'climb', DT, toAltM: 3000 },
  { name: 'level-1km', kind: 'level', DT, start: [-10000, -4000], dir: [1, 0], distM: 20000, altM: 1000 },
  { name: 'street', kind: 'level', DT, start: [-10000, 2000], dir: [1, 0], distM: 20000, aboveGroundM: 15, sprint: true },
];

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await installTickHooks(page);
await page.goto(`${origin}/?fast=1&buildings=baked`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
  && window.__ug.groundReady && window.__ugClouds && window.__ug.intro && window.__ug.scene.getObjectByName('chalkFloor'), null, { timeout: 240000 });
const mirrored = await page.evaluate(async () => {
  const u = window.__ug, c = window.__ugClouds;
  u.fpsControls.enabled = false; u.controls.enableDamping = false;
  c.setTimeOverride(900);
  // Automatic, as Jordan flew: before D-043 its edge-smoothing level dropped puffs.
  u.setRenderQualityMode('auto');
  if (c.probe) return false;
  const { sampleEdgeFade, CLOUD_FIELD: F } = await import('/src/clouds-field.js');
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const V = u.camera.position.constructor, q = new V();
  const wrap = (v, o) => o + (((v - o) % F.size) + F.size) % F.size;
  c.probe = (renderer, camera) => {
    const U = c.material.uniforms, g = c.mesh.geometry, n = g.instanceCount;
    const aP = g.getAttribute('aPuff'), aC = g.getAttribute('aCloud'), aM = g.getAttribute('aMisc');
    const ratio = U.uRatio.value, master = ratio * 5, d = U.uDrift.value, inv = camera.matrixWorldInverse;
    const camY = camera.position.y * ratio;
    const perCloud = new Float32Array(n), near = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = wrap(aC.getX(i) + d.x, F.originX), cz = wrap(aC.getY(i) + d.y, F.originZ);
      const base = aC.getZ(i), height = aC.getW(i);
      const edge = sampleEdgeFade(c.layout, cx, cz);
      const thin = ss(0, 400, camY - (base * master + height)) * U.uThinOn.value;
      const keepThin = 1 + (U.uThinKeep.value - 1) * thin;
      const dist = q.set(cx, base * master / ratio, cz).applyMatrix4(inv).length();
      const lodKeep = 1 + (U.uFarKeep.value - 1) * ss(U.uLod.value.x, U.uLod.value.y, dist);
      const far = 1 - ss(U.uFade.value.x, U.uFade.value.y, dist);
      const keep = Math.min(U.uKeep.value, keepThin, lodKeep);
      const shown = edge >= 0.004 && far > 0 && aM.getX(i) <= keep + 1e-4;
      perCloud[i] = shown ? edge * far * (1 + (U.uThinAlpha.value - 1) * thin) * (1 + 0.6 * (1 - lodKeep)) : 0;
      const r = aP.getW(i);
      near[i] = ss(r * 0.6, r * 2.2, q.set(cx + aP.getX(i), (base * master + aP.getY(i)) / ratio, cz + aP.getZ(i)).applyMatrix4(inv).length());
    }
    return { count: n, perCloud, near, missing: 0, opacity: c.mesh.visible ? U.uOpacity.value : 0, layer: 1 };
  };
  return true;
});
console.log(origin, mirrored ? '(no probe: the build\'s shader mirrored on the CPU)' : '(GPU probe)');
const results = { origin, mirrored, legs: {} };
for (const leg of LEGS) {
  const r = await page.evaluate(flyLeg, leg);
  const s = { frames: r.frames, puffsDrawn: r.instances.length > 6 ? `${r.instances.length} values, ${Math.min(...r.instances)} to ${Math.max(...r.instances)}` : r.instances,
    cloudsDrawn: r.visibleClouds.length > 6 ? `${r.visibleClouds.length} values, ${Math.min(...r.visibleClouds)} to ${Math.max(...r.visibleClouds)}` : r.visibleClouds,
    joined: r.joined, left: r.left, jumpsOver003: r.bigSteps, largestJump: +r.maxCloudStep.toFixed(3), worst: r.worstCloud,
    automatic: await page.evaluate(() => window.__ug.adaptiveQuality.get()) };
  results.legs[leg.name] = s;
  console.log(leg.name.padEnd(10), JSON.stringify(s));
}
if (out) await writeFile(out, JSON.stringify(results, null, 1));
await browser.close();
