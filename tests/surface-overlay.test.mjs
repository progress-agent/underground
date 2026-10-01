// Sprint 30Sep26w Lane M, fix round 1: writes to public/data/surface never
// reach the main checkout's shared store through a symlinked directory.
//
// The adversarial verifier reproduced the hazard: in a worktree whose
// public/data/surface is a symlink to the main store (every other lane's
// layout), the first merge script and overlay copier checked only whether the
// FILE was a link, so they rewrote the store's tiles, manifest and baked
// payload. These tests rebuild that layout in a temp directory (a fake store,
// never the real one) and prove each write path now refuses or stays local.
//
// Sprint 01Oct26h Lane M (D-043): the overlay grows to seven files (the two
// North/East Acton and Harlesden/Willesden Junction tiles), and the two bakes,
// which wrote baked/ with a plain writeFile, get the same guard
// (assertBakeOutput): a bare `npm run bake` in a linked worktree refuses
// before any work, and in the main checkout it needs --promote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, mkdir, writeFile, readFile, symlink, lstat, readdir, link, rm, realpath, stat,
} from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalDir, writeLocal, overlayProblems, prepareOverlay, applyOverlay, OverlayError, LANE_M_FILES, SURFACE_REL,
  findMainRoot, assertBakeOutput,
} from '../scripts/surface-overlay.mjs';
import { main as mergeMain } from '../scripts/merge-microsoft-footprints.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Every file under `dir` (links followed), path -> sha256. */
async function hashTree(dir) {
  const out = {};
  for (const name of (await readdir(dir)).sort()) {
    const p = path.join(dir, name), st = await stat(p);
    if (st.isDirectory()) for (const [k, v] of Object.entries(await hashTree(p))) out[`${name}/${k}`] = v;
    else out[name] = sha(await readFile(p));
  }
  return out;
}

/**
 * A fake main checkout with a store, a worktree whose public/data/surface is
 * a symlink to it (the other lanes' layout), and a lane checkout holding a
 * real overlay of Lane M's seven files with different bytes.
 */
