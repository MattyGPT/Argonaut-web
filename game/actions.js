import {
  ACE_KILLS,
  CAPTAIN_NAMES,
  CREW_DAMAGE_WEIGHT,
  CRIPPLE,
  DEFAULT_CREW_TRANSFER,
  DRONE,
  GRID_SIZE,
  HYPERSPACE_BURN_CHANCE,
  HYPERSPACE_MIN_SHIELD_LOSS,
  HYPERSPACE_SHIELD_LOSS,
  ORDER_TYPES,
  OVERKILL_DESTROY_MARGIN,
  POWER_SINKS,
  PRIZE,
  RANGES,
  REFITS,
  REFIT_OVER_TEMPLATE,
  REIMAGINED_WEAPON_DAMAGE_SCALE,
  SHIELD_PER_ENGINE,
  SHRAPNEL_DAMAGE,
  SHRAPNEL_EXTRA_RANGE,
  SPREAD,
  STANCES,
  SURGICAL_DAMAGE_FACTOR,
  TARGETED_ORDERS,
  TERRAIN,
  TRACTOR_PULL_PER_UNIT,
  VENDETTA,
  WEAPONS,
} from './constants.js';
import { createRng } from './rng.js';
import {
  alertLevel,
  applyHeading,
  blastRadius,
  captainOf,
  clampPowerAllocation,
  crewCapacity,
  describeOrder,
  describePower,
  distance,
  dockedAt,
  dronesOf,
  engineCapacity,
  getLivingShips,
  getShip,
  hasLaunchedDrones,
  inRadioContact,
  insideFeature,
  ionStormZone,
  isAce,
  isActive,
  isDrone,
  isImmovable,
  isSpectator,
  isTractorHeld,
  nebulaHides,
  normalizeDegrees,
  powerAllocation,
  powerEffect,
  radioReaches,
  reactorOutput,
  segmentCrossesFeature,
  sensorRange,
  shieldCapacity,
  spawnDrone,
  strongestFederation,
  systemUnits,
  templateSystems,
  vendettaGrudge,
  volleyMissChance,
} from './state.js';

const unitName = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Rolls one volley's damage. Shared by the player's shots and the autopilots'.
 * `grudge` is the vendetta captain's escalation against your command ship; at zero
 * the roll is exactly what it has always been, so a classic war is untouched.
 * `powerEff` is the weapons-sink multiplier (1 outside a Reimagined war, so parity
 * holds): routing reactor power into the guns scales the whole band up or down.
 * `durabilityScale` is the Reimagined durability lever (1 elsewhere): the whole
 * band scales with it, so the wide war's battles last long enough for terrain and
 * objectives to matter while the manual's spread ratio is preserved.
 */
export const weaponDamage = (type, shooter, rng, grudge = 0, powerEff = 1, durabilityScale = 1) => {
  const { base, perUnit, spread } = WEAPONS[type];
  const nominal = (base + systemUnits(shooter, type) * perUnit) * (1 + grudge * VENDETTA.damagePerStep) * powerEff * durabilityScale;
  const low = nominal * (1 - spread);
  return Math.max(1, Math.round(low + rng.next() * nominal * 2 * spread));
};

/**
 * What the narrative adds when a volley destroys a hull. Captains are named only in
 * an extended war, so a classic war's log stays exactly as calibrated. `shooter`
 * still carries its pre-kill tally here.
 */
export const killLines = (game, shooter, victim) => {
  if (!game.extended) return [];
  const credited = (shooter.kills ?? 0) + 1;
  // A hull whose crew is killed but whose subsystems survive goes dark rather than
  // breaking up: it is a vacant prize the winner can board, not wreckage.
  const fate = victim.status === 'vacant'
    ? `${victim.name} is adrift, its crew dead.`
    : `${victim.name} is destroyed.`;
  // A drone has nobody aboard (round 20): the hull itself is credited, and there
  // is no captain to make an ace, hunt a vendetta, or read as "undefined".
  if (isDrone(shooter)) {
    return [fate, `${shooter.name} is credited with ${credited} kill${credited === 1 ? '' : 's'}.`];
  }
  const lines = [
    fate,
    `${captainOf(shooter)} is credited with ${credited} kill${credited === 1 ? '' : 's'}.`,
  ];
  if (credited === ACE_KILLS) lines.push(`${captainOf(shooter)} is now an ace.`);
  if (shooter.id === game.vendettaShipId && credited % VENDETTA.killsPerStep === 0) {
    lines.push(`${captainOf(shooter)} hunts you still, and every kill makes those volleys bite harder.`);
  }
  return lines;
};

const replaceShip = (game, replacement) => ({
  ...game,
  ships: game.ships.map((ship) => ship.id === replacement.id ? replacement : ship),
});

const completeTurn = (game) => ({ ...game, phase: 'computer' });

const result = (game, messages, options = {}) => ({
  game,
  messages: Array.isArray(messages) ? messages : [messages],
  requiresTarget: Boolean(options.requiresTarget),
  ...(options.report ? { report: options.report } : {}),
  ...(options.events ? { events: options.events } : {}),
});

export const fireEvent = (kind, shooter, target, hit, details = {}) => ({
  kind,
  fromId: shooter.id,
  toId: target.id,
  x1: shooter.x,
  y1: shooter.y,
  x2: target.x,
  y2: target.y,
  hit,
  // Called system and power percentage, so the FX layer and the round replay
  // draw a focused beam as something distinct from a standard volley.
  ...details,
});

export const terminalEvent = (kind, cause, ship, options = {}) => ({
  kind,
  shipId: ship.id,
  shipName: ship.name,
  faction: ship.faction,
  x: ship.x,
  y: ship.y,
  cause,
  ...(options.attacker ? {
    attackerId: options.attacker.id,
    attackerName: options.attacker.name,
    attackerFaction: options.attacker.faction,
  } : {}),
  ...(options.surrenderedTo ? { surrenderedTo: options.surrenderedTo } : {}),
});

const invalid = (game, message, requiresTarget = false) => result(game, message, { requiresTarget });

const usableActor = (game) => {
  const ship = getShip(game, game.playerShipId);
  if (!isActive(ship)) return { error: 'Your current command ship is no longer active.' };
  return { ship };
};

const seededRng = (game) => createRng(`${game.seed}:${game.randomStep ?? 0}`);
const advanceRandom = (game) => ({ ...game, randomStep: (game.randomStep ?? 0) + 1 });

const targetFor = (game, action, actor) => {
  if (!action.targetId) return { error: 'A target is required.', requiresTarget: true };
  const target = getShip(game, action.targetId);
  if (!target || target.status === 'destroyed') return { error: 'That target is no longer available.' };
  if (target.id === actor.id) return { error: 'A ship cannot target itself.' };
  return { target };
};

const hostileTarget = (game, action, actor) => {
  const found = targetFor(game, action, actor);
  if (found.error) return found;
  if (found.target.faction === actor.faction) return { error: 'Weapons cannot fire on a friendly target.' };
  if (!isActive(found.target)) return { error: 'That target is not an active enemy ship.' };
  return found;
};

const requiresSystem = (game, actor, system) => systemUnits(actor, system) > 0
  ? null
  : invalid(game, `${system[0].toUpperCase()}${system.slice(1)} are disabled.`);

/**
 * Applies combat damage without changing its ship argument. Shields absorb damage
 * first; each exposed point then removes one crew member or one live subsystem unit,
 * weighted by CREW_DAMAGE_WEIGHT so the crew takes the bulk and the subsystems survive
 * to make a prize worth boarding. When the last crewman dies the volley stops: the hull
 * is left `vacant` and capturable unless its overkill reaches OVERKILL_DESTROY_MARGIN x
 * the surviving subsystems, which tears the frame apart (`destroyed`). A hull with
 * neither crew nor subsystems left is destroyed outright.
 */
