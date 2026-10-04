/** F1 developer observations. Opt-in, invocation-owned, outside saves and RNG.
 * Nothing in the rules reads these observations to choose an action. */
import { REALTIME } from './constants.js';
import { getShip, isActive, isDrone, isSpectator } from './state.js';

const FIELD = Symbol('field diagnostics');
const timeOf = (game) => game.simTime ?? (game.turn ?? 1) - 1;
const point = (ship) => ({ x: ship.x, y: ship.y });
const clone = (value) => value == null ? value : structuredClone(value);

export const createFieldDiagnostics = ({ onCollision, trajectoryWindow = 0 } = {}) => ({
  onCollision, trajectoryWindow: Math.max(0, Math.min(64, Math.trunc(trajectoryWindow))),
  sequence: 0, pairs: new Map(), movement: new Map(), decisions: new Map(), towDecisions: new Map(), history: [], activeAction: null, sweep: null,
  stalls: { ticks: 0, episodes: 0, maxConsecutiveTicks: 0 }, holding: new Map(),
});

/** The caller owns a collector across a war, but only this resolution carries it.
 * Both ordinary game and {game,...} return shapes are supported. */
export const withFieldDiagnostics = (game, collector, resolve) => {
  if (!collector || game[FIELD]) return resolve(game);
  const input = { ...game, [FIELD]: collector };
  const result = resolve(input);
  const wrapped = Boolean(result && Object.hasOwn(result, 'game'));
  const output = wrapped ? result.game : result;
  if (output === input) return wrapped ? { ...result, game } : game;
  const clean = { ...output };
  delete clean[FIELD];
  return wrapped ? { ...result, game: clean } : clean;
};

export const hasFieldDiagnostics = (game) => Boolean(game?.[FIELD]);

/** AI decision annotations are facts from the branch that selected the action. */
export const noteFieldDecision = (game, actorId, action, details = {}) => {
  const field = game[FIELD];
  if (!field) return;
  const previous = field.decisions.get(actorId);
  const sameDecision = previous?.simTime === timeOf(game) && JSON.stringify(previous.action) === JSON.stringify(action);
  field.decisions.set(actorId, { ...(sameDecision ? previous : {}), action: clone(action), simTime: timeOf(game), ...details,
    ...(previous?.simTime === timeOf(game) && previous.reason === 'doctrine-tow-ram' && action.type === 'tractor' ? { reason: previous.reason } : {}),
  });
};

export const withFieldAction = (game, actor, action, source, resolve) => {
  const field = game?.[FIELD];
  if (!field) return resolve();
  const previous = field.activeAction;
  const requestedDestination = action.type === 'move' && actor ? { x: actor.x + Number(action.dx), y: actor.y + Number(action.dy) }
    : action.type === 'hyperspace' && Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y)) ? { x: Number(action.x), y: Number(action.y) }
    : action.type === 'tractor' && Number.isFinite(Number(action.towardX)) && Number.isFinite(Number(action.towardY)) ? { x: Number(action.towardX), y: Number(action.towardY) } : null;
  const ramTargetIds = source === 'manual' ? game.ships.filter((ship) => ship.id !== actor?.id && isActive(ship)
    && (ship.id === action.towardId || (requestedDestination && Math.hypot(ship.x - requestedDestination.x, ship.y - requestedDestination.y) < 1))).map((ship) => ship.id) : [];
  const chosen = field.decisions.get(actor?.id);
  const decision = { ...(chosen?.simTime === timeOf(game) && JSON.stringify(chosen.action) === JSON.stringify(action) ? chosen : {}), actorId: actor?.id, source, action: clone(action), simTime: timeOf(game), requestedDestination, ramTargetIds };
  field.activeAction = { ...decision, before: new Map(game.ships.map((ship) => [ship.id, ship])), decision };
  try {
    const result = resolve();
    if (result.game !== game && ['move', 'tractor', 'hyperspace'].includes(action.type)) {
      noteFieldDecision(game, actor.id, action, { source, requestedDestination, ramTargetIds });
      if (action.type === 'tractor' && getShip(result.game, action.targetId)?.tow) field.towDecisions.set(action.targetId, clone(decision));
    }
    if (field.trajectoryWindow && !game.realtime && result.game !== game) {
      field.history.push({ simTime: timeOf(game), actorId: actor.id, action: clone(action), hulls: result.game.ships.map((ship) => ({
        id: ship.id, position: point(ship), destination: clone(ship.dest ?? null), status: ship.status,
      })) });
      if (field.history.length > field.trajectoryWindow) field.history.shift();
    }
    return result;
  } finally { field.activeAction = previous; }
};

