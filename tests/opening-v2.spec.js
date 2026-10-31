// The selected opening's defaults and inherited exits, observed from the live camera.
import {test,expect} from '@playwright/test';
const phases = () => {
  window.__chosenPhases=[];
  addEventListener('ug:opening-phase',e=>window.__chosenPhases.push(e.detail));
};
test('default cold opening: sky, tilt, radial rise, five-second plunge and the chosen landing',async({page})=>{
  await page.addInitScript(phases);
  await page.goto('/');
  await page.waitForFunction(()=>window.__ugOpening?.phases.some(p=>p.phase==='landed'),null,{timeout:60000});
  const r=await page.evaluate(()=>({record:window.__ugOpening,phases:window.__chosenPhases,
    pose:window.__ug.camera.position.toArray(),family:getComputedStyle(document.getElementById('ugSkyTitle')).fontFamily,
    font:document.fonts.check('44px "Eksell Display"'),title:document.getElementById('ugSkyTitle').textContent,
    phase:window.__ug.intro.getPhase(),mode:window.__ug.modes.activeId}));
  expect([r.record.variant,r.record.startAltM,r.record.vista]).toEqual([2,18000,'kings-cross']);
  const at=n=>r.phases.find(p=>p.phase===n)?.at;
  for(const n of ['cover-on','tilt-start','sweep-start','tilt-end','descent-begin','crossing','landed'])expect(at(n),n).toBeGreaterThan(0);
  expect(at('tilt-start')).toBeLessThan(at('descent-begin'));
  expect(at('sweep-start')).toBeLessThan(at('descent-begin'));
  expect(at('crossing')).toBeGreaterThan(at('descent-begin'));
  expect(at('landed')-at('descent-begin')).toBeGreaterThanOrEqual(4950);
  expect(at('landed')-at('descent-begin')).toBeLessThan(5500);
  expect(r.record.holdEver).toBe(false);
  for(const [i,e] of [420,-110,-2760].entries())expect(r.pose[i]).toBeCloseTo(e,6);
  expect(r.phase).toBe('done');expect(r.mode).toBe('deity');
  expect(r.family).toContain('Eksell Display');expect(r.font).toBe(true);expect(r.title).toBe('UNDER GROUND');
});
test('optional start and vista overrides fly and land at their selected pose',async({page})=>{
  await page.goto('/?ostart=12000&ovista=bank');
  await page.waitForFunction(()=>window.__ug?.intro.getPhase()==='done',null,{timeout:60000});
  const r=await page.evaluate(()=>({record:window.__ugOpening,p:window.__ug.camera.position.toArray(),expected:window.__ug.intro.getParams()}));
  expect(r.record.params.honoured).toEqual({start:true,vista:true});
  expect([r.record.startAltM,r.record.vista]).toEqual([12000,'bank']);
  for(const [i,e] of [r.expected.endX,r.expected.endY,r.expected.endZ].entries())expect(r.p[i]).toBeCloseTo(e,6);
});
for(const kind of ['key','touch'])test(`${kind} still skips to the selected landing and restores controls`,async({page})=>{
  await page.goto('/');
  await page.waitForFunction(()=>window.__ug?.intro.isPlaying(),null,{timeout:60000});
  if(kind==='key')await page.keyboard.press('Escape');
  else await page.evaluate(()=>document.dispatchEvent(new Event('touchstart')));
  await page.waitForFunction(()=>window.__ug.intro.getPhase()==='done',null,{timeout:15000});
  const r=await page.evaluate(()=>({p:window.__ug.camera.position.toArray(),orbit:window.__ug.controls.enabled,keys:window.__ug.fpsControls.enabled}));
  for(const [i,e] of [420,-110,-2760].entries())expect(r.p[i]).toBeCloseTo(e,6);expect(r.orbit&&r.keys).toBe(true);
});

for (const vista of ['constructor','__proto__','no-such-vista']) test(`invalid vista ${vista} falls back safely`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`/?ovista=${vista}&ostart=250`);
  await page.waitForFunction(()=>window.__ugOpening,null,{timeout:30000});
  const r=await page.evaluate(()=>window.__ugOpening);
  expect([r.vista,r.startAltM]).toEqual(['kings-cross',18000]);
  expect(r.params.honoured).toEqual({start:false,vista:false});
  expect(errors).toEqual([]);
});
