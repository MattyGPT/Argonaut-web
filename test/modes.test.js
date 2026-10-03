import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, orderFor, pendingOrderFor, vendettaGrudge } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { resolveAutopilotTurn, resolveComputerTurns } from '../game/turns.js';
import { createCampaign, nodeById, startNodeBattle, travelTo } from '../game/campaign.js';

test('Classic and precision-only Classic keep expansion capabilities unavailable', () => {
  for (const precision of [false, true]) {
    const game = createGame({ seed: 'mode-classic', precision, scenario: 'defend-xanadu', loadout: { xanadu: false } });
    assert.equal(game.reimagined, false);
    assert.equal(game.precision, precision);
    assert.equal(game.gridSize, 100);
    assert.equal(game.ships.length, 21);
    assert.equal(game.scenario, 'annihilation');
    assert.ok(getShip(game, 'xanadu'));
    const forgedOrders = { ...game, orders: { 'fed-scout': { type: 'hold' } }, pendingOrders: { 'fed-scout': { type: 'withdraw' } } };
    assert.equal(orderFor(forgedOrders, 'fed-scout'), null);
    assert.equal(pendingOrderFor(forgedOrders, 'fed-scout'), null);
    assert.equal(vendettaGrudge(game, { ...getShip(game, game.vendettaShipId), kills: 9 }, getShip(game, game.playerShipId)), 0);
    assert.match(applyPlayerAction(game, { type: 'orders', shipId: 'fed-scout', order: { type: 'hold' } }).messages.join(' '), /Reimagined/);
    assert.deepEqual(createGame({ seed: 'mode-classic', precision }).ships, game.ships);
  }
});

test('Reimagined and real time derive fleet capabilities directly from their ruleset', () => {
  for (const options of [{ reimagined: true }, { realtime: true }]) {
    const game = createGame({ seed: 'mode-fleet', ...options });
    assert.equal(game.reimagined, true);
    assert.ok(getShip(game, game.playerShipId).systems.reactor > 0);
    const ordered = applyPlayerAction(game, { type: 'orders', shipId: game.playerShipId, order: { type: 'hold' } }).game;
    assert.deepEqual(orderFor(ordered, game.playerShipId), { type: 'hold', targetId: null });
    assert.equal(ordered.phase, 'player');
    const pending = { ...game, pendingOrders: { [game.playerShipId]: { type: 'withdraw' } } };
    assert.deepEqual(pendingOrderFor(pending, game.playerShipId), { type: 'withdraw' });
  }
});

test('Reimagined objectives preserve optional Xanadu eligibility', () => {
  const optional = createGame({ seed: 'mode-base', reimagined: true, loadout: { xanadu: false } });
  assert.equal(getShip(optional, 'xanadu'), undefined);
  const defended = createGame({ seed: 'mode-base', reimagined: true, scenario: 'defend-xanadu', loadout: { xanadu: false } });
  assert.equal(defended.scenario, 'defend-xanadu');
  assert.ok(getShip(defended, 'xanadu'));
  const hunt = createGame({ seed: 'mode-base', reimagined: true, scenario: 'hunt-the-vendetta', loadout: { xanadu: false } });
  assert.equal(getShip(hunt, 'xanadu'), undefined);
  assert.equal(hunt.objectiveShipId, hunt.vendettaShipId);
});

test('campaign muster and node battles use Reimagined fleet capabilities', () => {
  const campaign = createCampaign({ seed: 'nb-1' });
  assert.ok(campaign.fleet.every((ship) => ship.systems.reactor > 0));
  const nodeId = nodeById(campaign.sector, 'home').next.find((id) => nodeById(campaign.sector, id).owner !== 'Federation');
  assert.ok(nodeId);
  const started = startNodeBattle(travelTo(campaign, nodeId), nodeId);
  const game = started.battle.game;
  assert.equal(game.reimagined, true);
  const ordered = applyPlayerAction(game, { type: 'orders', shipId: game.playerShipId, order: { type: 'hold' } }).game;
  assert.deepEqual(orderFor(ordered, game.playerShipId), { type: 'hold', targetId: null });
  const restored = JSON.parse(JSON.stringify(started));
  assert.deepEqual(restored, started);
  assert.deepEqual(resolveComputerTurns(resolveAutopilotTurn(restored.battle.game).game), resolveComputerTurns(resolveAutopilotTurn(game).game));
});

test('supported game states serialize and resume with identical next-turn outcomes', () => {
  for (const options of [{}, { precision: true }, { reimagined: true }, { realtime: true }]) {
    const game = resolveComputerTurns(resolveAutopilotTurn(createGame({ seed: 'mode-resume', ...options })).game);
    const restored = JSON.parse(JSON.stringify(game));
    assert.deepEqual(restored, game);
    assert.deepEqual(resolveComputerTurns(resolveAutopilotTurn(restored).game), resolveComputerTurns(resolveAutopilotTurn(game).game));
  }
});
