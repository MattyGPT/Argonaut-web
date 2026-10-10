import { tractorLock } from '../game/actions.js';
import { maintainedTowMove } from '../game/maintained-tow.js';
import { RANGES } from '../game/constants.js';
import { distance, getShip, isActive, powerEffect } from '../game/state.js';

export const isRescueTowTarget = (game, targetId) => {
  if (!game?.operation || !game.reimagined || game.realtime || targetId !== game.operation.targetId) return false;
  const actor = getShip(game, game.playerShipId), target = getShip(game, targetId);
  return isActive(actor) && isActive(target) && actor.id !== target.id && target.faction === actor.faction;
};

/** Turn-based preview using the resolver's rounded landing point. The caller
 * supplies only currently known hulls; the preview cannot disclose hidden ones. */
export const rescueTowPreview = (game, targetId, destination, knownShips) => {
  const actor = getShip(game, game.playerShipId), target = getShip(game, targetId);
  if (!actor || !target || !Number.isFinite(destination?.x) || !Number.isFinite(destination?.y)) return { text: 'Choose a destination for this pull.', collision: false };
  const grid = game.gridSize;
  const aim = { x: Math.max(0, Math.min(grid, Math.round(destination.x))), y: Math.max(0, Math.min(grid, Math.round(destination.y))) };
  const { position, pull } = tractorLock(actor, target, grid, aim, powerEffect(game, actor, 'tractor'));
  const collisions = knownShips.filter((ship) => ship.id !== target.id && isActive(ship) && distance(position, ship) < 1);
  const afterRange = distance(actor, position);
  const asteroid = game.terrain.some((feature) => feature.type === 'asteroids' && distance(position, feature) <= feature.radius);
  const lines = [`This pull moves ${target.name} to ${position.x}, ${position.y} (up to ${Number(pull.toFixed(1))} units).`];
  if (collisions.length) lines.push(`Collision warning: that landing overlaps ${collisions.map((ship) => ship.name).join(', ')}. Change the destination or move your ship before towing.`);
  if (asteroid) lines.push('The landing is inside an asteroid field and risks rock damage.');
  if (afterRange > RANGES.tractor) lines.push(`After this pull the range will be ${afterRange.toFixed(1)}; reposition within ${RANGES.tractor} before pulling again.`);
  else lines.push(`Range after the pull: ${afterRange.toFixed(1)} / ${RANGES.tractor}.`);
  if (game.operation.elapsed >= game.operation.deadline && game.operation.primary === 'pending') lines.push(`Late rescue remains possible through elapsed ${game.operation.withdrawalDeadline}.`);
  if (game.operation.primary === 'expired') lines.push('The final rescue deadline has passed.');
  return { position, text: lines.join(' '), collision: collisions.length > 0 };
};

export const maintainedMovePreview = (game, dx, dy) => {
  const plan = maintainedTowMove(game, dx, dy, { course: game.realtime });
  if (!plan) return '';
  if (!plan.tugEnd) return plan.error;
  const point = (p) => `${Number(p.x.toFixed(1))}, ${Number(p.y.toFixed(1))}`;
  const op = game.operation;
  const evacuating = op && !plan.error && [plan.tugEnd, plan.targetEnd].some((ship) => distance(ship, op.exit) <= op.exit.radius);
  const evacuation = evacuating ? ` Both ships will evacuate together after combat if the tow remains intact.${plan.target.id === op.targetId && op.primary === 'pending' && op.elapsed + 1 > op.deadline ? ' This is a late rescue.' : ''}` : '';
  return `${plan.tug.name} → ${point(plan.tugEnd)}; ${plan.target.name} → ${point(plan.targetEnd)}. ${plan.error || `Tow speed ${Number(plan.speed.toFixed(1))} units/stardate.`}${plan.rocks ? ' Asteroid exposure at arrival.' : ''}${evacuation}`;
};
