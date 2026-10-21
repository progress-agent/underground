// Chalk floor displacement goldens (sprint 21Oct26w, lane L, approach F). Run against a checkout's own geology.js
// (7c2d4bd's, for the goldens): it gives the displacement above the chalk datum at fixed points, with the real M25
// ring installed through the checkout's own createGeologicalStrata (which stores the ring before it needs terrain
// bounds), by the exported getChalkSurfaceY. Usage: node tests/fixtures/chalk-goldens.mjs <path to src/geology.js>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function samplePoints(count = 600) {
  // A fixed LCG over the terrain's scene extent, plus points on and near the ring so the rim-flatten is exercised.
  const pts = [];
  let seed = 20211021;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) pts.push([-35000 + rnd() * 70000, -27000 + rnd() * 54000]);
  return pts;
}

export async function chalkValues(geologyJsPath) {
  const root = path.resolve(path.dirname(path.resolve(geologyJsPath)), '..');
  const geo = await import(pathToFileURL(path.resolve(geologyJsPath)).href);
  const m25 = JSON.parse(readFileSync(path.join(root, 'public/data/m25.json'), 'utf8'));
  try { geo.createGeologicalStrata(m25.supportPoints || m25.points); } catch (_) { /* no terrain bounds in node: the ring is already stored */ }
  const pts = samplePoints();
  // Points hugging the ring: scene coords of every 40th decimated vertex, nudged inward and outward.
  const ring = (m25.supportPoints || m25.points).filter((_, i) => i % 40 === 0);
  const { BNG_REF_E, BNG_REF_N } = await import(pathToFileURL(path.join(root, 'src/coordinates.js')).href);
  for (const p of ring) for (const d of [-300, 0, 300, 900]) pts.push([p.e - BNG_REF_E + d, -(p.n - BNG_REF_N)]);
  return pts.map(([x, z]) => [x, z, geo.getChalkSurfaceY(x, z) - geo.CHALK_TOP_Y]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await chalkValues(process.argv[2])));
}
