import diagram from './mini-map-data.json' with { type: 'json' };

const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const kernel = r2 => r2 > 1e-16 ? r2*Math.log(r2)/2 : 0;

function solve(matrix, rhs) {
  const n=matrix.length, a=matrix.map((row,i)=>[...row,...rhs[i]]);
  for(let k=0;k<n;k++) {
    let pivot=k;
    for(let i=k+1;i<n;i++) if(Math.abs(a[i][k])>Math.abs(a[pivot][k])) pivot=i;
    if(Math.abs(a[pivot][k])<1e-12) throw new Error('Degenerate mini-map control points');
    [a[k],a[pivot]]=[a[pivot],a[k]];
    const divisor=a[k][k];
    for(let j=k;j<n+2;j++) a[k][j]/=divisor;
    for(let i=0;i<n;i++) if(i!==k) {
      const factor=a[i][k];
      for(let j=k;j<n+2;j++) a[i][j]-=factor*a[k][j];
    }
  }
  return a.map(row=>row.slice(n));
}

/** Continuous, orientation-checked geographic -> authored diagram transform.
 * projectStation is the app's existing (lat,lon)->{x,z}, including scene scale.
 * Station dots are rendered through this SAME transform, never snapped separately.
 */
export function createSchematicMapping({projectStation,data=diagram}) {
  if(typeof projectStation!=='function') throw new TypeError('Mini-map needs projectStation');
  const origin=projectStation(51.51,-.13);
  const sx=Math.abs(projectStation(51.51,-.09).x-origin.x);
  const sz=Math.abs(projectStation(51.535,-.13).z-origin.z);
  const normalise=(x,z)=>[Math.asinh((x-origin.x)/sx),Math.asinh((z-origin.z)/sz)];
  const controls=data.nodes.map(node=> {
    const p=projectStation(node.lat,node.lon);
    return {q:normalise(p.x,p.z), target:node.target.map((n,i)=>(n-(i?215:305))/100)};
  });
  const n=controls.length;
  const matrix=Array.from({length:n+3},()=>Array(n+3).fill(0));
  const rhs=Array.from({length:n+3},()=>[0,0]);
  for(let i=0;i<n;i++) {
    const [x,y]=controls[i].q;
    rhs[i]=controls[i].target;
    for(let j=0;j<n;j++) matrix[i][j]=kernel((x-controls[j].q[0])**2+(y-controls[j].q[1])**2);
    matrix[i][n]=matrix[n][i]=1;
    matrix[i][n+1]=matrix[n+1][i]=x;
    matrix[i][n+2]=matrix[n+2][i]=y;
  }
  let weights, regularisation, minDeterminant;
  const evaluate=(x,y,derivative=false)=> {
    let u=weights[n][0]+weights[n+1][0]*x+weights[n+2][0]*y;
    let v=weights[n][1]+weights[n+1][1]*x+weights[n+2][1]*y;
    let a=weights[n+1][0],b=weights[n+2][0],c=weights[n+1][1],d=weights[n+2][1];
    for(let i=0;i<n;i++) {
      const dx=x-controls[i].q[0],dy=y-controls[i].q[1],r2=dx*dx+dy*dy;
      const k=kernel(r2);u+=weights[i][0]*k;v+=weights[i][1]*k;
      if(derivative && r2>1e-16) {
        const f=Math.log(r2)+1;
        a+=weights[i][0]*dx*f;b+=weights[i][0]*dy*f;
        c+=weights[i][1]*dx*f;d+=weights[i][1]*dy*f;
      }
    }
    return derivative ? {a,b,c,d,determinant:a*d-b*c} : {x:305+100*u,y:215+100*v};
  };
  // Smooth the authored controls only as much as needed to prevent folded map
  // orientation. Include network exterior, not merely the station locations.
  // The finite domain is also the evaluator's hard boundary below.
  const domain=4.5;
  for(const lambda of [.002,.01,.05,.2,1,5,25,125,625]) {
    const m=matrix.map(row=>[...row]);
    for(let i=0;i<n;i++) m[i][i]+=lambda;
    weights=solve(m,rhs);minDeterminant=Infinity;
    for(let iy=0;iy<=45;iy++) for(let ix=0;ix<=45;ix++) {
      minDeterminant=Math.min(minDeterminant,evaluate(-domain+ix*.2,-domain+iy*.2,true).determinant);
    }
    for(const p of controls) minDeterminant=Math.min(minDeterminant,evaluate(...p.q,true).determinant);
    if(minDeterminant>.035) {regularisation=lambda;break;}
  }
  if(regularisation===undefined) throw new Error('Mini-map transform could not preserve orientation');
  const bounds={minX:Math.min(...controls.map(c=>c.q[0])),maxX:Math.max(...controls.map(c=>c.q[0])),minY:Math.min(...controls.map(c=>c.q[1])),maxY:Math.max(...controls.map(c=>c.q[1]))};
  const map=(x,z)=> {
    const [qx,qy]=normalise(x,z);
    const result=evaluate(clamp(qx,-domain,domain),clamp(qy,-domain,domain));
    return {...result,outside:qx<bounds.minX||qx>bounds.maxX||qy<bounds.minY||qy>bounds.maxY};
  };
  const jacobian=(x,z)=> {
    const [qx,qy]=normalise(x,z);
    const j=evaluate(clamp(qx,-domain,domain),clamp(qy,-domain,domain),true);
    const dx=100/Math.hypot(sx,x-origin.x),dz=100/Math.hypot(sz,z-origin.z);
    return {a:j.a*dx,b:j.b*dz,c:j.c*dx,d:j.d*dz,determinant:j.determinant*dx*dz};
  };
  const nodes=new Map(data.nodes.map(node=> {
    const p=projectStation(node.lat,node.lon);
    return [node.id,{...node,...map(p.x,p.z)}];
  }));
  return {map,jacobian,nodes,projectStation,diagnostics:{regularisation,minDeterminant,domain,maxAuthoredAdjustment:Math.max(...[...nodes.values()].map(p=>Math.hypot(p.x-p.target[0],p.y-p.target[1])))}};
}

