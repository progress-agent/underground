/** Rebuild mapped airport geometry from archived Overpass JSON, without network at runtime.
 * node scripts/prepare-airports.mjs /absolute/path/to/airport-source-directory
 * Source files: *-osm.json; retain originals with their OSM timestamps in project evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
const dir=process.argv[2];
if(!dir)throw new Error('Provide directory containing archived *-osm.json Overpass responses');
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const origin=proj4('EPSG:4326','EPSG:27700',[-.1278,51.5074]);
const project=([lat,lon])=>{const [e,n]=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return [+(e-origin[0]).toFixed(2),+(origin[1]-n).toFixed(2)];};
const specs=[['heathrow','Heathrow','EGLL','passenger',51.47,-.454,4000],['london-city','London City','EGLC','passenger',51.505,.05,1900],['biggin-hill','London Biggin Hill','EGKB','business',51.331,.033,2000],['northolt','RAF Northolt','EGWU','military/civil',51.554,-.419,1900],['elstree','London Elstree','EGTR','general aviation',51.655,-.325,1000],['denham','Denham','EGLD','general aviation',51.588,-.513,1000],['stapleford','Stapleford','EGSG','general aviation',51.652,.156,1400],['kenley','Kenley','EGKN','gliding',51.305,-.096,1200],['damyns-hall','Damyns Hall','EGML','general aviation',51.529,.245,1100]];
const elements=new Map();let timestamps=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('-osm.json')).sort()){const d=JSON.parse(fs.readFileSync(path.join(dir,f)));timestamps.push(d.osm3s?.timestamp_osm_base);for(const e of d.elements)elements.set(`${e.type}/${e.id}`,e);}
function rings(e){if(e.geometry)return [e.geometry.map(p=>[p.lat,p.lon])];if(e.type==='node')return [[[e.lat,e.lon]]];const parts=(e.members||[]).filter(m=>m.role==='outer'&&m.geometry).map(m=>m.geometry.map(p=>[p.lat,p.lon]));const result=[];while(parts.length){let a=parts.shift();for(let more=true;more;){more=false;for(let i=0;i<parts.length;i++){const p=parts[i],same=(a,b)=>a[0]===b[0]&&a[1]===b[1];if(same(a.at(-1),p[0])){a.push(...p.slice(1));parts.splice(i,1);more=true;break;}if(same(a.at(-1),p.at(-1))){a.push(...p.toReversed().slice(1));parts.splice(i,1);more=true;break;}}}result.push(a);}return result;}
const data={version:1,attribution:'© OpenStreetMap contributors, ODbL 1.0',source:'https://www.openstreetmap.org/copyright',sourceTimestamps:[...new Set(timestamps.filter(Boolean))],coordinateContract:'British National Grid metres relative to projected WGS84 51.5074,-0.1278; x east, z south; no vertical exaggeration',authoredDefaults:'Untagged terminal height 14m; hangar 12m; support building 8m; control tower 18m; taxiway width 23m at Heathrow, 12m elsewhere. These are illustrative architectural dimensions, not surveyed facts. Aircraft placements are static authored traffic, not current flights.',airports:[]};
for(const [id,name,icao,kind,lat,lon,radius]of specs){const centre=project([lat,lon]);const s={id,name,icao,kind,centre,runways:[],taxiways:[],aprons:[],buildings:[],stands:[],runwayExtensions:[]};let boundary=[];
for(const e of elements.values()){const t=e.tags||{},rs=rings(e);if(!rs.length||!rs[0].length)continue;const pts=rs[0].map(project),c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]);if(Math.hypot(c[0]-centre[0],c[1]-centre[1])>radius)continue;if(t.aeroway==='aerodrome'&&(t.icao===icao||t['icao']===icao)){boundary=pts;break;}}
const inside=(p,ring)=>{let h=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>p[1])!==(ring[j][1]>p[1])&&p[0]<(ring[j][0]-ring[i][0])*(p[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])h=!h;return h;};
for(const e of elements.values()){const t=e.tags||{},rs=rings(e);for(let ri=0;ri<rs.length;ri++){const ll=rs[ri];if(!ll.length)continue;const points=ll.map(project),c=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);if(Math.hypot(c[0]-centre[0],c[1]-centre[1])>radius)continue;if(['kenley','damyns-hall'].includes(id)&&boundary.length&&!inside(c,boundary)&&!(id==='kenley'&&t.aeroway==='taxiway'&&[24016910,204512782,204512783,204512784,204512785].includes(e.id)))continue;const osm=`${e.type}/${e.id}`,base={osm,name:t.name||t.ref||'',points};
if(t.aeroway==='runway'&&t.runway==='displaced_threshold'){s.runwayExtensions.push({...base,surface:t.surface});}else if(t.aeroway==='runway'&&!t.runway){s.runways.push({...base,width:Number(t.width)|| (t.surface==='grass'?30:18),widthSource:t.width?'OSM tag':'authored visible strip width',surface:t.surface||'asphalt',length:Number(t.length)||null});}
else if(t.aeroway==='taxiway')s.taxiways.push({...base,width:Number(t.width)||(id==='heathrow'?23:12)});
else if(t.aeroway==='apron')s.aprons.push(base);
else if(t.aeroway==='parking_position'&&points.length>=2)s.stands.push(base);
else {const tower=t['tower:type']==='aircraft_control'||t.service==='aircraft_control'||/Air Traffic Control|Control Tower/.test(t.name||'');const terminal=t.aeroway==='terminal'&&(e.type!=='relation'||Boolean(t.building))&&t.name!=='Terminal 1';const hangar=t.aeroway==='hangar'||t.building==='hangar';const support=t.building&&boundary.length&&inside(c,boundary)&&['elstree','denham','stapleford','kenley','damyns-hall'].includes(id);if(tower||terminal||hangar||support){let h=Number.parseFloat(t.height)||Number(t['building:levels'])*3.6||(tower?18:terminal?14:hangar?12:8);if(id==='heathrow'&&tower)h=87;s.buildings.push({...base,kind:tower?'tower':terminal?'terminal':hangar?'hangar':'support',height:h,heightSource:t.height?'OSM height tag':id==='heathrow'&&tower?'Heathrow published 87m':t['building:levels']?'OSM levels × authored 3.6m':'authored indicative height'});}}
}}
for(const ext of s.runwayExtensions){if(id==='elstree'||(id==='stapleford'&&ext.surface==='grass'))continue;for(const r of s.runways){const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);let joined=false;if(d(r.points[0],ext.points.at(-1))<3){r.points=[...ext.points.slice(0,-1),...r.points];joined=true;}else if(d(r.points[0],ext.points[0])<3){r.points=[...ext.points.toReversed().slice(0,-1),...r.points];joined=true;}else if(d(r.points.at(-1),ext.points[0])<3){r.points.push(...ext.points.slice(1));joined=true;}else if(d(r.points.at(-1),ext.points.at(-1))<3){r.points.push(...ext.points.toReversed().slice(1));joined=true;}if(joined){(r.extensionSources??=[]).push(ext.osm);break;}}}delete s.runwayExtensions;for(const r of s.runways){if(id==='northolt'||id==='biggin-hill'){const a=r.points[0],b=r.points.at(-1),dist=Math.hypot(b[0]-a[0],b[1]-a[1]),extension=id==='northolt'?92:Math.max(0,1806-dist);r.points.unshift([+(a[0]-(b[0]-a[0])/dist*extension).toFixed(2),+(a[1]-(b[1]-a[1])/dist*extension).toFixed(2)]);r.authoredRunwayCompletion=id==='northolt'?'92m southwestern displaced-threshold pavement, UK MIL AIP EGWU AD2.12, AIRAC09/26':'Southwestern pavement completion along mapped bearing to operator-published 1806m runway length; terminal threshold coordinates retained';}}if(id==='stapleford'){
 const r=s.runways.find(r=>r.osm==='way/4279102');
 if(!r)throw Error('Missing mapped Stapleford main runway');
 // Operator Pilot Brief v1 (05/05/2026), Appendix G:1077x46m grass,
 // with a600x18m asphalt insert at the north-eastern21 end. This outranks
 // the OSM whole-way asphalt tag. Keep the published extent separate.
 r.surface='grass';r.width=46;r.widthSource='Operator Pilot Brief v1 Appendix G:1077m x46m';
 r.surfaceSource='https://flysfc.com/wp-content/uploads/2026/07/STAPLEFORD-AERODROME-PILOT-BRIEF-v1-2026.pdf';
 const line=r.points[0][1]<r.points.at(-1)[1]?r.points:r.points.toReversed();
 const points=[line[0]];let remaining=600;
 for(let i=1;i<line.length&&remaining>0;i++){const a=line[i-1],b=line[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d<=remaining){points.push(b);remaining-=d;}else{points.push([+(a[0]+(b[0]-a[0])*remaining/d).toFixed(2),+(a[1]+(b[1]-a[1])*remaining/d).toFixed(2)]);remaining=0;}}
 if(remaining>0)throw Error('Stapleford runway shorter than published hard insert');
 r.pavedInserts=[{name:'21L/03R asphalt insert',points,width:18,length:600,surface:'asphalt',sourceUrl:r.surfaceSource,geometrySource:'Operator Appendix G600m x18m length and width applied along mapped runway centreline from its northeast end; endpoint is source-derived, not separately surveyed',alignmentSources:[r.osm,...(r.extensionSources||[])]}];
}if(id==='damyns-hall'){
 // 07/25 is absent from OSM but confirmed by the current operator. Its position
 // is traced against Pooleys2020 plate graticule: longitude ticks x86/742 are
 // 00deg14m17s/15m07s; latitude y231/654 are51deg31m52s/31m32s
 // on the archived1400px rendering. Apply the published480m along this bearing.
 const chart=(x,y)=>project([51+31/60+(52-(y-231)*20/423)/3600,(14*60+17+(x-86)*50/656)/3600]);
 const a=chart(163,361),b=chart(491,331),d=Math.hypot(b[0]-a[0],b[1]-a[1]);
 s.runways.push({name:'07/25',points:[a,[+(a[0]+(b[0]-a[0])*480/d).toFixed(2),+(a[1]+(b[1]-a[1])*480/d).toFixed(2)]],length:480,sourceUrl:'https://www.damynshall.co.uk/flying_in',geometrySource:'Source-derived approximation from Pooleys2020 plate graticule and published480m length; not surveyed threshold coordinates'});
 for(const r of s.runways){r.surface='grass';r.width=25;r.widthSource='Pooleys Damyns Hall aerodrome plate';r.surfaceSource='https://www.damynshall.co.uk/flying_in';r.geometryReference='https://www.pooleys.com/media/9975/damyns-hall-egml_cropped.pdf';r.operationalUse=r.name==='03-21'?'Main visiting-aircraft runway':'Home-based aircraft only, give way to main runway';}}
s.boundary=boundary;data.airports.push(s);console.log(id,JSON.stringify({runways:s.runways.length,taxiways:s.taxiways.length,buildings:s.buildings.length,stands:s.stands.length}));}
fs.writeFileSync(new URL('../src/airport-data.json',import.meta.url),JSON.stringify(data));
