import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, applyPlayerAction } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { createGame, distance, engineCapacity, getShip, movementCapacity, powerEffect, sensorRange } from '../game/state.js';
import { evaluateOutcome, resolveComputerTurns, resolveStardateChain } from '../game/turns.js';
import { createOperationGame, finishOperation, observeOperationActor, OPERATION_SEEDS, operationExtraction, operationResultExplanation, operationVisible, resolveOperationBoundary, validOperationSave } from '../game/operations.js';
import { operationPanelMarkup } from '../ui/operations.js';
import { appendRecords, createJournal, formatJournalEvent, journalView, restoreJournal } from '../ui/battle-journal.js';

const fresh = (options) => createOperationGame({ battleId: 'operation-test', ...options });
const edit = (game, id, patch) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...patch } : ship) });
const command = (game, action) => {
  const result = applyPlayerAction(game, action);
  assert.notEqual(result.game, game, result.messages?.join(' '));
  return result.game.phase === 'computer' ? resolveComputerTurns(result.game) : result.game;
};
const moveTo = (game, x, y) => {
  const ship = getShip(game, game.playerShipId);
  const dx = x - ship.x, dy = y - ship.y;
  const fraction = Math.min(1, (movementCapacity(game, ship) - 1) / Math.hypot(dx, dy));
  return command(game, { type: 'move', dx: Math.round(dx * fraction), dy: Math.round(dy * fraction) });
};

test('operation factory is deterministic, separated, equipped, and rejects unsupported modes', () => {
  assert.deepEqual(fresh(), fresh());
  assert.throws(() => fresh({ reimagined: false }), /Reimagined/);
  assert.throws(() => fresh({ realtime: true }), /turn-based/);
  assert.throws(() => fresh({ movementScale: 3 }), /profile/);
  const game = fresh();
  assert.equal(getShip(game, 'op-sentinel').systems.engines, 0);
  assert.equal(getShip(game, 'op-command').systems.tractor, 3);
  assert.equal(game.vendettaShipId, null);
  assert.equal(game.objectiveShipId, null);
  for (const ship of game.ships) {
    assert.ok(distance(ship, game.operation.exit) > game.operation.exit.radius);
    for (const other of game.ships.filter((other) => other.id !== ship.id)) assert.ok(distance(ship, other) > 5);
  }
});

test('operation movement preserves hull ratios, damage and power, independent of world size', () => {
  for (const scale of [.75, 1, 1.5]) for (const gridSize of [320, 480]) {
    let game = fresh({ movementScale: scale, gridSize });
    for (const ship of game.ships) assert.equal(movementCapacity(game, ship), ship.systems.engines * 10 * scale * powerEffect(game, ship, 'engines'));
    const player = getShip(game, game.playerShipId);
    game = edit(game, player.id, { systems: { ...player.systems, engines: 2 }, power: { ...player.power, engines: 0 } });
    const damaged = getShip(game, player.id);
    assert.equal(movementCapacity(game, damaged), 20 * scale * powerEffect(game, damaged, 'engines'));
  }
  for (const reimagined of [false, true]) {
    const game = createGame({ seed: 'ordinary-movement', reimagined });
    assert.equal(Object.hasOwn(game, 'operation'), false);
    for (const ship of game.ships) assert.equal(movementCapacity(game, ship), engineCapacity(ship, game.gridSize, powerEffect(game, ship, 'engines')));
  }
});

test('manual movement and its availability use the operation capacity', () => {
  const game = fresh();
  assert.strictEqual(applyPlayerAction(game, { type: 'move', dx: 51, dy: 0 }).game, game);
  const result = applyPlayerAction(game, { type: 'move', dx: 45, dy: 0 });
  assert.equal(getShip(result.game, game.playerShipId).x, 107);
  assert.equal(actionAvailability(game, { type: 'resign' }).available, false);
});