/** Horizontal camera frustum rays transformed by the mapping's LOCAL Jacobian.
 * Read camera world basis and projection matrix so pitch, roll, film offset,
 * focal length, zoom and aspect changes all have their actual camera meaning.
 */
export function schematicViewCone(camera,mapping,radius=29) {
  const m=camera.matrixWorld.elements,p=camera.projectionMatrix.elements;
  const j=mapping.jacobian(camera.position.x,camera.position.z);
  const points=[];
  for(let i=0;i<=16;i++) {
    const ndc=-1+2*i/16;
    const right=(ndc+p[8])/p[0];
    const up=p[9]/p[5];
    const dx=-m[8]+right*m[0]+up*m[4],dz=-m[10]+right*m[2]+up*m[6];
    const x=j.a*dx+j.b*dz,y=j.c*dx+j.d*dz,len=Math.hypot(x,y);
    if(len<1e-9) return null; // Looking straight down/up has no heading wedge.
    points.push([radius*x/len,radius*y/len]);
  }
  // Near vertical views project opposite headings, so a wedge would imply a
  // horizontal facing that does not exist. Show the position ring alone.
  const forwardLength=Math.hypot(m[8],m[10]);
  if(forwardLength<.08) return null;
  return points;
}

export function schematicEdgePath(a,b,offset=0) {
  const dx=b.x-a.x,dy=b.y-a.y,ax=Math.abs(dx),ay=Math.abs(dy);
  const sx=Math.sign(dx),sy=Math.sign(dy);
  // Horizontal/vertical plus one 45-degree section. Two half-diagonals put
  // the long straight section in the centre and preserve shared endpoints.
  const diagonal=Math.min(ax,ay)/2;
  const points=[[a.x,a.y],[a.x+sx*diagonal,a.y+sy*diagonal],
    [b.x-sx*diagonal,b.y-sy*diagonal],[b.x,b.y]];
  if(offset) {
    const length=Math.hypot(dx,dy)||1;
    for(const point of points) {point[0]+=-dy/length*offset;point[1]+=dx/length*offset;}
  }
  return points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}

// A few connected route strokes carry the familiar network silhouette. The
// complete source graph remains the mapping's control set and provenance.
export const ORIENTATION_ROUTES = diagram.orientationRoutes;

