import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { enableBattleRecords } from '../game/battle-records.js';
import { createWalkthrough, advanceWalkthrough, walkthroughMarkup } from '../ui/walkthrough.js';

const fixture = (options = {}) => enableBattleRecords(createGame({ seed: 'walkthrough', ...options }), { battleId: 'walk-test' });
const progressToOrder = (game) => {
  let state = advanceWalkthrough(createWalkthrough(game), { type: 'start', paused: true }, game);
  state = advanceWalkthrough(state, { type: 'locate', shipId: game.playerShipId }, game);
  return advanceWalkthrough(state, { type: 'inspect', shipId: game.playerShipId }, game);
};

test('hints are optional, dismissal survives reconstruction, and restart is explicit', () => {
  const game = fixture();
  let state = createWalkthrough(game);
  assert.equal(state.stage, 'idle');
  assert.match(walkthroughMarkup(state, game), /Start first-order hints/);
  const action = applyPlayerAction(game, { type: 'pass' });
  assert.equal(advanceWalkthrough(state, { type: 'records', records: action.records }, game), state);
  state = advanceWalkthrough(state, { type: 'dismiss' }, game);
  assert.equal(state.dismissed, true);
  assert.equal(createWalkthrough(game, { dismissed: state.dismissed }).stage, 'dismissed');
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(advanceWalkthrough(restored, { type: 'records', records: action.records }, game), restored);
  assert.equal(advanceWalkthrough(restored, { type: 'restart' }, game).stage, 'locate');
});

test('real time introduces actual pause and readiness before locating the ship', () => {
  const game = fixture({ reimagined: true, realtime: true });
  let state = advanceWalkthrough(createWalkthrough(game), { type: 'start' }, game);
  assert.equal(state.stage, 'pause-readiness');
  assert.match(walkthroughMarkup(state, game), /simulation time/);
  assert.equal(advanceWalkthrough(state, { type: 'pause', paused: false }, game), state);
  assert.equal(advanceWalkthrough(state, { type: 'locate', shipId: game.playerShipId }, game), state);
  state = advanceWalkthrough(state, { type: 'pause', paused: true }, game);
  assert.equal(state.stage, 'locate');
  assert.equal(advanceWalkthrough(createWalkthrough(game), { type: 'start', paused: true }, game).stage, 'locate');
});

test('locate and inspection adapt to the actual command ship and allow a target menu', () => {
  const game = fixture({ reimagined: true });
  let state = advanceWalkthrough(createWalkthrough(game), { type: 'start' }, game);
  assert.equal(advanceWalkthrough(state, { type: 'locate', shipId: 'wrong' }, game), state);
  state = advanceWalkthrough(state, { type: 'locate', shipId: game.playerShipId }, game);
  assert.equal(state.stage, 'inspect');
  assert.equal(advanceWalkthrough(state, { type: 'inspect', shipId: 'absent' }, game), state);
  assert.equal(advanceWalkthrough(state, { type: 'inspect', shipId: 'axis-flagship' }, game).stage, 'order');
  const transferred = { ...game, playerShipId: 'fed-cruiser-1' };
  state = advanceWalkthrough(state, { type: 'refresh' }, transferred);
  assert.equal(state.stage, 'locate');
  assert.equal(state.shipId, transferred.playerShipId);
  assert.match(walkthroughMarkup(state, transferred), new RegExp(getShip(transferred, transferred.playerShipId).name));
});

