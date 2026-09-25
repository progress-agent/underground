// clouds-presets.js: sky presets for the cloud layer (sprint 25Sep26f, Lane C, D-039).
//
// A preset is DATA: everything that decides what a sky looks like, and nothing
// about how it is drawn. The cloud system (clouds.js) and the pure field model
// (clouds-field.js) read one preset and never hard-code a weather.
//
// Jordan's ruling (cloud-scope answers, 24Sep26h): the default is a permanent
// fair-weather cumulus sky at 2 to 3 oktas. Other weathers and rain are
// expected later, so this is a registry with one entry; a later preset (a
// stratocumulus deck, a low stratus lid drawn with fog, rain) adds an entry
// here and, where it needs a new drawing technique, a new `kind` that the
// system learns to draw. Nothing else in the lane assumes cumulus.
//
// UNITS. Heights and sizes are REAL metres. The scene stores heights in
// canonical VE5 units and the Master slider rescales them for display; the
// cloud system converts: a cloud's altitude follows Master like the landscape,
// its body keeps true proportions like every structure (Lane S rule).

export const CLOUD_PRESETS = Object.freeze({
  fairCumulus: Object.freeze({
    id: 'fairCumulus',
    label: 'Fair-weather cumulus',
    kind: 'cumulus',               // drawn as sprite clusters (clouds.js)
    seed: 25092026,                // fixed sky per visit (scope call 2: a fixed sky)
    // Coverage: fraction of the sky's footprint under cloud. 2.5 oktas is the
    // middle of Jordan's "2 to 3 oktas"; the generator stops at this fraction.
    oktas: 2.5,
    // Separate heaps 0.6 to 2 km across with flat bases between 750 and
    // 1,050 m, wider than tall (humilis to mediocris).
    widthM: [600, 2000],
    widthSkew: 1.3,                // >1 favours small clouds, as in life
    aspect: [0.45, 0.8],           // height / width
    elongation: [0.6, 0.95],       // depth / width in plan
    baseM: [750, 1050],
    puffs: [5, 11],                // sprite puffs per cloud, by width
    // Drift: every cloud rides the shared wind (wind.js) at this altitude as
    // one body; a single running offset per layer (scope: "one wind").
    windAltitudeM: 1000,
    // Shadows: the fraction of DIRECT sun removed under a full cloud.
    shadowStrength: 0.8,
    // ...and the share of that shade taken off the sky (indirect) light.
    shadowSkyShare: 0.65,
    // Shadows and the low-sun fade (degrees of solar elevation).
    shadowSunFadeDeg: [3, 9],
    // Above the clouds the layer thins to about a third (Jordan, answer 2).
    thinAbove: 1 / 3,
    // Fade out towards the M25 edge: signed distance inside the map edge, in
    // metres, over which clouds and their shadows fade to nothing.
    edgeFadeM: [600, 7000],
    // Balloon lift under cumulus (cheap thermal: an updraft below each cloud).
    updraftMps: 1.4,
  }),
});

export const DEFAULT_CLOUD_PRESET = 'fairCumulus';

/** Resolve a preset id, falling back to the default for anything unknown. */
export function resolveCloudPreset(id) {
  return CLOUD_PRESETS[id] ?? CLOUD_PRESETS[DEFAULT_CLOUD_PRESET];
}

/** Coverage fraction for an okta count (eighths of the sky). */
export function oktasToFraction(oktas) {
  return Math.min(1, Math.max(0, oktas / 8));
}
