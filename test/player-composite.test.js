import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerAction } from '../game/actions.js';
import { MANEUVER } from '../game/constants.js';
import { createGame, getShip, volleyMissChance } from '../game/state.js';
import { resolveComputerTurns } from '../game/turns.js';

const stage = () => {
  const game = createGame({ seed: 'player-composite', reimagined: true });
  return {
    ...game,
    terrain: [],
    ships: game.ships.map((ship) => {
      if (ship.id === game.playerShipId) return { ...ship, x: 100, y: 100 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 120, y: 100 };
      return { ...ship, x: 300, y: 300 };
    }),
  };
};

test('a maneuver opens a volley window; the volley spends the stardate', () => {
  const moved = applyPlayerAction(stage(), { type: 'move', dx: 5, dy: 0 });
  assert.equal(moved.game.phase, 'player', 'the volley window stays open after the burn');
  assert.deepEqual(moved.game.playerActed, { move: true, volley: false });
  const both = applyPlayerAction(moved.game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(both.game.phase, 'computer', 'the volley spends what is left of the stardate');

  // Firing first keeps the old one-command rhythm exactly.
  const volley = applyPlayerAction(stage(), { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(volley.game.phase, 'computer');
  const moveAfter = applyPlayerAction(volley.game, { type: 'move', dx: 5, dy: 0 });
  assert.equal(moveAfter.game, volley.game, 'no maneuver follows a volley');
  assert.match(moveAfter.messages.join(' '), /Wait for the player turn/);
});

test('a maneuver with nothing in gun reach ends the stardate as it always has', () => {
  const far = {
    ...stage(),
    ships: stage().ships.map((ship) => (ship.id === 'axis-flagship' ? { ...ship, x: 250, y: 250 } : ship)),
  };
  const moved = applyPlayerAction(far, { type: 'move', dx: 5, dy: 0 });
  assert.equal(moved.game.phase, 'computer', 'no volley available, no window opened');
  assert.equal(moved.game.playerActed, undefined);
});

test('a spent maneuver slot refuses a second burn, and pass ends the window', () => {
  const moved = applyPlayerAction(stage(), { type: 'move', dx: 5, dy: 0 });
  const again = applyPlayerAction(moved.game, { type: 'move', dx: 5, dy: 0 });
  assert.equal(again.game, moved.game, 'the second maneuver is refused');
  assert.match(again.messages.join(' '), /already maneuvered/);
  const passed = applyPlayerAction(moved.game, { type: 'pass' });
  assert.equal(passed.game.phase, 'computer', 'pass closes the window without a volley');
});

test('other commands still spend the stardate outright', () => {
  const passed = applyPlayerAction(stage(), { type: 'pass' });
  assert.equal(passed.game.phase, 'computer');
  assert.deepEqual(passed.game.playerActed ?? { move: false, volley: false }, { move: false, volley: false });
});

test('the boundary resets the slots', () => {
  const moved = applyPlayerAction(stage(), { type: 'move', dx: 5, dy: 0 });
  const both = applyPlayerAction(moved.game, { type: 'phasers', targetId: 'axis-flagship' });
  const next = resolveComputerTurns(both.game);
  assert.deepEqual(next.playerActed, { move: false, volley: false });
  assert.equal(next.phase, 'player');
});

test('a volley after a maneuver pays the composite miss, evasive excepted', () => {
  const game = stage();
  const shooter = getShip(game, game.playerShipId);
  const target = getShip(game, 'axis-flagship');
  const still = volleyMissChance(game, shooter, target);
  const maneuvering = volleyMissChance(game, { ...shooter, maneuvered: true }, target);
  assert.ok(Math.abs(maneuvering - still - MANEUVER.compositeMiss) < 1e-9, 'the composite term prices the moving shot');
  const evasive = { ...game, stances: { [shooter.id]: 'evasive' } };
  assert.equal(volleyMissChance(evasive, { ...shooter, maneuvered: true }, target),
    volleyMissChance(evasive, shooter, target), 'an evasive hull pays no composite miss');
  const firing = { ...game, stances: { [shooter.id]: 'firing' } };
  assert.equal(volleyMissChance(firing, { ...shooter, maneuvered: true }, target),
    volleyMissChance(game, { ...shooter, maneuvered: true }, target),
    'a firing hull loses its aim bonus on the move');
});
