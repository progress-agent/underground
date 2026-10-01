// DLR deck heights measured from the Environment Agency LiDAR (sprint
// 30Sep26w, D-041 technical ruling; Lane R). Until now every DLR viaduct was
// one illustrative 8 m and every embankment 3 m (dlr-profile-data.json
// heightModel, surveyed:false). This measures the elevated and embankment
// track of that same graph and writes src/dlr-deck-heights.json (per OSM
// node), which src/dlr-profile.js reads, so initialisation, trains, station
// markers, shafts, hover and the surface railway all take the measured deck.
//
// Along every raised edge, every SAMPLE_M (BNG metres):
//   deck   = the median of the last-return DSM samples across the track
//            that stand at least 1 m above the ground, from the central
//            -3..+3 m when three or more do (platform canopies stand over
//            the outer samples), else from -6..+6 m (the OSM line can sit off
//            the deck's middle): parapets and gaps are outvoted; where all
//            are near the ground the track is at grade;
//   ground = median of the bare-earth DTM at the track and 20 m and 32 m
//            either side, then the median along the track within 20 m (the
//            DTM keeps an embankment as ground and may keep a solid viaduct,
//            so the lateral samples anchor it; a dock on one side is outvoted).
// Then, along the track graph (a railway deck is continuous and cannot climb
// faster than about 6%):
//   1. a deck more than 1.5 m below the median within 15 m is a gap the
//      pulse went through and takes that median;
//   2. OCCLUSION: a deck more than 1.5 m above the grade-limited lower
//      envelope of its neighbours (min over j of deck_j + 7% x distance) is
//      something standing over the track (the roofs at Canary Wharf, Heron
//      Quays and Tower Gateway, the upper deck of a flyover, a train);
//   3. an occluded stretch takes the deck interpolated between the measured
//      deck either side (the mean of the grade-limited lower and upper
//      envelopes of the unoccluded samples): source 'interpolated', not
//      surveyed, flagged;
//   4. height = deck - ground, clamped at 0 (a deck read below the ground is
//      track at or below grade, drawn at grade under D-024).
// Where the DSM has no data for a node's whole neighbourhood it keeps the
// illustrative class estimate (heightModel), source 'fallback', flagged.
//
// Run: node scripts/prepare-dlr-deck-heights.mjs [--out src/dlr-deck-heights.json]
// Raw rasters are cached under scripts/.cache/ea-lidar-dlr/ (additive).
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { fetchCoverage, sampleRaster, COVERAGES, ATTRIBUTION, coverageUrl } from './ea-lidar-wcs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

export const TILE_M = 500, MARGIN_M = 40, SAMPLE_M = 3;
export const DECK_OFFSETS_M = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
export const GROUND_OFFSETS_M = [0, -20, 20, -32, 32];
export const ON_STRUCTURE_M = 1;     // a DSM sample this far above the ground is on the structure
export const GAP_M = 1.5, GAP_WINDOW_M = 15, GROUND_WINDOW_M = 20, MIN_ON_STRUCTURE = 3;
export const MAX_GRADE = 0.07;       // DLR ruling gradient 6%, with tolerance
export const OCCLUDED_M = 1.0;
export const DECK_QUANTILE = 0.5;  // the median: lower quantiles pick up structures beside the deck

export const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quantile = (a, q) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

/**
 * Deck elevation from a cross-section of DSM values (DECK_OFFSETS_M), given
 * the ground. The CENTRAL samples (-3..+3 m) decide first: the median of
 * those standing on the structure when at least three do (platform canopies
 * stand beside the tracks, over the outer samples); at grade (their median)
 * when at least five are within ON_STRUCTURE_M of the ground, whatever stands
 * beside the track. Otherwise the median of all samples on the structure (the
 * OSM line can sit off the deck's middle), or unresolved (null).
 */
