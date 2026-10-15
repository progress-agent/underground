// view-rules.js: which view the walker has (sprint 14Oct26w, lane P, D-053 item 3). Pure, no THREE, no DOM.
//
// The player's CHOICE is one of two views, first or third person, changed by the V key. What they SEE is the
// choice filtered by two facts the rules know nothing else about:
//   loaded       the figure has arrived. Until it has there is no stand-in, so the view is first person.
//   allowsThird  the phase allows third person at all (above ground: the entry ease and the body; never the
//                shaft, the tunnel, the open-air ride, a transfer or a step).
//
// OPENING VIEW: the mode opens in third person if the figure has loaded, else in first person; when the figure
// lands the view changes to third person ONCE, unless the player pressed V meanwhile (their press wins, even if
// it set first person). Coming back up to the street returns to the choice, which V changes in every phase.

export const VIEWS = Object.freeze(['first', 'third']);

/** Phases of the Pedestrian mode in which third person may show (above ground, on foot or swimming). */
export const THIRD_PERSON_PHASES = Object.freeze(['enter', 'body']);
export const allowsThirdIn = (phase) => THIRD_PERSON_PHASES.includes(phase);

export function createViewRules() {
  let chosen = 'first', pressed = false, autoDone = false;

  return {
    /** The mode was (re)activated: third person if the figure is there, else first and wait for it. */
    reset(loaded) {
      chosen = loaded ? 'third' : 'first';
      pressed = false;
      autoDone = !!loaded;
    },
    /** V: flip the choice. */
    press() {
      chosen = chosen === 'third' ? 'first' : 'third';
      pressed = true;
      return chosen;
    },
    /** A direct choice (the test surface `setView`); counts as the player's own press. */
    set(view) {
      if (!VIEWS.includes(view)) throw new RangeError(`view "${view}"`);
      chosen = view;
      pressed = true;
      return chosen;
    },
    /**
     * Once per frame. Returns { effective: 'first' | 'third', auto: boolean }; `auto` is true on the one frame
     * the figure's arrival switched the choice to third person.
     */
    update({ loaded, allowsThird }) {
      let auto = false;
      if (loaded && !autoDone) {
        autoDone = true;
        if (!pressed) { chosen = 'third'; auto = true; }
      }
      const effective = chosen === 'third' && !!loaded && !!allowsThird ? 'third' : 'first';
      return { effective, auto };
    },
    get chosen() { return chosen; },
    get pressed() { return pressed; },
    get autoDone() { return autoDone; },
  };
}
