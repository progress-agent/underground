// Builders share one loading slice. Resume in a task after the frame's
// callbacks, so rendering time is never charged to the next loading slice.
let sliceStart = 0, nextFrame = null, budgetMs = 16;
export function setLoadingSliceBudget(ms) {budgetMs=ms;}
export function yieldMain() {
  if (typeof requestAnimationFrame !== 'function') return new Promise(resolve => setTimeout(resolve, 0));
  if (performance.now() - sliceStart < budgetMs) return;
  if (!nextFrame) nextFrame = new Promise(resolve => requestAnimationFrame(() => {
    const resume=()=>{sliceStart=performance.now();nextFrame=null;resolve();};
    if(globalThis.scheduler?.postTask)globalThis.scheduler.postTask(resume);
    else setTimeout(resume,0);
  }));
  return nextFrame;
}
