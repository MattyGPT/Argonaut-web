import { FACTIONS, SCENARIOS } from './constants.js';
import { getShip } from './state.js';

/** The scenario a war is being fought under; unknown or absent means annihilation. */
export const scenarioFor = (game) => SCENARIOS[game?.scenario] ?? SCENARIOS.annihilation;

/**
 * Whether the objective has been met or failed, or null while it is still being
 * fought. The standard annihilation outcomes are checked first by `evaluateOutcome`,
 * so wiping out an alliance still wins a war whose objective has gone stale.
 */
export const scenarioOutcome = (game) => {
  const scenario = scenarioFor(game);

  if (scenario.id === 'defend-xanadu') {
    const base = getShip(game, 'xanadu');
    if (!base || base.status === 'destroyed') {
      return { kind: 'scenario-loss', message: 'Xanadu has fallen.  The Federation lost the war it was trying to prevent.' };
    }
    if (game.turn >= scenario.stardates) {
      return { kind: 'scenario-win', message: `Xanadu still stands at stardate ${game.turn}.  The Federation has held.` };
    }
    return null;
  }

  if (scenario.id === 'hunt-the-vendetta') {
    const hunter = getShip(game, game.objectiveShipId);
    if (!hunter) return null;
    // Boarding the hull counts as ending the vendetta, exactly as it ends the hunt
    // for Captain Jason in the original.
    const boarded = hunter.faction === FACTIONS.FEDERATION;
    // A third alliance can take the hunter too (round 17's AI boarding): any flip
    // of its allegiance ends the hunt exactly like a colors-strike — the vendetta
    // is over either way. The prize record keeps the name of the captain who
    // hunted you, so the resolution can still say who it was.
    const turned = !boarded && Boolean(hunter.prize);
    const ended = boarded || turned || hunter.status !== 'active';
    if (!ended) return null;
    // The point of the scenario is knowing who was coming for you. A hunter that
    // dies in the general melee before you have scanned it is a lost opportunity,
    // not a victory — which is what makes the scanner the objective here.
    if (!game.scanned?.[hunter.id]) {
      return {
        kind: 'scenario-loss',
        // A hunter can leave the war without dying — a disabled hull strikes its
        // colors in a precision war — so the loss names what was never learned
        // rather than how the hull left.
        message: `${hunter.name} is out of the war and you never learned who commanded it.  You will never know who was coming for you.`,
      };
    }
    if (boarded) {
      return { kind: 'scenario-win', message: `${hunter.name} flies Federation colours.  Captain ${hunter.prize?.captain ?? hunter.captain}, who hunted you, is yours.` };
    }
    if (turned) {
      return { kind: 'scenario-win', message: `${hunter.name} flies ${hunter.faction} colours — Captain ${hunter.prize.captain ?? hunter.captain}, who hunted you, is gone.  The vendetta ends here.` };
    }
    if (hunter.status === 'destroyed') {
      return { kind: 'scenario-win', message: `${hunter.name} is destroyed, with Captain ${hunter.captain} aboard.  The vendetta ends here.` };
    }
    return { kind: 'scenario-win', message: `${hunter.name} is out of the war.  Captain ${hunter.captain} will hunt you no longer.` };
  }

  return null;
};

/**
 * Live progress for the mission panel. Deliberately never gives away position the
 * player's sensors could not reach: the hunt scenario names your hunter's hull once
 * you have scanned it, and not one moment sooner.
 */
export const scenarioProgress = (game) => {
  const scenario = scenarioFor(game);

  if (scenario.id === 'defend-xanadu') {
    const base = getShip(game, 'xanadu');
    return [
      base ? `Xanadu: ${base.status} at ${base.x}, ${base.y}; shields ${base.shields}.` : 'Xanadu: lost.',
      `Hold until stardate ${scenario.stardates}.  Now stardate ${game.turn}.`,
    ];
  }

  if (scenario.id === 'hunt-the-vendetta') {
    const hunter = getShip(game, game.objectiveShipId);
    if (!hunter) return ['Your hunter is no longer in the war.'];
    if (game.scanned?.[hunter.id]) {
      return [`Your hunter: Captain ${hunter.captain} of the ${hunter.name}.  End that hull and the war is won.`];
    }
    return [
      `Your hunter is a captain called ${hunter.captain}.  Their hull is not yet identified.`,
      'Scan enemy ships to learn which one they command.',
    ];
  }

  return [];
};
