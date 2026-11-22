// Constructed only for ?fps=1. No listener, DOM or sample collection otherwise.
export function createFrameTimeReadout({ getRung, document = globalThis.document }) {
  const output = document.createElement('output');
  output.id = 'ug-frame-time';
  output.setAttribute('aria-label', 'Frame time over the last five seconds');
  output.style.cssText = 'position:fixed;left:12px;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:2000;pointer-events:none;background:#15191fee;color:#fff;padding:7px 10px;border:1px solid #727881;border-radius:4px;font:12px/1.4 ui-monospace,monospace;white-space:pre';
  output.textContent = 'Frame time: measuring…';
  document.body.append(output);
  const samples = [];
  let previous = null, lastPaint = 0;
  return {
    update(now) {
      if (previous !== null && now > previous) samples.push([now, now-previous]);
      previous = now;
      while (samples.length && samples[0][0] <= now-5000) samples.shift();
      if (now-lastPaint < 500 || !samples.length) return;
      lastPaint = now;
      const values = samples.map(s=>s[1]).sort((a,b)=>a-b), n=values.length;
      const median = n%2 ? values[n>>1] : (values[n/2-1]+values[n/2])/2;
      output.textContent = `5 s  median ${median.toFixed(1)} ms\np95 ${values[Math.ceil(n*.95)-1].toFixed(1)} ms  Auto ${getRung()}`;
    },
    dispose() { output.remove(); },
  };
}
