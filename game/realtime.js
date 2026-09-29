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
import { engineCapacity, isTractorHeld, powerEffect } from './state.js';

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

/** One fixed sub-tick, as a fraction of a stardate. */
export const SUBTICK = 1 / REALTIME.ticksPerStardate;

/** The sim clock a war is on: fractional elapsed stardates, tolerant of round-30 saves that predate it. */
export const simTimeOf = (game) => game.simTime ?? (game.turn ?? 1) - 1;

/**
 * Round 31 — the live core. Advances a real-time war by ONE fixed sub-tick:
 * every hull with a destination burns toward it at its own speed —
 * `engineCapacity` re-read as units-per-stardate of velocity, every existing
 * modifier multiplicative — arriving early when the burn is short, exactly at
 * the boundary when it is full. Tractor-held hulls do not burn (round 32 moves
 * the lock into continuous time); engines burnt out mid-burn simply stop it.
 *
 * The integrator resolves nothing: arrivals are returned for the boundary to
 * meet with collisions and rock strikes, and `crossed` says the sim clock
 * passed an integer — the stardate boundary, where the whole chain fires.
 * Pure and RNG-free like the round-30 trajectory math: the same sub-tick
 * sequence from the same state always produces the same state, which is what
 * makes pause and speed presentation-only.
 */
export const advanceSubtick = (game) => {
  const before = simTimeOf(game);
  const simTime = before + SUBTICK;
  const grid = game.gridSize ?? GRID_SIZE;
  const arrived = [];
  const ships = game.ships.map((ship) => {
    const dest = ship.dest;
    if (!dest || ship.status !== 'active' || isTractorHeld(game, ship)) return ship;
    const speed = engineCapacity(ship, grid, powerEffect(game, ship, 'engines'));
    if (speed <= 0) return ship;
    const dx = dest.x - ship.x;
    const dy = dest.y - ship.y;
    const span = Math.hypot(dx, dy);
    const step = speed * SUBTICK;
    if (span <= step) {
      arrived.push(ship.id);
      return { ...ship, x: dest.x, y: dest.y, dest: null };
    }
    return { ...ship, x: ship.x + (dx / span) * step, y: ship.y + (dy / span) * step };
  });
  return {
    game: { ...game, simTime, ships },
    arrived,
    crossed: Math.floor(simTime) > Math.floor(before),
  };
};

/**
 * One sub-tick plus the boundary it may cross: the headless driver every
 * real-time war runs on — browser clock, spectator, tests. `resolveBoundary`
 * is passed in (turns.js owns the rules) so this module stays rules-free and
 * import-cycle-free.
 */
export const stepRealtime = (game, resolveBoundary) => {
  const step = advanceSubtick(game);
  if (!step.crossed) return step.game;
  return resolveBoundary(step.game, step.arrived);
};