/** Inspect the already chosen movement; does not recalculate avoidance. */
export const noteFieldMovement = (game, ships, burns, deflects, manualConn) => {
  const field = game[FIELD];
  if (!field) return;
  const elapsed = 1 / REALTIME.ticksPerStardate;
  const simTime = timeOf(game) + elapsed;
  const frame = [];
  const holding = new Map();
  for (const ship of ships) {
    const before = getShip(game, ship.id);
    if (!before || !isActive(before)) continue;
    if (!before.tow) field.towDecisions.delete(ship.id);
    const burn = burns.get(ship.id);
    const held = Boolean(burn?.arrival && deflects.has(ship.id));
    const avoidance = held ? 'hold-short' : deflects.has(ship.id) ? 'starboard-deflect'
      : before.noAvoid ? 'noAvoid-exempt' : manualConn && ship.id === game.playerShipId ? 'manual-exempt'
      : burn ? 'clear' : 'not-burning';
    const movement = { simTime, previous: point(before), position: point(ship),
      velocity: { x: (ship.x - before.x) / elapsed, y: (ship.y - before.y) / elapsed },
      destination: clone(before.dest ?? null), tow: clone(before.tow ?? null), avoidance };
    field.movement.set(ship.id, movement);
    if (field.trajectoryWindow) frame.push({ id: ship.id, ...movement });
    if (held) {
      const previous = field.holding.get(ship.id);
      const same = previous && previous.destination.x === burn.dest.x && previous.destination.y === burn.dest.y;
      const ticks = same ? previous.ticks + 1 : 1;
      const since = same ? previous.since : simTime;
      holding.set(ship.id, { destination: point(burn.dest), ticks, since });
      field.stalls.ticks += 1;
      if (!same) field.stalls.episodes += 1;
      if (ticks > field.stalls.maxConsecutiveTicks) {
        field.stalls.maxConsecutiveTicks = ticks;
        field.stalls.worst = { shipId: ship.id, since, until: simTime, position: point(ship), destination: point(burn.dest) };
      }
    }
  }
  field.holding = holding;
  if (field.trajectoryWindow) {
    field.history.push({ simTime, hulls: frame });
    if (field.history.length > field.trajectoryWindow) field.history.shift();
  }
};

export const withFieldSweep = (game, candidateIds, contact, resolve) => {
  const field = game[FIELD];
  if (!field) return resolve();
  const previous = field.sweep;
  field.sweep = { candidateIds, closestApproach: clone(contact) };
  try { return resolve(); } finally { field.sweep = previous; }
};

const damage = (before, after) => ({
  shields: Math.max(0, before.shields - after.shields), crew: Math.max(0, before.crew - after.crew),
  systems: Object.fromEntries(Object.keys(before.systems).map((key) => [key, Math.max(0, before.systems[key] - (after.systems[key] ?? 0))])),
  statusBefore: before.status, statusAfter: after.status,
});