export function deckFromSection(section, ground) {
  const isOn = v => Number.isFinite(v) && v >= ground + ON_STRUCTURE_M;
  const centre = section.filter((v, k) => Math.abs(DECK_OFFSETS_M[k]) <= 3 && Number.isFinite(v));
  const centreOn = centre.filter(isOn);
  if (centreOn.length >= MIN_ON_STRUCTURE) return quantile(centreOn, DECK_QUANTILE);
  if (centre.length - centreOn.length >= 5) return median(centre.filter(v => !isOn(v)));
  const all = section.filter(isOn);
  if (all.length >= MIN_ON_STRUCTURE) return quantile(all, DECK_QUANTILE);
  return null;
}

/** Binary-heap Dijkstra: out[i] = min over sources j of cost[j] + w x dist(i, j). */
export function envelope(n, adj, cost, w) {
  const out = new Float64Array(n).fill(Infinity), heap = [];
  const push = (v, i) => { heap.push([v, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let i = 0; i < n; i++) if (Number.isFinite(cost[i])) { out[i] = cost[i]; push(cost[i], i); }
  while (heap.length) {
    const [v, i] = pop(); if (v > out[i]) continue;
    for (const [j, d] of adj[i]) { const c = v + w * d; if (c < out[j]) { out[j] = c; push(c, j); } }
  }
  return out;
}

/** Samples within `radius` along the graph (including i). */
export function neighbourhood(adj, i, radius) {
  const seen = new Map([[i, 0]]), queue = [i];
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q], d0 = seen.get(a);
    for (const [b, d] of adj[a]) { const dd = d0 + d; if (dd > radius || (seen.has(b) && seen.get(b) <= dd)) continue; if (!seen.has(b)) queue.push(b); seen.set(b, dd); }
  }
  return [...seen.keys()];
}

/** Dense sample graph over the raised edges; node samples are shared by their edges. */
export function denseGraph(data, xy) {
  const samples = [], adj = [], nodeSample = new Map();
  const add = (p, dir, kind, node = null) => { samples.push({ p, dir, kind, node }); adj.push([]); return samples.length - 1; };
  const link = (a, b) => { const d = Math.hypot(samples[a].p[0] - samples[b].p[0], samples[a].p[1] - samples[b].p[1]); adj[a].push([b, d]); adj[b].push([a, d]); };
  const raised = e => e.kind === 'elevated' || e.kind === 'embankment';
  for (const e of data.edges) {
    if (!raised(e)) continue;
    const a = xy[e.a], b = xy[e.b], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9, dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const at = (node, p) => {
      if (!nodeSample.has(node)) nodeSample.set(node, add(p, dir, e.kind, node));
      const s = samples[nodeSample.get(node)];
      if (e.kind === 'elevated') s.kind = 'elevated';
      return nodeSample.get(node);
    };
    const sa = at(e.a, a), sb = at(e.b, b), n = Math.max(1, Math.ceil(L / SAMPLE_M));
    let prev = sa;
    for (let k = 1; k < n; k++) { const t = k / n, s = add([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir, e.kind); link(prev, s); prev = s; }
    link(prev, sb);
  }
  return { samples, adj, nodeSample };
}

/** Steps 1-4 on measured samples (deck, ground set, or null). */
export function resolveProfile(samples, adj) {
  const n = samples.length;
  // Ground along the track.
  const ground = samples.map((s, i) => median(neighbourhood(adj, i, GROUND_WINDOW_M).map(j => samples[j].groundRaw)));
  // Deck from the section, then gaps.
  const raw = samples.map((s, i) => Number.isFinite(ground[i]) && s.section ? deckFromSection(s.section, ground[i]) : null);
  const deck = raw.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    const m = median(neighbourhood(adj, i, GAP_WINDOW_M).map(j => raw[j]));
    return m !== null && v < m - GAP_M ? m : v;
  });
  // Occlusion: above the grade-limited lower envelope of the OTHER samples.
  const cost = Float64Array.from(deck, v => Number.isFinite(v) ? v : Infinity);
  let lower = envelope(n, adj, cost, MAX_GRADE);
  let occluded = deck.map((v, i) => Number.isFinite(v) && v > lower[i] + OCCLUDED_M);
  // The envelope itself is lifted near a long roof; recompute it from the
  // unoccluded samples only and re-test once.
  const unocc = Float64Array.from(deck, (v, i) => Number.isFinite(v) && !occluded[i] ? v : Infinity);
  lower = envelope(n, adj, unocc, MAX_GRADE);
  occluded = deck.map((v, i) => Number.isFinite(v) && v > lower[i] + OCCLUDED_M);
  const sources = Float64Array.from(deck, (v, i) => Number.isFinite(v) && !occluded[i] ? v : Infinity);
  const low = envelope(n, adj, sources, MAX_GRADE);
  const high = envelope(n, adj, Float64Array.from(sources, v => Number.isFinite(v) ? -v : Infinity), MAX_GRADE).map(v => -v);
  return samples.map((s, i) => {
    if (!Number.isFinite(ground[i])) return { source: 'fallback', reason: 'no-data' };
    if (Number.isFinite(sources[i])) {
      const d = Math.min(sources[i], low[i]);
      return { source: 'lidar', deck: d, ground: ground[i], ...(raw[i] !== d ? { filtered: true, rawDeck: raw[i] } : {}) };
    }
    if (Number.isFinite(low[i]) && Number.isFinite(high[i])) {
      return { source: 'interpolated', reason: occluded[i] ? 'occluded' : 'no-data', deck: (low[i] + high[i]) / 2, ground: ground[i], rawDeck: raw[i] };
    }
    return { source: 'fallback', reason: 'no-data' };
  });
}

