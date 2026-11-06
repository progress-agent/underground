import {test,expect,devices} from '@playwright/test';

// Real DOM, SVG geometry and browser input, using the production control on a
// small fixture so the 2,880-minute sweep does not repeatedly render the city.
async function fixture(page){
 await page.route('**/clock-fixture',r=>r.fulfill({contentType:'text/html',body:`
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:20px;color:#eee;background:#20242b;font:12px Arial}p{margin:0}</style>
  <p id="sunControlRow"></p><script type="module">
  import {mountClock,wrapHour} from '/src/night-clock.js';
  const listeners=[];
  window.clock={hour:12,history:[],onChange(fn){listeners.push(fn)},setHour(h){
   this.hour=wrapHour(h);for(const fn of listeners)fn();
   this.history.push({hour:this.hour,label:document.querySelector('#clockText').textContent});
  }};
  mountClock(window.clock,document.querySelector('p'));
  </script>`}));
 await page.goto('/clock-fixture');await page.waitForFunction(()=>window.clock);
}
const point=(r,m)=>{const a=(m/60-12)*Math.PI/12;return{x:r.x+r.width/2+57*Math.sin(a),y:r.y+r.height/2-57*Math.cos(a)}};
const label=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

test('pointer drag and taps show every intended minute; sky hour remains continuous',async({page})=>{
 await fixture(page);const r=await page.locator('#sunTime').boundingBox();
 const first=point(r,0);await page.mouse.move(first.x,first.y);await page.mouse.down();
 for(let m=1;m<1440;m++){const p=point(r,m);await page.mouse.move(p.x,p.y);}
 await page.mouse.up();
 const history=await page.evaluate(()=>window.clock.history);
 expect(history).toHaveLength(1440);
 for(let m=0;m<1440;m++){expect(history[m].label,`minute ${m}`).toBe(label(m));expect(Math.abs(history[m].hour-m/60)).toBeLessThan(.0001);}
 for(const m of [0,1,59,60,720,1379,1380,1439]){const p=point(r,m);await page.mouse.click(p.x,p.y);await expect(page.locator('#sunTime')).toHaveAttribute('aria-valuetext',label(m));}
 const p=point(r,601.25);await page.mouse.click(p.x,p.y);
 expect(await page.evaluate(()=>window.clock.hour)).toBeCloseTo(601.25/60,4);
});

test('keyboard minute arithmetic wraps correctly from all 1440 starting minutes',async({page})=>{
 await fixture(page);await page.locator('#sunTime').focus();
 const failures=await page.evaluate(()=>{
  const failures=[],dial=document.querySelector('#sunTime');
  for(let m=0;m<1440;m++)for(const [key,delta]of [['ArrowRight',10],['ArrowLeft',-10],['PageUp',60],['PageDown',-60]]){
   window.clock.setHour(m/60);dial.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
   const wanted=(m+delta+1440)%1440,text=`${String(Math.floor(wanted/60)).padStart(2,'0')}:${String(wanted%60).padStart(2,'0')}`;
   if(dial.getAttribute('aria-valuetext')!==text)failures.push({m,key,text,actual:dial.getAttribute('aria-valuetext')});
  }return failures;
 });expect(failures).toEqual([]);
 await page.keyboard.press('Home');await expect(page.locator('#sunTime')).toHaveAttribute('aria-valuetext','00:00');
 await page.keyboard.press('End');await expect(page.locator('#sunTime')).toHaveAttribute('aria-valuetext','23:59');
});

test('the clear moon halo has no outward brightness jump over one 8-bit level',async({page})=>{
 await page.addInitScript(()=>{
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>raf(t=>{if(!window.holdSky||cb.name!=='tick')cb(t);});
 });
 await page.goto('/?skip=1');await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ugSun,null,{timeout:90000});
 await page.evaluate(()=>{
  const u=window.__ug;u.controls.enableDamping=false;u.setRenderQualityMode('manual');u.renderQuality.set({scale:1,samples:4});
  window.__ugSun.setHour(23,{persist:false});u.camera.position.set(0,10000,0);
  u.controls.target.copy(u.camera.position).addScaledVector(window.__ugSun.state.direction,1000);u.controls.update();
 });
 await page.waitForTimeout(300);
 const rays=await page.evaluate(()=>{
  window.holdSky=true;const u=window.__ug;
  // Remove clouds, stars and the city for the clear-sky criterion; retain the
  // live bloom, lens and OutputPass, and score the final 8-bit framebuffer.
  u.scene.traverse(o=>{if(o.isMesh||o.isPoints||o.isLine||o.isSprite)o.visible=o.name==='analyticSky';});
  u.composer.render(0);const gl=u.composer.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,px=new Uint8Array(W*H*4);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const rays=[];
  for(let j=0;j<8;j++){const a=j*Math.PI/4,values=[];
   for(let r=10;r<Math.min(180,H/3);r++){const x=Math.round(W/2+r*Math.cos(a)),y=Math.round(H/2+r*Math.sin(a)),i=(y*W+x)*4;values.push(.2126*px[i]+.7152*px[i+1]+.0722*px[i+2]);}
   let maxUp=0;for(let i=1;i<values.length;i++)maxUp=Math.max(maxUp,values[i]-values[i-1]);rays.push({angle:j*45,maxUp});
  }return rays;
 });
 for(const r of rays)expect(r.maxUp,`radius ${r.angle} degrees`).toBeLessThanOrEqual(1.00001);
});

