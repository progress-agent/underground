import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import * as THREE from 'three';
// Shared Thames width/depth sampling from thames.json.
// Keep this independent of terrain.js to avoid circular imports.




function toScenePoint(pt) {
  if (Number.isFinite(pt.x) && Number.isFinite(pt.z)) {
    return {
      x: pt.x,
      z: pt.z,
      w: Number.isFinite(pt.w) ? pt.w : 100,
      d: Number.isFinite(pt.d) ? pt.d : 3,
    };
  }

  return {
    x: pt.e - BNG_REF_E,
    z: -(pt.n - BNG_REF_N),
    w: Number.isFinite(pt.w) ? pt.w : 100,
    d: Number.isFinite(pt.d) ? pt.d : 3,
  };
}

export function sceneThamesPoints(points) {
  return (points || []).map(toScenePoint);
}

export function buildThamesProfiles(points) {
  const scenePoints = sceneThamesPoints(points);
  if (scenePoints.length === 0) return [];

  let cumDist = 0;
  const cumDists = [0];
  for (let i = 1; i < scenePoints.length; i++) {
    const dx = scenePoints[i].x - scenePoints[i - 1].x;
    const dz = scenePoints[i].z - scenePoints[i - 1].z;
    cumDist += Math.sqrt(dx * dx + dz * dz);
    cumDists.push(cumDist);
  }

  return scenePoints.map((p, i) => ({
    u: cumDist > 0 ? cumDists[i] / cumDist : 0,
    x: p.x,
    z: p.z,
    w: p.w,
    d: p.d,
  }));
}

// Shared render cross-sections, used by water AND locally refined terrain.
// The profile depths remain the supplied illustrative bathymetry; no new
// survey precision or source depth is manufactured here.
export function buildThamesCrossSections(points, { samples = 1500, VE = 5, waterLevelM = 2, topY = 12 } = {}) {
  const source = sceneThamesPoints(points);
  if(source.length<2)return null;
  const spline = new THREE.CatmullRomCurve3(source.map(p=>new THREE.Vector3(p.x,0,p.z)));
  spline.curveType='catmullrom'; spline.tension=0.5;
  const profiles=buildThamesProfiles(source),positions=new Float32Array((samples+1)*12);
  let totalChain=0;
  for(let i=1;i<source.length;i++)totalChain+=Math.hypot(source[i].x-source[i-1].x,source[i].z-source[i-1].z);
  for(let i=0;i<=samples;i++){
    const u=i/samples,p=spline.getPointAt(u),t=spline.getTangentAt(u),profile=lerpThamesProfile(profiles,u);
    const norm=Math.hypot(t.x,t.z)||1,nx=-t.z/norm,nz=t.x/norm,h=profile.w/2,bed=(waterLevelM-profile.d)*VE;
    positions.set([p.x+nx*h,topY,p.z+nz*h,p.x-nx*h,topY,p.z-nz*h,
      p.x+nx*h,bed,p.z+nz*h,p.x-nx*h,bed,p.z-nz*h],i*12);
  }
  return {positions,totalChain,samples,source,profiles};
}

export function lerpThamesProfile(profiles, u) {
  if (!profiles?.length) return null;
  if (u <= profiles[0].u) return profiles[0];
  if (u >= profiles[profiles.length - 1].u) return profiles[profiles.length - 1];

  let lo = 0;
  let hi = profiles.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profiles[mid].u <= u) lo = mid;
    else hi = mid;
  }

  const span = profiles[hi].u - profiles[lo].u || 1;
  const t = (u - profiles[lo].u) / span;
  return {
    u,
    x: profiles[lo].x + t * (profiles[hi].x - profiles[lo].x),
    z: profiles[lo].z + t * (profiles[hi].z - profiles[lo].z),
    w: profiles[lo].w + t * (profiles[hi].w - profiles[lo].w),
    d: profiles[lo].d + t * (profiles[hi].d - profiles[lo].d),
  };
}

export function createThamesProfileSampler(points) {
  const scenePoints = sceneThamesPoints(points);
  if (scenePoints.length < 2) return null;

  const segments = [];
  for (let i = 0; i < scenePoints.length - 1; i++) {
    const a = scenePoints[i];
    const b = scenePoints[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    segments.push({ a, b, dx, dz, lenSq: dx * dx + dz * dz });
  }

  return {
    scenePoints,
    sampleAt(x, z) {
      let best = null;

      for (const seg of segments) {
        let t = 0;
        if (seg.lenSq > 1e-8) {
          t = ((x - seg.a.x) * seg.dx + (z - seg.a.z) * seg.dz) / seg.lenSq;
          t = Math.max(0, Math.min(1, t));
        }

        const projX = seg.a.x + t * seg.dx;
        const projZ = seg.a.z + t * seg.dz;
        const ex = x - projX;
        const ez = z - projZ;
        const dist = Math.sqrt(ex * ex + ez * ez);
        if (!best || dist < best.dist) {
          best = {
            x: projX,
            z: projZ,
            dist,
            w: seg.a.w + t * (seg.b.w - seg.a.w),
            d: seg.a.d + t * (seg.b.d - seg.a.d),
          };
        }
      }

      return best;
    },
  };
}
