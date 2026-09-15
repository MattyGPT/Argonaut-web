import { DOCKING, FACTIONS, GRID_SIZE, MISS_CHANCE, RANGES, STALEMATE_ROUNDS, SURRENDER } from './constants.js';
import { damageShip, detonate, fireEvent, flushShields, killLines, resolveCollision, terminalEvent, tractorLock, weaponDamage } from './actions.js';
import { chooseAiAction } from './ai.js';
import { createRng } from './rng.js';
import { scenarioOutcome } from './scenarios.js';
import {
  appendLog,
  crewCapacity,
  describeOrder,
  distance,
  dockedAt,
  getShip,
  isActive,
  isStranded,
  shieldCapacity,
  strongestFederation,
  templateSystems,
  vendettaGrudge,
} from './state.js';

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
    return { game: blast.game, messages: blast.messages, events: blast.events, type: action.type };
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
    // A hull whose crew is killed but whose frame survives goes dark as a vacant
    // prize, not wreckage: only outright destruction draws the blast and the marker.
    if (hit.status === 'destroyed') {
      events.push({ kind: 'explosion', fromId: actor.id, toId: victim.id, x1: victim.x, y1: victim.y, x2: victim.x, y2: victim.y, hit: true });
      events.push(terminalEvent('destruction', action.type, victim, { attacker: actor }));
    }
    return {
      game: updated,
      messages: [
        `${actor.name} fires ${action.type} at ${target.name}.`,
        ...(kill ? killLines(game, actor, victim) : []),
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
  // A scenario objective can end the war in either direction. It is checked after
  // the annihilation outcomes, so wiping out an alliance still wins outright even
  // if the objective would have failed on the same stardate.
  const objective = scenarioOutcome(game);
  if (objective) return objective;
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

const surrenderWinner = (game, faction, active, factions) => {
  if (faction === FACTIONS.FEDERATION && !game.resigned) return null;
  if (active.length === 0 || active.length > SURRENDER.maxShips) return null;
  const mine = factionStrength(game, faction);
  const opposing = factions.filter((other) => other !== faction)
    .reduce((total, other) => total + factionStrength(game, other), 0);
  if (opposing === 0 || mine > opposing * SURRENDER.strengthRatio) return null;
  return factions.filter((other) => other !== faction)
    .sort((left, right) => factionStrength(game, right) - factionStrength(game, left))[0];
};

const markFactionSurrendered = (game, faction, winner) => ({
  ...game,
  phase: faction === FACTIONS.FEDERATION && game.resigned ? 'ended' : game.phase,
  outcome: faction === FACTIONS.FEDERATION && game.resigned
    ? { kind: 'alliance-win', message: `The Federation has surrendered to ${winner}.` }
    : game.outcome,
  ships: game.ships.map((ship) => isActive(ship) && ship.faction === faction
    ? { ...ship, status: 'surrendered', tractorBy: null }
    : ship),
  log: faction === FACTIONS.FEDERATION && game.resigned
    ? game.log
    : [...(game.log ?? []), `${faction} has surrendered to ${winner}.  Its ships stand down.`],
});

/**
 * A fleet down to its last ships and badly outmatched capitulates
 * ("has surrendered to"). An enemy alliance that surrenders simply drops out of
 * the war — its ships stand down and the fight continues. Only the Federation
 * autopilot's surrender (after you resign) ends the game.
 */
export const applySurrender = (game) => {
  if (game.outcome) return { game, events: [] };
  let next = game;
  const events = [];
  const factions = [...new Set(game.ships.map((ship) => ship.faction))];
  for (const faction of factions) {
    const active = next.ships.filter((ship) => isActive(ship) && ship.faction === faction);
    const winner = surrenderWinner(next, faction, active, factions);
    if (!winner) continue;
    for (const ship of active) {
      events.push(terminalEvent('surrender', 'surrender', ship, { surrenderedTo: winner }));
    }
    next = markFactionSurrendered(next, faction, winner);
    if (next.outcome) return { game: next, events };
  }
  return { game: next, events };
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
  const messages = [];
  const ships = game.ships.map((ship) => {
    const base = dockedAt(game, ship);
    if (!base) return ship;
    const shields = Math.min(shieldCapacity(ship), ship.shields + Math.ceil(shieldCapacity(ship) * DOCKING.shieldRate));
    const crew = Math.min(crewCapacity(ship), ship.crew + DOCKING.crewRate);
    // The dockyard also rebuilds hardware, one unit per stardate, starting with the
    // system that has lost the most.
    const systems = { ...ship.systems };
    const template = templateSystems(ship);
    const damaged = Object.keys(template)
      .filter((name) => systems[name] < template[name])
      .sort((a, b) => (template[b] - systems[b]) - (template[a] - systems[a]) || a.localeCompare(b));
    const repaired = damaged[0] ?? null;
    if (repaired) systems[repaired] += 1;
    if (shields === ship.shields && crew === ship.crew && !repaired) return ship;
    const gains = [
      shields > ship.shields ? `shields +${shields - ship.shields}` : null,
      crew > ship.crew ? `${crew - ship.crew} crew transferred` : null,
      repaired ? `${repaired} +1` : null,
    ].filter(Boolean);
    messages.push(`${ship.name} docks at ${base.name}: ${gains.join(', ')}.`);
    return { ...ship, shields, crew, systems };
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
  const surrender = applySurrender(game);
  game = surrender.game;
  events.push(...surrender.events);
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
    log: appendLog(game.log, log),
    events,
    // Kept so the player can watch the round back: twenty autopilot decisions
    // otherwise arrive as one wall of text.
    lastRound: { events, entries: log },
  };
};
