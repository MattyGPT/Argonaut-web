import { GRID_SIZE, SHIP_TEMPLATES } from './constants.js';
import { createRng } from './rng.js';
import { distance, getLivingShips, getShip } from './state.js';

const RANGES = Object.freeze({
  phasers: 30,
  photons: 10,
  tractor: 35,
  hyperspace: GRID_SIZE,
  selfDestruct: 20,
});

const SHIELD_PER_ENGINE = 5;
const TRACTOR_PULL_PER_UNIT = 5;
const SHRAPNEL_EXTRA_RANGE = 15;
const STARBASE_BLAST_RADIUS = 40;
const MISS_CHANCE = 0.12;
const HYPERSPACE_BURN_CHANCE = 0.1;

const isActive = (ship) => ship?.status === 'active';
const systemUnits = (ship, system) => Math.max(0, ship?.systems?.[system] ?? 0);
const systemRange = (ship, system, perUnit) => systemUnits(ship, system) * perUnit;

const templateFor = (ship) => Object.values(SHIP_TEMPLATES)
  .find((template) => template.className === ship.className);

const shieldCapacity = (ship) => templateFor(ship)?.shields ?? ship.shields;
const crewCapacity = (ship) => templateFor(ship)?.crew ?? ship.crew;
const unitName = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

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
  const range = systemRange(actor, 'mapper', 20);
  const visible = getLivingShips(game)
    .filter((ship) => distance(actor, ship) <= range)
    .sort((left, right) => distance(actor, left) - distance(actor, right));
  return {
    title: 'Local tactical map',
    lines: visible.map((ship) => `${ship.name} (${ship.faction}) — ${ship.x},${ship.y} at ${distance(actor, ship).toFixed(1)}`),
  };
};

const radioReport = (game, actor) => {
  const range = systemRange(actor, 'radio', 25);
  const contacts = getLivingShips(game)
    .filter((ship) => ship.id !== actor.id && ship.faction === actor.faction && distance(actor, ship) <= range);
  return {
    title: 'Radio traffic',
    lines: contacts.length
      ? contacts.map((ship) => `${ship.name}: standing by at ${distance(actor, ship).toFixed(1)}.`)
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
  const damage = type === 'phasers'
    ? 12 + systemUnits(actor, 'phasers') * 4
    : 24 + systemUnits(actor, 'photons') * 9;
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

export const resolveCollision = (game, actor) => {
  const collision = game.ships.find((ship) => ship.id !== actor.id && isActive(ship) && distance(ship, actor) < 1);
  if (!collision) return { game, messages: [], events: [] };
  const rng = seededRng(game);
  const destroyedId = rng.pick([actor.id, collision.id]);
  const survivorId = destroyedId === actor.id ? collision.id : actor.id;
  const destroyed = destroyedShip(getShip(game, destroyedId));
  const survivor = damageShip(getShip(game, survivorId), 120, rng);
  const updated = advanceRandom({
    ...game,
    ships: game.ships.map((ship) => ship.id === destroyed.id ? destroyed : ship.id === survivor.id ? survivor : ship),
  });
  const events = [{ kind: 'explosion', fromId: survivor.id, toId: destroyed.id, x1: destroyed.x, y1: destroyed.y, x2: destroyed.x, y2: destroyed.y, hit: true }];
  return { game: updated, messages: [`Collision: ${destroyed.name} is destroyed; ${survivor.name} is crippled.`], events };
};

const moveAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'engines');
  if (disabled) return disabled;
  if (actor.tractorBy) return invalid(game, `${actor.name} cannot move while held by a tractor lock.`);
  const dx = Number(action.dx);
  const dy = Number(action.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return invalid(game, 'Movement requires numeric displacement coordinates.');
  const displacement = Math.hypot(dx, dy);
  const capacity = systemUnits(actor, 'engines') * 10;
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
  const pull = systemUnits(actor, 'tractor') * TRACTOR_PULL_PER_UNIT;
  const position = pullToward(actor, found.target, pull);
  const updated = completeTurn(replaceShip(game, { ...found.target, tractorBy: actor.id, x: position.x, y: position.y }));
  return result(updated, [
    `${actor.name} locks a tractor beam on ${found.target.name}.`,
    `Tractor beam good for ${pull} units pull. ${actor.name} has beamed ${found.target.name} to ${position.x}, ${position.y}.`,
  ]);
};

const transportAction = (game, action, actor) => {
  const disabled = requiresSystem(game, actor, 'transporter');
  if (disabled) return disabled;
  const found = targetFor(game, action, actor);
  if (found.error) return invalid(game, found.error, found.requiresTarget);
  if (distance(actor, found.target) > systemRange(actor, 'transporter', 10)) return invalid(game, `${found.target.name} is out of transporter range.`);
  if (isActive(found.target) && found.target.faction !== actor.faction) return invalid(game, 'Cannot transport onto a live enemy ship.');
  const amount = Number(action.amount ?? 10);
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
    ships: game.ships.map((ship) => ship.id === source.id ? source : ship.id === captured.id ? captured : ship),
  };
  return result(completeTurn(base), `${captured.name} is occupied by ${placed} crew${action.transferCommand ? '; command transferred.' : '.'}`);
};

const blastRadiusFor = (ship) => ship.className === 'Starbase' ? STARBASE_BLAST_RADIUS : RANGES.selfDestruct;

const destroyedShip = (ship) => ({ ...ship, status: 'destroyed', crew: 0, shields: 0, tractorBy: null });

const selfDestructAction = (game, actor) => {
  const rng = seededRng(game);
  const blast = blastRadiusFor(actor);
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
  return result(completeTurn(advanceRandom({ ...game, ships: victims })), messages);
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
  const shieldDamage = Math.max(5, Math.ceil(shieldCapacity(actor) * 0.12));
  const relocated = { ...actor, x, y, shields: Math.max(0, actor.shields - shieldDamage), tractorBy: null };
  return result(
    completeTurn(advanceRandom(replaceShip(game, relocated))),
    `${actor.name} enters hyperspace and emerges at ${x},${y}; shields lose ${shieldDamage}.`,
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
      if (systemUnits(actor, 'engines') <= 0) return invalid(game, `${actor.name} cannot flush engines for shield power.`);
      const gain = systemUnits(actor, 'engines') * SHIELD_PER_ENGINE;
      const shields = Math.min(shieldCapacity(actor), actor.shields + gain);
      if (shields === actor.shields) return invalid(game, 'Shields are already at full strength.');
      return result(completeTurn(replaceShip(game, { ...actor, shields })), `Engines flushed for ${shields - actor.shields} units of shield power.`);
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
      if (distance(actor, found.target) > systemRange(actor, 'scanner', 10)) return invalid(game, `${found.target.name} is out of scanner range.`);
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
    case 'autopilot': return result(completeTurn(game), `${actor.name} autopilot holds course.`);
    case 'resign': {
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
