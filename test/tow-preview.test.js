import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerAction } from '../game/actions.js';
import { createOperationGame } from '../game/operations.js';
import { getShip } from '../game/state.js';
import { isRescueTowTarget, maintainedMovePreview, rescueTowPreview } from '../ui/tow-preview.js';

const fresh = () => {
  const game = createOperationGame();
  return { ...game, terrain: [], ships: game.ships.map((ship) => ship.id === game.playerShipId ? { ...ship, x: 135, y: 140 } : ship) };
};

test('rescue destination preview matches actual directed pulls without mutating state or RNG', () => {
  for (const tractorPower of [0, 2, 5]) for (const destination of [{ x: 38, y: 160 }, { x: -2.5, y: 999 }, { x: 142.6, y: 157.2 }]) {
    let game = fresh();
    game = { ...game, ships: game.ships.map((ship) => ship.id === game.playerShipId ? { ...ship, power: { ...ship.power, tractor: tractorPower } } : ship) };
    const before = JSON.stringify(game);
    const preview = rescueTowPreview(game, 'op-sentinel', destination, game.ships);
    assert.equal(JSON.stringify(game), before);
    const result = applyPlayerAction(game, { type: 'tractor', targetId: 'op-sentinel', towardX: destination.x, towardY: destination.y });
    assert.notStrictEqual(result.game, game);
    const target = getShip(result.game, 'op-sentinel');
    assert.deepEqual(preview.position, { x: target.x, y: target.y });
    assert.equal(preview.collision, false);
  }
});

test('warns about the command ship at the landing, but never reveals an unknown hull', () => {
  let game = fresh();
  game = { ...game, ships: game.ships.map((ship) => ship.id === game.playerShipId ? { ...ship, x: 140, y: 160 } : ship) };
  const actor = getShip(game, game.playerShipId);
  const target = getShip(game, 'op-sentinel');
  const preview = rescueTowPreview(game, target.id, actor, [actor, target]);
  assert.equal(preview.collision, true);
  assert.match(preview.text, /Collision warning.*Argonaut/);
  const hidden = rescueTowPreview(game, target.id, actor, [target]);
  assert.equal(hidden.collision, false);
  assert.doesNotMatch(hidden.text, /Argonaut/);
  assert.equal(rescueTowPreview(game, target.id, actor, [{ ...actor, status: 'destroyed' }]).collision, false);
});

test('explains range loss, rock exposure and an expired objective without predicting enemy turns', () => {
  let game = fresh();
  game = { ...game, operation: { ...game.operation, primary: 'expired' }, terrain: [{ type: 'asteroids', x: 165, y: 160, radius: 10 }] };
  const preview = rescueTowPreview(game, 'op-sentinel', { x: 300, y: 160 }, game.ships);
  assert.match(preview.text, /asteroid field/);
  assert.match(preview.text, /reposition within 35/);
  assert.match(preview.text, /deadline has passed/);
  assert.deepEqual(rescueTowPreview(game, 'op-sentinel', null, game.ships), { text: 'Choose a destination for this pull.', collision: false });
});

test('rescue control applies only to the active allied objective in the turn-based operation', () => {
  const game = fresh();
  assert.equal(isRescueTowTarget(game, 'op-sentinel'), true);
  for (const changed of [
    { ...game, operation: null }, { ...game, reimagined: false }, { ...game, realtime: true },
    { ...game, ships: [] }, { ...game, playerShipId: 'op-sentinel' },
    { ...game, ships: game.ships.map((ship) => ship.id === 'op-sentinel' ? { ...ship, status: 'destroyed' } : ship) },
    { ...game, ships: game.ships.map((ship) => ship.id === 'op-sentinel' ? { ...ship, faction: 'Axis' } : ship) },
  ]) assert.equal(isRescueTowTarget(changed, 'op-sentinel'), false);
  assert.equal(isRescueTowTarget(game, 'op-guard'), false);
});

test('maintained movement predicts linked evacuation even when the passenger trails outside the ring', () => {
  let game = fresh();
  game = { ...game, ships: game.ships.map((ship) => ship.id === game.playerShipId ? { ...ship, x: 58, y: 160 }
    : ship.id === 'op-sentinel' ? { ...ship, x: 85, y: 160 } : ship) };
  game = applyPlayerAction(game, { type: 'tow-start', targetId: 'op-sentinel' }).game;
  game = { ...game, operation: { ...game.operation, elapsed: 17 } };
  const before = JSON.stringify(game);
  assert.match(maintainedMovePreview(game, -8, 0), /Sentinel → 77, 160.*Both ships will evacuate together.*late rescue/);
  assert.doesNotMatch(maintainedMovePreview(game, 0, 0), /will evacuate/);
  assert.equal(JSON.stringify(game), before);
});
