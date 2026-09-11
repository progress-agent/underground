// Landmark silhouettes over the retained OSM outlines. All authored dimensions
// are real metres. Each building pivots at its own sampled terrain elevation;
// the existing building-height control scales the complete body and crown.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANDMARKS } from '../scripts/landmarks.mjs';

export const LANDMARK_FOOTPRINTS_URL = '/data/surface/baked/landmark-footprints.json';
const materials = Object.fromEntries(Object.entries({
  context: [0x8a8580, .85, .1], stone: [0xc3bba6, .8, .05],
  roof: [0x6b7779, .65, .2], glass: [0x76979f, .3, .45],
  steel: [0xcbd3d2, .45, .35], brick: [0x997667, .85, .05],
  gold: [0xd6b658, .55, .2], dark: [0x404a50, .8, .1],
  pitch: [0x55795e, 1, 0], seats: [0x7b6668, .9, 0],
}).map(([key, [color, roughness, metalness]]) => [key,
  new THREE.MeshStandardMaterial({ color, roughness, metalness, fog: true })]));

function cleanRing(points) {
  const out = [];
  for (const p of points || []) {
    if (!Array.isArray(p) || !p.every(Number.isFinite)) throw new Error('invalid landmark coordinate');
    if (!out.length || p[0] !== out.at(-1)[0] || p[1] !== out.at(-1)[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out.at(-1)[0][0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

export function validateLandmarkFootprints(data) {
  for (const site of LANDMARKS) {
    const buildings = data?.[site.id];
    if (!Array.isArray(buildings) || !buildings.length) throw new Error(`missing landmark footprint: ${site.id}`);
    for (const b of buildings) {
      if (!Number.isFinite(b.height) || b.height <= 0 || !Number.isFinite(b.area) || b.area <= 0 || cleanRing(b.footprint).length < 3) {
        throw new Error(`invalid landmark footprint: ${site.id}`);
      }
    }
  }
  return data;
}

export async function fetchLandmarkFootprints() {
  const r = await fetch(LANDMARK_FOOTPRINTS_URL);
  if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) throw new Error('landmark footprints unavailable');
  return validateLandmarkFootprints(await r.json());
}

function bounds(ring) {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

function outline(ring, height) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Geometry is merged by material per building, avoiding a draw for every rib,
// spoke, capsule and chimney. No per-instance colours (M5 driver constraint).
function assembler() {
  const parts = new Map();
  const add = (geo, material = 'stone', x = 0, y = 0, z = 0) => {
    geo.translate(x, y, z);
    if (geo.index) { const flat = geo.toNonIndexed(); geo.dispose(); geo = flat; }
    geo.deleteAttribute('uv'); geo.clearGroups();
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geo);
  };
  const box = (w, h, d, x, y, z, mat = 'stone') => add(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);
  const cyl = (r, h, x, y, z, mat = 'stone', top = r, segments = 20) => add(new THREE.CylinderGeometry(top, r, h, segments), mat, x, y + h / 2, z);
  const rod = (a, b, radius = .6, mat = 'steel') => {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), delta = bv.clone().sub(av);
    if (delta.length() < .001) return;
    const g = new THREE.CylinderGeometry(radius, radius, delta.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    const c = av.add(bv).multiplyScalar(.5); add(g, mat, c.x, c.y, c.z);
  };
  return { add, box, cyl, rod, finish(group) {
    for (const [key, geos] of parts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]); mesh.name = `landmark-${key}`; group.add(mesh);
    }
  } };
}

function dome(a, rx, rz, rise, y, mat = 'roof', x = 0, z = 0) {
  const g = new THREE.SphereGeometry(1, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(rx, rise, rz); a.add(g, mat, x, y, z);
}

function taperedOutline(ring, bottomY, topY, topScale) {
  const pos = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const a = [p[0], bottomY, p[1]], b = [q[0], bottomY, q[1]];
    const c = [q[0] * topScale, topY, q[1] * topScale], d = [p[0] * topScale, topY, p[1] * topScale];
    pos.push(...a, ...b, ...d, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // OSM rings may arrive clockwise or anticlockwise. Test one face against its
  // outward radial vector and reverse the entire winding when necessary.
  const p = g.attributes.position, n = g.attributes.normal;
  if (p.getX(0) * n.getX(0) + p.getZ(0) * n.getZ(0) < 0) {
    for (let i = 0; i < p.count; i += 3) {
      const v = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, ...v);
    }
    g.computeVertexNormals();
  }
  return g;
}

function stadium(a, ring, b, london, floorY) {
  // Real outer outline, an open roof and stepped seating. The inner pitch is
  // deliberately open geometry, never a dark rectangle painted onto a lid.
  const outer = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const hole = new THREE.Path(); hole.absellipse(0, 0, b.w * .26, b.d * .31, 0, Math.PI * 2, true);
  outer.holes.push(hole);
  const roofY = london ? 47 : 48;
  const roof = new THREE.ExtrudeGeometry(outer, { depth: 3, bevelEnabled: false, steps: 1 });
  roof.rotateX(-Math.PI / 2); a.add(roof, 'steel', 0, roofY, 0);
  // Thin perimeter skirt with the same retained outline, not a solid stadium.
  const wall = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  wall.holes.push(new THREE.Path([...ring].reverse().map(([x,z]) => new THREE.Vector2(x * .95, -z * .95))));
  const walls = new THREE.ExtrudeGeometry(wall, { depth: roofY, bevelEnabled: false, steps: 1 });
  walls.rotateX(-Math.PI / 2); a.add(walls, 'dark');
  for (let tier = 0; tier < 5; tier++) {
    const rx = b.w * (.23 + tier * .043), rz = b.d * (.28 + tier * .038);
    const g = new THREE.RingGeometry(1, 1.12, 64); g.rotateX(-Math.PI / 2); g.scale(rx, 1, rz);
    a.add(g, 'seats', 0, floorY + 3 + tier * (roofY - floorY - 6) / 5, 0);
  }
  const floor = new THREE.CylinderGeometry(1, 1, 1, 64);
  floor.scale(b.w * .27, .5, b.d * .32);
  a.add(floor, 'seats', 0, floorY, 0);
  a.box(68, .3, 105, 0, floorY + .3, 0, 'pitch');
  for (const x of [-34, 34]) a.rod([x, floorY + .7, -52.5], [x, floorY + .7, 52.5], .16);
  for (const z of [-52.5, 0, 52.5]) a.rod([-34, floorY + .7, z], [34, floorY + .7, z], .16);
  for (let i = 0; i < 32; i++) {
    const t = i / 32 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    a.rod([c * b.w * .48, roofY + 4, s * b.d * .47], [c * b.w * .27, roofY + 3, s * b.d * .32], .55);
  }
  if (london) {
    for (let i = 0; i < 14; i++) {
      const t = i / 14 * Math.PI * 2;
      a.box(8, 2, 3, Math.cos(t) * b.w * .28, 51, Math.sin(t) * b.d * .33, 'steel');
    }
  } else {
    // Wembley arch: tilted above the northern roof, 134m at its apex.
    let prev;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48 * Math.PI, p = [Math.cos(t) * b.w * .49, 8 + Math.sin(t) * 126, -b.d * .20 - Math.sin(t) * 45];
      if (prev) a.rod(prev, p, 2.7);
      if (i % 3 === 0) a.rod(p, [p[0], 51, -b.d * .28], .4);
      prev = p;
    }
  }
}

function model(site, ring, b, height, floorY = 1) {
  const a = assembler(), w = b.w, d = b.d;
  switch (site.id) {
    case 'shard': {
      a.add(outline(ring, 16), 'glass');
      a.add(taperedOutline(ring, 16, 290, .07), 'glass');
      for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 8))) {
        const [x,z] = ring[i]; a.rod([x, 16, z], [x * .035, 310 - (i % 3) * 5, z * .035], .6);
      }
      break;
    }
    case 'gherkin': {
      a.add(outline(ring, 7), 'dark');
      const r = Math.min(w, d) * .5;
      const profile = [[.63,0],[.82,30],[1,65],[.97,95],[.8,130],[.47,161],[.04,173]].map(([s,y]) => new THREE.Vector2(r*s,y));
      a.add(new THREE.LatheGeometry(profile, 40), 'glass', 0, 7, 0);
      for (let strand = 0; strand < 12; strand++) {
        for (const direction of [-1,1]) {
          let prev;
          for (let j = 0; j <= 24; j++) {
            const y = j / 24 * 170, idx = profile.findIndex(p=>p.y >= y), hi = Math.max(1, idx);
            const lo = profile[hi-1], up = profile[hi], radius = THREE.MathUtils.lerp(lo.x,up.x,(y-lo.y)/(up.y-lo.y));
            const t = strand / 12 * Math.PI * 2 + direction * y / 120;
            const p = [Math.cos(t)*(radius+.15),y+7,Math.sin(t)*(radius+.15)];
            if (prev) a.rod(prev,p,.22,'dark'); prev=p;
          }
        }
      }
      break;
    }
    case 'st-pauls': {
      a.add(outline(ring, 30), 'stone');
      a.cyl(17, 21, 12, 30, 0); a.cyl(19, 4, 12, 51, 0);
      dome(a,19,19,30,55,'roof',12); a.cyl(4,12,12,85,0); a.cyl(3,8,12,97,0,'roof',.5);
      a.rod([12,105,0],[12,111,0],.5,'gold'); a.rod([9,109,0],[15,109,0],.5,'gold');
      for (const z of [-d*.28,d*.28]) {a.box(12,43,12,-w*.36,0,z);a.cyl(7,12,-w*.36,43,z,'stone',3);a.cyl(3,5,-w*.36,55,z,'roof',.1);}
      break;
    }
    case 'westminster': {
      a.add(outline(ring, 25), 'stone');
      // Elizabeth Tower at the NE, Victoria Tower at the SW, derived from
      // the retained palace bounds rather than the registry point.
      const tx = -4, tz = -d / 2 + 2;
      a.box(14,70,14,tx,0,tz); a.box(16,10,16,tx,70,tz);a.cyl(10,16,tx,80,tz,'roof',.1,4);
      for (const [dx,dz,ry] of [[0,-8.1,Math.PI],[0,8.1,0],[-8.1,0,-Math.PI/2],[8.1,0,Math.PI/2]]) {
        const g=new THREE.CircleGeometry(3.3,24);g.rotateY(ry);a.add(g,'gold',tx+dx,75,tz+dz);
      }
      const vx=-w*.43,vz=d*.43; a.box(24,88,24,vx,0,vz);a.box(27,6,27,vx,88,vz);
      for(const dx of [-10,10])for(const dz of [-10,10])a.cyl(2.5,6,vx+dx,94,vz+dz,'stone',1);
      for(let z=-d*.4;z<=d*.4;z+=18)for(const x of [-w*.4,w*.4]) {a.box(2,5,2,x,25,z);a.cyl(2,5,x,30,z,'stone',.1,4);}
      break;
    }
    case 'battersea': {
      a.add(outline(ring, 36), 'brick'); a.box(w*.4,14,d*.8,0,36,0,'brick');
      for(const x of [-w*.38,w*.38])for(const z of [-d*.38,d*.38]) {
        a.box(17,13,17,x,36,z,'brick');a.cyl(5.5,54,x,49,z,'stone',4);a.cyl(4.7,2,x,103,z,'stone');
      }
      for(let z=-d*.32;z<=d*.32;z+=12)for(const x of [-w*.49,w*.49])a.box(1,23,3,x,9,z,'dark');
      break;
    }
    case 'canary-wharf': {
      const roofHeight = height > 220 ? height-25 : height;
      a.add(outline(ring, roofHeight), 'glass');
      if(height>220) { const g=new THREE.ConeGeometry(Math.min(w,d)*.69,25,4);g.rotateY(Math.PI/4);a.add(g,'steel',0,roofHeight+12.5,0); }
      for(let y=12;y<roofHeight;y+=12) {a.box(w+.3,.65,d+.3,0,y,0,'steel');}
      break;
    }
    case 'bt-tower': {
      a.cyl(8,120,0,0,0,'stone');a.cyl(11,19,0,120,0,'glass');
      for(let y=140;y<164;y+=6)a.cyl(13,3,0,y,0,'steel');
      a.cyl(9,12,0,164,0,'dark');a.cyl(1.1,13,0,176,0,'steel',.35);
      break;
    }
    case 'the-o2': {
      const rx=w*.49, rz=d*.49;
      a.add(outline(ring,8),'stone');dome(a,rx,rz,42,8,'steel');
      for(let i=0;i<12;i++) {
        const t=i/12*Math.PI*2, x=Math.cos(t)*rx*.7,z=Math.sin(t)*rz*.7;
        a.cyl(1.8,100,x,0,z,'gold',1.1);
        for(const off of [-.18,.18])a.rod([x,95,z],[Math.cos(t+off)*rx,9,Math.sin(t+off)*rz],.4);
        a.rod([x,92,z],[Math.cos(t)*rx*.28,46,Math.sin(t)*rz*.28],.4);
      }
      break;
    }
    case 'wembley': case 'london-stadium': stadium(a,ring,b,site.id==='london-stadium',floorY); break;
    case 'london-eye': {
      // Upright wheel, 120m diameter, with 32 capsules and a cantilever A frame.
      const wheel = new THREE.TorusGeometry(60,1,6,96); wheel.rotateY(-.25);a.add(wheel,'steel',0,75,0);
      for(let i=0;i<32;i++) {
        const t=i/32*Math.PI*2,x=Math.cos(t)*60,y=75+Math.sin(t)*60,z=x*Math.sin(.25);
        const px=x*Math.cos(.25);a.rod([0,75,0],[px,y,z],.2);
        const capsule=new THREE.SphereGeometry(1,10,6);capsule.scale(3,1.8,2);a.add(capsule,'glass',px,y,z);
      }
      a.rod([-24,0,22],[0,75,0],2);a.rod([24,0,22],[0,75,0],2);a.rod([0,75,-4],[0,75,8],3);
      break;
    }
    default: throw new Error(`no model for ${site.id}`);
  }
  return a;
}

