import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { enableBattleRecords, shipConsequences, stripBattleRecordMetadata, withBattleRecords } from '../game/battle-records.js';
import { applyPlayerAction } from '../game/actions.js';
import { resolveAutopilotTurn, resolveComputerTurns, resolveDocking, resolveEncounters, resolveObjectives, resolveRealtimeBoundary, resolveStardateChain, stepContinuum } from '../game/turns.js';

const enabled = (game) => enableBattleRecords(game, { battleId: 'turn-test' });
const replace = (game, id, changes) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...changes } : ship) });
const staged = (seed = 'phaser-hit-2', options = {}) => {
  const game = createGame({ seed, ...options });
  return { ...game, ships: game.ships.map((ship, index) => ship.id === game.playerShipId
    ? { ...ship, x: 10, y: 10, systems: { ...ship.systems, photons: 0 } }
    : ship.id === 'axis-flagship' ? { ...ship, x: 16, y: 10 }
      : { ...ship, x: 70 + index * 3, y: 80, dest: null }) };
};

test('AI beam hits and misses report one automatic action and exact resolved damage', () => {
  for (const [seed, expected] of [['phaser-hit-2', 'hit'], ['phaser-hit', 'miss']]) {
    const game = enabled(staged(seed));
    const result = resolveAutopilotTurn(game);
    const action = result.records.find((record) => record.kind === 'action');
    const volley = result.records.find((record) => record.kind === 'weapon-resolution');
    assert.equal(result.records.filter((record) => record.kind === 'action').length, 1);
    assert.equal(action.source, 'auto-conn');
    assert.equal(action.payload.command, 'phasers');
    assert.equal(action.payload.request.targetId, volley.targetId);
    assert.equal(volley.actionId, action.actionId);
    assert.equal(volley.payload.result, expected);
    if (expected === 'hit') {
      assert.deepEqual(volley.payload.consequences, shipConsequences(getShip(game, 'axis-flagship'), getShip(result.game, 'axis-flagship')));
    } else {
      assert.equal(getShip(result.game, 'axis-flagship').shields, getShip(game, 'axis-flagship').shields);
      assert.equal(result.records.filter((record) => record.kind === 'damage').length, 0);
    }
  }
});

test('computer phases collect fleet decisions once and never carry records in saved state', () => {
  const game = enabled(staged());
  let delivered;
  const collected = withBattleRecords(game, (prepared) => resolveComputerTurns(prepared, { onRecords: (records) => { delivered = records; } }));
  assert.deepEqual(delivered, collected.records);
  const actions = collected.records.filter((record) => record.kind === 'action');
  assert.ok(actions.length > 0);
  assert.ok(actions.every((record) => record.source === 'fleet-ai'));
  assert.equal(new Set(actions.map((record) => record.actionId)).size, actions.length);
  assert.equal(new Set(collected.records.map((record) => record.eventId)).size, collected.records.length);
  assert.equal(Object.getOwnPropertySymbols(collected.result).length, 0);
  assert.equal(collected.result.records, undefined);
  assert.ok(!JSON.stringify(collected.result).includes('weapon-resolution'));
  const again = withBattleRecords(collected.result, (prepared) => resolveComputerTurns(prepared));
  const oldIds = new Set(collected.records.map((record) => record.eventId));
  assert.ok(again.records.every((record) => !oldIds.has(record.eventId)));
});