export const ROUTE_ERROR_UNITS = 2.5; // ~1.3 CSS pixels, bounded against source motion below.

export function orientationRouteSamples(mapping,stops) {
  const route=ORIENTATION_ROUTES.find(route=>route.stops.length===stops.length&&route.stops.every((name,i)=>name===stops[i]));
  if(!route?.geographic?.length)throw new Error('Orientation route needs its full source walk');
  const points=[];
  for(let i=1;i<route.geographic.length;i++) {
    const a=route.geographic[i-1],b=route.geographic[i];
    const pa=mapping.projectStation(a.lat,a.lon),pb=mapping.projectStation(b.lat,b.lon);
    const steps=Math.max(1,Math.ceil(Math.hypot(pb.x-pa.x,pb.z-pa.z)/25));
    for(let k=i===1?0:1;k<=steps;k++) {
      const t=k/steps,p=mapping.map(pa.x+(pb.x-pa.x)*t,pa.z+(pb.z-pa.z)*t);
      points.push([p.x,p.y]);
    }
  }
  return points;
}

function distanceToSegment(p,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
  const t=length2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2,0,1):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function octilinearCandidates(a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.min(Math.abs(dx),Math.abs(dy));
  const sx=Math.sign(dx),sy=Math.sign(dy);
  return [
    [a,[a[0]+sx*d,a[1]+sy*d],b],
    [a,[b[0]-sx*d,b[1]-sy*d],b],
    [a,[a[0]+sx*d/2,a[1]+sy*d/2],[b[0]-sx*d/2,b[1]-sy*d/2],b],
  ];
}
function matchesSamples(path,points,start,end,tolerance) {
  for(let k=start+1;k<end;k++) {
    let error=Infinity;
    for(let j=1;j<path.length;j++)error=Math.min(error,distanceToSegment(points[k],path[j-1],path[j]));
    if(error>tolerance)return false;
  }
  return true;
}
export function orientationRoutePath(mapping,stops) {
  // Fit long octilinear runs to the complete transformed source walk. Unlike
  // independently doglegging every edge, the fit crosses station boundaries,
  // but it may never cut across a real bend hidden between sparse anchors.
  const points=orientationRouteSamples(mapping,stops),out=[points[0]];
  let i=0;
  while(i<points.length-1) {
    let bestEnd=i+1,bestPath=octilinearCandidates(points[i],points[i+1])[0],failed=0;
    for(let j=i+1;j<points.length&&j<=i+600;j++) {
      const candidates=octilinearCandidates(points[i],points[j]);
      const candidate=candidates.find(path=>matchesSamples(path,points,i,j,ROUTE_ERROR_UNITS));
      if(candidate){bestEnd=j;bestPath=candidate;failed=0;}
      else if(++failed>=12)break;
    }
    out.push(...bestPath.slice(1));i=bestEnd;
  }
  // Remove repeated/collinear vertices after fitting adjacent runs.
  const simple=[];
  for(const p of out) {
    if(simple.length&&Math.hypot(p[0]-simple.at(-1)[0],p[1]-simple.at(-1)[1])<1e-7)continue;
    while(simple.length>1) {
      const a=simple.at(-2),b=simple.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],ex=p[0]-b[0],ey=p[1]-b[1];
      if(Math.abs(dx*ey-dy*ex)>1e-7||dx*ex+dy*ey<0)break;
      simple.pop();
    }
    simple.push(p);
  }
  return simple.map((p,i)=>`${i?'L':'M'}${p.map(n=>n.toFixed(2)).join(',')}`).join(' ');
}
export const MINI_CONE_RADIUS = 78; // ~40 CSS pixels at the unchanged 320px width.