export const damageShip = (ship, amount, rng = createRng('damage'), options = {}) => {
  if (!isActive(ship) || !Number.isFinite(amount) || amount <= 0) return ship;

  let remaining = Math.floor(amount);
  const shields = Math.max(0, ship.shields - remaining);
  remaining = Math.max(0, remaining - ship.shields);
  let crew = ship.crew;
  let systems = { ...ship.systems };

  // A called volley burns only the system it was called to: no crew casualties,
  // and the beam checks fire once that system is dead, so whatever damage the
  // roll left over is lost. Shields still absorb the volley first, as always.
  if (options.focus) {
    const burn = Math.min(remaining, systems[options.focus] ?? 0);
    if (burn > 0) systems = { ...systems, [options.focus]: systems[options.focus] - burn };
    return { ...ship, shields, crew, systems };
  }

  while (remaining > 0) {
    const live = Object.keys(systems).filter((name) => systems[name] > 0);
    const systemUnits = live.reduce((total, name) => total + systems[name], 0);
    // Each crew member holds CREW_DAMAGE_WEIGHT candidate slots against one per
    // surviving subsystem unit, so a volley can kill the crew before the hull is
    // stripped — see the constant. Without the weight the complement is outranked
    // by the subsystems and every knockout guts the ship instead of leaving a prize.
    const crewSlots = crew > 0 ? crew * CREW_DAMAGE_WEIGHT : 0;
    const slots = crewSlots + systemUnits;
    if (slots === 0) {
      return { ...ship, shields, crew: 0, systems, status: 'destroyed', tractorBy: null };
    }
    const roll = rng.next() * slots;
    if (roll < crewSlots) {
      crew -= 1;
      // The volley stops the instant the last crewman falls. The hull is a boardable
      // prize unless this shot overshot the crew hard enough to tear the frame apart
      // too: leftover damage at or past OVERKILL_DESTROY_MARGIN x the surviving
      // subsystems breaks it up. So a precise phaser finish captures an armed hull
      // while a photon spread that overshoots destroys it — see the constant.
      if (crew === 0) {
        const overkill = remaining - 1;
        const shattered = systemUnits === 0 || overkill >= OVERKILL_DESTROY_MARGIN * systemUnits;
        return { ...ship, shields, crew: 0, systems, status: shattered ? 'destroyed' : 'vacant', tractorBy: null };
      }
    } else {
      let offset = roll - crewSlots;
      let hit = live[live.length - 1];
      for (const name of live) {
        if (offset < systems[name]) { hit = name; break; }
        offset -= systems[name];
      }
      systems = { ...systems, [hit]: systems[hit] - 1 };
    }
    remaining -= 1;
  }

  return {
    ...ship,
    shields,
    crew,
    systems,
    // `vacant` means a crew was killed from above zero and the frame survived —
    // a hull that never carried a crew (a round-20 drone) can never be adrift
    // and boardable, so a scratch that only burns its shields leaves it active,
    // and stripping its systems destroys it outright via the empty-lottery path.
    ...(crew <= 0 && ship.crew > 0 ? { status: 'vacant', tractorBy: null } : {}),
  };
};

/**
 * Ion/EMP damage (round 22a, Reimagined): shields absorb the burst first, and the
 * overflow strips subsystem units one at a time — and never touches the crew. This
 * is the disable-not-destroy identity: a hull burned to zero systems is left an
 * intact, still-`active` hulk with its crew alive (never `vacant`, never
 * `destroyed`), which the dockyard rebuilds, a precision war strikes its colors, or
 * an enemy finishes off or boards. Leftover burst past the last system unit is
 * wasted. The system lottery matches `damageShip` (one slot per live unit, same walk
 * order), so ion degrades a hull exactly the way lethal fire would, minus the killing.
 */
export const ionDamage = (ship, amount, rng = createRng('ion')) => {
  if (!isActive(ship) || !Number.isFinite(amount) || amount <= 0) return ship;
  let remaining = Math.floor(amount);
  const shields = Math.max(0, ship.shields - remaining);
  remaining = Math.max(0, remaining - ship.shields);
  const systems = { ...ship.systems };
  while (remaining > 0) {
    const live = Object.keys(systems).filter((name) => systems[name] > 0);
    const units = live.reduce((total, name) => total + systems[name], 0);
    if (units === 0) break; // fully disabled — the rest of the charge bleeds into space
    let offset = rng.next() * units;
    let hit = live[live.length - 1];
    for (const name of live) {
      if (offset < systems[name]) { hit = name; break; }
      offset -= systems[name];
    }
    systems[hit] -= 1;
    remaining -= 1;
  }
  // A crewed hull gutted of systems is left an inert hulk to strike its colors or
  // be finished. A crew-0 hull (a round-20 drone) has nobody to surrender it, so
  // stripping its last system breaks it up, exactly as lethal fire would.
  if (ship.crew <= 0 && Object.values(systems).every((units) => units <= 0)) {
    return { ...ship, shields, systems, status: 'destroyed', tractorBy: null };
  }
  return { ...ship, shields, systems };
};

/**
 * Ships a fleet order may name: enemies for an intercept, friendlies for escort
 * and screen. Only active hulls can be given as a target.
 */
export const orderTargets = (game, shipId, orderType) => {
  const actor = getShip(game, shipId);
  if (!actor || !isActive(actor)) return [];
  const living = getLivingShips(game).filter((ship) => ship.id !== actor.id);
  // A board order names a derelict — any alliance's, including a struck-colors
  // friendly — which is the one targeted order that does not name an active ship.
  if (orderType === 'board') return living.filter((ship) => ship.status === 'vacant');
  const candidates = living.filter((ship) => isActive(ship));
  return orderType === 'intercept'
    ? candidates.filter((ship) => ship.faction !== actor.faction)
    : candidates.filter((ship) => ship.faction === actor.faction);
};

/**
 * Turns a clicked point on the tactical map into an engine displacement. The move is
 * clamped to what the ship can actually reach this stardate, so clicking past the
 * engine ring burns the full capacity toward that point instead of being refused —
 * the ring is already drawn on the map, so the player can see the limit.
 * Null when the ship cannot maneuver at all.
 */
