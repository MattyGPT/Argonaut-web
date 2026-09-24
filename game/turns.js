import { DOCKING, ENCOUNTERS, FACTIONS, GRID_SIZE, POWER, PRIZE, RANGES, REIMAGINED_WEAPON_DAMAGE_SCALE, STALEMATE_ROUNDS, SURRENDER, TERRAIN } from './constants.js';
import { captureHull, canLaunchDrones, damageShip, detonate, fireEvent, flushShields, ionDamage, killLines, launchDrones, resolveAsteroidStrike, resolveCollision, spreadSplash, terminalEvent, tractorLock, weaponDamage } from './actions.js';
import { chooseAiAction } from './ai.js';
import { createRng } from './rng.js';
import { scenarioOutcome } from './scenarios.js';
import {
  appendLog,
  applyHeading,
  bearingDeg,
  crewCapacity,
  describeOrder,
  distance,
  dockedAt,
  getShip,
  grownArcs,
  isActive,
  isDrone,
  isImmovable,
  isNeutral,
  isStranded,
  isTractorHeld,
  powerEffect,
  segmentCrossesFeature,
  sensorRange,
  shieldCapacity,
  spawnEncounter,
  struckArc,
  strongestFederation,
  systemUnits,
  templateSystems,
  vendettaGrudge,
  volleyMissChance,
} from './state.js';

const replaceShip = (game, replacement) => ({ ...game, ships: game.ships.map((ship) => ship.id === replacement.id ? replacement : ship) });
const rngFor = (game) => createRng(`${game.seed}:${game.randomStep ?? 0}`);
const advanceRandom = (game) => ({ ...game, randomStep: (game.randomStep ?? 0) + 1 });

/**
 * Round 23 (23c): AI captains fight bow-on. A hull that is NOT moving this
 * stardate snaps its facing to the target of its chosen action — or the nearest
 * active enemy when the action names none — so the reinforced fore arc points at
 * whatever it is shooting, towing, boarding, or simply watching. Movement actions
 * are exempt: a burn already implies its heading (23a), which is how a retreating
 * hull ends up running on its weak aft with no special-casing. Free (no stardate,
 * no turn cost) and deterministic (pure bearing math, no RNG), Reimagined only;
 * drones have no facing, and a classic or extended war never touches one.
 */
const faceThreat = (game, actor, action) => {
  if (!game.reimagined || isDrone(actor)) return actor;
  if (action.type === 'move' || action.type === 'hyperspace') return actor;
  let threat = action.targetId ? getShip(game, action.targetId) : null;
  if (!threat || !isActive(threat) || threat.faction === actor.faction) {
    threat = game.ships
      .filter((other) => isActive(other) && other.faction !== actor.faction)
      .sort((a, b) => distance(actor, a) - distance(actor, b) || a.id.localeCompare(b.id))[0] ?? null;
  }
  if (!threat || (threat.x === actor.x && threat.y === actor.y)) return actor;
  const facing = Math.round(bearingDeg(actor, threat));
  return actor.facing === facing ? actor : { ...actor, facing };
};

