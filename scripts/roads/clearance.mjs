// Clipping creates new stored X/Z points. Quantising them can move the point
// up a shallow bank by a few millimetres. Recheck the final stored coordinate,
// keeping the existing nominal 0.30 canonical lift and its .025 Y quantum.
// This final buffer pass is also runnable over an existing bake for diagnostics.
export function repairRoadClearance(raw,{inRegion,support,lift=.30}={}) {
  const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),n=v.getUint32(4,true),bridge=!!v.getUint32(20,true),float=!!(v.getUint32(28,true)&2);
  const ox=v.getInt32(12,true),oz=v.getInt32(16,true),stride=float?12:6;
  const get=(i,k)=>float?v.getFloat32(32+i*stride+k*4,true):v.getUint16(32+i*stride+k*2,true);
  const put=(i,k,value)=>float?v.setFloat32(32+i*stride+k*4,value,true):v.setUint16(32+i*stride+k*2,value,true);
  const wide=!!(v.getUint32(28,true)&8),pad=wide?(4-(32+n*(stride+3)+(bridge?n*2:0))%4)%4:n%2;
  const riseAt=32+n*(stride+3)+pad;let repaired=0,maxRaise=0;
  for(let i=0;i<n;i++){
    const x=ox+get(i,0)/8,z=oz+get(i,2)/8;if(!inRegion(x,z))continue;
    const base=support(x,z),y=get(i,1)*.05-500;if(y>=base+lift-.025)continue;
    const next=float?Math.fround((base+lift+500)*20):Math.ceil((base+lift+500)*20);
    const stored=next*.05-500;put(i,1,next);
    // The bridge's base must remain on the same support at every Master.
    if(bridge){const old=v.getInt16(riseAt+i*2,true);if(old>0)v.setInt16(riseAt+i*2,Math.max(0,Math.floor((stored-lift-base)/.05)),true);}
    repaired++;maxRaise=Math.max(maxRaise,stored-y);
  }
  return {repaired,maxRaise};
}
