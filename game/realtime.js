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
import { noteFieldMovement } from './field-diagnostics.js';
import { engineCapacity, isActive, isSpectator, isTractorHeld, powerEffect } from './state.js';

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
 * the boundary when it is full. Tractor-held hulls do not burn (round 32's
 * continuum pulls them); engines burnt out mid-burn simply stop it.
 *
 * Round 32 — collision avoidance (Matt's addition): before moving, every
 * AI-conned burner projects its closest approach to each other active hull
 * over `avoidLookahead` sub-ticks; a closing course inside
 * `collisionRadius × avoidMargin` deflects THIS sub-tick's step to starboard
 * by `avoidAngle` — pure geometry, no RNG, no speed cost, and the plotted
 * destination stands, so the path bends around traffic instead of through
 * it. The player's manual conn and `noAvoid` stamps opt out: a ram you order
 * is a ram you get, and both hulls deflecting starboard makes head-on pairs
 * pass port-to-port. Facing is NOT re-read on a deflection — it is a small
 * course correction, not a new burn.
 *
 * The integrator resolves nothing: arrivals are returned for the continuum to
 * meet with rock strikes and the collision sweep, and `crossed` says the sim
 * clock passed an integer — the stardate boundary. Pure and RNG-free: the
 * same sub-tick sequence from the same state always produces the same state,
 * which is what makes pause and speed presentation-only.
 */
export const advanceSubtick = (game) => {
  const before = simTimeOf(game);
  const simTime = before + SUBTICK;
  const grid = game.gridSize ?? GRID_SIZE;
  // First pass: every burning hull's raw step — unit vector and length.
  const burns = new Map();
  for (const ship of game.ships) {
    const dest = ship.dest;
    if (!dest || !isActive(ship) || isTractorHeld(game, ship)) continue;
    const speed = engineCapacity(ship, grid, powerEffect(game, ship, 'engines'));
    if (speed <= 0) continue;
    const dx = dest.x - ship.x;
    const dy = dest.y - ship.y;
    const span = Math.hypot(dx, dy);
    const stepLen = speed * SUBTICK;
    burns.set(ship.id, {
      ship,
      dest,
      ux: span > 0 ? dx / span : 0,
      uy: span > 0 ? dy / span : 0,
      stepLen,
      arrival: span <= stepLen,
    });
  }
  // Avoidance pass: deflect the sub-tick step of any AI-conned burner whose
  // projected closest approach closes inside the margin.
  const manualConn = !isSpectator(game) && !game.autoConn;
  const threshold = REALTIME.collisionRadius * REALTIME.avoidMargin;
  const turn = (REALTIME.avoidAngle * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const deflects = new Set();
  for (const [id, burn] of burns) {
    // Arriving hulls are checked too: a destination already occupied by
    // traffic is exactly the collision the avoidance exists to prevent — a
    // threatened arrival becomes a deflected pass-by that keeps its plot and
    // tries again next sub-tick (bounded: captains re-plot at the boundary).
    if (burn.ship.noAvoid) continue;
    if (manualConn && id === game.playerShipId) continue;
    const vx = burn.ux * burn.stepLen;
    const vy = burn.uy * burn.stepLen;
    for (const other of game.ships) {
      if (other.id === id || !isActive(other)) continue;
      const otherBurn = burns.get(other.id);
      const wx = otherBurn && !otherBurn.arrival ? otherBurn.ux * otherBurn.stepLen : 0;
      const wy = otherBurn && !otherBurn.arrival ? otherBurn.uy * otherBurn.stepLen : 0;
      const px = burn.ship.x - other.x;
      const py = burn.ship.y - other.y;
      const rvx = vx - wx;
      const rvy = vy - wy;
      const along = px * rvx + py * rvy;
      if (along >= 0) continue; // opening, not closing
      const rvv = rvx * rvx + rvy * rvy;
      const t = rvv < 1e-9 ? 0 : Math.max(0, Math.min(REALTIME.avoidLookahead, -along / rvv));
      if (Math.hypot(px + rvx * t, py + rvy * t) < threshold) {
        deflects.add(id);
        break;
      }
    }
  }
  // Movement pass.
  const arrived = [];
  const towsDone = [];
  const ships = game.ships.map((ship) => {
    // Round 32: a tractor lock hauls its victim smoothly toward the point the
    // beam was laid on — the same per-stardate pull total, spread across the
    // ticks. Running out of rope finishes the tow; the continuum rolls the
    // rock strike there, exactly like a turn-based tow's end.
    if (ship.tow && ship.tow.remaining > 0 && isActive(ship)) {
      const dx = ship.tow.x - ship.x;
      const dy = ship.tow.y - ship.y;
      const dist = Math.hypot(dx, dy);
      const travel = Math.min(ship.tow.rate, dist, ship.tow.remaining);
      const remaining = ship.tow.remaining - travel;
      if (dist <= travel || remaining <= 1e-9) {
        towsDone.push(ship.id);
        return { ...ship, x: ship.tow.x, y: ship.tow.y, tow: null };
      }
      return {
        ...ship,
        x: ship.x + (dx / dist) * travel,
        y: ship.y + (dy / dist) * travel,
        tow: { ...ship.tow, remaining },
      };
    }
    const burn = burns.get(ship.id);
    if (!burn) return ship;
    if (burn.arrival) {
      if (deflects.has(ship.id)) {
        // A threatened arrival holds short of the occupied point and retries
        // next sub-tick: a captain loiters instead of ramming the anchorage.
        // (A 15° bend has no lateral authority at arm's length — holding does,
        // and the boundary re-plot bounds how long anyone waits.)
        return ship;
      }
      arrived.push(ship.id);
      return { ...ship, x: burn.dest.x, y: burn.dest.y, dest: null };
    }
    let ux = burn.ux;
    let uy = burn.uy;
    if (deflects.has(ship.id)) {
      // Starboard rotation in y-down field coordinates: both hulls of a
      // head-on pair deflect the same way and pass port-to-port.
      ux = burn.ux * cos - burn.uy * sin;
      uy = burn.ux * sin + burn.uy * cos;
    }
    return {
      ...ship,
      x: Math.max(0, Math.min(grid, ship.x + ux * burn.stepLen)),
      y: Math.max(0, Math.min(grid, ship.y + uy * burn.stepLen)),
    };
  });
  noteFieldMovement(game, ships, burns, deflects, manualConn);
  return {
    game: { ...game, simTime, ships },
    arrived,
    towsDone,
    crossed: Math.floor(simTime) > Math.floor(before),
  };
};
