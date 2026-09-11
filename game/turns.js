import { DOCKING, FACTIONS, GRID_SIZE, MISS_CHANCE, RANGES, STALEMATE_ROUNDS, SURRENDER } from './constants.js';
import { damageShip, detonate, fireEvent, flushShields, killLines, resolveCollision, tractorLock, weaponDamage } from './actions.js';
import { chooseAiAction } from './ai.js';
import { createRng } from './rng.js';
import {
  crewCapacity,
  describeOrder,
  distance,
  getShip,
  isStranded,
  isTractorHeld,
  shieldCapacity,
  strongestFederation,
  vendettaGrudge,
} from './state.js';

const isActive = (ship) => ship?.status === 'active';
const replaceShip = (game, replacement) => ({ ...game, ships: game.ships.map((ship) => ship.id === replacement.id ? replacement : ship) });
const rngFor = (game) => createRng(`${game.seed}:${game.randomStep ?? 0}`);
const advanceRandom = (game) => ({ ...game, randomStep: (game.randomStep ?? 0) + 1 });

const resolveAiAction = (game, shipId) => {
  const actor = getShip(game, shipId);
  if (!isActive(actor)) return { game, messages: [], type: 'pass' };
  const action = chooseAiAction(game, shipId);
  if (action.type === 'pass') return { game, messages: [`${actor.name} holds position.`], type: action.type };
  if (action.type === 'shields') {
    const flushed = flushShields(actor);
    if (!flushed) return { game, messages: [`${actor.name} holds position.`], type: 'pass' };
    return {
      game: replaceShip(game, flushed.ship),
      messages: [`${actor.name} has flushed its engines for shield power.`],
      type: action.type,
    };
  }
  if (action.type === 'self-destruct') {
    const blast = detonate(game, actor);
    return { game: blast.game, messages: blast.messages, type: action.type };
  }
  if (['phasers', 'photons'].includes(action.type)) {
    const target = getShip(game, action.targetId);
    const rng = rngFor(game);
    // Autopilots miss at the same rate as the player, from the same roll order.
    if (rng.next() < MISS_CHANCE) {
      const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
      return {
        game: advanceRandom(replaceShip(game, shooter)),
        messages: [`${actor.name} fires ${action.type} at ${target.name}. Missed!`],
        type: action.type,
        events: [fireEvent(action.type, actor, target, false)],
      };
    }
    const grudge = vendettaGrudge(game, actor, target);
    const amount = weaponDamage(action.type, actor, rng, grudge);
    const before = target.status;
    const hit = damageShip(target, amount, rng);
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
    return {
      game: updated,
      messages: [
        `${actor.name} fires ${action.type} at ${target.name}.`,
        ...(kill ? killLines(game, actor, target) : []),
      ],
      type: action.type,
      events,
    };
  }
  if (action.type === 'tractor') {
    const target = getShip(game, action.targetId);
    if (!isActive(target) || distance(actor, target) > RANGES.tractor) {
      return { game, messages: [`${actor.name} holds position.`], type: 'pass' };
    }
    const { pull, position } = tractorLock(actor, target);
    const pulled = { ...target, tractorBy: actor.id, x: position.x, y: position.y };
    const collision = resolveCollision(replaceShip(game, pulled), pulled);
    return {
      game: collision.game,
      messages: [
        `${actor.name} locks ${target.name} in a tractor beam.`,
        `Tractor beam good for ${pull} units pull. ${actor.name} has beamed ${target.name} to ${position.x}, ${position.y}.`,
        ...collision.messages,
      ],
      events: collision.events,
      type: action.type,
    };
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
  if (kind === 'hopeless-draw') return 'The war has ended in a hopeless draw.  All survivors are stranded.';
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
  // Both sides still have hulls, but nothing left can change anything: either no
  // survivor can move or reach anyone, or the whole war zone has gone quiet for
  // STALEMATE_ROUNDS stardates. The original ends this in a hopeless draw rather
  // than playing out empty rounds.
  if (isStranded(game) || (game.stalemateRounds ?? 0) >= STALEMATE_ROUNDS) {
    return { kind: 'hopeless-draw', message: victoryMessage('hopeless-draw') };
  }
  return { kind: 'active' };
};

const factionStrength = (game, faction) => game.ships
  .filter((ship) => isActive(ship) && ship.faction === faction)
  .reduce((total, ship) => total + ship.shields + ship.crew, 0);

/**
 * A fleet down to its last ships and badly outmatched capitulates
 * ("has surrendered to"). An enemy alliance that surrenders simply drops out of
 * the war — its ships stand down and the fight continues. Only the Federation
 * autopilot's surrender (after you resign) ends the game.
 */
export const applySurrender = (game) => {
  if (game.outcome) return game;
  const factions = [...new Set(game.ships.map((ship) => ship.faction))];
  let next = game;
  for (const faction of factions) {
    const active = next.ships.filter((ship) => isActive(ship) && ship.faction === faction);
    if (active.length === 0 || active.length > SURRENDER.maxShips) continue;
    const mine = factionStrength(next, faction);
    const opposing = factions.filter((f) => f !== faction).reduce((total, f) => total + factionStrength(next, f), 0);
    if (opposing === 0 || mine > opposing * SURRENDER.strengthRatio) continue;
    const winner = factions.filter((f) => f !== faction)
      .sort((a, b) => factionStrength(next, b) - factionStrength(next, a))[0];
    if (faction === FACTIONS.FEDERATION) {
      if (!next.resigned) continue; // only the autopilot may capitulate
      return { ...next, phase: 'ended', outcome: { kind: 'alliance-win', message: `The Federation has surrendered to ${winner}.` } };
    }
    next = {
      ...next,
      ships: next.ships.map((ship) => isActive(ship) && ship.faction === faction
        ? { ...ship, status: 'surrendered', tractorBy: null }
        : ship),
      log: [...(next.log ?? []), `${faction} has surrendered to ${winner}.  Its ships stand down.`],
    };
  }
  return next;
};

/**
 * Orders issued to a ship out of radio contact wait a round. They arrive here,
 * after every autopilot has acted, so the fleet moves on them from the next
 * stardate onward.
 */
const relayOrders = (game) => {
  const pending = game.pendingOrders ?? {};
  const ids = Object.keys(pending);
  if (ids.length === 0) return { game, messages: [] };
  const messages = ids
    .map((id) => {
      const ship = getShip(game, id);
      return ship && isActive(ship) ? `${ship.name} receives your order to ${describeOrder(game, pending[id])}.` : null;
    })
    .filter(Boolean);
  return {
    game: { ...game, orders: { ...(game.orders ?? {}), ...pending }, pendingOrders: {} },
    messages,
  };
};

/**
 * Ships sitting near a healthy friendly starbase repair between rounds. The
 * original had no way to recover damage, so a long war was a one-way ratchet
 * downward; an extended war gives retreating and screening something to be for.
 * Subsystem units stay lost — the dockyard can restore shield power and transfer
 * crew, but it cannot rebuild a burnt-out mapper.
 */
export const resolveDocking = (game) => {
  if (!game.extended) return { game, messages: [] };
  const bases = game.ships.filter((ship) => isActive(ship)
    && ship.className === 'Starbase'
    && ship.shields >= shieldCapacity(ship) * DOCKING.minBaseCondition);
  if (bases.length === 0) return { game, messages: [] };

  const messages = [];
  const ships = game.ships.map((ship) => {
    if (!isActive(ship) || ship.className === 'Starbase' || isTractorHeld(game, ship)) return ship;
    const base = bases.find((other) => other.faction === ship.faction && distance(other, ship) <= DOCKING.range);
    if (!base) return ship;
    const shields = Math.min(shieldCapacity(ship), ship.shields + Math.ceil(shieldCapacity(ship) * DOCKING.shieldRate));
    const crew = Math.min(crewCapacity(ship), ship.crew + DOCKING.crewRate);
    if (shields === ship.shields && crew === ship.crew) return ship;
    const gains = [
      shields > ship.shields ? `shields +${shields - ship.shields}` : null,
      crew > ship.crew ? `${crew - ship.crew} crew transferred` : null,
    ].filter(Boolean);
    messages.push(`${ship.name} docks at ${base.name}: ${gains.join(', ')}.`);
    return { ...ship, shields, crew };
  });
  return { game: { ...game, ships }, messages };
};

/**
 * A fingerprint of everything that could make the war progress: where every hull
 * sits, what it can still do, and who owns it. Two consecutive rounds with the
 * same fingerprint mean nothing happened anywhere in the war zone.
 */
const warSignature = (game) => game.ships
  .map((ship) => [
    ship.id,
    `${ship.x},${ship.y}`,
    ship.status,
    ship.faction,
    `${ship.shields}/${ship.crew}`,
    Object.values(ship.systems).join(''),
    ship.tractorBy ?? '-',
  ].join(':'))
  .join('|');

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
  const docked = resolveDocking(game);
  game = docked.game;
  log.push(...docked.messages);
  const relay = relayOrders(game);
  game = relay.game;
  log.push(...relay.messages);
  const transfer = transferCommandIfNeeded(game);
  game = transfer.game;
  if (transfer.message) log.push(transfer.message);
  game = applySurrender(game);
  if (game.outcome) log.push(game.outcome.message);

  // Count stardates in which nothing anywhere in the war zone changed, so a war
  // that can no longer make progress ends instead of running empty rounds forever.
  const signature = warSignature(game);
  game = {
    ...game,
    warSignature: signature,
    stalemateRounds: signature === game.warSignature ? (game.stalemateRounds ?? 0) + 1 : 0,
  };

  const outcome = game.outcome ?? evaluateOutcome(game);
  if (!game.outcome && outcome.kind !== 'active') log.push(outcome.message);
  return {
    ...game,
    turn: game.turn + 1,
    phase: outcome.kind === 'active' ? 'player' : 'ended',
    outcome: outcome.kind === 'active' ? null : outcome,
    log: [...(game.log ?? []), ...log],
    events,
    // Kept so the player can watch the round back: twenty autopilot decisions
    // otherwise arrive as one wall of text.
    lastRound: { events, entries: log },
  };
};