test('hidden enemy movement cannot change a last-seen pursuit destination, including after reload', () => {
  let game = fresh();
  const guard = getShip(game, 'op-guard');
  game = edit(game, 'op-command', { x: guard.x - 10, y: guard.y });
  game = observeOperationActor(game, guard.id);
  const sight = game.operation.contacts[guard.id]['op-command'];
  assert.equal(sight.x, guard.x - 10);
  game = edit(game, 'op-command', { x: 10, y: 10 });
  game = observeOperationActor(game, guard.id);
  assert.deepEqual(game.operation.contacts[guard.id]['op-command'], sight);
  const other = edit(JSON.parse(JSON.stringify(game)), 'op-command', { x: 20, y: 300 });
  assert.deepEqual(chooseAiAction(game, guard.id), chooseAiAction(other, guard.id));
  const expired = observeOperationActor({ ...game, operation: { ...game.operation, elapsed: 3 } }, guard.id);
  assert.equal(expired.operation.contacts[guard.id]['op-command'], undefined);
});

test('contacts share only through working radio and nebula sightings respect sensors', () => {
  let game = fresh();
  game = edit(game, 'op-guard', { x: 180, y: 160 });
  game = observeOperationActor(game, 'op-guard');
  assert.ok(game.operation.contacts['op-guard']['op-sentinel']);
  game = edit(game, 'op-patrol', { x: 190, y: 160 });
  game = observeOperationActor(game, 'op-patrol');
  assert.ok(game.operation.contacts['op-patrol']['op-sentinel']);
  const patrol = getShip(game, 'op-patrol');
  const guard = getShip(game, 'op-guard');
  game = edit({ ...game, operation: { ...game.operation, contacts: { 'op-guard': game.operation.contacts['op-guard'] } } }, guard.id, { systems: { ...guard.systems, radio: 0 } });
  game = observeOperationActor(game, patrol.id);
  assert.equal(game.operation.contacts[patrol.id]['op-sentinel'], undefined);
  const observer = { ...patrol, x: 122, y: 78 };
  const target = { ...getShip(game, 'op-command'), x: 140, y: 78 };
  assert.ok(distance(observer, target) < sensorRange(game, observer, 'mapper'));
  assert.equal(operationVisible(game, observer, target), false);
});

test('hostile commands and directed tow destinations cannot use hidden current geometry', () => {
  const game = fresh();
  assert.equal(actionAvailability(game, { type: 'phasers', targetId: 'op-guard' }).reasonCode, 'target-hidden');
  const close = edit(game, 'op-command', { x: 130, y: 160 });
  const result = applyPlayerAction(close, { type: 'tractor', targetId: 'op-sentinel', towardId: 'op-guard' });
  assert.deepEqual(result.game, close);
});

for (const seed of OPERATION_SEEDS) test(`${seed}: real manual actions rescue Sentinel and allow fleet withdrawal without an enemy wipe`, () => {
  let game = fresh({ seed });
  game = command(game, { type: 'move', dx: 45, dy: -20 });
  for (let step = 0; step < 18 && game.operation.primary === 'pending'; step += 1) {
    const ship = getShip(game, game.playerShipId), target = getShip(game, game.operation.targetId);
    game = distance(ship, target) <= 35
      ? command(game, { type: 'tractor', targetId: target.id, towardX: 38, towardY: 160 })
      : moveTo(game, target.x - 17, target.y - 20);
    if (step === 4) game = JSON.parse(JSON.stringify(game));
  }
  assert.equal(game.operation.primary, 'secured');
  assert.ok(game.operation.elapsed <= 16);
  assert.equal(getShip(game, 'op-sentinel'), undefined);
  assert.ok(game.operation.assists['op-command'] >= 100);
  assert.deepEqual(Object.keys(game.operation.assists), ['op-command']);
  assert.equal(game.operation.result, null, 'The player has time to recover the remaining fleet.');
  for (let step = 0; step < 10 && !game.operation.result; step += 1) game = moveTo(game, 38, 160);
  assert.equal(game.operation.result.primary, 'success');
  assert.equal(game.operation.result.returned.length, 4);
  assert.equal(game.operation.result.abandoned.length, 0);
  assert.equal(game.operation.result.prizeRecovered, false);
  assert.ok(game.ships.some((ship) => ship.faction === 'Axis' && ship.status === 'active'));
  assert.strictEqual(finishOperation(game), game);
  assert.strictEqual(resolveComputerTurns(game), game);
});

