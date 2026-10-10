import { GRID_SIZE, RANGES } from './constants.js';
import { emitBattleRecord } from './battle-records.js';
import { distance, getShip, isActive, isDrone, isImmovable, isTractorHeld, maintainedTowPair, movementCapacity, nebulaHides, powerEffect, sensorRange, systemUnits } from './state.js';

export const maintainedTowStartReason = (game, actor, target) => {
  if (!game.reimagined) return 'Maintained towing is only available in Reimagined.';
  if (game.maintainedTow) return 'Release the current maintained tow first.';
  if (!isActive(actor) || actor.crew <= 0 || isImmovable(actor) || isDrone(actor)) return 'An active crewed mobile tug is required.';
  if (!isActive(target) || target.id === actor.id || target.faction !== actor.faction || target.crew <= 0 || isImmovable(target) || isDrone(target)) return 'Maintain tow requires an active, crewed friendly ship that the beam can move.';
  if (isTractorHeld(game, actor) || (isTractorHeld(game, target) && target.tractorBy !== actor.id)) return 'Another tractor lock prevents establishing this tow.';
  if (systemUnits(actor, 'tractor') <= 0 || powerEffect(game, actor, 'tractor') <= 0) return 'Working, powered tractor hardware is required.';
  if (systemUnits(actor, 'engines') <= 0 || powerEffect(game, actor, 'engines') <= 0) return 'Working, powered engines are required to establish a tow.';
  if (distance(actor, target) > RANGES.tractor) return 'The friendly ship is outside tractor range.';
  if (distance(actor, target) < 5) return 'Move at least 5 units clear of the friendly hull before establishing a tow.';
  return null;
};

const segmentDistance = (point, from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
  return Math.hypot(point.x - from.x - along * dx, point.y - from.y - along * dy);
};

/** Identical formation translation for both hulls. Only visible obstacles can
 * refuse a course; unknown contacts remain subject to normal collision rules. */
export const maintainedTowMove = (game, dx, dy, { course = false } = {}) => {
  const pair = maintainedTowPair(game);
  if (!pair) return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { error: 'Enter numeric displacement coordinates.' };
  const { tug, target } = pair;
  const speed = movementCapacity(game, tug);
  const tugEnd = { x: tug.x + dx, y: tug.y + dy }, targetEnd = { x: target.x + dx, y: target.y + dy };
  const grid = game.gridSize ?? GRID_SIZE;
  let error;
  if (speed <= 0) error = 'The tug has no engine movement available. Restore engine power or release the tow.';
  else if (!course && Math.hypot(dx, dy) > speed + 1e-7) error = `Maintained tow exceeds its ${Number(speed.toFixed(1))}-unit movement limit.`;
  else if ([tugEnd, targetEnd].some((point) => point.x < 0 || point.y < 0 || point.x > grid || point.y > grid)) error = 'That maneuver would take one of the linked ships outside the map.';
  else {
    const obstacle = game.ships.find((ship) => ship.id !== tug.id && ship.id !== target.id && isActive(ship)
      && distance(tug, ship) <= sensorRange(game, tug, 'mapper') && !nebulaHides(game, tug, ship)
      && (segmentDistance(ship, tug, tugEnd) < 1 || segmentDistance(ship, target, targetEnd) < 1));
    if (obstacle) error = `Tow maneuver blocked by ${obstacle.name}. Choose a clear waypoint or release the tow.`;
  }
  const rocks = (game.terrain ?? []).some((feature) => feature.type === 'asteroids' && [tugEnd, targetEnd].some((point) => distance(point, feature) <= feature.radius));
  return { ...pair, tugEnd, targetEnd, speed, error, rocks };
};

export const endMaintainedTow = (game, message) => {
  if (!game.reimagined || !game.maintainedTow) return game;
  const link = game.maintainedTow;
  const tug = getShip(game, link.tugId);
  const { maintainedTow, ...rest } = game;
  const next = { ...rest, towNotice: message, ships: game.ships.map((ship) => ship.id === link.targetId && ship.tractorBy === link.tugId
    ? { ...ship, tractorBy: null, tow: null, dest: null,
      ...(ship.encounter?.type === 'distress' ? { encounter: { ...ship.encounter, turn: game.turn } } : {}) }
    : ship.id === link.tugId && game.realtime ? { ...ship, dest: null } : ship) };
  return emitBattleRecord(next, { kind: 'maintained-tow-ended', actor: tug, target: tug, payload: { cause: message } });
};

export const reconcileMaintainedTow = (game) => {
  if (!game.reimagined || !game.maintainedTow || maintainedTowPair(game)) return game;
  const link = game.maintainedTow, tug = getShip(game, link.tugId), target = getShip(game, link.targetId);
  const delivered = game.operation?.extracted?.some((ship) => ship.id === link.targetId);
  const reason = delivered ? 'Maintained tow complete: the passenger has evacuated.'
    : !isActive(tug) || !isActive(target) ? 'Maintained tow ended: a linked ship is no longer active.'
      : tug.id !== game.playerShipId ? 'Maintained tow released after command transfer.'
        : tug.faction !== target.faction ? 'Maintained tow ended: a linked ship changed allegiance.'
          : systemUnits(tug, 'tractor') <= 0 || powerEffect(game, tug, 'tractor') <= 0 ? 'Maintained tow broken: tractor hardware or power is unavailable.'
            : 'Maintained tow broken: the tractor link or formation was disrupted.';
  return endMaintainedTow(game, reason);
};
