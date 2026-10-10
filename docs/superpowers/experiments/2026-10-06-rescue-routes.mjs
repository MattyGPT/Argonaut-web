// Legal scripted routes, not a substitute for human acceptance or balance sweeps.
// Run from the repository root with node <this path>. JSON goes to stdout.
import { createOperationGame, OPERATION_SEEDS, operationVisible } from '../../../game/operations.js';
import { applyPlayerAction } from '../../../game/actions.js';
import { resolveComputerTurns } from '../../../game/turns.js';
import { getShip, distance, movementCapacity } from '../../../game/state.js';

export const runRoute = (seed, detour = false, rejectedPatrol = false) => {
  let game = createOperationGame({ seed, battleId: `route:${seed}:${detour}:${rejectedPatrol}` });
  if (rejectedPatrol) {
    const point = game.operation.assignments['op-guard'].points[0];
    game.operation.assignments['op-guard'].points[0] = { x: point.x + 4, y: point.y + 4 };
  }
  const result = { seed, route: detour ? 'prize-first' : 'rescue-first', rejectedPatrol,
    firstCommandDetection: null, firstHostileAttempt: null, hostileAttempts: 0, hostileHits: 0, rescueElapsed: null, actions: [] };
  const act = (action) => {
    const response = applyPlayerAction(game, action);
    if (response.game === game) throw new Error(response.messages.join(' '));
    game = response.game;
    if (game.phase === 'computer') game = resolveComputerTurns(game);
    const hostile = (game.events ?? []).filter((event) => ['op-guard', 'op-patrol', 'op-reinforcement'].includes(event.fromId)
      && ['phasers', 'photons', 'ion', 'spread'].includes(event.kind));
    if (hostile.length && result.firstHostileAttempt === null) result.firstHostileAttempt = game.operation.elapsed;
    result.hostileAttempts += hostile.length;
    result.hostileHits += hostile.filter((event) => event.hit).length;
    const player = getShip(game, game.playerShipId);
    if (result.firstCommandDetection === null && player && game.ships.some((ship) => ship.faction === 'Axis' && operationVisible(game, player, ship))) result.firstCommandDetection = game.operation.elapsed;
    if (game.operation.primary === 'secured' && result.rescueElapsed === null) result.rescueElapsed = game.operation.elapsed;
    result.actions.push({ elapsed: game.operation.elapsed, shipId: game.playerShipId, action });
  };
  const move = (x, y) => {
    const ship = getShip(game, game.playerShipId), dx = x - ship.x, dy = y - ship.y;
    const fraction = Math.min(1, (movementCapacity(game, ship) - 1) / Math.hypot(dx, dy));
    act({ type: 'move', dx: Math.round(dx * fraction), dy: Math.round(dy * fraction) });
  };
  if (detour) {
    for (let step = 0; step < 5 && distance(getShip(game, game.playerShipId), { x: 158, y: 92 }) > 2; step += 1) move(158, 92);
    act({ type: 'transport', targetId: 'op-prize', amount: 20 });
  } else act({ type: 'move', dx: 45, dy: -20 });
  for (let step = 0; step < 18 && !game.outcome && game.operation.primary === 'pending'; step += 1) {
    const ship = getShip(game, game.playerShipId), target = getShip(game, game.operation.targetId);
    if (distance(ship, target) <= 35) act({ type: 'tractor', targetId: target.id, towardX: 38, towardY: 160 });
    else move(target.x - 17, target.y - 20);
  }
  // Wait for the slow prize before extracting the last mobile command hull.
  for (let step = 0; detour && step < 22 && !game.outcome && !game.operation.extracted.some((ship) => ship.id === 'op-prize'); step += 1) act({ type: 'pass' });
  for (let step = 0; step < 12 && !game.outcome; step += 1) move(38, 160);
  return { ...result, outcome: game.operation.result, sentinelShields: game.operation.extracted.find((ship) => ship.id === 'op-sentinel')?.shields ?? null };
};

console.log(JSON.stringify([false, true].flatMap((rejected) => OPERATION_SEEDS.flatMap((seed) => [false, true].map((detour) => runRoute(seed, detour, rejected)))), null, 2));
