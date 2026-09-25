// sky-looks.js: the numbers of the one analytic sky, Clear (sprint 24Sep26h
// Lane S, D-038; reduced to Clear only in sprint 25Sep26f Lane L, D-039).
//
// Sprint 24Sep26h shipped three switchable looks (Clear, London haze, Steel)
// plus a Flat before-image, chosen with ?sky=<name> or a hidden Sky row, so
// Jordan could pick at review. He picked Clear (25Sep26f): the other looks, the
// Flat comparison, the Sky row and the ?sky= parameter are retired. A stale
// ?sky= link is ignored (and, as before, does not skip the opening).
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
// The sky also blends with the 23Sep26w Dawn-to-Dusk keyframes in sun.js:
//   keyIllum  mixes the analytic sunlight colour towards the slider's sun
//             colour (so the sky warms exactly when the city's light warms);
//   keyMix    mixes the finished sky towards the slider's sky keyframe colour.
//
// Sun glare (25Sep26f Lane L). The disc used to be written at 38x the sun
// colour and left to UnrealBloom, whose blur of so hot a point is a large soft
// SQUARE. The disc is now a modest, fixed luminance just over the bloom
// threshold (discLuminance), and the glow round the sun is painted by the sky
// shader itself (aureole*): round on screen, on the sky only, so it never
// spills over the ground or the horizon in front of it.

export const CLEAR_SKY = Object.freeze({
  label: 'Clear',
  description: 'Clean air: deep blue overhead, pale horizon, a round glow round the sun.',
  rayleigh: 1.0,
  mie: 0.06,
  mieG: 0.8,
  mieGain: 0.25,
  sunIllum: 1.25,
  airmassK: 0.4,
  ambient: 0.45,
  ambientHue: Object.freeze([0.45, 0.62, 1.0]),
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
  // Disc luminance (linear), high sun. Over UnrealBloom's 0.88 threshold, so
  // the disc still flares a little, but not by the old factor of about 40.
  discLuminance: 2.4,
  // Painted aureole: two exponential falloffs in on-screen angle (degrees),
  // scaled by the sun's light. A tight core and a wide soft skirt.
  aureoleCore: 0.55,
  aureoleCoreDeg: 0.9,
  aureoleSkirt: 0.22,
  aureoleSkirtDeg: 6,
});

/** The only sky there is. Kept as a one-entry table for callers of the old API. */
export const SKY_LOOKS = Object.freeze({ clear: CLEAR_SKY });

export const DEFAULT_SKY_LOOK = 'clear';

export function skyLookNames() { return Object.keys(SKY_LOOKS); }
