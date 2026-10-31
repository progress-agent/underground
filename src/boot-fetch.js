// boot-fetch.js — consumes the downloads index.html starts at HTML parse (sprint 21Oct26w, lane L).
//
// The inline script in index.html (window.__ugBoot) starts the big opening downloads before the
// bundle has even been fetched, so they overlap the module download and evaluation instead of
// queueing behind the work that needs them. A loader calls bootFetch(url, init) exactly where it
// used to call fetch(url, init): the first caller for a URL gets the boot request's Response (the
// body is consumed by that one caller, as it would be from its own fetch), every later caller, a
// request the boot script did not start, a different cache mode, or a context with no boot script
// (the bake's Node shim, a unit test) gets an ordinary fetch. Nothing else about the loaders changes.

// Same-origin URLs are keyed by path and query, however the caller spelled them.
const keyOf = (url) => {
  try {
    const u = new URL(String(url), globalThis.location?.href);
    if (globalThis.location && u.origin === globalThis.location.origin) return u.pathname + u.search;
  } catch (_) { /* fall through */ }
  return String(url);
};
const modeOf = (init) => (init && init.cache) || 'default';

/** @returns {Promise<Response>} */
export function bootFetch(url, init) {
  const boot = typeof window !== 'undefined' ? window.__ugBoot : null;
  if (boot && typeof boot.take === 'function') {
    const taken = boot.take(keyOf(url), modeOf(init));
    if (taken) return taken;
  }
  return fetch(url, init);
}

/** True while the boot script still holds an unconsumed request for this URL (tests and DEV tooling). */
export function bootHas(url) {
  const boot = typeof window !== 'undefined' ? window.__ugBoot : null;
  return !!(boot && typeof boot.has === 'function' && boot.has(keyOf(url)));
}
