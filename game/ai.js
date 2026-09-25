import { AI_PURSUIT, DRONE, ENCOUNTERS, FLEET_ORDER_TUNING, GRID_SIZE, PERSONALITIES, RANGES, REIMAGINED_SUICIDE_MIN_ENEMIES, SPREAD } from './constants.js';
import { canLaunchDrones, flushShields, tractorLock } from './actions.js';
import { createRng } from './rng.js';
import {
  blastRadius,
  distance,
  engineCapacity,
  getShip,
  ionStormZone,
  isDrone,
  isImmovable,
  isNeutral,
  isTractorHeld,
  orderFor,
  powerEffect,
  sensorRange,
  shieldCapacity,
  systemUnits,
} from './state.js';

const isActive = (ship) => ship?.status === 'active';

const isVendetta = (game, actor) => Boolean(game.vendettaShipId) && actor.id === game.vendettaShipId;

// Round 24: a neutral merchant is not a target of war — no captain shoots at,
// tows, or chases civilian traffic in this round (Cabal predation on merchants
// is a round-25 reputation candidate). The player may still interdict one.
const enemiesOf = (game, actor) => game.ships.filter((ship) => isActive(ship) && ship.faction !== actor.faction && !isNeutral(ship));

/** The closest of `ships` to `from`, with its range, or null when there are none. */
const nearestTo = (from, ships) => ships
  .map((ship) => ({ ship, range: distance(from, ship) }))
  .sort((a, b) => a.range - b.range || a.ship.id.localeCompare(b.ship.id))[0] ?? null;

/**
 * Whether a spread-torpedo salvo is worth loosing (round 22c): the AI fires it only
 * into a CLEAN, CLUSTERED splash — no friendly hull inside the radius (it never
 * friendly-fires, unlike a player who can choose to), and at least two enemies
 * caught (the target plus one more), so the area salvo beats a single gun. This is
 * the tactical counter to tight formations; against a lone hull the AI keeps its
 * phasers/photons. Deterministic, no RNG.
 */
const spreadWorthIt = (game, actor, target) => {
  let enemies = 0;
  for (const ship of game.ships) {
    if (!isActive(ship) || ship.id === actor.id) continue;
    if (distance(target, ship) > SPREAD.splashRadius) continue;
    if (ship.faction === actor.faction) return false; // a friendly in the splash: never
    enemies += 1;
  }
  return enemies >= 2;
};

/**
 * The best shot available on a target, in the original's order of preference:
 * photons inside 10, phasers inside 30, otherwise a tractor lock inside 35. Null
 * when the target is past every reach or the hardware is gone. An ion storm's core
 * takes the guns offline for the stardate (15d), so a jammed hull's engage offers
 * only the tractor — engines, sensors, and tractor work throughout the storm — and
 * every doctrine falls through to its movement branches, so a caught captain tries
 * to fight its way out rather than sulk.
 *
 * Ion/EMP (round 22a) sits between the lethal guns and the tractor: a hull that
 * carries the emitter fires it when the phasers cannot reach (ion outranges them at
 * 35) or are burnt out, so it suppresses over a standoff rather than trading kills.
 * Spread torpedoes (round 22c) sit just under the photons: a short-range area salvo
 * the AI looses only into a clean cluster (see `spreadWorthIt`), so it never
 * splashes its own wing the way a player can choose to.
 */
