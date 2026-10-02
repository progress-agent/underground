// The Weaver's last 520 m to Cheshunt (sprint 02Oct26f, D-048 item 7, lane T).
//
// public/data/overground.json is the Prog 11Jul26s delivery, written by Python
// (build-overground-data.py) and kept as it came. Its Weaver branch to Cheshunt
// ends at (-0.0251876, 51.6982609), 520 m short of the platforms (the worst of
// the rail endpoints that miss their stations); OSM's Weaver route (relation
// 9105027, Liverpool Street to Cheshunt) runs on to 51.70287, -0.02392, 3 m
// from the station point.
//
// This script appends that cached OSM stretch to the end of that branch, so the
// Weaver is drawn to Cheshunt like every other line to its terminus. A repo
// script, not a copy of the vault's builder (which is never edited in place):
//   * input: the trail of scripts/.cache/termini-osm-overpass.json (see
//     scripts/termini-osm.mjs) within 12 m of the branch's last point, from the
//     projection of that point onward to the trail's end in the box;
//   * classes are run-length encoded into `segments` (the last run is extended
//     when the class is the same); the appended points are listed in
//     `extended: [{p0, p1, from: 'termini-osm'}]` (the schema tube-surface.json
//     uses for points appended to a corridor);
//   * idempotent: it first strips any points an earlier run appended (the
//     points listed in `extended` with that label, and their segments), so
//     running it twice gives the same file;
//   * appending at the END leaves every index valid: tube-surface.json's
//     overgroundShared bands index this branch's points from the start;
//   * the file is written in Python json.dumps style (", " and ": ", ASCII
//     escapes) and ONLY if the serialiser here reproduces the input file byte for
//     byte; every other line and branch must deep-equal the input.
//
// Usage: node scripts/extend-overground-termini.mjs [--in <file>] [--out <file>]
//   (both default to public/data/overground.json). Run it BEFORE
//   scripts/prepare-tube-surface.mjs, which reads the Weaver as an owner corridor.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadTerminiCache, terminiTrails, weaverExtension, TERMINI_LABEL } from './termini-osm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'public/data/overground.json');

/** Python's json.dumps defaults (ensure_ascii, separators ', ' and ': '), for the types this file holds. */
export function pyDumps(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') {
    let s = '"';
    for (const ch of v) {
      const c = ch.codePointAt(0);
      if (ch === '"') s += '\\"'; else if (ch === '\\') s += '\\\\';
      else if (ch === '\n') s += '\\n'; else if (ch === '\r') s += '\\r'; else if (ch === '\t') s += '\\t';
      else if (ch === '\b') s += '\\b'; else if (ch === '\f') s += '\\f';
      else if (c < 0x20 || c > 0x7e) {
        if (c > 0xffff) { const o = c - 0x10000; s += '\\u' + (0xd800 + (o >> 10)).toString(16).padStart(4, '0') + '\\u' + (0xdc00 + (o & 0x3ff)).toString(16).padStart(4, '0'); }
        else s += '\\u' + c.toString(16).padStart(4, '0');
      } else s += ch;
    }
    return s + '"';
  }
  if (Array.isArray(v)) return '[' + v.map(pyDumps).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, x]) => pyDumps(k) + ': ' + pyDumps(x)).join(', ') + '}';
}

/**
 * Remove the points an earlier run appended, with their segments, and the
 * `extended` record. The source's segment ranges are [i0, i1) over POINTS (the
 * last run ends at the point count, as overground.js branchClasses reads it).
 */
export function stripExtension(branch) {
  const ext = (branch.extended || []).filter(e => e.from === TERMINI_LABEL);
  if (!ext.length) return branch;
  const first = Math.min(...ext.map(e => e.p0));
  branch.points = branch.points.slice(0, first);
  branch.segments = branch.segments.map(s => ({ ...s, i1: Math.min(s.i1, first) })).filter(s => s.i0 < s.i1);
  const rest = branch.extended.filter(e => e.from !== TERMINI_LABEL);
  if (rest.length) branch.extended = rest; else delete branch.extended;
  return branch;
}

