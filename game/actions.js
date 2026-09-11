import {
  CRIPPLE,
  DEFAULT_CREW_TRANSFER,
  GRID_SIZE,
  HYPERSPACE_BURN_CHANCE,
  HYPERSPACE_MIN_SHIELD_LOSS,
  HYPERSPACE_SHIELD_LOSS,
  MISS_CHANCE,
  ORDER_TYPES,
  RANGES,
  SHIELD_PER_ENGINE,
  SHRAPNEL_EXTRA_RANGE,
  TARGETED_ORDERS,
  TRACTOR_PULL_PER_UNIT,
  WEAPONS,
} from './constants.js';
import { createRng } from './rng.js';
import {
  alertLevel,
  blastRadius,
  crewCapacity,
  describeOrder,
  distance,
  engineCapacity,
  getLivingShips,
  getShip,
  inRadioContact,
  isTractorHeld,
  shieldCapacity,
  systemRange,
  systemUnits,
} from './state.js';

const isActive = (ship) => ship?.status === 'active';
const unitName = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Rolls one volley's damage. Shared by the player's shots and the autopilots'. */
export const weaponDamage = (type, shooter, rng) => {
  const { base, perUnit, spread } = WEAPONS[type];
  const nominal = base + systemUnits(shooter, type) * perUnit;
  const low = nominal * (1 - spread);
  return Math.max(1, Math.round(low + rng.next() * nominal * 2 * spread));
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

export const fireEvent = (kind, shooter, target, hit) => ({
  kind,
  fromId: shooter.id,
  toId: target.id,
  x1: shooter.x,
  y1: shooter.y,
  x2: target.x,
  y2: target.y,
  hit,
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
 * first; exposed damage randomly removes one live subsystem unit or crew member.
 */
export const damageShip = (ship, amount, rng = createRng('damage')) => {
  if (!isActive(ship) || !Number.isFinite(amount) || amount <= 0) return ship;

  let remaining = Math.floor(amount);
  const shields = Math.max(0, ship.shields - remaining);
  remaining = Math.max(0, remaining - ship.shields);
  let crew = ship.crew;
  let systems = { ...ship.systems };

  while (remaining > 0) {
    const candidates = [
      ...(crew > 0 ? ['crew'] : []),
      ...Object.keys(systems).filter((name) => systems[name] > 0),
    ];
    if (candidates.length === 0) {
      return { ...ship, shields, crew: 0, systems, status: 'destroyed', tractorBy: null };
    }
    const hit = rng.pick(candidates);
    if (hit === 'crew') crew -= 1;
    else systems = { ...systems, [hit]: systems[hit] - 1 };
    remaining -= 1;
  }

  return {
    ...ship,
    shields,
    crew,
    systems,
    ...(crew <= 0 ? { status: 'vacant', tractorBy: null } : {}),
  };
};

/**
 * Ships a fleet order may name: enemies for an intercept, friendlies for escort
 * and screen. Only active hulls can be given as a target.
 */
export const orderTargets = (game, shipId, orderType) => {
  const actor = getShip(game, shipId);
  if (!actor || !isActive(actor)) return [];
  const candidates = getLivingShips(game).filter((ship) => isActive(ship) && ship.id !== actor.id);
  return orderType === 'intercept'
    ? candidates.filter((ship) => ship.faction !== actor.faction)
    : candidates.filter((ship) => ship.faction === actor.faction);
};

export const eligibleTargets = (game, actionType) => {
  const actor = getShip(game, game.playerShipId);
  if (!actor) return [];
  const ships = getLivingShips(game).filter((ship) => ship.id !== actor.id);
  if (['phasers', 'photons', 'tractor'].includes(actionType)) {
    return ships.filter((ship) => isActive(ship) && ship.faction !== actor.faction);
  }
  if (actionType === 'transport') return ships.filter((ship) => ship.status !== 'destroyed');
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
  const range = { phasers: RANGES.phasers, photons: RANGES.photons, tractor: RANGES.tractor }[actionType];
  if (range) return sorted.find((ship) => distance(actor, ship) <= range)?.id ?? sorted[0].id;
  return sorted[0].id;
};

const computerReport = (game, actor) => {
  const active = game.ships.filter(isActive);
  const allies = active.filter((ship) => ship.id !== actor.id && ship.faction === actor.faction);
  const enemies = active.filter((ship) => ship.faction !== actor.faction);
  const nearest = (ships) => ships
    .map((ship) => ({ ship, range: distance(actor, ship) }))
    .sort((a, b) => a.range - b.range)[0];
  const nearestEnemy = nearest(enemies);
  const nearestAlly = nearest(allies);
  const counts = Object.entries(game.ships.reduce((totals, ship) => {
    if (isActive(ship)) totals[ship.faction] = (totals[ship.faction] ?? 0) + 1;
    return totals;
  }, {})).map(([faction, count]) => `${faction}: ${unitName(count, 'active ship')}`);
  const xanadu = getShip(game, 'xanadu');
  return {
    title: 'Ship computer',
    lines: [
      ...counts,
      nearestEnemy ? `Nearest enemy: ${nearestEnemy.ship.name} at ${nearestEnemy.range.toFixed(1)}` : 'Nearest enemy: none',
      nearestAlly ? `Nearest ally: ${nearestAlly.ship.name} at ${nearestAlly.range.toFixed(1)}` : 'Nearest ally: none',
      xanadu ? `Distance to Xanadu: ${distance(actor, xanadu).toFixed(1)}` : 'Distance to Xanadu: unknown',
    ],
  };
};

const scanReport = (target) => ({
  title: `Scan: ${target.name}`,
  lines: [
    `Class: ${target.className}`,
    `Affiliation: ${target.faction}`,
    `Status: ${target.status}`,
    `Shields: ${target.shields}`,
    `Crew: ${target.crew}`,
    ...Object.entries(target.systems).map(([name, units]) => `${name}: ${units}`),
  ],
});

const mapReport = (game, actor) => {
  const range = systemRange(actor, 'mapper');
  const visible = getLivingShips(game)
    .filter((ship) => distance(actor, ship) <= range)
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
  const range = systemRange(actor, 'radio');
  const contacts = getLivingShips(game)
    .filter((ship) => ship.id !== actor.id && ship.faction === actor.faction && distance(actor, ship) <= range);
  return {
    title: 'Radio traffic',
    lines: contacts.length
      ? contacts.map((ship) => `${ship.name}: condition ${alertLevel(ship)} at ${distance(actor, ship).toFixed(1)}; shields ${ship.shields}, crew ${ship.crew}, ${ship.status}.`)
      : ['No allied stations answer within radio range.'],
  };
};

const weaponAction = (game, action, actor, type) => {
  const disabled = requiresSystem(game, actor, type);
  if (disabled) return disabled;
  const found = hostileTarget(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  const range = RANGES[type];
  const targetDistance = distance(actor, found.target);
  if (targetDistance > range) return invalid(game, `${found.target.name} is out of range for ${type}.`);
  const rng = seededRng(game);
  const shooterMissed = rng.next() < MISS_CHANCE;
  if (shooterMissed) {
    const shooter = { ...actor, shotsFired: actor.shotsFired + 1 };
    const updated = completeTurn(advanceRandom(replaceShip(game, shooter)));
    return result(updated, `${actor.name} fires ${type} at ${found.target.name}. Missed!`, { events: [fireEvent(type, actor, found.target, false)] });
  }
  const damage = weaponDamage(type, actor, rng);
  const before = found.target.status;
  const hit = damageShip(found.target, damage, rng);
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
  const events = [fireEvent(type, actor, found.target, true)];
  if (kill) events.push({ kind: 'explosion', fromId: actor.id, toId: victim.id, x1: victim.x, y1: victim.y, x2: victim.x, y2: victim.y, hit: true });
  return result(updated, `${actor.name} fires ${type} at ${found.target.name} for ${damage} damage.`, { events });
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
  const events = [{ kind: 'explosion', fromId: survivor.id, toId: destroyed.id, x1: destroyed.x, y1: destroyed.y, x2: destroyed.x, y2: destroyed.y, hit: true }];
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

const moveAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  if (isTractorHeld(game, actor)) return invalid(game, `${actor.name} cannot move while held by a tractor lock.`);
  const dx = Number(action.dx);
  const dy = Number(action.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return invalid(game, 'Movement requires numeric displacement coordinates.');
  const displacement = Math.hypot(dx, dy);
  const capacity = engineCapacity(actor);
  if (displacement > capacity) return invalid(game, `Movement exceeds engine capacity of ${capacity}.`);
  const x = actor.x + dx;
  const y = actor.y + dy;
  if (x < 0 || x > GRID_SIZE || y < 0 || y > GRID_SIZE) return invalid(game, 'Movement would leave the tactical map.');
  const movedActor = { ...actor, x, y };
  const collision = resolveCollision(replaceShip(game, movedActor), movedActor);
  return result(completeTurn(collision.game), [`${actor.name} moves to ${x},${y}.`, ...collision.messages]);
};

const pullToward = (actor, target, pull) => {
  const dx = actor.x - target.x;
  const dy = actor.y - target.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return { x: target.x, y: target.y };
  const step = Math.min(pull, dist);
  return {
    x: Math.max(0, Math.min(GRID_SIZE, Math.round(target.x + (dx / dist) * step))),
    y: Math.max(0, Math.min(GRID_SIZE, Math.round(target.y + (dy / dist) * step))),
  };
};

/**
 * One tractor lock: how hard the beam pulls and where it lands the target.
 * Shared by the player's command and the autopilots' so both beams behave alike.
 */
export const tractorLock = (actor, target) => {
  const pull = systemUnits(actor, 'tractor') * TRACTOR_PULL_PER_UNIT;
  return { pull, position: pullToward(actor, target, pull) };
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
  const { pull, position } = tractorLock(actor, found.target);
  const pulled = { ...found.target, tractorBy: actor.id, x: position.x, y: position.y };
  // A beam can drag a hull straight into another one, and that is a collision like
  // any other — which makes towing an enemy into a friend a real tactic.
  const collision = resolveCollision(completeTurn(replaceShip(game, pulled)), pulled);
  return result(collision.game, [
    `${actor.name} locks a tractor beam on ${found.target.name}.`,
    `Tractor beam good for ${pull} units pull. ${actor.name} has beamed ${found.target.name} to ${position.x}, ${position.y}.`,
    ...collision.messages,
  ], { events: collision.events });
};

const transportAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'transporter');
  if (disabled) return disabled;
  const found = targetFor(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > systemRange(actor, 'transporter')) return invalid(game, `${found.target.name} is out of transporter range.`);
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
  const placed = Math.min(amount, actor.crew - 1, crewCapacity(found.target));
  const source = { ...actor, crew: actor.crew - placed };
  const captured = { ...found.target, faction: actor.faction, status: 'active', crew: placed, tractorBy: null };
  const base = {
    ...game,
    playerShipId: action.transferCommand ? captured.id : game.playerShipId,
    // Boarding the vendetta ship ends the vendetta; otherwise that hull would
    // keep hunting Captain Jason after it joined the Federation.
    vendettaShipId: game.vendettaShipId === captured.id ? null : game.vendettaShipId,
    ships: game.ships.map((ship) => ship.id === source.id ? source : ship.id === captured.id ? captured : ship),
  };
  return result(completeTurn(base), `${captured.name} is occupied by ${placed} crew${action.transferCommand ? '; command transferred.' : '.'}`);
};

const destroyedShip = (ship) => ({ ...ship, status: 'destroyed', crew: 0, shields: 0, tractorBy: null });

/**
 * The blast itself, without ending a turn: everything inside the radius dies and a
 * wider ring takes shrapnel. Shared by the player's `=` and by an Axis captain who
 * would rather take the enemy fleet with them.
 */
export const detonate = (game, actor) => {
  const rng = seededRng(game);
  const blast = blastRadius(actor);
  const shrapnel = blast + SHRAPNEL_EXTRA_RANGE;
  const messages = [`${actor.name} is self-destructing.  Blast range ${blast}.`];
  const victims = game.ships.map((ship) => {
    if (ship.id === actor.id) return destroyedShip(ship);
    if (!isActive(ship)) return ship;
    const range = distance(actor, ship);
    if (range <= blast) {
      messages.push(`${ship.name} falls within blast range.`);
      return destroyedShip(ship);
    }
    if (range <= shrapnel) {
      const damage = 10 + rng.integer(5, 25);
      messages.push(`${ship.name} has been hit by shrapnel.  Damage to shields: ${damage} units.`);
      return damageShip(ship, damage, rng);
    }
    return ship;
  });
  return { game: advanceRandom({ ...game, ships: victims }), messages };
};

const selfDestructAction = (game, actor) => {
  const blast = detonate(game, actor);
  return result(completeTurn(blast.game), blast.messages);
};

const hyperspaceAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  const rng = seededRng(game);
  if (rng.next() < HYPERSPACE_BURN_CHANCE) {
    return result(
      completeTurn(advanceRandom(replaceShip(game, destroyedShip(actor)))),
      `${actor.name} has burnt up trying to hyperspace.`,
    );
  }
  const x = action.x === undefined ? rng.integer(1, GRID_SIZE - 1) : Number(action.x);
  const y = action.y === undefined ? rng.integer(1, GRID_SIZE - 1) : Number(action.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > GRID_SIZE || y < 0 || y > GRID_SIZE) {
    return invalid(game, 'Hyperspace destination must be valid map coordinates.');
  }
  const shieldDamage = Math.max(HYPERSPACE_MIN_SHIELD_LOSS, Math.ceil(shieldCapacity(actor) * HYPERSPACE_SHIELD_LOSS));
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
  if (TARGETED_ORDERS.includes(type)) {
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
    case 'phasers': return weaponAction(game, action, actor, 'phasers');
    case 'photons': return weaponAction(game, action, actor, 'photons');
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
      if (distance(actor, found.target) > systemRange(actor, 'scanner')) return invalid(game, `${found.target.name} is out of scanner range.`);
      return result(game, `Scan of ${found.target.name} complete.`, { report: scanReport(found.target) });
    }
    case 'map': {
      const disabled = requiresSystem(game, actor, 'mapper');
      if (disabled) return disabled;
      return result(game, 'Local map updated.', { report: mapReport(game, actor) });
    }
    case 'radio': {
      const disabled = requiresSystem(game, actor, 'radio');
      if (disabled) return disabled;
      return result(game, 'Radio report ready.', { report: radioReport(game, actor) });
    }
    case 'transport': return transportAction(game, action, actor);
    case 'orders': return setOrder(game, action, actor);
    case 'autopilot': return result(completeTurn(game), `${actor.name} autopilot holds course.`);
    case 'resign': {
      if (game.resigned) return invalid(game, 'You have already resigned command; the autopilot has the conn.');
      const successor = game.ships
        .filter((ship) => isActive(ship) && ship.faction === actor.faction && ship.id !== actor.id)
        .sort((a, b) => (b.shields + b.crew) - (a.shields + a.crew) || a.id.localeCompare(b.id))[0];
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
