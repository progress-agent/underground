// Local licensed assets are supplied at build/dev time and never enter git.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export async function prepareLicensedFonts(root) {
  const source = process.env.UG_FONT_SOURCE_DIR || path.join(homedir(), 'code/jc-review/shell/public/fonts');
  const target = path.join(root, 'public/fonts');
  const files = ['EksellDisplay-Large.woff2', 'EksellDisplay-Large.woff'];
  for (const name of files) {
    try { if (!(await stat(path.join(source, name))).isFile()) throw new Error('not a file'); }
    catch { throw new Error(`UnderGround requires the licensed Eksell Display font. Missing: ${path.join(source, name)}. Supply it locally (or set UG_FONT_SOURCE_DIR); never commit the font.`); }
  }
  await mkdir(target, { recursive: true });
  for (const name of files) await copyFile(path.join(source, name), path.join(target, name));
}

export function licensedFontsPlugin() {
  let root;
  return {
    name: 'ug-local-licensed-fonts',
    configResolved(config) { root = config.root; },
    async configureServer() { await prepareLicensedFonts(root); },
    async buildStart() { await prepareLicensedFonts(root); },
  };
}
