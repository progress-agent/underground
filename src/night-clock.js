// Clock geometry is independent of rendering. Keep the inherited daylight path exact.
export const wrapHour = h => ((h % 24) + 24) % 24;
export const hourFromPoint = (x, y) => wrapHour(12 + Math.atan2(x, -y) * 12 / Math.PI);
export function nightAmount(hour) {
  const h = wrapHour(hour);
  const t = h >= 18 ? (h - 18) / 2 : h <= 6 ? (6 - h) / 2 : 0;
  const n = Math.min(1, Math.max(0, t));
  return n * n * (3 - 2 * n);
}
export function litFraction(hour) {
  const h = wrapHour(hour);
  return h >= 18 ? 0.78 - (h - 18) * 0.035 : 0.57 - h * 0.075;
}
export function mountClock(system, row) {
  row.innerHTML = `<span>Time</span><div id="sunTime" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="0" aria-valuemax="24" style="position:relative;width:174px;height:174px;touch-action:none;user-select:none;cursor:pointer;display:inline-block;vertical-align:middle">
  <svg viewBox="0 0 174 174" width="174" height="174" aria-hidden="true" style="display:block;color:inherit">
  <circle cx="87" cy="87" r="57" fill="none" stroke="currentColor" stroke-opacity=".35"/>
  <g fill="currentColor" font-size="11" text-anchor="middle"><text x="87" y="15">Noon</text><text x="87" y="168">Midnight</text><text x="16" y="91">Dawn</text><text x="158" y="91">Dusk</text></g>
  <line id="clockHand" x1="87" y1="87" x2="87" y2="36" stroke="currentColor" stroke-width="1.6"/>
  <circle id="clockDot" cx="87" cy="30" r="5" fill="currentColor"/>
  <text id="clockText" x="87" y="113" fill="currentColor" text-anchor="middle" font-size="13" style="font-variant-numeric:tabular-nums"></text></svg></div>`;
  const dial = row.querySelector('#sunTime'), hand = row.querySelector('#clockHand'), dot = row.querySelector('#clockDot'), text = row.querySelector('#clockText');
  const render = () => {
    const h = system.hour, a = (h - 12) * Math.PI / 12;
    const x = Math.sin(a), y = -Math.cos(a);
    hand.setAttribute('x2', 87 + 49 * x); hand.setAttribute('y2', 87 + 49 * y);
    dot.setAttribute('cx', 87 + 57 * x); dot.setAttribute('cy', 87 + 57 * y);
    const m = Math.floor(h * 60 + 1e-7) % 1440, label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    dial.setAttribute('aria-valuenow', h.toFixed(3)); dial.setAttribute('aria-valuetext', label); text.textContent = label;
  };
  let pointer = null;
  const move = e => {
    const r = dial.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) > 15) system.setHour(hourFromPoint(x, y));
  };
  dial.addEventListener('pointerdown', e => { if (pointer !== null || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); pointer = e.pointerId; dial.focus(); dial.setPointerCapture(pointer); move(e); });
  dial.addEventListener('pointermove', e => { if (e.pointerId === pointer) { e.preventDefault(); move(e); } });
  const release = e => { if (e.pointerId === pointer) pointer = null; };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) dial.addEventListener(name, release);
  dial.addEventListener('keydown', e => {
    e.stopPropagation();
    let h = system.hour;
    if (['ArrowRight','ArrowUp'].includes(e.key)) h += e.shiftKey ? 1 : 1 / 6;
    else if (['ArrowLeft','ArrowDown'].includes(e.key)) h -= e.shiftKey ? 1 : 1 / 6;
    else if (e.key === 'PageUp') h += 1;
    else if (e.key === 'PageDown') h -= 1;
    else if (e.key === 'Home') h = 0;
    else if (e.key === 'End') h = 23 + 59 / 60;
    else { if(e.key === ' ')e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation(); system.setHour(h);
  });
  system.onChange(render); render();
  return dial;
}