test('a real accepted movement or alternate order advances; refused and automatic commands do not', () => {
  for (const options of [{}, { reimagined: true }, { reimagined: true, realtime: true }]) {
    const game = fixture(options);
    const before = structuredClone(game);
    const state = progressToOrder(game);
    assert.equal(state.stage, 'order');
    const refused = applyPlayerAction(game, { type: 'phasers', targetId: game.playerShipId });
    assert.equal(advanceWalkthrough(state, { type: 'records', records: refused.records }, game), state);
    for (const command of [{ type: 'move', dx: 1, dy: 0 }, { type: 'pass' }]) {
      const accepted = applyPlayerAction(game, command);
      const automated = accepted.records.map((record) => ({ ...record, source: 'auto-conn' }));
      assert.equal(advanceWalkthrough(state, { type: 'records', records: automated }, accepted.game), state);
      const next = advanceWalkthrough(state, { type: 'records', records: accepted.records }, accepted.game);
      assert.equal(next.stage, 'result');
      assert.equal(next.command, command.type);
      assert.equal(next.confirmed, true);
      assert.equal(advanceWalkthrough(next, { type: 'inspect-result' }, accepted.game), next);
      assert.equal(advanceWalkthrough(next, { type: 'inspect-result', actionId: 'another-order' }, accepted.game), next);
      assert.equal(advanceWalkthrough(next, { type: 'inspect-result', actionId: next.actionId }, accepted.game).stage, 'complete');
    }
    assert.deepEqual(game, before);
  }
});

test('a pending result stays associated with its original action through a command transfer', () => {
  const game = fixture({ reimagined: true, realtime: true });
  const state = progressToOrder(game);
  const accepted = applyPlayerAction(game, { type: 'move', dx: 1, dy: 0 });
  const action = accepted.records.find((record) => record.kind === 'action');
  let next = advanceWalkthrough(state, { type: 'records', records: [action] }, game);
  assert.equal(next.stage, 'result');
  assert.equal(next.confirmed, false);
  assert.doesNotMatch(walkthroughMarkup(next, game), /Inspect my latest result/);
  assert.equal(advanceWalkthrough(next, { type: 'inspect-result', actionId: next.actionId }, game), next);
  const changed = { ...accepted.game, playerShipId: 'fed-cruiser-1' };
  next = advanceWalkthrough(next, { type: 'records', records: accepted.records.slice(1) }, changed);
  assert.equal(next.actionId, action.actionId);
  assert.equal(next.issuerId, action.actorId);
  assert.equal(next.confirmed, true);
  assert.equal(next.stage, 'result');
});

test('no-target openings teach movement, battle end stops hints, and new battle identities reset progress', () => {
  let game = fixture({ reimagined: true });
  const own = getShip(game, game.playerShipId);
  game = { ...game, ships: game.ships.map((ship) => ship.id === own.id ? { ...ship, x: 10, y: 10 } : { ...ship, x: 200, y: 200 }) };
  let state = advanceWalkthrough(createWalkthrough(game), { type: 'start' }, game);
  state = advanceWalkthrough(state, { type: 'locate', shipId: game.playerShipId }, game);
  assert.match(walkthroughMarkup(state, game), /Movement works even when no enemy is in weapon range/);
  const ended = { ...game, outcome: { kind: 'victory' } };
  state = advanceWalkthrough(state, { type: 'refresh' }, ended);
  assert.equal(state.stage, 'ended');
  assert.match(walkthroughMarkup(state, ended), /battle has ended/);
  const another = { ...game, battleRecordState: { ...game.battleRecordState, battleId: 'another-battle' } };
  assert.equal(advanceWalkthrough(state, { type: 'refresh' }, another).stage, 'idle');
  assert.equal(advanceWalkthrough(state, { type: 'refresh' }, another).actionId, null);
});

test('markup escapes ship labels and showing hints leaves gameplay and RNG identical', () => {
  const game = fixture({ reimagined: true, realtime: true });
  const malicious = { ...game, ships: game.ships.map((ship) => ship.id === game.playerShipId ? { ...ship, name: '<img src=x onerror=alert(1)>' } : ship) };
  const state = advanceWalkthrough(createWalkthrough(malicious), { type: 'start', paused: true }, malicious);
  const markup = walkthroughMarkup(state, malicious);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img/);
  const command = { type: 'move', dx: 1, dy: 0 };
  const plain = applyPlayerAction(game, command);
  walkthroughMarkup(progressToOrder(game), game);
  const hinted = applyPlayerAction(game, command);
  assert.deepEqual(hinted, plain);
});
