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
    // Treat parens as separators (preserve their content — registry keys
    // like 'tideway-tunnel-western-section-acton-carnwath-road' encode the
    // parenthetical waypoints, so stripping them produced empty slugs).
    .replace(/[()]/g, ' ')
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
//   engineer   string  — chief engineer / authority (sewer + line entries;
//                        emit code in main.js is generic — any class adopts)
//   construction string — sub-surface lines have 'cut-and-cover' or similar
//                        in lieu of a bored running diameter (Wikipedia
//                        provides no diameter for cut-and-cover lines)

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
  // Source: Wikipedia (London sewerage system / Northern Outfall Sewer) for
  //   Bazalgette/MBW attribution and the 1859-1865 overall construction
  //   span; Halliday, "The Great Stink of London" (1999) for individual
  //   commissioning years (Crossness 1865, Beckton 1868, Embankment Low
  //   Levels 1875). Per-tunnel diameter and depth are NOT in the registry:
  //   Wikipedia does not document either, and the previous tooltip's
  //   uniform 4m label was the rendering geometry (radius * 2 from
  //   sewers.js), not authoritative — real sections vary 1.5-4.5m and are
  //   egg-shaped. Future agent with primary-source access (Halliday print
  //   appendices / Thames Water heritage technical notes) can add diameter
  //   and depth_range fields per tunnel — registry-merge will pick them up.
  // Keyed by tunnelId (matches sewers.js tunnels[] keys).
  'northern-outfall':     { installed: 1868, engineer: 'Bazalgette (MBW)' },  // Beckton STW commissioning
  'southern-outfall':     { installed: 1865, engineer: 'Bazalgette (MBW)' },  // Crossness PS opened Apr 1865
  'northern-high-level':  { installed: 1868, engineer: 'Bazalgette (MBW)' },  // Hampstead -> Wick Lane
  'northern-middle-1':    { installed: 1868, engineer: 'Bazalgette (MBW)' },
  'northern-middle-2':    { installed: 1868, engineer: 'Bazalgette (MBW)' },
  'northern-low-1':       { installed: 1875, engineer: 'Bazalgette (MBW)' },  // Embankment intercept, opened with Embankment
  'northern-low-2':       { installed: 1875, engineer: 'Bazalgette (MBW)' },
  'southern-high-level':  { installed: 1865, engineer: 'Bazalgette (MBW)' },
  'southern-middle':      { installed: 1865, engineer: 'Bazalgette (MBW)' },
  'southern-low':         { installed: 1865, engineer: 'Bazalgette (MBW)' },

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

  // ============================================================
  // TUBE LINES + DLR + ELIZABETH (per-line meta — running tunnel
  // diameter, chief engineer, first opening year). Used as a
  // fallback for station-shaft tooltips when per-station metadata
  // doesn't supply diameter / engineer.
  // ============================================================
  // Source: Wikipedia per-line + per-railway pages (fetched
  //   2026-04-26). null where Wikipedia is silent (cut-and-cover
  //   lines have no bored diameter; Victoria's diameter and DLR
  //   bore diameters are not stated). The original-corpus
  //   "well-known" Victoria 3.81m figure was deliberately NOT
  //   added — Wikipedia silence + project's "never fabricate" rule.
  // Keyed by 'line-<lineId>' to namespace from naptan codes.
  'line-bakerloo':         { diameter: 3.66, engineer: "Baker, Galbraith & Church (BS&WR)", installed: 1906 },
  'line-central':          { diameter: 3.56, engineer: "Greathead, Mott (CLR)", installed: 1900 },
  'line-circle':           { engineer: "Sir John Fowler (Met & District)", installed: 1884, construction: "cut-and-cover" },
  'line-district':         { engineer: "Sir John Fowler (MDR)", installed: 1868, construction: "cut-and-cover" },
  'line-hammersmith-city': { engineer: "H&CR (Metropolitan + GWR)", installed: 1864, construction: "cut-and-cover/viaduct" },
  'line-jubilee':          { diameter: "3.81-4.35m", engineer: "London Transport; JLE (Paoletti)", installed: 1979 },
  'line-metropolitan':     { engineer: "Sir John Fowler (Metropolitan Railway)", installed: 1863, construction: "cut-and-cover" },
  'line-northern':         { diameter: 3.56, engineer: "Greathead (C&SLR); CCE&HR", installed: 1890 },
  'line-piccadilly':       { diameter: 3.56, engineer: "GNP&BR (UERL/Yerkes)", installed: 1906 },
  'line-victoria':         { engineer: "London Transport", installed: 1968 },
  'line-waterloo-city':    { diameter: "3.70-3.89m", engineer: "Galbraith (LSWR) & Greathead", installed: 1898 },
  'line-elizabeth':        { diameter: 6.2, engineer: "Crossrail Ltd (TfL)", installed: 2022 },
  'line-dlr':              { engineer: "GEC/Mowlem (LDDC)", installed: 1987 },

  // ============================================================
  // STATIONS — per-station depth + opening year (keyed by NaPTAN)
  // ============================================================
  // Source: Prog research run 2026-04-26 (cron 47ad7780). Primary
  //   sources: TfL FOI spreadsheet (ianvisits.co.uk, 2024) for
  //   depths; per-station Wikipedia infoboxes for opening dates.
  //   Discrepancies between Wikipedia body text and FOI rail-level
  //   depths were resolved with FOI as authoritative.
  // Coverage: 279 of 338 stations across 11 Tube lines + DLR +
  //   Elizabeth. At-grade (depth=0) stations omitted; missing-from-
  //   FOI stations (DLR, Elizabeth, post-2021 Northern extensions)
  //   appear with installed-only entries where Wikipedia provided
  //   the date.
  // Full data + quality report at:
  //   PROJECTS/UnderGround/Working/prog-research-26Apr26u/
  'HUBABW': { name: 'Abbey Wood', installed: 1849 },
  '940GZZLUACT': { name: 'Acton Town', depth: 5.5, installed: 1879 },
  '940GZZLUALD': { name: 'Aldgate', depth: 7.2, installed: 1876 },
  '940GZZLUADE': { name: 'Aldgate East', depth: 9.0, installed: 1938 },
  '940GZZLUALP': { name: 'Alperton', installed: 1903 },
  'HUBAMR': { name: 'Amersham', installed: 1966 },
  '940GZZLUAGL': { name: 'Angel', depth: 35.7, installed: 1901 },
  '940GZZLUACY': { name: 'Archway', depth: 21.3, installed: 1907 },
  '940GZZLUASG': { name: 'Arnos Grove', depth: 5.4, installed: 1932 },
  '940GZZLUASL': { name: 'Arsenal', depth: 8.2, installed: 1906 },
  '940GZZLUBST': { name: 'Baker Street', depth: 14.0, installed: 1906 },
  'HUBBAL': { name: 'Balham', depth: 13.4, installed: 1856 },
  'HUBBAN': { name: 'Bank', depth: 23.4, installed: 1898 },
  '940GZZLUBBN': { name: 'Barbican', depth: 8.6, installed: 1910 },
  'HUBBKG': { name: 'Barking', depth: 2.6, installed: 1902 },
  '940GZZLUBKE': { name: 'Barkingside', installed: 1903 },
  '940GZZLUBSC': { name: 'Barons Court', depth: 2.6, installed: 1874 },
  '940GZZBPSUST': { name: 'Battersea Power Station', installed: 2021 },
  '940GZZLUBWT': { name: 'Bayswater', depth: 7.0, installed: 1868 },
  '940GZZLUBEC': { name: 'Becontree', depth: 4.9, installed: 1926 },
  '940GZZLUBZP': { name: 'Belsize Park', depth: 35.6, installed: 1907 },
  '940GZZLUBMY': { name: 'Bermondsey', depth: 14.5, installed: 1999 },
  '940GZZLUBLG': { name: 'Bethnal Green', depth: 16.0, installed: 1946 },
  'HUBBFR': { name: 'Blackfriars', depth: 7.3, installed: 1870 },
  'HUBBHO': { name: 'Blackhorse Road', depth: 15.6, installed: 1894 },
  'HUBBDS': { name: 'Bond Street', depth: 26.0, installed: 1900 },
  '940GZZLUBOR': { name: 'Borough', depth: 17.5, installed: 1890 },
  '940GZZLUBOS': { name: 'Boston Manor', depth: 5.6, installed: 1883 },
  '940GZZLUBDS': { name: 'Bounds Green', depth: 16.2, installed: 1932 },
  '940GZZLUBWR': { name: 'Bow Road', depth: 5.2, installed: 1902 },
  '940GZZLUBTX': { name: 'Brent Cross', installed: 1923 },
  'HUBBRX': { name: 'Brixton', depth: 19.2, installed: 1971 },
  '940GZZLUBBB': { name: 'Bromley-by-Bow', depth: 2.8, installed: 1858 },
  '940GZZLUBKH': { name: 'Buckhurst Hill', depth: 5.1, installed: 1966 },
  '940GZZLUBTK': { name: 'Burnt Oak', depth: 4.0, installed: 1924 },
  '940GZZLUCAR': { name: 'Caledonian Road', depth: 23.1, installed: 1906 },
  '940GZZLUCTN': { name: 'Camden Town', depth: 16.9, installed: 1907 },
  'HUBZCW': { name: 'Canada Water', depth: 18.3, installed: 1999 },
  'HUBCAW': { name: 'Canary Wharf', depth: 18.7, installed: 1999 },
  'HUBCAN': { name: 'Canning Town', depth: 2.0, installed: 1847 },
  'HUBCST': { name: 'Cannon Street', depth: 6.6, installed: 1866 },
  '940GZZLUCPK': { name: 'Canons Park', installed: 1932 },
  'HUBCFO': { name: 'Chalfont & Latimer', depth: 1.3, installed: 1966 },
  '940GZZLUCFM': { name: 'Chalk Farm', depth: 13.4, installed: 1907 },
  '940GZZLUCHL': { name: 'Chancery Lane', depth: 22.2, installed: 1900 },
  'HUBCHX': { name: 'Charing Cross', depth: 24.8, installed: 1906 },
  '940GZZLUCSM': { name: 'Chesham', installed: 1889 },
  '940GZZLUCWL': { name: 'Chigwell', depth: 5.0, installed: 1903 },
  '940GZZLUCWP': { name: 'Chiswick Park', installed: 1879 },
  'HUBCLW': { name: 'Chorleywood', depth: 0.7, installed: 1966 },
  '940GZZLUCPC': { name: 'Clapham Common', depth: 20.2, installed: 1900 },
  '940GZZLUCPN': { name: 'Clapham North', depth: 14.3, installed: 1924 },
  '940GZZLUCPS': { name: 'Clapham South', depth: 17.9, installed: 1926 },
  '940GZZLUCKS': { name: 'Cockfosters', depth: 4.0, installed: 1933 },
  '940GZZLUCND': { name: 'Colindale', depth: 5.0, installed: 1924 },
  '940GZZLUCSD': { name: 'Colliers Wood', depth: 13.1, installed: 1926 },
  '940GZZLUCGN': { name: 'Covent Garden', depth: 37.0, installed: 1906 },
  '940GZZLUCXY': { name: 'Croxley', depth: 6.6, installed: 1925 },
  'HUBCUS': { name: 'Custom House', installed: 1855 },
  'HUBCUT': { name: 'Cutty Sark', depth: 20.0, installed: 1999 },
  '940GZZLUDGE': { name: 'Dagenham East', depth: 3.6, installed: 1885 },
  '940GZZLUDGY': { name: 'Dagenham Heathway', depth: 4.8, installed: 1932 },
  '940GZZLUDBN': { name: 'Debden', depth: 0.6, installed: 1865 },
  '940GZZLUDOH': { name: 'Dollis Hill', installed: 1909 },
  'HUBEAL': { name: 'Ealing Broadway', depth: 5.1, installed: 1879 },
  '940GZZLUECM': { name: 'Ealing Common', depth: 5.0, installed: 1879 },
  '940GZZLUECT': { name: 'Earl\'s Court', depth: 13.2, installed: 1871 },
  '940GZZLUEAN': { name: 'East Acton', installed: 1920 },
  '940GZZLUEFY': { name: 'East Finchley', installed: 1867 },
  '940GZZLUEHM': { name: 'East Ham', depth: 5.3, installed: 1858 },
  '940GZZLUEPY': { name: 'East Putney', installed: 1889 },
  '940GZZLUEAE': { name: 'Eastcote', depth: 4.9, installed: 1904 },
  '940GZZLUEGW': { name: 'Edgware', depth: 4.4, installed: 1924 },
  '940GZZLUERB': { name: 'Edgware Road (Bakerloo)', depth: 5.2 },
  '940GZZLUERC': { name: 'Edgware Road (Circle Line)', depth: 5.2 },
  'HUBEPH': { name: 'Elephant & Castle', depth: 20.6, installed: 1906 },
  '940GZZLUEPK': { name: 'Elm Park', depth: 5.7, installed: 1935 },
  '940GZZLUEMB': { name: 'Embankment', depth: 13.9, installed: 1870 },
  '940GZZLUEPG': { name: 'Epping', depth: 1.5, installed: 1966 },
  'HUBEUS': { name: 'Euston', installed: 1907 },
  '940GZZLUESQ': { name: 'Euston Square', depth: 6.9, installed: 1909 },
  '940GZZLUFLP': { name: 'Fairlop', installed: 1903 },
  'HUBZFD': { name: 'Farringdon', depth: 4.5, installed: 1863 },
  '940GZZLUFYC': { name: 'Finchley Central', depth: 8.5, installed: 1867 },
  '940GZZLUFYR': { name: 'Finchley Road', depth: 3.3, installed: 1879 },
  'HUBFPK': { name: 'Finsbury Park', depth: 8.3, installed: 1861 },
  '940GZZLUFBY': { name: 'Fulham Broadway', depth: 5.3, installed: 1880 },
  '940GZZLUGTH': { name: 'Gants Hill', depth: 16.5, installed: 1947 },
  '940GZZLUGTR': { name: 'Gloucester Road', depth: 13.3, installed: 1868 },
  '940GZZLUGGN': { name: 'Golders Green', installed: 1907 },
  '940GZZLUGHK': { name: 'Goldhawk Road', installed: 1864 },
  '940GZZLUGDG': { name: 'Goodge Street', depth: 28.9, installed: 1907 },
  '940GZZLUGGH': { name: 'Grange Hill', depth: 6.2, installed: 1903 },
  '940GZZLUGPS': { name: 'Great Portland Street', depth: 7.6, installed: 1863 },
  '940GZZLUGPK': { name: 'Green Park', depth: 26.9, installed: 1906 },
  'HUBGFD': { name: 'Greenford', installed: 1904 },
  'HUBGNW': { name: 'Greenwich', installed: 1838 },
  'HUBGUN': { name: 'Gunnersbury', depth: 4.0, installed: 1869 },
  '940GZZLUHLT': { name: 'Hainault', installed: 1903 },
  'HUBHMS': { name: 'Hammersmith', depth: 4.6 },
  '940GZZLUHTD': { name: 'Hampstead', depth: 58.5, installed: 1907 },
  '940GZZLUHGR': { name: 'Hanger Lane', depth: 8.1, installed: 1947 },
  'HUBHDN': { name: 'Harlesden', depth: 6.2, installed: 1912 },
  'HUBHRW': { name: 'Harrow & Wealdstone', installed: 1837 },
  'HUBHOH': { name: 'Harrow-on-the-Hill', installed: 1880 },
  '940GZZLUHNX': { name: 'Hatton Cross', depth: 8.6, installed: 1975 },
  'HUBH13': { name: 'Heathrow Terminals 2 & 3', installed: 1977 },
  '940GZZLUHCL': { name: 'Hendon Central', depth: 2.5, installed: 1923 },
  '940GZZLUHBT': { name: 'High Barnet', depth: 12.6, installed: 1872 },
  '940GZZLUHSK': { name: 'High Street Kensington', depth: 5.7, installed: 1868 },
  'HUBHHY': { name: 'Highbury & Islington', depth: 16.1, installed: 1850 },
  '940GZZLUHGT': { name: 'Highgate', depth: 37.3, installed: 1867 },
  '940GZZLUHGD': { name: 'Hillingdon', installed: 1904 },
  '940GZZLUHBN': { name: 'Holborn', depth: 32.1, installed: 1906 },
  '940GZZLUHPK': { name: 'Holland Park', depth: 18.8, installed: 1900 },
  '940GZZLUHWY': { name: 'Holloway Road', depth: 13.6, installed: 1906 },
  '940GZZLUHCH': { name: 'Hornchurch', depth: 5.8, installed: 1885 },
  '940GZZLUHWC': { name: 'Hounslow Central', installed: 1884 },
  '940GZZLUHWE': { name: 'Hounslow East', installed: 1884 },
  '940GZZLUHWT': { name: 'Hounslow West', depth: 5.3, installed: 1884 },
  '940GZZLUHPC': { name: 'Hyde Park Corner', depth: 27.1, installed: 1906 },
  '940GZZLUICK': { name: 'Ickenham', depth: 4.9, installed: 1904 },
  '940GZZLUKNG': { name: 'Kennington', depth: 17.3, installed: 1890 },
  'HUBKNL': { name: 'Kensal Green', depth: 6.6, installed: 1916 },
  'HUBKPA': { name: 'Kensington (Olympia)', depth: 1.9, installed: 1844 },
  'HUBKTN': { name: 'Kentish Town', depth: 22.6, installed: 1868 },
  'HUBKNT': { name: 'Kenton', depth: 6.6, installed: 1912 },
  'HUBKWG': { name: 'Kew Gardens', depth: 2.0, installed: 1869 },
  '940GZZLUKBN': { name: 'Kilburn', installed: 1879 },
  '940GZZLUKPK': { name: 'Kilburn Park', depth: 7.5, installed: 1915 },
  'HUBKGX': { name: 'King\'s Cross & St Pancras International', depth: 18.9 },
  '940GZZLUKBY': { name: 'Kingsbury', depth: 4.7, installed: 1932 },
  '940GZZLUKNB': { name: 'Knightsbridge', depth: 22.3, installed: 1906 },
  '940GZZLULAD': { name: 'Ladbroke Grove', installed: 1864 },
  '940GZZLULBN': { name: 'Lambeth North', depth: 16.5, installed: 1906 },
  '940GZZLULGT': { name: 'Lancaster Gate', depth: 15.5, installed: 1900 },
  '940GZZLULRD': { name: 'Latimer Road', installed: 1868 },
  '940GZZLULSQ': { name: 'Leicester Square', depth: 29.9, installed: 1906 },
  'HUBLEW': { name: 'Lewisham', installed: 1849 },
  '940GZZLULYN': { name: 'Leyton', depth: 5.0, installed: 1867 },
  '940GZZLULYS': { name: 'Leytonstone', depth: 0.1, installed: 1947 },
  'HUBLHS': { name: 'Limehouse', installed: 1840 },
  'HUBLST': { name: 'Liverpool Street', depth: 14.1, installed: 1875 },
  'HUBLBG': { name: 'London Bridge', depth: 25.4, installed: 1900 },
  'HUBLCY': { name: 'London City Airport', installed: 2005 },
  '940GZZLULGN': { name: 'Loughton', installed: 1856 },
  '940GZZLUMVL': { name: 'Maida Vale', depth: 14.4, installed: 1915 },
  '940GZZLUMRH': { name: 'Manor House', depth: 18.5, installed: 1932 },
  '940GZZLUMSH': { name: 'Mansion House', depth: 9.0, installed: 1871 },
  '940GZZLUMBA': { name: 'Marble Arch', depth: 25.6, installed: 1900 },
  'HUBMYB': { name: 'Marylebone', depth: 22.6, installed: 1899 },
  '940GZZLUMED': { name: 'Mile End', depth: 7.2, installed: 1902 },
  '940GZZLUMHL': { name: 'Mill Hill East', installed: 1867 },
  '940GZZLUMMT': { name: 'Monument', depth: 8.1, installed: 1898 },
  '940GZZLUMPK': { name: 'Moor Park', installed: 1887 },
  'HUBZMG': { name: 'Moorgate', depth: 15.4, installed: 1865 },
  '940GZZLUMDN': { name: 'Morden', depth: 4.4, installed: 1926 },
  '940GZZLUMTC': { name: 'Mornington Crescent', depth: 15.3, installed: 1907 },
  '940GZZLUNDN': { name: 'Neasden', depth: 5.8, installed: 1880 },
  '940GZZLUNBP': { name: 'Newbury Park', depth: 2.0, installed: 1903 },
  '940GZZNEUGST': { name: 'Nine Elms', installed: 2021 },
  '940GZZLUNAN': { name: 'North Acton', depth: 8.6, installed: 1923 },
  '940GZZLUNEN': { name: 'North Ealing', depth: 3.5, installed: 1903 },
  'HUBNGW': { name: 'North Greenwich', depth: 15.5, installed: 1999 },
  '940GZZLUNHA': { name: 'North Harrow', installed: 1885 },
  'HUBNWB': { name: 'North Wembley', depth: 6.0, installed: 1912 },
  '940GZZLUNFD': { name: 'Northfields', depth: 4.7, installed: 1908 },
  '940GZZLUNHT': { name: 'Northolt', depth: 5.2, installed: 1948 },
  '940GZZLUNKP': { name: 'Northwick Park', installed: 1880 },
  '940GZZLUNOW': { name: 'Northwood', depth: 5.4, installed: 1887 },
  '940GZZLUNWH': { name: 'Northwood Hills', depth: 6.0, installed: 1933 },
  '940GZZLUNHG': { name: 'Notting Hill Gate', depth: 18.4, installed: 1868 },
  '940GZZLUOAK': { name: 'Oakwood', depth: 6.2, installed: 1933 },
  'HUBOLD': { name: 'Old Street', depth: 25.0, installed: 1901 },
  '940GZZLUOSY': { name: 'Osterley', depth: 5.8, installed: 1934 },
  '940GZZLUOVL': { name: 'Oval', depth: 15.7, installed: 1890 },
  '940GZZLUOXC': { name: 'Oxford Circus', depth: 23.9, installed: 1900 },
  'HUBPAD': { name: 'Paddington', depth: 8.2 },
  '940GZZLUPKR': { name: 'Park Royal', depth: 4.8, installed: 1931 },
  '940GZZLUPSG': { name: 'Parsons Green', installed: 1880 },
  '940GZZLUPVL': { name: 'Perivale', installed: 1947 },
  '940GZZLUPCC': { name: 'Piccadilly Circus', depth: 28.7, installed: 1906 },
  '940GZZLUPCO': { name: 'Pimlico', depth: 21.1, installed: 1971 },
  '940GZZLUPNR': { name: 'Pinner', depth: 0.5, installed: 1885 },
  '940GZZLUPLW': { name: 'Plaistow', depth: 6.6, installed: 1858 },
  '940GZZLUPRD': { name: 'Preston Road', depth: 3.9, installed: 1880 },
  '940GZZLUPYB': { name: 'Putney Bridge', installed: 1880 },
  'HUBQPW': { name: 'Queen\'s Park', depth: 5.6, installed: 1915 },
  '940GZZLUQBY': { name: 'Queensbury', installed: 1934 },
  '940GZZLUQWY': { name: 'Queensway', depth: 23.9, installed: 1900 },
  '940GZZLURVP': { name: 'Ravenscourt Park', installed: 1869 },
  '940GZZLURYL': { name: 'Rayners Lane', depth: 6.2, installed: 1904 },
  '940GZZLURBG': { name: 'Redbridge', depth: 5.2, installed: 1947 },
  '940GZZLURGP': { name: 'Regent\'s Park', depth: 24.8, installed: 1906 },
  'HUBRMD': { name: 'Richmond', depth: 1.0, installed: 1846 },
  'HUBRIC': { name: 'Rickmansworth', depth: 0.4, installed: 1966 },
  '940GZZLURVY': { name: 'Roding Valley', installed: 1903 },
  '940GZZLURYO': { name: 'Royal Oak', depth: 6.0, installed: 1871 },
  'HUBRVC': { name: 'Royal Victoria', installed: 1994 },
  '940GZZLURSP': { name: 'Ruislip', depth: 0.4, installed: 1904 },
  '940GZZLURSG': { name: 'Ruislip Gardens', installed: 1906 },
  '940GZZLURSM': { name: 'Ruislip Manor', installed: 1904 },
  '940GZZLURSQ': { name: 'Russell Square', depth: 33.2, installed: 1906 },
  'HUBSVS': { name: 'Seven Sisters', depth: 18.0, installed: 1872 },
  'HUBSDE': { name: 'Shadwell', installed: 1876 },
  'HUBSPB': { name: 'Shepherd\'s Bush', depth: 16.2, installed: 1900 },
  '940GZZLUSBM': { name: 'Shepherd\'s Bush Market', installed: 1864 },
  '940GZZLUSSQ': { name: 'Sloane Square', depth: 8.4, installed: 1868 },
  '940GZZLUSNB': { name: 'Snaresbrook', installed: 1947 },
  '940GZZLUSEA': { name: 'South Ealing', depth: 3.7, installed: 1883 },
  '940GZZLUSHH': { name: 'South Harrow', installed: 1903 },
  '940GZZLUSKS': { name: 'South Kensington', depth: 13.9, installed: 1868 },
  'HUBSOK': { name: 'South Kenton', installed: 1933 },
  'HUBSRU': { name: 'South Ruislip', installed: 1908 },
  '940GZZLUSWN': { name: 'South Wimbledon', depth: 12.7, installed: 1926 },
  '940GZZLUSWF': { name: 'South Woodford', installed: 1937 },
  '940GZZLUSFS': { name: 'Southfields', depth: 6.0, installed: 1889 },
  '940GZZLUSGT': { name: 'Southgate', depth: 10.8, installed: 1933 },
  '940GZZLUSWK': { name: 'Southwark', depth: 24.5, installed: 1999 },
  '940GZZLUSJP': { name: 'St. James\'s Park', depth: 5.8, installed: 1868 },
  '940GZZLUSJW': { name: 'St. John\'s Wood', depth: 17.6, installed: 1939 },
  '940GZZLUSPU': { name: 'St. Paul\'s', depth: 24.4, installed: 1900 },
  '940GZZLUSFB': { name: 'Stamford Brook', installed: 1869 },
  '940GZZLUSTM': { name: 'Stanmore', depth: 8.2, installed: 1932 },
  '940GZZLUSGN': { name: 'Stepney Green', depth: 7.2, installed: 1902 },
  '940GZZLUSKW': { name: 'Stockwell', depth: 13.7, installed: 1890 },
  'HUBSBP': { name: 'Stonebridge Park', installed: 1912 },
  'HUBSRA': { name: 'Stratford', installed: 1839 },
  '940GZZLUSUH': { name: 'Sudbury Hill', depth: 5.8, installed: 1903 },
  '940GZZLUSUT': { name: 'Sudbury Town', depth: 0.4, installed: 1903 },
  '940GZZLUSWC': { name: 'Swiss Cottage', depth: 16.9, installed: 1939 },
  '940GZZLUTMP': { name: 'Temple', depth: 5.8, installed: 1870 },
  '940GZZLUTHB': { name: 'Theydon Bois', depth: 0.9, installed: 1865 },
  '940GZZLUTBC': { name: 'Tooting Bec', depth: 16.4, installed: 1950 },
  '940GZZLUTBY': { name: 'Tooting Broadway', depth: 12.8, installed: 1926 },
  'HUBTCR': { name: 'Tottenham Court Road', depth: 27.8, installed: 1900 },
  'HUBTOM': { name: 'Tottenham Hale', depth: 19.3, installed: 1840 },
  '940GZZLUTAW': { name: 'Totteridge & Whetstone', depth: 1.2, installed: 1872 },
  'HUBTOG': { name: 'Tower Gateway', installed: 1987 },
  '940GZZLUTWH': { name: 'Tower Hill', depth: 7.0, installed: 1967 },
  '940GZZLUTFP': { name: 'Tufnell Park', depth: 20.7, installed: 1907 },
  '940GZZLUTNG': { name: 'Turnham Green', installed: 1869 },
  '940GZZLUTPN': { name: 'Turnpike Lane', depth: 14.7, installed: 1932 },
  'HUBUPM': { name: 'Upminster', depth: 8.8, installed: 1885 },
  '940GZZLUUPB': { name: 'Upminster Bridge', installed: 1934 },
  '940GZZLUUPY': { name: 'Upney', depth: 5.7, installed: 1932 },
  '940GZZLUUPK': { name: 'Upton Park', depth: 5.7, installed: 1877 },
  '940GZZLUUXB': { name: 'Uxbridge', installed: 1939 },
  'HUBVXH': { name: 'Vauxhall', depth: 17.7, installed: 1848 },
  'HUBVIC': { name: 'Victoria', depth: 13.5 },
  'HUBWHC': { name: 'Walthamstow Central', depth: 17.2, installed: 1968 },
  '940GZZLUWSD': { name: 'Wanstead', depth: 19.4, installed: 1947 },
  '940GZZLUWRR': { name: 'Warren Street', depth: 28.1, installed: 1907 },
  '940GZZLUWKA': { name: 'Warwick Avenue', depth: 14.5, installed: 1915 },
  'HUBWAT': { name: 'Waterloo', depth: 18.6, installed: 1906 },
  '940GZZLUWAF': { name: 'Watford', depth: 5.2, installed: 1966 },
  'HUBWMB': { name: 'Wembley Central', depth: 6.5, installed: 1882 },
  '940GZZLUWYP': { name: 'Wembley Park', depth: 4.3, installed: 1893 },
  '940GZZLUWTA': { name: 'West Acton', depth: 5.6, installed: 1923 },
  'HUBWBP': { name: 'West Brompton', depth: 5.0, installed: 1866 },
  '940GZZLUWFN': { name: 'West Finchley', depth: 0.7, installed: 1933 },
  'HUBWEH': { name: 'West Ham', installed: 1901 },
  'HUBWHD': { name: 'West Hampstead', depth: 5.5, installed: 1879 },
  '940GZZLUWHW': { name: 'West Harrow', installed: 1904 },
  '940GZZLUWKN': { name: 'West Kensington', depth: 5.7, installed: 1874 },
  'HUBWRU': { name: 'West Ruislip', depth: 5.9, installed: 1906 },
  '940GZZLUWSP': { name: 'Westbourne Park', depth: 5.5, installed: 1866 },
  'HUBWSM': { name: 'Westminster', depth: 16.9, installed: 1868 },
  '940GZZLUWCY': { name: 'White City', depth: 2.0, installed: 1920 },
  'HUBZWL': { name: 'Whitechapel', depth: 2.9, installed: 1876 },
  '940GZZLUWIG': { name: 'Willesden Green', depth: 5.7, installed: 1894 },
  'HUBWIJ': { name: 'Willesden Junction', depth: 5.5, installed: 1866 },
  'HUBWIM': { name: 'Wimbledon', depth: 3.7, installed: 1838 },
  '940GZZLUWIP': { name: 'Wimbledon Park', depth: 4.6, installed: 1889 },
  '940GZZLUWOG': { name: 'Wood Green', depth: 11.4, installed: 1932 },
  '940GZZLUWLA': { name: 'Wood Lane', installed: 1864 },
  '940GZZLUWOF': { name: 'Woodford', depth: 0.9, installed: 1966 },
  '940GZZLUWOP': { name: 'Woodside Park', depth: 1.7, installed: 1872 },
  'HUBWWA': { name: 'Woolwich Arsenal', installed: 1849 },
};