async function scene() {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ug-overlay-')));
  const main = path.join(base, 'main'), wt = path.join(base, 'wt'), lane = path.join(base, 'lane');
  const store = path.join(main, SURFACE_REL);
  await mkdir(path.join(store, 'tiles'), { recursive: true });
  await mkdir(path.join(store, 'baked'), { recursive: true });
  for (const f of ['tile_10_13.json', 'tile_10_14.json', 'tile_11_13.json', 'tile_11_14.json', 'tile_00_00.json', 'manifest.json'])
    await writeFile(path.join(store, 'tiles', f), `store ${f}\n`);
  for (const f of ['buildings.bin', 'meta.json', 'ground.bin', 'ground-meta.json', 'landmark-footprints.json'])
    await writeFile(path.join(store, 'baked', f), `store ${f}\n`);
  await writeFile(path.join(store, 'hyde-park.json'), 'store hyde\n');
  await mkdir(path.join(wt, 'public/data'), { recursive: true });
  await mkdir(path.join(wt, 'scripts'), { recursive: true });
  await symlink(store, path.join(wt, SURFACE_REL));
  for (const rel of LANE_M_FILES) {
    await mkdir(path.dirname(path.join(lane, SURFACE_REL, rel)), { recursive: true });
    await writeFile(path.join(lane, SURFACE_REL, rel), `lane ${rel}\n`);
  }
  const before = await hashTree(store);
  return { base, main, wt, lane, store, before, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('guard: a symlinked parent directory is refused (the verifier\'s case), and the store is untouched', async () => {
  const s = await scene();
  try {
    const tiles = path.join(s.wt, SURFACE_REL, 'tiles');
    // The old check passes here: the file itself is not a link.
    assert.equal((await lstat(path.join(tiles, 'tile_10_13.json'))).isSymbolicLink(), false);
    await assert.rejects(assertLocalDir(tiles, { root: s.wt, mainRoot: s.main }), OverlayError);
    await assert.rejects(assertLocalDir(tiles, { root: s.wt, mainRoot: null }), /outside this checkout/, 'containment alone catches it, without git');
    await assert.rejects(writeLocal(path.join(tiles, 'tile_10_13.json'), 'x', { root: s.wt, mainRoot: s.main }), OverlayError);
    const problems = await overlayProblems({ root: s.wt, mainRoot: s.main });
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('guard: the main checkout\'s own store needs --promote', async () => {
  const s = await scene();
  try {
    const tiles = path.join(s.store, 'tiles');
    await assert.rejects(assertLocalDir(tiles, { root: s.main, mainRoot: s.main }), /--promote/);
    assert.equal(await assertLocalDir(tiles, { root: s.main, mainRoot: s.main, promote: true }), tiles);
    // --promote does not open the store to a worktree: containment still refuses.
    await assert.rejects(assertLocalDir(path.join(s.wt, SURFACE_REL, 'tiles'), { root: s.wt, mainRoot: s.main, promote: true }), /outside this checkout/);
    await assert.rejects(applyOverlay({ from: s.lane, to: s.main, mainRoot: s.main }), /main checkout/);
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('merge script refuses before any download or write in a linked worktree; the chained bake never runs', async () => {
  const s = await scene();
  try {
    await assert.rejects(mergeMain(['--root', s.wt], { mainRoot: s.main }), (e) => e instanceof OverlayError && /surface-overlay\.mjs prepare/.test(e.message));
    // The test file's old remediation line, exactly as documented, from the CLI (no git, containment only).
    const r = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${path.join(ROOT, 'scripts/merge-microsoft-footprints.mjs')}" --root "${s.wt}" && echo BAKE-RAN`], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.doesNotMatch(r.stdout, /BAKE-RAN/);
    assert.match(r.stderr, /outside this checkout/);
    await assert.rejects(lstat(path.join(s.wt, 'scripts/.cache')), { code: 'ENOENT' }, 'refused before the download cache was touched');
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('prepare: a linked surface becomes a local overlay without writing the store; idempotent', async () => {
  const s = await scene();
  try {
    const logs = [];
    const { changed } = await prepareOverlay({ root: s.wt, mainRoot: s.main, log: (m) => logs.push(m) });
    assert.equal(changed, 3, logs.join('\n')); // surface split, tiles split, baked copied
    const surf = path.join(s.wt, SURFACE_REL);
    assert.ok((await lstat(surf)).isDirectory() && !(await lstat(surf)).isSymbolicLink());
    assert.ok((await lstat(path.join(surf, 'hyde-park.json'))).isSymbolicLink(), 'other children stay links');
    assert.ok((await lstat(path.join(surf, 'tiles'))).isDirectory());
    for (const f of await readdir(path.join(surf, 'tiles')))
      assert.ok((await lstat(path.join(surf, 'tiles', f))).isSymbolicLink(), `tiles/${f} is a per-file link`);
    for (const f of await readdir(path.join(surf, 'baked'))) {
      const st = await lstat(path.join(surf, 'baked', f));
      assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `baked/${f} is a real copy`);
    }
    assert.deepEqual(await overlayProblems({ root: s.wt, mainRoot: s.main }), []);
    assert.deepEqual((await prepareOverlay({ root: s.wt, mainRoot: s.main })).changed, 0, 'second run changes nothing');
    // A write now lands in the worktree only.
    await writeLocal(path.join(surf, 'tiles/tile_10_13.json'), 'merged\n', { root: s.wt, mainRoot: s.main });
    assert.equal(await readFile(path.join(surf, 'tiles/tile_10_13.json'), 'utf8'), 'merged\n');
    assert.ok(!(await lstat(path.join(surf, 'tiles/tile_10_13.json'))).isSymbolicLink());
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('prepare: baked leaf links and hard links (which the bake would write through) are flagged and materialised', async () => {
  const s = await scene();
  try {
    await prepareOverlay({ root: s.wt, mainRoot: s.main });
    const baked = path.join(s.wt, SURFACE_REL, 'baked');
    await rm(path.join(baked, 'buildings.bin'));
    await symlink(path.join(s.store, 'baked/buildings.bin'), path.join(baked, 'buildings.bin'));
    await rm(path.join(baked, 'meta.json'));
    await link(path.join(s.store, 'baked/meta.json'), path.join(baked, 'meta.json'));
    const problems = await overlayProblems({ root: s.wt, mainRoot: s.main });
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.match(problems.join('\n'), /buildings\.bin is a symlink/);
    assert.match(problems.join('\n'), /meta\.json is a hard link/);
    await assert.rejects(mergeMain(['--root', s.wt], { mainRoot: s.main }), OverlayError);
    assert.equal((await prepareOverlay({ root: s.wt, mainRoot: s.main })).changed, 2);
    assert.deepEqual(await overlayProblems({ root: s.wt, mainRoot: s.main }), []);
    assert.equal((await lstat(path.join(s.store, 'baked/meta.json'))).nlink, 1, 'the store file is its own inode again');
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('apply: into a linked worktree (the integrator\'s case) copies the overlay and leaves the store byte-identical', async () => {
  const s = await scene();
  try {
    const record = await applyOverlay({ from: s.lane, to: s.wt, mainRoot: s.main, backupDir: path.join(s.base, 'bk') });
    // Four tiles and the manifest were links into the store; baked/ is prepare's real copy.
    assert.deepEqual(record.map((r) => r.was), ['symlink', 'symlink', 'symlink', 'symlink', 'symlink', 'file', 'file']);
    for (const rel of LANE_M_FILES) {
      const d = path.join(s.wt, SURFACE_REL, rel);
      assert.equal(await readFile(d, 'utf8'), `lane ${rel}\n`);
      assert.ok(!(await lstat(d)).isSymbolicLink());
    }
    assert.ok((await lstat(path.join(s.wt, SURFACE_REL, 'tiles/tile_00_00.json'))).isSymbolicLink(), 'untouched tiles stay links');
    assert.equal(await readFile(path.join(s.wt, SURFACE_REL, 'baked/ground.bin'), 'utf8'), 'store ground.bin\n');
    assert.equal(await readFile(path.join(s.base, 'bk/baked/buildings.bin'), 'utf8'), 'store buildings.bin\n', 'backup of the replaced copy');
    assert.deepEqual(await hashTree(s.store), s.before);
    // A hard-linked leaf into the store is replaced, not written through.
    const d = path.join(s.wt, SURFACE_REL, 'tiles/tile_10_13.json');
    await rm(d);
    await link(path.join(s.store, 'tiles/tile_10_13.json'), d);
    await applyOverlay({ from: s.lane, to: s.wt, mainRoot: s.main, backupDir: path.join(s.base, 'bk2') });
    assert.equal(await readFile(d, 'utf8'), 'lane tiles/tile_10_13.json\n');
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('apply: a source that is not a real overlay file is refused', async () => {
  const s = await scene();
  try {
    await rm(path.join(s.lane, SURFACE_REL, 'tiles/tile_10_14.json'));
    await symlink(path.join(s.store, 'tiles/tile_10_14.json'), path.join(s.lane, SURFACE_REL, 'tiles/tile_10_14.json'));
    await assert.rejects(applyOverlay({ from: s.lane, to: s.wt, mainRoot: s.main }), /not a real file/);
    await assert.rejects(applyOverlay({ from: s.wt, to: s.wt, mainRoot: s.main }), /same checkout/);
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('this checkout: the main checkout is found through git, and the lane overlay is local', async () => {
  const main = findMainRoot(ROOT);
  assert.ok(main, 'inside a git checkout');
  const top = execFileSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  if ((await realpath(main)) === (await realpath(top))) {
    // The main checkout itself (after promotion): writes need --promote.
    assert.ok((await overlayProblems({ root: ROOT })).every((p) => /--promote/.test(p)));
  } else {
    // A worktree: the Microsoft overlay must be this checkout's own files, or
    // the data tests in microsoft-footprints.test.mjs read the store instead.
    assert.deepEqual(await overlayProblems({ root: ROOT }), [], 'run node scripts/surface-overlay.mjs prepare');
    for (const rel of LANE_M_FILES) {
      const st = await lstat(path.join(ROOT, SURFACE_REL, rel));
      assert.ok(st.isFile() && !st.isSymbolicLink(), `${rel} is a real file in this checkout`);
    }
  }
});

// ── The bakes (sprint 01Oct26h) ─────────────────────────────────────────────

const BAKES = { surface: { script: 'bake-surface.mjs', files: ['buildings.bin', 'landmark-footprints.json', 'meta.json'] },
                ground: { script: 'bake-ground.mjs', files: ['ground.bin', 'ground-meta.json'] } };

test('bake guard: refuses a linked worktree\'s baked/, the main store without --promote, and leaf links; allows a local overlay', async () => {
  const s = await scene();
  try {
    const wtBaked = path.join(s.wt, SURFACE_REL, 'baked');
    for (const { files } of Object.values(BAKES)) {
      await assert.rejects(assertBakeOutput(wtBaked, files, { root: s.wt, mainRoot: s.main }), /outside this checkout/);
      await assert.rejects(assertBakeOutput(wtBaked, files, { root: s.wt, mainRoot: s.main, promote: true }), /outside this checkout/, '--promote never opens the store to a worktree');
      await assert.rejects(assertBakeOutput(wtBaked, files, { root: s.wt, mainRoot: null }), /outside this checkout/, 'containment alone, without git');
    }
    // An --out that does not exist yet is judged by the nearest part of it that does.
    await assert.rejects(assertBakeOutput(path.join(wtBaked, 'new/deeper'), ['x'], { root: s.wt, mainRoot: s.main }), /outside this checkout/);
    assert.equal(await assertBakeOutput(path.join(s.wt, 'scratch/baked'), ['x'], { root: s.wt, mainRoot: s.main }), s.wt);
    // The main checkout's store: only with --promote.
    const mainBaked = path.join(s.store, 'baked');
    await assert.rejects(assertBakeOutput(mainBaked, BAKES.surface.files, { root: s.main, mainRoot: s.main }), /--promote/);
    assert.equal(await assertBakeOutput(mainBaked, BAKES.surface.files, { root: s.main, mainRoot: s.main, promote: true }), mainBaked);
    // After prepare the worktree's baked/ is its own; a leaf link back into the store is refused.
    await prepareOverlay({ root: s.wt, mainRoot: s.main });
    assert.equal(await assertBakeOutput(wtBaked, BAKES.surface.files, { root: s.wt, mainRoot: s.main }), wtBaked);
    await rm(path.join(wtBaked, 'ground.bin'));
    await symlink(path.join(s.store, 'baked/ground.bin'), path.join(wtBaked, 'ground.bin'));
    await rm(path.join(wtBaked, 'meta.json'));
    await link(path.join(s.store, 'baked/meta.json'), path.join(wtBaked, 'meta.json'));
    await assert.rejects(assertBakeOutput(wtBaked, BAKES.ground.files, { root: s.wt, mainRoot: s.main }), /ground\.bin is a symlink/);
    await assert.rejects(assertBakeOutput(wtBaked, BAKES.surface.files, { root: s.wt, mainRoot: s.main }), /meta\.json is a hard link/);
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

/**
 * A runnable copy of this checkout's code (scripts/ and src/, node_modules
 * linked) at `dir`, whose public/data/surface is `surface` (a link or a real
 * directory). Module paths resolve to the copy, so the bakes' ROOT is `dir`.
 */
async function runnableCheckout(dir, surface) {
  const { cp } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'public/data'), { recursive: true });
  await cp(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true, filter: (p) => !p.includes(`${path.sep}.cache`) });
  await cp(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  await symlink(await realpath(path.join(ROOT, 'node_modules')), path.join(dir, 'node_modules'));
  if (surface.link) await symlink(surface.link, path.join(dir, SURFACE_REL));
}
const runBake = (dir, script, args = []) => spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args],
  { encoding: 'utf8', timeout: 60000 });

test('both bake scripts refuse, before any work, to write through a symlinked store; the store is untouched', async () => {
  const s = await scene();
  try {
    const wt = path.join(s.base, 'linked');
    await runnableCheckout(wt, { link: s.store });
    for (const { script } of Object.values(BAKES)) {
      for (const args of [[], ['--promote'], ['--out', 'public/data/surface/baked']]) {
        const r = runBake(wt, script, args);
        assert.equal(r.status, 1, `${script} ${args.join(' ')}: ${r.stderr}`);
        assert.match(r.stderr, /refusing to write in .*outside this checkout/);
        assert.match(r.stderr, /surface-overlay\.mjs prepare/, 'names the remedy');
        assert.doesNotMatch(r.stdout, /terrain \+ masks ready|ground: \d+|"rgbaSha256"/, 'refused before the bake started');
      }
    }
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});

test('in the main checkout both bakes need --promote; with it the guard lets the run through', async () => {
  const s = await scene();
  try {
    await runnableCheckout(s.main, {});
    execFileSync('git', ['init', '-q', s.main]);
    for (const { script } of Object.values(BAKES)) {
      const r = runBake(s.main, script);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /main checkout's public\/data\/surface.*pass --promote/s);
      // With --promote the guard passes; this fake checkout has no real terrain,
      // river or tile data, so the bake then stops on its first data read
      // (a missing file, or the fake manifest's text), writing nothing.
      const p = runBake(s.main, script, ['--promote']);
      assert.notEqual(p.status, 0);
      assert.doesNotMatch(p.stderr, /refusing/);
      assert.match(p.stderr, /ENOENT|is not valid JSON/);
    }
    assert.deepEqual(await hashTree(s.store), s.before);
  } finally { await s.cleanup(); }
});
