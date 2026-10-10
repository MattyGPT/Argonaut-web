import { emitBattleRecord } from './battle-records.js';
import { POWER } from './constants.js';
import { maintainedTowMove, maintainedTowStartReason } from './maintained-tow.js';
import { clampPowerAllocation, distance, getShip, isActive, isDrone, isImmovable, isTractorHeld, maintainedTowPair, movementCapacity, nebulaHides, powerEffect, sensorRange, systemUnits } from './state.js';

const supported = (game) => game.reimagined && !game.realtime && game.operation?.id === 'rescue-at-the-belt';
/** An unconfigured fleet captain's shield-heavy default exhausts a 20-point
 * reactor before tractors. Assigning Rescue explicitly selects balanced power;
 * existing manual allocations remain authoritative, including intentional zero. */
export const prepareRescuePower = (game) => {
  if (!supported(game)) return game;
  for (const [id, order] of Object.entries(game.orders ?? {})) {
    const ship = getShip(game, id);
    if (order.type !== 'rescue' || !isActive(ship) || ship.faction !== 'Federation' || game.power?.[id] || id === game.playerShipId) continue;
    game = { ...game, power: { ...game.power, [id]: clampPowerAllocation(POWER.need, ship, game) } };
    game = emitBattleRecord(game, { kind: 'rescue-order', actor: ship, target: ship,
      payload: { cause: 'Rescue preparation: balanced reactor power assigned to run engines and tractors.' } });
  }
  return game;
};
export const rescueOrderReason = (game, ship) => {
  if (!supported(game)) return 'Rescue orders are available only in the turn-based rescue prototype.';
  if (!isActive(ship) || ship.id === game.playerShipId || ship.id === game.operation.targetId || isImmovable(ship) || isDrone(ship)) return 'Choose another active mobile fleet captain to rescue Sentinel.';
  if (game.operation.primary !== 'pending') return 'Sentinel is no longer awaiting rescue.';
  if (systemUnits(ship, 'tractor') <= 0 || systemUnits(ship, 'engines') <= 0) return 'The rescue tug needs working engines and tractor hardware.';
  if (Object.entries({ ...game.orders, ...game.pendingOrders }).some(([id, order]) => id !== ship.id && order.type === 'rescue'
    && isActive(getShip(game, id)) && getShip(game, id).faction === ship.faction)) return 'Another captain already has the Rescue assignment. Cancel that order first.';
  return null;
};

const segmentDistance = (point, from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
};

/** A bounded local detour, not a hidden-world pathfinder. Every proposal fits
 * the real movement budget and clears known hulls for both formation members. */
const rescueMove = (game, actor, goal) => {
  const capacity = movementCapacity(game, actor);
  const length = Math.min(capacity, distance(actor, goal));
  const heading = Math.atan2(goal.y - actor.y, goal.x - actor.x);
  const pair = maintainedTowPair(game, actor.id);
  const visible = game.ships.filter((s) => isActive(s) && s.id !== actor.id && s.id !== pair?.target.id
    && distance(actor, s) <= sensorRange(game, actor, 'mapper') && !nebulaHides(game, actor, s));
  for (const angle of [0, 35, -35, 70, -70, 90, -90]) {
    const radians = heading + angle * Math.PI / 180;
    let dx = Math.round(Math.cos(radians) * length), dy = Math.round(Math.sin(radians) * length);
    while (Math.hypot(dx, dy) > capacity) {
      if (Math.abs(dx) >= Math.abs(dy)) dx -= Math.sign(dx); else dy -= Math.sign(dy);
    }
    if (!dx && !dy) continue;
    const end = { x: actor.x + dx, y: actor.y + dy };
    if (Math.hypot(dx, dy) > capacity || end.x < 0 || end.y < 0 || end.x > game.gridSize || end.y > game.gridSize) continue;
    if (Math.abs(angle) < 90 && distance(end, goal) >= distance(actor, goal)) continue;
    const plan = maintainedTowMove(game, dx, dy, { tugId: actor.id });
    if (plan?.error) continue;
    const paths = [[actor, end], ...(pair ? [[pair.target, plan.targetEnd]] : [])];
    if (visible.some((s) => paths.some(([from, to]) => segmentDistance(s, from, to) < 3))) continue;
    return { type: 'move', dx, dy };
  }
  return null;
};

