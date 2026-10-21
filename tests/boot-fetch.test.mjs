// bootFetch hands out the requests index.html started at parse (sprint 21Oct26w, lane L, approach D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function load() {
  // A fresh module instance per test: the module reads window.__ugBoot at call time.
  return import('../src/boot-fetch.js');
}

function makeBoot(entries) {
  const held = Object.create(null);
  for (const [url, cache, p] of entries) held[url] = { p, cache };
  return {
    has: (u) => !!held[u],
    take: (u, cache) => { const h = held[u]; if (!h || h.cache !== cache) return null; delete held[u]; return h.p; },
  };
}

test('without a boot script bootFetch is an ordinary fetch', async () => {
  const { bootFetch } = await load();
  delete globalThis.window;
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push([String(url), init]); return 'plain'; };
  try {
    assert.equal(await bootFetch('/data/x.json', { cache: 'no-store' }), 'plain');
    assert.deepEqual(seen, [['/data/x.json', { cache: 'no-store' }]]);
  } finally { globalThis.fetch = realFetch; }
});

test('the first caller gets the boot request, later callers fetch again', async () => {
  const { bootFetch, bootHas } = await load();
  const boot = Promise.resolve('from-boot');
  globalThis.window = { __ugBoot: makeBoot([['/data/m25.json', 'no-store', boot]]) };
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return 'again'; };
  try {
    assert.equal(bootHas('/data/m25.json'), true);
    assert.equal(await bootFetch('/data/m25.json', { cache: 'no-store' }), 'from-boot');
    assert.equal(bootHas('/data/m25.json'), false);
    assert.equal(await bootFetch('/data/m25.json', { cache: 'no-store' }), 'again');
    assert.equal(fetched, 1);
  } finally { globalThis.fetch = realFetch; delete globalThis.window; }
});

test('a different cache mode is not the boot request', async () => {
  const { bootFetch } = await load();
  globalThis.window = { __ugBoot: makeBoot([['/data/thames.json', 'no-store', Promise.resolve('boot')]]) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => 'own';
  try {
    assert.equal(await bootFetch('/data/thames.json'), 'own');
    assert.equal(await bootFetch('/data/thames.json', { cache: 'no-store' }), 'boot');
  } finally { globalThis.fetch = realFetch; delete globalThis.window; }
});

test('index.html starts exactly the downloads the loaders take, with the loaders\' cache modes', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const started = [...html.matchAll(/start\('([^']+)', '([^']+)'\)/g)].map(m => [m[1], m[2]]);
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  // Every started URL appears in a bootFetch call of the loader that owns it.
  const owners = {
    '/data/terrain/london_full_height.json': src('terrain.js'),
    '/data/terrain/london_full_height_u16.png': src('terrain.js'),
    '/data/terrain/stratford-dtm.json': src('terrain.js'),
    '/data/terrain/airport-dtm.json': src('terrain.js'),
    '/data/terrain/southern-dtm.json': src('terrain.js'),
    '/data/thames.json': src('thames.js'),
    '/data/m25.json': src('m25.js'),
  };
  for (const [url, mode] of started) {
    assert.ok(owners[url], `${url} has no owner in this test`);
    const text = owners[url];
    const name = url.split('/').pop();
    assert.ok(text.includes(name) || /london_full_height|terrain/.test(name), `${url}`);
    assert.ok(text.includes('bootFetch'), `${url} owner does not call bootFetch`);
    if (mode === 'no-store') assert.ok(/cache: 'no-store'/.test(text), `${url} loader should ask no-store`);
  }
  assert.equal(started.length, Object.keys(owners).length);
});
