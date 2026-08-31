import { distance, getShip } from './state.js';
import { createRng } from './rng.js';

const isActive = (ship) => ship?.status === 'active';
const units = (ship, system) => Math.max(0, ship.systems?.[system] ?? 0);

const isVendetta = (game, actor) => Boolean(game.vendettaShipId) && actor.id === game.vendettaShipId;

/**
 * Vendetta ships break formation and hunt the player's command ship. Everyone
 * else concentrates with their fleet on the enemy nearest their flagship, so an
 * alliance focuses fire instead of scattering.
 */
const pickTarget = (game, actor) => {
  const enemies = game.ships.filter((ship) => isActive(ship) && ship.faction !== actor.faction);
  if (enemies.length === 0) return null;
  if (isVendetta(game, actor)) {
    const player = getShip(game, game.playerShipId);
    if (player && isActive(player)) return { ship: player, range: distance(actor, player) };
  }
  const flagship = game.ships.find((ship) => isActive(ship) && ship.faction === actor.faction && ship.id.endsWith('-flagship')) ?? actor;
  return enemies
    .map((ship) => ({ ship, range: distance(actor, ship), focus: distance(flagship, ship) }))
    .sort((a, b) => a.focus - b.focus || a.range - b.range || a.ship.id.localeCompare(b.ship.id))[0];
};

export const chooseAiAction = (game, shipId) => {
  const actor = getShip(game, shipId);
  if (!isActive(actor)) return { type: 'pass' };
  const target = pickTarget(game, actor);
  if (!target) return { type: 'pass' };
  if (units(actor, 'photons') > 0 && target.range <= 10) return { type: 'photons', targetId: target.ship.id };
  if (units(actor, 'phasers') > 0 && target.range <= 30) return { type: 'phasers', targetId: target.ship.id };
  if (units(actor, 'tractor') > 0 && target.range <= 35) return { type: 'tractor', targetId: target.ship.id };
  if (units(actor, 'engines') > 0 && !actor.tractorBy) {
    // Sitting on the target: hold position so the collision resolves.
    if (target.range < 1) return { type: 'move', dx: 0, dy: 0 };
    // Ruthless pursuit, clumsy navigation: seeded overshoot and drift so fleets
    // converge imperfectly and sometimes collide.
    const rng = createRng(`${game.seed}:${shipId}:${game.randomStep ?? 0}`);
    const deltaX = target.ship.x - actor.x;
    const deltaY = target.ship.y - actor.y;
    const capacity = units(actor, 'engines') * 10;
    const magnitude = Math.min(capacity, Math.max(1, target.range - 8) * (0.8 + rng.next() * 0.5));
    const angle = Math.atan2(deltaY, deltaX) + (rng.next() - 0.5) * 0.3;
    return {
      type: 'move',
      dx: Math.round(Math.cos(angle) * magnitude),
      dy: Math.round(Math.sin(angle) * magnitude),
    };
  }
  return { type: 'pass' };
};
