// Shared offline geometry for roads, building clearance and the independent R1 measure.
// Data © OpenStreetMap contributors, ODbL 1.0. Coordinates are canonical X/Z metres.
export const signedArea = p => p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
export const area = p => Math.abs(signedArea(p));
export const bounds = p => [Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];
export const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export function split(poly, distance) {
  const eps=1e-8,ds=poly.map(distance);
  if(Math.min(...ds)>=-eps)return [poly,[]];if(Math.max(...ds)<=eps)return [[],poly];
  const yes=[],no=[];let a=poly.at(-1),da=distance(a);
  for(const b of poly){const db=distance(b);
    if((da>eps&&db<-eps)||(da<-eps&&db>eps)){const t=da/(da-db),p=a.map((v,k)=>v+(b[k]-v)*t);yes.push(p);no.push(p);}
    if(db>=-eps)yes.push(b);if(db<=eps)no.push(b);a=b;da=db;
  }
  return [yes,no].map(p=>p.length>=3&&area(p)>1e-7?p:[]);
}
export function cut(poly, clip) {
  let inside=poly;const outside=[];
  for(let i=0;i<clip.length&&inside.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length];
    const [yes,no]=split(inside,p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
    if(no.length)outside.push(no);inside=yes;
  }
  return inside.length?{inside,outside}:{inside:[],outside:[poly]};
}
export function carriagewayPolygons(r) {
  const rails=r.p.map((p,i)=>{
    const a=r.p[Math.max(0,i-1)],b=r.p[Math.min(r.p.length-1,i+1)],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    return [-1,1].map(side=>[p[0]-(b[1]-a[1])/L*side*r.width/2,p[1]+(b[0]-a[0])/L*side*r.width/2]);
  });
  return rails.slice(1).flatMap((b,i)=>{const a=rails[i],p=[a[0],b[0],b[1],a[1]];
    if(area(p)<1e-7)return [];return [signedArea(p)<0?p.reverse():p];});
}
export function carriagewayIndex(roads,cell=80) {
  const buckets=new Map();let count=0;
  for(const r of roads)if(!r.tunnel)for(const polygon of carriagewayPolygons(r)){
    const box=bounds(polygon),f={r,polygon,box};count++;
    for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++){
      const k=x+','+z;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(f);
    }
  }
  const query=box=>{const found=new Set();for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++)for(const f of buckets.get(x+','+z)??[])if(overlaps(box,f.box))found.add(f);return [...found];};
  query.count=count;return query;
}
// Across coordinate is element 2 in metres. Height and morph values after it are
// interpolated by every cut. This preserves the existing bank/bridge support law.
export function trimJunction(triangle,r,index) {
  const candidates=index(bounds(triangle)).filter(f=>f.r.id!==r.id&&f.r.layer===r.layer&&f.r.bridge===r.bridge&&cut(triangle,f.polygon).inside.length);
  if(!candidates.length)return [{polygon:triangle,junction:false}];
  // Split only on the neighbouring carriageway boundary. Inside it, the
  // WHOLE intersection is asphalt (zero pavement widths), so an own-band
  // split is unnecessary. This avoids multiplying every junction by three
  // extra band pieces and preserves much more of the original topology.
  let pieces=[triangle];const result=[];
  for(const f of candidates){const next=[];for(const p of pieces){
    const {inside,outside}=cut(p,f.polygon);next.push(...outside);
    if(inside.length)result.push({polygon:inside,junction:true});
  }pieces=next;}
  result.push(...pieces.map(polygon=>({polygon,junction:false})));
  return result;
}

// Exact plan-view pavement polygons for consumers (no terrain/height dependency).
// At junctions the shared intersection is asphalt, so only outside pieces can
// contain a pavement. Vertices retain across-road metres for verification.
export function pavementPolygons(r,index) {
  if(r.tunnel||(!r.left&&!r.right))return [];
  const half=(r.width+r.left+r.right)/2,offset=(r.right-r.left)/2;
  const rails=r.p.map((p,i)=>{const a=r.p[Math.max(0,i-1)],b=r.p[Math.min(r.p.length-1,i+1)],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    return [-1,1].map(side=>[p[0]-(b[1]-a[1])/L*(side*half+offset),p[1]+(b[0]-a[0])/L*(side*half+offset),side*half]);
  });
  const result=[];
  for(let i=1;i<rails.length;i++)for(const t of [[rails[i-1][0],rails[i][0],rails[i][1]],[rails[i-1][0],rails[i][1],rails[i-1][1]]])
    for(const {polygon,junction} of trimJunction(t,r,index))if(!junction){
      if(r.left){const band=split(polygon,p=>-half+r.left-p[2])[0];if(band.length)result.push(band);}
      if(r.right){const band=split(polygon,p=>p[2]-half+r.right)[0];if(band.length)result.push(band);}
    }
  return result;
}
