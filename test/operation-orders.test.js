import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerAction, maneuverTo } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { createGame, getShip, maintainedTowPair, maintainedTowPairs, movementCapacity } from '../game/state.js';
import { createOperationGame, OPERATION_SEEDS, validOperationSave } from '../game/operations.js';
import { rescueDecision, updateRescueReports } from '../game/operation-orders.js';
import { resolveComputerTurns } from '../game/turns.js';
import { operationPanelMarkup } from '../ui/operations.js';
import { reconcileMaintainedTow } from '../game/maintained-tow.js';
import { appendRecords, createJournal, formatJournalEvent, restoreJournal } from '../ui/battle-journal.js';

const fresh = (seed = 'rescue-1') => createOperationGame({ seed, battleId: `delegation:${seed}` });
const edit = (game, id, patch) => ({ ...game, ships: game.ships.map((s) => s.id === id ? { ...s, ...patch } : s) });
const command = (game, action, records = []) => {
  const out = applyPlayerAction(game, action);
  assert.notEqual(out.game, game, out.messages?.join(' '));
  records.push(...out.records);
  return out.game.phase === 'computer' ? resolveComputerTurns(out.game, { onRecords: (batch) => records.push(...batch) }) : out.game;
};
const assign = (game, shipId = 'op-escort') => command(game, { type: 'orders', shipId, order: { type: 'rescue' } });
const play = (seed, shipId, reload = false) => {
  let game = assign(fresh(seed), shipId);
  const records = [];
  for (let guard = 0; guard < 24 && !game.operation.result; guard++) {
    if (reload) game = JSON.parse(JSON.stringify(game));
    const previous = maintainedTowPair(game, shipId);
    const action = game.operation.primary === 'pending' ? { type: 'pass' } : { type: 'move', ...maneuverTo(game, 38, 160) };
    const before = game;
    game = command(game, action, records);
    const after = getShip(game, shipId);
    if (previous && after) assert.ok(Math.hypot(after.x - previous.tug.x, after.y - previous.tug.y) <= movementCapacity(before, previous.tug) + 1e-7);
  }
  return { game, records };
};

test('both available fleet captains rescue all six seeds with normal actions and reload parity', () => {
  for (const seed of OPERATION_SEEDS) for (const shipId of ['op-escort', 'op-scout']) {
    const { game, records } = play(seed, shipId);
    assert.equal(game.operation.result?.primary, 'success', `${seed}/${shipId}: ${JSON.stringify(game.operation.rescueReports)}`);
    assert.equal(game.operation.rescueReports[shipId].phase, 'completed');
    assert.equal(game.operation.extracted.length, 4);
    assert.ok(game.operation.assists[shipId] > 0);
    assert.equal(maintainedTowPairs(game).length, 0);
    assert.equal(records.filter((r) => r.kind === 'maintained-tow-started').length, 1);
    assert.deepEqual(play(seed, shipId, true).game, game);
  }
});

test('Rescue is operation-only, requires another equipped captain and reserves one assignment', () => {
  for (const game of [createGame({ seed: 'scope' }), createGame({ seed: 'scope', reimagined: true }), { ...fresh(), realtime: true }]) {
    const result = applyPlayerAction(game, { type: 'orders', shipId: game.ships.find((s) => s.faction === 'Federation' && s.id !== game.playerShipId)?.id, order: { type: 'rescue' } });
    assert.equal(result.game, game);
  }
  const game = fresh();
  assert.equal(applyPlayerAction(game, { type: 'orders', shipId: game.playerShipId, order: { type: 'rescue' } }).game, game);
  const assigned = assign(game);
  assert.equal(applyPlayerAction(assigned, { type: 'orders', shipId: 'op-scout', order: { type: 'rescue' } }).game, assigned);
});