export const maneuverTo = (game, x, y) => {
  if (game.phase !== 'player' || game.outcome || isSpectator(game)) return null;
  const actor = getShip(game, game.playerShipId);
  if (!isActive(actor) || systemUnits(actor, 'engines') <= 0 || isTractorHeld(game, actor)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const dx = x - actor.x;
  const dy = y - actor.y;
  const span = Math.hypot(dx, dy);
  if (span < 0.5) return null; // a click on your own hull is not an order
  const capacity = engineCapacity(actor, game.gridSize ?? GRID_SIZE, powerEffect(game, actor, 'engines'));
  const reach = Math.min(capacity, span);
  let moveX = Math.round((dx / span) * reach);
  let moveY = Math.round((dy / span) * reach);
  // Rounding both legs independently can push the vector just past the capacity the
  // move command enforces, which would refuse a click that looked perfectly legal.
  const rounded = Math.hypot(moveX, moveY);
  if (rounded > capacity) {
    moveX = Math.trunc((moveX / rounded) * capacity);
    moveY = Math.trunc((moveY / rounded) * capacity);
  }
  return { dx: moveX, dy: moveY };
};

export const eligibleTargets = (game, actionType) => {
  const actor = getShip(game, game.playerShipId);
  if (!actor) return [];
  const ships = getLivingShips(game).filter((ship) => ship.id !== actor.id);
  if (['phasers', 'photons', 'tractor', 'ion', 'spread'].includes(actionType)) {
    return ships.filter((ship) => isActive(ship) && ship.faction !== actor.faction);
  }
  // A drone is never a transporter subject (round 20): no crew to reinforce, and
  // an uncrewed hull is never `vacant`, so it can never be boarded.
  if (actionType === 'transport') return ships.filter((ship) => ship.status !== 'destroyed' && !isDrone(ship));
  if (actionType === 'scan') return ships;
  return ships;
};

/**
 * Picks a sensible preselected target: the nearest hostile inside range for
 * weapons and tractor, the nearest contact for scans, and the nearest friendly
 * for transports. The player can always pick someone else in the prompt.
 */
export const defaultTargetFor = (game, actionType) => {
  const actor = getShip(game, game.playerShipId);
  const targets = eligibleTargets(game, actionType);
  if (!actor || targets.length === 0) return undefined;
  const byDistance = (a, b) => distance(actor, a) - distance(actor, b);
  if (actionType === 'transport') {
    const friendly = targets
      .filter((ship) => isActive(ship) && ship.faction === actor.faction)
      .sort(byDistance)[0];
    return friendly?.id ?? [...targets].sort(byDistance)[0]?.id;
  }
  const enemies = targets.filter((ship) => isActive(ship) && ship.faction !== actor.faction);
  const sorted = [...(enemies.length ? enemies : targets)].sort(byDistance);
  const range = { phasers: RANGES.phasers, photons: RANGES.photons, tractor: RANGES.tractor, ion: RANGES.ion, spread: RANGES.spread }[actionType];
  if (range) return sorted.find((ship) => distance(actor, ship) <= range)?.id ?? sorted[0].id;
  return sorted[0].id;
};

/**
 * The commands a clicked hull offers in its ship menu: everything your command
 * ship can actually do to it right now — the right kind of target, working
 * hardware, and inside the reach of the system involved. A command that could
 * not land never appears as a button, so the menu reads as a list of what the
 * situation allows rather than a list of refusals.
 */
export const shipCommands = (game, targetId) => {
  const actor = getShip(game, game.playerShipId);
  const target = getShip(game, targetId);
  if (!isActive(actor) || !target || target.status === 'destroyed' || target.id === actor.id) return [];
  const reach = distance(actor, target);
  const hostile = target.faction !== actor.faction;
  // An ion storm's core kills the guns for the stardate (15d), so a jammed command
  // ship is never offered a volley it cannot fire — the menu only offers commands
  // that can land.
  const jammed = ionStormZone(game, actor) === 'core';
  const commands = [];
  const offer = (type, label, available, range) => {
    if (available && reach <= range) commands.push({ type, label });
  };
  if (hostile && isActive(target)) {
    offer('phasers', 'Fire phasers', !jammed && systemUnits(actor, 'phasers') > 0, RANGES.phasers);
    offer('photons', 'Fire photons', !jammed && systemUnits(actor, 'photons') > 0, RANGES.photons);
    // Spread torpedoes (round 22c): only a hull with the tubes is offered the salvo.
    offer('spread', 'Fire spread', !jammed && systemUnits(actor, 'spread') > 0, RANGES.spread);
    // Ion/EMP (round 22a): only a hull that carries the emitter is offered it, so
    // this is Reimagined-gated by construction (no classic hull has ion units).
    offer('ion', 'Fire ion', !jammed && systemUnits(actor, 'ion') > 0, RANGES.ion);
    offer('tractor', 'Tractor beam', systemUnits(actor, 'tractor') > 0 && !isImmovable(target), RANGES.tractor);
    // A directed tow is a Reimagined option: aim the pull at a point or a hull to
    // slam the target into, rather than reeling it straight toward you.
    if (game.reimagined) {
      offer('tractor-direct', 'Direct tow…', systemUnits(actor, 'tractor') > 0 && !isImmovable(target), RANGES.tractor);
    }
  }
  offer('scan', 'Scan', systemUnits(actor, 'scanner') > 0, sensorRange(game, actor, 'scanner'));
  // A drone has no crew berths and never will (round 20), so the transfer that
  // could not land is never offered.
  if (!hostile && isActive(target) && !isDrone(target)) {
    offer('transport', 'Transport crew', systemUnits(actor, 'transporter') > 0, sensorRange(game, actor, 'transporter'));
  }
  if (target.status === 'vacant') {
    offer('transport', 'Board ship', systemUnits(actor, 'transporter') > 0, sensorRange(game, actor, 'transporter'));
  }
  return commands;
};

const computerReport = (game, actor) => {
  // A standard command must not out-see the mapper. The hidden reports are the ones
  // the manual says give information your enemies do not have; this one is not.
  // The mapper does not out-see the nebula rule either (15b): a hull hidden in one
  // is absent from the counts and the nearest-contact lines, exactly as on the map.
  const mapperRange = sensorRange(game, actor, 'mapper');
  const mapped = game.ships.filter((ship) => isActive(ship)
    && (ship.id === actor.id || (distance(actor, ship) <= mapperRange && !nebulaHides(game, actor, ship))));
  const allies = mapped.filter((ship) => ship.id !== actor.id && ship.faction === actor.faction);
  const enemies = mapped.filter((ship) => ship.faction !== actor.faction);
  const nearest = (ships) => ships
    .map((ship) => ({ ship, range: distance(actor, ship) }))
    .sort((a, b) => a.range - b.range)[0];
  const nearestEnemy = nearest(enemies);
  const nearestAlly = nearest(allies);
  const counts = Object.entries(mapped.reduce((totals, ship) => {
    totals[ship.faction] = (totals[ship.faction] ?? 0) + 1;
    return totals;
  }, {})).map(([faction, count]) => `${faction}: ${unitName(count, 'ship')} on the mapper`);
  const xanadu = getShip(game, 'xanadu');
  return {
    title: 'Ship computer',
    lines: [
      ...(counts.length ? counts : ['Nothing on the mapper.']),
      nearestEnemy ? `Nearest enemy: ${nearestEnemy.ship.name} at ${nearestEnemy.range.toFixed(1)}` : 'Nearest enemy: none within mapper range',
      nearestAlly ? `Nearest ally: ${nearestAlly.ship.name} at ${nearestAlly.range.toFixed(1)}` : 'Nearest ally: none within mapper range',
      // Your own base's bearing is not sensor-limited; the original's computer
      // reports the distance to Xanadu unconditionally.
      xanadu ? `Distance to Xanadu: ${distance(actor, xanadu).toFixed(1)}` : 'Distance to Xanadu: unknown',
    ],
  };
};

const scanReport = (game, target) => ({
  title: `Scan: ${target.name}`,
  lines: [
    `Class: ${target.className}`,
    `Affiliation: ${target.faction}`,
    // Scanning is how you learn who is aboard — in an extended war that is the only
    // way to work out which hull has sworn to hunt Captain Jason. A drone has
    // nobody aboard (round 20), and must never read as "Captain undefined".
    ...(game.extended
      ? (isDrone(target)
        ? ['Command: none — an unmanned fighter drone.']
        : [`Captain: ${target.captain}${isAce(target) ? ` — an ace, ${target.kills} kills` : ''}`])
      : []),
    `Status: ${target.status}`,
    `Shields: ${target.shields}`,
    `Crew: ${target.crew}`,
    ...Object.entries(target.systems).map(([name, units]) => `${name}: ${units}`),
  ],
});

const mapReport = (game, actor) => {
  const range = sensorRange(game, actor, 'mapper');
  const visible = getLivingShips(game)
    .filter((ship) => distance(actor, ship) <= range && !nebulaHides(game, actor, ship))
    .sort((left, right) => distance(actor, left) - distance(actor, right));
  return {
    title: 'Local tactical map',
    lines: visible.map((ship) => `${ship.name} (${ship.faction}) — ${ship.x},${ship.y} at ${distance(actor, ship).toFixed(1)}`),
  };
};

/**
 * The manual has the radio report "the location and condition of allied ships",
 * so each contact answers with its alert level as well as its range.
 */
const radioReport = (game, actor) => {
  // Radio degrades with the terrain between the hulls (15b + 15d): a contact in a
  // nebula only answers within the reveal range, one in a storm's core never
  // answers, and one in the ring hears at half reach. `radioReaches` is the same
  // test order delivery uses, so the traffic list and the orders never disagree.
  const contacts = getLivingShips(game)
    .filter((ship) => ship.id !== actor.id && ship.faction === actor.faction
      && radioReaches(game, actor, ship));
  return {
    title: 'Radio traffic',
    lines: contacts.length
      ? contacts.map((ship) => `${ship.name}: condition ${alertLevel(ship)} at ${distance(actor, ship).toFixed(1)}; shields ${ship.shields}, crew ${ship.crew}, ${ship.status}.`)
      : ['No allied stations answer within radio range.'],
  };
};

/**
 * Reads the precision-fire dials off a weapon action. Only a precision war gives
 * the player them, and only phasers can be throttled or called — photons scatter
 * by nature — so anything else falls back to a standard volley at full power,
 * exactly what a classic war has always fired.
 */
const precisionSettings = (game, action, type, target) => {
  if (!game.precision || type !== 'phasers') return { power: 100, focus: null };
  const power = Number.isFinite(action.power) ? Math.max(0, Math.min(100, action.power)) : 100;
  const focus = action.focus && Object.keys(target.systems).includes(action.focus) ? action.focus : null;
  return { power, focus };
};

const weaponAction = (game, action, actor, type) => {
  const disabled = requiresSystem(game, actor, type);
  if (disabled) return disabled;
  // Ion-storm jam (15d): inside the storm's core the guns are dead for the
  // stardate — the command refuses without spending the turn.
  if (ionStormZone(game, actor) === 'core') return invalid(game, `${actor.name}'s weapons are offline in the ion storm.`);
  const found = hostileTarget(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  const range = RANGES[type];
  const targetDistance = distance(actor, found.target);
  if (targetDistance > range) return invalid(game, `${found.target.name} is out of range for ${type}.`);
  const { power, focus } = precisionSettings(game, action, type, found.target);
  const details = {
    ...(focus ? { focus } : {}),
    ...(power !== 100 ? { power } : {}),
  };
  const rng = seededRng(game);
  // Terrain accuracy (15c + 15d), one seeded roll against the shared threshold:
  // a volley whose shot line crosses an asteroid field can splash on a rock, and a
  // shooter fighting from an ion storm's ring works its guns through static.
  // Symmetric with the autopilots' volleys; terrain is [] outside a Reimagined
  // war, so the calibrated 12% miss stands untouched there.
  const covered = segmentCrossesFeature(game, actor, found.target, 'asteroids');
  const shooterMissed = rng.next() < volleyMissChance(game, actor, found.target);
  if (shooterMissed) {
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
    const updated = completeTurn(advanceRandom(replaceShip(game, shooter)));
    return result(updated, `${actor.name} fires ${type} at ${found.target.name}. Missed!${covered ? ' The volley splashes into asteroids.' : ''}`, { events: [fireEvent(type, actor, found.target, false, details)] });
  }
  const grudge = vendettaGrudge(game, actor, found.target);
  const roll = weaponDamage(type, actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
  const damage = focus
    ? Math.round(roll * (power / 100) * SURGICAL_DAMAGE_FACTOR)
    : Math.round(roll * (power / 100));
  const calledUnits = focus ? found.target.systems[focus] : 0;
  const before = found.target.status;
  const hit = damageShip(found.target, damage, rng, focus ? { focus } : {});
  const kill = before === 'active' && hit.status !== 'active' ? 1 : 0;
  const shooter = { ...actor, shotsFired: actor.shotsFired + 1, kills: actor.kills + kill };
  const victim = { ...hit, shotsTaken: hit.shotsTaken + 1 };
  const updated = completeTurn(advanceRandom({
    ...game,
    ships: game.ships.map((ship) => {
      if (ship.id === shooter.id) return shooter;
      if (ship.id === victim.id) return victim;
      return ship;
    }),
  }));
  const events = [fireEvent(type, actor, found.target, true, details)];
  // A hull whose crew is killed but whose frame survives goes dark as a vacant
  // prize, not wreckage: only outright destruction draws the blast and the marker.
  if (hit.status === 'destroyed') {
    events.push({ kind: 'explosion', fromId: actor.id, toId: victim.id, x1: victim.x, y1: victim.y, x2: victim.x, y2: victim.y, hit: true });
    events.push(terminalEvent('destruction', type, victim, { attacker: actor }));
  }
  const powerNote = power !== 100 ? ` at ${power}% power` : '';
  return result(updated, [
    focus
      ? `${actor.name} fires a focused phaser beam${powerNote} at ${found.target.name}'s ${focus} for ${damage} damage.`
      : `${actor.name} fires ${type} at ${found.target.name}${powerNote} for ${damage} damage.`,
    ...(focus && calledUnits > 0 && hit.systems[focus] === 0
      ? [`${found.target.name}'s ${focus} are disabled.`]
      : []),
    ...(focus && calledUnits === 0 ? [`${found.target.name} has no ${focus} left to burn.`] : []),
    ...(kill ? killLines(game, actor, victim) : []),
  ], { events });
};

/**
 * Fires the ion/EMP emitter (round 22a, Reimagined): a suppression volley that
 * rides the shared accuracy roll and the weapons power sink like the lethal guns,
 * but disables rather than destroys — shields absorb it and the overflow strips
 * subsystems with no crew casualties, so it never scores a kill or a wreck. The
 * player's command; the autopilots' mirror lives in turns.js.
 */
const ionAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'ion');
  if (disabled) return disabled;
  // The ion storm's core jams every emitter, this one included (15d).
  if (ionStormZone(game, actor) === 'core') return invalid(game, `${actor.name}'s ion emitter is offline in the ion storm.`);
  const found = hostileTarget(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > RANGES.ion) return invalid(game, `${found.target.name} is out of range for the ion emitter.`);
  const rng = seededRng(game);
  if (rng.next() < volleyMissChance(game, actor, found.target)) {
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
    return result(completeTurn(advanceRandom(replaceShip(game, shooter))),
      `${actor.name} fires an ion burst at ${found.target.name}. Missed!`,
      { events: [fireEvent('ion', actor, found.target, false)] });
  }
  const grudge = vendettaGrudge(game, actor, found.target);
  const amount = weaponDamage('ion', actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
  const before = found.target;
  const hit = ionDamage(before, amount, rng);
  const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
  const victim = { ...hit, shotsTaken: hit.shotsTaken + 1 };
  const updated = completeTurn(advanceRandom({
    ...game,
    ships: game.ships.map((ship) => (ship.id === shooter.id ? shooter : ship.id === victim.id ? victim : ship)),
  }));
  const stripped = Object.values(before.systems).reduce((total, units) => total + units, 0)
    - Object.values(hit.systems).reduce((total, units) => total + units, 0);
  const burned = Object.keys(hit.systems).filter((name) => before.systems[name] > 0 && hit.systems[name] === 0);
  return result(updated, [
    stripped > 0
      ? `${actor.name}'s ion burst tears through ${found.target.name}'s shields, burning out ${unitName(stripped, 'subsystem unit')}.`
      : `${actor.name} fires an ion burst at ${found.target.name}; its shields absorb the charge.`,
    ...(burned.length ? [`${found.target.name}'s ${burned.join(', ')} ${burned.length === 1 ? 'is' : 'are'} disabled.`] : []),
  ], { events: [fireEvent('ion', actor, found.target, true)] });
};

/**
 * Applies one spread-torpedo hit (round 22c): the full rolled damage at the impact
 * point (the target's position) falls off linearly to zero at `SPREAD.splashRadius`,
 * hitting EVERY active hull inside — the primary hardest, and any friendly wingman
 * caught in the blast too (the shooter spares its own hull). Lethal: each hit runs
 * the normal `damageShip` lottery, so a hull in the splash can be gutted, left
 * vacant, or destroyed, and the shooter is credited with every enemy hull the salvo
 * finishes. Shared by the player's command and the autopilots' so both splashes are
 * identical. Returns the raw game (no turn completion); the caller wraps it.
 */
export const spreadSplash = (game, actor, target, full, rng) => {
  const impact = { x: target.x, y: target.y };
  const radius = SPREAD.splashRadius;
  const messages = [];
  const events = [];
  let kills = 0;
  const splashed = game.ships.map((ship) => {
    if (!isActive(ship) || ship.id === actor.id) return ship; // the shooter spares itself
    const dist = distance(impact, ship);
    if (dist > radius) return ship;
    const factor = Math.max(0, 1 - dist / radius);
    const amount = Math.max(1, Math.round(full * factor));
    const before = ship.status;
    const hit = damageShip(ship, amount, rng);
    if (before === 'active' && hit.status !== 'active') {
      if (ship.faction !== actor.faction) kills += 1;
      events.push({ kind: 'explosion', fromId: actor.id, toId: ship.id, x1: ship.x, y1: ship.y, x2: ship.x, y2: ship.y, hit: true });
      events.push(terminalEvent('destruction', 'spread', hit, { attacker: actor }));
    }
    messages.push(ship.id === target.id
      ? `${ship.name} takes the full spread for ${amount} damage.`
      : `${ship.name} is caught in the spread for ${amount} damage.`);
    return { ...hit, shotsTaken: hit.shotsTaken + 1 };
  });
  const ships = splashed.map((ship) => (ship.id === actor.id
    ? { ...ship, shotsFired: ship.shotsFired + 1, kills: ship.kills + kills }
    : ship));
  return { game: { ...game, ships }, messages, events, kills };
};

const spreadAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'spread');
  if (disabled) return disabled;
  // The ion storm's core jams the tubes like any gun (15d).
  if (ionStormZone(game, actor) === 'core') return invalid(game, `${actor.name}'s torpedo tubes are offline in the ion storm.`);
  const found = hostileTarget(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > RANGES.spread) return invalid(game, `${found.target.name} is out of range for the spread torpedoes.`);
  const rng = seededRng(game);
  if (rng.next() < volleyMissChance(game, actor, found.target)) {
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
    return result(completeTurn(advanceRandom(replaceShip(game, shooter))),
      `${actor.name} fires a spread of torpedoes at ${found.target.name}. Missed — the salvo splashes nothing.`,
      { events: [fireEvent('spread', actor, found.target, false)] });
  }
  const grudge = vendettaGrudge(game, actor, found.target);
  const full = weaponDamage('spread', actor, rng, grudge, powerEffect(game, actor, 'weapons'), game.reimagined ? REIMAGINED_WEAPON_DAMAGE_SCALE : 1);
  const splash = spreadSplash(game, actor, found.target, full, rng);
  return result(completeTurn(advanceRandom(splash.game)), [
    `${actor.name} fires a spread of torpedoes at ${found.target.name}.`,
    ...splash.messages,
  ], { events: [fireEvent('spread', actor, found.target, true), ...splash.events] });
};

