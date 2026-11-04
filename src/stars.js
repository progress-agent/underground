// HYG v4.0 subset: see docs/star-catalogue.md. Equatorial coordinates are J2000.
import * as THREE from 'three';
const RAD = Math.PI / 180;
const HOUR_MS = 3600000;
let londonOffsetFormatter, offsetDay, dayOffsets;
function londonOffset(instant) {
  londonOffsetFormatter ||= new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',timeZoneName:'shortOffset'});
  const part = londonOffsetFormatter.formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName').value;
  return part === 'GMT' ? 0 : Number(part.replace('GMT',''));
}
export function clockDate(hour, date = new Date()) {
  // Device's calendar date, selected London civil hour, including British Summer Time.
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  if (day !== offsetDay) {
    offsetDay = day;
    dayOffsets = [...new Set([londonOffset(day - 12*HOUR_MS), londonOffset(day + 36*HOUR_MS)])];
  }
  const wall = Math.round(day + hour*HOUR_MS);
  if (dayOffsets.length === 1) return new Date(wall - dayOffsets[0]*HOUR_MS);
  // At the autumn fold use the earlier occurrence. At the spring gap advance
  // by its length, matching the usual civil-time compatible disambiguation.
  const candidates = dayOffsets.map(offset=>wall-offset*HOUR_MS).sort((a,b)=>a-b);
  const instant = candidates.find(value=>value+londonOffset(value)*HOUR_MS === wall);
  return new Date(instant ?? wall-dayOffsets[0]*HOUR_MS);
}
export function starDirection(raHours, decDeg, instant, out = new THREE.Vector3()) {
  const jd = instant.getTime() / 86400000 + 2440587.5, days = jd - 2451545, T = days / 36525;
  // IAU 1976 precession J2000 -> date, comfortably within the 1 degree sky contract.
  const zeta = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) / 3600 * RAD;
  const z = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) / 3600 * RAD;
  const theta = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) / 3600 * RAD;
  const ra = raHours * 15 * RAD, dec = decDeg * RAD;
  const A = Math.cos(dec) * Math.sin(ra + zeta);
  const B = Math.cos(theta)*Math.cos(dec)*Math.cos(ra+zeta) - Math.sin(theta)*Math.sin(dec);
  const C = Math.sin(theta)*Math.cos(dec)*Math.cos(ra+zeta) + Math.cos(theta)*Math.sin(dec);
  const a = Math.atan2(A,B) + z, d = Math.asin(C);
  const lst = (280.46061837 + 360.98564736629 * days + 0.000387933*T*T - T*T*T/38710000 - 0.1278) * RAD;
  const H = lst - a, lat = 51.5 * RAD;
  const east = -Math.cos(d)*Math.sin(H);
  const north = Math.cos(lat)*Math.sin(d)-Math.sin(lat)*Math.cos(d)*Math.cos(H);
  return out.set(east, Math.sin(lat)*Math.sin(d)+Math.cos(lat)*Math.cos(d)*Math.cos(H), -north);
}
export function createStars({scene, renderer}) {
  const uniforms = {uRotation:{value:new THREE.Matrix3()},uWeight:{value:0},uPixels:{value:1}};
  const material = new THREE.ShaderMaterial({name:'catalogue-stars',uniforms,depthWrite:false,depthTest:true,
    transparent:true,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float magnitude; attribute float tint; uniform mat3 uRotation; uniform float uPixels; varying float vAlpha; varying vec3 vTint;
    void main(){vec3 d=uRotation*position; gl_Position=projectionMatrix*vec4(d,0.0); gl_Position.z=gl_Position.w;
    gl_PointSize=uPixels*(2.0+max(0.0,3.0-magnitude)*0.6); vAlpha=smoothstep(0.03,0.3,position.y)*clamp(pow(2.512,(2.5-magnitude)*0.55),0.12,2.0);
    vTint=mix(vec3(0.72,0.83,1.0),vec3(1.0,0.85,0.67),clamp(tint/1.8,0.0,1.0));}`,
    fragmentShader:`uniform float uWeight; varying float vAlpha; varying vec3 vTint;
    void main(){float r=length(gl_PointCoord-0.5)*2.0; if(r>1.0)discard; gl_FragColor=vec4(vTint,uWeight*vAlpha*(1.0-smoothstep(0.1,1.0,r)));}`});
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(0),3));
  geometry.setAttribute('magnitude',new THREE.BufferAttribute(new Float32Array(0),1));
  geometry.setAttribute('tint',new THREE.BufferAttribute(new Float32Array(0),1));
  const points=new THREE.Points(geometry,material);points.name='real-stars';points.frustumCulled=false;points.renderOrder=-1e8;points.visible=false;points.raycast=()=>{};scene.add(points);
  let catalogue=null,pending=null,lastHour=null,lastDate=null,nextDateCheck=0;
  const v=new THREE.Vector3();
  const load=()=>pending ||= fetch('/data/stars-hyg.json').then(r=>{if(!r.ok)throw Error('Star catalogue unavailable');return r.json()}).then(rows=>{
    catalogue=rows;geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(rows.length*3),3));
    geometry.setAttribute('magnitude',new THREE.Float32BufferAttribute(rows.map(x=>x[3]),1));geometry.setAttribute('tint',new THREE.Float32BufferAttribute(rows.map(x=>x[4]),1));lastHour=null;
  }).catch(e=>{console.warn('[stars]',e.message);});
  function update(camera,hour,amount) {
    if(!amount){points.visible=false;return;}
    load();if(!catalogue)return;
    const nowMs=Date.now();
    if(hour!==lastHour || nowMs>=nextDateCheck){
      const now=new Date(nowMs),date=now.toDateString();nextDateCheck=nowMs+1000;
      if(hour!==lastHour || date!==lastDate){const instant=clockDate(hour,now),p=geometry.attributes.position;
        catalogue.forEach((row,i)=>{starDirection(row[1],row[2],instant,v);p.setXYZ(i,v.x,v.y,v.z)});p.needsUpdate=true;lastHour=hour;lastDate=date;
      }
    }
    // View = inverse(displayed camera rotation) * landscape scale. Remove only that scale.
    const rotation=uniforms.uRotation.value;rotation.setFromMatrix4(camera.matrixWorldInverse);
    const ratio=camera.userData?.masterHeightController?.ratio ?? 1,e=rotation.elements;
    e[3]/=ratio;e[4]/=ratio;e[5]/=ratio;
    uniforms.uPixels.value=renderer.getPixelRatio();uniforms.uWeight.value=amount;points.visible=true;
  }
  return {points,load,update,get catalogue(){return catalogue;}};
}
