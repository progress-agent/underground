// Rebuild the authored schematic from the checked-in TfL topology snapshot.
// No TfL diagram artwork, live requests, or geographic rail polylines are used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'public/data/tfl/route-sequence');
const index = JSON.parse(fs.readFileSync(path.join(sourceDir, 'index.json')));
const colours = { bakerloo:'#B36305', central:'#E32017', circle:'#FFD300', district:'#00782A', 'hammersmith-city':'#F3A9BB', jubilee:'#A0A5A9', metropolitan:'#9B0056', northern:'#111111', piccadilly:'#003688', victoria:'#0098D4', 'waterloo-city':'#95CDBA', dlr:'#00A4A7' };
// Deliberately authored diagram-space landmarks: expanded centre, compressed
// outer branches, a Circle rectangle and separate Northern branches.
const authored = {
  'Baker Street':[230,155], 'Paddington':[170,165], 'Edgware Road (Circle Line)':[195,155],
  'Edgware Road (Bakerloo)':[185,140], 'Harrow & Wealdstone':[115,70],
  "Queen's Park":[145,115], 'Elephant & Castle':[345,320],
  'Oxford Circus':[270,210], 'Piccadilly Circus':[285,245], 'Charing Cross':[310,260],
  'Waterloo':[340,280], 'Embankment':[320,270],
  'West Ruislip':[55,135], 'Ealing Broadway':[65,200], 'North Acton':[110,195],
  "Shepherd's Bush":[130,215], 'Notting Hill Gate':[170,215], 'Bond Street':[240,210],
  'Tottenham Court Road':[305,210], 'Holborn':[340,210], 'Bank':[420,240],
  'Liverpool Street':[415,190], 'Mile End':[470,190], 'Stratford':[505,155],
  'Leytonstone':[525,120], 'Woodford':[540,75], 'Hainault':[575,95], 'Epping':[565,35],
  'Hammersmith':[125,255], "Earl's Court":[170,280], 'South Kensington':[220,280],
  'High Street Kensington':[170,245], 'Gloucester Road':[195,280],
  'Victoria':[260,280], 'Westminster':[300,280], 'Blackfriars':[365,270],
  'Tower Hill':[440,245], 'Aldgate':[445,210], 'Aldgate East':[455,220],
  'Farringdon':[370,165], 'Moorgate':[400,180],
  "King's Cross & St Pancras International":[335,150],
  'Acton Town':[90,245], 'Turnham Green':[115,265], 'Richmond':[85,325],
  'Wimbledon':[165,365], 'Kensington (Olympia)':[150,255],
  'Whitechapel':[460,225], 'West Ham':[525,200], 'Barking':[555,180], 'Upminster':[585,155],
  'Stanmore':[205,55], 'Wembley Park':[185,100], 'Finchley Road':[235,125],
  'Green Park':[255,250], 'London Bridge':[400,290], 'Canada Water':[450,300],
  'Canary Wharf':[490,285], 'North Greenwich':[525,280], 'Canning Town':[545,250],
  'Uxbridge':[35,100], 'Harrow-on-the-Hill':[130,95], 'Rayners Lane':[95,115],
  'Moor Park':[115,50], 'Watford':[145,35], 'Chalfont & Latimer':[75,35],
  'Amersham':[45,25], 'Chesham':[80,15],
  'Edgware':[255,50], 'High Barnet':[335,30], 'Mill Hill East':[305,60],
  'Finchley Central':[325,75], 'Camden Town':[300,120], 'Euston':[300,155],
  'Warren Street':[285,180], 'Leicester Square':[310,240], 'Old Street':[405,150],
  'Kennington':[335,340], 'Battersea Power Station':[270,330], 'Stockwell':[295,355], 'Morden':[245,405],
  'Cockfosters':[400,40], 'Finsbury Park':[380,110],
  'Heathrow Terminals 2 & 3':[45,305], 'Heathrow Airport Terminal 4':[60,330], 'Heathrow Airport Terminal 5':[20,305],
  'Walthamstow Central':[480,80], 'Tottenham Hale':[445,105], 'Seven Sisters':[420,95],
  'Highbury & Islington':[365,130], 'Vauxhall':[290,310], 'Brixton':[330,385],
  'Tower Gateway':[450,260], 'Shadwell':[470,260], 'Limehouse':[485,245],
  'Poplar':[510,250], 'West India Quay':[495,270], 'Westferry':[490,255],
  'East India':[530,250], 'London City Airport':[565,295], 'Beckton':[590,260],
  'Woolwich Arsenal':[585,330], 'Lewisham':[490,375], 'Greenwich':[490,345],
  'Stratford International':[505,135], 'Custom House':[565,270], 'Royal Victoria':[555,260],
};
const labels = {
  'Paddington':[-9,-12,'end'], 'Baker Street':[0,-14,'middle'],
  'Oxford Circus':[-4,17,'end'], "King's Cross & St Pancras International":[0,-17,'middle',"King’s Cross"],
  'Liverpool Street':[7,-13,'start','Liverpool St'], 'Stratford':[8,-7,'start'],
  'Waterloo':[-8,17,'end'], 'Victoria':[-8,17,'end'], 'Bank':[7,15,'start'],
  'Canary Wharf':[-6,17,'end'], 'Heathrow Terminals 2 & 3':[0,20,'middle','Heathrow'],
};
const clean = name => name.replace(/ (Underground|DLR) Station$/, '');
const orientationRoutes = [
  {line:'central',stops:['West Ruislip','North Acton','Notting Hill Gate','Oxford Circus','Bank','Stratford','Epping']},
  {line:'central',stops:['Ealing Broadway','North Acton']},
  {line:'northern',stops:['Edgware','Camden Town','Euston','Tottenham Court Road','Charing Cross','Kennington','Morden']},
  {line:'northern',stops:['High Barnet','Camden Town',"King's Cross & St Pancras International",'Bank','Kennington']},
  {line:'piccadilly',stops:['Heathrow Terminals 2 & 3','Acton Town','South Kensington','Green Park','Holborn',"King's Cross & St Pancras International",'Cockfosters']},
  {line:'victoria',stops:['Brixton','Victoria','Oxford Circus',"King's Cross & St Pancras International",'Walthamstow Central']},
  {line:'jubilee',stops:['Stanmore','Baker Street','Green Park','Waterloo','London Bridge','Canary Wharf','Stratford']},
  {line:'circle',stops:['Paddington','Baker Street',"King's Cross & St Pancras International",'Liverpool Street','Tower Hill','Westminster','Victoria','South Kensington','High Street Kensington','Paddington']},
  {line:'district',stops:['Richmond','Turnham Green',"Earl's Court",'South Kensington','Westminster','Tower Hill','West Ham','Upminster']},
  {line:'district',stops:['Wimbledon',"Earl's Court"]},
];
const sourceGraphs=new Map();
const stations = new Map();
const lines = [];
for (const [id, colour] of Object.entries(colours)) {
  const entry = index.lines[id];
  if (!entry) throw new Error(`Missing TfL source ${id}`);
  const source = JSON.parse(fs.readFileSync(path.join(sourceDir, entry.file)));
  const canonicalNames = new Map(source.stations.map(stop=>[stop.icsId,clean(stop.name)]));
  const nameOf = stop => canonicalNames.get(stop.icsId) ?? clean(stop.name);
  const graph = new Map();
  const join = (a,b) => { if(a === b) return; if(!graph.has(a)) graph.set(a,new Set()); graph.get(a).add(b); };
  for (const sequence of source.stopPointSequences) {
    for(const stop of sequence.stopPoint) {
      if(!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) throw new Error(`Invalid coordinates ${stop.id}`);
      // TfL uses different NaPTAN IDs for some same-name modal interchanges.
      const name = nameOf(stop);
      if (!stations.has(name)) stations.set(name, { id:name, name, lat:stop.lat, lon:stop.lon });
    }
    for(let i=1;i<sequence.stopPoint.length;i++) {
      const a=nameOf(sequence.stopPoint[i-1]), b=nameOf(sequence.stopPoint[i]);
      join(a,b);join(b,a);
    }
  }
  sourceGraphs.set(id,new Map([...graph].map(([name,neighbours])=>[name,new Set(neighbours)])));
  // Contract only degree-two, unselected intermediate stations. Every resulting
  // edge is backed by a connected source walk, including branch boundaries.
  for (const [name, neighbours] of [...graph]) {
    if(authored[name] || neighbours.size !== 2) continue;
    const [a,b]=[...neighbours]; graph.get(a).delete(name);graph.get(b).delete(name);
    join(a,b);join(b,a);graph.delete(name);
  }
  const edges=[];
  for(const [a, neighbours] of graph) for(const b of neighbours) if(a < b) edges.push([a,b]);
  lines.push({id,name:source.lineName,colour,edges});
}
const retained = new Set(lines.flatMap(line=>line.edges.flat()));
const nodes = [...retained].sort().map(name=> {
  const s=stations.get(name);
  if(!authored[name]) {
    // Unlabelled source branch nodes only: the principal layout is authored above.
    authored[name]=[300+85*Math.asinh((s.lon+.13)/.065),220-75*Math.asinh((s.lat-51.51)/.04)];
  }
  return {...s, target:authored[name], label:labels[name] ?? null};
});
for(const name of Object.keys(authored)) if(!stations.has(name)) throw new Error(`Authored station absent from source: ${name}`);
// Preserve full source station walks for each quiet display route. Geographic
// sampling and rendering share these coordinates, including omitted minor stops.
for(const route of orientationRoutes) {
  const graph=sourceGraphs.get(route.line),walk=[];
  for(let i=1;i<route.stops.length;i++) {
    const start=route.stops[i-1],end=route.stops[i];
    const queue=[start],parents=new Map([[start,null]]);
    for(let q=0;q<queue.length&&!parents.has(end);q++) {
      for(const name of graph.get(queue[q])??[]) if(!parents.has(name)) {
        parents.set(name,queue[q]);queue.push(name);
      }
    }
    if(!parents.has(end))throw new Error(`Disconnected orientation route: ${start} / ${end}`);
    const leg=[];for(let n=end;n!==null;n=parents.get(n))leg.unshift(n);
    walk.push(...(walk.length?leg.slice(1):leg));
  }
  route.geographic=walk.map(name=>{const s=stations.get(name);return {name,lat:s.lat,lon:s.lon};});
}
const data={
  version:1, width:620, height:430,
  provenance:{ source:'Transport for London Unified API RouteSequence',snapshot:index.generatedAt,licence:'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service',attribution:'Powered by TfL Open Data',additionalAttribution:'Contains OS data © Crown copyright and database rights 2016. Geomni UK Map data © and database rights 2019.',layout:'Original UnderGround topology-based schematic; intermediate stops omitted. Not TfL map artwork or a journey planner.',sources:Object.values(index.lines).map(e=>e.url)},
  nodes,lines,orientationRoutes,
};
const output=path.join(root,'src/mini-map-data.json');
const serialised=JSON.stringify(data,null,2)+'\n';
if(process.argv.includes('--check')) {
  if(fs.readFileSync(output,'utf8')!==serialised) throw new Error('Mini-map data is stale; run node scripts/prepare-mini-map.mjs');
} else fs.writeFileSync(output,serialised);
console.log(`${nodes.length} schematic stations, ${lines.length} lines, ${lines.reduce((n,l)=>n+l.edges.length,0)} source-backed connections`);
