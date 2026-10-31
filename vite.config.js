import { defineConfig } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const gzipAsync = promisify(gzip);

// s21:L (profile A + I). The building payload (12.75 MB, served as an octet-stream, which Pages does
// not compress) is also offered gzip-framed as buildings.z.bin, as ground.bin already is: 8.83 MB.
// It is DERIVED, never stored: built from public/data/surface/baked/buildings.bin into dist/ at build
// time (node zlib, level 6, deterministic: the header carries no timestamp) and served from memory in
// DEV. The surface store is not touched. The client (src/baked-buildings.js) decompresses it, runs the
// same length, metadata and SHA-256 checks on the result, and falls back to buildings.bin if it is
// missing or undecodable.
export const PAYLOAD_SOURCE = 'public/data/surface/baked/buildings.bin';
export const PAYLOAD_Z_ROUTE = '/data/surface/baked/buildings.z.bin';

/** The gzip-framed payload for a checkout root (level 6, deterministic). Exported for the unit test. */
export function compressPayload(root) {
  return readFile(path.resolve(root, PAYLOAD_SOURCE)).then(buffer => gzipAsync(buffer, { level: 6 }));
}

function bakedPayloadPlugin() {
  let root = process.cwd();
  let compressed = null;
  const source = () => path.resolve(root, PAYLOAD_SOURCE);
  const compress = () => (compressed ||= compressPayload(root));
  return {
    name: 'ug-baked-payload-z',
    configResolved(config) { root = config.root; },
    configureServer(server) {
      server.middlewares.use(PAYLOAD_Z_ROUTE, async (req, res, next) => {
        if (!existsSync(source())) return next();
        try {
          const body = await compress();
          res.setHeader('content-type', 'application/octet-stream');
          res.setHeader('content-length', String(body.length));
          res.setHeader('cache-control', 'no-store');
          res.end(body);
        } catch (error) { next(error); }
      });
    },
    async writeBundle(options) {
      if (!existsSync(source())) return;
      const target = path.join(options.dir, PAYLOAD_Z_ROUTE);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await compress());
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [bakedPayloadPlugin()],

  // Keep initial load snappy: split large deps (Three.js) into separate chunks.
  build: {
    // Keep the warning threshold slightly above Three's minified footprint.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/three/')) return 'three';
            // Put everything else in a generic vendor chunk.
            return 'vendor';
          }
        },
      },
    },
  },
});