export function createLandmarkModels(data, { getSurfaceY, VE = 5, heightScale = 1 } = {}) {
  validateLandmarkFootprints(data);
  const group = new THREE.Group(); group.name = 'landmarks';
  const anchors = [];
  for (const site of LANDMARKS) {
    const siteGroup=new THREE.Group();siteGroup.name=`landmark-site-${site.id}`;siteGroup.userData.site=site.id;
    group.add(siteGroup);
    const seen=new Set();
    const buildings=data[site.id].filter(b=>{
      const key=JSON.stringify([b.height,b.footprint]); if(seen.has(key))return false;seen.add(key);return true;
    });
    const primary=site.id==='bt-tower' ? buildings.reduce((a,b)=>a.height>b.height?a:b) :
      site.id==='canary-wharf' ? buildings.reduce((a,b)=>a.height>b.height?a:b) :
      buildings.reduce((a,b)=>a.area>b.area?a:b);
    for(const building of buildings) {
      // Stadium interior parts, O2 fixtures and clock-tower proxies belong to
      // the authored primary. Keep neighbouring buildings outside its outline.
      const ring=cleanRing(building.footprint), b=bounds(ring);
      const insideMain = new THREE.Shape(cleanRing(primary.footprint).map(([x,z])=>new THREE.Vector2(x,z)));
      const inRing = (x,z) => {
        const pts=insideMain.getPoints();let hit=false;
        for(let i=0,j=pts.length-1;i<pts.length;j=i++)if((pts[i].y>z)!==(pts[j].y>z)&&x<(pts[j].x-pts[i].x)*(z-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x)hit=!hit;
        return hit;
      };
      if(building!==primary && ['wembley','london-stadium','the-o2','westminster'].includes(site.id) && inRing(b.x,b.z))continue;
      // The two source clock/Victoria tower proxies straddle the palace edge,
      // so a centre-in-palace test misses them. Their crowns are authored above.
      if(site.id==='westminster' && building!==primary && building.height>=80 && building.area<600)continue;
      const special=building===primary || (site.id==='canary-wharf'&&building.height>150);
      const base=getSurfaceY({x:b.x,z:b.z});if(!Number.isFinite(base))throw new Error(`no terrain under ${site.id}`);
      const anchor=new THREE.Group();anchor.position.set(b.x,base,b.z);anchor.name=special?'landmark-model':'landmark-neighbour';
      anchor.userData={site:site.id,sourceArea:building.area,sourceHeight:building.height,primary:building===primary};
      const local=ring.map(([x,z])=>[x-b.x,z-b.z]);
      // Terrain retains VE even at the slider's true-height setting. Clear its
      // highest point beneath the open floor at that minimum setting as well.
      let floorY=1;
      if(special && ['wembley','london-stadium'].includes(site.id)) {
        for(let x=-b.w*.27;x<=b.w*.27;x+=8)for(let z=-b.d*.32;z<=b.d*.32;z+=8) {
          floorY=Math.max(floorY,getSurfaceY({x:b.x+x,z:b.z+z})-base+1);
        }
      }
      const a=special?model(site,local,b,building.height,floorY):assembler();
      if(!special)a.add(outline(local,Math.max(.5,building.height)),'context');
      a.finish(anchor);siteGroup.add(anchor);anchors.push(anchor);
    }
  }
  group.userData.sites=LANDMARKS.length;
  group.userData.setHeightScale=(value)=>{for(const a of anchors)a.scale.y=VE*value;};
  group.userData.setHeightScale(heightScale);
  return group;
}
