// opening-v3.js: opening study variant 3, "Through the clouds" (sprint 21Oct26w; a prototype preview, never live).
// A sunlit cloud deck (CSS over the canvas, so it keeps drifting while the main thread is busy) covers the first
// frames and thins in stages as the scene becomes ready; when it has cleared and the gate is done, the plunge begins.
import { createOpeningPath, cappedStartAltM } from './opening-path.js';
import { VISTA_BY_ID } from './opening-vistas.js';

export const V3_DEFAULT_VISTA = 'kings-cross'; // rule V3: best-ranked eligible vista tagged deep or junction not taken by V1 (westminster-eye) or V2 (jubilee-thames)
export const V3_DEFAULT_START_M = 25000;
export const V3_TOTAL_MS = 13000;
export const V3_TAU_MS = 600;
const FIRST_FOUR = ['terrain', 'water', 'm25', 'airports'];
const FALL_PER_S = 0.35;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Reads ?ostart= and ?ovista=, builds the path, records the phase container. Pure apart from window.__ugOpening. */
export function createV3Config({ search = '', masterValue = 1.1 } = {}) {
  const sp = new URLSearchParams(search);
  const rawStart = sp.get('ostart'), rawVista = sp.get('ovista');
  const startNum = rawStart == null ? NaN : Number(rawStart);
  const startOk = Number.isFinite(startNum) && startNum >= 3000 && startNum <= 30000;
  const vistaOk = rawVista != null && Object.prototype.hasOwnProperty.call(VISTA_BY_ID, rawVista);
  const vista = VISTA_BY_ID[vistaOk ? rawVista : V3_DEFAULT_VISTA];
  const startAltM = cappedStartAltM(startOk ? startNum : V3_DEFAULT_START_M, masterValue);
  const path = createOpeningPath({ C: vista.C, surfaceYAtC: vista.surfaceYAtC, E: vista.E, L: vista.L, startAltM,
    master: masterValue, totalMs: V3_TOTAL_MS, tauMs: V3_TAU_MS });
  const record = { variant: 3, startAltM, vista: vista.id, vistaName: vista.name, E: vista.E, L: vista.L, C: vista.C, phases: [],
    params: { ostart: rawStart, ovista: rawVista, honoured: { start: rawStart == null ? null : startOk, vista: rawVista == null ? null : vistaOk } } };
  if (typeof window !== 'undefined') window.__ugOpening = record;
  return { path, vista, startAltM, record };
}

export function createOpeningV3({ intro, gate, path, record, camera, deckEl, now = () => performance.now() }) {
  const q = (s) => deckEl?.querySelector(s);
  const base = q('.base'), l1 = q('.l1'), l2 = q('.l2'), l3 = q('.l3'), title = q('.title'), bar = q('.bar'), barFill = q('.bar i');
  const written = new Map();
  function style(el, key, v, fn) {
    if (!el) return;
    const prev = written.get(key);
    if (prev !== undefined && Math.abs(prev - v) <= 0.005 && v !== 0 && v !== 1) return;
    if (prev === v) return;
    written.set(key, v); fn(el, v);
  }
  const op = (el, key, v) => style(el, key, v, (e, x) => { e.style.opacity = String(x); });

  let c = 1, first = true, begun = false, crossed = false, hidden = false, liftedAt = null;
  const sampleMarks = [0.75, 0.5, 0.25]; let sampleIdx = 0;

  function phase(name, extra) {
    const st = gate.stage();
    const entry = { phase: name, at: now(), stage: st, fraction: gate.readiness.fraction(), ...(extra || {}) };
    record.phases.push(entry);
    try { window.dispatchEvent(new CustomEvent('ug:opening-phase', { detail: entry })); } catch (_) { /* noop */ }
  }

  window.addEventListener('ug:intro-done', () => {
    phase('landed', { camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z } });
    hideDeck();
  });

  function hideDeck() {
    if (hidden) return; hidden = true;
    if (deckEl) deckEl.hidden = true;
  }

  function target(snapshot, stage) {
    if (stage === 'done') return 0;
    const items = snapshot.items;
    const by = new Map(items.map(i => [i.id, i]));
    if (!FIRST_FOUR.every(id => !by.has(id) || by.get(id).status !== 'pending')) return 1;
    let tot = 0, done = 0;
    for (const i of items) {
      if (FIRST_FOUR.includes(i.id)) continue;
      tot += i.weight; done += i.weight * (i.status === 'pending' ? i.progress : 1);
    }
    const fRest = tot ? done / tot : 1;
    return 0.85 * (1 - fRest);
  }

  function apply() {
    op(base, 'base', clamp01((c - 0.66) / 0.34));
    op(l1, 'l1', clamp01((c - 0.66) / 0.34));
    op(l2, 'l2', clamp01((c - 0.33) / 0.33));
    op(l3, 'l3', clamp01(c / 0.33));
    const t = clamp01((c - 0.8) / 0.2);
    op(title, 'title', t); op(bar, 'bar', t);
    style(deckEl, 'scale', 1 + 0.35 * (1 - c), (e, x) => { e.style.transform = `scale(${x.toFixed(4)})`; });
  }

  function update(dt) {
    if (intro.isBypassed() || intro.getPhase() === 'done') { hideDeck(); return; }
    if (first) { first = false; phase('cover-on'); apply(); }
    if (!begun) {
      const snap = gate.readiness.snapshot(), stage = gate.stage();
      const tg = target(snap, stage);
      const step = FALL_PER_S * Math.min(Math.max(dt || 0, 0), 0.1);
      if (tg < c) c = Math.max(tg, c - step);
      if (barFill) { const w = `${Math.round(snap.fraction * 100)}%`; if (barFill.style.width !== w) barFill.style.width = w; }
      apply();
      if (liftedAt === null && c < 0.98) { liftedAt = now(); phase('cover-lifted', { c }); }
      while (sampleIdx < sampleMarks.length && c <= sampleMarks[sampleIdx]) { phase('coverage', { c, mark: sampleMarks[sampleIdx] }); sampleIdx++; }
      if (c < 0.02 && stage === 'done') {
        c = 0; apply();
        phase('deck-clear', { c });
        begun = true;
        phase('descent-begin', { c });
        intro.begin();
        setTimeout(hideDeck, 300);
      }
    } else if (!crossed && intro.isPlaying() && path.arcAt(intro.getPlayedMs()) >= path.uC) {
      crossed = true; phase('crossing');
    }
  }

  return { update, coverage: () => c, rendering: () => c < 0.97, onReady: () => { /* the director begins the descent itself, on deck-clear */ } };
}
