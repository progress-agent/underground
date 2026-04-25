// Central infrastructure metadata registry.
//
// One file, one map. Bundled with JS — zero extra HTTP at boot.
// Lookup precedence (see Wave 1 plan §3 + lookupInfraMeta below):
//   1. userData.shaftId           (Tideway/Lee shaft cylinders)
//   2. userData.tunnelId          (Sewer tunnel groups)
//   3. synthetic key `${type}-${slug(userData.name)}`  (everything else)
//
// formatInfraTooltip() in main.js merges the result with mesh.userData.
// Existing userData fields take precedence — meta only fills GAPS.
//
// Date convention (Jordan-locked, 25Apr26s): year only, e.g. installed: 2017.
// Phased construction is a string range, e.g. installed: '1859-1875'.
// Use plain ASCII hyphen '-' (NOT en-dash) — Cloudflare Pages metadata
// rejects non-ASCII in commit messages, and downstream stringification of
// any meta value into commit-related fields breaks.
//
// Unknown / genuinely uncertain fields are OMITTED — never fabricated.

// ---------- Helpers ----------

function slug(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Normalise dashes (em, en, hyphen-minus) to hyphen-space removable
    .replace(/[–—\-]+/g, ' ')
    // Strip parenthetical asides
    .replace(/\([^)]*\)/g, ' ')
    // Strip non-alphanumeric punctuation
    .replace(/['".,/\\]/g, '')
    // Collapse whitespace
    .trim()
    .replace(/\s+/g, '-');
}

// ---------- Metadata Map ----------
//
// Field schema (per Wave 1 plan §3):
//   name       string  — display name (overrides userData.name when present)
//   diameter   number  — internal diameter in metres
//   depth      number|string — metres below ground; string allowed for
//                        ranges ('68-98m') and descriptive depths ('~60m')
//   installed  number|string — year, or year-range string

export const INFRA_META = {
  // ============================================================
  // TIDEWAY TUNNEL — sections + spurs
  // ============================================================
  // Source: Tideway Ltd (tideway.london); Thames Water Utilities Ltd
  //   (Thames Tideway Tunnel) Order 2014; system commissioning 2024,
  //   fully connected Feb 2025, officially opened 7 May 2025.
  // Each main section finished as TBM drives completed; per-section
  // commissioning years below reflect breakthrough + lining completion.
  // Section keys derive from the SECTION_DISPLAY_NAMES values in tideway.js.

  'tideway-tunnel-western-section-acton-carnwath-road': {
    diameter: 6.5,
    depth: 35,           // approx mid-section depth (Acton 31m -> Carnwath 42m)
    installed: 2020,     // West TBMs Millicent + Ursula completed drives 2019-2020
  },
  'tideway-tunnel-west-central-carnwath-road-kirtling-street': {
    diameter: 7.2,
    depth: 45,
    installed: 2020,
  },
  'tideway-tunnel-east-central-kirtling-street-chambers-wharf': {
    diameter: 7.2,
    depth: 53,
    installed: 2021,     // Annie + Ursula completed central drives 2020-2021
  },
  'tideway-tunnel-eastern-section-chambers-wharf-abbey-mills': {
    diameter: 7.2,
    depth: 62,
    installed: 2022,     // Selina TBM completed eastern drive Apr 2022
  },
  // Connection spurs (smaller diameter feeders)
  'tideway-tunnel-frogmore-connection-spur': {
    diameter: 2.8,
    depth: 25,           // shallow connection between Carnwath/Dormay/KGP
    installed: 2020,
  },
  'tideway-tunnel-greenwich-connection-spur': {
    diameter: 5.0,
    depth: 50,           // Chambers->Greenwich corridor depth
    installed: 2021,
  },

  // ============================================================
  // TIDEWAY SHAFTS (21 sites, keyed by site.id from tideway_sites.csv)
  // ============================================================
  // Source: Tideway Ltd shaft commissioning records / construction news.
  // Build sequence ran 2016 (early sites) to 2022 (final lid Mar 2024).
  // All depth + diameter already in userData (from tideway_sites.csv);
  // meta only supplies installed year.
  'acton':       { installed: 2017 },  // Acton Storm Tanks reception
  'hammersmith': { installed: 2018 },
  'barn-elms':   { installed: 2018 },
  'putney':      { installed: 2018 },
  'carnwath':    { installed: 2018 },  // West TBM launch site
  'dormay':      { installed: 2019 },
  'kgp':         { installed: 2019 },  // King Georges Park
  'falconbrook': { installed: 2019 },
  'cremorne':    { installed: 2019 },
  'chelsea':     { installed: 2020 },
  'kirtling':    { installed: 2018 },  // Central TBM launch site
  'heathwall':   { installed: 2020 },
  'albert':      { installed: 2020 },
  'victoria':    { installed: 2021 },
  'blackfriars': { installed: 2021 },
  'chambers':    { installed: 2018 },  // East TBM launch site
  'earl':        { installed: 2021 },
  'deptford':    { installed: 2021 },
  'greenwich':   { installed: 2021 },
  'kemp':        { installed: 2022 },  // King Edward Memorial Park
  'abbey-mills': { installed: 2022 },  // Eastern reception terminus

  // ============================================================
  // LEE TUNNEL + SHAFTS
  // ============================================================
  // Source: Wikipedia + Thames Water — Lee Tunnel commissioned Jan 2016.
  // 6.9km bored interceptor, Abbey Mills -> Beckton STW, 7.2m ID.
  'lee-tunnel-lee-tunnel': {
    diameter: 7.2,
    depth: '68-98m',     // ASCII hyphen per Jordan-locked decision
    installed: 2016,
  },
  // Lee shafts (keyed by site.id from lee_tunnel.csv)
  'lee-abbey-1':           { installed: 2014 },  // Earlier shafts sunk first
  'lee-abbey-2':           { installed: 2014 },
  'lee-beckton-overflow':  { installed: 2015 },
  'lee-beckton-ps':        { installed: 2015 },
  'lee-beckton-3':         { installed: 2015 },

  // ============================================================
  // CROSSRAIL / ELIZABETH LINE — bored tubes + station markers
  // ============================================================
  // Bored tunnels: uniform 6.2m ID per Crossrail Ltd technical specs.
  // Service openings: central section 24 May 2022; Bond Street
  // 24 Oct 2022; through-running including Reading/Heathrow + Shenfield
  // + Abbey Wood completed 6 Nov 2022.
  // Source: TfL press releases, ORR authorisations.

  // Three trunk tubes (keys derived from name in crossrail.js buildTube):
  //   'Crossrail - Main Tunnel'         -> crossrail-crossrail-main-tunnel
  //   'Crossrail - Abbey Wood Branch'   -> crossrail-crossrail-abbey-wood-branch
  //   'Crossrail - Shenfield Branch'    -> crossrail-crossrail-shenfield-branch
  'crossrail-crossrail-main-tunnel': {
    diameter: 6.2,
    installed: 2022,
  },
  'crossrail-crossrail-abbey-wood-branch': {
    diameter: 6.2,
    installed: 2022,     // Through-running 6 Nov 2022
  },
  'crossrail-crossrail-shenfield-branch': {
    // Shenfield branch is surface railway — diameter not applicable, omitted
    installed: 2022,
  },

  // Station markers (~30, install year per ORR authorisation):
  // Central section opened 24 May 2022 (Paddington -> Abbey Wood except Bond St).
  // Bond Street opened 24 Oct 2022. Through-running 6 Nov 2022.
  // Per Jordan: omit diameter row entirely for station-box markers.
  'crossrail-heathrow-terminal-5':       { installed: 2022 },
  'crossrail-heathrow-terminals-2-3':    { installed: 2022 },
  'crossrail-hayes-harlington':          { installed: 2022 },
  'crossrail-southall':                  { installed: 2022 },
  'crossrail-hanwell':                   { installed: 2022 },
  'crossrail-ealing-broadway':           { installed: 2022 },
  'crossrail-acton-main-line':           { installed: 2022 },
  'crossrail-paddington':                { installed: 2022 },
  'crossrail-bond-street':               { installed: 2022 },  // Late opener
  'crossrail-tottenham-court-road':      { installed: 2022 },
  'crossrail-farringdon':                { installed: 2022 },
  'crossrail-liverpool-street':          { installed: 2022 },
  'crossrail-whitechapel':               { installed: 2022 },
  'crossrail-canary-wharf':              { installed: 2022 },
  'crossrail-custom-house':              { installed: 2022 },
  'crossrail-woolwich':                  { installed: 2022 },
  'crossrail-abbey-wood':                { installed: 2022 },
  'crossrail-stratford':                 { installed: 2022 },
  'crossrail-maryland':                  { installed: 2022 },
  'crossrail-forest-gate':               { installed: 2022 },
  'crossrail-manor-park':                { installed: 2022 },
  'crossrail-ilford':                    { installed: 2022 },
  'crossrail-seven-kings':               { installed: 2022 },
  'crossrail-goodmayes':                 { installed: 2022 },
  'crossrail-chadwell-heath':            { installed: 2022 },
  'crossrail-romford':                   { installed: 2022 },
  'crossrail-gidea-park':                { installed: 2022 },
  'crossrail-harold-wood':               { installed: 2022 },
  'crossrail-brentwood':                 { installed: 2022 },
  'crossrail-shenfield':                 { installed: 2022 },

  // ============================================================
  // SEWER TUNNELS — Bazalgette interceptor system + outfalls
  // ============================================================
  // Source: Wikipedia (London sewerage system / individual tunnels) +
  //   Stephen Halliday, "The Great Stink of London" (1999).
  // Per Jordan: diameter STAYS hardcoded at 4m in tooltip ("approx").
  // Meta supplies installed year only (per-tunnel construction date).
  // Keyed by tunnelId (matches sewers.js tunnels[] keys).
  'northern-outfall':     { installed: 1868 },  // Bazalgette completed 1868
  'southern-outfall':     { installed: 1865 },  // Crossness PS opened Apr 1865
  'northern-high-level':  { installed: 1868 },  // Hampstead -> Wick Lane
  'northern-middle-1':    { installed: 1868 },
  'northern-middle-2':    { installed: 1868 },
  'northern-low-1':       { installed: 1875 },  // Embankment intercept, opened with Embankment
  'northern-low-2':       { installed: 1875 },
  'southern-high-level':  { installed: 1865 },
  'southern-middle':      { installed: 1865 },
  'southern-low':         { installed: 1865 },

  // ============================================================
  // NAMED CANALS (~10-25 of 200+; unnamed render minimal)
  // ============================================================
  // Source: Canal & River Trust historical records, Wikipedia.
  // Keyed by `canal-${slug(name)}`.
  "canal-regent's-canal":                          { installed: 1820 },  // Regent's Canal Act 1812, opened 1820
  "canal-grand-union-canal":                       { installed: 1801 },  // Grand Junction Canal opened 1801
  "canal-grand-union-canal-paddington-arm":        { installed: 1801 },  // Paddington Arm opened 10 Jul 1801
  'canal-grand-union-canal-slough-arm':            { installed: 1882 },
  'canal-hertford-union-canal':                    { installed: 1830 },  // 'Duckett's Canal' opened 1830
  'canal-limehouse-cut':                           { installed: 1770 },  // London's oldest canal (still navigable)
  'canal-lee-navigation':                          { installed: 1770 },  // River Lee Navigation Act 1767, completed 1770
  'canal-river-lee-navigation-hackney-cut':        { installed: 1769 },  // Hackney Cut opened 1769
  'canal-basingstoke-canal':                       { installed: 1794 },
  'canal-brent-canal-feeder':                      { installed: 1810 },  // Built to feed Welsh Harp reservoir
  "canal-islington-tunnel-regent's-canal":         { installed: 1820 },  // Part of Regent's Canal
  'canal-staines-reservoirs-aqueduct':             { installed: 1903 },  // Built with Staines Reservoirs
  'canal-broadmead-cut':                           { installed: 1820 },  // approx — pre-Regent's-era cut
  'canal-river-lee':                               { installed: 1770 },  // Same authorisation as Lee Navigation
  'canal-desborough-cut':                          { installed: 1935 },  // Cut opened 1935
  'canal-new-river-loop-bypassed':                 { installed: 1613 },  // New River — Sir Hugh Myddelton

  // ============================================================
  // NAMED RESERVOIRS (~25 of 50; unnamed render minimal)
  // ============================================================
  // Source: Thames Water heritage, Wikipedia per-reservoir pages.
  // Keyed by `reservoir-${slug(name)}`.
  'reservoir-queen-mary-reservoir':              { installed: 1925 },
  'reservoir-wraysbury-reservoir':               { installed: 1970 },
  'reservoir-staines-reservoirs':                { installed: 1903 },  // North + South Staines, opened by Edward VII
  'reservoir-king-george-v-reservoir':           { installed: 1913 },
  'reservoir-king-george-vi-reservoir':          { installed: 1947 },
  'reservoir-william-girling-reservoir':         { installed: 1951 },
  'reservoir-queen-elizabeth-ii-reservoir':      { installed: 1962 },
  'reservoir-island-barn-reservoir':             { installed: 1911 },
  'reservoir-hilfield-park-reservoir':           { installed: 1955 },
  'reservoir-brent-reservoir':                   { installed: 1835 },  // 'Welsh Harp', built for Grand Union feed
  'reservoir-banbury-reservoir':                 { installed: 1903 },
  'reservoir-lockwood-reservoir':                { installed: 1897 },
  'reservoir-bessborough-reservoir':             { installed: 1907 },
  'reservoir-aldenham-reservoir':                { installed: 1797 },  // Built to feed Grand Junction Canal
  'reservoir-knight-reservoir':                  { installed: 1907 },
  'reservoir-warwick-reservoir-east':            { installed: 1897 },
  'reservoir-warwick-reservoir-west':            { installed: 1897 },
  'reservoir-high-maynard-reservoir':            { installed: 1903 },
  'reservoir-low-maynard-reservoir':             { installed: 1870 },
  'reservoir-ruislip-lido':                      { installed: 1811 },  // Built as Grand Junction Canal feeder
  'reservoir-west-reservoir':                    { installed: 1833 },  // East London Waterworks; recreational since 1990s
  'reservoir-east-reservoir':                    { installed: 1833 },
  'reservoir-heathrow-airport-eastern-balancing-reservoir': { installed: 1986 },
};

// ---------- Lookup ----------

/**
 * Look up canonical metadata for an infrastructure mesh.
 * Returns null if no match found — caller must handle.
 *
 * Precedence (Wave 1 plan §3):
 *   1. userData.shaftId   — direct match (Tideway/Lee shafts)
 *   2. userData.tunnelId  — direct match (sewer tunnels)
 *   3. `${type}-${slug(name)}`  — synthetic key (everything else)
 */
export function lookupInfraMeta(mesh) {
  const ud = mesh && mesh.userData;
  if (!ud) return null;
  if (ud.shaftId && INFRA_META[ud.shaftId]) return INFRA_META[ud.shaftId];
  if (ud.tunnelId && INFRA_META[ud.tunnelId]) return INFRA_META[ud.tunnelId];
  if (ud.type && ud.name) {
    const key = `${ud.type}-${slug(ud.name)}`;
    if (INFRA_META[key]) return INFRA_META[key];
  }
  return null;
}

// Export slug for tests / debugging
export { slug as _slugForTests };
