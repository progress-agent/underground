import * as THREE from 'three';
import { getTerrainSurfaceTriangles } from './terrain.js';

const INK = 0xcbd7b4;
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ'.-";
const clamp = THREE.MathUtils.clamp;
const area = ring => ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;

function pathFor(ring, side) {
  const points=ring.map(p=>[...p]);
  // Opposite baselines on the underside keep entire words readable from below,
  // rather than mirroring glyphs or reversing their order on a DoubleSide plane.
  if (Math.sign(area(points)) !== -side) points.reverse();
  const cumulative=[0];
  for(let i=0;i<points.length;i++) {
    const p=points[i],q=points[(i+1)%points.length];
    cumulative.push(cumulative.at(-1)+Math.hypot(q[0]-p[0],q[1]-p[1]));
  }
  return {points,cumulative,length:cumulative.at(-1)};
}
function pointAt(path,s) {
  s=((s%path.length)+path.length)%path.length;
  let lo=0,hi=path.points.length;
  while(lo<hi-1){const mid=(lo+hi)>>1;if(path.cumulative[mid]<=s)lo=mid;else hi=mid;}
  const p=path.points[lo],q=path.points[(lo+1)%path.points.length];
  const t=(s-path.cumulative[lo])/(path.cumulative[lo+1]-path.cumulative[lo]);
  return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
}
function inscriptionPath(ring,side,height) {
  const source=pathFor(ring,side),points=[],count=Math.ceil(source.length/(height*.5));
  // Smooth only the decorative baseline, never the source footprint. A true
  // arc-length parameter on the inset path avoids packing letters together on
  // inward bends, which happens when offsetting after spacing on the shoreline.
  const smoothPoint=s=>{
    const point=[0,0];
    for(let i=-3;i<=3;i++){const p=pointAt(source,s+i*height*.7);point[0]+=p[0]/7;point[1]+=p[1]/7;}
    return point;
  };
  for(let i=0;i<count;i++) {
    const s=i/count*source.length,p=smoothPoint(s),before=smoothPoint(s-height),after=smoothPoint(s+height);
    const dx=after[0]-before[0],dz=after[1]-before[1],length=Math.hypot(dx,dz)||1;
    points.push([p[0]+dz/length*side*height*1.25,p[1]-dx/length*side*height*1.25]);
  }
  return pathFor(points,side);
}
export function parkContainsPoint(ring,x,z) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

// Oriented ink bounds, measured from the same canvas/font used by the atlas.
// Transparent cell padding is excluded; the margin is physical letter spacing.
export function parkGlyphFootprint(glyph, margin=.06) {
  const {minX,maxX,minY,maxY}=glyph.ink;
  return [[minX-margin,minY-margin],[maxX+margin,minY-margin],
    [maxX+margin,maxY+margin],[minX-margin,maxY+margin]].map(([x,y])=>[
      glyph.x+glyph.height*(glyph.tangent[0]*x+glyph.inward[0]*y),
      glyph.z+glyph.height*(glyph.tangent[1]*x+glyph.inward[1]*y),
    ]);
}
export function parkFootprintsOverlap(a,b) {
  // Separating-axis test, including rotated neighbouring letters on a curve.
  for(const polygon of [a,b])for(let i=0;i<2;i++) {
    const p=polygon[i],q=polygon[i+1],axis=[q[1]-p[1],p[0]-q[0]];
    const pa=a.map(v=>v[0]*axis[0]+v[1]*axis[1]),pb=b.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    if(Math.max(...pa)<=Math.min(...pb)||Math.max(...pb)<=Math.min(...pa))return false;
  }
  return true;
}
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function crossesBoundary(footprint,ring) {
  for(let i=0;i<4;i++)for(let j=0;j<ring.length;j++) {
    const a=footprint[i],b=footprint[(i+1)%4],c=ring[j],d=ring[(j+1)%ring.length];
    if(cross2(a,b,c)*cross2(a,b,d)<0&&cross2(c,d,a)*cross2(c,d,b)<0)return true;
  }
  return false;
}
function footprintFits(footprint,park) {
  if(!footprint.every(([x,z])=>parkContainsPoint(park.ring,x,z))||crossesBoundary(footprint,park.ring))return false;
  return !(park.holes||[]).some(hole=>footprint.some(([x,z])=>parkContainsPoint(hole,x,z))||crossesBoundary(footprint,hole)||parkContainsPoint(footprint,hole[0][0],hole[0][1]));
}

