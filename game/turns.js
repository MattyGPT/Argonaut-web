import { FACTIONS, GRID_SIZE } from './constants.js';
import { damageShip, fireEvent, resolveCollision } from './actions.js';
import { chooseAiAction } from './ai.js';
import { createRng } from './rng.js';
import { getShip, strongestFederation } from './state.js';

const isActive = (ship) => ship?.status === 'active';
const units = (ship, system) => Math.max(0, ship.systems?.[system] ?? 0);
const replaceShip = (game, replacement) => ({ ...game, ships: game.ships.map((ship) => ship.id === replacement.id ? replacement : ship) });
const rngFor = (game) => createRng(`${game.seed}:${game.randomStep ?? 0}`);
const advanceRandom = (game) => ({ ...game, randomStep: (game.randomStep ?? 0) + 1 });

const resolveAiAction = (game, shipId) => {
  const actor = getShip(game, shipId);
  if (!isActive(actor)) return { game, messages: [], type: 'pass' };
  const action = chooseAiAction(game, shipId);
  if (action.type === 'pass') return { game, messages: [`${actor.name} holds position.`], type: action.type };
  if (['phasers', 'photons'].includes(action.type)) {
    const target = getShip(game, action.targetId);
    const amount = action.type === 'phasers' ? 12 + units(actor, 'phasers') * 4 : 24 + units(actor, 'photons') * 9;
    const before = target.status;
    const hit = damageShip(target, amount, rngFor(game));
    const kill = before === 'active' && hit.status !== 'active' ? 1 : 0;
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1, kills: actor.kills + kill };
    const victim = { ...hit, shotsTaken: hit.shotsTaken + 1 };
    const updated = advanceRandom({
      ...game,
      ships: game.ships.map((ship) => {
        if (ship.id === shooter.id) return shooter;
        if (ship.id === victim.id) return victim;
        return ship;
      }),
    });
    const events = [fireEvent(action.type, actor, target, true)];
    if (kill) events.push({ kind: 'explosion', fromId: actor.id, toId: victim.id, x1: victim.x, y1: victim.y, x2: victim.x, y2: victim.y, hit: true });
    return { game: updated, messages: [`${actor.name} fires ${action.type} at ${target.name}.`], type: action.type, events };
  }
  if (action.type === 'tractor') {
    const target = getShip(game, action.targetId);
    return { game: replaceShip(game, { ...target, tractorBy: actor.id }), messages: [`${actor.name} locks ${target.name} in a tractor beam.`], type: action.type };
  }
  if (action.type === 'move') {
    const x = Math.max(0, Math.min(GRID_SIZE, actor.x + action.dx));
    const y = Math.max(0, Math.min(GRID_SIZE, actor.y + action.dy));
    return { game: replaceShip(game, { ...actor, x, y }), messages: [`${actor.name} moves to ${x},${y}.`], type: action.type };
  }
  return { game, messages: [], type: action.type };
};

