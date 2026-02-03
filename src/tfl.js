// Minimal TfL fetch helpers (public endpoints, no auth)
//
// Robustness strategy:
// 1) Try live fetch
// 2) Fall back to localStorage cache (TTL)
// 3) Fall back to bundled on-disk cache in /public/data/tfl (so the demo works offline)

const CACHE_PREFIX = 'ug:tfl:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function cacheKey(url) {
  return `${CACHE_PREFIX}${url}`;
}

function cacheGet(url, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(cacheKey(url));
  const parsed = raw ? safeJsonParse(raw) : null;
  if (!parsed || typeof parsed.t !== 'number') return null;
  if ((Date.now() - parsed.t) > ttlMs) return null;
  return parsed.v ?? null;
}

function cacheSet(url, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    // ignore quota / private mode
  }
}

function bundledCacheUrlForTfl(url) {
  // Only route-sequence is bundled for now.
  // https://api.tfl.gov.uk/Line/<id>/Route/Sequence/all  -> /data/tfl/route-sequence/<id>.json
  const m = url.match(/^https:\/\/api\.tfl\.gov\.uk\/Line\/([^/]+)\/Route\/Sequence\/all\/?$/i);
  if (!m) return null;
  const lineId = decodeURIComponent(m[1]);
  return `/data/tfl/route-sequence/${encodeURIComponent(lineId)}.json`;
}

async function fetchBundledJsonFor(url) {
  const localUrl = bundledCacheUrlForTfl(url);
  if (!localUrl) return null;
  const res = await fetch(localUrl, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchJson(url, {
  ttlMs = DEFAULT_TTL_MS,
  useCache = true,
  preferCache = false,
  allowBundledFallback = true,
} = {}) {
  const cached = useCache ? cacheGet(url, { ttlMs }) : null;
  if (preferCache && cached) return cached;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`TfL HTTP ${res.status} for ${url}: ${text.slice(0, 160)}`);
    }
    const data = await res.json();
    if (useCache) cacheSet(url, data);
    return data;
  } catch (err) {
    // Offline/blocked/rate-limited: fall back to cached if we have it.
    if (cached) return cached;

    // Final fallback: try bundled JSON shipped with the app.
    if (allowBundledFallback) {
      const bundled = await fetchBundledJsonFor(url).catch(() => null);
      if (bundled) return bundled;
    }

    throw err;
  }
}

export async function fetchTubeLines(opts) {
  return fetchJson('https://api.tfl.gov.uk/Line/Mode/tube', opts);
}

export async function fetchBundledRouteSequenceIndex() {
  // Returns bundled cache index if present, else null.
  const res = await fetch('/data/tfl/route-sequence/index.json', { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export async function fetchRouteSequence(lineId, opts) {
  return fetchJson(`https://api.tfl.gov.uk/Line/${encodeURIComponent(lineId)}/Route/Sequence/all`, opts);
}
