import { AI_PURSUIT, FLEET_ORDER_TUNING, GRID_SIZE, PERSONALITIES, RANGES } from './constants.js';
import { flushShields, tractorLock } from './actions.js';
import { createRng } from './rng.js';
import {
  blastRadius,
  distance,
  engineCapacity,
  getShip,
  isImmovable,
  isTractorHeld,
  orderFor,
  powerEffect,
  shieldCapacity,
  systemUnits,
} from './state.js';

const isActive = (ship) => ship?.status === 'active';

const isVendetta = (game, actor) => Boolean(game.vendettaShipId) && actor.id === game.vendettaShipId;

const enemiesOf = (game, actor) => game.ships.filter((ship) => isActive(ship) && ship.faction !== actor.faction);

/** The closest of `ships` to `from`, with its range, or null when there are none. */
const nearestTo = (from, ships) => ships
  .map((ship) => ({ ship, range: distance(from, ship) }))
  .sort((a, b) => a.range - b.range || a.ship.id.localeCompare(b.ship.id))[0] ?? null;

/**
 * The best shot available on a target, in the original's order of preference:
 * photons inside 10, phasers inside 30, otherwise a tractor lock inside 35. Null
 * when the target is past every reach or the hardware is gone.
 */
const engage = (actor, target, range, noTractor = false) => {
  if (systemUnits(actor, 'photons') > 0 && range <= RANGES.photons) return { type: 'photons', targetId: target.id };
  if (systemUnits(actor, 'phasers') > 0 && range <= RANGES.phasers) return { type: 'phasers', targetId: target.id };
  if (!noTractor && systemUnits(actor, 'tractor') > 0 && range <= RANGES.tractor && !isImmovable(target)) return { type: 'tractor', targetId: target.id };
  return null;
};

const canNavigate = (game, actor) => systemUnits(actor, 'engines') > 0 && !isTractorHeld(game, actor);

/**
 * A clean run at a point, stopping `stopAt` units short. Ordered ships navigate
 * precisely; the clumsy seeded drift is left to unordered fleet behavior, so
 * issuing orders is worth something.
 */
const stepToward = (actor, point, stopAt, game) => {
  const dx = point.x - actor.x;
  const dy = point.y - actor.y;
  const span = Math.hypot(dx, dy);
  const capacity = engineCapacity(actor, game?.gridSize ?? GRID_SIZE, powerEffect(game, actor, 'engines'));
  const magnitude = Math.min(capacity, Math.max(0, span - stopAt));
  if (span <= 0 || magnitude < 1) return { type: 'move', dx: 0, dy: 0 };
  return { type: 'move', dx: Math.round((dx / span) * magnitude), dy: Math.round((dy / span) * magnitude) };
};

/**
 * Vendetta ships break formation and hunt the player's command ship. Everyone
 * else concentrates with their fleet on the enemy nearest their flagship, so an
 * alliance focuses fire instead of scattering.
 */
const pickTarget = (game, actor) => {
  const enemies = enemiesOf(game, actor);
  if (enemies.length === 0) return null;
  if (isVendetta(game, actor)) {
    const player = getShip(game, game.playerShipId);
    // A vendetta only makes sense against an enemy: if the vendetta ship has been
    // captured or command transferred onto it, hunting "Jason" means shooting
    // your own side, or yourself.
    if (player && isActive(player) && player.faction !== actor.faction && player.id !== actor.id) {
      return { ship: player, range: distance(actor, player) };
    }
  }
  const flagship = game.ships.find((ship) => isActive(ship) && ship.faction === actor.faction && ship.id.endsWith('-flagship')) ?? actor;
  return enemies
    .map((ship) => ({ ship, range: distance(actor, ship), focus: distance(flagship, ship) }))
    .sort((a, b) => a.focus - b.focus || a.range - b.range || a.ship.id.localeCompare(b.ship.id))[0];
};

/** Where a withdrawing ship runs to: Xanadu if it still stands, else the fleet. */
const withdrawTo = (game, actor) => {
  const xanadu = getShip(game, 'xanadu');
  if (xanadu && isActive(xanadu)) return xanadu;
  const friends = game.ships.filter((ship) => isActive(ship) && ship.faction === actor.faction && ship.id !== actor.id);
  if (friends.length === 0) return null;
  return {
    x: friends.reduce((total, ship) => total + ship.x, 0) / friends.length,
    y: friends.reduce((total, ship) => total + ship.y, 0) / friends.length,
  };
};

/** A screening post sits between the ward and whatever is closest to it. */
const screenPost = (ward, threat) => {
  const dx = threat.x - ward.x;
  const dy = threat.y - ward.y;
  const span = Math.hypot(dx, dy) || 1;
  const step = Math.min(FLEET_ORDER_TUNING.screenDistance, span);
  return { x: ward.x + (dx / span) * step, y: ward.y + (dy / span) * step };
};

