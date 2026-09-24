// sky-looks.js: the switchable looks for the analytic sky (sprint 24Sep26h,
// Lane S, D-038). Taste is Jordan's: every look runs through the same shader
// (src/sky.js) and differs only in these numbers, so a look can be chosen at
// review with ?sky=<name> (or the hidden settings row) and the losing looks
// deleted afterwards without touching any code path.
//
// Units. The sky is a single-scattering model with a constant-density
// atmosphere, evaluated per pixel:
//   in-scatter = sunlight * (tauR * phaseR + tauM * phaseM) / (tauR + tauM)
//                * (1 - exp(-(tauR + tauM) * airmass))
// tau values are ZENITH optical depths (dimensionless). Rayleigh is per
// channel (red, green, blue at roughly 680, 550 and 440 nm, which is where the
// blue of the sky and the whitening of the horizon come from); Mie (haze,
// aerosol) is grey with a forward-scattering Henyey-Greenstein lobe (the glow
// around the sun). All colours are linear working-space multipliers.
//
// Every look also blends with the 23Sep26w Dawn-to-Dusk keyframes in sun.js:
//   keyIllum  mixes the analytic sunlight colour towards the slider's sun
//             colour (so the sky warms exactly when the city's light warms);
//   keyMix    mixes the finished sky towards the slider's sky keyframe colour
//             (the old flat clear colour, 0x5a7a8f at the default morning).

export const SKY_LOOKS = {
  // Clean, deep sky: strongest blue at the zenith, pale bright horizon, a
  // tight sun glow; violet zenith and a warm band at dawn and dusk. The most
  // "beautiful day" of the three, and the recommended default.
  clear: {
    label: 'Clear',
    description: 'Clean air: deep blue overhead, pale horizon, tight glow round the sun.',
    rayleigh: 1.0,
    mie: 0.06,
    mieG: 0.8,
    mieGain: 0.25,
    sunIllum: 1.25,
    airmassK: 0.4,
    ambient: 0.45,
    ambientHue: [0.45, 0.62, 1.0],
    keyIllum: 0.55,
    keyMix: 0.0,
    horizonGlow: 0.12,
    lowSunGlow: 4,
    horizonGlowPow: 5,
    exposure: 1.5,
    saturation: 1.0,
    fogCoupling: 1.0,
    fogGain: 1.0,
    fogMaxLum: 0.55,
    discIntensity: 38,
  },
  // London haze: more aerosol, a milky horizon band and a wide soft glow; the
  // distance dissolves into soft grey-blue.
  haze: {
    label: 'London haze',
    description: 'Hazy city air: softer blue, milky horizon, wide warm glow, distance melts into the sky.',
    rayleigh: 0.95,
    mie: 0.2,
    mieG: 0.72,
    mieGain: 0.22,
    sunIllum: 1.2,
    airmassK: 0.3,
    ambient: 0.45,
    ambientHue: [0.55, 0.66, 0.9],
    keyIllum: 0.65,
    keyMix: 0.0,
    horizonGlow: 0.15,
    lowSunGlow: 3,
    horizonGlowPow: 3,
    exposure: 1.25,
    saturation: 0.9,
    fogCoupling: 1.0,
    fogGain: 1.0,
    fogMaxLum: 0.55,
    discIntensity: 30,
  },
  // Steel: the old muted steel-blue, now with depth: it keeps most of the
  // slider's flat sky colour and adds a gentle gradient, glow and horizon.
  // The least change from what Jordan has been looking at.
  steel: {
    label: 'Steel',
    description: 'Closest to the old steel-blue: muted colour, gentle gradient and glow.',
    rayleigh: 0.9,
    mie: 0.14,
    mieG: 0.75,
    mieGain: 0.8,
    sunIllum: 1.1,
    airmassK: 0.2,
    ambient: 0.12,
    ambientHue: [0.5, 0.62, 0.85],
    keyIllum: 0.7,
    keyMix: 0.55,
    horizonGlow: 0.18,
    lowSunGlow: 2,
    horizonGlowPow: 4,
    exposure: 0.9,
    saturation: 0.75,
    fogCoupling: 0.6,
    fogGain: 1.0,
    fogMaxLum: 0.55,
    discIntensity: 28,
  },
};

/** The look a fresh visit gets. Chosen by wA; Jordan decides at review. */
export const DEFAULT_SKY_LOOK = 'clear';

/**
 * Not a look: the pre-sprint flat clear colour, kept only so review can A/B
 * against today's picture with ?sky=flat. The sun disc still draws.
 */
export const FLAT_SKY = 'flat';

export function skyLookNames() { return Object.keys(SKY_LOOKS); }

/** Normalise a requested name; unknown or empty names fall back to the default. */
export function resolveSkyLookName(name) {
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (n === FLAT_SKY) return FLAT_SKY;
  return Object.prototype.hasOwnProperty.call(SKY_LOOKS, n) ? n : DEFAULT_SKY_LOOK;
}
