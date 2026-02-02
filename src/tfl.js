// Minimal TfL fetch helpers (public endpoints, no auth)
//
// MVP improvement: cache responses in localStorage with TTL + offline fallback.
// TfL endpoints can occasionally rate-limit or error; caching makes the demo more robust.

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

export async function fetchJson(url, {
  ttlMs = DEFAULT_TTL_MS,
  useCache = true,
  preferCache = false,
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
    throw err;
  }
}

export async function fetchTubeLines(opts) {
  return fetchJson('https://api.tfl.gov.uk/Line/Mode/tube', opts);
}

export async function fetchRouteSequence(lineId, opts) {
  return fetchJson(`https://api.tfl.gov.uk/Line/${encodeURIComponent(lineId)}/Route/Sequence/all`, opts);
}
