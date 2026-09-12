// Shared by the live builder, offline compiler and optional old-payload decode.
// No browser, Three.js or JSON-loader dependency.
export const AIRPORT_SUPPRESSION_VERSION = 2;
const COINCIDENT_TOLERANCE_M = 3;
const polygonArea=ring=>Math.abs(ring.reduce((sum,p,i)=>{
  const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];
},0))/2;
function nearBoundary(point,ring) {
  return ring.some((a,i)=>{
    const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
    const t=length2?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/length2)):0;
    return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dz)<=COINCIDENT_TOLERANCE_M;
  });
}
// Source tiles round OSM vertices to integer metres. A concave footprint's
// recorded centre can sit in its courtyard, outside the polygon. Require a
// bidirectional boundary match and comparable area, not an enlarged campus.
function coincidentFootprint(footprint,replacement) {
  if(!Array.isArray(footprint)||footprint.length<3||replacement.ring.length<3) return false;
  const area=polygonArea(footprint),ratio=area/replacement.area;
  return ratio>=.85&&ratio<=1.15
    &&footprint.every(p=>nearBoundary(p,replacement.ring))
    &&replacement.ring.every(p=>nearBoundary(p,footprint));
}
const inside=(x,z,ring)=>{
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    if((ring[i][1]>z)!==(ring[j][1]>z)&&x<(ring[j][0]-ring[i][0])*(z-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0]) hit=!hit;
  }
  return hit;
};
export function createAirportSuppression(data) {
  const footprints=data.airports.flatMap(site=>site.buildings.map(building=>{
    const ring=building.points;
    return {...building,ring,area:polygonArea(ring),minX:Math.min(...ring.map(p=>p[0]))-8,maxX:Math.max(...ring.map(p=>p[0]))+8,
      minZ:Math.min(...ring.map(p=>p[1]))-8,maxZ:Math.max(...ring.map(p=>p[1]))+8};
  }));
  return ({x,z,cx,cz,osmId,footprint}={})=>{
    x??=cx;z??=cz;
    return footprints.some(b=>{
      if(osmId&&b.osm===String(osmId)) return true;
      if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ) return false;
      return b.ring.length>=3&&(inside(x,z,b.ring)||(footprint?.length&&footprint.every(([px,pz])=>inside(px,pz,b.ring)))||coincidentFootprint(footprint,b))
        || b.kind==='tower'&&Math.hypot(x-b.points[0][0],z-b.points[0][1])<8;
    });
  };
}
export async function airportSuppressionSignature(data) {
  const source=JSON.stringify({version:AIRPORT_SUPPRESSION_VERSION,toleranceM:COINCIDENT_TOLERANCE_M,airports:data.airports.map(site=>[site.id,site.buildings.map(b=>[b.osm,b.kind,b.points])])});
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