const resolveAiAction = (startGame, shipId) => {
  let game = startGame;
  let actor = getShip(game, shipId);
  if (!isActive(actor)) return { game, messages: [], type: 'pass' };
  const action = chooseAiAction(game, shipId);
  // The bow snaps onto the threat BEFORE the action resolves, so every volley of
  // this stardate — the ones this hull fires and the ones fired at it later in the
  // phase — reads the disciplined facing.
  const faced = faceThreat(game, actor, action);
  if (faced !== actor) {
    actor = faced;
    game = replaceShip(game, faced);
  }
  if (action.type === 'pass') return { game, messages: [`${actor.name} holds position.`], type: action.type };
  if (action.type === 'shields') {
    const flushed = flushShields(actor, game);
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
    // Autopilots miss at the same rate as the player, from the same roll order,
    // against the same shared terrain threshold (15c + 15d): asteroid cover on the
    // shot line and the storm-ring static both degrade the volley, symmetrically.
    const covered = segmentCrossesFeature(game, actor, target, 'asteroids');
    if (rng.next() < volleyMissChance(game, actor, target)) {
      const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
      return {
        game: advanceRandom(replaceShip(game, shooter)),
        messages: [`${actor.name} fires ${action.type} at ${target.name}. Missed!${covered ? ' The volley splashes into asteroids.' : ''}`],
        type: action.type,
        events: [fireEvent(action.type, actor, target, false)],
      };
    }
    const grudge = vendettaGrudge(game, actor, target);
    const amount = weaponDamage(action.type, actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
    const before = target.status;
    // Round 23: an aimed volley strikes the target's arc the shooter bears on —
    // null outside a Reimagined war or against a drone, so a classic or extended
    // hit keeps its single-pool math byte-identically.
    const arc = struckArc(game, actor, target);
    const hit = damageShip(target, amount, rng, arc ? { arc } : {});
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
  if (action.type === 'ion') {
    // Ion/EMP (round 22a): the suppression volley. Same shared accuracy roll and
    // weapons power sink as the guns, but it disables rather than destroys — no
    // kill is credited and no wreck is drawn, so a gutted hull stays an active hulk.
    const target = getShip(game, action.targetId);
    const rng = rngFor(game);
    if (rng.next() < volleyMissChance(game, actor, target)) {
      const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
      return {
        game: advanceRandom(replaceShip(game, shooter)),
        messages: [`${actor.name} fires an ion burst at ${target.name}. Missed!`],
        type: action.type,
        events: [fireEvent('ion', actor, target, false)],
      };
    }
    const grudge = vendettaGrudge(game, actor, target);
    const amount = weaponDamage('ion', actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
    const hit = ionDamage(target, amount, rng);
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
    const victim = { ...hit, shotsTaken: hit.shotsTaken + 1 };
    const updated = advanceRandom({
      ...game,
      ships: game.ships.map((ship) => {
        if (ship.id === shooter.id) return shooter;
        if (ship.id === victim.id) return victim;
        return ship;
      }),
    });
    const stripped = Object.values(target.systems).reduce((total, units) => total + units, 0)
      - Object.values(hit.systems).reduce((total, units) => total + units, 0);
    const burned = Object.keys(hit.systems).filter((name) => target.systems[name] > 0 && hit.systems[name] === 0);
    return {
      game: updated,
      messages: [
        stripped > 0
          ? `${actor.name}'s ion burst tears through ${target.name}'s shields, burning out ${stripped} subsystem unit${stripped === 1 ? '' : 's'}.`
          : `${actor.name} fires an ion burst at ${target.name}; its shields absorb the charge.`,
        ...(burned.length ? [`${target.name}'s ${burned.join(', ')} ${burned.length === 1 ? 'is' : 'are'} disabled.`] : []),
      ],
      type: action.type,
      events: [fireEvent('ion', actor, target, true)],
    };
  }
  if (action.type === 'spread') {
    // Spread torpedoes (round 22c): the area salvo. Same shared accuracy roll as
    // the guns, then a splash that damages every hull near the impact — the AI only
    // looses it into a clean cluster (engage/spreadWorthIt guarantees no friendly
    // fire). spreadSplash credits the shooter's shotsFired and any kills itself.
    const target = getShip(game, action.targetId);
    const rng = rngFor(game);
    if (rng.next() < volleyMissChance(game, actor, target)) {
      const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
      return {
        game: advanceRandom(replaceShip(game, shooter)),
        messages: [`${actor.name} fires a spread of torpedoes at ${target.name}. Missed — the salvo splashes nothing.`],
        type: action.type,
        events: [fireEvent('spread', actor, target, false)],
      };
    }
    const grudge = vendettaGrudge(game, actor, target);
    const full = weaponDamage('spread', actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
    const splash = spreadSplash(game, actor, target, full, rng);
    return {
      game: advanceRandom(splash.game),
      messages: [`${actor.name} fires a spread of torpedoes at ${target.name}.`, ...splash.messages],
      type: action.type,
      events: [fireEvent('spread', actor, target, true), ...splash.events],
    };
  }
  if (action.type === 'tractor') {
    const target = getShip(game, action.targetId);
    if (!isActive(target) || isImmovable(target) || distance(actor, target) > RANGES.tractor) {
      return { game, messages: [`${actor.name} holds position.`], type: 'pass' };
    }
    const { pull, position } = tractorLock(actor, target, game.gridSize ?? GRID_SIZE, null, powerEffect(game, actor, 'tractor'));
    // Round 23: a towed hull heads the way it was dragged (Reimagined only).
    const pulled = { ...applyHeading(game, target, position.x, position.y), tractorBy: actor.id };
    const collision = resolveCollision(replaceShip(game, pulled), pulled);
    // A tow that ends inside an asteroid field exposes the victim to a rock strike
    // (15c) — the Cabal's tractor-ram can now dump a hull into the rocks as well.
    const strike = resolveAsteroidStrike(collision.game, pulled);
    return {
      game: strike.game,
      messages: [
        `${actor.name} locks ${target.name} in a tractor beam.`,
        `Tractor beam good for ${pull} units pull. ${actor.name} has beamed ${target.name} to ${position.x}, ${position.y}.`,
        ...collision.messages,
        ...strike.messages,
      ],
      events: [...collision.events, ...strike.events],
      type: action.type,
    };
  }
  if (action.type === 'board') {
    // Prize-taking (round 17, Reimagined): revalidated here because the derelict
    // may have been taken or destroyed since the action was chosen earlier in the
    // same computer phase. The capture helper stamps the record, deals the prize
    // captain, and auto-issues the withdraw; no RNG is consumed.
    const target = getShip(game, action.targetId);
    if (!target || target.status !== 'vacant' || systemUnits(actor, 'transporter') <= 0 || actor.crew <= 1
      || distance(actor, target) > sensorRange(game, actor, 'transporter')) {
      return { game, messages: [`${actor.name} holds position.`], type: 'pass' };
    }
    const capture = captureHull(game, actor, target, PRIZE.aiParty);
    return {
      game: capture.game,
      messages: [`${actor.name} beams a prize crew across to ${target.name}.`, ...capture.messages],
      type: action.type,
    };
  }
  if (action.type === 'launch') {
    // The bay (round 20, Reimagined): revalidated like board, because the
    // carrier may have been hit since the action was chosen earlier in the same
    // computer phase. The launch helper stamps the bay empty and spawns the
    // complement; no RNG is consumed.
    if (!canLaunchDrones(game, actor)) {
      return { game, messages: [`${actor.name} holds position.`], type: 'pass' };
    }
    const out = launchDrones(game, actor);
    return { game: out.game, messages: out.messages, type: action.type };
  }
  if (action.type === 'depart') {
    // A neutral merchant's visit is over (round 24): it jumps out and leaves the
    // field entirely. No RNG consumed, narrated like the arrival it answers.
    return {
      game: { ...game, ships: game.ships.filter((ship) => ship.id !== actor.id) },
      messages: [`${actor.name} jumps to hyperspace and is gone.`],
      type: action.type,
    };
  }
  if (action.type === 'move') {
    const grid = game.gridSize ?? GRID_SIZE;
    const x = Math.max(0, Math.min(grid, actor.x + action.dx));
    const y = Math.max(0, Math.min(grid, actor.y + action.dy));
    // Round 23: an AI burn implies its heading, exactly like the player's move.
    return { game: replaceShip(game, applyHeading(game, actor, x, y)), messages: [`${actor.name} moves to ${x},${y}.`], type: action.type };
  }
  return { game, messages: [], type: action.type };
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
  const preface = current?.status === 'destroyed'
    ? "You're dead.  The war will continue without you.  "
    : '';
  const next = strongestFederation(game, null);
  if (!next) {
    // The Federation is out of the war but the war is not over: the alliances
    // still afloat keep fighting it out, and the player watches from here on.
    // Only said once, and not at all on the stardate the war itself ends.
    if (game.commandLost || evaluateOutcome(game).kind !== 'active') return { game, message: null };
    return {
      game: { ...game, commandLost: true },
      message: `${preface}Federation command has no hull left.  You watch the rest of the war from here.`,
    };
  }
  return {
    game: { ...game, playerShipId: next.id, vendettaShipId: null },
    message: `${preface}Federation command shifted to ${next.name}.  Welcome aboard your new ship, Captain.`,
  };
};

export const evaluateOutcome = (game) => {
  // Every alliance afloat is at war with every other, so the war ends only when
  // the field is down to one — or none. Losing the Federation does not hand the
  // victory to whoever happens to be strongest at that instant: the surviving
  // alliances keep fighting until one of them is left standing.
  // Drones never hold a faction in the war (round 20, Matt's call): a bay with no
  // fleet behind it is wreckage in the making, and a drone-only rump cannot win,
  // surrender, or be hunted down for a victory it cannot lose. The orphans go
  // dark in the same computer phase (`darkenOrphanDrones`). Neutral merchants
  // (round 24) are excluded the same way: a civilian passing through neither
  // prolongs nor wins anybody's war.
  const activeFactions = [...new Set(game.ships.filter((ship) => isActive(ship) && !isDrone(ship) && !isNeutral(ship)).map((ship) => ship.faction))];
  if (activeFactions.length === 0) {
    return { kind: 'draw', message: victoryMessage('draw') };
  }
  if (activeFactions.length === 1) {
    const [last] = activeFactions;
    if (last === FACTIONS.FEDERATION) return { kind: 'federation-win', message: victoryMessage('federation-win') };
    return { kind: 'alliance-win', message: victoryMessage('alliance-win', last) };
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

// Drones count for nothing in the endgame math (round 20): neither here nor in
// the last-ships-standing gate below, so a faction's surrender turns only on the
// crewed hulls that can still fight. Its drones stand down with it regardless —
// `markFactionSurrendered` marks every active ship of the faction.
const factionStrength = (game, faction) => game.ships
  .filter((ship) => isActive(ship) && !isDrone(ship) && !isNeutral(ship) && ship.faction === faction)
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
  // Round 24: only the four alliances capitulate — a neutral merchant is not a
  // belligerent and can never be forced to "surrender" out of the field.
  const factions = [...new Set(game.ships.filter((ship) => !isDrone(ship) && !isNeutral(ship)).map((ship) => ship.faction))];
  for (const faction of factions) {
    // The last-ships-standing gate counts crewed hulls only (round 20): drones
    // neither delay their alliance's capitulation nor are they left out of it —
    // the marking below stands every active ship of the faction down.
    const active = next.ships.filter((ship) => isActive(ship) && !isDrone(ship) && ship.faction === faction);
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
 * A hull left with crew aboard but no engines and no guns — unable to fight, flee,
 * or flush shields — strikes its colors at stardate end instead of fighting on as a
 * hulk: the crew takes to escape pods and the hull is left vacant to board.
 *
 * Precision fire makes this achievable on purpose with called shots, so a precision
 * war has always had it. A Reimagined war gets it too (round 22a): the ion/EMP
 * emitter strips subsystems without killing crew, so without this an ion-gutted hull
 * would linger helpless — repaired at the dockyard, back out, gutted again — and the
 * war would stall. Striking its colors turns the ion kill-shot into a derelict anyone
 * can board, so suppression feeds the prize race instead of stretching the war. A
 * classic or extended (non-precision) war sees neither and its hulks behave exactly
 * as calibrated. A starbase is exempt — it never had engines, so burnt-out guns leave
 * it a fortress, not a derelict — and your command ship never surrenders while you
 * have the conn.
 */
export const resolveDisabledSurrender = (game) => {
  if ((!game.precision && !game.reimagined) || game.outcome) return { game, messages: [], events: [] };
  const messages = [];
  const events = [];
  const ships = game.ships.map((ship) => {
    if (!isActive(ship) || ship.crew <= 0 || ship.className === 'Starbase') return ship;
    // A neutral merchant never strikes its colors (round 24): a civilian hull is
    // seized whole by a transporter party or jumps out when its visit ends — it
    // does not become a derelict of "Neutral" lingering in the field.
    if (isNeutral(ship)) return ship;
    if (!game.resigned && ship.id === game.playerShipId) return ship;
    if (ship.systems.engines > 0 || ship.systems.phasers > 0 || ship.systems.photons > 0) return ship;
    messages.push(`${ship.name} is disabled and strikes its colors.  Its crew takes to escape pods.`);
    events.push(terminalEvent('surrender', 'disabled', ship));
    return { ...ship, status: 'vacant', crew: 0, tractorBy: null };
  });
  if (messages.length === 0) return { game, messages, events };
  return { game: { ...game, ships }, messages, events };
};

/**
 * When a faction loses its last crewed hull its bays go dark with it (round 20):
 * drones never hold a faction in the war — `evaluateOutcome` does not count them
 * — so orphaned units are switched off in the same computer phase instead of
 * haunting the field as the ghost of an alliance that is already out. Runs even
 * on the stardate the war itself ends, so no final report shows a defeated
 * alliance's drones still flying. Inert outside a Reimagined war, where no drone
 * ever exists.
 */
export const darkenOrphanDrones = (game) => {
  if (!game.reimagined) return { game, messages: [] };
  const crewed = new Set(game.ships.filter((ship) => isActive(ship) && !isDrone(ship)).map((ship) => ship.faction));
  const messages = [];
  const darkened = new Set();
  const ships = game.ships.map((ship) => {
    if (!isActive(ship) || !isDrone(ship) || crewed.has(ship.faction)) return ship;
    if (!darkened.has(ship.faction)) {
      darkened.add(ship.faction);
      messages.push(`The last ${ship.faction} hull is gone; its drones go dark.`);
    }
    return { ...ship, status: 'destroyed', tractorBy: null };
  });
  if (messages.length === 0) return { game, messages };
  return { game: { ...game, ships }, messages };
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
    // Round 23: the yard's shield top-up pours into the breakdown — focused arc
    // first, then the weakest (inert without arcs, so parity holds).
    const arcs = grownArcs(game, ship, shields);
    return { ...ship, shields, crew, systems, ...(arcs ? { arcs } : {}) };
  });
  return { game: { ...game, ships }, messages };
};

/**
 * Power management (Reimagined): surplus routed to the shield sink regenerates a
 * little shield power every stardate, scaled by how hard the reactor drives it. A
 * hull whose reactor is knocked out regenerates nothing. Resolves in the computer
 * phase, like the dockyard. Inert in a classic or extended war.
 */
export const resolvePowerRegen = (game) => {
  if (!game.reimagined) return { game, messages: [] };
  const messages = [];
  const ships = game.ships.map((ship) => {
    if (!isActive(ship)) return ship;
    const capacity = shieldCapacity(ship);
    if (ship.shields >= capacity) return ship;
    const gained = Math.min(capacity - ship.shields, Math.floor(capacity * POWER.shieldRegenRate * powerEffect(game, ship, 'shields')));
    if (gained <= 0) return ship;
    messages.push(`${ship.name}'s reactor restores ${gained} shield power.`);
    // Round 23: the trickle refills the focused arc first, then the weakest.
    const arcs = grownArcs(game, ship, ship.shields + gained);
    return { ...ship, shields: ship.shields + gained, ...(arcs ? { arcs } : {}) };
  });
  return { game: { ...game, ships }, messages };
};

/**
 * Capturable relay objectives (round 16, Reimagined). A hull that ends the stardate
 * inside a relay node and is not tractor-held holds it for its alliance, recorded on
 * `game.held`; while held, every hull of that alliance gains `relayPowerBonus`
 * reactor budget per node (`reactorOutput` reads it), so the whole fleet can
 * overcharge a sink without starving another. Contested — hulls of two or more
 * alliances inside when the stardate ends — or driven off, the node goes dark and
 * free. Resolves in the computer phase like the dockyard and is narrated on every
 * change. Without relay terrain this is inert, so a classic or extended war never
 * sees it, and old saves default `held` safely.
 */
export const resolveObjectives = (game) => {
  const relays = (game.terrain ?? []).filter((feature) => feature.type === 'relay');
  if (relays.length === 0) return { game, messages: [] };
  const held = { ...(game.held ?? {}) };
  const messages = [];
  for (const relay of relays) {
    // A drone neither holds nor contests a node (round 20): an unmanned hull
    // camped on the objective cannot work it, and its alliance's war is fought
    // by the crews, not the bays.
    const inside = game.ships.filter((ship) => isActive(ship) && !isDrone(ship) && !isNeutral(ship) && !isTractorHeld(game, ship)
      && distance(ship, relay) <= relay.radius);
    const factions = [...new Set(inside.map((ship) => ship.faction))];
    const before = held[relay.id] ?? null;
    const after = factions.length === 1 ? factions[0] : null;
    if (after) held[relay.id] = after;
    else delete held[relay.id];
    if (after && after !== before) {
      messages.push(before
        ? `The ${after} has wrested the relay node at ${relay.x}, ${relay.y} from the ${before}.`
        : `The ${after} holds the relay node at ${relay.x}, ${relay.y} — its reactors gain ${TERRAIN.relayPowerBonus} power budget.`);
    } else if (!after && before) {
      messages.push(factions.length > 1
        ? `The relay node at ${relay.x}, ${relay.y} is contested — the ${before} has lost it.`
        : `The ${before} has lost the relay node at ${relay.x}, ${relay.y}.`);
    }
  }
  return { game: { ...game, held }, messages };
};

/**
 * Random encounters (round 24, Reimagined): one seeded draw per stardate
 * boundary on the `${seed}:encounters:<turn>` sub-stream — the prize-captains
 * pattern, so the main war stream never shifts and a seed replays the same
 * arrivals. On a hit, one encounter hull enters the field at least
 * `ENCOUNTERS.minDistance` from every hull (drawn, not aimed: if the field is
 * too crowded after `placementTries` tries, the arrival is simply skipped and
 * the war carries on — deterministically). At most `maxAlive` encounter hulls
 * stand at once: a derelict counts until boarded or broken up, a distress hull
 * until its engines are repaired, a merchant until it jumps out. Resolves in
 * the computer phase after the actors have moved and before the dockyard, so an
 * arrival never acts on the stardate it arrives.
 */
export const resolveEncounters = (game) => {
  if (!game.reimagined || game.outcome) return { game, messages: [] };
  const messages = [];
  // The rescue window (round 24): a distress hull nobody got under tow or
  // repair inside `distressPatience` stardates is abandoned — the crew takes to
  // the pods and the hull goes dark as boardable salvage, so a stranded ship out
  // in the deep field can never hold its alliance in the war forever.
  const waiting = game.ships.map((ship) => {
    if (ship.encounter?.type !== 'distress' || !isActive(ship) || systemUnits(ship, 'engines') > 0) return ship;
    if (game.turn - (ship.encounter.turn ?? game.turn) < ENCOUNTERS.distressPatience) return ship;
    messages.push(`Nobody came for the ${ship.name}. Its crew takes to the pods, and the hull goes dark.`);
    return { ...ship, status: 'vacant', crew: 0, tractorBy: null };
  });
  const field = messages.length ? { ...game, ships: waiting } : game;
  const standing = field.ships.filter((ship) => ship.encounter
    && ((ship.encounter.type === 'derelict' && ship.status === 'vacant')
      || (ship.encounter.type === 'distress' && isActive(ship) && systemUnits(ship, 'engines') === 0)
      || (ship.encounter.type === 'neutral' && isActive(ship) && isNeutral(ship)))).length;
  if (standing >= ENCOUNTERS.maxAlive) return { game: field, messages };
  const rng = createRng(`${field.seed}:encounters:${field.turn}`);
  if (rng.next() >= ENCOUNTERS.chance) return { game: field, messages };
  // Weighted type draw off the same sub-stream.
  const entries = Object.entries(ENCOUNTERS.weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  let type = entries[entries.length - 1][0];
  for (const [name, weight] of entries) {
    if (roll < weight) { type = name; break; }
    roll -= weight;
  }
  const grid = field.gridSize ?? GRID_SIZE;
  let position = null;
  for (let attempt = 0; attempt < ENCOUNTERS.placementTries && !position; attempt += 1) {
    const candidate = { x: rng.integer(2, grid - 2), y: rng.integer(2, grid - 2) };
    if (field.ships.every((ship) => ship.status === 'destroyed' || distance(candidate, ship) >= ENCOUNTERS.minDistance)) {
      position = candidate;
    }
  }
  if (!position) return { game: field, messages };
  const hull = spawnEncounter(field, type, position.x, position.y, rng);
  const message = type === 'derelict'
    ? `The ${hull.name} drifts into the war zone at ${position.x}, ${position.y} — a derelict of the ${hull.faction}, dark and waiting.`
    : type === 'distress'
      ? `Distress call: the Federation ${hull.name} is adrift at ${position.x}, ${position.y}, engines gone, broadcasting for a tow.`
      : `A neutral merchant, the ${hull.name}, creeps through the field at ${position.x}, ${position.y}, running silent.`;
  return { game: { ...field, ships: [...field.ships, hull] }, messages: [...messages, message] };
};

/**
 * A fingerprint of everything that could make the war progress: where every hull
 * sits, what it can still do, and who owns it. Two consecutive rounds with the
 * same fingerprint mean nothing happened anywhere in the war zone. A neutral
 * merchant is not part of the war's progress (round 24): a civilian passing
 * through neither resolves nor prolongs anything, so its comings and goings
 * must not reset the stalemate net.
 */
const warSignature = (game) => game.ships
  .filter((ship) => !isNeutral(ship))
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
    // Ending the move inside an asteroid field risks a rock strike (15c).
    const strike = resolveAsteroidStrike(next, getShip(next, shipId));
    next = strike.game;
    log.push(...strike.messages);
    events.push(...(strike.events ?? []));
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
      // Ending the move inside an asteroid field risks a rock strike (15c), for
      // every alliance's hulls alike — terrain applies symmetrically.
      const strike = resolveAsteroidStrike(game, getShip(game, shipId));
      game = strike.game;
      log.push(...strike.messages);
      events.push(...(strike.events ?? []));
    }
  }
  // An alliance whose last crewed hull died this stardate takes its drones with
  // it (round 20), before the dockyard, the objectives, and the outcome checks
  // read the field.
  const darkened = darkenOrphanDrones(game);
  game = darkened.game;
  log.push(...darkened.messages);
  // Random encounters (round 24) arrive at the stardate boundary — after the
  // actors have moved, before the dockyard and objectives read the field, so an
  // arrival never acts on the stardate it arrives.
  const encounters = resolveEncounters(game);
  game = encounters.game;
  log.push(...encounters.messages);
  const docked = resolveDocking(game);
  game = docked.game;
  log.push(...docked.messages);
  // The relay objectives resolve like the dockyard (round 16), and before the
  // shield regen, so an alliance that just took a node already runs its reactors
  // on the raised budget this stardate.
  const objectives = resolveObjectives(game);
  game = objectives.game;
  log.push(...objectives.messages);
  const regen = resolvePowerRegen(game);
  game = regen.game;
  log.push(...regen.messages);
  // After the dockyard, so a disabled hull that limped home keeps fighting;
  // before the fleet capitulation check, so a hull that struck its colors no
  // longer counts toward its alliance's strength.
  const colors = resolveDisabledSurrender(game);
  game = colors.game;
  log.push(...colors.messages);
  events.push(...colors.events);
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