/**
 * s01:R (sprint 01Oct26h): a ROOF OVER A TERMINUS. The occlusion step bridges
 * a roof between the measured deck either side; at the end of a line there is
 * no deck beyond, and the roof is read as the deck. Tower Gateway: the DSM over
 * the last ~100 m reads the station canopy at 12.4 to 12.9 m above the ground,
 * while the deck it covers is about 9 m (8.6 m measured where the canopy
 * begins, OSM node 1536019913, on a ramp rising at about 3% from 6.8 m), so
 * the line, its trains and markers stood the canopy's height, 12.4 to 12.7 m,
 * over the last 80 m (sprint 30Sep26w report). The DSM
 * shows the deck through the canopy's openings, so under a listed canopy the
 * deck is a CANOPY-FREE reading: the CANOPY_QUANTILE lower percentile of the
 * on-structure DSM within CANOPY_CENTRE_M of the track's centre line over the
 * whole covered stretch (the platform is level); see CANOPY_QUANTILE for the
 * percentile. Source lidar (a measurement),
 * with `canopy` naming the record and rawDeckOD the roof reading it replaces.
 */
export const CANOPIES = [
  { name: 'Tower Gateway canopy', bufferNode: 1536019947, lengthM: 95,
    note: 'Station canopy over the platform to the buffers (OSM ways 700443383 and 700443384); the DSM reads the roof at 12.4 to 12.9 m; the deck is read through its openings.' },
];
// A DSM reading through an opening can stand on the deck or on whatever is
// above it (the roof's edge, platform furniture, a train), never below it, so
// the deck is the lowest reading; the 2nd percentile drops single-pixel noise.
// At Tower Gateway it gives 21.97 m OD, 9.0 m above the ground, continuing the
// measured ramp (21.3 m OD where the canopy begins, rising about 3%); the 10th
// percentile already mixes in the roof's edges (23.2 m OD).
export const CANOPY_CENTRE_M = 2, CANOPY_QUANTILE = 0.02;
export function applyCanopies(data, samples, adj, nodeSample, profile, canopies = CANOPIES) {
  const out = [];
  for (const c of canopies) {
    const node = data.nodes.findIndex(n => n.id === c.bufferNode), si = nodeSample.get(node);
    if (si === undefined) continue;
    const stretch = neighbourhood(adj, si, c.lengthM);
    const readings = [];
    for (const i of stretch) {
      const g = profile[i].ground, sec = samples[i].section; if (!Number.isFinite(g) || !sec) continue;
      sec.forEach((v, k) => { if (Math.abs(DECK_OFFSETS_M[k]) <= CANOPY_CENTRE_M && Number.isFinite(v) && v >= g + ON_STRUCTURE_M) readings.push(v); });
    }
    const deck = quantile(readings, CANOPY_QUANTILE);
    if (!Number.isFinite(deck)) continue;
    for (const i of stretch) {
      const r = profile[i]; if (!Number.isFinite(r.ground)) continue;
      const roof = Number.isFinite(r.rawDeck) ? r.rawDeck : r.deck;
      profile[i] = { source: 'lidar', deck, ground: r.ground, canopy: c.name, ...(Number.isFinite(roof) && roof !== deck ? { rawDeck: roof } : {}) };
    }
    const q = f => +quantile(readings, f).toFixed(2);
    out.push({ ...c, deckOD: +deck.toFixed(2), samples: stretch.length, readings: readings.length, quantilesOD: { q02: q(0.02), q05: q(0.05), q10: q(0.1), q25: q(0.25), q50: q(0.5) } });
  }
  return out;
}

