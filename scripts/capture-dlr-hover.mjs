// The DLR hover over its measured deck, as a viewer sees it (sprint 30Sep26w,
// D-041, Lane R fix round 1). A real pointer over the surface railway's deck
// at a DLR node whose Environment Agency LiDAR deck is known, at the review
// Master (1.1) and at Master 3, so the tooltip's height can be read against
// the measurement and the drawn deck. Needs a DEV server (window.__ug).
//
//   node scripts/capture-dlr-hover.mjs <origin> <outDir> <tag> [--node <osm id>] [--masters 1.1,3]
//   node scripts/capture-dlr-hover.mjs <origin> <outDir> <tag> --pose <name in capture-surface-rail.mjs> --pointer <x,y> [--masters 1.1]
//
// Default node 1752319982: a LiDAR deck of 7.92 m between Canning Town and
// Royal Victoria, the first of the four the verifier read (it printed "~7.2m"
// at Master 1.1 and "~2.6m" at Master 3). The camera stands 150 m off the
// node on a diagonal, 45 m up, looking at it; the first of the four diagonals
// from which the real hover picker reaches the deck is used, and its pose is
// written out. Writes <tag>-R7-dlr-hover-m<Master>.png (the page, tooltip
// included) and <tag>-R7-dlr-hover.json: the pose, and for each Master the
// tooltip text, the LiDAR deck from src/dlr-deck-heights.json and the drawn
// deck above the terrain in true metres, read from the profile the railway
// is built on. The second form holds a lane pose and a fixed pointer instead
// (R7b: the pointer on the West India Quay deck in pose R4, where the drawn
// deck departs from the measured one) and writes <tag>-R7b-dlr-hover-*.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { POSES } from './capture-surface-rail.mjs';

const [origin, outDir, tag] = process.argv.slice(2);
if (!origin || !outDir || !tag) throw new Error('usage: capture-dlr-hover.mjs <origin> <outDir> <tag> [--node <osm id>] [--masters 1.1,3]');
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const masters = arg('--masters', '1.1,3').split(',');
const nodeId = arg('--node', '1752319982');
const deckFile = JSON.parse(await readFile(new URL('../src/dlr-deck-heights.json', import.meta.url), 'utf8'));
const profileData = JSON.parse(await readFile(new URL('../src/dlr-profile-data.json', import.meta.url), 'utf8'));
const node = profileData.nodes.find(n => String(n.id) === nodeId), deck = deckFile.nodes[nodeId];
if (!node || !deck) throw new Error(`DLR node ${nodeId} has no profile node or no measured deck`);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${origin}/?fast=1&buildings=baked&mh=1.1`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
  && window.__ug.groundReady && window.__ug.overground?.userData.stationsAttached && window.__ug.surfaceRail?.stationLayers.size > 0, null, { timeout: 180000 });
await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });

/** Set Master and the camera (a diagonal off the node, or a given pose); where the node's deck projects, and how high it is drawn. */
const aim = (master, diagonal, pose) => page.evaluate(async ({ master, diagonal, pose, lat, lon }) => {
  const u = window.__ug, T = window.__ugTHREE;
  const el = document.getElementById('masterHeight'); el.value = master; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
  const c = u.llToXZ(lat, lon), scale = u.getBuildingHeightScale();
  const p = u.dlrProfile.sample({ x: c.x, z: c.z, structureScale: scale, kinds: ['elevated'], maxDistance: 40 });
  if (!pose) {
    const cx = c.x + diagonal[0] * 150, cz = c.z + diagonal[1] * 150;
    pose = { cam: [cx, u.getStructuralSurfaceY({ x: cx, z: cz }) + 45 * 5, cz], target: [c.x, p.y, c.z] };
  }
  u.camera.position.fromArray(pose.cam); u.controls.target.fromArray(pose.target); u.controls.update();
  await new Promise(r => setTimeout(r, 2500));
  const q = u.dlrProfile.sample({ x: c.x, z: c.z, structureScale: scale, kinds: ['elevated'], maxDistance: 40 });
  const v = new T.Vector3(c.x, q.y, c.z).project(u.camera);
  return { pose, x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, drawnM: (q.y - u.getStructuralSurfaceY(c)) / 5 / scale };
}, { master, diagonal, pose, lat: node.lat, lon: node.lon });

/** A real pointer at (x, y); the tooltip text, or '' if the picker shows none. */
async function hover(x, y) {
  await page.mouse.move(x + 40, y + 40, { steps: 3 }); await page.waitForTimeout(100);
  await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(400);
  return page.evaluate(() => { const t = document.getElementById('hoverTip'); return t && t.style.display !== 'none' ? t.textContent : ''; });
}

const fixedPose = arg('--pose', null), pointer = arg('--pointer', null)?.split(',').map(Number);
if (fixedPose) {
  // A lane pose and a fixed pointer: what the hover says there.
  const P = POSES[fixedPose]; if (!P || !pointer) throw new Error('--pose needs a known pose and --pointer x,y');
  const frames = [];
  for (const master of masters) {
    await page.evaluate(async ({ P, master }) => {
      const u = window.__ug;
      const el = document.getElementById('masterHeight'); el.value = master; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
      u.camera.position.fromArray(P.cam); u.controls.target.fromArray(P.target); u.controls.update();
      await new Promise(r => setTimeout(r, 2500));
    }, { P, master });
    const text = await hover(pointer[0], pointer[1]);
    const file = `${tag}-R7b-dlr-hover-${fixedPose}-m${master}.png`;
    await page.screenshot({ path: `${outDir}/${file}` });
    frames.push({ master: +master, file, pointer, tooltip: text });
    console.log(file, JSON.stringify(text));
  }
  await writeFile(`${outDir}/${tag}-R7b-dlr-hover-${fixedPose}.json`, JSON.stringify({ pose: fixedPose, frames }, null, 2) + '\n');
  await browser.close();
  process.exit(0);
}

const out = { node: nodeId, lat: node.lat, lon: node.lon, lidarDeckM: deck.m, deckSource: deck.source, frames: [] };
let pose = null;
for (const master of masters) {
  let at = null, text = '';
  for (const diagonal of pose ? [null] : [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
    at = await aim(master, diagonal, pose);
    text = await hover(at.x, at.y);
    if (/Elevated railway · .*above ground/.test(text)) { pose = at.pose; break; }
    at = null;
  }
  if (!at) throw new Error(`Master ${master}: the hover picker does not reach node ${nodeId}'s deck`);
  const file = `${tag}-R7-dlr-hover-m${master}.png`;
  await page.screenshot({ path: `${outDir}/${file}` });
  out.frames.push({ master: +master, file, pointer: [Math.round(at.x), Math.round(at.y)], tooltip: text, drawnDeckM: +at.drawnM.toFixed(2) });
  console.log(file, JSON.stringify(text), 'drawn', at.drawnM.toFixed(2), 'LiDAR', deck.m);
}
out.pose = { cam: pose.cam.map(v => +v.toFixed(1)), target: pose.target.map(v => +v.toFixed(1)) };
await writeFile(`${outDir}/${tag}-R7-dlr-hover.json`, JSON.stringify(out, null, 2) + '\n');
await browser.close();