const shootOrChase = (game, actor, target, stopAt) => {
  const shot = engage(actor, target, distance(actor, target));
  if (shot) return shot;
  if (!canNavigate(game, actor)) return { type: 'pass' };
  return stepToward(actor, target, stopAt, game);
};

/**
 * What an ordered ship does this turn. Returns null when the order has gone stale
 * — the ship it named is gone — so the caller falls back to default fleet behavior.
 */
const orderedAction = (game, actor, order) => {
  const enemies = enemiesOf(game, actor);

  if (order.type === 'intercept') {
    const target = getShip(game, order.targetId);
    if (!target || !isActive(target)) return null;
    return shootOrChase(game, actor, target, FLEET_ORDER_TUNING.interceptStandoff);
  }

  if (order.type === 'hold') {
    const threat = nearestTo(actor, enemies);
    return (threat && engage(actor, threat.ship, threat.range)) || { type: 'pass' };
  }

  if (order.type === 'withdraw') {
    // A retreating ship still shoots back at whatever is already in range.
    const threat = nearestTo(actor, enemies);
    const parting = threat ? engage(actor, threat.ship, threat.range) : null;
    if (parting) return parting;
    const home = withdrawTo(game, actor);
    if (!home || !canNavigate(game, actor)) return { type: 'pass' };
    return stepToward(actor, home, 0, game);
  }

  const ward = getShip(game, order.targetId);
  if (!ward || !isActive(ward)) return null;
  const threat = nearestTo(ward, enemies);

  if (order.type === 'screen') {
    if (!threat) return { type: 'pass' };
    const shot = engage(actor, threat.ship, distance(actor, threat.ship));
    if (shot) return shot;
    const post = screenPost(ward, threat.ship);
    if (!canNavigate(game, actor) || distance(actor, post) <= FLEET_ORDER_TUNING.screenTolerance) return { type: 'pass' };
    return stepToward(actor, post, 0, game);
  }

  // Escort: fight whatever is menacing the ward, otherwise ride along beside it.
  if (threat && distance(ward, threat.ship) <= RANGES.tractor) {
    return shootOrChase(game, actor, threat.ship, FLEET_ORDER_TUNING.escortDistance);
  }
  const nearby = nearestTo(actor, enemies);
  const firing = nearby ? engage(actor, nearby.ship, nearby.range) : null;
  if (firing) return firing;
  if (distance(actor, ward) <= FLEET_ORDER_TUNING.escortDistance || !canNavigate(game, actor)) return { type: 'pass' };
  return stepToward(actor, ward, FLEET_ORDER_TUNING.escortDistance, game);
};

/** Backs away from a threat on a full engine burn; the caller clamps to the map. */
const stepAway = (actor, threat, game) => {
  const capacity = engineCapacity(actor, game?.gridSize ?? GRID_SIZE, powerEffect(game, actor, 'engines'));
  const span = distance(actor, threat) || 1;
  return {
    type: 'move',
    dx: Math.round(((actor.x - threat.x) / span) * capacity),
    dy: Math.round(((actor.y - threat.y) / span) * capacity),
  };
};

/** Falls back on the base or the fleet when that lies away from the threat; else runs. */
const fallBack = (game, actor, threat) => {
  if (!canNavigate(game, actor)) return { type: 'pass' };
  const home = withdrawTo(game, actor);
  if (home && distance(actor, home) > 4 && distance(home, threat) > distance(actor, threat)) {
    return stepToward(actor, home, 0, game);
  }
  return stepAway(actor, threat, game);
};

/**
 * An Axis captain's last resort: go out rather than be destroyed, but only when the
 * blast takes strictly more of the enemy than of its own fleet, and enough of them.
 */
const suicideRun = (game, actor, doctrine, enemies) => {
  if (!(doctrine.suicideBelow > 0)) return null;
  if (actor.shields > shieldCapacity(actor) * doctrine.suicideBelow) return null;
  const blast = blastRadius(actor);
  const inside = (list) => list.filter((ship) => distance(actor, ship) <= blast).length;
  const friendlies = game.ships.filter((ship) => isActive(ship) && ship.faction === actor.faction && ship.id !== actor.id);
  if (inside(enemies) < Math.max(doctrine.suicideMinEnemies, inside(friendlies) + 1)) return null;
  return { type: 'self-destruct' };
};

/** Which hull an alliance's captains go for once the player has not ordered them. */
const doctrineTarget = (game, actor, doctrine, enemies) => {
  if (isVendetta(game, actor)) {
    const player = getShip(game, game.playerShipId);
    if (player && isActive(player) && player.faction !== actor.faction && player.id !== actor.id) return player;
  }
  // By the book: the original's concentration on the enemy nearest the flagship.
  if (doctrine.fleetFocus) return pickTarget(game, actor)?.ship ?? null;
  if (doctrine.focusWeakest) {
    // Execute the wounded — but only among hulls this gunner can actually hit, or a
    // battery spends the war chasing one crippled scout across the map.
    const within = enemies.filter((ship) => distance(actor, ship) <= RANGES.phasers);
    const pool = within.length > 0 ? within : enemies;
    return [...pool].sort((a, b) => (a.shields + a.crew) - (b.shields + b.crew)
      || distance(actor, a) - distance(actor, b) || a.id.localeCompare(b.id))[0];
  }
  return nearestTo(actor, enemies)?.ship ?? null;
};

