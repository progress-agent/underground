import { RESERVOIR_FEET, inReservoirFootRegion } from './reservoir-feet.js';

let banks=[],activeWater=null;
/** Generic map boxes on a dry bank stand on the same triangles as the walker.
 * The terrain below the bank is deliberately lower than its grass surface. */
export function reservoirBuildingBase(x,z,base) {
  if(!banks.length||!Number.isFinite(base)||!inReservoirFootRegion(x,z))return base;
  for(const b of banks) {
    if(x<b.bounds.minX-100||x>b.bounds.maxX+100||z<b.bounds.minZ-100||z>b.bounds.maxZ+100)continue;
    // Compartments can share a dry divider. Use the highest actual support
    // from the same shared query as navigation, including its neighbour.
    const bank=activeWater.groundAt(x,z);
    if(bank!=null)base=Math.max(base,bank);
  }
  return base;
}

/** Banks arrive after the baked city. Re-anchor existing boxes once; both
 * building decoders also call the same base function for later arrivals. */
export function anchorReservoirBuildings(water,group,retained=[],invalidate=()=>{}) {
  activeWater=water;
  const ids=new Set(RESERVOIR_FEET.map(b=>b.id));
  banks=water.bodies.filter(b=>ids.has(b.spec.id));
  const changed=[];
  const visit=mesh=>{
    if(!mesh.isInstancedMesh||!/^(baked-)?buildings-/.test(mesh.name))return;
    const box=mesh.boundingBox;
    if(box&&!banks.some(b=>box.max.x>=b.bounds.minX&&box.min.x<=b.bounds.maxX&&box.max.z>=b.bounds.minZ&&box.min.z<=b.bounds.maxZ))return;
    const a=mesh.instanceMatrix.array;let touched=false;
    for(let i=0;i<mesh.count;i++) {
      const j=i*16,x=a[j+12],z=a[j+14],before=a[j+13],after=reservoirBuildingBase(x,z,before);
      if(after-before>.01) {a[j+13]=after;touched=true;changed.push({x,z,before,after});}
    }
    if(touched){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();invalidate(mesh);}
  };
  group?.traverse(visit);
  // An early switch to live detaches, but retains, the baked city. It must
  // already have correct bases when the user switches back later.
  for(const mesh of retained)if(!mesh.parent)visit(mesh);
  return changed;
}
