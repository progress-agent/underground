// Environment Agency LiDAR composite rasters over WCS 2.0.1, the endpoint
// family scripts/prepare-*-dtm.mjs use (sprint 30Sep26w, Lane R). Exports a
// cached, bounded GetCoverage fetch and a Float32 GeoTIFF reader that handles
// both strip and tile layouts and either byte order (the DSM service answers
// big-endian 208 px tiles; the DTM exports read by prepare-stratford-dtm.mjs
// are little-endian strips).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const COVERAGES = {
  dtm: {
    endpoint: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs',
    id: '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
    label: 'Environment Agency LIDAR Composite DTM 1m',
  },
  // Last return: the lowest surface the pulse reached, so vegetation over a
  // deck and overhead equipment are less likely than in the first return.
  dsm: {
    endpoint: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-last-return-dsm-1m/wcs',
    id: '9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m',
    label: 'Environment Agency LIDAR Composite Last Return DSM 1m',
  },
};
export const ATTRIBUTION = '© Environment Agency copyright and/or database right. All rights reserved. Open Government Licence v3.0.';

export function coverageUrl(kind, [e0, n0, e1, n1]) {
  const c = COVERAGES[kind];
  const q = new URLSearchParams({ service: 'WCS', version: '2.0.1', request: 'GetCoverage', coverageId: c.id, format: 'image/tiff' });
  q.append('subset', `E(${e0},${e1})`); q.append('subset', `N(${n0},${n1})`);
  return `${c.endpoint}?${q}`;
}

/** Decode a single-band Float32 GeoTIFF: {width, height, e0, n1, px, values, nodata}. */
export function decodeFloatTiff(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const little = buffer[0] === 73 && buffer[1] === 73;
  if (!little && !(buffer[0] === 77 && buffer[1] === 77)) throw new Error('Not a TIFF');
  if (view.getUint16(2, little) !== 42) throw new Error('Unsupported TIFF version');
  const ifd = view.getUint32(4, little), count = view.getUint16(ifd, little), tags = new Map();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12, id = view.getUint16(at, little), type = view.getUint16(at + 2, little), n = view.getUint32(at + 4, little);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8 }[type]; if (!size) continue;
    const start = size * n <= 4 ? at + 8 : view.getUint32(at + 8, little);
    const values = Array.from({ length: n }, (_, j) => type === 12 ? view.getFloat64(start + j * size, little)
      : type === 4 ? view.getUint32(start + j * size, little) : type === 3 ? view.getUint16(start + j * size, little)
        : type === 5 ? view.getUint32(start + j * size, little) / (view.getUint32(start + j * size + 4, little) || 1) : view.getUint8(start + j));
    tags.set(id, type === 2 ? String.fromCharCode(...values).replace(/\0$/, '') : values);
  }
  const first = id => tags.get(id)?.[0];
  if (first(258) !== 32 || first(339) !== 3 || first(259) !== 1 || first(277) !== 1) throw new Error('Expected uncompressed single-band Float32 elevation');
  const width = first(256), height = first(257), values = new Float32Array(width * height);
  const tw = first(322), th = first(323);
  if (tw && th) {
    const offsets = tags.get(324), across = Math.ceil(width / tw);
    offsets.forEach((off, k) => {
      const tx = (k % across) * tw, ty = Math.floor(k / across) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const gx = tx + x, gy = ty + y; if (gx >= width || gy >= height) continue;
        values[gy * width + gx] = view.getFloat32(off + (y * tw + x) * 4, little);
      }
    });
  } else {
    const offsets = tags.get(273), rps = first(278) ?? height;
    offsets.forEach((off, k) => {
      for (let y = 0; y < rps; y++) { const gy = k * rps + y; if (gy >= height) break;
        for (let x = 0; x < width; x++) values[gy * width + x] = view.getFloat32(off + (y * width + x) * 4, little); }
    });
  }
  const transform = tags.get(34264), keys = tags.get(34735);
  if (!transform) throw new Error('Missing geotransform');
  let crs = null;
  for (let i = 4; i < (keys?.length ?? 0); i += 4) if (keys[i] === 3072 && keys[i + 1] === 0) crs = keys[i + 3];
  if (crs !== 27700) throw new Error('Wrong elevation CRS');
  const nodataTag = tags.get(42113), nodata = nodataTag ? Number(nodataTag) : null;
  return { width, height, e0: transform[3], n1: transform[7], px: transform[0], values, nodata };
}

/** Elevation at BNG (e, n), nearest pixel; null outside or nodata. */
export function sampleRaster(r, e, n) {
  const x = Math.floor((e - r.e0) / r.px), y = Math.floor((r.n1 - n) / r.px);
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
  const v = r.values[y * r.width + x];
  if (!Number.isFinite(v) || (r.nodata !== null && Math.abs(v - r.nodata) < 1e-3) || v < -100 || v > 1000) return null;
  return v;
}

/** Fetch (or read from cache) one bounded coverage; returns the decoded raster and its provenance. */
export async function fetchCoverage(kind, bounds, cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${kind}-${bounds.join('_')}.tif`);
  let buffer;
  try { buffer = await readFile(file); } catch {
    const url = coverageUrl(kind, bounds);
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { res = await fetch(url); if (res.ok) break; } catch { res = null; }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!res?.ok) throw new Error(`EA ${kind} export failed for ${bounds.join(',')}: ${res?.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(file, buffer); // additive cache: new file names only
  }
  return { raster: decodeFloatTiff(buffer), sha256: createHash('sha256').update(buffer).digest('hex'), file };
}
