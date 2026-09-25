import * as THREE from 'three';

// Shared low-poly aircraft recipe. Static airport aircraft (airports.js) and
// flying traffic (flights.js) build from the same parts so the two read as one
// fleet. Parts are authored at a 60m reference length with the nose towards -z,
// wheels at y=0 and wings along x; callers scale, orient and place them.
// Dimensions are illustrative, not the proportions of any particular type.

export const AIRCRAFT_REFERENCE_LENGTH_M = 60;
export const AIRCRAFT_PALETTE = { white:0xe4e5dd, glass:0x76979f, steel:0xcbd3d2, dark:0x38454a, tail:0x526c80, prop:0x9a9f9f };

function shape(points,height){const s=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));const g=new THREE.ExtrudeGeometry(s,{depth:height,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);return g;}
function box(w,h,d,x=0,y=0,z=0,yaw=0){const g=new THREE.BoxGeometry(Math.max(.05,w),Math.max(.05,h),Math.max(.05,d));g.rotateY(yaw);g.translate(x,y,z);return g;}

/** Ordered [geometry, paletteKey] parts at reference scale. `length` only selects
 * the variant (<=15m: straight wing and propeller; otherwise swept wing and two
 * engines). The order is part of the airport feature-index contract. */
export function aircraftParts(length,{glider=false,variant=null}={}) {
 const parts=[];const add=(g,mat)=>parts.push([g,mat]);
 if(variant==='turboprop')return turbopropParts(add,parts);
 if(variant==='superjumbo')return superjumboParts(add,parts);
 if(glider){
  // Authored training glider: narrow fuselage, long unswept wings, canopy and
  // central wheel. No engine pods or propellers. Dimensions are illustrative.
  const hull=new THREE.SphereGeometry(1,12,6);hull.scale(1.9,2.2,30);hull.translate(0,3.2,0);add(hull,'white');
  const canopy=new THREE.SphereGeometry(1,10,5);canopy.scale(1.7,2,9);canopy.translate(0,5,-13);add(canopy,'glass');
  const wing=shape([[-2,-6],[-67,-2],[-67,1],[-2,3],[2,3],[67,1],[67,-2],[2,-6]],.45);wing.translate(0,4,0);add(wing,'white');
  add(box(23,.5,5,0,7,25),'white');add(box(.6,9,9,0,5.5,25),'tail');add(box(1.5,2.4,3,0,1.2,-2),'dark');
  return parts;
 }
 const hull=new THREE.SphereGeometry(1,14,8);hull.scale(3.2,3.4,30);hull.translate(0,6,0);add(hull,'white');
 const cockpit=new THREE.SphereGeometry(1,8,4);cockpit.scale(2.7,1.1,3);cockpit.translate(0,7.3,-26);add(cockpit,'dark');
 const wing=shape(length<=15?[[-3,-6],[-31,-4],[-31,3],[-3,2],[3,2],[31,3],[31,-4],[3,-6]]:[[-3,-8],[-28,9],[-28,12],[-3,3],[3,3],[28,12],[28,9],[3,-8]],.65);wing.translate(0,4.2,0);add(wing,'white');
 const tail=shape([[-2,20],[-10,27],[-10,29],[0,25],[10,29],[10,27],[2,20]],.6);tail.translate(0,7,0);add(tail,'steel');
 const fin=new THREE.BufferGeometry();fin.setAttribute('position',new THREE.Float32BufferAttribute([0,8,18,0,18,26,0,8,29,0,8,29,0,18,26,0,8,18],3));fin.computeVertexNormals();add(fin,'tail');
 if(length<=15){add(box(.8,17,.6,0,6,-30),'dark');add(box(17,.8,.6,0,6,-30),'dark');}
 for(const side of [-1,1]){if(length>15){const engine=new THREE.CylinderGeometry(1.55,1.35,6,10);engine.rotateX(Math.PI/2);engine.translate(side*10,3,-2);add(engine,'white');const mouth=new THREE.CylinderGeometry(1.15,1.15,.2,10);mouth.rotateX(Math.PI/2);mouth.translate(side*10,3,-5.1);add(mouth,'dark');}add(box(1.6,2.7,2.7,side*3,1.4,5),'dark');}
 add(box(1,2.2,1.7,0,1.1,-21),'dark');
 return parts;
}