// ---------- Lookup ----------

/**
 * Look up canonical metadata for an infrastructure mesh.
 * Returns null if no match found — caller must handle.
 *
 * Precedence (Wave 1 plan §3 + Wave 3 extension):
 *   1. userData.shaftId   — direct match (Tideway/Lee shafts)
 *   2. userData.tunnelId  — direct match (sewer tunnels)
 *   3. userData.naptanId  — direct match (station shafts)
 *   4. `${type}-${slug(name)}`  — synthetic key (everything else)
 */
export function lookupInfraMeta(mesh) {
  const ud = mesh && mesh.userData;
  if (!ud) return null;
  if (ud.shaftId && INFRA_META[ud.shaftId]) return INFRA_META[ud.shaftId];
  if (ud.tunnelId && INFRA_META[ud.tunnelId]) return INFRA_META[ud.tunnelId];
  if (ud.naptanId && INFRA_META[ud.naptanId]) return INFRA_META[ud.naptanId];
  if (ud.type && ud.name) {
    const key = `${ud.type}-${slug(ud.name)}`;
    if (INFRA_META[key]) return INFRA_META[key];
  }
  return null;
}

/**
 * Look up per-line metadata (diameter, engineer, installed, construction).
 * Used by station-shaft tooltips to fall back to line-level facts when the
 * per-station entry doesn't supply diameter / engineer.
 *
 * Returns the meta object for the FIRST line (in the supplied array) that
 * has a registry entry, OR null if none of the lines are known.
 *
 * Caller passes the userData.lines array. Multi-line stations get the
 * first-registered line's meta — see UNDERGROUND_LINE_IDS in shaft-registry.js
 * for the line registration order.
 */
export function lookupLineMeta(lineIds) {
  if (!Array.isArray(lineIds)) return null;
  for (const lid of lineIds) {
    const key = `line-${lid}`;
    if (INFRA_META[key]) return INFRA_META[key];
  }
  return null;
}