test('connection spends a separate captain action before hauling; replacement releases only its own link', () => {
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  const initial = getShip(game, 'op-sentinel');
  game = command(game, { type: 'pass' });
  assert.ok(maintainedTowPair(game, 'op-escort'));
  assert.equal(getShip(game, 'op-sentinel').x, initial.x);
  game = command(game, { type: 'orders', shipId: 'op-escort', order: { type: 'hold' } });
  assert.equal(maintainedTowPairs(game).length, 0);
  assert.equal(getShip(game, 'op-sentinel').tractorBy, null);
  assert.equal(game.operation.rescueReports['op-escort'].phase, 'cancelled');
});

test('queued Rescue is visible and consumes no approach action until radio delivery', () => {
  let game = edit(fresh(), 'op-escort', { x: 300, y: 300 });
  const out = applyPlayerAction(game, { type: 'orders', shipId: 'op-escort', order: { type: 'rescue' } });
  game = out.game;
  assert.equal(game.pendingOrders['op-escort'].type, 'rescue');
  assert.equal(game.orders['op-escort'], undefined);
  assert.equal(out.records.some((r) => r.kind === 'rescue-order'), false);
  assert.match(operationPanelMarkup(game), /radio transit/);
  game = command(game, { type: 'pass' });
  assert.equal(getShip(game, 'op-escort').x, 300);
  assert.equal(game.orders['op-escort'].type, 'rescue');
  assert.equal(game.pendingOrders['op-escort'], undefined);
});

test('disabled hardware and command transfer report blockers without a stale link', () => {
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  game = command(game, { type: 'pass' });
  const tug = getShip(game, 'op-escort');
  game = edit(game, tug.id, { systems: { ...tug.systems, engines: 0 } });
  assert.match(rescueDecision(game, tug.id).reason, /engines/);
  const transferred = { ...game, playerShipId: tug.id };
  assert.equal(maintainedTowPair(transferred, tug.id), null);
  assert.match(rescueDecision(transferred, tug.id).reason, /You now command/);
  const lost = edit(game, 'op-sentinel', { status: 'destroyed', crew: 0 });
  assert.equal(rescueDecision(lost, tug.id).phase, 'failed');
});

test('navigation uses visible contacts only and reports bounded obstruction instead of claiming progress', () => {
  const game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  const hidden = edit(game, 'op-guard', { x: 300, y: 300 });
  const farther = edit(hidden, 'op-guard', { x: 290, y: 290 });
  assert.deepEqual(chooseAiAction(hidden, 'op-escort'), chooseAiAction(farther, 'op-escort'));
  const tug = getShip(game, 'op-escort');
  const powerless = { ...game, power: { ...game.power, [tug.id]: { ...game.power[tug.id], engines: 0 } } };
  const report = updateRescueReports(powerless);
  assert.equal(report.operation.rescueReports[tug.id].phase, 'blocked');
  assert.match(operationPanelMarkup(report), /powered engines/);
  assert.deepEqual(updateRescueReports(report), report);
});