/** Counts a collision on both hulls; the battle report names the clumsiest captain. */
const collided = (ship) => ({ ...ship, collisions: (ship.collisions ?? 0) + 1 });

/**
 * Cripples a collision survivor: shields burned off and about half its crew and
 * subsystems gone. The share is taken of what the ship actually has left, so it
 * cannot reduce a hull to nothing — the survivor always lives, as the manual says.
 */
const cripple = (ship, rng) => {
  const internals = ship.crew + Object.values(ship.systems).reduce((total, units) => total + units, 0);
  return damageShip(ship, ship.shields + Math.ceil(internals * CRIPPLE.fraction), rng);
};

const oneCollision = (game, first, second) => {
  const rng = seededRng(game);
  const destroyedId = rng.pick([first.id, second.id]);
  const destroyed = collided(destroyedShip(getShip(game, destroyedId)));
  const survivor = collided(cripple(getShip(game, destroyedId === first.id ? second.id : first.id), rng));
  const updated = advanceRandom({
    ...game,
    ships: game.ships.map((ship) => ship.id === destroyed.id ? destroyed : ship.id === survivor.id ? survivor : ship),
  });
  const events = [
    { kind: 'explosion', fromId: survivor.id, toId: destroyed.id, x1: destroyed.x, y1: destroyed.y, x2: destroyed.x, y2: destroyed.y, hit: true },
    terminalEvent('destruction', 'collision', destroyed, { attacker: survivor }),
  ];
  return {
    game: updated,
    messages: [`Collision: ${destroyed.name} is destroyed; ${survivor.name} is crippled.`],
    events,
  };
};

/**
 * Every collision at the actor's position, resolved one pair at a time. Only the
 * first overlapping pair used to be handled, so a ship that arrived on top of two
 * others passed through the second; and a hull destroyed in the first impact
 * cannot collide again.
 */
