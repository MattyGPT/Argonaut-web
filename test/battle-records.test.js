import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { resolveAutopilotTurn, resolveComputerTurns } from '../game/turns.js';
import { battleActionOf, emitBattleRecord, enableBattleRecords, shipConsequences, snapshotKnowledge, stripBattleRecordMetadata, withBattleAction, withBattleCause, withBattleRecords } from '../game/battle-records.js';

const fixture = (seed = 'phaser-hit-2', options = {}) => {
  const game = createGame({ seed, ...options });
  return { ...game, terrain: [], ships: game.ships.map((ship) => {
    if (ship.id === game.playerShipId) return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 16, y: 10 };
    return { ...ship, x: 90, y: 90 };
  }) };
};

test('battle instance IDs are independent of seeds while the factory remains pure', () => {
  const a = createGame({ seed: 'identity' });
  const b = createGame({ seed: 'identity' });
  assert.deepEqual(a, b);
  const one = enableBattleRecords(a);
  const two = enableBattleRecords(b);
  assert.notEqual(one.battleRecordState.battleId, two.battleRecordState.battleId);
  assert.deepEqual(stripBattleRecordMetadata(one), a);
  assert.equal(enableBattleRecords(one), one, 'resume keeps its identity');
});

test('rejected commands and pure reports consume no action or record identity', () => {
  const game = enableBattleRecords(fixture(), { battleId: 'reject' });
  for (const command of [{ type: 'unknown' }, { type: 'phasers' }, { type: 'move', dx: 900, dy: 0 }, { type: 'status' }]) {
    const result = applyPlayerAction(game, command);
    assert.equal(result.game, game);
    assert.deepEqual(result.records, []);
    assert.equal(game.battleRecordState.nextAction, 1);
    assert.equal(game.battleRecordState.nextEvent, 1);
  }
});

test('beam hit/miss records carry the actual result and exact before/after damage', () => {
  const results = new Set();
  for (let index = 0; index < 70 && results.size < 2; index += 1) {
    const plain = fixture(`record-beam-${index}`, { reimagined: true, precision: true });
    const game = enableBattleRecords(plain, { battleId: `beam-${index}` });
    const before = getShip(game, 'axis-flagship');
    const action = { type: 'phasers', targetId: before.id, focus: 'engines' };
    const resolved = applyPlayerAction(game, action);
    assert.equal(resolved.records.filter((record) => record.kind === 'action').length, 1);
    const shot = resolved.records.find((record) => record.kind === 'weapon-resolution');
    assert.ok(shot);
    assert.equal(shot.actionId, resolved.records[0].actionId);
    assert.equal(shot.payload.result, resolved.events.find((event) => event.kind === 'phasers').hit ? 'hit' : 'miss');
    results.add(shot.payload.result);
    if (shot.payload.result === 'hit') {
      const after = getShip(resolved.game, before.id);
      assert.deepEqual(shot.payload.consequences, shipConsequences(before, after));
      assert.deepEqual(shot.payload.consequences.after.systems, after.systems);
      assert.deepEqual(shot.payload.consequences.after.arcs, after.arcs);
      assert.equal(shot.payload.consequences.after.crew, after.crew);
    }
    assert.deepEqual(stripBattleRecordMetadata(resolved.game), applyPlayerAction(plain, action).game);
    assert.equal(Object.getOwnPropertySymbols(resolved.game).length, 0);
    assert.equal(JSON.stringify(resolved.game).includes('weapon-resolution'), false);
  }
  assert.deepEqual([...results].sort(), ['hit', 'miss']);
});

