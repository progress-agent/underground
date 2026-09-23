import * as THREE from 'three';

// Shared low-poly aircraft recipe. Static airport aircraft (airports.js) and
// flying traffic (flights.js) build from the same parts so the two read as one
// fleet. Parts are authored at a 60m reference length with the nose towards -z,
// wheels at y=0 and wings along x; callers scale, orient and place them.
// Dimensions are illustrative, not the proportions of any particular type.

export const AIRCRAFT_REFERENCE_LENGTH_M = 60;
export const AIRCRAFT_PALETTE = { white:0xe4e5dd, glass:0x76979f, steel:0xcbd3d2, dark:0x38454a, tail:0x526c80 };

function shape(points,height){const s=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));const g=new THREE.ExtrudeGeometry(s,{depth:height,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);return g;}
function box(w,h,d,x=0,y=0,z=0,yaw=0){const g=new THREE.BoxGeometry(Math.max(.05,w),Math.max(.05,h),Math.max(.05,d));g.rotateY(yaw);g.translate(x,y,z);return g;}

/** Ordered [geometry, paletteKey] parts at reference scale. `length` only selects
 * the variant (<=15m: straight wing and propeller; otherwise swept wing and two
 * engines). The order is part of the airport feature-index contract. */
export function aircraftParts(length,{glider=false}={}) {
 const parts=[];const add=(g,mat)=>parts.push([g,mat]);
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