test('boundary extraction requires crew, survival and no hostile tow, but permits friendly tow', () => {
  let game = edit(fresh(), 'op-sentinel', { x: 38, y: 160, tractorBy: 'op-command' });
  const extracted = resolveOperationBoundary(game);
  assert.equal(extracted.operation.primary, 'secured');
  assert.equal(extracted.operation.extracted[0].tractorBy, null);
  assert.strictEqual(resolveOperationBoundary(extracted), extracted);
  for (const patch of [{ crew: 0 }, { status: 'destroyed' }, { tractorBy: 'op-guard' }]) {
    const blocked = resolveOperationBoundary(edit(game, 'op-sentinel', patch));
    assert.equal(blocked.operation.extracted.length, 0);
    assert.notEqual(blocked.operation.primary, 'secured');
  }
});

test('rescue at elapsed 16 succeeds; a later arrival cannot undo expiration', () => {
  const atDeadline = { ...fresh(), turn: 16 };
  atDeadline.operation = { ...atDeadline.operation, elapsed: 15, lastBoundary: 15 };
  assert.equal(resolveOperationBoundary(edit(atDeadline, 'op-sentinel', { x: 38, y: 160 })).operation.primary, 'secured');
  const missed = resolveOperationBoundary(atDeadline);
  assert.equal(missed.operation.primary, 'expired');
  const late = resolveOperationBoundary(edit({ ...missed, turn: 17 }, 'op-sentinel', { x: 38, y: 160 }));
  assert.equal(late.operation.primary, 'expired');
  assert.equal(late.operation.extracted.length, 0);
});

test('loss, last-enemy destruction and early withdrawal cannot fabricate rescue success', () => {
  let game = fresh();
  game = { ...game, ships: game.ships.filter((ship) => ship.faction === 'Federation') };
  assert.equal(evaluateOutcome(game).kind, 'active');
  game = resolveOperationBoundary(edit(game, 'op-sentinel', { status: 'destroyed', crew: 0 }));
  assert.equal(game.operation.primary, 'lost');
  assert.equal(evaluateOutcome(game).kind, 'active');
  const ended = finishOperation(game);
  assert.equal(ended.outcome.kind, 'scenario-loss');
  assert.equal(ended.operation.result.abandoned.length, 3);
  assert.equal(ended.operation.result.lost.length, 1);
});

test('command transfers after extraction, extracted hulls leave the live fleet and do not regenerate', () => {
  const game = edit(fresh(), 'op-command', { x: 38, y: 160, shields: 70 });
  const next = resolveOperationBoundary(game);
  assert.notEqual(next.playerShipId, game.playerShipId);
  assert.equal(getShip(next, 'op-command'), undefined);
  const after = resolveComputerTurns(next);
  assert.equal(after.operation.extracted[0].shields, 70);
  assert.ok(next.operation.facts.some((entry) => entry.kind === 'command-transfer'));
});

test('a rescue tug inside the beacon stays until Sentinel can extract, including after reload', () => {
  let game = edit(fresh(), 'op-command', { x: 38, y: 160 });
  game = edit(game, 'op-sentinel', { x: 65, y: 160, tractorBy: 'op-command' });
  for (const id of ['op-scout', 'op-escort']) game = edit(game, id, { x: 38, y: 165 });
  const before = JSON.stringify(game);
  assert.deepEqual(operationExtraction(game).heldTugs.map((ship) => ship.id), ['op-command']);
  assert.equal(JSON.stringify(game), before);
  assert.match(operationPanelMarkup(game), /Argonaut stays on station/);
  const held = resolveOperationBoundary(game);
  assert.deepEqual(held.operation.extracted.map((ship) => ship.id), ['op-scout', 'op-escort']);
  assert.equal(held.playerShipId, 'op-command');
  assert.equal(getShip(held, 'op-sentinel').tractorBy, 'op-command');
  assert.equal(held.operation.result, null);
  game = JSON.parse(JSON.stringify(held));
  game = applyPlayerAction(game, { type: 'tractor', targetId: 'op-sentinel', towardX: 38, towardY: 160 }).game;
  assert.equal(getShip(game, 'op-sentinel').x, 50);
  const rescued = resolveOperationBoundary({ ...game, turn: held.turn + 1 });
  assert.equal(rescued.operation.result.primary, 'success');
  assert.equal(rescued.operation.result.returned.length, 4);
});