// ── s25:F ── Two new flying types (sprint 25Sep26f, D-039, Lane F). Authored,
// like the others, at the 60m reference length with the nose towards -z and
// the wheels at y=0; callers scale uniformly by length / 60, so these ratios
// are the real ones. Proportions follow the published class dimensions, never
// a claim about a particular aircraft:
//   turboprop  (ATR 72 class): 27.2m long, 27.1m span, 2.6m fuselage, high
//              straight wing, two wing-mounted turboprops, T-tail.
//   superjumbo (A380 class):   72.7m long, 79.8m span, 7.1m wide x 8.4m tall
//              double-deck fuselage, swept wing, four engines.
function turbopropParts(add,parts){
 // 60/27.2 = 2.21 reference units per real metre.
 const hull=new THREE.SphereGeometry(1,14,8);hull.scale(3.1,3.1,30);hull.translate(0,5.4,0);add(hull,'white');
 const cockpit=new THREE.SphereGeometry(1,8,4);cockpit.scale(2.5,1,3);cockpit.translate(0,6.6,-26.4);add(cockpit,'dark');
 // High straight wing on the crown of the fuselage (span 27.1m -> 59.8).
 const wing=shape([[-3,-4],[-29.9,-2.4],[-29.9,2.2],[-3,4],[3,4],[29.9,2.2],[29.9,-2.4],[3,-4]],.7);wing.translate(0,8.2,-2);add(wing,'white');
 for(const side of [-1,1]){
  const nacelle=new THREE.CylinderGeometry(1.35,1.1,10,10);nacelle.rotateX(Math.PI/2);nacelle.translate(side*9.1,7.4,-4.5);add(nacelle,'white');
  // A spinning propeller reads as a faint disc (3.9m -> 8.6 across).
  const disc=new THREE.CylinderGeometry(4.3,4.3,.08,20);disc.rotateX(Math.PI/2);disc.translate(side*9.1,7.4,-9.7);add(disc,'prop');
  const spinner=new THREE.ConeGeometry(.75,1.6,8);spinner.rotateX(-Math.PI/2);spinner.translate(side*9.1,7.4,-10.5);add(spinner,'dark');
  add(box(1.5,2.3,4,side*3.3,1.2,1.5),'dark');
 }
 add(box(.9,2,1.4,0,1,-20),'dark');
 // T-tail: a tall fin with the tailplane across its top.
 const fin=new THREE.BufferGeometry();fin.setAttribute('position',new THREE.Float32BufferAttribute([0,7,17,0,19.5,26.5,0,7,29.5,0,7,29.5,0,19.5,26.5,0,7,17],3));fin.computeVertexNormals();add(fin,'tail');
 const tail=shape([[-1.5,24],[-9.5,27.5],[-9.5,29.3],[0,28],[9.5,29.3],[9.5,27.5],[1.5,24]],.5);tail.translate(0,19.2,0);add(tail,'steel');
 return parts;
}
function superjumboParts(add,parts){
 // 60/72.7 = 0.825 reference units per real metre.
 const hull=new THREE.SphereGeometry(1,16,10);hull.scale(2.95,3.47,30);hull.translate(0,5.9,0);add(hull,'white');
 const cockpit=new THREE.SphereGeometry(1,8,4);cockpit.scale(2.4,1,3);cockpit.translate(0,6.3,-26.6);add(cockpit,'dark');
 // Swept wing, span 79.8m -> 65.8, a deep root chord.
 const wing=shape([[-3,-10],[-32.9,11],[-32.9,13.6],[-3,7],[3,7],[32.9,13.6],[32.9,11],[3,-10]],.8);wing.translate(0,3.6,0);add(wing,'white');
 for(const side of [-1,1]){
  for(const [x,z] of [[9.2,-3.5],[17.4,1.2]]){
   const engine=new THREE.CylinderGeometry(1.5,1.3,5.6,10);engine.rotateX(Math.PI/2);engine.translate(side*x,2.1,z);add(engine,'white');
   const mouth=new THREE.CylinderGeometry(1.1,1.1,.2,10);mouth.rotateX(Math.PI/2);mouth.translate(side*x,2.1,z-2.9);add(mouth,'dark');
  }
  add(box(1.8,2.3,3.2,side*3.2,1.2,4),'dark');
 }
 add(box(1,2.1,1.7,0,1.05,-22),'dark');
 const tail=shape([[-2,20],[-12.4,27],[-12.4,29],[0,25.5],[12.4,29],[12.4,27],[2,20]],.6);tail.translate(0,7.4,0);add(tail,'steel');
 const fin=new THREE.BufferGeometry();fin.setAttribute('position',new THREE.Float32BufferAttribute([0,9,17,0,19.9,26.3,0,9,29.6,0,9,29.6,0,19.9,26.3,0,9,17],3));fin.computeVertexNormals();add(fin,'tail');
 return parts;
}
/** Flying liveries (Jordan, 25Sep26f): muted grey-brown. Each replaces the
 * palette's body ('white') and tail colours; built as separate meshes per type
 * and livery, never per-instance colour (D-015). */
export const AIRCRAFT_LIVERIES = Object.freeze({
 warmGrey: Object.freeze({ label:'warm grey', white:0xb9b3aa, tail:0x7a7168, steel:0xa39c92 }),
 taupe:    Object.freeze({ label:'taupe',     white:0xa8998a, tail:0x6a5c4f, steel:0x938576 }),
 dove:     Object.freeze({ label:'dove',      white:0xd3d0c9, tail:0x958f87, steel:0xbcb8b0 }),
});
export const AIRCRAFT_LIVERY_IDS = Object.freeze(Object.keys(AIRCRAFT_LIVERIES));
// ── /s25:F ──
