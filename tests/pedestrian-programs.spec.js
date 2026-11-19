import {test,expect} from '@playwright/test';

test('normal post-opening Pedestrian entry creates no WebGL programs',async({page})=>{
  test.setTimeout(300000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
    window.__entryPrograms=[];
    for(const C of [WebGLRenderingContext,WebGL2RenderingContext]){
      const create=C.prototype.createProgram;
      C.prototype.createProgram=function(...args){__entryPrograms.push(performance.now());return create.apply(this,args);};
    }
  });
  await page.goto('/?buildings=baked');
  await page.waitForFunction(()=>window.__ug?.intro.getPhase()==='done'&&__ug.lateLayers.settled()
    &&__ug.player.loaded&&__ug.roads.stats.state==='ready',null,{timeout:240000});
  const count=await page.evaluate(()=>__entryPrograms.length);
  await page.evaluate(()=>__ug.modes.activate('pedestrian'));
  await page.waitForFunction(()=>{
    const d=__ug.modes.registry.get('pedestrian').debug();
    return d.phase==='body'&&!d.ease.running&&__ug.modes.ctx.playerView.figureLoaded();
  },null,{timeout:60000});
  await page.waitForTimeout(1200);
  expect(await page.evaluate(()=>__entryPrograms.length)).toBe(count);
  expect(errors).toEqual([]);
});