test('rescue hold ends after expiry or target loss and never shields a tug from damage', () => {
  let game = edit(fresh(), 'op-command', { x: 38, y: 160 });
  game = edit(game, 'op-sentinel', { x: 65, y: 160, tractorBy: 'op-command' });
  for (const primary of ['expired', 'lost']) {
    const leaving = resolveOperationBoundary({ ...game, operation: { ...game.operation, primary } });
    assert.ok(leaving.operation.extracted.some((ship) => ship.id === 'op-command'));
  }
  for (const patch of [{ status: 'destroyed', crew: 0 }, { status: 'vacant', crew: 0 }, { faction: 'Axis' }]) {
    const lostTarget = resolveOperationBoundary(edit(game, 'op-sentinel', patch));
    assert.ok(lostTarget.operation.extracted.some((ship) => ship.id === 'op-command'));
    assert.equal(lostTarget.operation.primary, 'lost');
  }
  const deadTug = resolveOperationBoundary(edit(game, 'op-command', { status: 'destroyed', crew: 0 }));
  assert.ok(!deadTug.operation.extracted.some((ship) => ship.id === 'op-command'));
  assert.equal(getShip(deadTug, 'op-command').status, 'destroyed');
});

test('early evacuation explains why surviving ships disappeared and Sentinel was abandoned', () => {
  let game = fresh();
  for (const id of ['op-command', 'op-scout', 'op-escort']) game = edit(game, id, { x: 38, y: 160 });
  assert.match(operationPanelMarkup(game), /last command ship is about to evacuate without Sentinel/);
  const ended = resolveOperationBoundary(game);
  assert.equal(ended.operation.result.primary, 'failure');
  assert.deepEqual(ended.operation.result.returned.map((ship) => ship.name), ['Argonaut', 'Swift', 'Bulwark']);
  assert.deepEqual(ended.operation.result.abandoned.map((ship) => ship.name), ['Sentinel']);
  assert.match(operationResultExplanation(ended), /No command-capable ship remained.*Sentinel was left behind/);
  const markup = operationPanelMarkup(ended);
  assert.match(markup, /Operation ended: Sentinel was not recovered/);
  assert.match(markup, /Evacuated through beacon \(removed from map\): Argonaut, Swift, Bulwark/);
  assert.doesNotMatch(markup, /Tow Sentinel into the extraction ring/);
});

test('reinforcement follows declared boundaries, and occupied entries defer without duplication', () => {
  let game = fresh();
  for (let elapsed = 1; elapsed <= 6; elapsed += 1) {
    game = resolveStardateChain(game, [], []);
    assert.equal(game.operation.arrivals.warned, elapsed >= 4);
    assert.equal(game.ships.some((ship) => ship.id === 'op-reinforcement'), elapsed >= 6);
  }
  game = resolveStardateChain(game, [], []);
  assert.equal(game.ships.filter((ship) => ship.id === 'op-reinforcement').length, 1);
  let blocked = { ...fresh(), turn: 6 };
  blocked.operation = { ...blocked.operation, elapsed: 5, lastBoundary: 5 };
  for (const [id, x, y] of [['op-command', 290, 160], ['op-scout', 296, 170], ['op-escort', 296, 148]]) blocked = edit(blocked, id, { x, y });
  assert.equal(resolveOperationBoundary(blocked).operation.arrivals.arrived, false);
});

test('a captured optional prize uses ordinary boarding then withdraws to the beacon', () => {
  let game = fresh();
  // Isolate the boarding/withdrawal contract; route feasibility is a playtest question.
  game = edit(game, 'op-command', { x: 160, y: 74 });
  game = command(game, { type: 'transport', targetId: 'op-prize', amount: 20 });
  const prize = getShip(game, 'op-prize');
  assert.equal(prize.faction, 'Federation');
  assert.equal(game.orders[prize.id].type, 'withdraw');
  for (let step = 0; step < 20 && !game.operation.extracted.some((ship) => ship.id === prize.id); step += 1) game = command(game, { type: 'pass' });
  assert.ok(game.operation.extracted.some((ship) => ship.id === prize.id));
  assert.equal(finishOperation(game).operation.result.prizeRecovered, true);
});

