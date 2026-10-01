// capture-clouds.mjs: captures of the cloud layer (Lane C: sprint 25Sep26f, D-039;
// sprint 30Sep26w, D-041).
//
// Usage: node scripts/capture-clouds.mjs <origin> <outDir> [options]
//   origin        a dev server (window.__ug and window.__ugClouds are dev-only)
//   --tag <name>  clouds ON, one file per shot: <shot>-<name>.png (default "after").
//                 Run it once against the old build (--tag before) and once
//                 against the new one (--tag after) for a like-for-like pair.
//   --onoff       the sprint 25Sep26f mode instead: clouds OFF ("before") and
//                 ON ("after") at the same pose on one build.
//   --shots a,b   a subset of SHOTS (default: all).
//   --time <s>    world clock in seconds (default 900: the same sky in every shot;
//                 a shot may set its own).
// Every shot: Manual quality at 100% and MSAA 4x, sun shadows on, headless
// Chromium with ANGLE Metal (real GPU). Most shots are 1440x900 at DPR 1;
// Jordan's pose is 1344x821 at DPR 2, the size of his screenshot (2688x1642).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Poses are canonical scene coordinates (x east, y up at VE5, z south). At the
// default Master 1.1 the camera's display height is y x 0.22. `above` gives a
// real height above the local ground instead of y: [x, metres, z].
export const SHOTS = {
  overview: { label: 'Overview of the city from about 4.4 km (display)', p: [0, 20000, 18000], t: [0, 0, 0] },
  street: { label: 'Street near Bank looking up at the sky', p: [2952.9, 337.8, -732.9], t: [1900, 3300, -300] },
  above: { label: 'Above the clouds, about 3 km up, looking over the layer', p: [-2500, 14000, 9000], t: [1500, 2500, -6000] },
  dawn: { label: 'Dawn: from about 330 m, looking east towards the low sun', p: [-3000, 1500, 3000], t: [5000, 7200, -1000], sun: 0.02 },
  dusk: { label: 'Dusk: from about 330 m, looking west towards the low sun', p: [3000, 1500, 3000], t: [-5000, 7200, -1000], sun: 0.98 },
  morningLow: { label: 'Default morning from the same spot as dawn, for comparison', p: [-3000, 1500, 3000], t: [5000, 7200, -1000] },
  shadows: { label: 'Cloud shadows on the city at midday, looking down from about 3.3 km through the thinned layer', p: [0, 15000, 6000], t: [0, 0, 1500], sun: 0.5 },
  edge: { label: 'Towards the northern M25 edge from about 2.6 km up', p: [3000, 12000, -4000], t: [5000, 0, -21000] },
  // Jordan's screenshot (26Sep26s, sprint 25Sep26f preview): above Southwark and
  // Borough, +122 m. Fitted to his screenshot: the heading from the station labels
  // (Borough, Southwark, Elephant & Castle, Kennington, Brixton; the compass then
  // reads 186 degrees against his 185), the pitch from the horizon, which stands
  // 4.3 degrees above the centre of his picture (so the camera looks about 4.7
  // degrees down, not up), and the sun ahead at midday, about 7 degrees above
  // the horizon at Master 1.1, as in his screenshot.
  // World time 3000 s: the sun shows through a gap, as in his screenshot.
  jordan: { label: "Jordan's pose: above Southwark, +122 m, looking south, midday sun ahead", above: [1860, 122, -340], dir: [0.1045, 0.9945], pitchDeg: -4.7, sun: 0.5, mh: 1.1, size: [1344, 821], dpr: 2, time: 3000 },
};

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VALUED = new Set(['--tag', '--shots', '--time']);
const [origin = 'http://localhost:5214', outDir = './cloud-captures'] = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]));
const tag = opt('--tag', 'after');
const onoff = args.includes('--onoff');
const T_WORLD = +opt('--time', 900);
const names = (opt('--shots', '') || Object.keys(SHOTS).join(',')).split(',');
for (const n of names) if (!SHOTS[n]) throw new Error(`unknown shot ${n}`);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const errors = [];
const index = [];

// One page per (size, dpr): shots sharing a size share a page load.
const groups = new Map();
for (const n of names) {
  const s = SHOTS[n], k = `${(s.size ?? [1440, 900]).join('x')}@${s.dpr ?? 1}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(n);
}
for (const [k, group] of groups) {
  const s0 = SHOTS[group[0]];
  const [w, h] = s0.size ?? [1440, 900];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: s0.dpr ?? 1 });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${origin}/?fast=1&buildings=baked`);
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ugClouds
    && document.querySelector('#loadingBar')?.classList.contains('done'), null, { timeout: 240000 });
  await page.waitForTimeout(2500); // the TfL notice and the bar's fade clear
  await page.evaluate((tw) => {
    const u = window.__ug; u.controls.enableDamping = false; u.fpsControls.enabled = false;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setShadowsEnabled(true, { persist: false });
    window.__ugClouds.setTimeOverride(tw);
    document.getElementById('hudDetails')?.removeAttribute('open');
  }, T_WORLD);
  for (const name of group) {
    const s = SHOTS[name];
    for (const phase of onoff ? ['before', 'after'] : [tag]) {
      const pose = await page.evaluate(({ s, on, tw }) => {
        const u = window.__ug;
        u.masterHeight.setValue(s.mh ?? 1.1);
        window.__ugSun.setTime(s.sun ?? window.__ugSun.DEFAULT_SUN_TIME, { persist: false });
        window.__ugClouds.setEnabled(on);
        window.__ugClouds.setTimeOverride(s.time ?? tw);
        let p = s.p, t = s.t;
        if (s.above) {
          const [x, m, z] = s.above, y = u.getTerrainMeshSurfaceY({ x, z }) + m * u.VERTICAL_EXAGGERATION;
          p = [x, y, z];
          // Display pitch -> canonical: the display squashes y by the Master ratio.
          const ratio = u.masterHeight.ratio, dy = Math.tan(s.pitchDeg * Math.PI / 180) / ratio;
          t = [x + s.dir[0] * 1000, y + dy * 1000, z + s.dir[1] * 1000];
        }
        u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
        return { p: p.map(v => +v.toFixed(1)), t: t.map(v => +v.toFixed(1)) };
      }, { s, on: onoff ? phase === 'after' : true, tw: T_WORLD });
      await page.waitForTimeout(1800);
      const file = `${name}-${phase}.png`;
      await page.screenshot({ path: join(outDir, file) });
      const st = await page.evaluate(() => { const c = window.__ugClouds.status; return { visibleClouds: c.visibleClouds, instances: c.instances, shadow: +c.shadowStrength.toFixed(3), opacity: c.opacity }; });
      index.push({ file, shot: name, phase, label: s.label, pose: { ...pose, sun: s.sun ?? 'default', mh: s.mh ?? 1.1, worldTime: s.time ?? T_WORLD }, size: `${k}`, status: st });
      console.log(file, JSON.stringify(st));
    }
  }
  await page.close();
}
await writeFile(join(outDir, `captures-${onoff ? 'onoff' : tag}.json`), JSON.stringify({ origin, worldTime: T_WORLD, errors, index }, null, 1));
if (errors.length) console.log('page errors:', errors);
await browser.close();