const engage = (game, actor, target, range, noTractor = false) => {
  const jammed = ionStormZone(game, actor) === 'core';
  if (!jammed && systemUnits(actor, 'photons') > 0 && range <= RANGES.photons) return { type: 'photons', targetId: target.id };
  // Spread torpedoes (round 22c): a short-range area salvo, loosed only into a
  // clean cluster (see spreadWorthIt) so the AI never splashes its own wing.
  if (!jammed && systemUnits(actor, 'spread') > 0 && range <= RANGES.spread && spreadWorthIt(game, actor, target)) {
    return { type: 'spread', targetId: target.id };
  }
  if (!jammed && systemUnits(actor, 'phasers') > 0 && range <= RANGES.phasers) return { type: 'phasers', targetId: target.id };
  if (!jammed && systemUnits(actor, 'ion') > 0 && range <= RANGES.ion) return { type: 'ion', targetId: target.id };
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
  // Reimagined-only generalization (round 17): a prize withdraws toward a base its
  // OWN alliance holds — only the Federation ever has one — else toward its fleet,
  // so an Axis prize no longer limps at the enemy starbase. A classic or extended
  // war keeps the original resolution byte-identical.
  if (xanadu && isActive(xanadu) && (!game.reimagined || xanadu.faction === actor.faction)) return xanadu;
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
  const shot = engage(game, actor, target, distance(actor, target));
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
    return (threat && engage(game, actor, threat.ship, threat.range)) || { type: 'pass' };
  }

  if (order.type === 'withdraw') {
    // A retreating ship still shoots back at whatever is already in range.
    const threat = nearestTo(actor, enemies);
    const parting = threat ? engage(game, actor, threat.ship, threat.range) : null;
    if (parting) return parting;
    const home = withdrawTo(game, actor);
    if (!home || !canNavigate(game, actor)) return { type: 'pass' };
    return stepToward(actor, home, 0, game);
  }

  if (order.type === 'board') {
    // The one targeted order whose subject is a derelict: stale the moment the hull
    // is destroyed or taken by anyone else, and the ship falls back to fleet
    // behavior rather than idling over an empty berth (round 17).
    const target = getShip(game, order.targetId);
    if (!target || target.status !== 'vacant') return null;
    if (systemUnits(actor, 'transporter') <= 0 || actor.crew <= 1) return null;
    if (distance(actor, target) <= sensorRange(game, actor, 'transporter')) return { type: 'board', targetId: target.id };
    if (!canNavigate(game, actor)) return null;
    return stepToward(actor, target, 0, game);
  }

  if (order.type === 'launch') {
    // The bay order (round 20): launch the moment the trigger trips; until then
    // the carrier fights and flies normally (null falls through to its own
    // opportunistic branch below, which reads the same trigger). Once away, the
    // order is spent — the bay never rebuilds — and falls through for good.
    return launchOpportunity(game, actor);
  }

  const ward = getShip(game, order.targetId);
  if (!ward || !isActive(ward)) return null;
  const threat = nearestTo(ward, enemies);

  if (order.type === 'screen') {
    if (!threat) return { type: 'pass' };
    const shot = engage(game, actor, threat.ship, distance(actor, threat.ship));
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
  const firing = nearby ? engage(game, actor, nearby.ship, nearby.range) : null;
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
  // The vendetta captain is single-minded: it neither refits, runs, nor gives up the
  // hunt to detonate. It "numbly navigates through devastating enemy fire" until it
  // is destroyed or its target is, so it never trades itself for the fleet.
  if (isVendetta(game, actor)) return null;
  if (actor.shields > shieldCapacity(actor) * doctrine.suicideBelow) return null;
  const blast = blastRadius(actor, game);
  const inside = (list) => list.filter((ship) => distance(actor, ship) <= blast).length;
  const friendlies = game.ships.filter((ship) => isActive(ship) && ship.faction === actor.faction && ship.id !== actor.id);
  // A Reimagined war's clusters stand denser since drone wing-stacking rams
  // ended (27c retune), so its last stand demands one more enemy in the blast.
  const minEnemies = game.reimagined ? REIMAGINED_SUICIDE_MIN_ENEMIES : doctrine.suicideMinEnemies;
  if (inside(enemies) < Math.max(minEnemies, inside(friendlies) + 1)) return null;
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

  const shot = engage(game, actor, target, range, doctrine.noTractor);
  if (shot) return shot;
  if (!canNavigate(game, actor)) return { type: 'pass' };
  if (range > doctrine.standoff) return stepToward(actor, target, doctrine.standoff, game);
  return { type: 'pass' };
};

/**
 * Opportunistic prize-taking (round 17, Reimagined): with no shot available this
 * stardate — no enemy inside gun reach, or the guns jammed in an ion storm — a
 * captain with working transporters and crew to spare boards the nearest vacant
 * hull inside transporter reach, enemy wreck or struck-colors friendly alike.
 * Deterministic (nearest, ties by id) and it consumes no RNG, so no seeded stream
 * shifts. The vendetta captain is single-minded and never boards, and the
 * starbase is exempt — garrisoned and immense, only the player's own transporter
 * re-mans it.
 */
const prizeOpportunity = (game, actor) => {
  if (!game.reimagined || isVendetta(game, actor)) return null;
  if (systemUnits(actor, 'transporter') <= 0 || actor.crew <= 1) return null;
  const jammed = ionStormZone(game, actor) === 'core';
  const shotAvailable = !jammed && enemiesOf(game, actor).some((enemy) => (systemUnits(actor, 'phasers') > 0 && distance(actor, enemy) <= RANGES.phasers)
    || (systemUnits(actor, 'photons') > 0 && distance(actor, enemy) <= RANGES.photons));
  if (shotAvailable) return null;
  const reach = sensorRange(game, actor, 'transporter');
  const hull = game.ships
    .filter((ship) => ship.status === 'vacant' && ship.className !== 'Starbase' && distance(actor, ship) <= reach)
    .sort((a, b) => distance(actor, a) - distance(actor, b) || a.id.localeCompare(b.id))[0];
  return hull ? { type: 'board', targetId: hull.id } : null;
};

