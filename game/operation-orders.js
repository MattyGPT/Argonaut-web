import { emitBattleRecord } from './battle-records.js';
import { POWER, PRIZE } from './constants.js';
import { maintainedTowMove, maintainedTowStartReason } from './maintained-tow.js';
import { clampPowerAllocation, crewCapacity, distance, getShip, isActive, isDrone, isImmovable, isTractorHeld, maintainedTowPair, movementCapacity, nebulaHides, powerEffect, sensorRange, systemUnits } from './state.js';

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
  if ([...Object.entries(game.orders ?? {}), ...Object.entries(game.pendingOrders ?? {})].some(([id, order]) => id !== ship.id && order.type === 'rescue'
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
const rescueMove = (game, actor, goal, recovering = false) => {
  const capacity = movementCapacity(game, actor);
  const length = Math.min(capacity, distance(actor, goal));
  const heading = Math.atan2(goal.y - actor.y, goal.x - actor.x);
  const pair = maintainedTowPair(game, actor.id);
  const visible = game.ships.filter((s) => (isActive(s) || recovering && s.status === 'vacant') && s.id !== actor.id && s.id !== pair?.target.id
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
    if (visible.some((s) => paths.some(([from, to]) => {
      const clearance = segmentDistance(s, from, to);
      // Recovery can separate already crowded hulls, but never move closer or
      // sweep through one. Existing rescue formation steering stays unchanged.
      if (recovering && distance(s, from) < 3 && distance(s, to) >= 3 && clearance >= distance(s, from) - 1e-7) return false;
      return clearance < 3;
    }))) continue;
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

export const recoverOrderReason = (game, ship) => {
  if (!supported(game) || game.operation.result) return 'Recover prize is available only in an active turn-based rescue prototype.';
  const target = getShip(game, game.operation.prizeId);
  if (!isActive(ship) || ship.id === game.playerShipId || [game.operation.targetId, game.operation.prizeId].includes(ship.id)
    || isImmovable(ship) || isDrone(ship)) return 'Choose another active mobile fleet captain to recover Wayfarer.';
  if (systemUnits(ship, 'engines') <= 0 || systemUnits(ship, 'transporter') <= 0 || ship.crew <= 1) return 'Recovery needs working engines, transporters and crew to spare.';
  if (target?.faction === ship.faction || game.operation.extracted.some((s) => s.id === game.operation.prizeId)) return 'Wayfarer already has a friendly crew. Direct that ship with its own fleet orders.';
  // The briefing permits investigation, not remote knowledge of a hidden hull.
  if ([...Object.entries(game.orders ?? {}), ...Object.entries(game.pendingOrders ?? {})].some(([id, order]) => id !== ship.id && order.type === 'recover'
    && isActive(getShip(game, id)) && getShip(game, id).faction === ship.faction)) return 'Another captain already has the Recover prize assignment. Cancel that order first.';
  return null;
};

const exitDecision = (game, ship) => {
  if (ship.id === game.playerShipId) return { reason: 'You command this ship; move it to the beacon manually.', action: { type: 'pass' } };
  if (isTractorHeld(game, ship)) return { reason: 'Held by a tractor beam; release it or tow the pair to extraction.', action: { type: 'pass' } };
  if (systemUnits(ship, 'engines') <= 0 || powerEffect(game, ship, 'engines') <= 0) return { reason: 'Working, powered engines are required; repair or tow this ship.', action: { type: 'pass' } };
  if (distance(ship, game.operation.exit) <= game.operation.exit.radius) return { reason: null, action: { type: 'pass' } };
  const action = rescueMove(game, ship, game.operation.exit, true);
  return { reason: action ? null : 'No clear step to the beacon; move nearby ships. The captain will retry.', action: action ?? { type: 'pass' } };
};

/** A captured prize owns its withdrawal independently of the boarding captain.
 * Replacement orders remove this marker through the normal order reducer. */
export const recoveredPrizeDecision = (game, actorId) => {
  const order = game.orders?.[actorId], ship = getShip(game, actorId);
  const ownership = order?.recovery ?? Object.entries(game.orders ?? {}).filter(([, task]) => task.type === 'recover'
    && task.targetId === actorId && task.captureTimes === ship?.prize?.times && task.captureTimes)
    .map(([captainId, task]) => ({ captainId, captureTimes: task.captureTimes }))[0];
  if (!supported(game) || game.operation.result || actorId !== game.operation.prizeId || order?.type !== 'withdraw'
    || !ownership || !isActive(ship) || ship.faction !== 'Federation' || ship.prize?.times !== ownership.captureTimes) return null;
  return exitDecision(game, ship);
};

/** Called only after the normal boarding executor has actually transferred crew. */
export const recordRecoveryCapture = (game, actorId, targetId) => {
  const order = game.orders?.[actorId], prize = getShip(game, targetId);
  if (!supported(game) || order?.type !== 'recover' || order.targetId !== targetId || targetId !== game.operation.prizeId
    || !isActive(prize) || prize.faction !== 'Federation' || prize.prize?.by !== actorId) return game;
  const captureTimes = prize.prize.times;
  const pendingOrders = { ...game.pendingOrders };
  delete pendingOrders[targetId];
  return { ...game, pendingOrders, orders: { ...game.orders,
    [actorId]: { ...order, captureTimes },
    [targetId]: { type: 'withdraw', targetId: null, recovery: { captainId: actorId, captureTimes } } } };
};

export const recoverDecision = (game, actorId) => {
  if (!supported(game) || game.orders?.[actorId]?.type !== 'recover') return null;
  const op = game.operation, order = game.orders[actorId], actor = getShip(game, actorId), target = getShip(game, op.prizeId);
  const report = (phase, reason, action = { type: 'pass' }) => ({ phase, reason, action, targetId: op.prizeId });
  const returned = op.extracted.some((s) => s.id === actorId), delivered = op.extracted.find((s) => s.id === op.prizeId);
  if (order.captureTimes && delivered && delivered.prize?.times !== order.captureTimes) return report('failed', 'Wayfarer changed hands after this boarding. Its later extraction belongs to a different recovery.');
  if (order.captureTimes && delivered && returned) return report('completed', 'Wayfarer and the recovery captain evacuated.');
  if (!returned && (!isActive(actor) || actor.faction !== 'Federation')) return report('failed', 'The recovery captain was lost or changed allegiance. Any captured prize retains its own orders.');
  if (op.result) return report('ended', 'The operation ended. Capture alone does not count as prize recovery.');
  if (order.captureTimes) {
    if (!delivered && (!isActive(target) || target.faction !== 'Federation' || target.prize?.times !== order.captureTimes)) return report('failed', 'Wayfarer was lost or changed hands after boarding. Withdraw the captain or issue a new recovery order.');
    const captain = returned ? { action: { type: 'pass' }, reason: null } : exitDecision(game, actor);
    const prize = delivered ? { reason: null } : recoveredPrizeDecision(game, op.prizeId)
      ?? { reason: 'Wayfarer has different orders. Restore Withdraw or take it to extraction manually.' };
    const blocker = captain.reason ? `${actor.name}: ${captain.reason}` : prize.reason ? `Wayfarer: ${prize.reason}` : null;
    return report(blocker ? 'blocked' : 'withdrawing', blocker ?? (returned ? 'Recovery captain evacuated; waiting for Wayfarer to reach the beacon.'
      : delivered ? 'Wayfarer is safe; the recovery captain is withdrawing.' : 'Prize crew aboard. Wayfarer and the recovery captain are withdrawing independently.'), captain.action);
  }
  if (returned) return report('failed', 'The captain evacuated before boarding Wayfarer.');
  if (actor.id === game.playerShipId) return report('blocked', 'You now command this captain. Continue manually or transfer command to resume the order.');
  if (isTractorHeld(game, actor)) return report('blocked', 'The recovery captain is held by a tractor beam.');
  const visible = target && distance(actor, target) <= sensorRange(game, actor, 'mapper') && !nebulaHides(game, actor, target);
  if (visible || target?.faction === 'Federation' || delivered) {
    if (delivered || target?.status !== 'vacant') return report('failed', 'Wayfarer is no longer vacant. Capture by another captain is not completion of this order.');
    if (systemUnits(actor, 'transporter') <= 0 || sensorRange(game, actor, 'transporter') <= 0 || actor.crew <= 1) return report('blocked', 'Working transporters and crew to spare are required.');
    if (distance(actor, target) <= sensorRange(game, actor, 'transporter')) {
      const party = Math.min(PRIZE.aiParty, actor.crew - 1, crewCapacity(target));
      return report('boarding', `Transferring ${party} crew to Wayfarer on the next action; at least one stays aboard.`, { type: 'board', targetId: target.id });
    }
  }
  if (systemUnits(actor, 'engines') <= 0 || powerEffect(game, actor, 'engines') <= 0) return report('blocked', 'The recovery captain needs working, powered engines.');
  const intel = op.briefingPoints?.find((point) => point.label === 'Salvage report');
  const fix = visible ? target : intel;
  const goal = fix && { x: Math.max(5, fix.x - Math.max(5, Math.min(20, sensorRange(game, actor, 'transporter') * 0.65))), y: fix.y };
  if (!goal || !visible && distance(actor, goal) < 5) return report('blocked', 'No vacant hull sighted at the salvage report. Scout or replace this order.');
  const action = rescueMove(game, actor, goal, true);
  return action ? report('approaching', visible ? 'Closing to transporter range.' : 'Investigating the initial salvage report; no live target fix yet.', action)
    : report('blocked', 'No clear approach step. Move nearby ships or replace the order; the captain will retry.');
};

export const updateOperationOrderReports = (game) => {
  game = updateRescueReports(game);
  if (!supported(game)) return game;
  const ids = new Set([...Object.keys(game.operation.recoveryReports ?? {}), ...Object.keys(game.orders ?? {}).filter((id) => game.orders[id].type === 'recover')]);
  for (const id of ids) {
    const prior = game.operation.recoveryReports?.[id];
    const decision = recoverDecision(game, id) ?? (prior && !['completed', 'cancelled'].includes(prior.phase)
      ? { phase: 'cancelled', reason: 'Captain order replaced. Already transferred crew and the prize’s own withdrawal order remain.', targetId: prior.targetId } : null);
    if (!decision || prior?.phase === decision.phase && prior?.reason === decision.reason) continue;
    const { phase, reason, targetId } = decision;
    game = { ...game, operation: { ...game.operation, recoveryReports: { ...game.operation.recoveryReports,
      [id]: { phase, reason, targetId, elapsed: game.operation.elapsed } } } };
    const actor = getShip(game, id) ?? game.operation.extracted.find((s) => s.id === id);
    game = emitBattleRecord(game, { kind: 'recovery-order', actor, target: actor,
      payload: { cause: `Recover prize ${phase}: ${reason}`, phase, subjectId: targetId } });
  }
  return game;
};
