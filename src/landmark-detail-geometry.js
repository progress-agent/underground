import * as THREE from 'three';

// Dimensions from RSHP/TensiNet and UK Parliament; reference record in
// docs/landmark-refinement.md. Small decorative repeats are illustrative.
export function millenniumDome(a,b,info){
 const cx=info.mastCentreXZ[0]-b.x,cz=info.mastCentreXZ[1]-b.z;
 const radius=160,edge=5,rise=45,sphere=(radius*radius+rise*rise)/(2*rise);
 const roofY=r=>edge+Math.sqrt(sphere*sphere-r*r)-(sphere-rise);
 a.frame(cx,cz,0,()=>{
  a.cyl(radius,edge,0,0,0,'fabric',radius,96);
  const profile=[];
  for(let i=32;i>=0;i--){const r=radius*i/32;profile.push(new THREE.Vector2(r,roofY(r)));}
  a.add(new THREE.LatheGeometry(profile,96),'fabric');
  // Radial seams follow the cap, rather than straight bars intersecting it.
  for(let i=0;i<48;i++){
   const t=i/48*Math.PI*2;let prev;
   for(let j=1;j<=24;j++){
    const r=radius*j/24,p=[Math.cos(t)*r,roofY(r)+.13,Math.sin(t)*r];
    if(prev)a.rod(prev,p,.085,'seam');prev=p;
   }
  }
  const ring=new THREE.TorusGeometry(15,.16,5,64);ring.rotateX(-Math.PI/2);a.add(ring,'seam',0,50.1,0);
  for(const mast of info.masts){
   const x=mast.x-info.mastCentreXZ[0],z=mast.z-info.mastCentreXZ[1],t=Math.atan2(z,x);
   const radial=new THREE.Vector3(Math.cos(t),0,Math.sin(t)),across=new THREE.Vector3(-Math.sin(t),0,Math.cos(t));
   // Masts lean outwards. Three slender chords form the open tapered lattice.
   const at=(y,k)=>{
    const width=.35+1.1*Math.sin(Math.PI*y/100),angle=k/3*Math.PI*2;
    return new THREE.Vector3(x,y,z).addScaledVector(radial,y*.12+Math.cos(angle)*width).addScaledVector(across,Math.sin(angle)*width).toArray();
   };
   for(let k=0;k<3;k++){
    for(let y=0;y<100;y+=5){
     a.rod(at(y,k),at(y+5,k),.18,'mast');
     a.rod(at(y,k),at(y+5,(k+1)%3),.085,'mast');
     a.rod(at(y,k),at(y,(k+1)%3),.085,'mast');
    }
   }
   const head=[x+radial.x*11.4,95,z+radial.z*11.4];
   for(const off of [-.22,-.11,0,.11,.22]){
    const angle=t+off;
    for(const r of [37,78,153])a.rod(head,[Math.cos(angle)*r,roofY(r)+.25,Math.sin(angle)*r],.1,'cable');
   }
  }
 });
}