export const resolveCollision = (game, actor) => {
  const messages = [];
  const events = [];
  let next = game;
  let current = actor;
  for (const other of game.ships) {
    if (other.id === current.id || !isActive(current)) continue;
    const victim = getShip(next, other.id);
    if (!isActive(victim) || distance(current, victim) >= 1) continue;
    const resolved = oneCollision(next, current, victim);
    next = resolved.game;
    messages.push(...resolved.messages);
    events.push(...resolved.events);
    current = getShip(next, current.id);
  }
  return { game: next, messages, events };
};

/**
 * Rock strikes (15c): a hull that ENDS a move or a tractor tow inside an asteroid
 * field rolls a seeded strike for `asteroidStrike.min`–`max` shield damage. Passing
 * through at speed is safe — parking, or being tractor-dumped inside, is not, which
 * is what makes towing an enemy into a field lethal and gives the engines sink a
 * defensive use (outrun the field). The strike burns shields only; the frame itself
 * absorbs rocks once a hull is already dark, and collisions remain the killing blow
 * a tow into the field sets up. Narrated and drawn as an impact burst. Terrain is
 * [] outside a Reimagined war, so this never fires there and no roll is consumed —
 * a classic or extended war keeps its exact seeded sequence (parity).
 */
export const resolveAsteroidStrike = (game, ship) => {
  const current = getShip(game, ship?.id);
  if (!isActive(current) || !insideFeature(game, current, 'asteroids')) return { game, messages: [], events: [] };
  const rng = seededRng(game);
  const rolled = advanceRandom(game);
  if (rng.next() >= TERRAIN.asteroidStrike.chance) return { game: rolled, messages: [], events: [] };
  const amount = rng.integer(TERRAIN.asteroidStrike.min, TERRAIN.asteroidStrike.max);
  const struck = Math.min(current.shields, amount);
  if (struck <= 0) return { game: rolled, messages: [], events: [] };
  const updated = replaceShip(rolled, { ...current, shields: current.shields - struck });
  return {
    game: updated,
    messages: [`Asteroid strike: rocks rake ${current.name} for ${struck} shield damage.`],
    events: [{ kind: 'explosion', fromId: current.id, toId: current.id, x1: current.x, y1: current.y, x2: current.x, y2: current.y, hit: true }],
  };
};

const moveAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  if (isTractorHeld(game, actor)) return invalid(game, `${actor.name} cannot move while held by a tractor lock.`);
  const dx = Number(action.dx);
  const dy = Number(action.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return invalid(game, 'Movement requires numeric displacement coordinates.');
  const displacement = Math.hypot(dx, dy);
  const capacity = engineCapacity(actor, game.gridSize ?? GRID_SIZE, powerEffect(game, actor, 'engines'));
  if (displacement > capacity) return invalid(game, `Movement exceeds engine capacity of ${capacity}.`);
  const grid = game.gridSize ?? GRID_SIZE;
  const x = actor.x + dx;
  const y = actor.y + dy;
  if (x < 0 || x > grid || y < 0 || y > grid) return invalid(game, 'Movement would leave the tactical map.');
  // Round 23: the move implies the heading — a Reimagined hull ends the burn
  // facing the direction it traveled (inert elsewhere, so parity holds).
  const movedActor = applyHeading(game, actor, x, y);
  const collision = resolveCollision(replaceShip(game, movedActor), movedActor);
  // Ending the move inside an asteroid field risks a rock strike (15c).
  const strike = resolveAsteroidStrike(collision.game, movedActor);
  return result(completeTurn(strike.game), [`${actor.name} moves to ${x},${y}.`, ...collision.messages, ...strike.messages], { events: [...collision.events, ...strike.events] });
};

const pullToward = (actor, target, pull, gridSize) => {
  const dx = actor.x - target.x;
  const dy = actor.y - target.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { x: target.x, y: target.y };
  const step = Math.min(pull, dist);
  return {
    x: Math.max(0, Math.min(gridSize, Math.round(target.x + (dx / dist) * step))),
    y: Math.max(0, Math.min(gridSize, Math.round(target.y + (dy / dist) * step))),
  };
};

/**
 * One tractor lock: how hard the beam pulls and where it lands the target.
 * Shared by the player's command and the autopilots' so both beams behave alike.
 */
export const tractorLock = (actor, target, gridSize = GRID_SIZE, destination = null, tractorEff = 1) => {
  const pull = systemUnits(actor, 'tractor') * TRACTOR_PULL_PER_UNIT * tractorEff;
  // A directed tow aims the pull at `destination`; otherwise the target is reeled
  // straight toward the caster. The pull budget is the same either way.
  return { pull, position: pullToward(destination ?? actor, target, pull, gridSize) };
};

/**
 * Where a directed tractor tow is aimed: a hull to slam into (`towardId`), or a
 * coordinate (`towardX`/`towardY`), clamped to the field. Null when the action names
 * neither, so the beam falls back to the classic pull toward the caster.
 */
const towDestination = (game, action, grid) => {
  if (action.towardId) {
    const hull = getShip(game, action.towardId);
    if (hull && hull.status !== 'destroyed') return { x: hull.x, y: hull.y };
  }
  if (action.towardX !== undefined && action.towardY !== undefined) {
    const x = Number(action.towardX);
    const y = Number(action.towardY);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x: Math.max(0, Math.min(grid, Math.round(x))), y: Math.max(0, Math.min(grid, Math.round(y))) };
    }
  }
  return null;
};

const tractorAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'tractor');
  if (disabled) return disabled;
  if (!action.targetId) {
    const released = game.ships.map((ship) => ship.tractorBy === actor.id ? { ...ship, tractorBy: null } : ship);
    return result(completeTurn({ ...game, ships: released }), `${actor.name} releases its tractor lock.`);
  }
  const found = hostileTarget(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > RANGES.tractor) return invalid(game, `${found.target.name} is out of tractor range.`);
  if (isImmovable(found.target)) return invalid(game, `${found.target.name} is far too massive for the tractor beam to move.`);
  const grid = game.gridSize ?? GRID_SIZE;
  // A directed tow is Reimagined-only; a classic or extended war ignores the fields
  // and pulls toward the caster exactly as calibrated.
  const destination = game.reimagined ? towDestination(game, action, grid) : null;
  const { pull, position } = tractorLock(actor, found.target, grid, destination, powerEffect(game, actor, 'tractor'));
  // Round 23: a towed hull heads the way it was dragged (Reimagined only).
  const pulled = { ...applyHeading(game, found.target, position.x, position.y), tractorBy: actor.id };
  // A beam can drag a hull straight into another one, and that is a collision like
  // any other — which makes towing an enemy into a friend a real tactic.
  const collision = resolveCollision(completeTurn(replaceShip(game, pulled)), pulled);
  // A tow that ends inside an asteroid field exposes the victim to a rock strike
  // (15c) — towing an enemy into the rocks is a deliberate weapon.
  const strike = resolveAsteroidStrike(collision.game, pulled);
  return result(strike.game, [
    `${actor.name} locks a tractor beam on ${found.target.name}.`,
    destination
      ? `Tractor beam good for ${pull} units pull. ${actor.name} hauls ${found.target.name} toward ${destination.x}, ${destination.y} — now at ${position.x}, ${position.y}.`
      : `Tractor beam good for ${pull} units pull. ${actor.name} has beamed ${found.target.name} to ${position.x}, ${position.y}.`,
    ...collision.messages,
    ...strike.messages,
  ], { events: [...collision.events, ...strike.events] });
};

/**
 * One capture, whichever path produced it (round 17): the boarding party beams
 * over and the hull comes alive under the boarder's colors. Shared by the
 * player's transporter, a `board` standing order, and an AI captain's
 * opportunistic boarding, so every prize is identical and the vendetta ends on
 * any allegiance flip, exactly as player boarding has always done.
 *
 * In a Reimagined war a flip also stamps the **prize record** — origin, boarder,
 * stardate, and the captain the hull serves no more (kept so the hunt scenario
 * can still name who hunted you) — deals it a new prize captain off the
 * `${seed}:prizes` sub-stream advanced by `game.prizeDraws` (deterministic, and
 * no existing stream shifts), and auto-issues `withdraw` straight onto its
 * orders, so the prize limps rearward until ordered up. Re-manning a friendly
 * derelict (no flip) restores it to service but is not a capture and stamps
 * nothing. Consumes no RNG draws.
 */
