// Same procedural models and metre lengths as the Thames. Habitat changes
// placement/count only, never animal geometry or Master scaling.
import { createSeaLife, SEA_LIFE_SPECIES } from './sea-life.js';
export function distanceToShore(x,z,ring) {
  let best=Infinity;
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return best;
}
export function habitatFor(body,VE=5) {
  const b=body.bounds;
  let best=null;
  // Largest inscribed safe circle. This also handles concave docks whose
  // arithmetic centroid can be on a quay. Source outline, not its AABB.
  const step=Math.max(12,Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/40);
  for(let x=b.minX+step/2;x<b.maxX;x+=step)for(let z=b.minZ+step/2;z<b.maxZ;z+=step) {
    if(!body.containsXZ(x,z))continue;
    const radius=distanceToShore(x,z,body.original);
    const bed=body.bedAt(x,z);if(bed==null||(body.waterY-bed)/VE<7.0)continue;
    if(!best||radius>best.radius)best={x,z,radius};
  }
  if(!best||best.radius<38)return null;
  // Every anchor/path/shoal plus its largest horizontal extent fits within
  // this circle. No clipping or teleporting an animal at a bank.
  const travel=Math.max(2,Math.min(80,(best.radius-32)*0.55));
  const frame={
    at(S,l=0) { const x=best.x+Math.max(-travel,Math.min(travel,S)),z=best.z+l*travel;return {x,z,tx:1,tz:0,hw:travel,bed:body.bedAt(x,z)??body.bedY}; },
    nearestS(x) { return x-best.x; },
  };
  return {frame,anchor:best,travel,species(base) {
    // One representative of each species and a small shoal, rather than
    // copying four separate Thames schools into every reservoir.
    if(base.school&&base.id!=='silver-school')return null;
    const i=SEA_LIFE_SPECIES.indexOf(base),s={...base,S0:(i%3-1)*travel*0.2};
    if(s.path)s.path={...s.path,A:travel*0.45,L:0.28,l0:0,fA:0.08};
    if(s.count)s.count=s.school?24:s.id==='jellyfish'?3:1;
    if(s.school)s.school={...s.school,radius:4,flatten:0.35};
    return s;
  }};
}
export function createLakeSeaLife(body,VE=5) {
  const habitat=habitatFor(body,VE);if(!habitat)return null;
  const life=createSeaLife({habitat,navigation:body,VE,topY:body.waterY});
  life.group.name=`lake-sea-life:${body.spec.id}`;life.habitat=habitat;return life;
}