// Pure layout for source acceptance and geometry verification without a GPU.
// A candidate is an entire phrase; reject sharp turns or any ink collision,
// then move the whole phrase along its sector. Never clip a word to make it fit.
export function createParkLayout(park, {side=1,advance=()=>.72,metrics=null}={}) {
  const height=clamp(Math.sqrt(park.areaM2)*.019,12,24),path=inscriptionPath(park.ring,side,height);
  const measured=ch=>metrics?.(ch)||{advance:advance(ch),minX:-advance(ch)/2,maxX:advance(ch)/2,minY:-.5,maxY:.5};
  const letterAdvance=ch=>(ch===' '? .48:measured(ch).advance+.24)*height;
  const textLength=[...park.label].reduce((s,ch)=>s+letterAdvance(ch),0);
  const repetitions=clamp(Math.floor(path.length/Math.max(textLength*2.3,450)),4,14);
  const interval=path.length/repetitions,glyphs=[];
  const phases=[0];for(let i=1;i<=12;i++)phases.push(i/24,-i/24);
  const diagnostics={rejectedCollision:0,rejectedBoundary:0,rejectedTurn:0};
  let completed=0;
  for(let repeat=0;repeat<repetitions;repeat++) {
    // Prefer curved inscriptions. When a sector turns too tightly, try the
    // complete name on its broad chord with a modest inward inset. All ink must
    // still fit the actual park, and the source outline is never simplified.
    for(const candidate of [0,1,2,3,4].flatMap(mode=>phases.map(phase=>({mode,phase})))) {
      const {mode,phase}=candidate;
      // Keep a gap at sector edges so relocated neighbouring phrases cannot
      // meet around a corner. Physical footprint checks also cover other stamps.
      let distance=repeat*interval+(interval-textLength)/2+phase*Math.max(0,interval-textLength-height*2);
      const startDistance=distance,midDistance=distance+textLength/2;
      const mid=pointAt(path,midDistance),chordA=pointAt(path,midDistance-textLength*.45),chordB=pointAt(path,midDistance+textLength*.45);
      const chordLength=Math.hypot(chordB[0]-chordA[0],chordB[1]-chordA[1]);
      const straightTangent=[(chordB[0]-chordA[0])/Math.max(1,chordLength),(chordB[1]-chordA[1])/Math.max(1,chordLength)];
      if(mode&&chordLength<textLength*.55)continue;
      const stamp=[];let valid=true,totalTurn=0;
      for(const character of park.label) {
        const step=letterAdvance(character);
        if(character!==' ') {
          let centre=pointAt(path,distance+step/2);const before=pointAt(path,distance+step/2-height),after=pointAt(path,distance+step/2+height);
          const length=Math.hypot(after[0]-before[0],after[1]-before[1]);
          if(length<=height*.5){diagnostics.rejectedTurn++;valid=false;break;}
          const tangent=mode?straightTangent:[(after[0]-before[0])/length,(after[1]-before[1])/length],inward=[tangent[1]*side,-tangent[0]*side];
          if(mode){const along=distance+step/2-startDistance-textLength/2;centre=[mid[0]+tangent[0]*along+inward[0]*(mode-1)*height,mid[1]+tangent[1]*along+inward[1]*(mode-1)*height];}
          if(stamp.length) {
            const previous=stamp.at(-1).tangent,turn=Math.acos(clamp(previous[0]*tangent[0]+previous[1]*tangent[1],-1,1));
            totalTurn+=turn;
            if(turn>Math.PI/10||totalTurn>Math.PI/2){diagnostics.rejectedTurn++;valid=false;break;}
          }
          const glyph={character,x:centre[0],z:centre[1],tangent,inward,height,repeat,placement:mode?'straight-sector':'curved',ink:measured(character)};
          glyph.footprint=parkGlyphFootprint(glyph);
          if(!footprintFits(glyph.footprint,park)){diagnostics.rejectedBoundary++;valid=false;break;}
          if([...stamp,...glyphs].some(other=>parkFootprintsOverlap(glyph.footprint,other.footprint))){diagnostics.rejectedCollision++;valid=false;break;}
          stamp.push(glyph);
        }
        distance+=step;
      }
      if(valid){glyphs.push(...stamp);completed++;break;}
    }
  }
  return {glyphs,height,repetitions:completed,side,diagnostics};
}

function createAtlas() {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const context=canvas.getContext('2d');
  if(!context)throw Error('Park label canvas unavailable');
  context.font='900 84px Arial, sans-serif';context.textAlign='center';context.textBaseline='alphabetic';context.fillStyle='white';
  const capHeight=context.measureText('H').actualBoundingBoxAscent || 61;
  const chars=new Map();
  [...GLYPHS].forEach((ch,index)=>{
    const x=index%8*128,y=Math.floor(index/8)*128;
    context.fillText(ch,x+64,y+64+capHeight/2);
    const measured=context.measureText(ch),halfAdvance=measured.width/2;
    const ink={advance:measured.width/capHeight,
      minX:-(measured.actualBoundingBoxLeft??halfAdvance)/capHeight,
      maxX:(measured.actualBoundingBoxRight??halfAdvance)/capHeight,
      minY:-((measured.actualBoundingBoxDescent??0)+capHeight/2)/capHeight,
      maxY:((measured.actualBoundingBoxAscent??capHeight)-capHeight/2)/capHeight};
    chars.set(ch,{u0:x/1024,u1:(x+128)/1024,v0:1-(y+128)/512,v1:1-y/512,advance:ink.advance,ink});
  });
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;texture.name='park-inscription-glyph-atlas';
  return {texture,chars,quadScale:128/capHeight};
}