test('versioned saves reject incompatible definitions and preserve facts/results across reload', () => {
  const game = finishOperation(fresh());
  const saved = { version: 1, game, resume: { game: createGame(), view: {} } };
  assert.equal(validOperationSave(saved), true);
  const restored = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(finishOperation(restored.game), game);
  restored.game.operation.revision = 2;
  assert.equal(validOperationSave(restored), false);
  assert.equal(validOperationSave({ version: 1, game: {}, resume: {} }), false);
  assert.match(operationPanelMarkup(game), /Left behind: Argonaut, Swift, Bulwark, Sentinel/);
});

test('incoming fire resolves before extraction, including retaliation outside a patrol area', () => {
  let game = fresh();
  const sentinel = getShip(game, 'op-sentinel');
  game = edit(game, sentinel.id, { x: 38, y: 160, crew: 1, shields: 0, arcs: { fore: 0, aft: 0, port: 0, starboard: 0 }, systems: { ...sentinel.systems, phasers: 0, photons: 0, tractor: 0 } });
  game = edit(game, 'op-guard', { x: 48, y: 160 });
  game = resolveComputerTurns(game);
  assert.equal(game.operation.primary, 'lost');
  assert.equal(game.operation.extracted.length, 0);
  assert.ok(game.events.some((event) => event.kind === 'destruction' && event.shipId === sentinel.id));
});

test('deadline finalization and recaptured hull accounting are explicit and idempotent', () => {
  let game = { ...fresh(), turn: 22 };
  game.operation = { ...game.operation, elapsed: 21, lastBoundary: 21 };
  game = edit(game, 'op-sentinel', { faction: 'Axis' });
  game = resolveOperationBoundary(game);
  assert.equal(game.operation.result.reason, 'deadline');
  assert.ok(game.operation.result.lost.some((ship) => ship.id === 'op-sentinel'));
  assert.strictEqual(resolveStardateChain(game, [], []), game);
  assert.strictEqual(finishOperation(game), game);
});

test('extraction, rescue and command transfer facts survive journal projection and reload once', () => {
  let game = fresh();
  game = edit(game, 'op-sentinel', { x: 38, y: 160 });
  game = edit(game, 'op-command', { x: 44, y: 160 });
  let records;
  game = resolveStardateChain(game, [], [], { onRecords: (batch) => { records = batch; } });
  const journal = appendRecords(createJournal(game.battleRecordState.battleId), records);
  const restored = restoreJournal(JSON.parse(JSON.stringify(journal)), game.battleRecordState.battleId);
  assert.equal(appendRecords(restored, records).events.length, journal.events.length);
  const lines = restored.events.map(formatJournalEvent).join('\n');
  assert.match(lines, /Sentinel extracted/);
  assert.match(lines, /Sentinel recovered/);
  assert.match(lines, /Command transferred from Argonaut to Bulwark/);
  assert.ok(journalView(restored).battleDevelopments.some((card) => /evacuated through the beacon/.test(card.summary)));
  assert.ok(!journalView(restored).fleetTraffic.some((card) => card.events.some((event) => event.kind === 'hull-extracted')));
  const oldSave = JSON.parse(JSON.stringify(journal));
  for (const event of oldSave.events) if (event.kind === 'hull-extracted' && !event.own) event.group = 'fleet-traffic';
  assert.ok(journalView(restoreJournal(oldSave, game.battleRecordState.battleId)).battleDevelopments.some((card) => /evacuated through the beacon/.test(card.summary)), 'Old retained evacuation facts are promoted on reload.');
  let endRecords;
  finishOperation(game, 'withdrawal', { onRecords: (batch) => { endRecords = batch; } });
  assert.equal(endRecords.filter((record) => record.kind === 'operation-resolved').length, 1);
});
