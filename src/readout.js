// readout.js — Beta v7 readout widget (substrate, altitude, compass dial).
//
// Self-contained — injects Spectral font link, own <style id="readout-styles">,
// and appends #ug-readout to document.body. Replaces the legacy #compass +
// #altimeter HUD elements from index.html.
//
// API:
//   initReadout() → { update(azimuthRad, altM, substrate), isRevealed(), _root }
//
// substrate: 'AIR' | 'CLAY' | 'CHALK' | 'WATER'
// azimuthRad: from OrbitControls.getAzimuthalAngle() (radians, range [-π, π])
// altM: real-world metres above (+) or below (−) terrain surface
//
// Spec: _REPORTS/25Apr26s/wAr-BetaV7MicroTweaks-2312.md
// Mock: _REPORTS/25Apr26s/sources/ug-readout-mocks/v7.html

const STYLE_ID = 'readout-styles';
const ROOT_ID  = 'ug-readout';

const CSS = `
#ug-readout {
  position: fixed;
  right: 16px;
  bottom: 26px;
  z-index: 28;
  display: flex;
  flex-direction: column;
  align-items: center;
  user-select: none;
  pointer-events: none;
  font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  width: 150px;
}

/* ── SUBSTRATE ── */
#ug-readout .sub-glyph {
  font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  line-height: 1;
  transform: translateX(0.1em);
  transition: color 220ms ease, text-shadow 220ms ease;
  margin-bottom: 4px;
}
#ug-readout[data-substrate="AIR"] .sub-glyph {
  color: rgba(255,255,255,0.58);
  text-shadow: 0 0 12px rgba(255,255,255,0.20);
}
#ug-readout[data-substrate="CLAY"] .sub-glyph {
  color: #c9b896;
  text-shadow:
    0 0 6px  rgba(199,184,150,0.7),
    0 0 14px rgba(199,184,150,0.45),
    0 0 28px rgba(199,184,150,0.22),
    0 0 42px rgba(199,184,150,0.10);
}
#ug-readout[data-substrate="CHALK"] .sub-glyph {
  color: #f5f0e3;
  text-shadow:
    0 0 6px  rgba(245,240,227,0.85),
    0 0 14px rgba(245,240,227,0.55),
    0 0 28px rgba(245,240,227,0.30),
    0 0 42px rgba(245,240,227,0.15);
}
#ug-readout[data-substrate="WATER"] .sub-glyph {
  color: #a78bfa;
  text-shadow:
    0 0 6px  rgba(167,139,250,0.7),
    0 0 14px rgba(167,139,250,0.45),
    0 0 28px rgba(167,139,250,0.22),
    0 0 42px rgba(167,139,250,0.10);
}

/* ── ALTITUDE ── */
#ug-readout .alt-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  line-height: 1;
  margin-bottom: 24px;
}
#ug-readout .alt-sign {
  font-family: 'Spectral', 'IBM Plex Serif', Georgia, serif;
  font-size: 21px;
  font-weight: 600;
  color: rgba(250,250,250,0.94);
  line-height: 1;
  margin-right: 1px;
  text-shadow: 0 0 14px rgba(255,255,255,0.18);
}
#ug-readout .alt-value {
  font-family: 'Spectral', 'IBM Plex Serif', Georgia, serif;
  font-size: 23px;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: rgba(250,250,250,0.94);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 14px rgba(255,255,255,0.18);
}
#ug-readout .alt-unit {
  font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: rgba(255,255,255,0.58);
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-left: 4px;
}

/* ── COMPASS DIAL ── */
#ug-readout .compass-dial {
  position: relative;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  margin-bottom: 12px;
}
#ug-readout .dial-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.10);
  background:
    radial-gradient(1.6px 1.6px at 50% 4%, rgba(199,184,150,0.95), transparent 60%),
    radial-gradient(1.2px 1.2px at 50% 96%, rgba(255,255,255,0.30), transparent 60%),
    radial-gradient(1.2px 1.2px at 4% 50%, rgba(255,255,255,0.30), transparent 60%),
    radial-gradient(1.2px 1.2px at 96% 50%, rgba(255,255,255,0.30), transparent 60%),
    radial-gradient(0.8px 0.8px at 85% 15%, rgba(255,255,255,0.16), transparent 60%),
    radial-gradient(0.8px 0.8px at 85% 85%, rgba(255,255,255,0.16), transparent 60%),
    radial-gradient(0.8px 0.8px at 15% 85%, rgba(255,255,255,0.16), transparent 60%),
    radial-gradient(0.8px 0.8px at 15% 15%, rgba(255,255,255,0.16), transparent 60%);
}
#ug-readout .dial-needle-wrap {
  position: absolute;
  inset: 0;
  transform-origin: center;
  transition: transform 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
  pointer-events: none;
}
#ug-readout .dial-needle {
  position: absolute;
  top: 5px;
  left: 50%;
  transform: translateX(-50%);
  width: 1.5px;
  height: 21px;
  background: linear-gradient(to bottom, #c9b896 0%, #c9b896 75%, rgba(199,184,150,0.18) 100%);
  border-radius: 1px;
  box-shadow: 0 0 5px rgba(199,184,150,0.45);
}
#ug-readout .dial-needle-counter {
  position: absolute;
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
  width: 1.5px;
  height: 7px;
  background: rgba(255,255,255,0.18);
  border-radius: 1px;
}
#ug-readout .dial-n {
  position: absolute;
  top: -13px;
  left: 50%;
  transform: translateX(-50%);
  font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.2em;
  color: rgba(199,184,150,0.95);
  text-shadow:
    0 0 6px rgba(199,184,150,0.5),
    0 0 12px rgba(199,184,150,0.25);
  pointer-events: none;
}

/* ── HEADING NUMERIC ── */
#ug-readout .compass-az {
  font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 500;
  color: rgba(255,255,255,0.58);
  letter-spacing: 0.2em;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
`;

