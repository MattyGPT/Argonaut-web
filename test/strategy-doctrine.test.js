import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAiAction } from '../game/ai.js';
import { RANGES, STRATEGY } from '../game/constants.js';
import { createGame, distance, strategyFor } from '../game/state.js';
import { resolveAutopilotTurn, resolveComputerTurns } from '../game/turns.js';

const IDS = ['battle', 'relays', 'raid'];
const step = (game) => resolveComputerTurns(resolveAutopilotTurn(game).game);
const relaysOf = (game) => game.terrain.filter((feature) => feature.type === 'relay');
const findGame = (predicate, limit = 80) => {
  for (let index = 0; index < limit; index += 1) {
    const game = createGame({ seed: `sim-${index}`, reimagined: true });
    if (predicate(game)) return game;
  }
  return assert.fail('no seed matched within the search window');
};
const relaysFaction = (game) => Object.entries(game.strategies).find(([, id]) => id === 'relays')?.[0] ?? null;

test('strategies are drawn per alliance on their own stream, and classic reads battle', () => {
  let relaysDraws = 0;
  let raidDraws = 0;
  for (let index = 0; index < 40; index += 1) {
    const seed = `sim-${index}`;
    const game = createGame({ seed, reimagined: true });
    assert.deepEqual(createGame({ seed, reimagined: true }).strategies, game.strategies, 'the draw is seeded');
    assert.deepEqual(createGame({ seed, reimagined: true, realtime: true }).strategies, game.strategies, 'the draw is mode-symmetric');
    assert.deepEqual(Object.keys(game.strategies).sort(), [...game.loadout.factions].sort(), 'only the fighting alliances draw');
    for (const id of Object.values(game.strategies)) {
      assert.ok(IDS.includes(id), id);
      if (id === 'relays') relaysDraws += 1;
      if (id === 'raid') raidDraws += 1;
    }
    const classic = createGame({ seed });
    assert.equal(classic.strategies, null, 'a classic war never draws');
    assert.equal(strategyFor(classic, 'Axis'), 'battle');
    assert.equal(strategyFor({ reimagined: true }, 'Axis'), 'battle', 'an old save without the field reads battle');
  }
  assert.ok(relaysDraws > 0 && raidDraws > 0, `both new strategies appear across 40 seeds (relays ${relaysDraws}, raid ${raidDraws})`);
});

test('an alliance on the relays strategy posts garrisons inside the nodes', () => {
  const seeds = [];
  for (let index = 0; seeds.length < 6 && index < 80; index += 1) {
    if (relaysFaction(createGame({ seed: `sim-${index}`, reimagined: true }))) seeds.push(`sim-${index}`);
  }
  let posted = 0;
  for (const seed of seeds) {
    let game = createGame({ seed, reimagined: true });
    const faction = relaysFaction(game);
    let reachedAt = 0;
    for (let turn = 0; turn < 24 && !game.outcome && !reachedAt; turn += 1) {
      game = step(game);
      const inside = relaysOf(game).some((node) => game.held?.[node.id] === faction
        || game.ships.some((ship) => ship.status === 'active' && ship.faction === faction && distance(ship, node) <= node.radius));
      if (inside) reachedAt = game.turn;
    }
    if (reachedAt) posted += 1;
  }
  assert.ok(posted >= 4, `garrisons posted inside a node in ${posted} of ${seeds.length} relays wars`);
});

test('a garrison hull inside its node holds station when nothing is in its guns', () => {
  for (let index = 0; index < 40; index += 1) {
    let game = createGame({ seed: `sim-${index}`, reimagined: true });
    const faction = relaysFaction(game);
    if (!faction) continue;
    let posted = null;
    for (let turn = 0; turn < 14 && !game.outcome && !posted; turn += 1) {
      game = step(game);
      posted = game.ships.find((ship) => ship.status === 'active' && ship.faction === faction
        && relaysOf(game).some((node) => distance(ship, node) <= node.radius * STRATEGY.postFraction + 2)) ?? null;
    }
    if (!posted) continue;
    const contested = game.ships.some((ship) => ship.status === 'active' && ship.faction !== faction && distance(ship, posted) <= RANGES.tractor);
    if (contested) continue;
    assert.equal(chooseAiAction(game, posted.id).type, 'pass', `${posted.id} holds its quiet post`);
    return;
  }
  return assert.fail('no relays war produced a quiet garrison post to assert on');
});

test('committed contesters meet the garrison inside the node it holds', () => {
  let witnessed = 0;
  let wars = 0;
  for (let index = 0; wars < 6 && index < 80; index += 1) {
    let game = createGame({ seed: `sim-${index}`, reimagined: true });
    const faction = relaysFaction(game);
    if (!faction) continue;
    wars += 1;
    let seen = false;
    for (let turn = 0; turn < 24 && !game.outcome && !seen; turn += 1) {
      game = step(game);
      seen = relaysOf(game).some((node) => {
        const inside = game.ships.some((ship) => ship.status === 'active' && ship.faction === faction && distance(ship, node) <= node.radius);
        const attacking = game.ships.some((ship) => ship.status === 'active' && ship.faction !== faction && distance(ship, node) <= node.radius + RANGES.phasers);
        return inside && attacking;
      });
    }
    if (seen) witnessed += 1;
  }
  assert.ok(witnessed >= 4, `node battles witnessed in ${witnessed} of ${wars} relays wars`);
});

test('a raiding alliance converges on the enemy base instead of the fleet', () => {
  const game0 = findGame((game) => game.ships.some((ship) => ship.id === 'xanadu')
    && Object.entries(game.strategies).some(([faction, id]) => id === 'raid' && faction !== 'Federation'));
  const faction = Object.entries(game0.strategies).find(([f, id]) => id === 'raid' && f !== 'Federation')[0];
  const openingShields = game0.ships.find((ship) => ship.id === 'xanadu').shields;
  const closest = (game) => {
    const base = game.ships.find((ship) => ship.id === 'xanadu');
    return Math.min(...game.ships.filter((ship) => ship.status === 'active' && ship.faction === faction).map((ship) => distance(ship, base)));
  };
  const opening = closest(game0);
  let game = game0;
  for (let turn = 0; turn < 8 && !game.outcome; turn += 1) game = step(game);
  const base = game.ships.find((ship) => ship.id === 'xanadu');
  const besieged = base.shields < openingShields
    || game.ships.some((ship) => ship.status === 'active' && ship.faction === faction && distance(ship, base) <= RANGES.phasers);
  assert.ok(closest(game) < opening - 40 || besieged, `the ${faction} raid closed ${opening.toFixed(0)} -> ${closest(game).toFixed(0)}`);
});