/**
 * The carrier's bay (round 20, Reimagined): a carrier with its complement still
 * aboard launches it the moment an enemy closes inside `DRONE.launchRange` — one
 * deterministic trigger shared by the opportunistic branch and the `launch`
 * standing order, consuming no RNG and firing at most once per war, since the
 * launch itself marks the bay empty.
 */
const launchOpportunity = (game, actor) => {
  if (!canLaunchDrones(game, actor)) return null;
  const closing = enemiesOf(game, actor).some((enemy) => distance(actor, enemy) <= DRONE.launchRange);
  return closing ? { type: 'launch' } : null;
};

/**
 * A drone's escort station: its own bearing around the carrier at
 * `DRONE.escortDistance`, so the wing spreads out instead of stacking on one
 * point (and colliding with itself). Deterministic off the drone's launch index.
 */
const escortPost = (game, carrier, actor) => {
  const grid = game.gridSize ?? GRID_SIZE;
  const angle = ((actor.droneIndex ?? 1) - 1) * (2 * Math.PI / Math.max(1, DRONE.baySize));
  return {
    x: Math.max(0, Math.min(grid, Math.round(carrier.x + Math.cos(angle) * DRONE.escortDistance))),
    y: Math.max(0, Math.min(grid, Math.round(carrier.y + Math.sin(angle) * DRONE.escortDistance))),
  };
};

/**
 * How a drone fights (round 20 — Matt's pick: escort, then fight on alone).
 * While its carrier lives under the same colors the complement screens it:
 * anything closing inside `DRONE.escortRange` of the carrier is intercepted,
 * anything already inside the drone's own guns is shot at, and otherwise the
 * wing rides at its posts. A carrier destroyed or lost leaves the drones
 * independent hunters on the nearest enemy until they are shot down — they
 * never idle, never strike colors (no crew to take to the pods), and never
 * hold their faction in the war (`evaluateOutcome` does not count them, and
 * `darkenOrphanDrones` ends them with it). Drones skip the doctrine stack
 * entirely: no flush, no retreat, no last stand — nobody aboard to mind its
 * own skin. Deterministic: nearest targets, ties by id, no RNG draws.
 */
const droneAction = (game, actor) => {
  const enemies = enemiesOf(game, actor);
  if (enemies.length === 0) return { type: 'pass' };
  const carrier = getShip(game, actor.droneOf);
  if (carrier && isActive(carrier) && carrier.faction === actor.faction) {
    const menace = nearestTo(carrier, enemies);
    if (menace && menace.range <= DRONE.escortRange) {
      return shootOrChase(game, actor, menace.ship, DRONE.standoff);
    }
    // Nothing menacing the carrier: shoot at whatever is already in the guns,
    // else hold the post.
    const nearby = nearestTo(actor, enemies);
    const firing = nearby ? engage(game, actor, nearby.ship, nearby.range) : null;
    if (firing) return firing;
    const post = escortPost(game, carrier, actor);
    if (distance(actor, post) <= FLEET_ORDER_TUNING.screenTolerance || !canNavigate(game, actor)) return { type: 'pass' };
    return stepToward(actor, post, 0, game);
  }
  const target = nearestTo(actor, enemies);
  return shootOrChase(game, actor, target.ship, DRONE.standoff);
};

/**
 * How a neutral merchant behaves (round 24): it is a civilian passing through a
 * war zone, not a combatant — no orders, no doctrine, no last stand. It runs
 * from the nearest warship inside `ENCOUNTERS.fleeRange`, drifts when the field
 * is quiet, sits still in a tractor lock (caught), and jumps out of the war
 * entirely once its visit passes `ENCOUNTERS.neutralLifetime` stardates — the
 * bounded visit is what keeps a fleeing merchant from resetting the stalemate
 * net forever. Deterministic: nearest warship, ties by id, no RNG draws.
 */
const merchantAction = (game, actor) => {
  const born = actor.encounter?.turn ?? game.turn;
  if (game.turn - born >= ENCOUNTERS.neutralLifetime) return { type: 'depart' };
  if (isTractorHeld(game, actor)) return { type: 'pass' };
  if (!canNavigate(game, actor)) return { type: 'pass' };
  const menace = nearestTo(actor, game.ships.filter((ship) => isActive(ship) && ship.id !== actor.id && !isNeutral(ship)));
  if (menace && menace.range <= ENCOUNTERS.fleeRange) return stepAway(actor, menace.ship, game);
  return { type: 'pass' };
};

