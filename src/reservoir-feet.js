// D-064: source subset of public/data/deep-water.json, retaining EA citations.
// The bank itself supplies the fine slope. Lower the coarse DEM below it and
// one cell diagonal beyond its foot, then ease back over 400 m. These widths
// are rendering estimates for the 137 m terrain grid, not survey dimensions.
import DATA from './reservoir-foot-data.json' with { type: 'json' };
import { inRing } from './water-body-geometry.js';
export const RESERVOIR_FEET = DATA.map(s => ({ ...s,
  reach: s.bank.freeboardM * 3 + 4 + s.bank.heightM * 3 + 200,
  minX: Math.min(...s.ring.map(p=>p[0]))-700, maxX: Math.max(...s.ring.map(p=>p[0]))+700,
  minZ: Math.min(...s.ring.map(p=>p[1]))-700, maxZ: Math.max(...s.ring.map(p=>p[1]))+700,
}));
export function inReservoirFootRegion(x,z) {
  // A modified vertex also influences the adjoining unmodified grid cell.
  for(const s of RESERVOIR_FEET)if(x>=s.minX-200&&x<=s.maxX+200&&z>=s.minZ-200&&z<=s.maxZ+200)return true;
  return false;
}
export function correctedReservoirElevation(x,z,elevation) {
  let y=elevation;
  for(const s of RESERVOIR_FEET) {
    if(x<s.minX||x>s.maxX||z<s.minZ||z>s.maxZ)continue;
    let d=0;
    if(!inRing(x,z,s.ring)) {
      d=Infinity;
      for(let i=0;i<s.ring.length;i++) {
        const a=s.ring[i],b=s.ring[(i+1)%s.ring.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
        d=Math.min(d,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
      }
    }
    const t=Math.max(0,Math.min(1,(d-s.reach)/400)),blend=t*t*(3-2*t);
    // Staines North and South share a divider. The later (North) plateau
    // joins the higher recorded floodplain there; their separate outer feet
    // still reach each reservoir's recorded ground.
    if(blend<1)y=Math.min(elevation,s.bank.groundAodM+(y-s.bank.groundAodM)*blend);
  }
  return y;
}
