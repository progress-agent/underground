import {test,expect} from '@playwright/test';
import proj4 from 'proj4';
import {BNG_REF_E,BNG_REF_N} from '../src/coordinates.js';
import {createSchematicMapping,ORIENTATION_ROUTES,orientationRoutePath,MINI_CONE_RADIUS} from '../src/mini-map.js';
import data from '../src/mini-map-data.json' with {type:'json'};
const mapping=createSchematicMapping({projectStation:(lat,lon)=>{
  const p=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return {x:p[0]-BNG_REF_E,z:BNG_REF_N-p[1]};
}});

test('selected silhouette uses connected source routes and a closed central loop',()=>{
  expect(new Set(ORIENTATION_ROUTES.map(r=>r.line)).size).toBe(7);
  for(const route of ORIENTATION_ROUTES) {
    const edges=data.lines.find(l=>l.id===route.line).edges;
    for(let i=1;i<route.stops.length;i++) {
      const visited=new Set([route.stops[i-1]]),queue=[route.stops[i-1]];
      while(queue.length) {
        const n=queue.shift();
        for(const edge of edges.filter(e=>e.includes(n))) {
          const next=edge.find(s=>s!==n);
          if(!visited.has(next)){visited.add(next);queue.push(next);}
        }
      }
      expect(visited.has(route.stops[i]),route.stops.join(' / ')).toBe(true);
    }
    const path=orientationRoutePath(mapping,route.stops);
    expect((path.match(/M/g)||[]).length).toBe(1);
    expect(path).not.toMatch(/NaN|undefined/);
  }
  const loop=ORIENTATION_ROUTES.find(r=>r.line==='circle').stops;
  expect(loop[0]).toBe(loop.at(-1));
  expect(MINI_CONE_RADIUS*320/data.width).toBeGreaterThan(35);
  expect(MINI_CONE_RADIUS*320/data.width).toBeLessThan(45);
});

test('actual SVG strokes agree with every full-source station and interstation camera motion',()=>{
  const project=(lat,lon)=>{const p=proj4('EPSG:4326','EPSG:27700',[lon,lat]);return {x:p[0]-BNG_REF_E,z:BNG_REF_N-p[1]};};
  const segmentDistance=(p,a,b)=>{
    const vx=b[0]-a[0],vy=b[1]-a[1],length2=vx*vx+vy*vy;
    const t=Math.max(0,Math.min(1,length2?((p.x-a[0])*vx+(p.y-a[1])*vy)/length2:0));
    return Math.hypot(p.x-a[0]-t*vx,p.y-a[1]-t*vy);
  };
  let count=0,maxCss=0;
  for(const route of ORIENTATION_ROUTES) {
    const vertices=orientationRoutePath(mapping,route.stops).split(' ').map(command=>command.slice(1).split(',').map(Number));
    for(let i=1;i<vertices.length;i++) {
      const dx=Math.abs(vertices[i][0]-vertices[i-1][0]),dy=Math.abs(vertices[i][1]-vertices[i-1][1]);
      expect(Math.min(dx,dy,Math.abs(dx-dy))).toBeLessThan(.021);
    }
    // Full original TfL station walks include stops contracted out of the old
    // 109-control display graph. Lat/lon interpolation differs from the fitter's
    // BNG sampling, and 13 unequal fractions do not mirror its 25m increments.
    for(let i=1;i<route.geographic.length;i++) {
      const a=route.geographic[i-1],b=route.geographic[i];
      for(let k=0;k<=13;k++) {
        const t=k/13,p=project(a.lat+(b.lat-a.lat)*t,a.lon+(b.lon-a.lon)*t),mapped=mapping.map(p.x,p.z);
        let error=Infinity;
        for(let j=1;j<vertices.length;j++)error=Math.min(error,segmentDistance(mapped,vertices[j-1],vertices[j]));
        const css=error*320/data.width;maxCss=Math.max(maxCss,css);count++;
        expect(css,`${route.line}: ${a.name} to ${b.name}, ${t}`).toBeLessThan(1.5);
      }
    }
  }
  expect(count).toBeGreaterThan(3000);
  console.log(`Independent source/motion samples: ${count}; maximum route error ${maxCss.toFixed(3)} CSS px`);
});