/** Which Weaver branch ends nearest Cheshunt (by the last point). */
function cheshuntBranch(weaver, cheshunt) {
  let best = null;
  weaver.branches.forEach((b, i) => {
    const p = b.points.at(-1), d = Math.hypot((p[0] - cheshunt.lon) * 69.4, (p[1] - cheshunt.lat) * 111.2);
    if (!best || d < best.d) best = { i, d };
  });
  return best;
}

/**
 * The data with the Weaver's Cheshunt branch run on to the end of the OSM
 * trail. Pure: returns a new object and a report; the input is not modified.
 */
export function extendWeaver(data, osmAnswer) {
  const out = JSON.parse(JSON.stringify(data));
  const weaver = out.lines.find(l => l.id === 'weaver');
  if (!weaver) throw new Error('no weaver line in the data');
  const cheshunt = weaver.stations.find(s => /^Cheshunt\b/.test(s.name));
  if (!cheshunt) throw new Error('no Cheshunt station on the Weaver');
  const { i: bi } = cheshuntBranch(weaver, cheshunt);
  const branch = stripExtension(weaver.branches[bi]);
  const before = branch.points.length;
  const ext = weaverExtension(branch.points, terminiTrails(osmAnswer, 'weaver-cheshunt', 'weaver'));
  if (!ext) throw new Error('no OSM Weaver trail within 12 m of the end of the Cheshunt branch');
  branch.points.push(...ext.points.map(([lon, lat]) => [+lon.toFixed(7), +lat.toFixed(7)]));
  // Classes per point (the class of the segment leaving it; the last point takes the one before), run-length
  // encoded onto the existing last run when the class is the same.
  const segs = branch.segments, m = ext.points.length;
  for (let k = 0; k < m; k++) {
    const i = before + k, c = ext.cls[k + 1] ?? ext.cls[k], last = segs.at(-1);
    if (last && last.class === c && last.i1 === i) last.i1 = i + 1; else segs.push({ i0: i, i1: i + 1, class: c });
  }
  branch.extended = [...(branch.extended || []), { p0: before, p1: branch.points.length - 1, from: TERMINI_LABEL }];
  const end = branch.points.at(-1);
  const gapM = Math.hypot((end[0] - cheshunt.lon) * 69.4 * 1000, (end[1] - cheshunt.lat) * 111.2 * 1000);
  return { data: out, branch: bi, appended: ext.points.length, lengthM: Math.round(ext.lengthM), endFromStationM: Math.round(gapM) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const inFile = arg('--in', DEFAULT_FILE), outFile = arg('--out', DEFAULT_FILE);
  const text = await readFile(inFile, 'utf8');
  const input = JSON.parse(text);
  // The writer must reproduce the delivery byte for byte, or it must not write.
  if (pyDumps(input) !== text) throw new Error(`${inFile}: the serialiser does not reproduce the file byte for byte (${pyDumps(input).length} vs ${text.length} chars); refusing to write`);
  const osm = await loadTerminiCache();
  const r = extendWeaver(input, osm);
  // Every other line and branch must be exactly the input's.
  const was = JSON.parse(text);
  for (const l of r.data.lines) {
    const w = was.lines.find(x => x.id === l.id);
    if (l.id !== 'weaver') { if (!isDeepStrictEqual(l, w)) throw new Error(`${l.id} changed`); continue; }
    l.branches.forEach((b, i) => { if (i !== r.branch && !isDeepStrictEqual(b, w.branches[i])) throw new Error(`weaver branch ${i} changed`); });
  }
  const outText = pyDumps(r.data);
  await writeFile(outFile, outText);
  console.log(`weaver branch ${r.branch}: ${r.appended} points appended (${r.lengthM} m of OSM track), ending ${r.endFromStationM} m from the Cheshunt station point; wrote ${outFile}`);
}