export const captureHull = (game, boarder, target, party) => {
  const placed = Math.min(party, boarder.crew - 1, crewCapacity(target));
  const flip = target.faction !== boarder.faction;
  let captured = { ...target, faction: boarder.faction, status: 'active', crew: placed, tractorBy: null };
  let next = {
    ...game,
    // Boarding the vendetta ship ends the vendetta; otherwise that hull would
    // keep hunting Captain Jason in its new colors' hands.
    vendettaShipId: flip && game.vendettaShipId === captured.id ? null : game.vendettaShipId,
  };
  const messages = [];
  if (game.reimagined && flip) {
    const draw = game.prizeDraws ?? 0;
    const captain = createRng(`${game.seed}:prizes:${draw}`).pick(CAPTAIN_NAMES);
    const times = (target.prize?.times ?? 0) + 1;
    captured = {
      ...captured,
      captain,
      prize: { from: target.faction, by: boarder.id, byFaction: boarder.faction, turn: game.turn, captain: target.captain, times },
    };
    next = {
      ...next,
      prizeDraws: draw + 1,
      // The cumulative ledger the battle report reads: the per-ship record only
      // remembers the last capture, so "taken, ever" lives here.
      prizesTaken: { ...(next.prizesTaken ?? {}), [boarder.faction]: (next.prizesTaken?.[boarder.faction] ?? 0) + 1 },
      // Direct onto `orders`, not pending: the capturing hull is standing next to
      // its prize, so radio contact is a given.
      orders: { ...(next.orders ?? {}), [captured.id]: { type: 'withdraw', targetId: null } },
    };
    const base = getShip(game, 'xanadu');
    const dest = base && isActive(base) && base.faction === boarder.faction ? `toward ${base.name}` : 'toward the fleet';
    messages.push(
      `${captured.name} is taken as a prize of the ${boarder.faction} — Captain ${captain} commands her now, and she withdraws ${dest}.`,
      ...(times > 1 ? [`${captured.name} has changed hands ${times} times.`] : []),
    );
    // The bay comes with the hull (round 20): a captured carrier keeps whatever
    // drone complement it launched, and the drones fly for whoever flies her.
    // The prize layer itself never sees a drone — an uncrewed hull is never
    // `vacant`, so it is structurally unprizeable.
    const wing = dronesOf(game, captured.id);
    if (wing.length > 0) messages.push(`The drones of ${captured.name} come over with the prize.`);
  } else if (game.reimagined) {
    messages.push(`A party from ${boarder.name} brings ${captured.name} back into the fight.`);
  }
  const source = { ...boarder, crew: boarder.crew - placed };
  next = {
    ...next,
    ships: next.ships.map((ship) => {
      if (ship.id === captured.id) return captured;
      if (ship.id === source.id) return source;
      // The launched complement follows its carrier's colors (round 20).
      if (flip && isDrone(ship) && ship.droneOf === captured.id && isActive(ship)) return { ...ship, faction: captured.faction };
      return ship;
    }),
  };
  return { game: next, captured, source, placed, messages };
};

/**
 * Whether a hull can open its bay (round 20): a Reimagined war, an active
 * carrier, and its one complement still aboard. Shared by the player's command,
 * the ship menu, the `launch` order's validation, and the AI branch, so every
 * path reads the same rule.
 */
export const canLaunchDrones = (game, ship) => game.reimagined && isActive(ship)
  && ship.className === 'Carrier' && !hasLaunchedDrones(game, ship);

/**
 * Opens the bay: the carrier's one complement of `DRONE.baySize` fighter drones
 * takes the field at deterministic posts around it, and the bay is marked empty
 * for the rest of the war. Rides the ships array, so every reader — targeting,
 * combat, terrain, fog, reports, the minimap, warSignature — sees the drones
 * like any hull. Consumes NO RNG draws (the board pattern): posts are tried in
 * `DRONE.spawnOffsets` order and skipped only when an active hull already sits
 * there, so the same war state always launches the same complement to the same
 * coordinates and no seeded stream shifts. Returns the raw game (no turn
 * completion) for the AI branch; the player's command wraps it.
 */
export const launchDrones = (game, carrier) => {
  const grid = game.gridSize ?? GRID_SIZE;
  const clamp = (value) => Math.max(0, Math.min(grid, value));
  const taken = (list, x, y) => list.some((hull) => isActive(hull) && Math.hypot(hull.x - x, hull.y - y) < 1);
  const posts = DRONE.spawnOffsets.map(([ox, oy]) => ({ x: clamp(carrier.x + ox), y: clamp(carrier.y + oy) }));
  const open = posts.filter((post) => !taken(game.ships, post.x, post.y));
  // Every post blocked is a field edge case, not a launch failure: the bay flies
  // anyway, at its deterministic posts, and any overlap resolves like the
  // collision it is the moment anything moves.
  const chosen = [...open, ...posts.filter((post) => !open.includes(post))].slice(0, DRONE.baySize);
  const drones = chosen.map((post, index) => spawnDrone(carrier, index + 1, post.x, post.y));
  const flown = { ...carrier, dronesLaunched: true };
  return {
    game: { ...game, ships: [...game.ships.map((ship) => (ship.id === flown.id ? flown : ship)), ...drones] },
    drones,
    messages: [`${carrier.name} opens its bay and launches ${unitName(drones.length, 'fighter drone')}: ${drones.map((drone) => drone.name).join(', ')}.`],
  };
};

const launchAction = (game, actor) => {
  if (!game.reimagined) return invalid(game, 'Fighter drones fly only in a Reimagined war.');
  if (actor.className !== 'Carrier') return invalid(game, `${actor.name} carries no drone bay.`);
  if (hasLaunchedDrones(game, actor)) return invalid(game, `${actor.name}'s bay is empty — its drones are already away.`);
  const out = launchDrones(game, actor);
  return result(completeTurn(out.game), out.messages);
};

const transportAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'transporter');
  if (disabled) return disabled;
  const found = targetFor(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > sensorRange(game, actor, 'transporter')) return invalid(game, `${found.target.name} is out of transporter range.`);
  if (isActive(found.target) && found.target.faction !== actor.faction) return invalid(game, 'Cannot transport onto a live enemy ship.');
  const amount = Number(action.amount ?? DEFAULT_CREW_TRANSFER);
  if (!Number.isInteger(amount) || amount < 1) return invalid(game, 'Transport crew amount must be a positive whole number.');
  if (actor.crew <= amount) return invalid(game, 'Insufficient crew to complete that transport.');
  if (isActive(found.target)) {
    const added = Math.min(amount, Math.max(0, crewCapacity(found.target) - found.target.crew));
    if (added === 0) return invalid(game, `${found.target.name} has no space for additional crew.`);
    const source = { ...actor, crew: actor.crew - added };
    const target = { ...found.target, crew: found.target.crew + added };
    const updated = completeTurn({ ...game, ships: game.ships.map((ship) => ship.id === source.id ? source : ship.id === target.id ? target : ship) });
    return result(updated, `${added} crew beam from ${actor.name} to ${target.name}.`);
  }
  if (found.target.status !== 'vacant') return invalid(game, 'Only a vacant ship can be occupied.');
  const capture = captureHull(game, actor, found.target, amount);
  const base = {
    ...capture.game,
    playerShipId: action.transferCommand ? capture.captured.id : game.playerShipId,
  };
  return result(completeTurn(base), [
    `${capture.captured.name} is occupied by ${capture.placed} crew${action.transferCommand ? '; command transferred.' : '.'}`,
    ...capture.messages,
  ]);
};

const destroyedShip = (ship) => ({ ...ship, status: 'destroyed', crew: 0, shields: 0, tractorBy: null });

/**
 * The blast itself, without ending a turn: everything inside the radius dies and a
 * wider ring takes shrapnel. Shared by the player's `=` and by an Axis captain who
 * would rather take the enemy fleet with them.
 */
export const detonate = (game, actor) => {
  const rng = seededRng(game);
  const blast = blastRadius(actor, game);
  const shrapnel = blast + SHRAPNEL_EXTRA_RANGE;
  const messages = [`${actor.name} is self-destructing.  Blast range ${blast}.`];
  const events = [];
  // The detonator's captain is credited with every enemy hull the blast finishes off,
  // exactly as a weapon kill is; friendlies caught in the same blast are not.
  let kills = 0;
  const victims = game.ships.map((ship) => {
    if (ship.id === actor.id) {
      events.push(terminalEvent('destruction', 'self-destruct', ship));
      return destroyedShip(ship);
    }
    if (!isActive(ship)) return ship;
    const range = distance(actor, ship);
    if (range <= blast) {
      messages.push(`${ship.name} falls within blast range.`);
      events.push(terminalEvent('destruction', 'self-destruct', ship, { attacker: actor }));
      if (ship.faction !== actor.faction) kills += 1;
      return destroyedShip(ship);
    }
    if (range <= shrapnel) {
      const damage = SHRAPNEL_DAMAGE.base + rng.integer(SHRAPNEL_DAMAGE.min, SHRAPNEL_DAMAGE.max);
      messages.push(`${ship.name} has been hit by shrapnel.  Damage to shields: ${damage} units.`);
      const damaged = damageShip(ship, damage, rng);
      if (damaged.status === 'destroyed') {
        events.push(terminalEvent('destruction', 'self-destruct', damaged, { attacker: actor }));
        if (ship.faction !== actor.faction) kills += 1;
      }
      return damaged;
    }
    return ship;
  });
  // Fold the tally into the detonator's own record: it is destroyed, but its kills
  // still count toward aces, the top gun, and the alliance statistics.
  const ships = victims.map((ship) => ship.id === actor.id
    ? { ...ship, kills: (ship.kills ?? 0) + kills }
    : ship);
  return { game: advanceRandom({ ...game, ships }), messages, events };
};