function clipGlyphToTriangle(corners,triangle) {
  const sign=Math.sign((triangle[1][0]-triangle[0][0])*(triangle[2][2]-triangle[0][2])-(triangle[1][2]-triangle[0][2])*(triangle[2][0]-triangle[0][0]));
  if(!sign)return [];
  let polygon=corners;
  for(let edge=0;edge<3&&polygon.length;edge++) {
    const a=triangle[edge],b=triangle[(edge+1)%3],distance=p=>((b[0]-a[0])*(p.z-a[2])-(b[2]-a[2])*(p.x-a[0]))*sign;
    const clipped=[];
    for(let i=0;i<polygon.length;i++) {
      const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=distance(p),dq=distance(q);
      if(dp>=0)clipped.push(p);
      if((dp>=0)!==(dq>=0)) {
        const t=dp/(dp-dq);
        clipped.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t});
      }
    }
    polygon=clipped.filter((p,i)=>i===0||Math.hypot(p.x-clipped[i-1].x,p.z-clipped[i-1].z)>1e-8);
    if(polygon.length>1&&Math.hypot(polygon[0].x-polygon.at(-1).x,polygon[0].z-polygon.at(-1).z)<1e-8)polygon.pop();
  }
  return polygon;
}
function triangleHeight(triangle,x,z) {
  const [a,b,c]=triangle,det=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
  const u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))/det;
  const v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))/det;
  return a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]);
}
export function createParkGeometry(layout,atlas,terrainTriangles) {
  const positions=[],uvs=[],indices=[],glyphCentres=[],glyphRanges=[];
  const triangles=terrainTriangles.map(t=>({...t,minX:Math.min(...t.vertices.map(p=>p[0])),maxX:Math.max(...t.vertices.map(p=>p[0])),minZ:Math.min(...t.vertices.map(p=>p[2])),maxZ:Math.max(...t.vertices.map(p=>p[2]))}));
  for(const [glyphIndex,glyph]of layout.glyphs.entries()) {
    const cell=atlas.chars.get(glyph.character);if(!cell)throw Error('Missing atlas glyph');
    const half=glyph.height*atlas.quadScale/2;
    const corners=[[-half,-half,cell.u0,cell.v0],[half,-half,cell.u1,cell.v0],[half,half,cell.u1,cell.v1],[-half,half,cell.u0,cell.v1]].map(([along,across,u,v])=>({
      x:glyph.x+glyph.tangent[0]*along+glyph.inward[0]*across,z:glyph.z+glyph.tangent[1]*along+glyph.inward[1]*across,u,v}));
    const box={minX:Math.min(...corners.map(p=>p.x)),maxX:Math.max(...corners.map(p=>p.x)),minZ:Math.min(...corners.map(p=>p.z)),maxZ:Math.max(...corners.map(p=>p.z))};
    const firstVertex=positions.length/3,firstIndex=indices.length;
    for(const triangle of triangles) {
      if(triangle.maxX<box.minX||triangle.minX>box.maxX||triangle.maxZ<box.minZ||triangle.minZ>box.maxZ)continue;
      const polygon=clipGlyphToTriangle(corners,triangle.vertices);
      if(polygon.length<3)continue;
      // Preserve the source winding (top/bottom) and continuous atlas UVs.
      // Each emitted patch lies on ONE actual terrain plane, so interior ink
      // cannot bridge a crease even when every original quad corner was clear.
      for(let i=1;i<polygon.length-1;i++) {
        const points=[polygon[0],polygon[i],polygon[i+1]],a=points[0],b=points[1],c=points[2];
        if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))<1e-8)continue;
        const base=positions.length/3;
        for(const p of points) {
          const y=triangleHeight(triangle.vertices,p.x,p.z)+layout.side*2;
          if(![p.x,y,p.z,p.u,p.v].every(Number.isFinite))throw Error('Non-finite terrain-conforming glyph');
          positions.push(p.x,y,p.z);uvs.push(p.u,p.v);
        }
        indices.push(base,base+1,base+2);
      }
    }
    const indexCount=indices.length-firstIndex;
    if(!indexCount)throw Error(`No rendered terrain under park glyph ${glyph.character}`);
    glyphRanges.push({glyphIndex,character:glyph.character,repeat:glyph.repeat,firstVertex,vertexCount:positions.length/3-firstVertex,firstIndex,indexCount});
    glyphCentres.push([glyph.x,glyph.z]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
  geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.userData={glyphCentres,glyphRanges};
  return geometry;
}

