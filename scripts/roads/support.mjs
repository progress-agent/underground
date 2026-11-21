// Offline intersection of road faces with the actual terrain and dry-bank faces.
// Vertices carry [x, z, signed-across fraction, y]; clipping interpolates all four.
const EPS = 1e-8;
const cross = (a,b,p) => (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const area = p => Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
function split(poly, distance) {
  const ds=poly.map(distance);
  if(Math.min(...ds)>=-EPS)return [poly,[]];
  if(Math.max(...ds)<=EPS)return [[],poly];
  const inside=[],outside=[];
  let a=poly.at(-1),da=distance(a);
  for(const b of poly){const db=distance(b);
    if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){
      const t=da/(da-db),p=a.map((v,k)=>v+(b[k]-v)*t);inside.push(p);outside.push(p);
    }
    if(db>=-EPS)inside.push(b);
    if(db<=EPS)outside.push(b);
    a=b;da=db;
  }
  return [inside,outside].map(p=>p.length>=3&&area(p)>1e-7?p:[]);
}
function cut(poly,face) {
  const outside=[];let inside=poly;
  for(let i=0;i<3&&inside.length;i++){
    const [a,b]=[face.points[i],face.points[(i+1)%3]];
    const [yes,no]=split(inside,p=>cross(a,b,p));
    if(no.length)outside.push(no);inside=yes;
  }
  return {inside,outside};
}
export function supportFace(points) {
  if(cross(points[0],points[1],points[2])<0)points=[points[0],points[2],points[1]];
  const [a,b,c]=points,den=cross(a,b,c);
  if(Math.abs(den)<EPS)return null;
  const dx=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/den;
  const dz=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/den;
  return {points,height:(x,z)=>a[2]+dx*(x-a[0])+dz*(z-a[1]),
    box:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};
}
export function surfaceIndex(meshes,regions,cell=100) {
  const buckets=new Map();
  for(const mesh of meshes){mesh.updateMatrixWorld(true);const a=mesh.geometry.attributes.position,idx=mesh.geometry.index,n=idx?.count??a.count,m=mesh.matrixWorld.elements;
    for(let i=0;i<n;i+=3){const points=[0,1,2].map(k=>{const j=idx?idx.getX(i+k):i+k,x=a.getX(j),y=a.getY(j),z=a.getZ(j);return[m[0]*x+m[4]*y+m[8]*z+m[12],m[2]*x+m[6]*y+m[10]*z+m[14],m[1]*x+m[5]*y+m[9]*z+m[13]];});
      const f=supportFace(points);if(!f||!regions.some(r=>overlap(f.box,r)))continue;
      for(let x=Math.floor(f.box[0]/cell);x<=Math.floor(f.box[2]/cell);x++)for(let z=Math.floor(f.box[1]/cell);z<=Math.floor(f.box[3]/cell);z++){
        const key=x+','+z;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(f);
      }
    }
  }
  return box=>{const found=new Set();for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[2]/cell);x++)for(let z=Math.floor(box[1]/cell);z<=Math.floor(box[3]/cell);z++)for(const f of buckets.get(x+','+z)??[])if(overlap(box,f.box))found.add(f);return [...found];};
}
export const overlap=(a,b)=>a[2]>=b[0]&&a[0]<=b[2]&&a[3]>=b[1]&&a[1]<=b[3];
export function conformRoadTriangle(triangle,terrain,banks) {
  const pieces=[];
  // Start at the terrain, not at the old ribbon's chord. This also removes
  // floating chords where the bank support has a concave valley.
  for(const face of terrain){const {inside}=cut(triangle,face);if(inside.length)pieces.push(inside.map(p=>p.map((v,i)=>i===3?face.height(p[0],p[1]):v)));}
  if(!pieces.length)throw Error('Road support outside terrain');
  let result=pieces;
  for(const face of banks){const next=[];
    for(const p of result){const {inside,outside}=cut(p,face);next.push(...outside);if(!inside.length)continue;
      const [higher,lower]=split(inside,p=>face.height(p[0],p[1])-p[3]);
      if(lower.length)next.push(lower);
      if(higher.length)next.push(higher.map(p=>p.map((v,i)=>i===3?face.height(p[0],p[1]):v)));
    }
    result=next;
  }
  return result.flatMap(p=>Array.from({length:p.length-2},(_,i)=>[p[0],p[i+1],p[i+2]]));
}

// Keep the support plane on each side of a bank boundary separate from the
// bridge chord. Sampling a boundary vertex alone can pick the neighbouring
// high bank and assign the wrong Master delta to the low side of the face.
export function raiseRoadDeck(triangles,deck) {
  const result=[];
  for(const t of triangles){const [higher,lower]=split(t,p=>deck.height(p[0],p[1])-p[3]);
    for(const [poly,raised]of [[higher,true],[lower,false]])if(poly.length){
      const p=poly.map(v=>{const y=raised?deck.height(v[0],v[1]):v[3];return[v[0],v[1],v[2],y,Math.max(0,y-v[3])];});
      for(let i=1;i<p.length-1;i++)result.push([p[0],p[i],p[i+1]]);
    }
  }
  return result;
}