test('delayed photons retain launch issuer after capture and command change, and resolve once', () => {
  let game = staged('phaser-hit-2', { realtime: true });
  const actor = getShip(game, game.playerShipId);
  game = enabled(replace(game, actor.id, { systems: { ...actor.systems, photons: 2 } }));
  const launch = applyPlayerAction(game, { type: 'photons', targetId: 'axis-flagship' });
  const fired = launch.records.find((record) => record.kind === 'ordnance-launch');
  let changed = JSON.parse(JSON.stringify(launch.game));
  changed = { ...replace(changed, actor.id, { faction: 'Axis', name: 'Captured Argo' }), playerShipId: 'fed-cruiser-1' };
  const impactStep = stepContinuum(changed);
  const impact = impactStep.records.find((record) => record.kind === 'ordnance-impact');
  assert.ok(impact);
  assert.equal(impact.actor.name, actor.name);
  assert.equal(impact.actor.faction, actor.faction);
  assert.equal(impact.actionId, fired.actionId);
  assert.equal(impact.ordnanceId, fired.ordnanceId);
  assert.equal(impact.source, 'manual');
  assert.equal(impactStep.records.filter((record) => record.kind === 'action').length, 0);
  assert.equal(stepContinuum(impactStep.game).records.filter((record) => record.kind === 'ordnance-impact').length, 0);
});

test('empty-space impact is explicit and consumes no accuracy or damage roll', () => {
  let game = staged('rt-dodge', { realtime: true });
  const actor = getShip(game, game.playerShipId);
  game = enabled(replace(game, actor.id, { systems: { ...actor.systems, photons: 2 } }));
  const launch = applyPlayerAction(game, { type: 'photons', targetId: 'axis-flagship' });
  const moved = replace(launch.game, 'axis-flagship', { x: 50, y: 40 });
  const result = stepContinuum(moved);
  const impact = result.records.find((record) => record.kind === 'ordnance-impact');
  assert.equal(impact.payload.result, 'empty-space');
  assert.equal(result.game.randomStep, launch.game.randomStep);
  assert.equal(result.records.filter((record) => record.kind === 'damage').length, 0);
});

test('a spread that passes accuracy but catches no hull resolves as empty space', () => {
  let game = staged('phaser-hit-2', { realtime: true });
  const actor = getShip(game, game.playerShipId);
  game = enabled(replace(game, actor.id, { systems: { ...actor.systems, spread: 2 } }));
  const launch = applyPlayerAction(game, { type: 'spread', targetId: 'axis-flagship' });
  const moved = replace(launch.game, 'axis-flagship', { x: 50, y: 40 });
  const result = stepContinuum(moved);
  const impact = result.records.find((record) => record.kind === 'ordnance-impact');
  assert.equal(impact.payload.result, 'empty-space');
  assert.deepEqual(impact.payload.affected, []);
  assert.equal(impact.payload.damage, undefined);
  assert.equal(result.records.filter((record) => record.kind === 'damage').length, 0);
  // The existing spread resolver still rolls against its living aimed target.
  assert.equal(result.game.randomStep, launch.game.randomStep + 1);
  assert.deepEqual(stripBattleRecordMetadata(result.game), stepContinuum(stripBattleRecordMetadata(moved)).game);
});

test('dockyard repair and relay changes record observed transitions with honest rule causes', () => {
  let game = createGame({ seed: 'milestones', reimagined: true });
  const actor = getShip(game, game.playerShipId);
  const base = game.ships.find((ship) => ship.faction === actor.faction && ship.className === 'Starbase');
  game = enabled(replace(game, actor.id, { x: base.x, y: base.y, shields: 1, crew: 20, systems: { ...actor.systems, engines: 0 } }));
  const docked = resolveDocking(game);
  const repair = docked.records.find((record) => record.kind === 'repair' && record.actorId === actor.id);
  assert.equal(repair.payload.cause, 'dockyard');
  assert.equal(repair.targetId, base.id);
  assert.deepEqual(repair.payload.consequences, shipConsequences(getShip(game, actor.id), getShip(docked.game, actor.id)));
  assert.equal(docked.records.filter((record) => record.kind === 'docking' && record.actorId === actor.id).length, 1);
  const relayGame = { ...docked.game, terrain: [{ id: 'record-relay', type: 'relay', x: base.x, y: base.y, radius: 2 }], held: {} };
  const relay = resolveObjectives(relayGame);
  const change = relay.records.find((record) => record.kind === 'relay-change');
  assert.equal(change.payload.after, actor.faction);
  assert.equal(change.payload.cause, 'relay-control');
  assert.equal(change.actionId, null);
  assert.equal(resolveObjectives(relay.game).records.length, 0);
});