/**
 * How an alliance fights when the player has given that hull no orders: each
 * doctrine keeps its own fighting range, minds its own skin, and picks its own
 * targets. A classic war never reaches this, and a ship under orders obeys you
 * instead of its captains.
 */
const doctrineAction = (game, actor) => {
  const doctrine = PERSONALITIES[actor.faction];
  if (!doctrine) return null;
  const enemies = enemiesOf(game, actor);
  if (enemies.length === 0) return { type: 'pass' };

  const suicide = suicideRun(game, actor, doctrine, enemies);
  if (suicide) return suicide;

  // The vendetta is single-minded: that captain neither refits nor runs, per the
  // manual's ship that "numbly navigates through devastating enemy fire".
  const hunting = isVendetta(game, actor);
  const capacity = shieldCapacity(actor);
  const ratio = capacity ? actor.shields / capacity : 1;
  if (!hunting && ratio <= doctrine.flushBelow && flushShields(actor)) return { type: 'shields' };

  const target = doctrineTarget(game, actor, doctrine, enemies);
  if (!target) return { type: 'pass' };
  const range = distance(actor, target);

  if (!hunting && doctrine.retreatBelow > 0 && ratio <= doctrine.retreatBelow) return fallBack(game, actor, target);
  if (doctrine.minRange > 0 && range < doctrine.minRange && canNavigate(game, actor)) return stepAway(actor, target, game);
  // Cabal would rather wreck your hull on somebody else's than shoot it — but only
  // when the tow lands you on another enemy, so both hulls in that collision belong
  // to someone else. Towing you onto a Cabal ship is a coin flip it will not take.
  if (doctrine.tractorFirst && systemUnits(actor, 'tractor') > 0 && range <= RANGES.tractor
    && !isTractorHeld(game, target) && !isImmovable(target)) {
    const { position } = tractorLock(actor, target, game.gridSize ?? GRID_SIZE, null, powerEffect(game, actor, 'tractor'));
    const wreck = game.ships.some((ship) => ship.id !== target.id && isActive(ship)
      && ship.faction !== actor.faction && distance(position, ship) < 1);
    if (wreck) return { type: 'tractor', targetId: target.id };
  }

  const shot = engage(actor, target, range, doctrine.noTractor);
  if (shot) return shot;
  if (!canNavigate(game, actor)) return { type: 'pass' };
  if (range > doctrine.standoff) return stepToward(actor, target, doctrine.standoff, game);
  return { type: 'pass' };
};

export const chooseAiAction = (game, shipId) => {
  const actor = getShip(game, shipId);
  if (!isActive(actor)) return { type: 'pass' };

  // Standing orders only exist in an extended war; a classic war never sees one,
  // so the pursuit below stays exactly the original autopilot.
  const order = orderFor(game, shipId);
  if (order && order.type !== 'focus') {
    const ordered = orderedAction(game, actor, order);
    if (ordered) return ordered;
  }

  if (game.extended) {
    const doctrine = doctrineAction(game, actor);
    if (doctrine) return doctrine;
  }

  const target = pickTarget(game, actor);
  if (!target) return { type: 'pass' };
  const shot = engage(actor, target.ship, target.range);
  if (shot) return shot;
  if (canNavigate(game, actor)) {
    // Sitting on the target: hold position so the collision resolves.
    if (target.range < 1) return { type: 'move', dx: 0, dy: 0 };
    // Ruthless pursuit, clumsy navigation: seeded overshoot and drift so fleets
    // converge imperfectly and sometimes collide.
    const rng = createRng(`${game.seed}:${shipId}:${game.randomStep ?? 0}`);
    const deltaX = target.ship.x - actor.x;
    const deltaY = target.ship.y - actor.y;
    const capacity = engineCapacity(actor, game.gridSize ?? GRID_SIZE, powerEffect(game, actor, 'engines'));
    const magnitude = Math.min(capacity, Math.max(1, target.range - AI_PURSUIT.standoff) * (AI_PURSUIT.speedBase + rng.next() * AI_PURSUIT.speedJitter));
    const angle = Math.atan2(deltaY, deltaX) + (rng.next() - 0.5) * AI_PURSUIT.headingDrift;
    return {
      type: 'move',
      dx: Math.round(Math.cos(angle) * magnitude),
      dy: Math.round(Math.sin(angle) * magnitude),
    };
  }
  return { type: 'pass' };
};
