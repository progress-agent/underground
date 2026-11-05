// Builders share one loading slice. Resume in a task after the frame's
// callbacks, so rendering time is never charged to the next loading slice.
let sliceStart = 0, nextFrame = null, budgetMs = 16;
const waiting = [];
export function setLoadingSliceBudget(ms) {budgetMs=ms;}
function resumeNext() {
  if (!waiting.length) return;
  if (performance.now() - sliceStart >= budgetMs) { scheduleFrame(); return; }
  waiting.shift()();
  // Let that builder do its work before deciding whether another one fits.
  // Resolving one shared promise woke every builder against the same fresh
  // budget, so several chunks could overrun it in a single visible frame.
  queueMicrotask(resumeNext);
}
function scheduleFrame() {
  if (nextFrame !== null) return;
  nextFrame = requestAnimationFrame(() => {
    const resume = () => { sliceStart = performance.now(); nextFrame = null; resumeNext(); };
    if (globalThis.scheduler?.postTask) globalThis.scheduler.postTask(resume);
    else setTimeout(resume, 0);
  });
}
export function yieldMain() {
  if (typeof requestAnimationFrame !== 'function') return new Promise(resolve => setTimeout(resolve, 0));
  if (performance.now() - sliceStart < budgetMs) return;
  return new Promise(resolve => { waiting.push(resolve); scheduleFrame(); });
}
