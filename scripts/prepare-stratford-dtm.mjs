// Reproducible, bounded EA bare-earth correction. Never substitutes nodata or
// an image-rendered hillshade for physical Float32 elevation samples.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs';
const coverage = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m';
const query = new URLSearchParams({ service: 'WCS', version: '2.0.1', request: 'GetCoverage', coverageId: coverage, format: 'image/tiff' });
query.append('subset', 'E(537000,539000)'); query.append('subset', 'N(183000,185000)'); query.set('scaleSize', 'i(80),j(80)');
const url = `${endpoint}?${query}`;

export function decodeElevationTiff(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const little = buffer[0] === 73 && buffer[1] === 73;
  if (!little && !(buffer[0] === 77 && buffer[1] === 77)) throw new Error('Not a TIFF');
  if (view.getUint16(2, little) !== 42) throw new Error('Unsupported TIFF version');
  const ifd = view.getUint32(4, little), count = view.getUint16(ifd, little), tags = new Map();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12, id = view.getUint16(at, little), type = view.getUint16(at + 2, little), n = view.getUint32(at + 4, little);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 }[type]; if (!size) continue;
    const start = size * n <= 4 ? at + 8 : view.getUint32(at + 8, little);
    const values = Array.from({ length: n }, (_, j) => type === 12 ? view.getFloat64(start + j * size, little)
      : type === 4 ? view.getUint32(start + j * size, little) : type === 3 ? view.getUint16(start + j * size, little) : view.getUint8(start + j));
    tags.set(id, type === 2 ? String.fromCharCode(...values).replace(/\0$/, '') : values);
  }
  const first = id => tags.get(id)?.[0];
  if (first(258) !== 32 || first(339) !== 3 || first(259) !== 1 || first(277) !== 1) throw new Error('Expected uncompressed single-band Float32 elevation');
  const width = first(256), height = first(257), offsets = tags.get(324) ?? tags.get(273), counts = tags.get(325) ?? tags.get(279);
  if (width !== 80 || height !== 80 || offsets?.length !== 1 || counts?.[0] < width * height * 4) throw new Error('Unexpected bounded coverage raster layout');
  const transform = tags.get(34264), keys = tags.get(34735);
  if (!transform || transform[0] !== 25 || transform[5] !== -25 || transform[3] !== 537000 || transform[7] !== 185000) throw new Error('Wrong geographic transform');
  let crs = null;
  for (let i = 4; i < (keys?.length ?? 0); i += 4) if (keys[i] === 3072 && keys[i + 1] === 0) crs = keys[i + 3];
  if (crs !== 27700) throw new Error('Wrong elevation CRS');
  const elevations = Array.from({ length: width * height }, (_, i) => view.getFloat32(offsets[0] + i * 4, little));
  if (elevations.some(y => !Number.isFinite(y) || y < -1000 || y > 1400)) throw new Error('Coverage has missing or invalid elevation samples');
  return { width, height, elevations: elevations.map(y => Math.round(y * 1000) / 1000) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--source');
  let buffer;
  if (index >= 0) buffer = await readFile(process.argv[index + 1]);
  else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`EA elevation export failed: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  const raster = decodeElevationTiff(buffer);
  const data = {
    version: 1, source: 'Environment Agency LIDAR Composite DTM 1m (2022), WCS export at 25m',
    sourceUrl: url, catalogueUrl: 'https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m',
    attribution: '© Environment Agency copyright and/or database right 2022. All rights reserved. Open Government Licence v3.0.',
    sourceSha256: createHash('sha256').update(buffer).digest('hex'), crs: 'EPSG:27700', datum: 'Ordnance Datum Newlyn', units: 'metres',
    bounds_m: [537000, 183000, 539000, 185000], pixel_size_m: 25, pixelConvention: 'area; samples at pixel centres; first row north',
    boundaryBlendM: 150, ...raster,
  };
  const out = path.join(ROOT, 'public/data/terrain/stratford-dtm.json');
  await writeFile(out, JSON.stringify(data));
  console.log(`Wrote ${out}: ${raster.elevations.length} verified physical elevations, source SHA256 ${data.sourceSha256}`);
}
