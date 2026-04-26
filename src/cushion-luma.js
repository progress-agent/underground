// Per-tooltip scene-luminance sampler. Reads framebuffer pixels under the
// hover tooltip after each render, computes Rec. 709 luma, and toggles the
// `.cushion-light` class on `#hoverTip` so the Halo CSS can swap to a
// light cushion + dark ink when the scene behind the tooltip is bright.
//
// Replaces the mock's body-level `.tile.light` strategy — that doesn't
// survive in production where the cursor traverses gradients within a
// single hover. This module samples the actual pixels under the tip.
//
// gl.readPixels forces a GPU pipeline flush. To keep the cost bounded we
// only sample while the tooltip is visible (display:block); when hidden
// (the common case) sampleCushion() is a one-property short-circuit.

const SAMPLE_SIZE = 8;          // px region around tooltip centre
const LUMA_THRESHOLD = 0.55;    // 0..1; above => light cushion
const HYSTERESIS = 0.05;        // band that prevents class flip-flop

let _renderer = null;
let _gl = null;
let _tip = null;
let _buffer = null;
let _isLight = false;

export function initCushionLuma(renderer) {
  _renderer = renderer;
  _gl = renderer.getContext();
  _tip = document.getElementById('hoverTip');
  _buffer = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE * 4);
}

export function sampleCushion() {
  if (!_renderer || !_tip || _tip.style.display !== 'block') return;
  const dpr = _renderer.getPixelRatio();
  const canvas = _renderer.domElement;
  const cssH = canvas.clientHeight;
  const r = _tip.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // CSS px -> framebuffer px (DPR + WebGL Y-flip: origin bottom-left).
  const fbX = Math.round(cx * dpr - SAMPLE_SIZE / 2);
  const fbY = Math.round((cssH - cy) * dpr - SAMPLE_SIZE / 2);
  if (fbX < 0 || fbY < 0
      || fbX + SAMPLE_SIZE > canvas.width
      || fbY + SAMPLE_SIZE > canvas.height) return;

  _gl.readPixels(fbX, fbY, SAMPLE_SIZE, SAMPLE_SIZE, _gl.RGBA, _gl.UNSIGNED_BYTE, _buffer);

  let sum = 0;
  for (let i = 0; i < _buffer.length; i += 4) {
    sum += 0.2126 * _buffer[i] + 0.7152 * _buffer[i + 1] + 0.0722 * _buffer[i + 2];
  }
  const luma = sum / (SAMPLE_SIZE * SAMPLE_SIZE * 255);

  // Hysteresis: once the light state is set, only flip back when luma drops
  // clearly below threshold (and vice versa). Stops chatter when the tooltip
  // sits over a luma value near the boundary.
  const wantLight = _isLight
    ? luma > (LUMA_THRESHOLD - HYSTERESIS)
    : luma > (LUMA_THRESHOLD + HYSTERESIS);

  if (wantLight !== _isLight) {
    _isLight = wantLight;
    _tip.classList.toggle('cushion-light', _isLight);
  }
}

// Reset polarity when the tooltip is hidden so a re-show on a dark mesh
// never carries stale light state from the previous hover.
export function resetCushion() {
  if (!_tip) return;
  if (_isLight) {
    _isLight = false;
    _tip.classList.remove('cushion-light');
  }
}

// Dev introspection (exposed on window.__ug).
export function _cushionState() {
  return { isLight: _isLight, sampleSize: SAMPLE_SIZE, threshold: LUMA_THRESHOLD };
}
