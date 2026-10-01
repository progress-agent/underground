#!/usr/bin/env node
/**
 * surface-overlay.mjs: keep writes to public/data/surface inside the checkout
 * that makes them.
 *
 * WHY. public/data/surface (the tile source and the baked payloads, 841 MB,
 * gitignored) exists as real files in exactly one place: the main checkout.
 * Every lane and integration worktree links to it, most simply by making
 * public/data/surface itself a symlink. A script that only asks "is the FILE a
 * symlink?" is then defeated by a symlinked PARENT directory: the file is a
 * real file inside the main checkout's store, and writing it rewrites the
 * shared tiles, manifest and baked payload that production builds from. Sprint
 * 30Sep26w Lane M's first merge script and overlay copier had exactly that
 * gap (fix round 1, adversarial verifier, reproduced in scratch).
 *
 * THE GUARD. A destination is writable only when the REAL path of its
 * directory (every symlink resolved) lies inside the real path of the checkout
 * doing the write, and not inside the main checkout's store unless the write
 * is a deliberate promotion (--promote, run from the main checkout itself).
 * Files are written to a temporary name and renamed into place, so a leaf
 * symlink or hard link is replaced, never written through.
 *
 * THE OVERLAY. `prepare` turns a checkout's linked surface into a local
 * overlay without touching the store: every symlinked directory on the path
 * (public, public/data, public/data/surface, tiles) becomes a real directory
 * holding one symlink per child, and baked/ becomes a real copy, because the
 * bake (scripts/bake-surface.mjs, scripts/bake-ground.mjs) writes its files
 * with a plain writeFile that would follow a link. After `prepare`, the merge
 * script replaces only its own tiles and the bake writes only this baked/.
 *
 * Usage:
 *   node scripts/surface-overlay.mjs check   [--root <checkout>]
 *   node scripts/surface-overlay.mjs prepare [--root <checkout>]
 *   node scripts/surface-overlay.mjs apply --from <checkout> [--to <checkout>]
 *        [--files tiles/a.json,baked/b.bin] [--promote]
 * --root and --to default to the checkout holding this script. apply copies
 * the listed files (relative to public/data/surface; default: Lane M's five)
 * from one checkout's overlay into another's, after preparing the destination,
 * and fails if the main checkout's store changed while it ran.
 */
import {
  lstat, realpath, readdir, readlink, mkdir, symlink, unlink, rename, rm, copyFile, cp, readFile, writeFile, stat,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SURFACE_REL = 'public/data/surface';
/** Lane M's overlay (sprint 30Sep26w, D-041), relative to public/data/surface. */
export const LANE_M_FILES = [
  'tiles/tile_10_13.json', 'tiles/tile_10_14.json', 'tiles/manifest.json',
  'baked/buildings.bin', 'baked/meta.json',
];

export class OverlayError extends Error {
  constructor(message) { super(message); this.name = 'OverlayError'; }
}

const PREPARE_HINT = 'make this checkout\'s surface data a local overlay first: node scripts/surface-overlay.mjs prepare';

export const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const lstatOrNull = (p) => lstat(p).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });

/**
 * The main checkout (the worktree that owns the git directory), or null when
 * `root` is not in a git checkout. `git rev-parse --git-common-dir` names the
 * shared .git of every linked worktree.
 */
export function findMainRoot(root) {
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.basename(common) === '.git' ? path.dirname(common) : null;
  } catch { return null; }
}

/** Real path of the main checkout's surface store, or null. `mainRoot` null skips it; undefined asks git. */
export async function sharedStore(root, mainRoot) {
  const main = mainRoot === undefined ? findMainRoot(root) : mainRoot;
  if (!main) return null;
  return realpath(path.join(main, SURFACE_REL)).catch(() => null);
}

/**
 * Throw unless files may be created in `dir` by the checkout at `root`:
 * the directory's real path must be inside the checkout's real path, and not
 * inside the main checkout's store unless `promote` (which only the main
 * checkout itself can satisfy, since a worktree's own directories are never
 * inside another checkout's store).
 */