const chooseAiActionInner = (game, shipId) => {
  const actor = getShip(game, shipId);
  if (!isActive(actor)) return { type: 'pass' };

  // A neutral merchant answers to nobody (round 24): it flees, drifts, or jumps
  // out, and takes neither orders nor doctrine.
  if (isNeutral(actor)) return merchantAction(game, actor);

  // Standing orders only exist in an extended war; a classic war never sees one,
  // so the pursuit below stays exactly the original autopilot.
  const order = orderFor(game, shipId);
  if (order && order.type !== 'focus') {
    const ordered = orderedAction(game, actor, order);
    if (ordered) return ordered;
  }

  // Drones are semi-independent (round 20, Reimagined only): unordered, they fly
  // their own escort-then-hunt branch and skip doctrine entirely — there is no
  // crew aboard to flush shields, retreat, or make a last stand.
  if (isDrone(actor)) return droneAction(game, actor);

  // A carrier looses its bay when the enemy closes (round 20) — the same
  // trigger the `launch` order reads, and like boarding it consumes no rolls.
  const launch = launchOpportunity(game, actor);
  if (launch) return launch;

  // Prize-taking outranks doctrine but not orders: a captain with nothing to
  // shoot at grabs a derelict in reach (round 17, Reimagined only).
  const board = prizeOpportunity(game, actor);
  if (board) return board;

  if (game.extended) {
    const doctrine = doctrineAction(game, actor);
    if (doctrine) return doctrine;
  }

  const target = pickTarget(game, actor);
  if (!target) return { type: 'pass' };
  const shot = engage(game, actor, target.ship, target.range);
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

/**
 * Reimagined arrival avoidance (play-test retune, 2026-09-25): autopilot moves
 * converge on integer points — a drone wing intercepting one threat, escorts
 * re-posting around a moving carrier, a fleet concentrating on a shared target,
 * a clumsy pursuit holding position on top of its quarry — and two hulls that
 * end a stardate within a unit of each other collide and die regardless of
 * alliance. Measured on the harness at the 240-unit field: ~20 collisions per
 * war, 44% of them drones. Widening the field does not help (engine capacity
 * scales with it: 22.1 per war at 320, 22.8 at 400), so the fix lands at the
 * arrival: nudge the autopilot's landing to the nearest free integer point
 * inside its engine capacity. The designed rams are untouched — tractor slams,
 * hyperspace landings, and the player's own maneuvers still collide, and a
 * classic or extended war never reads this.
 */
export const avoidStackedArrival = (game, actor, dx, dy) => {
  if (!game.reimagined || !actor) return { dx, dy };
  // A zero move on top of a quarry is the autopilot's deliberate sit-and-ram —
  // clumsy attrition that thins firing clusters; avoiding it lets clusters
  // stay dense enough for last-stand massacres (measured 19.2% 4+-hull blasts).
  if (dx === 0 && dy === 0) return { dx, dy };
  if (!isDrone(actor)) return { dx, dy };
  const grid = game.gridSize ?? GRID_SIZE;
  const arrival = { x: actor.x + dx, y: actor.y + dy };
  const stacked = (point) => game.ships
    .some((other) => other.id !== actor.id && isActive(other) && distance(point, other) < 1);
  if (!stacked(arrival)) return { dx, dy };
  const capacity = engineCapacity(actor, grid, powerEffect(game, actor, 'engines'));
  for (let radius = 1; radius <= 3; radius += 1) {
    for (let angle = 0; angle < 8; angle += 1) {
      const candidate = {
        x: arrival.x + Math.round(Math.cos((angle * Math.PI) / 4) * radius),
        y: arrival.y + Math.round(Math.sin((angle * Math.PI) / 4) * radius),
      };
      const step = { dx: candidate.x - actor.x, dy: candidate.y - actor.y };
      if (candidate.x < 0 || candidate.y < 0 || candidate.x > grid || candidate.y > grid) continue;
      if (Math.hypot(step.dx, step.dy) > capacity) continue;
      if (!stacked(candidate)) return step;
    }
  }
  return { dx, dy };
};

export const chooseAiAction = (game, shipId) => {
  const action = chooseAiActionInner(game, shipId);
  if (action?.type !== 'move') return action;
  const adjusted = avoidStackedArrival(game, getShip(game, shipId), action.dx, action.dy);
  return adjusted.dx === action.dx && adjusted.dy === action.dy ? action : { ...action, ...adjusted };
};