test('manual and delegated links coexist; cancelling Rescue leaves the command tow intact', () => {
  let game = edit(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-scout', { x: 105, y: 140 }), 'op-escort', { x: 130, y: 160 });
  game = assign(game);
  game = command(game, { type: 'tow-start', targetId: 'op-scout' });
  assert.equal(maintainedTowPairs(game).length, 2);
  const manual = structuredClone(game.maintainedTow);
  game = command(game, { type: 'orders', shipId: 'op-escort', order: { type: 'hold' } });
  assert.deepEqual(game.maintainedTow, manual);
  assert.equal(maintainedTowPairs(game).length, 1);
  assert.equal(getShip(game, 'op-sentinel').tractorBy, null);
});

test('a radio-delayed replacement preserves the rescue until its delivery boundary', () => {
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  game = command(game, { type: 'pass' });
  game = edit(game, 'op-command', { x: 10, y: 10 });
  const replacement = applyPlayerAction(game, { type: 'orders', shipId: 'op-escort', order: { type: 'hold' } });
  game = replacement.game;
  assert.ok(maintainedTowPair(game, 'op-escort'));
  assert.equal(game.pendingOrders['op-escort'].type, 'hold');
  assert.equal(replacement.records.some((r) => r.kind === 'maintained-tow-ended'), false);
  game = command(game, { type: 'pass' });
  assert.equal(getShip(game, 'op-escort').x, 120);
  assert.equal(maintainedTowPairs(game).length, 0);
  assert.equal(game.operation.rescueReports['op-escort'].phase, 'cancelled');
});

test('no clear formation step stays blocked, then resumes when a known obstruction moves', () => {
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  game = command(game, { type: 'pass' });
  const tug = getShip(game, 'op-escort');
  const obstacle = { ...getShip(game, 'op-command'), id: 'test-obstacle', name: 'Obstruction', x: tug.x - 1, y: tug.y };
  const blocked = { ...game, ships: [...game.ships, obstacle] };
  assert.equal(rescueDecision(blocked, tug.id).phase, 'blocked');
  assert.equal(rescueDecision(game, tug.id).phase, 'hauling');
});

test('explicit power settings are preserved and report a tractor blocker', () => {
  const initial = fresh();
  const allocation = { shields: 6, weapons: 6, engines: 4, sensors: 4, tractor: 0 };
  const game = assign({ ...initial, power: { ...initial.power, 'op-escort': allocation } });
  assert.deepEqual(game.power['op-escort'], allocation);
  assert.equal(game.operation.rescueReports['op-escort'].phase, 'blocked');
  assert.match(game.operation.rescueReports['op-escort'].reason, /tractor/);
});

test('rescue phase facts survive journal serialization without replaying mechanics', () => {
  const { game, records } = play('rescue-1', 'op-escort');
  let journal = appendRecords(createJournal(game.battleRecordState.battleId), records);
  journal = restoreJournal(JSON.parse(JSON.stringify(journal)), game.battleRecordState.battleId);
  const phases = journal.events.filter((e) => e.kind === 'rescue-order').map(formatJournalEvent);
  assert.ok(phases.some((text) => text.includes('Rescue completed')), phases.join('\n'));
  assert.ok(phases.some((text) => text.includes('hauling')));
});

test('old operation saves remain valid; malformed or overlapping delegated ownership is rejected', () => {
  const saved = (game) => ({ version: 1, game, resume: { game: null, view: {} } });
  assert.equal(validOperationSave(saved(fresh())), true);
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  game = command(game, { type: 'pass' });
  assert.equal(validOperationSave(saved(JSON.parse(JSON.stringify(game)))), true);
  const broken = structuredClone(game);
  broken.operation.tows['op-escort'].offsetX = null;
  assert.equal(validOperationSave(saved(broken)), false);
  assert.equal(validOperationSave(saved({ ...game, maintainedTow: game.operation.tows['op-escort'] })), false);
  assert.equal(validOperationSave(saved({ ...game, operation: { ...game.operation, rescueReports: [] } })), false);
});

test('a lost or independently evacuated tug does not reserve the rescue against another captain', () => {
  const initial = assign(fresh());
  const tug = getShip(initial, 'op-escort');
  const departed = { ...initial, ships: initial.ships.filter((s) => s.id !== tug.id), operation: { ...initial.operation, extracted: [tug] } };
  assert.match(rescueDecision(departed, tug.id).reason, /evacuated without Sentinel/);
  assert.equal(assign(departed, 'op-scout').orders['op-scout'].type, 'rescue');
  assert.equal(assign(edit(initial, tug.id, { status: 'destroyed', crew: 0 }), 'op-scout').orders['op-scout'].type, 'rescue');
});

test('captured tugs stop obeying rescue orders and release their original ownership', () => {
  let game = assign(edit(edit(fresh(), 'op-command', { x: 90, y: 160 }), 'op-escort', { x: 130, y: 160 }));
  game = command(game, { type: 'pass' });
  game = edit(game, 'op-escort', { faction: 'Axis' });
  const withoutOrder = { ...game, orders: {} };
  assert.deepEqual(chooseAiAction(game, 'op-escort'), chooseAiAction(withoutOrder, 'op-escort'));
  const reconciled = updateRescueReports(reconcileMaintainedTow(game));
  assert.equal(maintainedTowPairs(reconciled).length, 0);
  assert.equal(reconciled.operation.rescueReports['op-escort'].phase, 'failed');
});
