// Permanent Tideway public realm, D-060. All dimensions and uncertainty are
// recorded in tideway-platforms.json and docs/tideway-platform-research.md.
// Local source coordinates are east/north metres. No source images are shipped.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import DATA from './tideway-platforms.json' with { type: 'json' };
import { bindTrueProportion, structureYScale, onMasterChange } from './true-proportion.js';
import { WATER_TOP_Y } from './thames.js';
import { pointInRing } from './station-building-geometry.js';
import { isInThames } from './thames-mask.js';
import { approachFrame, approachPlan, approachSideFaces } from './tideway-approaches.js';
export const TIDEWAY_PLATFORM_DATA = DATA;
export const FORESHORE_SITE_IDS = new Set(DATA.sites.map(s => s.siteId));
// The researched Chambers operational area is cleared land. One legacy map box
// covers its shaft paving. Match record centres, as the station replacements do,
// and keep every neighbouring building outside that small permanent-works area.
const exclusionCache=new WeakMap();
export function createTidewayBuildingExclusion(project) {
  if(exclusionCache.has(project))return exclusionCache.get(project);
  const data=DATA.sites.find(s=>s.id==='chambers'),p=project(...data.anchor),a=project(...data.riverWall[0]),b=project(...data.riverWall[1]);
  const dx=b.x-a.x,dz=b.z-a.z,sign=Math.sign(dx*(p.z-a.z)-dz*(p.x-a.x));
  const apron=[[18,-12.5],[36,-12.5],[36,12.5],[18,12.5]];
  const excludes=record=>{
    const x=record.x??record.cx,z=record.z??record.cz;
    if(x<p.x-20||x>p.x+36||z<p.z-15||z>p.z+15)return false;
    if(sign*(dx*(z-a.z)-dz*(x-a.x))<0)return false;
    return pointInRing(x-p.x,p.z-z,data.outline)||pointInRing(x-p.x,p.z-z,apron);
  };
  exclusionCache.set(project,excludes);return excludes;
}
const colors = { granite: '#a4a49c', buff: '#b4ad95', concrete: '#b1b1a5', brick: '#66504a', rail: '#343635', wood: '#71604a', bronze: '#79613e', green: '#668348' };
const datum = WATER_TOP_Y / 5;
function rect(x,z,w,d) { return [[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]; }
function circle(x,z,r,n=20) { return Array.from({length:n},(_,i)=>[x+Math.cos(i/n*Math.PI*2)*r,z+Math.sin(i/n*Math.PI*2)*r]); }
function geometryColor(g,c) {
  const v = new THREE.Color(c), a = new Float32Array(g.attributes.position.count*3);
  for(let i=0;i<a.length;i+=3) { a[i]=v.r; a[i+1]=v.g; a[i+2]=v.b; }
  g.setAttribute('color',new THREE.BufferAttribute(a,3)); return g;
}
function polygon(ring,y) {
  const shape=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,z)));
  const g=new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI/2); g.translate(0,y,0); return g;
}
// Flared asymmetric cross-section, twisting ridge and an oblique top, rather than a plain pipe.
export function ventGeometry(h,d,plain=false) {
  const n=24,m=16,vs=[],idx=[];
  for(let j=0;j<=m;j++) for(let i=0;i<=n;i++) {
    const t=j/m,a=i/n*Math.PI*2,tw=t*1.65;
    const ridge=plain?0:Math.pow(Math.max(0,Math.cos(a-tw)),16)*.09*t;
    const r=d/2*(1+(plain?0:.3)*t)+ridge;
    vs.push(Math.cos(a)*r,h*t+(plain?0:.22*Math.cos(a)*t*t),Math.sin(a)*r*(plain?1:1-.1*t));
    if(j<m&&i<n) {const k=j*(n+1)+i;idx.push(k,k+n+1,k+1,k+1,k+n+1,k+n+2);}
  }
  if(!plain){const center=vs.length/3;vs.push(0,h,0);for(let i=0;i<n;i++)idx.push(center,m*(n+1)+i+1,m*(n+1)+i);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vs,3));g.setIndex(idx);g.computeVertexNormals();
  // Top cut has a dark closed face. The shaft itself stays open below ground.
  return g;
}
export function* createTidewayPlatformsSteps({llToXZ,floorAt,VE=5,isDryLand=(x,z)=>!isInThames(x,z)&&floorAt(x,z)>WATER_TOP_Y}) {
  const group=new THREE.Group();group.name='tideway-platforms';
  const registry=new Map(),solidRecords=[];
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,metalness:.08,side:THREE.DoubleSide});
  let version=0;
  for(const data of DATA.sites) {
    const p=llToXZ(...data.anchor),root=new THREE.Group();root.name=`tideway-platform-${data.id}`;root.position.set(p.x,WATER_TOP_Y,p.z);bindTrueProportion(root);group.add(root);
    const parts=[],walls=[],solids=[],deck=data.deckAOD-datum;
    const rec={data,group:root,anchor:p,deckY:0,columns:[],solids,wallSamples:[],deckRing:data.outline.map(([x,z])=>[p.x+x,p.z-z])};registry.set(data.id,rec);
    function clipOperationalArea(ring) {
      if(!data.riverWall)return ring;
      const wa=llToXZ(...data.riverWall[0]),wb=llToXZ(...data.riverWall[1]),a=[wa.x-p.x,p.z-wa.z],b=[wb.x-p.x,p.z-wb.z];
      const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),origin=dx*(-a[1])-dz*(-a[0]),sign=Math.sign(origin);
      const d=q=>sign*(dx*(q[1]-a[1])-dz*(q[0]-a[0]))-.5*len;
      const out=[];for(let i=0;i<ring.length;i++){const q=ring[i],v=ring[(i+1)%ring.length],dq=d(q),dv=d(v);if(dq>=0)out.push(q);if((dq>=0)!==(dv>=0)){const t=dq/(dq-dv);out.push([q[0]+(v[0]-q[0])*t,q[1]+(v[1]-q[1])*t]);}}
      return out;
    }
    function add(g,c) {parts.push(geometryColor(g,c));}
    function solid(ring,lo,hi,kind='feature') {solids.push({ring:ring.map(([x,z])=>[p.x+x,p.z-z]),lo,hi,kind});}
    function box(x,z,w,d,h,y,c,collision=true) {
      const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y+h/2,-z);add(g,c);
      if(collision)solid(rect(x,z,w,d),y,y+h);return g;
    }
    function cylinder(x,z,r,h,y,c,n=16,collision=true) {
      const g=new THREE.CylinderGeometry(r,r,h,n);g.translate(x,y+h/2,-z);add(g,c);
      if(collision)solid(circle(x,z,r),y,y+h);
    }
    function line(a,b,y,r,c) {
      const v=new THREE.Vector3(b[0]-a[0],0,-b[1]+a[1]);const g=new THREE.CylinderGeometry(r,r,v.length(),5);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize()));g.translate((a[0]+b[0])/2,y,-(a[1]+b[1])/2);add(g,c);
    }
    function railing(a,b,y,height=1.1,spacing=.18) {
      const railColor=['putney','albert-isle'].includes(data.id)?'#9ca19d':colors.rail;
      const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/spacing);
      line(a,b,y+height,.035,railColor);line(a,b,y+.12,.025,railColor);
      for(let i=0;i<=n;i++) {const t=i/n;box(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.035,.035,height,y,railColor,false);}
    }
    function slab(ring,y,c) {add(polygon(ring,y),c);solid(ring,y-.28,y,'deck');}
    function wall(a,b,y,c,rail=true) {
      const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/1.5),points=[];
      for(let i=0;i<=n;i++) {const t=i/n;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
      walls.push({points,top:y,color:c});
      if(rail) {
        // The Heathwall east entrance opens through this railing, beside the
        // compound, rather than through the security screen at the back.
        const access=data.outline[data.accessEdge]===a?approachFrame(data):null;
        if(access){
          const t=data.approach.edgeFraction,dt=(data.approach.widthM/2+.15)/len;
          const at=v=>[a[0]+(b[0]-a[0])*v,a[1]+(b[1]-a[1])*v];
          if(t>dt)railing(a,at(t-dt),y+(data.parapet||0));
          if(t+dt<1)railing(at(t+dt),b,y+(data.parapet||0));
        }else railing(a,b,y+(data.parapet||0));
      }
      if(data.parapet) {const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l*.2,nz=dx/l*.2;
        slab([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],y+data.parapet,c);
        const panel=new THREE.BoxGeometry(len,data.parapet,.4);panel.rotateY(Math.atan2(dz,dx));panel.translate((a[0]+b[0])/2,y+data.parapet/2,-(a[1]+b[1])/2);add(panel,c);solid([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],y,y+data.parapet);}
      if(data.fenders)for(let i=1;i<n;i+=2){
        const q=points[i];box(q[0],q[1],.2,.22,3.2,y-3.3,colors.wood,false);
        if(i>1){const prev=points[i-2],mid=[(prev[0]+q[0])/2,(prev[1]+q[1])/2];const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(prev[0],y-.7,-prev[1]),new THREE.Vector3(mid[0],y-1.05,-mid[1]),new THREE.Vector3(q[0],y-.7,-q[1])]);add(new THREE.TubeGeometry(curve,8,.025,4,false),colors.rail);}
        if(data.id==='blackfriars'&&i%4===1){const ring=new THREE.TorusGeometry(.16,.025,5,12);ring.rotateY(Math.atan2(b[0]-a[0],b[1]-a[1])+Math.PI/2);ring.translate(q[0],y-.55,-q[1]);add(ring,colors.bronze);}
      }
    }
    // Recess the top deck at floodable edges: a full-height polygon underneath
    // would otherwise hide the lower walkway and every terrace from above.
    const core=clipOperationalArea(data.outline.map(q=>q.slice()));
    const outwardTerraces=data.id==='albert-isle'||data.id==='chelsea';
    if(data.terraces&&!outwardTerraces) {
      const inset=data.terraces.length*1.05;
      for(let k=0;k<core.length;k++) {
        let sx=0,sz=0,n=0;
        for(const i of [(k+core.length-1)%core.length,k])if(data.riverEdges.includes(i)) {
          const a=data.outline[i],b=data.outline[(i+1)%core.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);let nx=-dz/l,nz=dx/l;
          if(pointInRing((a[0]+b[0])/2+nx*.1,(a[1]+b[1])/2+nz*.1,data.outline)){nx=-nx;nz=-nz;}
          sx+=nx;sz+=nz;n++;
        }
        if(n){core[k][0]-=sx/n*inset;core[k][1]-=sz/n*inset;}
      }
    }
    if(data.id==='victoria') {
      const i=data.outline.length-1,a=data.outline[i],b=data.outline[0],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      let nx=-dz/len,nz=dx/len;
      if(!pointInRing((a[0]+b[0])/2+nx*.2,(a[1]+b[1])/2+nz*.2,data.outline)){nx=-nx;nz=-nz;}
      const width=6,aa=[a[0]+nx*width,a[1]+nz*width],bb=[b[0]+nx*width,b[1]+nz*width];
      core[i]=aa;core[0]=bb;slab([a,b,bb,aa],deck-1,colors.granite);
      const mx=(aa[0]+bb[0])/2,mz=(aa[1]+bb[1])/2;
      for(let k=0;k<5;k++) {
        const t=k/5,wx=dx/len*4,wz=dz/len*4,ox=mx+nx*t,oz=mz+nz*t,y=deck-1+(k+1)*.2;
        slab([[ox-wx,oz-wz],[ox+wx,oz+wz],[ox+wx+nx*.22,oz+wz+nz*.22],[ox-wx+nx*.22,oz-wz+nz*.22]],y,colors.granite);
      }
    }
    const paving=data.id==='kemp'?'#c5b581':colors[data.wall];
    slab(core,deck,paving);
    // Broken courses of paving, deterministic and clipped to the sourced outline.
    const xs=data.outline.map(q=>q[0]),zs=data.outline.map(q=>q[1]);
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    const tile=data.wall==='brick'?.8:1.5;
    for(let z=z0;data.id!=='kemp'&&z<z1;z+=tile*.6)for(let x=x0;x<x1;x+=tile){
      const ring=rect(x+(((Math.round(z/tile)*17)%3)*.2),z,tile-.025,tile*.6-.025);
      if(ring.every(([a,b])=>pointInRing(a,b,core))) {
        const c=new THREE.Color(paving);c.multiplyScalar(.83+.26*((Math.sin(x*27+z*13)+1)/2));add(polygon(ring,deck+.007),c);
      }
    }
    for(const i of data.riverEdges)wall(data.outline[i],data.outline[(i+1)%data.outline.length],data.terraces&&!outwardTerraces?Math.min(...data.terraces)-datum:deck,colors[data.wall]);
    // Flush recessed paving-infill covers with a thin steel frame, never a bed disc.
    const count=data.hatches||9,sz=data.hatches?1.2:1.6;
    for(let i=0;i<count;i++) {
      const [cx,cz]=data.shaft;const n=Math.ceil(Math.sqrt(count)),x=cx+(i%n-(n-1)/2)*(sz+.25),z=cz+(Math.floor(i/n)-(n-1)/2)*(sz+.25);
      if(!pointInRing(x,z,data.outline))continue;
      add(polygon(rect(x,z,sz,sz),deck+.014),'#5c615e');add(polygon(rect(x,z,sz-.06,sz-.06),deck+.018),paving);
    }
    if(data.bronzeRing) {const r=data.bronzeRing/2,g=new THREE.RingGeometry(r-.045,r,80);g.rotateX(-Math.PI/2);g.translate(data.shaft[0],deck+.025,-data.shaft[1]);add(g,colors.bronze);}
    for(const c of data.columns) {
      const q=c.latlon?llToXZ(...c.latlon):null,x=q?q.x-p.x:c.x,z=q?p.z-q.z:c.z;
      if(c.onLand) {
        const land=new THREE.Group();land.position.set(p.x+x,floorAt(p.x+x,p.z-z)??data.deckAOD*VE,p.z-z);bindTrueProportion(land);group.add(land);
        const geo=geometryColor(ventGeometry(c.height,c.diameter),c.color);land.add(new THREE.Mesh(geo,mat));
        const ring=circle(x,z,c.diameter*.65);solid(ring,0,c.height+.22,'column');solids[solids.length-1].land=land;
        rec.columns.push({data:c,x:p.x+x,z:p.z-z,get baseLocal(){return(land.position.y-WATER_TOP_Y)/structureYScale();}});
        continue;
      }
      const base=deck;
      const g=ventGeometry(c.height,c.diameter,c.form==='plain');g.translate(x,base,-z);add(g,c.color);
      solid(circle(x,z,c.diameter*.65),base,base+c.height+.22,'column');rec.columns.push({data:c,x:p.x+x,z:p.z-z,baseLocal:base});
    }
    for(const [x,z,w,d,h] of data.kiosks||[]) {
      const base=data.id==='victoria'?deck-1:deck;
      box(x,z,w,d,h,base,data.id==='chambers'?'#424749':data.id==='kemp'?colors.wood:colors[data.wall]);
      box(x,z,w+.2,d+.2,.12,base+h,data.id==='kemp'?colors.green:'#7b8180',false);
      for(let i=0;i<w/.22;i++)box(x-w/2+i*.22,z-d/2-.02,.04,.04,h-.15,base+.05,'#414440',false);
    }
    for(const [x,z] of data.benches||[]){box(x,z,3,.8,.45,deck,colors[data.wall]);box(x,z,3,.72,.09,deck+.45,colors.wood);}
    if(data.screen){const a=data.outline[3],b=data.outline[0];railing(a,b,deck+.4,data.screen[1],.12);wall(a,b,deck+.4,colors.concrete,false);}
    if(data.totem)box(4,0,.6,.3,2.5,deck,colors.rail);
    if(data.drum){const[x,z,d,h]=data.drum;cylinder(x,z,d/2,h,deck,colors.brick);for(let i=0;i<5;i++){const g=new THREE.CylinderGeometry(d/2+.015,d/2+.015,.12,32,1,true);g.translate(x,deck+.2+i*.22,-z);add(g,['#b49355','#638e97','#d0c9b2','#b06d46','#45575a'][i]);}}
    // Stepped bands use the actual outside edges. Each terrace is a deck and solid wall.
    if(data.terraces&&!data.endTerraces)for(let j=0;j<data.terraces.length;j++) {
      const levels=outwardTerraces?data.terraces:[...data.terraces].reverse();
      const y=levels[j]-datum,w=data.id==='albert-isle'?2.5:1.05;
      for(const i of data.riverEdges){
        const a=data.outline[i],b=data.outline[(i+1)%data.outline.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);
        // Inward/outward selected by containment, independent of polygon winding.
        let nx=-dz/l,nz=dx/l;if(pointInRing((a[0]+b[0])/2+nx*.2,(a[1]+b[1])/2+nz*.2,data.outline)){nx=-nx;nz=-nz;}
        const outward=data.id==='albert-isle'||data.id==='chelsea',off=outward?j*w:-(j+1)*w;
        const q=[a[0]+nx*off,a[1]+nz*off],r=[b[0]+nx*off,b[1]+nz*off],s=[b[0]+nx*(off+w),b[1]+nz*(off+w)],t=[a[0]+nx*(off+w),a[1]+nz*(off+w)];
        slab([q,r,s,t],y,data.id==='chelsea'?colors.brick:colors.concrete);wall(s,t,y,colors[data.wall],false);
        if(outward)box((s[0]+t[0])/2,(s[1]+t[1])/2,1,.7,.25,y,colors.green,false);
      }
    }
    if(data.canopy){
      // The source canopy is perforated metal, not an opaque sheet.
      const pixels=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.hypot(x-15.5,y-15.5)<7?0:255;}
      const holes=new THREE.DataTexture(pixels,32,32);holes.wrapS=holes.wrapT=THREE.RepeatWrapping;holes.repeat.set(40,120);holes.needsUpdate=true;
      const roofMat=mat.clone();roofMat.map=holes;roofMat.alphaTest=.5;
      const roofGeo=geometryColor(new THREE.BoxGeometry(8,.12,24),'#242727');roofGeo.translate(-12,deck-1+3.7,0);root.add(new THREE.Mesh(roofGeo,roofMat));
      for(const z of [-11,0,11])for(const x of [-15,-9])box(x,z,.09,.09,3.7,deck-1,colors.rail);
    }
    if(data.sandbags)for(let i=0;i<6;i++)box(5+i%3*.6,-5+Math.floor(i/3)*.45,.7,.5,.3,deck+.2,colors.bronze);
    if(data.bronzeSeats)for(let i=0;i<6;i++){cylinder(-2+i*1.6,7,.4,.45,deck,colors.bronze);cylinder(-2+i*1.6,7.45,.3,.35,deck+.4,colors.bronze);}
    if(data.rotunda){cylinder(-53,0,3.5,3,deck,'#98978b');for(let i=0;i<48;i++){const a=i/48*Math.PI*2;box(-53+3.52*Math.cos(a),3.52*Math.sin(a),.08,.08,3,deck,'#605e54',false);}}
    if(data.id==='blackfriars') {
      // Source: east bridge-approach ramp and metal-panelled undercroft.
      for(let k=0;k<25;k++){const x=48+k*2,h=.12+(k+1)/25*1.3;box(x,4,2,6,h,deck,'#737a77');slab(rect(x,4,2,6),deck+h,colors.granite);}
    }
    if(data.westTerrace)slab(rect(-66,2,14,8),deck+1,colors.granite);
    if(data.stages)for(let i=0;i<5;i++) {const x=-25+i*27,z=-12+i*3,h=[4,6,7,8.8,5][i];box(x,z,i===2?18:3,1.5,h,deck,'#252828');if(i===3){slab(rect(x-2,z+2,8,4),deck+.2,'#6c7777');}}
    if(data.trees)for(let i=0;i<data.trees;i++) {
      const t=(i+.5)/data.trees,x=data.id==='blackfriars'?x0+10+(x1-x0-20)*t: x0+5+(x1-x0-10)*t,z=data.id==='blackfriars'?4+(i%3)*1.8:z1-3;
      cylinder(x,z,.13,3,deck,colors.wood,6);
      const g=new THREE.IcosahedronGeometry(1.6,1);g.scale(1,1.25,1);g.translate(x,deck+3.8,-z);add(g,colors.green);
    }
    if(data.boats)for(let i=0;i<6;i++){const x=-20+i*8,z=-8+i*3;box(x,z,1.2,.7,.65,deck,colors.concrete);const g=new THREE.ConeGeometry(.45,.35,4);g.scale(1.15,1,.4);g.rotateZ(Math.PI);g.translate(x,deck+.9,-z);add(g,colors.bronze);}
    if(data.bandstand){const q=llToXZ(51.508964,-.047448),x=q.x-p.x,z=p.z-q.z;cylinder(x,z,4,.3,deck,colors.concrete,8);for(let i=0;i<8;i++){const a=i/8*Math.PI*2;box(x+3.6*Math.cos(a),z+3.6*Math.sin(a),.12,.12,3,deck,'#40584b');}const g=new THREE.ConeGeometry(4.5,1.4,8);g.translate(x,deck+3.7,-z);add(g,'#4d705c');}
    if(data.mounds)for(let i=0;i<2;i++){const g=new THREE.SphereGeometry(6,16,8,0,Math.PI*2,0,Math.PI/2);g.scale(1,.22,1);g.translate(-15+i*27,deck,-(10+i*8));add(g,colors.green);}
    if(data.dolphins)for(let i=0;i<3;i++){const a=(i/3+.1)*Math.PI, x=Math.cos(a)*21,z=Math.sin(a)*21;cylinder(x,z,.5,4,-1,colors.wood);cylinder(x,z,.52,.6,3,'#cbb14c');if(i)line([Math.cos(((i-1)/3+.1)*Math.PI)*21,Math.sin(((i-1)/3+.1)*Math.PI)*21],[x,z],0,.14,'#cbb14c');}
    if(data.riverWall){
      const aa=llToXZ(...data.riverWall[0]),bb=llToXZ(...data.riverWall[1]),a=[aa.x-p.x,p.z-aa.z],b=[bb.x-p.x,p.z-bb.z],y=data.wallTopAOD-datum;wall(a,b,y,colors.concrete);
      const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=dz/len*1.5,nz=-dx/len*1.5;
      slab([a,b,[b[0]+nx,b[1]+nz],[a[0]+nx,a[1]+nz]],3.85-datum,colors.green);
      // Wall strip is solid from the bed, rather than a river platform.
      solid([a,b,[b[0]+nx*.22,b[1]+nz*.22],[a[0]+nx*.22,a[1]+nz*.22]],-30,y,'wall');
    }
    if(data.waveform){box(33,4,.18,.18,4,deck,'#e1e2dd');line([33,4],[31.8,4],deck+3.9,.09,'#e1e2dd');cylinder(31.8,4,.25,.35,deck+3.4,colors.bronze);}
    if(data.id==='putney') {
      for(const x of [12,15])box(x,0,1.3,.15,.8,deck-3.2,'#202625',false);
      for(let k=0;k<3;k++)line([-9+k*5,15-k*3],[-6+k*5,13-k*3],deck+1.1,.05,colors.bronze);
    }
    if(data.endTerraces) {
      // A joined offset curve wraps each end. Three broad planted shelves
      // total 8 m, independent of the narrow pedestrian floodable walkway.
      rec.endTerraces=[];
      for(const edges of data.endTerraces.edges) {
        const chain=[...edges.map(i=>data.outline[i]),data.outline[(edges.at(-1)+1)%data.outline.length]];
        const normals=edges.map(i=>{const a=data.outline[i],b=data.outline[(i+1)%data.outline.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);let nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l;if(pointInRing((a[0]+b[0])/2+nx*.1,(a[1]+b[1])/2+nz*.1,data.outline)){nx=-nx;nz=-nz;}return[nx,nz];});
        const offset=w=>chain.map((q,i)=>{
          const a=normals[Math.max(0,i-1)],b=normals[Math.min(normals.length-1,i)],den=1+a[0]*b[0]+a[1]*b[1];
          return[q[0]+(a[0]+b[0])/den*w,q[1]+(a[1]+b[1])/den*w];
        });
        const count=data.endTerraces.levelsAOD.length,width=data.endTerraces.widthM/count;
        for(let j=0;j<count;j++) {
          const inner=offset(j*width),outer=offset((j+1)*width),y=data.endTerraces.levelsAOD[j]-datum;
          const ring=[...inner,...outer.toReversed()];slab(ring,y,colors.brick);
          wall(inner[0],outer[0],y,colors.brick,false);
          wall(outer.at(-1),inner.at(-1),y,colors.brick,false);
          const planting=[...offset(j*width+.2),...offset((j+1)*width-.2).toReversed()];add(polygon(planting,y+.025),'#6b7750');
          rec.endTerraces.push({ring:ring.map(([x,z])=>[p.x+x,p.z-z]),levelAOD:y+datum,widthM:width});
          for(let i=0;i<outer.length-1;i++){
            wall(outer[i],outer[i+1],y,colors.brick,false);
            // Low native rush/sedge clumps on the whole bed, rather than a
            // single isolated box on an otherwise bare narrow band.
            const a=inner[i],b=inner[i+1],c=outer[i],d=outer[i+1],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.2);
            for(let k=0;k<n;k++)for(const t of [.3,.7]){
              const f=(k+.5)/n,x=(a[0]+(b[0]-a[0])*f)*(1-t)+(c[0]+(d[0]-c[0])*f)*t,z=(a[1]+(b[1]-a[1])*f)*(1-t)+(c[1]+(d[1]-c[1])*f)*t;
              const g=new THREE.ConeGeometry(.16,.3+(k%3)*.07,4);g.translate(x,y+.15,-z);add(g,k%3===0?'#8c9266':colors.green);
            }
          }
        }
      }
      // Keep a lower walking strip along the central river face.
      for(const i of [10,11,12,13,14]){const a=data.outline[i],b=data.outline[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=dz/l,nz=-dx/l;slab([a,b,[b[0]+nx*1.05,b[1]+nz*1.05],[a[0]+nx*1.05,a[1]+nz*1.05]],4.4-datum,colors.brick);}
    }
    if(data.id==='albert-isle') {
      const ring=new THREE.RingGeometry(7.8,8,64);ring.rotateX(-Math.PI/2);ring.translate(0,deck+.03,0);add(ring,'#515955');
      for(let i=0;i<12;i++)line([-6+i,Math.sin(i*.65)*1.2],[-5+i,Math.sin((i+1)*.65)*1.2],deck+.025,.04,'#515955');
    }
    if(data.id==='kemp')box(26,15,5,4,.10,deck,colors.green,false);
    if(data.id==='kemp')for(const [x,z]of [[-28,-17],[-5,-22],[22,8]]) {
      box(x,z,5,1.5,.35,deck-1.7,colors.concrete,false);box(x,z,4.7,1.3,.18,deck-1.35,colors.green,false);
    }
    if(data.id==='chambers') {
      // The air-treatment plant east of the shaft also has a paved apron.
      slab(clipOperationalArea(rect(27,0,18,25)),deck,colors.concrete);
      add(polygon(circle(4,3,.5,32),deck+.025),colors.bronze);
    }
    // Keep immutable rigid detail; refresh joins it with terrain-following works.
    const buffers=parts.map(g=>{g.deleteAttribute('uv');return g.index?g.toNonIndexed():g;});
    const merged=mergeGeometries(buffers);for(const g of buffers)g.dispose();
    const mesh=new THREE.Mesh(merged,mat);mesh.name=`tideway-detail-${data.id}`;root.add(mesh);for(const g of parts)g.dispose();
    rec.walls=walls;rec.detail=mesh;rec.staticDetailGeometry=merged;
    // The approach shares the site's existing opaque draw. Retain immutable
    // rigid detail so Master changes can replace only the terrain tie-in.
    rec.approachMesh=mesh;
    rec.wallMesh=mesh;
    yield;
  }
  function refresh() {
    solidRecords.length=0;const sy=structureYScale();
    for(const rec of registry.values()) {
      const {data,anchor:p}=rec;rec.deckY=WATER_TOP_Y+(data.deckAOD-datum)*sy;
      const worldFloor=(x,z)=>floorAt(p.x+x,p.z-z);
      rec.approach=approachPlan(data,{floorAt:worldFloor,dryAt:(x,z)=>isDryLand(p.x+x,p.z-z),sy,datum});
      const pieces=[],approachSolids=[],slabs=rec.approach.slabs;
      const bases=slabs.map(s=>Math.min(s.y-.18,...s.ring.map(([x,z])=>(worldFloor(x,z)-WATER_TOP_Y)/sy))-.02);
      for(let i=0;i<slabs.length;i++){
        const s=slabs[i],ring=s.ring.map(([x,z])=>[p.x+x,p.z-z]);
        pieces.push(geometryColor(polygon(s.ring,s.y),colors[data.wall]));
        approachSolids.push({ring,lo:bases[i],hi:s.y,kind:'deck'});
      }
      // Keep the full external boundary, including risers and any exposed
      // lower interval where neighbouring terrain bases differ. Covered faces
      // inside the same paved volume need no submitted triangles.
      const faces=approachSideFaces(slabs,bases);
      for(const {a,b,lo,hi} of faces){
        const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([a[0],hi,-a[1],a[0],lo,-a[1],b[0],lo,-b[1],a[0],hi,-a[1],b[0],lo,-b[1],b[0],hi,-b[1]],3));g.computeVertexNormals();pieces.push(geometryColor(g,colors[data.wall]));
      }
      rec.approachGeometry={bases,faces,originalFaceCount:slabs.length*4};
      const buffers=pieces.map(g=>{g.deleteAttribute('uv');return g.index?g.toNonIndexed():g;});
      const approachGeometry=mergeGeometries(buffers);for(const g of buffers)g.dispose();for(const g of pieces)g.dispose();
      rec.approachSolids=approachSolids;
      const positions=[],cs=[];rec.wallSamples=[];
      for(const w of rec.walls)for(let i=0;i<w.points.length-1;i++) {
        const a=w.points[i],b=w.points[i+1];
        const fa=floorAt(p.x+a[0],p.z-a[1])??WATER_TOP_Y-10,fb=floorAt(p.x+b[0],p.z-b[1])??WATER_TOP_Y-10;
        const ya=Math.min(w.top,(fa-WATER_TOP_Y)/sy)-.06,yb=Math.min(w.top,(fb-WATER_TOP_Y)/sy)-.06;
        positions.push(a[0],w.top,-a[1],a[0],ya,-a[1],b[0],yb,-b[1],a[0],w.top,-a[1],b[0],yb,-b[1],b[0],w.top,-b[1]);
        const c=new THREE.Color(w.color);for(let k=0;k<6;k++)cs.push(c.r,c.g,c.b);
        rec.wallSamples.push({x:p.x+a[0],z:p.z-a[1],bottomY:WATER_TOP_Y+ya*sy,floorY:fa});
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cs,3));g.computeVertexNormals();
      // Same opaque material/transform: render every site's works in one draw.
      // The wall range indexes the real merged buffer, retaining direct checks
      // of its bed-following bottom vertices without a detached test mesh.
      rec.wallVertexRange={start:rec.staticDetailGeometry.attributes.position.count+approachGeometry.attributes.position.count,count:g.attributes.position.count};
      const batched=mergeGeometries([rec.staticDetailGeometry,approachGeometry,g]);
      if(rec.detail.geometry!==rec.staticDetailGeometry)rec.detail.geometry.dispose();
      rec.detail.geometry=batched;approachGeometry.dispose();g.dispose();
      for(const s of [...rec.solids,...approachSolids]){
        const xs=s.ring.map(q=>q[0]),zs=s.ring.map(q=>q[1]);let base=s.land?s.land.position.y:WATER_TOP_Y+s.lo*sy,top=s.land?s.land.position.y+s.hi*sy:WATER_TOP_Y+s.hi*sy;
        if(s.kind==='deck'){base=Math.min(base,...s.ring.map(([x,z])=>floorAt(x,z)??base))-.05;}
        solidRecords.push({ring:s.ring,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),base,h:top-base,skirt:0,absolute:true,key:`tideway:${data.id}:${s.kind}`,deck:s.kind==='deck'});
      }
      rec.group.updateMatrixWorld(true);
      // Entire works, including separate land columns and the terrain tie-in.
      // The checker derives masks from these bounds under W8 erratum 4.
      rec.builtBounds=new THREE.Box3().setFromObject(rec.group);
      for(const s of rec.solids)if(s.land)rec.builtBounds.union(new THREE.Box3().setFromObject(s.land));
    }
    version++;
  }
  refresh();const off=onMasterChange(refresh);
  group.userData={registry,solidRecords,get version(){return version;},refresh,dispose:off};
  return group;
}

export function createTidewayPlatforms(options) { const it=createTidewayPlatformsSteps(options);let v;do {v=it.next();}while(!v.done);return v.value; }