const selfDestructAction = (game, actor) => {
  const blast = detonate(game, actor);
  return result(completeTurn(blast.game), blast.messages, { events: blast.events });
};

const hyperspaceAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  const rng = seededRng(game);
  if (rng.next() < HYPERSPACE_BURN_CHANCE) {
    return result(
      completeTurn(advanceRandom(replaceShip(game, destroyedShip(actor)))),
      `${actor.name} has burnt up trying to hyperspace.`,
      { events: [terminalEvent('destruction', 'hyperspace', actor)] },
    );
  }
  const grid = game.gridSize ?? GRID_SIZE;
  const x = action.x === undefined ? rng.integer(1, grid - 1) : Number(action.x);
  const y = action.y === undefined ? rng.integer(1, grid - 1) : Number(action.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > grid || y < 0 || y > grid) {
    return invalid(game, 'Hyperspace destination must be valid map coordinates.');
  }
  const shieldDamage = Math.max(HYPERSPACE_MIN_SHIELD_LOSS, Math.ceil(shieldCapacity(actor) * HYPERSPACE_SHIELD_LOSS));
  // Round 23: a jump has no meaningful heading — the hull keeps its prior facing.
  const relocated = { ...actor, x, y, shields: Math.max(0, actor.shields - shieldDamage), tractorBy: null };
  // Materializing inside another hull is a collision like any other, which makes a
  // jump onto an enemy a suicide ram.
  const collision = resolveCollision(completeTurn(advanceRandom(replaceShip(game, relocated))), relocated);
  return result(
    collision.game,
    [`${actor.name} enters hyperspace and emerges at ${x},${y}; shields lose ${shieldDamage}.`, ...collision.messages],
    { events: collision.events },
  );
};

/**
 * Engine power flushed into shields. Shared by the player's `1` and the
 * autopilots', so an enemy captain reinforces its shields exactly as you do. Null
 * when there are no engines to flush or the shields are already full.
 */
export const flushShields = (actor) => {
  if (systemUnits(actor, 'engines') <= 0) return null;
  const shields = Math.min(shieldCapacity(actor), actor.shields + systemUnits(actor, 'engines') * SHIELD_PER_ENGINE);
  if (shields === actor.shields) return null;
  return { ship: { ...actor, shields }, gained: shields - actor.shields };
};

/**
 * Issues a standing fleet order. Orders cost no turn — but they travel by radio,
 * so a ship out of contact (and out of Xanadu's relay) does not act on one until
 * the next stardate.
 */
const setOrder = (game, action, actor) => {
  if (!game.extended) return invalid(game, 'Fleet orders are only issued in an extended war.');
  const ship = getShip(game, action.shipId);
  if (!ship) return invalid(game, 'No such ship.');
  if (ship.faction !== actor.faction) return invalid(game, 'Only Federation ships take your orders.');
  if (!isActive(ship)) return invalid(game, `${ship.name} cannot take orders.`);
  const type = action.order?.type;
  if (!ORDER_TYPES.includes(type)) return invalid(game, `Unknown order: ${type}.`);

  const order = { type, targetId: null };
  if (type === 'board') {
    // The one targeted order whose subject is a derelict rather than an active
    // ship — and a Reimagined-war order only, so a classic or extended war never
    // musters a boarding party (round 17).
    if (!game.reimagined) return invalid(game, 'Boarding parties are only mustered in a Reimagined war.');
    const target = getShip(game, action.targetId);
    if (!target || target.status !== 'vacant') return invalid(game, 'A board order names a derelict hull.', true);
    order.targetId = target.id;
  } else if (type === 'launch') {
    // The bay order (round 20), Reimagined-only like board: it names no target —
    // the carrier looses its complement when the enemy closes inside
    // DRONE.launchRange — and only a carrier with drones still aboard can take it.
    if (!game.reimagined) return invalid(game, 'Fighter drones fly only in a Reimagined war.');
    if (ship.className !== 'Carrier') return invalid(game, `${ship.name} carries no drone bay.`);
    if (hasLaunchedDrones(game, ship)) return invalid(game, `${ship.name}'s bay is empty — its drones are already away.`);
  } else if (TARGETED_ORDERS.includes(type)) {
    const target = getShip(game, action.targetId);
    if (!target || !isActive(target)) return invalid(game, 'That order needs an active ship to name.', true);
    if (target.id === ship.id) return invalid(game, `${ship.name} cannot be ordered against itself.`);
    const wantsFriendly = type !== 'intercept';
    if (wantsFriendly && target.faction !== ship.faction) return invalid(game, 'Escort and screen name a friendly ship.');
    if (!wantsFriendly && target.faction === ship.faction) return invalid(game, 'Intercept names an enemy ship.');
    order.targetId = target.id;
  }

  const label = describeOrder(game, order);
  const ordered = { ...game, orders: { ...(game.orders ?? {}), [ship.id]: order } };
  if (ship.id === actor.id) return result(ordered, `${ship.name} will ${label}.`);
  if (inRadioContact(game, actor, ship)) return result(ordered, `${ship.name} acknowledges: ${label}.`);
  return result(
    { ...game, pendingOrders: { ...(game.pendingOrders ?? {}), [ship.id]: order } },
    `${ship.name} is out of radio contact; the order to ${label} will reach it next stardate.`,
  );
};

/**
 * A one-time dockyard refit: extra system units rather than hull capacity, so
 * nothing downstream needs a capacity override. The hull must be inside the
 * dockyard ring, and one refit per hull per war keeps it a choice rather than a
 * treadmill.
 */
const setRefit = (game, action, actor) => {
  if (!game.extended) return invalid(game, 'Refits are an extended-war option.');
  const ship = getShip(game, action.shipId);
  if (!ship || ship.faction !== actor.faction || !isActive(ship)) return invalid(game, 'That hull cannot be refitted.');
  if (game.refits?.[ship.id]) return invalid(game, `${ship.name} has already taken its refit this war.`);
  const refit = REFITS[action.kind];
  if (!refit) return invalid(game, `Unknown refit: ${action.kind}.`);
  // A reactor upgrade needs a reactor to upgrade, which only Reimagined hulls carry.
  if ('reactor' in refit.systems && !game.reimagined) return invalid(game, 'A reactor upgrade is only available in a Reimagined war.');
  const base = dockedAt(game, ship);
  if (!base) return invalid(game, `${ship.name} must be inside the dockyard ring to be refitted.`);
  const template = templateSystems(ship);
  for (const [system, units] of Object.entries(refit.systems)) {
    if ((ship.systems[system] ?? 0) + units > (template[system] ?? 0) + REFIT_OVER_TEMPLATE) {
      return invalid(game, `${ship.name} cannot carry more ${system}.`);
    }
  }
  const systems = { ...ship.systems };
  for (const [system, units] of Object.entries(refit.systems)) systems[system] = (systems[system] ?? 0) + units;
  const updated = {
    ...game,
    refits: { ...(game.refits ?? {}), [ship.id]: action.kind },
    ships: game.ships.map((entry) => (entry.id === ship.id ? { ...entry, systems } : entry)),
  };
  const detail = Object.entries(refit.systems).map(([system, units]) => `${system} +${units}`).join(', ');
  return result(updated, `${ship.name} is refitted at ${base.name}: ${detail}.`);
};

/**
 * Sets a hull's reactor power allocation. Like a fleet order it costs no turn — it is
 * a bridge decision, not a maneuver — and it persists until changed. Reimagined only.
 *
 * Takes either a whole `allocation`, or a `sink` + `delta` nudge from the console pips.
 * A nudge never redistributes the other sinks: increasing past the live reactor budget
 * is refused outright rather than silently stealing from another system, and a sink
 * never drops below zero.
 */
const setPower = (game, action, actor) => {
  if (!game.reimagined) return invalid(game, 'Power management is only available in a Reimagined war.');
  const ship = getShip(game, action.shipId ?? game.playerShipId);
  if (!ship || !isActive(ship)) return invalid(game, 'No such hull to set power for.');
  if (ship.faction !== actor.faction) return invalid(game, 'Only Federation hulls take your power settings.');

  let requested = action.allocation;
  if (!requested && POWER_SINKS.includes(action.sink) && Number.isFinite(Number(action.delta))) {
    const current = powerAllocation(game, ship);
    const proposed = { ...current, [action.sink]: Math.max(0, (current[action.sink] ?? 0) + Math.trunc(Number(action.delta))) };
    const total = POWER_SINKS.reduce((sum, sink) => sum + proposed[sink], 0);
    // The budget includes any relay-node bonus the alliance holds (round 16).
    if (total > reactorOutput(ship, game)) return invalid(game, `${ship.name}'s reactor cannot spare the power.`);
    requested = proposed;
  }
  if (!requested) return invalid(game, 'Specify a power allocation or a sink to adjust.');

  const allocation = clampPowerAllocation(requested, ship, game);
  return result(
    { ...game, power: { ...(game.power ?? {}), [ship.id]: allocation } },
    `${ship.name} sets power: ${describePower(allocation)}.`,
  );
};

