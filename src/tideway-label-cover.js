import * as THREE from 'three';
import { displayedNdc, overlapArea } from './player/label-cover.js';

/** DOM names must not paint over a nearer vent. Project just the column
 * bounds, never the entire platform, so ordinary views retain their names. */
export function createTidewayLabelCover({getGroup,getFrame,distortNdc=(x,y)=>({x,y})}) {
  let frame=-1;const rectangles=[],point=new THREE.Vector3();
  return (rect,camera,info)=>{
    if(!info)return false;
    const current=getFrame();
    if(current!==frame) {
      frame=current;rectangles.length=0;
      const group=getGroup();
      if(!group?.visible)return false;
      for(const site of group?.userData.registry.values()??[])for(const c of site.columns) {
        const sy=site.group.scale.y,base=12+c.baseLocal*sy;
        const distance=Math.hypot(c.x-camera.position.x,base-camera.position.y,c.z-camera.position.z);
        if(distance>250)continue;
        const radius=c.data.diameter*.8+.1,top=base+(c.data.height+.23)*sy;
        let left=Infinity,right=-Infinity,up=Infinity,down=-Infinity,behind=false;
        for(const x of [-radius,radius])for(const z of [-radius,radius])for(const y of [base,top]) {
          point.set(c.x+x,y,c.z+z).project(camera);
          if(point.z>=1||point.z<=-1){behind=true;continue;}
          const p=displayedNdc(point,distortNdc),px=(p.x+1)*info.vw/2,py=(1-p.y)*info.vh/2;
          left=Math.min(left,px);right=Math.max(right,px);up=Math.min(up,py);down=Math.max(down,py);
        }
        if(!behind&&right-left>=1)rectangles.push({x:left-1,y:up-1,w:right-left+2,h:down-up+2,distance});
      }
    }
    if(!rectangles.length)return false;
    const anchorDistance=Math.hypot(info.x-camera.position.x,info.y-camera.position.y,info.z-camera.position.z);
    return rectangles.some(r=>r.distance<anchorDistance&&overlapArea(r,rect)>0);
  };
}
