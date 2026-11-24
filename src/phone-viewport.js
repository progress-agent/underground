// A resize event/observer owns layout reads; flying never asks the DOM for size.
export function createPhoneViewport(canvas,{view=globalThis.window,Observer=globalThis.ResizeObserver}={}){
  let windowHeight=view.innerHeight;
  const state={w:canvas.clientWidth,h:canvas.clientHeight,nativeHeight:windowHeight*(view.devicePixelRatio||1)};
  const resize=()=>{windowHeight=view.innerHeight;state.nativeHeight=windowHeight*(view.devicePixelRatio||1);if(!Observer){state.w=canvas.clientWidth;state.h=canvas.clientHeight;}};
  const observer=Observer?new Observer(entries=>{for(const e of entries)if(e.target===canvas){state.w=Math.round(e.contentRect.width);state.h=Math.round(e.contentRect.height);}}):null;
  observer?.observe(canvas);view.addEventListener('resize',resize);
  return{state,get windowHeight(){return windowHeight},dispose(){observer?.disconnect();view.removeEventListener('resize',resize);}};
}