const dominantEnemy = (activeEnemies) => {
  const counts = activeEnemies.reduce((totals, ship) => {
    totals[ship.faction] = (totals[ship.faction] ?? 0) + 1;
    return totals;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Enemy';
};

const victoryMessage = (kind, faction) => {
  if (kind === 'draw') return 'The war has destroyed all four alliances.  No one wins.';
  if (kind === 'federation-win') return 'The Federation has triumphed.  The galaxy will live in peace.';
  if (kind === 'alliance-win') return `${faction} forces have won.  The galaxy must suffer their eternal mastery.`;
  return null;
};

/**
 * When the command ship is lost the war goes on. Command shifts to the strongest
 * remaining Federation ship so the player keeps fighting, matching the original's
 * "the war will continue without you" behavior.
 */
export const transferCommandIfNeeded = (game) => {
  const current = getShip(game, game.playerShipId);
  if (isActive(current)) return { game, message: null };
  const next = strongestFederation(game, null);
  if (!next) return { game, message: null };
  const preface = current?.status === 'destroyed'
    ? "You're dead.  The war will continue without you.  "
    : '';
  return {
    game: { ...game, playerShipId: next.id, vendettaShipId: null },
    message: `${preface}Federation command shifted to ${next.name}.  Welcome aboard your new ship, Captain.`,
  };
};

export const evaluateOutcome = (game) => {
  const activeFederation = game.ships.filter((ship) => isActive(ship) && ship.faction === FACTIONS.FEDERATION);
  const activeEnemies = game.ships.filter((ship) => isActive(ship) && ship.faction !== FACTIONS.FEDERATION);
  if (activeFederation.length === 0 && activeEnemies.length === 0) {
    return { kind: 'draw', message: victoryMessage('draw') };
  }
  if (activeEnemies.length === 0) {
    return { kind: 'federation-win', message: victoryMessage('federation-win') };
  }
  if (activeFederation.length === 0) {
    return { kind: 'alliance-win', message: victoryMessage('alliance-win', dominantEnemy(activeEnemies)) };
  }
  return { kind: 'active' };
};

const factionStrength = (game, faction) => game.ships
  .filter((ship) => isActive(ship) && ship.faction === faction)
  .reduce((total, ship) => total + ship.shields + ship.crew, 0);

/**
 * An autopilot that is down to its last ships and badly outmatched capitulates
 * rather than fight to annihilation ("has surrendered to").
 */
export const applySurrender = (game) => {
  if (game.outcome) return game;
  const factions = [...new Set(game.ships.map((ship) => ship.faction))];
  for (const faction of factions) {
    const active = game.ships.filter((ship) => isActive(ship) && ship.faction === faction);
    if (active.length === 0 || active.length > 2) continue;
    const mine = factionStrength(game, faction);
    const opposing = factions.filter((f) => f !== faction).reduce((total, f) => total + factionStrength(game, f), 0);
    if (opposing === 0 || mine > opposing * 0.15) continue;
    const winner = factions.filter((f) => f !== faction)
      .sort((a, b) => factionStrength(game, b) - factionStrength(game, a))[0];
    const kind = winner === FACTIONS.FEDERATION ? 'federation-win' : 'alliance-win';
    const message = faction === FACTIONS.FEDERATION
      ? `The Federation has surrendered to ${winner}.`
      : `${faction} has surrendered to ${winner}.`;
    return { ...game, phase: 'ended', outcome: { kind, message } };
  }
  return game;
};

/** Runs one autopilot turn for the player's ship (backtick command / spectator mode). */
export const resolveAutopilotTurn = (game) => {
  const shipId = game.playerShipId;
  const action = resolveAiAction(game, shipId);
  let next = action.game;
  const log = [...action.messages];
  const events = [...(action.events ?? [])];
  const actor = getShip(next, shipId);
  if (action.type === 'move' && isActive(actor)) {
    const collision = resolveCollision(next, actor);
    next = collision.game;
    log.push(...collision.messages);
    events.push(...(collision.events ?? []));
  }
  return { game: { ...next, phase: 'computer' }, messages: log, events };
};

export const resolveComputerTurns = (initialGame) => {
  let game = { ...initialGame, ships: initialGame.ships.map((ship) => ({ ...ship, systems: { ...ship.systems } })) };
  const log = [];
  const events = [];
  const order = game.ships.filter((ship) => isActive(ship) && ship.id !== game.playerShipId).map((ship) => ship.id);
  for (const shipId of order) {
    if (evaluateOutcome(game).kind !== 'active') break;
    const action = resolveAiAction(game, shipId);
    game = action.game;
    log.push(...action.messages);
    events.push(...(action.events ?? []));
    const actor = getShip(game, shipId);
    if (action.type === 'move' && isActive(actor)) {
      const collision = resolveCollision(game, actor);
      game = collision.game;
      log.push(...collision.messages);
      events.push(...(collision.events ?? []));
    }
  }
  const transfer = transferCommandIfNeeded(game);
  game = transfer.game;
  if (transfer.message) log.push(transfer.message);
  game = applySurrender(game);
  if (game.outcome) log.push(game.outcome.message);
  const outcome = game.outcome ?? evaluateOutcome(game);
  return {
    ...game,
    turn: game.turn + 1,
    phase: outcome.kind === 'active' ? 'player' : 'ended',
    outcome: outcome.kind === 'active' ? null : outcome,
    log: [...(game.log ?? []), ...log],
    events,
  };
};
