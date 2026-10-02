// R3 roads proof (sprint 02Oct26f, lane R): what do the existing surface tiles already hold for roads?
//   node scripts/r-roads/analyse-tiles.mjs        (reads public/data/surface/tiles, read-only)
// Answer on 02Oct26f: only highway=trunk and highway=primary (fetch-surface-tiles.mjs), every way at the default 14 m width.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { insideM25 } from './analyse-roads.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(REPO, 'public/data/surface/tiles');
const files = fs.readdirSync(dir).filter(f => /^tile_\d+_\d+\.json$/.test(f));
let ways = 0, kmAll = 0, kmInside = 0, kmUnique = 0, bytesRoads = 0, tileBytes = 0, verts = 0; const widths = {}, seen = new Set();
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f)); tileBytes += raw.length; const t = JSON.parse(raw);
  bytesRoads += Buffer.byteLength(JSON.stringify(t.roads || []));
  for (const r of t.roads || []) {
    ways++; verts += r.points.length; widths[r.width] = (widths[r.width] || 0) + 1;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i], b = r.points[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000; kmAll += L;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (insideM25(mx, mz)) { kmInside += L; const k = `${Math.round(mx / 3)},${Math.round(mz / 3)}`; if (!seen.has(k)) { seen.add(k); kmUnique += L; } }
    }
  }
}
const out = { tiles: files.length, roadWays: ways, vertices: verts, widthsM: widths, kmAllTiles: +kmAll.toFixed(0), kmInsideM25: +kmInside.toFixed(0), kmInsideM25DedupedAcrossTileEdges: +kmUnique.toFixed(0), roadsJsonBytes: bytesRoads, allTilesJsonBytes: tileBytes };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/R/roads/surface-tiles-roads.json', JSON.stringify(out, null, 1));