function pointedWindow(width,height){
 const shape=new THREE.Shape();shape.moveTo(-width/2,0);shape.lineTo(width/2,0);shape.lineTo(width/2,height*.72);
 shape.quadraticCurveTo(width*.4,height*.9,0,height);shape.quadraticCurveTo(-width*.4,height*.9,-width/2,height*.72);shape.closePath();
 return new THREE.ShapeGeometry(shape,4);
}
function roof(width,depth,height,topWidth=0,topDepth=topWidth*depth/width){
 const bottom=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
 const positions=[];
 for(let i=0;i<4;i++){
  const p=bottom[i],q=bottom[(i+1)%4],s=topWidth/width;
  const a=[p[0],0,p[1]],b=[q[0],0,q[1]],c=[q[0]*s,height,q[1]*topDepth/depth],d=[p[0]*s,height,p[1]*topDepth/depth];
  positions.push(...a,...d,...b,...b,...d,...c);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
function pinnacle(a,x,y,z,height=6,r=.7){
 a.cyl(r,height*.45,x,y,z,'limestone',r,8);
 a.cyl(r*1.2,height*.55,x,y+height*.45,z,'limestone',.04,8);
}
function window(a,x,y,z,w,h,ornate=false){
 a.add(pointedWindow(w,h),'window',x,y,z);
 a.box(.14,h*.82,.15,x,y,z+.12,'limestone');
 a.box(w+.25,.24,.22,x,y-.12,z+.08,'limestone');
 if(ornate){a.rod([x-w/2,y+h*.72,z+.1],[x,y+h,z+.1],.09,'limestone');a.rod([x,y+h,z+.1],[x+w/2,y+h*.72,z+.1],.09,'limestone');}
}
let clockMaterial;
function clockFace(){
 if(clockMaterial)return clockMaterial;
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const c=canvas.getContext('2d');
 c.fillStyle='#eaf0ee';c.beginPath();c.arc(256,256,250,0,Math.PI*2);c.fill();
 c.strokeStyle='#254e75';c.lineWidth=8;
 for(const r of [244,215,161]){c.beginPath();c.arc(256,256,r,0,Math.PI*2);c.stroke();}
 for(let i=0;i<60;i++){const t=i/60*Math.PI*2;c.lineWidth=i%5?2:5;c.beginPath();c.moveTo(256+Math.sin(t)*220,256-Math.cos(t)*220);c.lineTo(256+Math.sin(t)*239,256-Math.cos(t)*239);c.stroke();}
 const roman=['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
 c.fillStyle='#254e75';c.font='bold 43px Georgia';c.textAlign='center';c.textBaseline='middle';
 for(let i=0;i<12;i++){const t=i/12*Math.PI*2;c.save();c.translate(256+Math.sin(t)*188,256-Math.cos(t)*188);c.rotate(t);c.fillText(roman[i],0,0);c.restore();}
 // An illustrative clock reading, not a live London time display.
 for(const [angle,length,width] of [[Math.PI/3,155,10],[-Math.PI/3,110,14]]){c.save();c.translate(256,256);c.rotate(angle);c.fillRect(-width/2,-length,width,length+22);c.restore();}
 c.beginPath();c.arc(256,256,13,0,Math.PI*2);c.fill();
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 clockMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:.8,metalness:0});return clockMaterial;
}

function elizabeth(a){
 // 12m shaft; dial centres ~56m; belfry above, then the double-stage roof.
 a.box(12,49,12,0,0,0,'limestone');
 for(let y=8;y<=48;y+=9)a.box(12.45,.55,12.45,0,y,0,'limestone');
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
  for(const x of [-4.5,-1.5,1.5,4.5])for(const y of [9,19,29,39])window(a,x,y,6.03,.62,6.5);
 });
 for(const x of [-5.65,5.65])for(const z of [-5.65,5.65]){a.box(.85,63,.85,x,0,z,'limestone');pinnacle(a,x,63,z,6,.45);}
 a.box(12.8,12,12.8,0,49,0,'limestone');a.box(13.5,.8,13.5,0,49,0,'gold');a.box(13.5,.8,13.5,0,60,0,'gold');
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
  a.box(9.4,9.4,.15,0,51.2,6.44,'gold');
  const g=new THREE.CircleGeometry(3.5,64);a.mesh(g,clockFace(),0,56,6.56,'landmark-clock');
  const rim=new THREE.TorusGeometry(3.63,.12,6,64);a.add(rim,'gold',0,56,6.61);
  for(const x of [-5,5])for(let y=50;y<61;y+=1.6)a.box(.2,.4,.15,x,y,6.58,'gold');
 });
 a.box(11.9,4.5,11.9,0,61,0,'limestone');
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
  for(const x of [-4.1,-1.4,1.4,4.1])window(a,x,61.4,5.99,1.65,3.5,true);
 });
 a.box(12.6,.5,12.6,0,65.5,0,'gold');a.add(roof(12,12,6.5,6),'slate',0,66,0);
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
  for(const x of [-3,0,3]){a.add(pointedWindow(.7,1.5),'window',x,67.4,5.15);pinnacle(a,x,66,6,1.7,.2);}
 });
 a.box(6,4,6,0,72.5,0,'gold');
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
  for(const x of [-2.1,-.7,.7,2.1])window(a,x,72.8,3.04,.8,3.2,true);
 });
 a.box(6.5,.35,6.5,0,76.5,0,'gold');
 a.add(roof(6,6,5.2,3),'slate',0,76.8,0);a.add(roof(3,3,9),'slate',0,82,0);
 for(const x of [-3,3])for(const z of [-3,3]){
  a.rod([x,76.8,z],[x/2,82,z/2],.07,'gold');a.rod([x/2,82,z/2],[0,91,0],.07,'gold');
 }
 a.rod([0,91,0],[0,96.3,0],.13,'gold');a.rod([-.65,95.8,0],[.65,95.8,0],.1,'gold');
}