/** Called exactly once inside the pair resolver, after both actual outcomes. */
export const noteFieldCollision = (before, after, first, second) => {
  const field = before[FIELD];
  if (!field) return;
  const pair = [first.id, second.id].sort();
  const pairKey = JSON.stringify(pair);
  const occurrence = (field.pairs.get(pairKey) ?? 0) + 1;
  field.pairs.set(pairKey, occurrence);
  const hulls = [first, second].map((ship) => {
    const moved = before.realtime ? field.movement.get(ship.id) : null;
    const previous = field.activeAction?.before.get(ship.id);
    const currentTowAction = field.activeAction?.action.type === 'tractor' && field.activeAction.action.targetId === ship.id ? field.activeAction.decision : null;
    const towDecision = ship.tow || moved?.tow ? field.towDecisions.get(ship.id) : null;
    const decision = currentTowAction ?? towDecision ?? field.decisions.get(ship.id) ?? null;
    const ownDecision = field.decisions.get(ship.id);
    const source = field.activeAction?.actorId === ship.id ? field.activeAction.source : ownDecision?.source;
    return {
      id: ship.id, name: ship.name, className: ship.className, faction: ship.faction, drone: isDrone(ship),
      position: point(ship), previousPosition: moved?.previous ?? (previous ? point(previous) : null),
      velocity: moved?.velocity ?? (previous ? { x: ship.x - previous.x, y: ship.y - previous.y } : null), velocityBasis: before.realtime ? 'map-units-per-stardate' : 'displacement-per-action',
      destination: clone(ship.dest ?? moved?.destination ?? null), tractorBy: ship.tractorBy ?? null,
      tow: clone(ship.tow ?? moved?.tow ?? null), noAvoid: Boolean(ship.noAvoid),
      conn: source ? source === 'manual' ? 'manual' : 'automatic' : ship.id === before.playerShipId && !isSpectator(before) && !before.autoConn ? 'manual' : 'automatic',
      avoidance: moved?.avoidance ?? decision?.avoidance ?? 'unobserved', decision: clone(decision),
      damage: damage(ship, getShip(after, ship.id)),
    };
  });
  const tags = [first.faction === second.faction ? 'friendly' : 'opposing'];
  if (hulls.some((hull) => hull.drone)) tags.push('drone');
  if (hulls.some((hull) => hull.tractorBy || hull.tow)) tags.push('tow');
  if (hulls.some((hull) => hull.velocity && hull.velocity.x === 0 && hull.velocity.y === 0)) tags.push('stationary');
  if (hulls.some((hull) => hull.decision?.reason === 'doctrine-tow-ram'
    && (hull.tow || (field.activeAction?.action.type === 'tractor' && field.activeAction.action.targetId === hull.id)))) tags.push('doctrine-tow-ram');
  const active = field.activeAction;
  const manual = active?.source === 'manual' ? active : before.realtime ? hulls.filter((hull) => hull.tow || (hull.destination && hull.decision?.requestedDestination
    && hull.destination.x === hull.decision.requestedDestination.x && hull.destination.y === hull.decision.requestedDestination.y)).map((hull) => hull.decision).find((decision) => decision?.source === 'manual') : null;
  if (manual) {
    if (manual.ramTargetIds?.some((id) => pair.includes(id))) tags.push('manual-ram');
  }
  if (!tags.includes('manual-ram') && !tags.includes('doctrine-tow-ram')) tags.push('unknown-intent');
  const record = { sequence: ++field.sequence, seed: before.seed, simTime: timeOf(before),
    path: field.sweep ? 'swept' : 'endpoint', pair, occurrence, tags, hulls,
    ...(field.sweep ? { sweep: clone(field.sweep) } : {}),
    losses: hulls.filter((hull) => hull.damage.statusBefore === 'active' && hull.damage.statusAfter !== 'active').map((hull) => ({ id: hull.id, status: hull.damage.statusAfter })),
    ...(field.trajectoryWindow ? { trajectory: field.history.map((frame) => ({ simTime: frame.simTime, hulls: frame.hulls.filter((hull) => pair.includes(hull.id)) })) } : {}),
  };
  field.onCollision?.(record);
};
