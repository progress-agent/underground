import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {createTidewayLabelCover} from '../src/tideway-label-cover.js';
import {ventGeometry,ventFinishColor} from '../src/tideway-platforms.js';
test('a nearer vent hides only overlapping names; a normal view, nearer name and remote column stay visible',()=>{
 const camera=new T.PerspectiveCamera(60,1,.1,5000);camera.position.set(0,14,20);camera.lookAt(0,14,0);camera.updateMatrixWorld(true);
 const site={group:{scale:{y:1}},columns:[{x:0,z:0,baseLocal:0,data:{diameter:1.2,height:5}}]};
 let frame=1;const cover=createTidewayLabelCover({getGroup:()=>({visible:true,userData:{registry:new Map([['test',site]])}}),getFrame:()=>frame});
 const info={x:0,y:14,z:-100,vw:1000,vh:1000};
 assert.equal(cover({x:495,y:490,w:70,h:20},camera,info),true);
 assert.equal(cover({x:100,y:490,w:70,h:20},camera,info),false);
 assert.equal(cover({x:495,y:490,w:70,h:20},camera,{...info,z:10}),false);
 site.columns[0].z=-1000;frame++;assert.equal(cover({x:495,y:490,w:70,h:20},camera,info),false);
});
test('cast column geometry has outward side normals and a lit closed top; finish colours retain site families',()=>{
 const g=ventGeometry(5.1,1.2),p=g.attributes.position,n=g.attributes.normal;let outward=0;
 for(let i=0;i<p.count;i++)if(p.getY(i)>1&&p.getY(i)<4&&p.getX(i)*n.getX(i)+p.getZ(i)*n.getZ(i)>0)outward++;
 assert.ok(outward>200);assert.ok(n.getY(p.count-1)>.9);g.dispose();
 assert.equal(ventFinishColor('#675344'),'#92735a');assert.equal(ventFinishColor('#282825'),'#60615b');
});
