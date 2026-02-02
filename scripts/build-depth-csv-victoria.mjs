import fs from 'node:fs/promises';

const LINE_ID = 'victoria';

function uniqBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}

function normalizeDepthToM(str) {
  // Accept formats like "58.5 m", "58.5 metres", "58.5m (190 ft)", "Depth 58.5 metres".
  if (!str) return null;
  const m = String(str).match(/(?:depth[^\d]{0,20})?(\d+(?:\.\d+)?)\s*(?:m|metre|meter)\b/i);
  if (!m) return null;
  const val = Number(m[1]);
  // Guard: depths for tube stations are generally > ~5m; reject tiny values that are likely distances.
  if (!Number.isFinite(val) || val < 5) return null;
  return val;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'UnderGroundMVP/0.1 (depth scraper)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'UnderGroundMVP/0.1 (depth scraper)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function getVictoriaStations() {
  const url = `https://api.tfl.gov.uk/Line/${LINE_ID}/Route/Sequence/all`;
  const seq = await fetchJson(url);
  const all = [];
  for (const s of seq.stopPointSequences || []) {
    for (const sp of s.stopPoint || []) {
      all.push({
        naptan_id: sp.id,
        name: sp.name,
        lat: sp.lat,
        lon: sp.lon,
      });
    }
  }
  // Unique by naptan id
  return uniqBy(all, s => s.naptan_id).sort((a, b) => a.name.localeCompare(b.name));
}

async function getWikipediaDepthMeters(stationName) {
  // Wikipedia depth data is inconsistent. When it exists, it’s usually in the infobox.
  // We'll try a few likely page titles and scrape a "Depth" label.

  const base = stationName.replace(/\s+Underground Station$/, '').trim();
  const candidates = [
    base,
    `${base} tube station`,
    `${base} station`,
  ].map(t => t.replace(/\s+/g, '_'));

  for (const title of candidates) {
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    try {
      const html = await fetchText(pageUrl);

      // Look for common infobox depth label variants.
      const idx = html.search(/>\s*Depth\s*<\/th>|>\s*Depth\s*<\/td>/i);
      if (idx === -1) continue;

      const slice = html.slice(idx, idx + 2500);
      // Find first <td> after the depth header.
      const td = slice.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (!td) continue;

      const text = td[1]
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const depth = normalizeDepthToM(text);
      if (depth) return { depth, sourceUrl: pageUrl, method: 'infobox' };
    } catch {
      // ignore
    }
  }

  return null;
}

const stations = await getVictoriaStations();

const rows = [];
for (const st of stations) {
  const wiki = await getWikipediaDepthMeters(st.name);
  rows.push({
    naptan_id: st.naptan_id,
    name: st.name,
    depth_m: wiki?.depth ?? '',
    source_url: wiki?.sourceUrl ?? '',
    notes: wiki ? `wikipedia:${wiki.method}` : '',
  });
  process.stdout.write('.');
}
process.stdout.write('\n');

let out = '';
out += '# UnderGround station/platform depth anchors\n';
out += '# Auto-generated seed rows for Victoria line. Review + correct before trusting.\n';
out += '# Columns: naptan_id,name,depth_m,source_url,notes\n';
out += 'naptan_id,name,depth_m,source_url,notes\n';
for (const r of rows) {
  // CSV escaping minimal: quote names with commas
  const name = r.name.includes(',') ? `"${r.name.replaceAll('"', '""')}"` : r.name;
  out += `${r.naptan_id},${name},${r.depth_m},${r.source_url},${r.notes}\n`;
}

await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/station_depths_victoria_seed.csv', out, 'utf8');

console.log(`Wrote data/station_depths_victoria_seed.csv with ${rows.length} stations`);
