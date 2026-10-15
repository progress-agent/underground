// mannequin-manifest.js: the Quaternius mannequin as data (sprint 14Oct26w, lane P, D-053 item 2, D-045 item 7).
//
// The figure is a dropped-in library character: a GLB with a skeleton and named clips, described here by a
// small manifest that maps the game's clip names to the file's own. Adding a character is a data change.
// Everything is in real metres; the figure module converts to canonical space.

/** Served model: the pack's mannequin cut to the clips below (scripts/trim-player-glb.mjs). */
export const MANNEQUIN_URL = '/models/player/UAL1_Standard-trim.glb';

/**
 * Clips kept in the trimmed GLB, in file order. The trim script reads this list, so there is one list. Lane D
 * appends the clips its skateboard stance needs and re-runs the script.
 */
export const KEEP_CLIPS = Object.freeze([
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop',
  'Crouch_Idle_Loop',
]);

export const MANNEQUIN = Object.freeze({
  id: 'mannequin',
  url: MANNEQUIN_URL,
  heightM: 1.78,
  clips: Object.freeze({
    idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
    air: 'Jump_Loop', swim: 'Swim_Fwd_Loop', swimIdle: 'Swim_Idle_Loop',
  }),
  // The speeds (m/s) the clips were authored at: a clip's time scale is ground speed over these.
  walkSpeed: 1.5, runSpeed: 4.2, sprintSpeed: 7.5,
  // Ground speed bands that pick the clip.
  idleBelow: 0.25, walkBelow: 3.4, sprintAbove: 8.5,
  // The swim clip lies the figure flat: it is lifted this far above the feet point, which sits 1.5 m under
  // the water when the walker swims (eye 0.2 m above the surface at 1.7 m).
  swimLiftM: 1.4,
  crossfadeS: 0.18,
  // Bones the flames hang on and the screen rectangle is made from.
  bones: Object.freeze({
    handL: 'hand_l', handR: 'hand_r', footL: 'foot_l', footR: 'foot_r',
    head: 'Head', neck: 'neck_01', pelvis: 'pelvis',
  }),
});
