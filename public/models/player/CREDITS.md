# Player models: credits and licences

Sprint 14Oct26w, D-053 and D-045 item 7: CC0 only, with the licence beside the files.

## Mannequin (`UAL1_Standard-trim.glb`)

- Pack: Universal Animation Library (Standard), by Quaternius.
- URL: https://quaternius.com (pack page: https://quaternius.com/packs/universalanimationlibrary.html)
- Licence: CC0 1.0 Universal (Public Domain Dedication), https://creativecommons.org/publicdomain/zero/1.0/
  The pack's own licence text is `LICENSE-quaternius.txt` in this folder, byte for byte.
- What this file is: the pack's `UAL1_Standard.glb` (7,618,436 bytes, 43 animation clips) cut to the clips the
  game plays, by `scripts/trim-player-glb.mjs` (Node, no dependency). The mesh, skin, materials and the kept
  clips are untouched; the other clips, and the accessors and buffer views only they used, are dropped.
- Kept clips: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Sprint_Loop, Jump_Loop, Swim_Fwd_Loop, Swim_Idle_Loop,
  Crouch_Idle_Loop (the list lives in `src/player/mannequin-manifest.js`, `KEEP_CLIPS`).
- Rebuild: `node scripts/trim-player-glb.mjs <path to UAL1_Standard.glb> public/models/player/UAL1_Standard-trim.glb`
  reproduces this file byte for byte.

## Skateboard (`skateboard.glb`, `Textures/colormap.png`), added by lane D

- Pack: Mini Skate (1.2), by Kenney.
- URL: https://kenney.nl (pack page: https://kenney.nl/assets/mini-skate)
- Licence: CC0 1.0 Universal (Public Domain Dedication), https://creativecommons.org/publicdomain/zero/1.0/
  The pack's own licence text is `LICENSE-kenney-mini-skate.txt` in this folder, byte for byte.
- Files: `skateboard.glb` and its colour texture `Textures/colormap.png`, both byte for byte from the pack. The GLB
  names its texture by the relative path `Textures/colormap.png`, so the texture must stay in that folder. The game
  fetches the board only the first time the player presses B, so a cold load fetches no extra model.
- The Drone and the Balloon are built in code (no asset).