for(const orientation of ['portrait','landscape'])test.describe(`phone clock ${orientation}`,()=>{
 const {defaultBrowserType,...phone}=devices[orientation==='portrait'?'iPhone 15 Pro':'iPhone 15 Pro landscape'];test.use(phone);
 test('96 quarter-hour readings have no label or hand overlap',async({page})=>{
  await fixture(page);
  const failures=await page.evaluate(()=>{
   const failures=[],dial=document.querySelector('#sunTime'),title=dial.previousElementSibling,dawn=[...dial.querySelectorAll('text')].find(t=>t.textContent==='Dawn'),text=document.querySelector('#clockText'),hand=document.querySelector('#clockHand');
   const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   for(let m=0;m<1440;m+=15){window.clock.setHour(m/60);
    if(intersects(title.getBoundingClientRect(),dawn.getBoundingClientRect()))failures.push({m,kind:'Time/Dawn'});
    if(intersects(hand.getBoundingClientRect(),text.getBoundingClientRect()))failures.push({m,kind:'hand/readout'});
   }return failures;
  });expect(failures).toEqual([]);
 });
 test('the actual menu sheet keeps the labels clear at every quarter hour',async({page},testInfo)=>{
  await page.goto('/?skip=1');
  await page.waitForFunction(()=>window.__ug?.groundReady&&window.__ugSun,null,{timeout:90000});
  await page.evaluate(()=>{document.querySelector('#hudDetails').open=true;});
  await page.locator('#sunTime').scrollIntoViewIfNeeded();
  const failures=await page.evaluate(()=>{
   const failures=[],dial=document.querySelector('#sunTime'),title=dial.previousElementSibling,dawn=[...dial.querySelectorAll('text')].find(t=>t.textContent==='Dawn'),text=document.querySelector('#clockText'),hand=document.querySelector('#clockHand');
   const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   for(let m=0;m<1440;m+=15){window.__ugSun.setHour(m/60,{persist:false});
    if(intersects(title.getBoundingClientRect(),dawn.getBoundingClientRect()))failures.push({m,kind:'Time/Dawn'});
    if(intersects(hand.getBoundingClientRect(),text.getBoundingClientRect()))failures.push({m,kind:'hand/readout'});
   }window.__ugSun.setHour(23,{persist:false});return failures;
  });expect(failures).toEqual([]);
  const readout=await page.locator('#clockText').boundingBox(),sheet=await page.locator('.hud').boundingBox();
  expect(readout.x).toBeGreaterThanOrEqual(sheet.x);
  expect(readout.x+readout.width).toBeLessThanOrEqual(sheet.x+sheet.width);
  expect(readout.y).toBeGreaterThanOrEqual(sheet.y);
  expect(readout.y+readout.height).toBeLessThanOrEqual(sheet.y+sheet.height);
  await page.screenshot({path:testInfo.outputPath(`phone-clock-${orientation}.png`)});
 });
 test('real touch drag shows every whole minute',async({page,context})=>{
  await fixture(page);const r=await page.locator('#sunTime').boundingBox(),cdp=await context.newCDPSession(page);
  const touch=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{...p,id:7}]:[]});
  await touch('touchStart',point(r,0));
  for(let m=1;m<1440;m++)await touch('touchMove',point(r,m));
  await touch('touchEnd');const history=await page.evaluate(()=>window.clock.history);
  expect(history).toHaveLength(1440);
  for(let m=0;m<1440;m++){expect(history[m].label,`minute ${m}`).toBe(label(m));expect(Math.abs(history[m].hour-m/60)).toBeLessThan(.0001);}
 });
});