export const rescueDecision = (game, actorId) => {
  if (!supported(game) || game.orders?.[actorId]?.type !== 'rescue') return null;
  const op = game.operation, actor = getShip(game, actorId), target = getShip(game, op.targetId);
  const report = (phase, reason, action = { type: 'pass' }) => ({ phase, reason, action, targetId: op.targetId });
  const delivered = op.extracted.some((s) => s.id === op.targetId);
  if (delivered && op.extracted.some((s) => s.id === actorId)) return report('completed', 'Sentinel and the rescue tug evacuated.');
  if (op.extracted.some((s) => s.id === actorId)) return report('failed', 'The tug evacuated without Sentinel. Assign another captain to continue the rescue.');
  if (!isActive(actor) || actor.faction !== 'Federation') return report('failed', 'The assigned tug was lost or changed allegiance.');
  if (actor.id === game.playerShipId) return report('blocked', 'You now command this tug. Continue manually or transfer command to resume its order.');
  if (game.operation.result) return report('ended', 'The operation ended before this order completed.');
  if (!delivered && (!isActive(target) || target.faction !== actor.faction || op.primary !== 'pending')) return report('failed', 'Sentinel is no longer recoverable. Replace this order to withdraw the tug.');
  if (isTractorHeld(game, actor)) return report('blocked', 'The tug is held by another tractor beam.');
  if (systemUnits(actor, 'engines') <= 0 || powerEffect(game, actor, 'engines') <= 0) return report('blocked', 'The tug needs working, powered engines.');
  if (delivered) {
    const action = rescueMove(game, actor, op.exit);
    return action ? report('withdrawing', 'Sentinel is safe; the tug is heading for extraction.', action) : report('blocked', 'The tug cannot find a clear step to extraction.');
  }
  if (systemUnits(actor, 'tractor') <= 0 || powerEffect(game, actor, 'tractor') <= 0) return report('blocked', 'The tug needs working, powered tractor hardware.');
  const pair = maintainedTowPair(game, actorId);
  if (pair) {
    if ([actor, target].some((s) => distance(s, op.exit) <= op.exit.radius)) return report('awaiting-extraction', 'Both ships will evacuate after combat if the link survives.');
    const action = rescueMove(game, actor, op.exit);
    return action ? report('hauling', 'Maintained tow toward extraction.', action) : report('blocked', 'No clear tow step. Move nearby ships or replace the order; the captain will retry.');
  }
  if (target.tractorBy && target.tractorBy !== actorId) return report('blocked', 'Sentinel is held by another tractor beam.');
  if (distance(actor, target) >= 5 && distance(actor, target) <= 35) {
    const reason = maintainedTowStartReason(game, actor, target);
    return reason ? report('blocked', reason) : report('connecting', 'Establishing maintained tow; hauling starts on the next turn.', { type: 'tow-start', targetId: target.id });
  }
  const action = rescueMove(game, actor, { x: Math.max(5, target.x - 20), y: target.y });
  return action ? report('approaching', 'Closing to tractor range.', action) : report('blocked', 'No clear approach step. Move nearby ships or replace the order; the captain will retry.');
};

/** One bounded report per assigned hull; emit only transitions, not every wait. */
export const updateRescueReports = (game) => {
  if (!supported(game)) return game;
  const ids = new Set([...Object.keys(game.operation.rescueReports ?? {}), ...Object.keys(game.orders ?? {}).filter((id) => game.orders[id].type === 'rescue')]);
  for (const id of ids) {
    const prior = game.operation.rescueReports?.[id];
    const current = getShip(game, id);
    const failed = !isActive(current) || current.faction !== 'Federation';
    const decision = rescueDecision(game, id) ?? (prior && !['completed', 'cancelled'].includes(prior.phase)
      ? { phase: failed ? 'failed' : 'cancelled', reason: failed ? 'The assigned tug was lost or changed allegiance.' : 'Replaced by another fleet order.', targetId: prior.targetId } : null);
    if (!decision || (prior?.phase === decision.phase && prior?.reason === decision.reason)) continue;
    const { phase, reason, targetId } = decision;
    const report = { phase, reason, targetId, elapsed: game.operation.elapsed };
    game = { ...game, operation: { ...game.operation, rescueReports: { ...game.operation.rescueReports, [id]: report } } };
    const actor = getShip(game, id) ?? game.operation.extracted.find((s) => s.id === id);
    game = emitBattleRecord(game, { kind: 'rescue-order', actor, target: actor, payload: { cause: `Rescue ${phase}: ${reason}`, phase, subjectId: targetId } });
  }
  return game;
};