const HTML = `
<div id="${ROOT_ID}" data-substrate="AIR">
  <div class="sub-glyph" id="ug-readout-sub">AIR</div>
  <div class="alt-row">
    <span class="alt-sign" id="ug-readout-sign">+</span
    ><span class="alt-value" id="ug-readout-alt">0</span
    ><span class="alt-unit">m</span>
  </div>
  <div class="compass-dial">
    <div class="dial-ring"></div>
    <div class="dial-needle-wrap" id="ug-readout-needle">
      <div class="dial-needle"></div>
      <div class="dial-needle-counter"></div>
    </div>
    <div class="dial-n">N</div>
  </div>
  <div class="compass-az" id="ug-readout-az">000°</div>
</div>
`;

function injectSpectral() {
  if (document.querySelector('[data-readout-spectral]')) return;
  const pc1 = document.createElement('link');
  pc1.rel = 'preconnect';
  pc1.href = 'https://fonts.googleapis.com';
  const pc2 = document.createElement('link');
  pc2.rel = 'preconnect';
  pc2.href = 'https://fonts.gstatic.com';
  pc2.crossOrigin = '';
  const lnk = document.createElement('link');
  lnk.rel = 'stylesheet';
  lnk.href = 'https://fonts.googleapis.com/css2?family=Spectral:wght@300;400;500;600&display=swap';
  lnk.dataset.readoutSpectral = '';
  document.head.append(pc1, pc2, lnk);
}

export function initReadout() {
  injectSpectral();

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  if (!document.getElementById(ROOT_ID)) {
    document.body.insertAdjacentHTML('beforeend', HTML);
  }

  const root       = document.getElementById(ROOT_ID);
  const subCell    = document.getElementById('ug-readout-sub');
  const altSign    = document.getElementById('ug-readout-sign');
  const altCell    = document.getElementById('ug-readout-alt');
  const needleWrap = document.getElementById('ug-readout-needle');
  const azCell     = document.getElementById('ug-readout-az');

  function update(azimuthRad, altM, substrate) {
    // Substrate label + colour
    root.dataset.substrate = substrate;
    subCell.textContent = substrate;

    // Altitude sign and value
    altSign.textContent = altM < 0 ? '−' : '+';
    altCell.textContent = Math.abs(altM);

    // Compass needle — OrbitControls azimuth maps directly to CSS rotation.
    // Negate because a clockwise camera orbit (increasing azimuth) should show
    // north moving counter-clockwise on the dial.
    const azDeg = azimuthRad * (180 / Math.PI);
    needleWrap.style.transform = `rotate(${-azDeg}deg)`;

    // Numeric heading: 0–359°, 000-padded
    const headingDeg = Math.round(((azDeg % 360) + 360) % 360);
    azCell.textContent = String(headingDeg).padStart(3, '0') + '°';
  }

  return { update, _root: root, _subCell: subCell, _altCell: altCell, _azCell: azCell, _needleWrap: needleWrap };
}