test('nested resolution collects each event once, resumes counters, and never saves raw records', () => {
  const game = enableBattleRecords(fixture(), { battleId: 'nested' });
  const collected = withBattleRecords(game, (input) => applyPlayerAction(input, { type: 'pass' }));
  assert.equal(collected.records.filter((record) => record.kind === 'action').length, 1);
  assert.equal(new Set(collected.records.map((record) => record.eventId)).size, collected.records.length);
  const saved = JSON.parse(JSON.stringify(collected.result.game));
  assert.deepEqual(saved.battleRecordState, collected.result.game.battleRecordState);
  assert.equal(Object.getOwnPropertySymbols(collected.result.game).length, 0);
  const next = applyPlayerAction({ ...saved, phase: 'player' }, { type: 'pass' });
  assert.notEqual(next.records[0].actionId, collected.records[0].actionId);
  assert.notEqual(next.records[0].eventId, collected.records[0].eventId);
  assert.deepEqual(withBattleRecords(next.game, (input) => input).records, [], 'reading emits nothing');
});

test('historical identities and knowledge remain frozen after capture and command transfer', () => {
  const game = enableBattleRecords(fixture(), { battleId: 'history' });
  const shot = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  const record = shot.records.find((entry) => entry.kind === 'weapon-resolution');
  const original = structuredClone(record);
  const future = { ...shot.game, playerShipId: 'fed-cruiser-1', ships: shot.game.ships.map((ship) => ship.id === 'axis-flagship' ? { ...ship, name: 'Prize', faction: 'Federation', x: 50 } : ship) };
  assert.deepEqual(record, original);
  assert.notEqual(record.target.name, getShip(future, 'axis-flagship').name);
  assert.equal(record.knowledge.observer.id, game.playerShipId);
  assert.ok(Object.isFrozen(record.target));
  assert.ok(Object.isFrozen(record.knowledge));
});

test('knowledge snapshots keep mapper, scanning, and radio facts independent', () => {
  const game = fixture('knowledge', { reimagined: true });
  const observer = getShip(game, game.playerShipId);
  const target = { ...getShip(game, 'axis-flagship'), x: 230, y: 230 };
  const damaged = { ...game, scanned: { [target.id]: true }, ships: game.ships.map((ship) => ship.id === observer.id ? { ...ship, systems: { ...ship.systems, mapper: 0, radio: 0 } } : ship.id === target.id ? target : ship) };
  const facts = snapshotKnowledge(damaged, { actor: observer, target, kind: 'destruction' });
  assert.equal(facts.ownAction, true);
  assert.equal(facts.target.visible, false);
  assert.equal(facts.target.scanned, true);
  assert.equal(facts.radioIntegrity, 0);
  assert.equal(facts.globalTerminal, true);
});

test('delayed knowledge uses current hull allegiance and position while attribution keeps the launch snapshot', () => {
  const game = enableBattleRecords(fixture('delayed-knowledge', { realtime: true }), { battleId: 'delayed-knowledge' });
  const issuer = getShip(game, game.playerShipId);
  const cause = { actionId: 'delayed-knowledge:a1', actor: structuredClone(issuer), source: 'manual', ordnanceId: 'delayed-knowledge:a1:ordnance' };
  const successor = getShip(game, 'fed-cruiser-1');
  const later = { ...game, playerShipId: successor.id, ships: game.ships.map((ship) => {
    if (ship.id === issuer.id) return { ...ship, name: 'Captured issuer', faction: 'Axis', x: 230, y: 230 };
    if (ship.id === successor.id) return { ...ship, x: 10, y: 10 };
    return ship;
  }) };
  const impact = withBattleCause(later, cause, (input) => ({ game: emitBattleRecord(input, { kind: 'ordnance-impact', payload: { result: 'empty' } }) }));
  const record = impact.records[0];
  assert.equal(record.actor.name, issuer.name);
  assert.equal(record.actor.faction, issuer.faction);
  assert.equal(record.actor.x, issuer.x);
  assert.equal(record.knowledge.observer.id, successor.id);
  assert.equal(record.knowledge.actor.friendly, false);
  assert.equal(record.knowledge.actor.visible, false);
  assert.equal(record.knowledge.actor.radioContact, false);
  assert.equal(record.knowledge.actor.own, false);
});