export async function build({ data, cacheDir = path.join(ROOT, 'scripts/.cache/ea-lidar-dlr'), log = () => {}, debug = null, canopyList = CANOPIES }) {
  const xy = data.nodes.map(nd => proj4('EPSG:4326', 'EPSG:27700', [nd.lon, nd.lat]));
  const { samples, adj, nodeSample } = denseGraph(data, xy);
  const tiles = new Map();
  samples.forEach((s, i) => {
    const key = `${Math.floor(s.p[0] / TILE_M)},${Math.floor(s.p[1] / TILE_M)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(i);
  });
  const provenance = [];
  let done = 0;
  for (const [key, ids] of [...tiles].sort()) {
    const [tx, ty] = key.split(',').map(Number);
    const bounds = [tx * TILE_M - MARGIN_M, ty * TILE_M - MARGIN_M, (tx + 1) * TILE_M + MARGIN_M, (ty + 1) * TILE_M + MARGIN_M];
    const dsm = await fetchCoverage('dsm', bounds, cacheDir), dtm = await fetchCoverage('dtm', bounds, cacheDir);
    provenance.push({ bounds, dsmSha256: dsm.sha256, dtmSha256: dtm.sha256 });
    for (const i of ids) {
      const s = samples[i], perp = [-s.dir[1], s.dir[0]];
      s.section = DECK_OFFSETS_M.map(u => sampleRaster(dsm.raster, s.p[0] + perp[0] * u, s.p[1] + perp[1] * u));
      s.groundRaw = median(GROUND_OFFSETS_M.map(u => sampleRaster(dtm.raster, s.p[0] + perp[0] * u, s.p[1] + perp[1] * u)));
    }
    log(`tile ${++done}/${tiles.size} ${key}: ${ids.length} samples`);
  }
  const profile = resolveProfile(samples, adj);
  const canopies = applyCanopies(data, samples, adj, nodeSample, profile, canopyList); // s01:R
  if (debug) debug.push(...samples.map((s, i) => ({ e: +s.p[0].toFixed(1), n: +s.p[1].toFixed(1), node: s.node, section: s.section, ground: profile[i].ground, deck: profile[i].deck, raw: profile[i].rawDeck ?? profile[i].deck, source: profile[i].source, nb: adj[i].map(([j]) => j) })));
  const model = data.heightModel, nodes = {};
  for (const [node, si] of nodeSample) {
    const s = samples[si], r = profile[si], kind = s.kind;
    const fallback = kind === 'elevated' ? model.elevatedM : model.embankmentM;
    if (r.source === 'fallback') { nodes[data.nodes[node].id] = { kind, m: fallback, source: 'fallback', reason: r.reason }; continue; }
    const h = r.deck - r.ground;
    nodes[data.nodes[node].id] = {
      kind, m: +Math.max(0, h).toFixed(2), source: r.source,
      ...(r.reason ? { reason: r.reason } : {}), ...(h < 0 ? { atGrade: true } : {}),
      ...(r.filtered ? { filtered: true } : {}), ...(r.canopy ? { canopy: r.canopy } : {}),
      deckOD: +r.deck.toFixed(2), groundOD: +r.ground.toFixed(2), ...(Number.isFinite(r.rawDeck) && r.rawDeck !== r.deck ? { rawDeckOD: +r.rawDeck.toFixed(2) } : {}),
    };
  }
  const counts = {}; for (const r of profile) counts[r.source] = (counts[r.source] || 0) + 1;
  return {
    version: 1,
    description: 'DLR elevated and embankment deck heights above local ground (metres), keyed by OSM node id of src/dlr-profile-data.json. source lidar = measured; interpolated = under something standing over the track (a roof), taken between the measured deck either side, flagged; fallback = the illustrative class estimate (heightModel), flagged.',
    method: {
      sampling: `every ${SAMPLE_M} m along each elevated or embankment edge`,
      deck: `median of the last-return DSM across the track standing at least ${ON_STRUCTURE_M} m above the ground (at least ${MIN_ON_STRUCTURE}), central -3..3 m first, else ${DECK_OFFSETS_M[0]}..${DECK_OFFSETS_M.at(-1)} m; median across where all are near the ground`,
      ground: `median DTM at ${GROUND_OFFSETS_M.join(', ')} m across the track, then the median along ${GROUND_WINDOW_M} m`,
      gaps: `a deck ${GAP_M} m below the median within ${GAP_WINDOW_M} m takes that median`,
      occlusion: `a deck ${OCCLUDED_M} m above the lower envelope of its neighbours at grade ${MAX_GRADE} is occluded; occluded samples take the mean of the grade-limited lower and upper envelopes of the unoccluded deck`,
      height: 'deck minus ground, clamped at 0 (atGrade: read below the ground, drawn at grade, D-024)',
      fallback: `no data in reach: heightModel ${model.elevatedM} m elevated / ${model.embankmentM} m embankment`,
      canopies: `a roof over a terminus has no deck beyond to bridge from: under each listed canopy the deck is the ${CANOPY_QUANTILE * 100}th percentile of the on-structure DSM within ${CANOPY_CENTRE_M} m of the centre line over the covered stretch (read through its openings); nodes carry canopy and rawDeckOD (the roof)`,
    },
    canopies: canopies.map(c => ({ name: c.name, bufferNode: c.bufferNode, lengthM: c.lengthM, deckOD: c.deckOD, readings: c.readings, quantilesOD: c.quantilesOD, note: c.note })),
    samples: { total: samples.length, ...counts },
    sources: {
      dsm: { label: COVERAGES.dsm.label, coverageId: COVERAGES.dsm.id, endpoint: COVERAGES.dsm.endpoint, example: coverageUrl('dsm', provenance[0]?.bounds ?? [0, 0, 1, 1]) },
      dtm: { label: COVERAGES.dtm.label, coverageId: COVERAGES.dtm.id, endpoint: COVERAGES.dtm.endpoint },
      attribution: ATTRIBUTION,
      tiles: provenance,
    },
    nodes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const data = JSON.parse(await readFile(path.join(ROOT, 'src/dlr-profile-data.json'), 'utf8'));
  const debug = process.argv.includes('--debug') ? [] : null;
  const result = await build({ data, log: m => process.stderr.write(m + '\n'), debug });
  if (debug) await writeFile(arg('--debug'), JSON.stringify(debug));
  const outPath = arg('--out', path.join(ROOT, 'src/dlr-deck-heights.json'));
  await writeFile(outPath, JSON.stringify(result));
  const all = Object.values(result.nodes);
  for (const kind of ['elevated', 'embankment']) {
    const xs = all.filter(n => n.kind === kind), meas = xs.filter(n => n.source === 'lidar').map(n => n.m).sort((a, b) => a - b);
    const q = f => meas[Math.floor(f * (meas.length - 1))]?.toFixed(1);
    const by = s => xs.filter(n => n.source === s).length;
    console.log(`${kind}: ${xs.length} nodes: ${by('lidar')} measured (${xs.filter(n => n.filtered).length} filtered, ${xs.filter(n => n.atGrade).length} at grade), ${by('interpolated')} interpolated, ${by('fallback')} fallback; measured p10 ${q(.1)} p50 ${q(.5)} p90 ${q(.9)} max ${q(1)} m`);
  }
  console.log(`samples ${JSON.stringify(result.samples)}; wrote ${outPath}`);
}
