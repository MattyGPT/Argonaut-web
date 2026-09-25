/**
 * Real-time movement (Phase 8, round 30): the fixed-timestep integration core.
 *
 * The war keeps its stardate resolution tick — the rules layer resolves on
 * integer endpoints exactly as it always has, consuming the same RNG in the
 * same order. This module is the layer BENEATH that: after a stardate resolves,
 * it walks `REALTIME.ticksPerStardate` sub-ticks from where every hull stood at
 * the start of the stardate to the endpoint the rules already decided, at that
 * hull's own burn speed — `engineCapacity` re-read as units-per-stardate of
 * velocity, with every existing modifier (reactor power on the engine sink,
 * engine damage, prize-manning degradation) multiplicative, exactly as reach
 * scales today.
 *
 * The math is pure and RNG-free: it consumes no randomness, mutates nothing,
 * and no rule ever reads its output — the trajectory is presentation data, so
 * a real-time war is byte-identical at every stardate boundary to the
 * same-seed turn-based Reimagined war given the same commands (the round-30
 * boundary-equivalence contract, decision 12 of the Phase 8 spec).
 */

import { GRID_SIZE, REALTIME } from './constants.js';
import { engineCapacity, powerEffect } from './state.js';

/** Where every hull stands right now — the pre-resolution snapshot a stardate's trajectory starts from. */
export const positionsOf = (game) => Object.fromEntries(game.ships.map((ship) => [ship.id, { x: ship.x, y: ship.y }]));

/**
 * Builds the per-hull sub-tick trajectory for one resolved stardate. `start`
 * is the pre-resolution position snapshot (stamped by the turn pipeline); a
 * hull missing from it — a drone wing or encounter hull spawned mid-stardate —
 * holds at its final position for the whole window. Index 0 is the start,
 * index `ticksPerStardate` is the rules' endpoint exactly (float-safe: the
 * last leg is clamped to the endpoint, never interpolated into drift).
 */
export const integrateStardate = (game, start) => {
  const ticks = REALTIME.ticksPerStardate;
  const trajectory = {};
  for (const ship of game.ships) {
    const end = { x: ship.x, y: ship.y };
    const from = start?.[ship.id] ?? end;
    const span = Math.hypot(end.x - from.x, end.y - from.y);
    const points = [{ x: from.x, y: from.y }];
    if (span === 0) {
      for (let tick = 1; tick <= ticks; tick += 1) points.push({ x: from.x, y: from.y });
    } else {
      // The sub-tick the burn lands on: a faster hull — more engine units, more
      // reactor power on the engine sink — arrives EARLIER IN the stardate. A
      // displacement no engine could make (a tractor slam, a hyperspace jump)
      // simply lands on the boundary tick. A hull that cannot burn at all
      // (engines gone) is towed or jumped: same boundary arrival.
      const speed = engineCapacity(ship, game.gridSize ?? GRID_SIZE, powerEffect(game, ship, 'engines'));
      const arriveAt = speed > 0
        ? Math.min(ticks, Math.max(1, Math.ceil(span / (speed / ticks))))
        : ticks;
      for (let tick = 1; tick <= ticks; tick += 1) {
        const f = Math.min(1, tick / arriveAt);
        points.push(f >= 1
          ? { x: end.x, y: end.y }
          : { x: from.x + (end.x - from.x) * f, y: from.y + (end.y - from.y) * f });
      }
    }
    trajectory[ship.id] = points;
  }
  return trajectory;
};

/**
 * The interpolated position along a trajectory at time fraction `t` (0 = start
 * of the stardate, 1 = boundary). Linear between sub-ticks, so the browser can
 * render at any frame rate while the core stays fixed-timestep. Null when the
 * hull has no trajectory.
 */
export const positionAt = (points, t) => {
  if (!Array.isArray(points) || points.length === 0) return null;
  const span = points.length - 1;
  const scaled = Math.min(span, Math.max(0, t * span));
  const index = Math.floor(scaled);
  if (index >= span) return points[span];
  const f = scaled - index;
  const a = points[index];
  if (f === 0) return a;
  const b = points[index + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
};

/** The first sub-tick at which a trajectory has reached its endpoint — the arrival the engine power buys. */
export const arrivalTick = (points) => {
  if (!Array.isArray(points) || points.length === 0) return null;
  const end = points[points.length - 1];
  return points.findIndex((point) => point.x === end.x && point.y === end.y);
};
