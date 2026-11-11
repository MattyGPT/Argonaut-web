import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVE, STARTING_FORMATIONS, FACTIONS, REIMAGINED_GRID_SIZE } from '../game/constants.js';
import { createGame, engineCapacity, getShip, movementCapacity, powerEffect } from '../game/state.js';

const ORDER = Object.values(FACTIONS);

test('the deployment rotation is seeded, varied, and classic-free', () => {
  const seen = new Set();
  for (let index = 0; index < 40; index += 1) {
    const seed = `sim-${index}`;
    const game = createGame({ seed, reimagined: true });
    assert.equal(game.deployment, createGame({ seed, reimagined: true }).deployment, 'the draw is seeded');
    assert.equal(createGame({ seed, reimagined: true, realtime: true }).deployment, game.deployment, 'and mode-symmetric');
    seen.add(game.deployment);
    assert.equal(createGame({ seed }).deployment, 0, 'a classic war never rotates');
  }
  assert.equal(seen.size, 4, `all four sector rotations appear across 40 seeds (saw ${[...seen].sort()})`);
});

test('a rotated regional war opens each alliance in its rotated corner sector', () => {
  const seed = [...Array(40).keys()].map((i) => `sim-${i}`).find((s) => createGame({ seed: s, reimagined: true }).deployment === 1);
  assert.ok(seed, 'a seed with rotation 1');
  const game = createGame({ seed, reimagined: true, regional: true });
  const scale = REIMAGINED_GRID_SIZE / 100;
  for (const faction of game.loadout.factions) {
    const region = STARTING_FORMATIONS[ORDER[(ORDER.indexOf(faction) + 1) % ORDER.length]];
    const bounds = {
      x: [region.x[0] * scale - 1, region.x[1] * scale + 1],
      y: [region.y[0] * scale - 1, region.y[1] * scale + 1],
    };
    const hulls = game.ships.filter((ship) => ship.faction === faction && ship.className !== 'Starbase');
    assert.ok(hulls.length > 0, `${faction} fielded hulls`);
    for (const ship of hulls) {
      assert.ok(ship.x >= bounds.x[0] && ship.x <= bounds.x[1] && ship.y >= bounds.y[0] && ship.y <= bounds.y[1],
        `${ship.id} opens inside its rotated sector`);
    }
  }
});

test('scatter stays the default; regional is the opt-in; pins win', () => {
  assert.equal(createGame({ seed: 'deploy-default', reimagined: true }).regional, false, 'scatter is the calibrated default');
  assert.equal(createGame({ seed: 'deploy-default', reimagined: true, realtime: true }).regional, false);
  assert.equal(createGame({ seed: 'deploy-default' }).regional, false);
  assert.equal(createGame({ seed: 'deploy-default', reimagined: true, regional: true }).regional, true);
  assert.equal(createGame({ seed: 'deploy-default', regional: true }).regional, true);
});

test('the engine scale cap is a dial and ships null today', () => {
  assert.equal(MOVE.scaleCap, null, 'the cap ships uncapped; the regional opening was the melee engine');
  const game = createGame({ seed: 'deploy-cap', reimagined: true });
  const cruiser = getShip(game, 'fed-cruiser-1');
  assert.equal(movementCapacity(game, cruiser),
    engineCapacity(cruiser, REIMAGINED_GRID_SIZE, powerEffect(game, cruiser, 'engines')), 'uncapped Reimagined burn');
  assert.equal(engineCapacity(cruiser, REIMAGINED_GRID_SIZE, 1, 2), 80, 'the cap bounds the factor when set');
  const classic = createGame({ seed: 'deploy-cap' });
  assert.equal(movementCapacity(classic, getShip(classic, 'fed-cruiser-1')), 40, 'classic burn is untouched');
});
