import * as THREE from 'three';
import bundled from './dlr-profile-data.json' with { type: 'json' };
// s30:R (sprint 30Sep26w, D-041): elevated and embankment deck heights
// measured from the Environment Agency LiDAR by
// scripts/prepare-dlr-deck-heights.mjs, keyed by OSM node id. `lidar` is
// measured; `interpolated` lies under something standing over the track (the
// Canary Wharf roofs) and is taken between the measured deck either side;
// `fallback` keeps the illustrative heightModel. Only `lidar` reads as
// surveyed. Everything built on this profile (the line, trains, markers,
// shafts, hover and the surface railway) takes the same deck.
import bundledDeck from './dlr-deck-heights.json' with { type: 'json' };

// Canonical VE5 geometry. Structure affects positive modelled clearance only;
// the master controller is deliberately absent from this module.
export const DECK_BASIS = {
  lidar: 'Environment Agency LiDAR 1m: last-return DSM deck minus DTM ground, measured',
  interpolated: 'Environment Agency LiDAR 1m, interpolated under a roof between measured deck',
  fallback: 'Illustrative class estimate; the LiDAR could not resolve the deck',
};
export function createDlrProfile({project, sampleSurfaceY, verticalExaggeration=5, data=bundled, deckHeights=bundledDeck}={}) {
  if(typeof project!=='function'||typeof sampleSurfaceY!=='function')throw new TypeError('DLR requires projection and canonical terrain sampler');
  if(data?.version!==1||!data.nodes?.length||!data.edges?.length||!data.stations||!data.links)throw new Error('Missing verified DLR profile data');
  if(!(verticalExaggeration>0))throw new RangeError('Invalid DLR vertical exaggeration');
  const ve=verticalExaggeration, model=data.heightModel, graph=[],adj=[], edgePaths=new Map(), segments=[];
  function add(lat,lon,sourceNode=null,deck=null){const p=project(lat,lon);if(!Number.isFinite(p.x)||!Number.isFinite(p.z))throw Error('Invalid DLR projection');const i=graph.length;graph.push({x:p.x,z:p.z,lat,lon,sourceNode,kinds:new Set(),ways:new Set(),deck});adj.push([]);return i;}
  // s30:R measured deck per source node; interpolated points along an edge take
  // the deck linearly between its ends (or the one end that has one).
  const deckOf=i=>{const d=deckHeights?.nodes?.[data.nodes[i].id];return d&&Number.isFinite(d.m)?d:null;};
  data.nodes.forEach((n,i)=>add(n.lat,n.lon,i,deckOf(i)));
  for(const edge of data.edges){const a=graph[edge.a],b=graph[edge.b],length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(length/20)),path=[edge.a];
    const between=t=>{const da=a.deck,db=b.deck;if(!da&&!db)return null;if(!da||!db){const d=da||db;return{...d};}
      return{m:da.m+(db.m-da.m)*t,source:da.source===db.source?da.source:(da.source==='fallback'||db.source==='fallback')?'fallback':'interpolated'};};
    for(let j=1;j<count;j++)path.push(add(a.lat+(b.lat-a.lat)*j/count,a.lon+(b.lon-a.lon)*j/count,null,between(j/count)));path.push(edge.b);
    edgePaths.set(`${edge.a}|${edge.b}`,path);edgePaths.set(`${edge.b}|${edge.a}`,[...path].reverse());
    for(let j=1;j<path.length;j++){const i=path[j-1],k=path[j],d=Math.hypot(graph[i].x-graph[k].x,graph[i].z-graph[k].z);adj[i].push([k,d]);adj[k].push([i,d]);graph[i].kinds.add(edge.kind);graph[k].kinds.add(edge.kind);graph[i].ways.add(edge.way);graph[k].ways.add(edge.way);segments.push({a:i,b:k,kind:edge.kind,way:edge.way});}
  }
  // A portal is an actual shared OSM node where tunnel/cutting meets daylight.
  // Distance is measured along rail geometry, never from a guessed radius.
  const tunnel=n=>n.kinds.has('tunnel')&&n.kinds.size===1;
  const cutting=n=>n.kinds.has('cutting')&&!n.kinds.has('tunnel')&&!n.kinds.has('elevated')&&n.kinds.size===1;
  function distances(predicate){const distance=graph.map(n=>predicate(n)?Infinity:0),queue=[];for(let i=0;i<graph.length;i++)if(distance[i]===0)queue.push(i);let q=0;while(q<queue.length){const i=queue[q++];for(const [j,d]of adj[i])if(predicate(graph[j])&&distance[i]+d<distance[j]){distance[j]=distance[i]+d;queue.push(j);}}return distance;}
  const td=distances(tunnel),cd=distances(cutting);
  for(let i=0;i<graph.length;i++){
    const n=graph[i];n.portal=n.kinds.has('tunnel')&&!tunnel(n);n.underground=tunnel(n)||cutting(n);
    n.kind=tunnel(n)?'tunnel':cutting(n)?'cutting':n.portal?'portal':n.kinds.has('elevated')?'elevated':n.kinds.has('embankment')?'embankment':'surface';
    // s30:R: a raised node takes its measured deck (dlr-deck-heights.json);
    // the class estimate stays where there is none, flagged by deckSource.
    const raised=n.kind==='elevated'||n.kind==='embankment';
    n.deckSource=raised?(n.deck?.source??'fallback'):null;
    n.offset=tunnel(n)?-Math.min(model.tunnelMaxM,td[i]*model.portalGrade):cutting(n)?-Math.min(-model.cuttingM,cd[i]*model.portalGrade):n.portal?0:raised?(n.deck&&n.deck.source!=='fallback'?n.deck.m:n.kind==='elevated'?model.elevatedM:model.embankmentM):model.surfaceM;
  }
  const portalDistance=graph.map(n=>n.portal?0:Infinity),portalQueue=[];
  graph.forEach((n,i)=>{if(n.portal)portalQueue.push(i);});
  for(let q=0;q<portalQueue.length;q++){const i=portalQueue[q];for(const [j,d]of adj[i])if(portalDistance[i]+d<portalDistance[j]){portalDistance[j]=portalDistance[i]+d;portalQueue.push(j);}}
  let currentScale=1,terrainPending=true;
  function refresh({structureScale=currentScale}={}){
    if(!Number.isFinite(structureScale)||structureScale<=0)throw new RangeError('DLR structure scale must be positive');currentScale=structureScale;terrainPending=false;
    for(const n of graph){const ground=sampleSurfaceY({x:n.x,z:n.z});n.pending=!Number.isFinite(ground);terrainPending ||= n.pending;n.groundY=n.pending?0:ground;
      n.y=n.groundY+ve*(n.offset<0?n.offset:n.portal?0:Math.max(model.surfaceM,n.offset*structureScale));
    }
    // Minimal majorant of aboveground rail altitudes at an illustrative 8%
    // physical grade. No isolated DSM roof creates a one-segment spike.
    // Boundaries stay at mapped portals; subsurface samples never get lifted.
    const queue=graph.map((_,i)=>i);let q=0;
    while(q<queue.length){const i=queue[q++],n=graph[i];if(n.underground||n.portal)continue;for(const [j,d]of adj[i]){const next=graph[j];if(next.underground||next.portal)continue;const floor=n.y-d*model.abovegroundGrade*ve;if(floor>next.y+1e-7){next.y=floor;queue.push(j);}}}
    for(let i=0;i<graph.length;i++){const n=graph[i];if(!n.underground&&!n.portal)n.y=Math.min(n.y,n.groundY+portalDistance[i]*model.portalGrade*ve);}
    return {terrainPending,structureScale:currentScale};
  }
  function info(n,y=n.y,groundY=n.groundY){const relative=(y-groundY)/ve;return {classification:n.kind,groundRelativeM:relative,depthM:Math.max(0,-relative),heightM:Math.max(0,relative),surveyed:n.deckSource==='lidar',heightBasis:n.deckSource?DECK_BASIS[n.deckSource]:'Illustrative rail profile relative to rendered terrain',deckSource:n.deckSource??null,deckM:n.deckSource?n.offset:null,terrainPending:n.pending,sourceWayIds:[...n.ways],needsShaft:n.kind==='tunnel'&&relative<-.5,structureScale:currentScale};}
  function point(index,stationId=null){const n=graph[index],p=new THREE.Vector3(n.x,n.y,n.z);p._dlrProfile={...info(n),nodeIndex:index,stationId};p._depthM=-p._dlrProfile.groundRelativeM;if(stationId){p.stationId=stationId;p.id=stationId;}return p;}
  function station({id,structureScale=currentScale,nodeIndex}={}){if(structureScale!==currentScale)refresh({structureScale});const s=data.stations[id];if(!s)throw Error(`Unmapped DLR station ${id}`);const index=nodeIndex??s.node;if(!s.candidates.some(c=>c.node===index))throw Error(`Wrong DLR platform for ${id}`);const p=point(index,id);p._dlrProfile.sourceStation={lat:s.lat,lon:s.lon,name:s.name,anchorApproximate:s.anchorApproximate,mapOffsetM:s.mapOffsetM};return p;}
  function buildBranch({points:stops,structureScale=currentScale}={}){
    if(structureScale!==currentScale)refresh({structureScale});if(!Array.isArray(stops)||stops.length<2)throw Error('DLR branch needs mapped station stops');
    const ids=stops.map(s=>s.id??s.naptanId);for(const id of ids)if(!data.stations[id])throw Error(`Unmapped DLR station ${id}`);
    // Choose a connected sequence of actual platform nodes, including the two
    // separate Stratford platform groups. Adjacent links cannot teleport.
    let states=new Map(data.stations[ids[0]].candidates.map(c=>[c.node,{cost:0,routes:[]} ]));
    for(let i=1;i<ids.length;i++){
      const key=[ids[i-1],ids[i]].sort().join('|'),source=data.links[key];if(!source)throw Error(`Missing sourced DLR link ${key}`);const next=new Map();
      for(const r of source){const route=ids[i-1]<ids[i]?r:{start:r.end,end:r.start,nodes:[...r.nodes].reverse(),length:r.length};const prev=states.get(route.start);if(!prev)continue;const cost=prev.cost+route.length;if(cost<(next.get(route.end)?.cost??Infinity))next.set(route.end,{cost,routes:[...prev.routes,route]});}
      if(!next.size)throw Error(`Disconnected DLR platform sequence at ${ids[i]}`);states=next;
    }
    const chosen=[...states.values()].reduce((a,b)=>a.cost<b.cost?a:b),indices=[],stopIndices=[];
    for(let i=0;i<chosen.routes.length;i++){const route=chosen.routes[i];if(i===0){indices.push(route.nodes[0]);stopIndices.push(0);}for(let j=1;j<route.nodes.length;j++){const path=edgePaths.get(`${route.nodes[j-1]}|${route.nodes[j]}`);if(!path)throw Error('Missing mapped DLR edge');indices.push(...path.slice(1));}stopIndices.push(indices.length-1);}
    const points=indices.map(i=>point(i));const stationPoints=stopIndices.map((i,j)=>{points[i]=station({id:ids[j],nodeIndex:indices[i]});return points[i];});
    const distance=[0];for(let i=1;i<points.length;i++)distance.push(distance[i-1]+points[i].distanceTo(points[i-1]));const total=distance.at(-1)||1;
    return {points,stationPoints,stationUs:stopIndices.map(i=>distance[i]/total),stationIndices:stopIndices,terrainPending};
  }
  // Spatial index keeps hover and resnap queries bounded. Metadata resnaps use
  // nodeIndex directly, avoiding nearest-track swaps at viaduct crossings.
  const buckets=new Map();for(const s of segments){const a=graph[s.a],b=graph[s.b];for(let x=Math.floor(Math.min(a.x,b.x)/100);x<=Math.floor(Math.max(a.x,b.x)/100);x++)for(let z=Math.floor(Math.min(a.z,b.z)/100);z<=Math.floor(Math.max(a.z,b.z)/100);z++){const key=`${x},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(s);}}
  // s30:R: `kinds` limits the search to track of those classes and
  // `maxDistance` its reach, so a surface-railway point on the lower level of a
  // flyover samples its own deck, not the one above it.
  function sample({x,z,structureScale=currentScale,nodeIndex,kinds=null,maxDistance=200}={}){if(structureScale!==currentScale)refresh({structureScale});if(Number.isInteger(nodeIndex)&&graph[nodeIndex])return point(nodeIndex);
    const accept=kinds?new Set(kinds):null;
    let best=null;for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(const s of buckets.get(`${Math.floor(x/100)+dx},${Math.floor(z/100)+dz}`)||[]){if(accept&&!accept.has(s.kind))continue;const a=graph[s.a],b=graph[s.b],vx=b.x-a.x,vz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/(vx*vx+vz*vz||1))),distance=Math.hypot(x-a.x-vx*t,z-a.z-vz*t);if(!best||distance<best.distance)best={s,a,b,t,distance};}
    if(!best||best.distance>Math.min(200,maxDistance))return null;const {a,b,t,s}=best,y=a.y+(b.y-a.y)*t,ground=a.groundY+(b.groundY-a.groundY)*t,p=new THREE.Vector3(x,y,z);
    const near=t<.5?a:b,far=near===a?b:a,basis=(s.kind==='elevated'||s.kind==='embankment')?[near,far].find(n=>n.deckSource)??near:near;
    p._dlrProfile={...info({...basis,kind:s.kind},y,ground),sourceWayIds:[s.way],trackDistanceM:best.distance};p._depthM=-p._dlrProfile.groundRelativeM;return p;
  }
  function resnap(points,{structureScale=currentScale,refreshTerrain=true}={}){if(refreshTerrain||structureScale!==currentScale)refresh({structureScale});for(const p of points){const id=p.stationId??p._dlrProfile?.stationId,index=p._dlrProfile?.nodeIndex;const next=id?station({id,nodeIndex:index}):sample({x:p.x,z:p.z,nodeIndex:index});if(!next)throw Error('DLR point outside sourced profile');p.copy(next);p._depthM=next._depthM;p._dlrProfile=next._dlrProfile;}return points;}
  refresh();
  return {station,buildBranch,sample,resnap,refresh,data,get terrainPending(){return terrainPending;},get structureScale(){return currentScale;}};
}