export function palaceDetails(a,ring,b,info,outline){
 a.add(outline(ring,24),'limestone');
 const sign=Math.sign(THREE.ShapeUtils.area(ring.map(p=>new THREE.Vector2(...p))));
 for(let i=0;i<ring.length;i++){
  const p=ring[i],q=ring[(i+1)%ring.length],dx=q[0]-p[0],dz=q[1]-p[1],length=Math.hypot(dx,dz);
  if(length<2.3)continue;
  const nx=dz/length*sign,nz=-dx/length*sign,yaw=Math.atan2(nx,nz),count=Math.max(1,Math.floor(length/4));
  for(let j=0;j<count;j++){
   const t=(j+.5)/count,x=p[0]+dx*t+nx*.1,z=p[1]+dz*t+nz*.1;
   a.frame(x,z,yaw,()=>{
    const bay=length/count;
    window(a,0,3.5,0,Math.min(1.9,bay*.62),5.2,true);window(a,0,10.2,0,Math.min(2.25,bay*.7),8.6,true);
    a.box(.4,23,.6,length/count*.45,0,0,'limestone');pinnacle(a,length/count*.45,24,0,5.4,.4);
    a.box(4,.45,.5,0,21,0,'limestone');
   });
  }
 }
 // Consolidate the densely traced buttresses into continuous roof ranges.
 const roofRing=ring.filter((p,i)=>i===0 || Math.hypot(p[0]-ring[i-1][0],p[1]-ring[i-1][1])>0);
 const simplified=[];
 for(let i=0;i<roofRing.length;){
  const p=roofRing[i];simplified.push(p);let j=i+1;
  while(j<roofRing.length && Math.hypot(roofRing[j][0]-p[0],roofRing[j][1]-p[1])<18)j++;
  i=j;
 }
 for(let i=0;i<simplified.length;i++){
  const p=simplified[i],q=simplified[(i+1)%simplified.length],dx=q[0]-p[0],dz=q[1]-p[1],length=Math.hypot(dx,dz);
  if(length<12)continue;
  a.frame((p[0]+q[0])/2,(p[1]+q[1])/2,Math.atan2(-dz,dx),()=>{
   a.add(roof(length,10,6,length*.9,0),'slate',0,24,sign*5);
  });
 }
 const [et,vt]=info.towers;
 a.frame(et.centreXZ[0]-b.x,et.centreXZ[1]-b.z,-5*Math.PI/180,()=>elizabeth(a));
 a.frame(vt.centreXZ[0]-b.x,vt.centreXZ[1]-b.z,-5.65*Math.PI/180,()=>{
  a.box(23,84,23,0,0,0,'limestone');
  for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])a.frame(0,0,yaw,()=>{
   for(const x of [-7,-2.3,2.3,7])for(let y=25;y<77;y+=12)window(a,x,y,11.56,2,8,true);
   for(const x of [-10,-5,0,5,10])a.box(.55,80,.6,x,4,11.5,'limestone');
   for(let x=-10;x<=10;x+=4)a.box(2,3,1.2,x,85,11.8,'limestone');
  });
  for(const y of [20,43,66,83])a.box(24,.9,24,0,y,0,'limestone');
  for(const x of [-10.5,10.5])for(const z of [-10.5,10.5]){a.box(3.1,88,3.1,x,0,z,'limestone');pinnacle(a,x,88,z,10.5,1.25);}
  a.box(23,2,23,0,83,0,'slate');a.rod([0,85,0],[0,120,0],.14,'gold');
 });
 // Central Lobby's octagonal ventilation tower, the third skyline anchor.
 a.frame(236.23-b.x,885.68-b.z,Math.PI/8,()=>{
  a.cyl(11.2,31,0,0,0,'limestone',11.2,8);
  a.cyl(11.5,13,0,31,0,'slate',5.6,8);a.cyl(5.6,17,0,44,0,'limestone',5.6,8);
  for(let i=0;i<8;i++){const t=i/8*Math.PI*2;a.frame(Math.sin(t)*5.65,Math.cos(t)*5.65,t,()=>window(a,0,46,0,2.1,12,true));}
  a.cyl(6,29,0,61,0,'slate',.08,8);a.rod([0,90,0],[0,91.4,0],.15,'gold');
 });
}
