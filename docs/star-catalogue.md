# Real stars over London

`public/data/stars-hyg.json` is a magnitude <= 4.5 subset of David Nash's HYG Stellar Database v4.0: 925 stars, 35,871 bytes. Columns are Hipparcos ID, J2000 right ascension (hours), declination (degrees), apparent visual magnitude and B-V colour index (0.65 when absent). The Sun (ID 0) is excluded. Coordinates are rounded to six decimal places; colour to three. No invented stars are added.

Source: https://github.com/astronexus/HYG-Database/blob/main/hyg/CURRENT/hygdata_v40.csv.gz
Upstream compressed SHA-256: `8e3ff9e67445e558a759b117910850cff1b1d4d492f45f715c2ee2db3d869bac`.

Copyright David Nash and HYG contributors. This derived catalogue is distributed under **Creative Commons Attribution-ShareAlike 4.0 International** (CC BY-SA 4.0), the upstream licence: https://github.com/astronexus/HYG-Database/blob/main/hyg/CURRENT/LICENSE and https://creativecommons.org/licenses/by-sa/4.0/legalcode.en. You may share and adapt this catalogue, including commercially, with attribution, a link to the licence, an indication of changes and the same licence for adaptations. These terms apply to the catalogue; the game's source retains its existing licence.

`src/stars.js` precesses J2000 coordinates to the device's date and applies Greenwich sidereal rotation at London's longitude (-0.1278 degrees), latitude 51.5 degrees, and the clock's London civil hour. The calendar date comes from the device. BST is resolved using the Europe/London timezone. Sidereal reference: https://aa.usno.navy.mil/faq/GAST. Atmospheric refraction, proper motion since J2000 and nutation are below the acceptance tolerance of one degree and are omitted. Polaris traces its real small circle around the celestial pole; it is not artificially pinned.

The canopy is one point draw, loaded asynchronously only when night is visible. Magnitudes determine intensity, B-V determines a restrained tint, and low altitude fades stars into city haze. No per-star light, texture or scene object.
