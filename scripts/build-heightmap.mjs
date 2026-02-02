import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const srcDir = arg('src', 'data/sources/ea_dtm_1m');
const outBase = arg('out', 'data/terrain/london');
const tr = Number(arg('tr', '10')); // metres per pixel

await fs.mkdir(path.dirname(outBase), { recursive: true });

function sh(cmd) {
  console.log('$', cmd);
  return execSync(cmd, { stdio: 'inherit' });
}

// Build VRT from GeoTIFF tiles.
const vrt = `${outBase}_dtm.vrt`;
sh(`gdalbuildvrt ${vrt} ${srcDir}/*.tif`);

// Compute stats to get min/max for scaling.
const info = execSync(`gdalinfo -stats -json ${vrt}`, { encoding: 'utf8' });
const j = JSON.parse(info);
const band = j.bands?.[0];
const min = band?.minimum;
const max = band?.maximum;
if (!(Number.isFinite(min) && Number.isFinite(max))) {
  throw new Error('Could not compute min/max from gdalinfo stats; check source tiles.');
}

const tif = `${outBase}_${tr}m.tif`;
sh(`gdalwarp -r bilinear -tr ${tr} ${tr} -overwrite ${vrt} ${tif}`);

const png = `${outBase}_height_u16.png`;
sh(`gdal_translate -ot UInt16 -scale ${min} ${max} 0 65535 ${tif} ${png}`);

// Bounds in projected coordinates
const gt = j.geoTransform;
const sizeX = j.size[0];
const sizeY = j.size[1];
const xmin = gt[0];
const ymax = gt[3];
const xmax = xmin + gt[1] * sizeX;
const ymin = ymax + gt[5] * sizeY;

const meta = {
  source: 'EA LiDAR Composite DTM (GeoTIFF tiles)',
  crs: j.coordinateSystem?.wkt ? 'WKT' : (j.coordinateSystem?.data?.name || 'unknown'),
  bounds_m: [xmin, ymin, xmax, ymax],
  elev_min_m: min,
  elev_max_m: max,
  pixel_size_m: tr,
  heightmap: path.basename(png),
};

await fs.writeFile(`${outBase}_height.json`, JSON.stringify(meta, null, 2));
console.log('Wrote', png);
console.log('Wrote', `${outBase}_height.json`);