const CSS=`
#ug-mini-map {position:fixed;right:12px;top:48px;width:320px;max-width:calc(100vw - 24px);z-index:21;color:#eeeae2;font-family:'Railway Sans',system-ui,sans-serif;user-select:none;box-sizing:border-box;pointer-events:none;}
#ug-mini-map .mini-drawing {display:block;width:100%;height:auto;overflow:visible;}
#ug-mini-map button {position:absolute;right:0;top:0;font:inherit;color:inherit;background:none;border:0;border-radius:3px;cursor:pointer;width:34px;height:34px;display:flex;align-items:center;justify-content:center;padding:5px;pointer-events:auto;opacity:.3;text-shadow:0 0 3px #111;}
#ug-mini-map button:hover,#ug-mini-map button:focus-visible {opacity:1;}
#ug-mini-map button:focus-visible {outline:2px solid #c9b896;outline-offset:2px;}
#ug-mini-map[data-collapsed="true"] {width:34px;height:34px;}
#ug-mini-map[data-collapsed="true"] .mini-body {display:none;}
#ug-mini-map[data-collapsed="true"] .mini-toggle-icon {transform:rotate(180deg);}
.mini-credits {font-size:10px;line-height:1.5;color:inherit;margin:8px 0;}
.mini-credits a {color:inherit;}
@media(max-width:700px) {#ug-mini-map {top:58px;width:260px;}#ug-mini-map button {width:44px;height:44px;}#ug-mini-map[data-collapsed="true"] {width:44px;height:44px;}}
@media(max-height:570px) and (min-width:701px) {#ug-mini-map {width:240px;top:45px;}}
`;

