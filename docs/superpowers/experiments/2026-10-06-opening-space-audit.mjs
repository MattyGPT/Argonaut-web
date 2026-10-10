// Read-only opening geometry audit. Run from the repository root:
// node docs/superpowers/experiments/2026-10-06-opening-space-audit.mjs
// No commands, combat, RNG advancement after creation, or saved games.
import { createGame, distance, engineCapacity } from '../../../game/state.js';
import { RANGES, SHIP_TEMPLATES } from '../../../game/constants.js';

const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const results = [];
for (const regional of [false, true]) {
  const nearest = [];
  let anyPairInPhaserRange = 0;
  let commandInPhaserRange = 0;
  let commandCanCloseInOneMove = 0;
  for (let i = 0; i < 250; i += 1) {
    const game = createGame({ seed: `sim-${i}`, reimagined: true, regional });
    const player = game.ships.find((ship) => ship.id === game.playerShipId);
    const enemies = game.ships.filter((ship) => ship.faction !== player.faction && ship.status === 'active' && !ship.neutral);
    const closest = Math.min(...enemies.map((ship) => distance(player, ship)));
    nearest.push(closest);
    if (closest <= RANGES.phasers) commandInPhaserRange += 1;
    if (closest <= RANGES.phasers + engineCapacity(player, game.gridSize, 1)) commandCanCloseInOneMove += 1;
    if (game.ships.some((ship, j) => game.ships.slice(j + 1).some((other) => ship.faction !== other.faction && distance(ship, other) <= RANGES.phasers))) anyPairInPhaserRange += 1;
  }
  results.push({
    regional, seeds: 250, anyOpposingPairWithin30: anyPairInPhaserRange,
    commandWithin30: commandInPhaserRange,
    commandWithinOneFullMovePlus30: commandCanCloseInOneMove,
    commandNearestEnemyDistance: { p10: quantile(nearest, 0.1), median: quantile(nearest, 0.5), p90: quantile(nearest, 0.9) },
  });
}
const movement = [100, 320, 480, 640].map((gridSize) => ({
  gridSize,
  cruiserMovementAtEffectiveness1: engineCapacity({ systems: SHIP_TEMPLATES.cruiser.systems }, gridSize, 1),
  fieldWidthsPerMove: engineCapacity({ systems: SHIP_TEMPLATES.cruiser.systems }, gridSize, 1) / gridSize,
}));
console.log(JSON.stringify({
  scope: 'Opening geometry only; no actual contact, firing, visibility, path safety, or player experience measured. One-move estimates assume a stationary enemy, effectiveness 1, unobstructed travel, and no intervening actions. Movement and firing are separate turn-based commands.',
  movement, results,
}, null, 2));
