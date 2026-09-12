// Convert only the two verified wet-dock OSM polygons. No shoreline invention.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import proj4 from 'proj4';
import {BNG_REF_E,BNG_REF_N} from '../src/coordinates.js';
const input=process.argv[2];if(!input)throw Error('Pass archived city-docks-osm.json');
const bytes=await readFile(input),source=JSON.parse(bytes);
const docks=[121158887,190792949].map(id=>{
 const way=source.elements.find(e=>e.type==='way'&&e.id===id);
 if(!way||way.tags.natural!=='water'||way.tags.dock!=='wet_dock'||way.geometry.length<4)throw Error(`Missing verified wet dock ${id}`);
 const points=way.geometry.map(({lat,lon})=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return [+(e-BNG_REF_E).toFixed(3),+(BNG_REF_N-n).toFixed(3)];});
 if(JSON.stringify(points[0])!==JSON.stringify(points.at(-1)))throw Error('Dock polygon must be closed');points.pop();
 return {osm:`way/${id}`,name:way.tags.name,points,referenceLevelM:4.26,datum:'metres above Ordnance Datum',levelSource:'https://www.newham.gov.uk/downloads/file/1384/newham-sfra-2017-part1',levelMeaning:'Published impounded dock water reference level, Newham SFRA2017 section2.12.9; not a live measurement or bathymetry'};
});
await writeFile(new URL('../src/airport-docks-data.json',import.meta.url),JSON.stringify({version:1,attribution:'© OpenStreetMap contributors, ODbL1.0',sourceTimestamp:source.osm3s?.timestamp_osm_base,sourceSha256:createHash('sha256').update(bytes).digest('hex'),coordinateContract:'Canonical BNG scene metres; x east,z south',docks}));
console.log(docks.map(d=>`${d.name}: ${d.points.length} source shoreline vertices`).join('\n'));
