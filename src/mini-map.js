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
  return {map,jacobian,nodes,diagnostics:{regularisation,minDeterminant,domain,maxAuthoredAdjustment:Math.max(...[...nodes.values()].map(p=>Math.hypot(p.x-p.target[0],p.y-p.target[1])))}};
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

const CSS=`
#ug-mini-map {position:fixed;right:12px;top:48px;width:320px;max-width:calc(100vw - 24px);z-index:21;color:#eeeae2;background:#10141b;border:1px solid #42454a;border-radius:5px;font-family:'Railway Sans',system-ui,sans-serif;user-select:none;box-sizing:border-box;}
#ug-mini-map .mini-head {display:flex;align-items:center;justify-content:space-between;min-height:35px;padding:0 7px 0 12px;gap:10px;}
#ug-mini-map .mini-title {font-size:13px;letter-spacing:.03em;}
#ug-mini-map button {font:inherit;color:inherit;background:none;border:0;border-radius:3px;cursor:pointer;min-width:34px;min-height:34px;display:flex;align-items:center;justify-content:center;padding:5px;}
#ug-mini-map button:focus-visible,#ug-mini-map summary:focus-visible,#ug-mini-map a:focus-visible {outline:2px solid #c9b896;outline-offset:2px;}
#ug-mini-map button:hover {background:#282d35;}
#ug-mini-map .mini-drawing {display:block;width:100%;height:auto;background:#eeeae2;border-top:1px solid #42454a;border-bottom:1px solid #42454a;}
#ug-mini-map .mini-foot {display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:10px;color:#bfc2c7;gap:6px;}
#ug-mini-map .mini-status {white-space:nowrap;}
#ug-mini-map details {font-size:10px;text-align:right;}
#ug-mini-map summary {cursor:pointer;list-style:none;text-decoration:underline;text-underline-offset:2px;}
#ug-mini-map summary::-webkit-details-marker {display:none;}
#ug-mini-map .mini-credits {position:absolute;right:0;top:100%;width:260px;box-sizing:border-box;background:#10141b;border:1px solid #42454a;padding:10px;text-align:left;font-size:11px;line-height:1.4;z-index:1;}
#ug-mini-map a {color:#eeeae2;}
#ug-mini-map[data-collapsed="true"] {width:142px;}
#ug-mini-map[data-collapsed="true"] .mini-body {display:none;}
#ug-mini-map[data-collapsed="true"] .mini-toggle-icon {transform:rotate(180deg);}
@media(max-width:700px) {#ug-mini-map {top:58px;width:260px;}#ug-mini-map button {min-width:44px;min-height:44px;}#ug-mini-map[data-collapsed="true"] {width:145px;}}
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

export function createMiniMap({camera,projectStation,parent=document.body,data=diagram,onFocus=()=>{}}) {
  const mapping=createSchematicMapping({projectStation,data});
  const root=document.createElement('section');root.id='ug-mini-map';
  root.setAttribute('aria-label','Tube orientation map');
  const style=document.createElement('style');style.textContent=CSS;root.append(style);
  const head=document.createElement('div');head.className='mini-head';
  const title=document.createElement('span');title.className='mini-title';title.textContent='Tube map';head.append(title);
  const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-controls','ug-mini-map-body');
  toggle.innerHTML='<svg class="mini-toggle-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  head.append(toggle);root.append(head);
  const body=document.createElement('div');body.id='ug-mini-map-body';body.className='mini-body';root.append(body);
  const svg=svgElement('svg',{class:'mini-drawing',viewBox:`0 0 ${data.width} ${data.height}`,role:'img','aria-label':'Schematic Tube map, approximate position and camera field of view. Intermediate stations omitted.'});
  body.append(svg);
  svg.append(svgElement('title',{},'London Underground and DLR orientation schematic'));
  const rails=svgElement('g',{'stroke-linecap':'round','stroke-linejoin':'round',fill:'none'});svg.append(rails);
  const sharedEdges=new Map();
  for(const line of data.lines) for(const edge of line.edges) {
    const key=[...edge].sort().join('|');if(!sharedEdges.has(key)) sharedEdges.set(key,[]);sharedEdges.get(key).push(line.id);
  }
  for(const line of data.lines) {
    const group=svgElement('g',{'data-line':line.id});group.append(svgElement('title',{},line.name));
    for(const [a,b] of line.edges) {
      const members=sharedEdges.get([a,b].sort().join('|'));
      const offset=(members.indexOf(line.id)-(members.length-1)/2)*3.7;
      group.append(svgElement('path',{d:schematicEdgePath(mapping.nodes.get(a),mapping.nodes.get(b),offset),stroke:line.colour,'stroke-width':line.id==='dlr'?3.3:3.6}));
    }
    rails.append(group);
  }
  const stations=svgElement('g');svg.append(stations);
  const labels=svgElement('g',{'font-family':"'Railway Sans',system-ui,sans-serif",'font-size':18,fill:'#17232e',stroke:'#eeeae2','stroke-width':4,'paint-order':'stroke','stroke-linejoin':'round'});svg.append(labels);
  for(const node of mapping.nodes.values()) {
    const lineCount=data.lines.filter(line=>line.edges.some(edge=>edge.includes(node.id))).length;
    if(node.label||lineCount>1) {
      const station=svgElement('circle',{cx:node.x,cy:node.y,r:lineCount>1?4.2:2.5,fill:'#fffdf6',stroke:'#17232e','stroke-width':1.7});
      station.append(svgElement('title',{},node.name));stations.append(station);
    }
    if(node.label) {
      const [dx,dy,anchor,label=node.name]=node.label;
      labels.append(svgElement('text',{x:node.x+dx,y:node.y+dy,'text-anchor':anchor},label));
    }
  }
  const marker=svgElement('g',{'data-mini-position':'','pointer-events':'none'});
  const cone=svgElement('path',{'data-mini-cone':'',fill:'#196fbc','fill-opacity':.25,stroke:'#075ca8','stroke-width':1.4});
  const halo=svgElement('circle',{r:7,fill:'#fffdf6',stroke:'#13344d','stroke-width':1.5});
  const dot=svgElement('circle',{r:3.5,fill:'#096bad'});
  marker.append(cone,halo,dot);svg.append(marker);
  const foot=document.createElement('div');foot.className='mini-foot';
  const status=document.createElement('span');status.className='mini-status';status.textContent='Approx. position';foot.append(status);
  const credits=document.createElement('details');
  const summary=document.createElement('summary');summary.textContent='TfL data';credits.append(summary);
  const creditBody=document.createElement('div');creditBody.className='mini-credits';
  const creditLink=document.createElement('a');creditLink.href=data.provenance.licence;creditLink.target='_blank';creditLink.rel='noopener noreferrer';creditLink.textContent=data.provenance.attribution;creditBody.append(creditLink);
  creditBody.append(document.createTextNode(`. ${data.provenance.additionalAttribution} ${data.provenance.layout} Source snapshot ${data.provenance.snapshot.slice(0,10)}.`));
  credits.append(creditBody);foot.append(credits);body.append(foot);parent.append(root);
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
    const points=schematicViewCone(camera,mapping);
    cone.setAttribute('d',points?`M0,0 L${points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' L')} Z`:'');
    halo.setAttribute('stroke-dasharray',outside?'3 2':'none');
    status.textContent=outside?'Outside Tube coverage':points?'Approx. position':'Looking vertically';
  }
  return {root,mapping,update,setCollapsed,get collapsed(){return collapsed;},dispose(){
    disposed=true;window.removeEventListener('resize',onResize);hud?.removeEventListener('toggle',avoidHud);root.remove();
  }};
}
