// Download TfL Route Sequence JSON + tube line list into public/data/tfl so the demo can run offline
// Usage:
//   node scripts/cache-tfl.mjs            # auto-discovers tube lines from TfL
//   node scripts/cache-tfl.mjs victoria   # only cache specific line ids
//
//   node scripts/cache-tfl.mjs --overground   # the six Overground lines only (s02:O)
//
// Writes:
//   public/data/tfl/route-sequence/*.json
//   public/data/tfl/route-sequence/index.json
//   public/data/tfl/lines/mode-tube.json
// With --overground it writes ONLY public/data/tfl/route-sequence-overground/*.json and its index.json.
// Never into route-sequence/: main.js builds a Tube line for every key of that index (s02:O).

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_ROUTE_DIR = path.resolve('public/data/tfl/route-sequence');
const OUT_LINES_DIR = path.resolve('public/data/tfl/lines');
// ── s02:O ── the Overground's route sequences live apart from the Tube's
const OUT_OVERGROUND_DIR = path.resolve('public/data/tfl/route-sequence-overground');
export const OVERGROUND_LINE_IDS = ['liberty', 'lioness', 'mildmay', 'suffragette', 'weaver', 'windrush'];
// ── /s02:O ──

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function normalizeLineId(id) {
  return String(id || '').trim().toLowerCase().replace(/\s+/g, '-');
}

async function fetchTubeLines() {
  return fetchJson('https://api.tfl.gov.uk/Line/Mode/tube');
}

async function discoverTubeLineIds() {
  const lines = await fetchTubeLines();
  const ids = (Array.isArray(lines) ? lines : [])
    .map(l => normalizeLineId(l?.id))
    .filter(Boolean);
  // keep stable output order
  return Array.from(new Set(ids)).sort();
}

// ── s02:O ──
async function cacheOverground() {
  await ensureDir(OUT_OVERGROUND_DIR);
  const index = { kind: 'tfl-route-sequence-cache-overground', generatedAt: new Date().toISOString(), lines: {} };
  for (const id of OVERGROUND_LINE_IDS) {
    const url = `https://api.tfl.gov.uk/Line/${encodeURIComponent(id)}/Route/Sequence/all`;
    process.stdout.write(`Fetching ${id}... `);
    const data = await fetchJson(url);
    const file = `${id}.json`;
    await fs.writeFile(path.join(OUT_OVERGROUND_DIR, file), JSON.stringify(data));
    index.lines[id] = { file, url };
    console.log('ok');
  }
  await fs.writeFile(path.join(OUT_OVERGROUND_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${OVERGROUND_LINE_IDS.length} Overground route-sequence files to ${OUT_OVERGROUND_DIR}`);
}
// ── /s02:O ──

async function main() {
  if (process.argv.slice(2).includes('--overground')) { await cacheOverground(); return; }
  await ensureDir(OUT_ROUTE_DIR);
  await ensureDir(OUT_LINES_DIR);

  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage:
  node scripts/cache-tfl.mjs            # auto-discovers tube lines from TfL
  node scripts/cache-tfl.mjs victoria   # only cache specific line ids

Writes JSON into:
  public/data/tfl/route-sequence/
  public/data/tfl/lines/
`);
    process.exit(0);
  }

  // Treat only non-flag args as line ids.
  const requested = argv
    .filter(a => !String(a).startsWith('-'))
    .map(normalizeLineId)
    .filter(Boolean);

  // Always cache the tube line list as a bundled fallback.
  const tubeLines = await fetchTubeLines();
  await fs.writeFile(path.join(OUT_LINES_DIR, 'mode-tube.json'), JSON.stringify(tubeLines, null, 2) + '\n');

  const lineIds = requested.length ? requested : await discoverTubeLineIds();

  const index = {
    kind: 'tfl-route-sequence-cache',
    generatedAt: new Date().toISOString(),
    lines: {},
  };

  for (const id of lineIds) {
    const url = `https://api.tfl.gov.uk/Line/${encodeURIComponent(id)}/Route/Sequence/all`;
    process.stdout.write(`Fetching ${id}... `);
    const data = await fetchJson(url);
    const file = `${id}.json`;
    await fs.writeFile(path.join(OUT_ROUTE_DIR, file), JSON.stringify(data));
    index.lines[id] = { file, url };
    console.log('ok');
  }

  await fs.writeFile(path.join(OUT_ROUTE_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${lineIds.length} route-sequence files to ${OUT_ROUTE_DIR}`);
  console.log(`Wrote tube line list to ${path.join(OUT_LINES_DIR, 'mode-tube.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