test('boundary records command transfer, queued order delivery and battle outcome once', () => {
  let game = staged('boundary-records');
  const nextCommand = game.ships.find((ship) => ship.id !== game.playerShipId && ship.faction === 'Federation');
  game = enabled({ ...replace(game, game.playerShipId, { status: 'destroyed' }), pendingOrders: { [nextCommand.id]: { type: 'withdraw' } } });
  let records;
  const result = resolveStardateChain(game, [], [], { onRecords: (value) => { records = value; } });
  assert.equal(records.filter((record) => record.kind === 'command-transfer').length, 1);
  assert.equal(records.filter((record) => record.kind === 'order-delivery').length, 1);
  assert.notEqual(result.playerShipId, game.playerShipId);
  const commandGone = { ...game, ships: game.ships.map((ship) => ship.faction === 'Federation' ? { ...ship, status: 'destroyed' } : ship) };
  const loss = withBattleRecords(commandGone, (prepared) => resolveStardateChain(prepared, [], []));
  const lostCommand = loss.records.find((record) => record.kind === 'command-transfer');
  assert.equal(lostCommand.target, null);
  assert.equal(lostCommand.knowledge.globalTerminal, true);
  const defeated = { ...result, ships: result.ships.map((ship) => ship.faction === 'Federation' ? ship : { ...ship, status: 'destroyed' }) };
  const final = withBattleRecords(defeated, (prepared) => resolveStardateChain(prepared, [], []));
  const outcome = final.records.find((record) => record.kind === 'battle-outcome');
  assert.equal(outcome.payload.outcome.kind, 'federation-win');
  assert.equal(outcome.actionId, null);
  assert.equal(withBattleRecords(final.result, (prepared) => resolveStardateChain(prepared, [], [])).records.filter((record) => record.kind === 'battle-outcome').length, 0);
});

test('distress abandonment is a vacancy, while encounters emit only confirmed arrivals', () => {
  let game = staged('distress-record', { reimagined: true });
  const distressed = getShip(game, 'fed-cruiser-1');
  game = enabled({ ...replace(game, distressed.id, { encounter: { type: 'distress', turn: 1 }, systems: { ...distressed.systems, engines: 0 } }), turn: 21 });
  const abandoned = resolveEncounters(game);
  const vacancy = abandoned.records.find((record) => record.kind === 'vacancy' && record.targetId === distressed.id);
  assert.ok(vacancy);
  assert.equal(vacancy.payload.cause, 'distress-abandonment');
  assert.equal(vacancy.knowledge.globalTerminal, false);
  assert.equal(abandoned.records.filter((record) => record.kind === 'surrender' && record.targetId === distressed.id).length, 0);
  assert.deepEqual(vacancy.payload.consequences, shipConsequences(getShip(game, distressed.id), getShip(abandoned.game, distressed.id)));
  assert.deepEqual(stripBattleRecordMetadata(abandoned.game), resolveEncounters(stripBattleRecordMetadata(game)).game);
  const arrivalGame = enabled({ ...createGame({ seed: 'arrival0', reimagined: true }), turn: 2 });
  const arrivals = resolveEncounters(arrivalGame);
  const added = arrivals.game.ships.filter((ship) => !getShip(arrivalGame, ship.id));
  assert.equal(added.length, 1);
  const arrival = arrivals.records.find((record) => record.kind === 'encounter-arrival');
  assert.equal(arrival.targetId, added[0].id);
  assert.equal(arrival.target.name, added[0].name);
  assert.equal(arrival.payload.encounterType, added[0].encounter.type);
  assert.equal(arrival.payload.consequences.before, null);
  assert.equal(arrival.payload.consequences.after.x, added[0].x);
  assert.deepEqual(stripBattleRecordMetadata(arrivals.game), resolveEncounters(stripBattleRecordMetadata(arrivalGame)).game);
});