export async function assertLocalDir(dir, { root = SCRIPT_ROOT, promote = false, mainRoot } = {}) {
  const realRoot = await realpath(root);
  let realDir;
  try { realDir = await realpath(dir); } catch (e) {
    throw new OverlayError(`refusing to write in ${dir}: it does not exist (${e.code}); ${PREPARE_HINT}`);
  }
  if (!within(realDir, realRoot)) {
    throw new OverlayError(`refusing to write in ${path.relative(root, dir) || dir}: it resolves to ${realDir}, `
      + `outside this checkout (${realRoot}), through a symlinked directory; ${PREPARE_HINT}`);
  }
  const store = await sharedStore(root, mainRoot);
  if (store && within(realDir, store) && !promote) {
    throw new OverlayError(`refusing to write in ${realDir}: it is the main checkout's public/data/surface, the store every `
      + 'worktree links to and production builds from. Promotion writes there deliberately: pass --promote.');
  }
  return realDir;
}

/**
 * Write `data` to `file` without ever writing through a link: the directory
 * must pass assertLocalDir, and the bytes go to a temporary sibling that is
 * renamed over the destination (replacing a leaf symlink or hard link rather
 * than following it).
 */
export async function writeLocal(file, data, opts = {}) {
  await assertLocalDir(path.dirname(file), opts);
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** As writeLocal, copying an existing file's bytes. */
export async function copyLocal(src, file, opts = {}) {
  await assertLocalDir(path.dirname(file), opts);
  const tmp = `${file}.tmp-${process.pid}`;
  await copyFile(src, tmp);
  await rename(tmp, file);
}

/**
 * Everything wrong with `root`'s surface for a write-then-bake run: tiles/ or
 * baked/ resolving outside the checkout (or into the main store without
 * `promote`), and any baked file that is a symlink or hard link, which the
 * bake's writeFile would write through. Empty when safe.
 */
export async function overlayProblems({ root = SCRIPT_ROOT, promote = false, mainRoot } = {}) {
  const problems = [];
  const surface = path.join(root, SURFACE_REL);
  for (const sub of ['tiles', 'baked']) {
    const dir = path.join(surface, sub);
    if (!(await lstatOrNull(dir))) { problems.push(`${SURFACE_REL}/${sub} is missing`); continue; }
    try { await assertLocalDir(dir, { root, promote, mainRoot }); } catch (e) {
      if (e instanceof OverlayError) problems.push(e.message); else throw e;
    }
  }
  const baked = path.join(surface, 'baked');
  const bst = await lstatOrNull(baked);
  if (bst && !bst.isSymbolicLink() && bst.isDirectory()) {
    for (const name of (await readdir(baked)).sort()) {
      const st = await lstat(path.join(baked, name));
      if (st.isSymbolicLink()) problems.push(`${SURFACE_REL}/baked/${name} is a symlink; the bake would write through it`);
      else if (st.isFile() && st.nlink > 1) problems.push(`${SURFACE_REL}/baked/${name} is a hard link (${st.nlink}); the bake would write through it`);
    }
  }
  return problems;
}

export async function assertOverlayWritable(opts = {}) {
  const problems = await overlayProblems(opts);
  if (!problems.length) return;
  // Each refusal names its own remedy; the leaf-link ones need `prepare`.
  const hint = problems.some((p) => !p.includes('--promote') && !p.includes(PREPARE_HINT)) ? `\n${PREPARE_HINT}` : '';
  throw new OverlayError(`public/data/surface is not safe to write:\n  - ${problems.join('\n  - ')}${hint}`);
}

// ── prepare ──────────────────────────────────────────────────────────────────

/** Replace the directory symlink `p` by a real directory of per-child symlinks into its target. */
async function splitLinkedDir(p, log) {
  const target = await realpath(p);
  const tmp = `${p}.overlay-tmp`;
  await rm(tmp, { recursive: true, force: true }); // our own leftover: links only, never followed
  await mkdir(tmp);
  const names = (await readdir(target)).sort();
  for (const name of names) await symlink(path.join(target, name), path.join(tmp, name));
  if (!(await lstat(p)).isSymbolicLink()) throw new OverlayError(`${p} changed while preparing`);
  await unlink(p); // removes the link itself, never the target
  await rename(tmp, p);
  log(`split ${p} -> real directory, ${names.length} links into ${target}`);
}

/** Replace the directory symlink `p` by a real, dereferenced copy of its target. */
async function copyLinkedDir(p, log) {
  const target = await realpath(p);
  const tmp = `${p}.overlay-tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  const names = (await readdir(target)).sort();
  for (const name of names) {
    const src = path.join(target, name);
    if ((await stat(src)).isDirectory()) await cp(src, path.join(tmp, name), { recursive: true, dereference: true });
    else await copyFile(src, path.join(tmp, name));
  }
  if (!(await lstat(p)).isSymbolicLink()) throw new OverlayError(`${p} changed while preparing`);
  await unlink(p);
  await rename(tmp, p);
  log(`copied ${p} <- ${target} (${names.length} entries)`);
}

/**
 * Make `root`'s public/data/surface a local overlay. Touches only `root`:
 * links are created and removed there, and store files are read, never
 * written. Idempotent; a checkout whose surface is already real is unchanged.
 */
export async function prepareOverlay({ root = SCRIPT_ROOT, promote = false, mainRoot, log = () => {} } = {}) {
  const realRoot = await realpath(root);
  const store = await sharedStore(root, mainRoot);
  if (store && within(store, realRoot)) {
    // The main checkout: its store is real by construction. Nothing to split.
    if (!promote) log('main checkout: public/data/surface is the store itself; nothing to prepare');
    return { changed: 0 };
  }
  let changed = 0;
  let cur = root;
  for (const part of SURFACE_REL.split('/')) {
    cur = path.join(cur, part);
    const st = await lstatOrNull(cur);
    if (!st) throw new OverlayError(`${cur} is missing: link the data store in first`);
    if (st.isSymbolicLink()) { await splitLinkedDir(cur, log); changed++; }
  }
  const tiles = path.join(cur, 'tiles');
  const tst = await lstatOrNull(tiles);
  if (tst?.isSymbolicLink()) { await splitLinkedDir(tiles, log); changed++; }
  const baked = path.join(cur, 'baked');
  const bst = await lstatOrNull(baked);
  if (bst?.isSymbolicLink()) { await copyLinkedDir(baked, log); changed++; }
  else if (bst?.isDirectory()) {
    for (const name of (await readdir(baked)).sort()) {
      const p = path.join(baked, name), st = await lstat(p);
      if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)) {
        const tmp = `${p}.overlay-tmp`;
        await copyFile(await realpath(p), tmp); // a fresh inode with the same bytes
        await rename(tmp, p);
        log(`materialised ${p}`);
        changed++;
      }
    }
  }
  // Every directory now resolves inside the checkout; prove it.
  for (const d of [tiles, baked]) if (await lstatOrNull(d)) await assertLocalDir(d, { root, promote, mainRoot });
  return { changed };
}

// ── apply ────────────────────────────────────────────────────────────────────

const sha256File = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

async function snapshot(dir, rels) {
  const out = {};
  for (const r of rels) out[r] = await sha256File(path.join(dir, r)).catch(() => null);
  return out;
}

/**
 * Copy `files` (relative to public/data/surface) from checkout `from` into
 * checkout `to`: prepare `to`'s overlay, back up what each file replaces, copy
 * by temp-and-rename, and verify the bytes. Fails if the main store's copies
 * of those files changed while it ran (when `to` is not the main checkout).
 */
export async function applyOverlay({ from, to = SCRIPT_ROOT, files = LANE_M_FILES, promote = false, mainRoot,
                                     backupDir, log = () => {} } = {}) {
  if (!from) throw new OverlayError('apply needs --from <checkout>');
  const realFrom = await realpath(from), realTo = await realpath(to);
  if (realFrom === realTo) throw new OverlayError('source and destination are the same checkout');
  const store = await sharedStore(to, mainRoot);
  const toIsMain = !!store && within(store, realTo);
  if (toIsMain && !promote) {
    throw new OverlayError(`refusing to apply into ${realTo}: it is the main checkout, whose public/data/surface is the `
      + 'shared store. Promotion writes there deliberately: pass --promote.');
  }
  for (const rel of files) {
    const s = path.join(from, SURFACE_REL, rel), st = await lstatOrNull(s);
    if (!st) throw new OverlayError(`source ${s} is missing`);
    if (st.isSymbolicLink() || !st.isFile()) throw new OverlayError(`source ${rel} is not a real file in ${from}; it is not part of that checkout's overlay`);
  }
  await prepareOverlay({ root: to, promote, mainRoot, log });
  const guarded = store && !toIsMain;
  const before = guarded ? await snapshot(store, files) : null;
  const bk = backupDir || path.join(path.dirname(realTo), `${path.basename(realTo)}-surface-overlay-backup`);
  const record = [];
  for (const rel of files) {
    const s = path.join(from, SURFACE_REL, rel), d = path.join(to, SURFACE_REL, rel);
    await assertLocalDir(path.dirname(d), { root: to, promote, mainRoot });
    const dst = await lstatOrNull(d);
    if (dst?.isSymbolicLink()) record.push({ file: rel, was: 'symlink', to: await readlinkSafe(d) });
    else if (dst) {
      await mkdir(path.dirname(path.join(bk, rel)), { recursive: true });
      await copyFile(d, path.join(bk, rel));
      record.push({ file: rel, was: 'file', sha256: await sha256File(d), backup: path.join(bk, rel) });
    } else record.push({ file: rel, was: 'absent' });
    await copyLocal(s, d, { root: to, promote, mainRoot });
    const [hs, hd] = [await sha256File(s), await sha256File(d)];
    if (hs !== hd) throw new OverlayError(`${rel}: copy mismatch (${hs} vs ${hd})`);
    if ((await lstat(d)).isSymbolicLink()) throw new OverlayError(`${rel}: destination is still a link`);
    record[record.length - 1].sha256After = hd;
    log(`${rel}  ${hd}`);
  }
  if (record.some((r) => r.was === 'file')) {
    await mkdir(bk, { recursive: true });
    await writeFile(path.join(bk, 'replaced.json'), JSON.stringify(record, null, 2) + '\n');
    log(`backups of replaced real files in ${bk}`);
  }
  if (guarded) {
    const after = await snapshot(store, files);
    const changed = files.filter((r) => before[r] !== after[r]);
    if (changed.length) throw new OverlayError(`THE MAIN STORE CHANGED during apply: ${changed.join(', ')}`);
    log(`main store unchanged (${files.length} files hash-compared in ${store})`);
  }
  return record;
}

