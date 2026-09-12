// Physical EA airport terrain patches. Each TIFF must match the requested BNG
// footprint, Float32 metre values and complete coverage before it can be served.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const AIRPORT_DTM_BOUNDS={
 'heathrow':[504000,173000,511000,178000],
 'london-city':[541000,179000,544000,181000],
 'biggin-hill':[540000,159000,543000,163000],
 'northolt':[508000,184000,511000,186000],
 'elstree':[515000,195000,517000,198000],
 'denham':[502000,188000,504000,190000],
 'stapleford':[548000,196000,551000,199000],
 'kenley':[531000,156000,535000,160000],
 'damyns-hall':[554000,181000,558000,185000],
};
export function airportDtmUrl(bounds){
 const url=new URL('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs');
 url.search=new URLSearchParams({service:'WCS',version:'2.0.1',request:'GetCoverage',coverageId:'13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',format:'image/tiff',scaleSize:`i(${(bounds[2]-bounds[0])/25}),j(${(bounds[3]-bounds[1])/25})`});
 url.searchParams.append('subset',`E(${bounds[0]},${bounds[2]})`);url.searchParams.append('subset',`N(${bounds[1]},${bounds[3]})`);return String(url);
}
export function decodeAirportElevationTiff(buffer, bounds) {
  const expectedWidth=(bounds[2]-bounds[0])/25,expectedHeight=(bounds[3]-bounds[1])/25;
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
  if (width !== expectedWidth || height !== expectedHeight || !offsets?.length || !counts?.length) throw new Error('Unexpected bounded coverage raster layout');
  const transform = tags.get(34264), keys = tags.get(34735);
  if (!transform || transform[0] !== 25 || transform[5] !== -25 || transform[3] !== bounds[0] || transform[7] !== bounds[3]) throw new Error('Wrong geographic transform');
  let crs = null;
  for (let i = 4; i < (keys?.length ?? 0); i += 4) if (keys[i] === 3072 && keys[i + 1] === 0) crs = keys[i + 3];
  if (crs !== 27700) throw new Error('Wrong elevation CRS');
  const tileWidth=first(322),tileHeight=first(323);
  if(!tileWidth||!tileHeight||offsets.length!==Math.ceil(width/tileWidth)*Math.ceil(height/tileHeight))throw Error('Unexpected tile layout');
  const tileCols=Math.ceil(width/tileWidth);
  const elevations=Array.from({length:width*height},(_,i)=>{
    const row=Math.floor(i/width),col=i%width,tile=Math.floor(row/tileHeight)*tileCols+Math.floor(col/tileWidth);
    const local=((row%tileHeight)*tileWidth+col%tileWidth)*4;
    if(local+4>counts[tile])throw Error('Truncated elevation tile');
    return view.getFloat32(offsets[tile]+local,little);
  });
  if (elevations.some(y => !Number.isFinite(y) || y < -1000 || y > 1400)) throw new Error('Coverage has missing or invalid elevation samples');
  return { width, height, elevations: elevations.map(y => Math.round(y * 1000) / 1000) };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const index=process.argv.indexOf('--source-dir');
 if(index<0)throw Error('Pass --source-dir for archived source TIFFs and validation records');
 const directory=path.resolve(process.argv[index+1]);await mkdir(directory,{recursive:true});
 const patches=await Promise.all(Object.entries(AIRPORT_DTM_BOUNDS).map(async([id,bounds])=>{
  const file=path.join(directory,`${id}-ea-dtm-25m.tif`),url=airportDtmUrl(bounds);let buffer;
  try{buffer=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch(url,{signal:AbortSignal.timeout(55000)});if(!response.ok)throw Error(`${id} EA export HTTP${response.status}`);buffer=Buffer.from(await response.arrayBuffer());}
  const raster=decodeAirportElevationTiff(buffer,bounds),sha=createHash('sha256').update(buffer).digest('hex');
  if(id==='heathrow'&&sha!=='b9a514279c6058d4f8a28ad40a1c036e43f8963a114df59d90336ce1fd4affee')throw Error('Heathrow must use independently validated source');
  await writeFile(file,buffer);
  const patch={version:1,id,source:'Environment Agency LIDAR Composite DTM 1m (2022), WCS export at 25m',sourceUrl:url,catalogueUrl:'https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m',sourceSha256:sha,crs:'EPSG:27700',datum:'Ordnance Datum Newlyn',units:'metres',bounds_m:bounds,pixel_size_m:25,pixelConvention:'area; samples at pixel centres; first row north',boundaryBlendM:250,...raster};
  const {elevations,...validation}=patch;await writeFile(path.join(directory,`${id}-validation.json`),JSON.stringify({...validation,validSamples:elevations.length,invalidSamples:0,minM:Math.min(...elevations),maxM:Math.max(...elevations)},null,2));
  console.log(`${id}: ${elevations.length} physical values, SHA256 ${sha}`);return patch;
 }));
 const data={version:1,attribution:'© Environment Agency copyright and/or database right 2022. All rights reserved. Open Government Licence v3.0.',patches};
 await writeFile(path.join(ROOT,'public/data/terrain/airport-dtm.json'),JSON.stringify(data));
}