/**
 * Sets a hull's combat stance (round 21). Like power and fleet orders it costs no
 * turn — a bridge decision, not a maneuver — and persists until changed. Reimagined
 * only, and only Federation hulls take your stance orders (the AI captains hold
 * theirs by doctrine). The stance biases the shared `volleyMissChance` roll: firing
 * sharpens the hull's own guns but leaves it easier to hit, evasive does the reverse.
 */
const setStance = (game, action, actor) => {
  if (!game.reimagined) return invalid(game, 'Combat stances are only available in a Reimagined war.');
  const ship = getShip(game, action.shipId ?? game.playerShipId);
  if (!ship || !isActive(ship)) return invalid(game, 'No such hull to set a stance for.');
  if (ship.faction !== actor.faction) return invalid(game, 'Only Federation hulls take your stance orders.');
  const stance = action.stance;
  if (!STANCES.includes(stance)) return invalid(game, `Unknown stance: ${stance}.`);
  return result(
    { ...game, stances: { ...(game.stances ?? {}), [ship.id]: stance } },
    `${ship.name} sets ${stance} stance.`,
  );
};

/**
 * Turns a hull to a new heading (round 23). Like stance and power it costs no
 * turn — a helm order, not a maneuver — and persists until the next move or turn.
 * Reimagined only, and only Federation hulls take your helm orders (the AI
 * captains face their threats by doctrine). Movement implies a heading anyway;
 * this is how a hull holding a gun line presents its strong fore arc without
 * burning the stardate.
 */
const setFacing = (game, action, actor) => {
  if (!game.reimagined) return invalid(game, 'Directional shields are only available in a Reimagined war.');
  const ship = getShip(game, action.shipId ?? game.playerShipId);
  if (!ship || !isActive(ship)) return invalid(game, 'No such hull to turn.');
  if (ship.faction !== actor.faction) return invalid(game, 'Only Federation hulls take your helm orders.');
  if (isDrone(ship)) return invalid(game, `${ship.name} has no heading to set.`);
  const degrees = Number(action.degrees);
  if (!Number.isFinite(degrees)) return invalid(game, 'Turning requires a heading in degrees.');
  const facing = Math.round(normalizeDegrees(degrees));
  return result(
    replaceShip(game, { ...ship, facing }),
    `${ship.name} comes about, facing ${facing} degrees.`,
  );
};

/** The nearest active enemy hull to `actor`, ties by id, or null in a field with none. */
const nearestThreat = (game, actor) => game.ships
  .filter((ship) => isActive(ship) && ship.faction !== actor.faction)
  .map((ship) => ({ ship, range: distance(actor, ship) }))
  .sort((a, b) => a.range - b.range || a.ship.id.localeCompare(b.ship.id))[0]?.ship ?? null;

/**
 * Disengage (round 21, Reimagined): the player-facing twin of the AI's break-off —
 * a full engine burn straight away from the nearest threat, computed for you rather
 * than clicked. It IS the turn's maneuver (it spends the stardate like any move and
 * resolves collisions and rock strikes on arrival), so it never stacks a free
 * escape on top of another action. The retreat is clamped to the field edge rather
 * than refused, so a cornered hull runs along the boundary instead of stalling.
 * Pair it with the evasive stance (free) to break off under fire.
 */
const disengageAction = (game, actor) => {
  if (!game.reimagined) return invalid(game, 'Disengage is only available in a Reimagined war.');
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  if (isTractorHeld(game, actor)) return invalid(game, `${actor.name} cannot disengage while held by a tractor lock.`);
  const threat = nearestThreat(game, actor);
  if (!threat) return invalid(game, `${actor.name} has no enemy to disengage from.`);
  const grid = game.gridSize ?? GRID_SIZE;
  const capacity = engineCapacity(actor, grid, powerEffect(game, actor, 'engines'));
  const span = distance(actor, threat) || 1;
  const x = Math.max(0, Math.min(grid, Math.round(actor.x + ((actor.x - threat.x) / span) * capacity)));
  const y = Math.max(0, Math.min(grid, Math.round(actor.y + ((actor.y - threat.y) / span) * capacity)));
  // Round 23: the escape burn sets the heading — the runner presents its weak aft
  // arc to whatever is chasing (Reimagined only; inert elsewhere).
  const movedActor = applyHeading(game, actor, x, y);
  const collision = resolveCollision(replaceShip(game, movedActor), movedActor);
  const strike = resolveAsteroidStrike(collision.game, movedActor);
  return result(completeTurn(strike.game), [
    `${actor.name} disengages from ${threat.name}, running to ${x},${y}.`,
    ...collision.messages,
    ...strike.messages,
  ], { events: [...collision.events, ...strike.events] });
};

export const applyPlayerAction = (game, action = {}) => {
  if (!game || !action.type) return invalid(game, 'Choose a command.');
  if (game.outcome || game.phase === 'ended') return invalid(game, 'The war has already ended.');
  if (game.phase !== 'player') return invalid(game, 'Wait for the player turn.');
  const usable = usableActor(game);
  if (usable.error) return invalid(game, usable.error);
  const actor = usable.ship;

  switch (action.type) {
    case 'shields': {
      const flushed = flushShields(actor);
      if (!flushed) {
        return invalid(game, systemUnits(actor, 'engines') <= 0
          ? `${actor.name} cannot flush engines for shield power.`
          : 'Shields are already at full strength.');
      }
      return result(completeTurn(replaceShip(game, flushed.ship)), `Engines flushed for ${flushed.gained} units of shield power.`);
    }
    case 'move': return moveAction(game, action, actor);
    case 'disengage': return disengageAction(game, actor);
    case 'phasers': return weaponAction(game, action, actor, 'phasers');
    case 'photons': return weaponAction(game, action, actor, 'photons');
    case 'spread': return spreadAction(game, action, actor);
    case 'ion': return ionAction(game, action, actor);
    case 'tractor': return tractorAction(game, action, actor);
    case 'hyperspace': return hyperspaceAction(game, action, actor);
    case 'self-destruct': return selfDestructAction(game, actor);
    case 'pass': return result(completeTurn(game), `${actor.name} holds position.`);
    case 'computer': return result(game, 'Computer report ready.', { report: computerReport(game, actor) });
    case 'scan': {
      const disabled = requiresSystem(game, actor, 'scanner');
      if (disabled) return disabled;
      const found = targetFor(game, action, actor);
      if (found.error) return invalid(game, found.error, found.requiresTarget);
      if (distance(actor, found.target) > sensorRange(game, actor, 'scanner')) return invalid(game, `${found.target.name} is out of scanner range.`);
      if (nebulaHides(game, actor, found.target)) return invalid(game, `${found.target.name} is lost in the static of a nebula.`);
      return result(
        { ...game, scanned: { ...(game.scanned ?? {}), [found.target.id]: true } },
        `Scan of ${found.target.name} complete.`,
        { report: scanReport(game, found.target) },
      );
    }
    case 'map': {
      const disabled = requiresSystem(game, actor, 'mapper');
      if (disabled) return disabled;
      return result(game, 'Local map updated.', { report: mapReport(game, actor) });
    }
    case 'radio': {
      const disabled = requiresSystem(game, actor, 'radio');
      if (disabled) return disabled;
      // Ion-storm jam (15d): inside the core the radio neither sends nor hears.
      if (ionStormZone(game, actor) === 'core') return invalid(game, `${actor.name}'s radio is offline in the ion storm.`);
      return result(game, 'Radio report ready.', { report: radioReport(game, actor) });
    }
    case 'transport': return transportAction(game, action, actor);
    case 'launch': return launchAction(game, actor);
    case 'orders': return setOrder(game, action, actor);
    case 'refit': return setRefit(game, action, actor);
    case 'power': return setPower(game, action, actor);
    case 'stance': return setStance(game, action, actor);
    case 'facing': return setFacing(game, action, actor);
    case 'autopilot': return result(completeTurn(game), `${actor.name} autopilot holds course.`);
    case 'resign': {
      if (game.resigned) return invalid(game, 'You have already resigned command; the autopilot has the conn.');
      // The same rule as losing your ship, rather than a second copy of it that can
      // drift — and it prefers a hull that can move, so resigning onto Xanadu is not
      // the default outcome any more.
      const successor = strongestFederation(game, actor.id);
      const resigned = { ...game, resigned: true, vendettaShipId: null };
      if (!successor) {
        return result(resigned, `Captain Jason of the ${actor.name} has resigned.`);
      }
      return result(
        { ...resigned, playerShipId: successor.id },
        `Captain Jason of the ${actor.name} has resigned. Federation command shifted to ${successor.name}. Welcome aboard your new ship, Captain.`,
      );
    }
    default: return invalid(game, `Unknown command: ${action.type}.`);
  }
};