function createMaterial(atlas,height,uniforms) {
  // Preserve the two-unit terrain lift at distant views where depth quantisation
  // can otherwise merge the inscription with its surface. Real occluders still win.
  const material=new THREE.MeshBasicMaterial({color:INK,map:atlas.texture,transparent:true,opacity:.72,alphaTest:.02,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,side:THREE.FrontSide,fog:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.parkPixelScale=uniforms.pixelScale;
    shader.uniforms.parkLetterHeight={value:height};
    shader.vertexShader=shader.vertexShader.replace('void main() {','uniform float parkPixelScale;\nuniform float parkLetterHeight;\nvarying float vParkFade;\nvoid main() {')
      .replace('#include <project_vertex>',`#include <project_vertex>
      float facing=abs(dot(normalize(normalMatrix * normal),normalize(-mvPosition.xyz)));
      float pixels=parkLetterHeight*parkPixelScale/max(1.0,-mvPosition.z);
      vParkFade=smoothstep(1.0,3.3,pixels)*smoothstep(0.035,0.18,facing);`);
    shader.fragmentShader=shader.fragmentShader.replace('void main() {','varying float vParkFade;\nvoid main() {')
      .replace('#include <alphamap_fragment>','#include <alphamap_fragment>\n diffuseColor.a *= vParkFade;');
  };
  return material;
}

export async function createParkLabels({getSurfaceY,getTrianglesForBounds=getTerrainSurfaceTriangles,data=null}={}) {
  if(typeof getSurfaceY!=='function')throw Error('Park inscriptions require the exact terrain sampler');
  if(!data) {
    const response=await fetch('/data/park-labels.json');
    if(!response.ok||(response.headers.get('content-type')||'').includes('text/html'))throw Error('Park label registry unavailable');
    data=await response.json();
  }
  if(data?.version!==1||data.parks?.length!==14||new Set(data.parks.map(p=>p.id)).size!==14)throw Error('Invalid fourteen-park label registry');
  for(const park of data.parks)if(!park.rings?.length||!park.rings.every(r=>r.length>=3&&r.every(p=>p.length===2&&p.every(Number.isFinite)))||![...park.label].every(ch=>ch===' '||GLYPHS.includes(ch)))throw Error(`Invalid park boundary/text: ${park.id}`);
  const atlas=createAtlas(),group=new THREE.Group(),uniforms={pixelScale:{value:1000}};
  group.name='park-inscriptions';
  for(const park of data.parks)for(const [ringIndex,ring]of park.rings.entries()) {
    // Tiny disconnected islands retain source provenance and green coverage;
    // the main park and both substantial Victoria halves carry the names.
    if(ringIndex>0&&Math.abs(area(ring))<park.areaM2*.1)continue;
    const padding=60; // larger than a complete 24m-cap atlas cell at any bearing
    const triangles=getTrianglesForBounds({minX:Math.min(...ring.map(p=>p[0]))-padding,maxX:Math.max(...ring.map(p=>p[0]))+padding,minZ:Math.min(...ring.map(p=>p[1]))-padding,maxZ:Math.max(...ring.map(p=>p[1]))+padding});
    if(!triangles.length)throw Error(`No final terrain triangles for ${park.name}`);
    for(const side of [1,-1]) {
    const layout=createParkLayout({...park,ring},{side,metrics:ch=>atlas.chars.get(ch)?.ink});
    const geometry=createParkGeometry(layout,atlas,triangles),material=createMaterial(atlas,layout.height,uniforms);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`park-${park.id}-${side===1?'top':'underside'}-${ringIndex}`;
    mesh.userData={parkId:park.id,side,glyphs:layout.glyphs.length,repetitions:layout.repetitions,letterHeight:layout.height,placementDiagnostics:layout.diagnostics,glyphFootprints:layout.glyphs.map(g=>({character:g.character,repeat:g.repeat,points:g.footprint}))};
    group.add(mesh);
    }
  }
  group.userData={registry:data,update({camera,viewportHeight,submerged=false,labelsVisible=true}) {
    group.visible=!submerged&&labelsVisible;
    if(camera&&Number.isFinite(viewportHeight))uniforms.pixelScale.value=camera.projectionMatrix.elements[5]*viewportHeight*.5;
  },dispose() {for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}atlas.texture.dispose();group.removeFromParent();}};
  return group;
}
