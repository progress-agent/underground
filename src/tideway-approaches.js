// Sourced embankment levels meet a deliberately coarse landscape. Keep the
// landing at the research AOD, then use real-size paving/steps to dry terrain.
// Coordinates here are local east/north metres, heights local to the water top.
import { pointInRing } from './station-building-geometry.js';

export function approachFrame(data) {
  const e = data.accessEdge, a = data.outline[e], b = data.outline[(e + 1) % data.outline.length];
  const t = data.approach.edgeFraction, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
  if (pointInRing(x + nx * .1, z + nz * .1, data.outline)) { nx = -nx; nz = -nz; }
  if (data.approach.directionEastNorth) {
    const [dx,dz] = data.approach.directionEastNorth, length = Math.hypot(dx,dz);
    nx = dx / length; nz = dz / length;
  }
  return { x, z, nx, nz };
}

export function approachPlan(data, { floorAt, dryAt, sy, datum }) {
  const frame = approachFrame(data), { x, z, nx, nz } = frame, { widthM: width, aodM, insetM } = data.approach;
  const deck = data.deckAOD - datum, landing = aodM - datum, slabs = [], route = [];
  const point = d => [x + nx * d, z + nz * d];
  const strip = (a, b, y) => {
    const A = point(a), B = point(b), vx = -nz * width / 2, vz = nx * width / 2;
    slabs.push({ ring: [[A[0]+vx,A[1]+vz],[B[0]+vx,B[1]+vz],[B[0]-vx,B[1]-vz],[A[0]-vx,A[1]-vz]], y });
    const [cx,cz] = point((a+b)/2);
    route.push({ d: (a + b) / 2, x: cx, z: cz, y });
  };
  const flight = (start, length, y0, y1) => {
    const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / .15));
    for (let i = 0; i < n; i++) strip(start + length * i / n, start + length * (i + 1) / n, y0 + (y1 - y0) * i / n);
    return n;
  };
  // Steps connect the sourced deck and embankment levels. The strip extends
  // inside Victoria's lower entrance terrace before reaching its raised deck.
  const innerLength = Math.max(1, Math.ceil(Math.abs(deck - landing) / .15) * .35);
  const innerStart = -insetM - 1.2;
  flight(innerStart, insetM + innerLength + 1.2, deck, landing);
  const apronStart = innerLength;
  let dryDistance = null;
  for (let d = apronStart + 6; d <= 450; d += 2) {
    if ([0, 2, 4].every(off => {
      const q = point(d + off);
      return [-width/2, 0, width/2].every(side => dryAt(q[0] - nz * side, q[1] + nx * side));
    })) { dryDistance = d; break; }
  }
  if (dryDistance === null) throw new Error(`No dry ${data.id} approach within 450 m`);
  strip(apronStart, dryDistance, landing);
  // The coarse land changes relative to a rigid quay when Master changes.
  // Rebuild this terrain tie-in, keeping each riser <=15 cm and tread >=35 cm.
  let length = 6, endY = landing;
  for (let i = 0; i < 30; i++) {
    const q = point(dryDistance + length);
    endY = (floorAt(...q) - datum * 5) / sy;
    const required = Math.max(6, Math.ceil(Math.abs(endY - landing) / .15) * .35);
    if (required <= length) break;
    length = required;
  }
  const steps = flight(dryDistance, length, landing, endY);
  // Last tread overlaps the dry ground. No last-step gap at the waterline.
  strip(dryDistance + length, dryDistance + length + .5, endY);
  return { frame, slabs, route, landingY: landing, dryDistance, length, steps, end: point(dryDistance + length + .25), endY, innerStart };
}

// Boundary faces of the joined paved volume. Coincident transverse faces are
// internal only where both neighbouring slabs contain the same height interval.
// Different terrain bases can leave an exposed lower face as well as a riser.
export function approachSideFaces(slabs, bases) {
  const same = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]) < 1e-8;
  const faces = [];
  for (let i=0;i<slabs.length;i++) for(let edge=0;edge<4;edge++) {
    const s=slabs[i],a=s.ring[edge],b=s.ring[(edge+1)%4];
    let neighbour=null;
    for(const j of [i-1,i+1]) {
      const q=slabs[j];if(!q)continue;
      for(let k=0;k<4;k++)if(same(a,q.ring[(k+1)%4])&&same(b,q.ring[k]))neighbour=j;
    }
    const lo=bases[i],hi=s.y;
    const emit=(bottom,top)=>{if(top>bottom+1e-10)faces.push({slab:i,edge,a,b,lo:bottom,hi:top});};
    if(neighbour===null||slabs[neighbour].y<=lo||bases[neighbour]>=hi)emit(lo,hi);
    else {emit(lo,Math.min(hi,bases[neighbour]));emit(Math.max(lo,slabs[neighbour].y),hi);}
  }
  return faces;
}