const readlinkSafe = (p) => readlink(p).catch(() => null);

// ── CLI ──────────────────────────────────────────────────────────────────────

export async function cli(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
  const promote = argv.includes('--promote');
  const log = (m) => console.log(m);
  if (cmd === 'check') {
    const root = path.resolve(arg('--root') || SCRIPT_ROOT);
    const problems = await overlayProblems({ root, promote });
    if (problems.length) { console.error(`NOT SAFE: ${root}\n  - ${problems.join('\n  - ')}`); return 1; }
    console.log(`local overlay: writes to ${path.join(root, SURFACE_REL)} stay in this checkout`);
    return 0;
  }
  if (cmd === 'prepare') {
    const root = path.resolve(arg('--root') || SCRIPT_ROOT);
    const { changed } = await prepareOverlay({ root, promote, log });
    console.log(changed ? `prepared ${root} (${changed} changes)` : `already a local overlay: ${root}`);
    return 0;
  }
  if (cmd === 'apply') {
    const from = arg('--from') && path.resolve(arg('--from'));
    const to = path.resolve(arg('--to') || SCRIPT_ROOT);
    const files = arg('--files') ? arg('--files').split(',') : LANE_M_FILES;
    await applyOverlay({ from, to, files, promote, log });
    console.log(`applied ${files.length} files into ${to}`);
    return 0;
  }
  console.error('usage: surface-overlay.mjs check|prepare [--root <checkout>] | apply --from <checkout> [--to <checkout>] [--files a,b] [--promote]');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().then((code) => process.exit(code), (e) => { console.error(e instanceof OverlayError ? e.message : e); process.exit(1); });
}
