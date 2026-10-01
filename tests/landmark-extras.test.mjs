// Sprint 01Oct26h (D-043 housekeeping): the landmark assembler's finish()
// called group.add(...extras) for every building, and for a building with no
// separate meshes that is group.add() with no argument, which Three.js answers
// with "THREE.Object3D.add: object not an instance of THREE.Object3D." and
// otherwise ignores. That was 124 of the 129 console errors on every load.
// finish() now adds the extras only when there are some.
//
// The proof here builds every landmark group twice from src/landmark-models.js
// as it stands, once with the guard and once with the guard removed (the
// 387dff0 behaviour), and requires: the unguarded build logs the errors, the
// guarded build logs none, and the two groups are otherwise identical, object
// by object (names, transforms, user data, materials and geometry bytes).
//
// Data: the landmark footprint companion, public/data/surface/baked/
// landmark-footprints.json (gitignored, as for the other data tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installNodeEnv } from '../scripts/bake-node-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The bake's Node shim: Westminster's clock faces draw to a (stub) canvas.
installNodeEnv();
const SRC = path.join(ROOT, 'src/landmark-models.js');
const GUARDED = 'if (extras.length) group.add(...extras);';
const UNGUARDED = 'group.add(...extras);';

// Vite imports JSON without an import attribute; Node needs one. Serve JSON
// modules as ES modules for this process only (each test file has its own).
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${String(nextLoad(url, { ...context, format: 'json', importAttributes: { type: 'json' } }).source)};` };
    }
    return nextLoad(url, context);
  },
});

/** src/landmark-models.js with its imports made absolute, so a copy elsewhere loads the same modules. */
function absolutise(text) {
  const srcUrl = pathToFileURL(SRC).href;
  return text.replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"]+)\2/g, (m, kw, q, spec) => {
    const url = spec.startsWith('.') ? new URL(spec, srcUrl).href : import.meta.resolve(spec);
    return `${kw}${q}${url}${q}`;
  });
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** userData as plain data: objects by name, functions by kind (never their own toJSON). */
const plain = (v) => (typeof v === 'function' ? 'fn' : v?.isObject3D ? `obj:${v.type}:${v.name}`
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

/** Everything about a group that rendering or picking could see, in traversal order. */
function fingerprint(group) {
  const out = [];
  group.traverse((o) => {
    const row = { type: o.type, name: o.name, children: o.children.length,
      p: o.position.toArray().map(r6), r: o.rotation.toArray().slice(0, 3).map(r6), s: o.scale.toArray().map(r6),
      user: JSON.stringify(plain(o.userData)) };
    if (o.isMesh) {
      const m = o.material;
      row.material = [m.type, m.color?.getHexString(), m.roughness, m.metalness, m.fog];
      const g = o.geometry;
      row.geometry = Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].count}:${sha(Buffer.from(g.attributes[k].array.buffer, g.attributes[k].array.byteOffset, g.attributes[k].array.byteLength))}`);
      row.index = g.index ? sha(Buffer.from(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength)) : null;
    }
    out.push(row);
  });
  return out;
}

test('landmark extras: no empty Object3D.add, and the landmark groups are otherwise unchanged', async () => {
  const text = await readFile(SRC, 'utf8');
  assert.equal(text.split(GUARDED).length, 2, `the guard "${GUARDED}" is in src/landmark-models.js exactly once`);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ug-landmark-extras-'));
  try {
    const guardedFile = path.join(dir, 'guarded.mjs'), unguardedFile = path.join(dir, 'unguarded.mjs');
    await writeFile(guardedFile, absolutise(text));
    await writeFile(unguardedFile, absolutise(text.replace(GUARDED, UNGUARDED)));
    const guarded = await import(pathToFileURL(guardedFile).href);
    const unguarded = await import(pathToFileURL(unguardedFile).href);
    let data;
    try {
      data = JSON.parse(await readFile(path.join(ROOT, 'public/data/surface/baked/landmark-footprints.json'), 'utf8'));
    } catch (e) {
      assert.fail(`public/data/surface/baked/landmark-footprints.json is needed (${e.code}); link or copy the surface data in`);
    }
    // A sloping ground, so every anchor's base differs.
    const getSurfaceY = ({ x, z }) => 12 + x * 1e-3 - z * 2e-3;
    const build = (mod) => {
      const errors = [];
      const original = console.error;
      console.error = (...a) => errors.push(a.map(String).join(' '));
      try { return { group: mod.createLandmarkModels(data, { getSurfaceY, VE: 5, heightScale: 1 }), errors }; }
      finally { console.error = original; }
    };
    const before = build(unguarded), after = build(guarded);
    const emptyAdds = (e) => e.filter((m) => m.includes('Object3D.add')).length;
    assert.ok(emptyAdds(before.errors) > 0, 'the unguarded build reproduces the Object3D.add errors (the test sees the bug)');
    assert.equal(emptyAdds(after.errors), 0, after.errors.slice(0, 3).join('\n'));
    assert.deepEqual(after.errors, [], 'no console errors of any kind from the guarded build');
    // Not vacuous: all eleven sites, hundreds of objects, the extras that do exist (London Eye capsules etc.) included.
    const fa = fingerprint(after.group), fb = fingerprint(before.group);
    assert.ok(fa.length > 200, `objects compared: ${fa.length}`);
    assert.equal(after.group.children.length, 11);
    assert.deepEqual(fa, fb, 'the guarded and unguarded landmark groups are identical object by object');
    console.log(`landmarks: ${fa.length} objects identical; Object3D.add errors ${emptyAdds(before.errors)} -> ${emptyAdds(after.errors)}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
