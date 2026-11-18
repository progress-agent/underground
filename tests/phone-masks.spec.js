import {test,expect} from '@playwright/test';

test('phone R8 edge and RG8 river masks preserve canvas sampling, including row orientation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/?fast=1&touch=1&buildings=baked');
 await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ug?.lateLayers?.settled(),null,{timeout:180000});
 const result=await page.evaluate(async()=>{
  const u=window.__ug,T=window.__ugTHREE,r=u.composer.renderer;
  const {generateM25Mask}=await import('/src/m25.js'),{getMapEdgePointsBNG}=await import('/src/m25-edge.js');
  const {createThamesVolume}=await import('/src/thames.js');
  const before=u.surfaceTextureMaterial?.userData?._surfaceShader;
  let shader=before;u.scene.traverse(o=>{if(o.material?.userData?._surfaceShader?.uniforms?.uRiverBedMask)shader=o.material.userData._surfaceShader;});
  const phoneRiver=shader.uniforms.uRiverBedMask.value;
  const data=await fetch('/data/thames.json').then(r=>r.json());
  const temp=createThamesVolume(data,u.getTerrainMeshSurfaceY,{compactMasks:false});
  const desktopRiver=shader.uniforms.uRiverBedMask.value;
  const edgeData=getMapEdgePointsBNG(),desktopEdge=generateM25Mask(edgeData,128),phoneEdge=generateM25Mask(edgeData,128,undefined,{compact:true});
  const camera=new T.OrthographicCamera(-1,1,1,-1,0,1),scene=new T.Scene();
  const material=new T.ShaderMaterial({uniforms:{map:{value:null}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D map;varying vec2 v;void main(){gl_FragColor=vec4(texture2D(map,v).rg,0.,1.);}'});
  scene.add(new T.Mesh(new T.PlaneGeometry(2,2),material));
  const target=new T.WebGLRenderTarget(512,512,{type:T.UnsignedByteType}),previous=r.getRenderTarget();
  const render=texture=>{material.uniforms.map.value=texture;r.setRenderTarget(target);r.render(scene,camera);const b=new Uint8Array(512*512*4);r.readRenderTargetPixels(target,0,0,512,512,b);return b;};
  const compare=(a,b,channels)=>{const x=render(a),y=render(b);let different=0,max=0;for(let i=0;i<x.length;i+=4)for(let k=0;k<channels;k++){const d=Math.abs(x[i+k]-y[i+k]);if(d)different++;max=Math.max(max,d);}return {different,max};};
  try{return {edge:compare(desktopEdge,phoneEdge,1),river:compare(desktopRiver,phoneRiver,2),edgeFormat:phoneEdge.format,riverFormat:phoneRiver.format,R:T.RedFormat,RG:T.RGFormat};}
  finally{r.setRenderTarget(previous);target.dispose();material.dispose();desktopEdge.dispose();phoneEdge.dispose();temp.geometry.dispose();}
 });
 expect(result.edgeFormat).toBe(result.R);expect(result.riverFormat).toBe(result.RG);
 expect(result.edge).toEqual({different:0,max:0});expect(result.river).toEqual({different:0,max:0});expect(errors).toEqual([]);
});