test('absent hull snapshots do not grant current knowledge and inactive observers follow mapper policy', () => {
  const game = fixture('absent-knowledge', { reimagined: true });
  const issuer = getShip(game, game.playerShipId);
  const target = getShip(game, 'axis-flagship');
  const absent = { ...game, ships: game.ships.filter((ship) => ship.id !== target.id) };
  const unknown = snapshotKnowledge(absent, { actor: issuer, target });
  assert.equal(unknown.target.visible, false);
  assert.equal(unknown.target.friendly, false);
  assert.equal(unknown.target.radioContact, false);
  const lost = { ...game, commandLost: true, ships: game.ships.map((ship) => ship.id === issuer.id ? { ...ship, status: 'destroyed' } : { ...ship, x: 230, y: 230 }) };
  const observed = snapshotKnowledge(lost, { actor: issuer, target });
  assert.equal(observed.observerActive, false);
  assert.equal(observed.spectator, true);
  assert.equal(observed.target.visible, true, 'mapper exposes remaining hulls without an active command');
  assert.equal(observed.target.radioContact, false);
  assert.equal(snapshotKnowledge({ ...lost, commandLost: false }, { target }).spectator, false, 'spectator flag uses authoritative engine flags');
});

test('rejected nested actions roll back tentative events without losing previous events', () => {
  const game = enableBattleRecords(fixture(), { battleId: 'rollback' });
  const collected = withBattleRecords(game, (input) => {
    const emitted = emitBattleRecord(input, { kind: 'repair', payload: { amount: 1 } });
    return withBattleAction(emitted, { actor: getShip(input, input.playerShipId), command: 'invalid', accepted: false }, (prepared) => ({ game: emitBattleRecord(prepared, { kind: 'damage' }) }));
  });
  assert.deepEqual(collected.records.map((entry) => entry.kind), ['repair']);
  assert.equal(collected.result.game.battleRecordState.nextAction, 1);
  assert.equal(collected.result.game.battleRecordState.nextEvent, 2);
});

test('a resumed ordnance cause retains its issuer without allocating another shot', () => {
  const game = enableBattleRecords(fixture(), { battleId: 'cause' });
  let cause;
  const launched = withBattleAction(game, { actor: getShip(game, game.playerShipId), source: 'automatic-conn', command: 'photons', accepted: true }, (input) => {
    cause = { ...battleActionOf(input), ordnanceId: 'cause:a1:ordnance' };
    return { game: emitBattleRecord(input, { kind: 'ordnance-launch' }) };
  });
  const resumed = JSON.parse(JSON.stringify({ ...launched.game, playerShipId: 'fed-cruiser-1' }));
  const impact = withBattleCause(resumed, cause, (input) => ({ game: emitBattleRecord(input, { kind: 'ordnance-impact', payload: { result: 'empty' } }) }));
  assert.equal(impact.records[0].actionId, launched.records[0].actionId);
  assert.equal(impact.records[0].actor.id, game.playerShipId);
  assert.equal(impact.records[0].ordnanceId, cause.ordnanceId);
  assert.equal(impact.game.battleRecordState.nextAction, 2);
});

test('computer phase stream is unique and mechanically identical when enabled', () => {
  const plain = fixture('record-round', { reimagined: true });
  const autoPlain = resolveAutopilotTurn(plain);
  const auto = resolveAutopilotTurn(enableBattleRecords(plain, { battleId: 'round' }));
  const records = [];
  const resolved = resolveComputerTurns(auto.game, { onRecords: (batch) => records.push(...batch) });
  assert.ok(records.length > 0);
  assert.equal(new Set([...auto.records, ...records].map((entry) => entry.eventId)).size, auto.records.length + records.length);
  assert.deepEqual(stripBattleRecordMetadata(resolved), resolveComputerTurns(autoPlain.game));
  assert.equal(Object.getOwnPropertySymbols(resolved).length, 0);
});