test('AI tractor locks expose the same actual target haul facts as manual tractor orders', () => {
  for (const options of [{}, { realtime: true }]) {
    let game = staged('tractor-records', options);
    const actor = getShip(game, game.playerShipId);
    game = enabled(replace(replace(game, 'axis-flagship', { x: 42, y: 10 }), actor.id, { systems: { ...actor.systems, phasers: 0, photons: 0, ion: 0, spread: 0, tractor: 1 } }));
    const manual = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship' });
    const automated = options.realtime
      ? withBattleRecords({ ...game, autoConn: true }, (prepared) => resolveRealtimeBoundary(prepared))
      : { records: resolveAutopilotTurn(game).records };
    const lock = automated.records.find((record) => record.kind === 'tractor-lock' && record.actorId === actor.id);
    assert.ok(lock);
    assert.equal(lock.targetId, 'axis-flagship');
    assert.equal(lock.source, 'auto-conn');
    assert.deepEqual(lock.payload, manual.records.find((record) => record.kind === 'tractor-lock').payload);
    assert.equal(lock.payload.consequences.after.tractorBy, actor.id);
    assert.equal(lock.payload.result, options.realtime ? 'hauling' : 'pulled');
    if (options.realtime) assert.ok(lock.payload.consequences.after.tow.remaining > 0);
    else assert.ok(lock.payload.consequences.delta.x < 0);
  }
});

test('course arrival and completed tow emit once at their actual sub-tick endpoints', () => {
  for (const tow of [false, true]) {
    let game = staged('completion-records', { realtime: true });
    const actorId = game.playerShipId;
    const shipId = tow ? 'axis-flagship' : actorId;
    const changes = tow
      ? { x: 20, y: 10, tractorBy: actorId, tow: { x: 21, y: 10, rate: 1, remaining: 1 }, dest: null }
      : { x: 10, y: 10, dest: { x: 11, y: 10 } };
    game = enabled(replace(game, shipId, changes));
    const result = stepContinuum(game);
    const kind = tow ? 'tow-complete' : 'arrival';
    const records = result.records.filter((record) => record.kind === kind && record.targetId === shipId);
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.payload.consequences.before.x, changes.x);
    assert.equal(record.payload.consequences.after.x, changes.x + 1);
    assert.equal(record.payload.consequences.delta.x, 1);
    assert.equal(record.payload.consequences.after[tow ? 'tow' : 'dest'], null);
    assert.equal(record.simTime, result.game.simTime);
    assert.equal(record.actorId, actorId);
    assert.equal(record.actionId, null);
    assert.deepEqual(stripBattleRecordMetadata(result.game), stepContinuum(stripBattleRecordMetadata(game)).game);
    assert.equal(stepContinuum(result.game).records.filter((value) => value.kind === kind && value.targetId === shipId).length, 0);
  }
});

test('recording leaves RNG, mechanics, messages and replay identical across phases and sub-ticks', () => {
  for (const options of [{}, { reimagined: true }, { realtime: true }]) {
    let plain = createGame({ seed: 'turn-record-parity', ...options });
    let recorded = enabled(plain);
    for (let step = 0; step < 12 && !plain.outcome; step += 1) {
      if (options.realtime) {
        plain = stepContinuum(plain).game;
        recorded = stepContinuum(recorded).game;
      } else {
        plain = resolveComputerTurns(resolveAutopilotTurn(plain).game);
        recorded = resolveComputerTurns(resolveAutopilotTurn(recorded).game);
      }
      assert.deepEqual(stripBattleRecordMetadata(recorded), plain);
      assert.equal(recorded.randomStep, plain.randomStep);
      assert.equal(Object.getOwnPropertySymbols(recorded).length, 0);
    }
  }
});