const NS='http://www.w3.org/2000/svg';
function svgElement(name,attributes={},text) {
  const node=document.createElementNS(NS,name);
  for(const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  if(text!==undefined) node.textContent=text;
  return node;
}

/** Integrate after llToXZ is ready, call update(frameTime) after camera matrix
 * update; no network, RAF, camera mutation, render loop or global key handlers.
 */
// Every camera component consumed by schematicViewCone belongs in this key.
export function miniMapPoseKey(camera) {
  const p=camera.position,m=camera.matrixWorld.elements,q=camera.projectionMatrix.elements;
  return [p.x,p.z,m[0],m[2],m[4],m[6],m[8],m[10],q[0],q[5],q[8],q[9]].map(n=>n.toFixed(5)).join(',');
}

export function createMiniMap({camera,projectStation,parent=document.body,data=diagram,onFocus=()=>{},creditsParent=document.querySelector('#hudDetails')}) {
  const mapping=createSchematicMapping({projectStation,data});
  const root=document.createElement('section');root.id='ug-mini-map';
  root.setAttribute('aria-label','Tube orientation map');
  const style=document.createElement('style');style.textContent=CSS;root.append(style);
  const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-controls','ug-mini-map-body');
  toggle.innerHTML='<svg class="mini-toggle-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  root.append(toggle);
  const body=document.createElement('div');body.id='ug-mini-map-body';body.className='mini-body';root.append(body);
  const svg=svgElement('svg',{class:'mini-drawing',viewBox:`0 0 ${data.width} ${data.height}`,role:'img','aria-label':'North-up Tube orientation schematic, approximate position and camera field of view. Selected routes only.'});
  body.append(svg);
  svg.append(svgElement('title',{},'Tube orientation, selected routes'));
  const defs=svgElement('defs');
  const gradient=svgElement('radialGradient',{id:'ug-mini-cone-fade',gradientUnits:'userSpaceOnUse',cx:0,cy:0,r:MINI_CONE_RADIUS});
  gradient.append(svgElement('stop',{offset:0,'stop-color':'#fff7d8','stop-opacity':.8}),svgElement('stop',{offset:.65,'stop-color':'#fff7d8','stop-opacity':.32}),svgElement('stop',{offset:1,'stop-color':'#fff7d8','stop-opacity':.04}));
  defs.append(gradient);svg.append(defs);
  const rails=svgElement('g',{'data-mini-routes':'','stroke-linecap':'round','stroke-linejoin':'round',fill:'none',opacity:.48});svg.append(rails);
  for(const route of ORIENTATION_ROUTES) {
    const line=data.lines.find(line=>line.id===route.line);
    if(!line)throw new Error(`Missing orientation line: ${route.line}`);
    const d=orientationRoutePath(mapping,route.stops);
    const group=svgElement('g',{'data-line':line.id});
    // A narrow translucent cushion keeps dark and pale lines legible without a
    // map-wide backing plate, blur/filter pass or scene pixel readback.
    group.append(svgElement('path',{d,stroke:line.id==='northern'?'#e9e2ce':'#10141b','stroke-width':5.2,'stroke-opacity':.32}));
    group.append(svgElement('path',{d,stroke:line.colour,'stroke-width':2.8}));
    rails.append(group);
  }
  const marker=svgElement('g',{'data-mini-position':'','pointer-events':'none'});
  const cone=svgElement('path',{'data-mini-cone':'',fill:'url(#ug-mini-cone-fade)',stroke:'#fff7d8','stroke-opacity':.7,'stroke-width':1.6});
  const halo=svgElement('circle',{r:7,fill:'#fff7d8',stroke:'#10141b','stroke-width':2});
  const dot=svgElement('circle',{r:2.5,fill:'#fffdf6'});
  marker.append(cone,halo,dot);svg.append(marker);
  const credits=document.createElement('details');credits.className='mini-credits';
  const summary=document.createElement('summary');summary.textContent='Tube map data';credits.append(summary);
  const creditBody=document.createElement('div');
  const creditLink=document.createElement('a');creditLink.href=data.provenance.licence;creditLink.target='_blank';creditLink.rel='noopener noreferrer';creditLink.textContent=data.provenance.attribution;creditBody.append(creditLink);
  creditBody.append(document.createTextNode(`. ${data.provenance.additionalAttribution} ${data.provenance.layout} Source snapshot ${data.provenance.snapshot.slice(0,10)}.`));
  credits.append(creditBody);
  (creditsParent||parent).append(credits);parent.append(root);
  let collapsed=false,lastTime=-Infinity,lastPose='',disposed=false;
  const setCollapsed=value=> {
    collapsed=Boolean(value);root.dataset.collapsed=String(collapsed);
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-label',collapsed?'Show Tube map':'Collapse Tube map');
    if(collapsed) credits.open=false;else lastPose='';
  };
  const onToggle=()=>setCollapsed(!collapsed);toggle.addEventListener('click',onToggle);
  // Prevent button/summary focus from bubbling flight keys to main.js. Let
  // keyup bubble, so an earlier movement press is still cleared by the scene.
  const stopKey=e=>e.stopPropagation();root.addEventListener('keydown',stopKey);
  root.addEventListener('focusin',onFocus);
  const stopPointer=e=>e.stopPropagation();
  for(const event of ['pointerdown','pointerup','click','dblclick','wheel']) root.addEventListener(event,stopPointer);
  const media=matchMedia('(max-width:700px), (max-height:570px)');
  const hud=document.getElementById('hudDetails');
  // The narrow-screen controls occupy the full width when expanded. They take
  // precedence; return the map automatically when the controls close.
  const avoidHud=()=> {root.hidden=window.innerWidth<=700 && Boolean(hud?.open);};
  const onResize=()=> { if(media.matches) setCollapsed(true);avoidHud();lastPose=''; };
  hud?.addEventListener('toggle',avoidHud);
  window.addEventListener('resize',onResize);setCollapsed(media.matches);avoidHud();
  function update(timeMs=performance.now()) {
    if(disposed||collapsed||root.hidden||timeMs-lastTime<66) return;
    lastTime=timeMs;
    const p=camera.position;
    const pose=miniMapPoseKey(camera);
    if(pose===lastPose) return;lastPose=pose;
    const point=mapping.map(p.x,p.z);
    const x=clamp(point.x,12,data.width-12),y=clamp(point.y,12,data.height-12);
    const outside=point.outside||x!==point.x||y!==point.y;
    marker.setAttribute('transform',`translate(${x.toFixed(2)},${y.toFixed(2)})`);
    marker.dataset.outside=String(outside);
    const points=schematicViewCone(camera,mapping,MINI_CONE_RADIUS);
    cone.setAttribute('d',points?`M0,0 L${points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' L')} Z`:'');
    halo.setAttribute('stroke-dasharray',outside?'3 2':'none');
    marker.setAttribute('aria-label',outside?'Outside Tube coverage':points?'Approximate position and viewing direction':'Approximate position, looking vertically');
  }
  return {root,mapping,update,setCollapsed,get collapsed(){return collapsed;},dispose(){
    disposed=true;window.removeEventListener('resize',onResize);hud?.removeEventListener('toggle',avoidHud);credits.remove();root.remove();
  }};
}
