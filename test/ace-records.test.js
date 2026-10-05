import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction, captureHull, detonate, spreadSplash } from '../game/actions.js';
import { createRng } from '../game/rng.js';
import { ACE_KILLS } from '../game/constants.js';
import { enableBattleRecords, stripBattleRecordMetadata, withBattleRecords } from '../game/battle-records.js';
import { resolveAutopilotTurn, stepContinuum } from '../game/turns.js';

const actorId = 'fed-flagship';
const targetId = 'axis-flagship';
const replace = (game, id, changes) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...changes } : ship) });
const weakened = (ship) => ({ ...ship, shields: 0, arcs: { fore: 0, aft: 0, port: 0, starboard: 0 }, crew: 1,
  systems: Object.fromEntries(Object.keys(ship.systems).map((key) => [key, 0])) });
const fixture = (options = {}) => {
  const game = createGame({ seed: 'phaser-hit-2', reimagined: true, ...options });
  return { ...game, terrain: [], ships: game.ships.map((ship, index) => ship.id === actorId
    ? { ...ship, x: 10, y: 10, kills: ACE_KILLS - 1, systems: { ...ship.systems, photons: 0 } }
    : ship.id === targetId ? { ...weakened(ship), x: 16, y: 10 }
      : { ...ship, x: 120 + index * 3, y: 200, dest: null }) };
};
const enabled = (game) => enableBattleRecords(game, { battleId: 'ace-test' });
const aceOf = (result) => {
  const records = result.records.filter((record) => record.kind === 'ace');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].payload, { beforeKills: ACE_KILLS - 1, kills: ACE_KILLS });
  return records[0];
};

test('manual and AI kill counter crossings emit the actual captain once without mechanical changes', () => {
  for (const automatic of [false, true]) {
    const game = fixture();
    const resolve = automatic ? resolveAutopilotTurn : (input) => applyPlayerAction(input, { type: 'phasers', targetId });
    const plain = resolve(game);
    const recorded = resolve(enabled(game));
    const ace = aceOf(recorded);
    assert.equal(ace.actorId, actorId);
    assert.equal(ace.actor.captain, getShip(game, actorId).captain);
    assert.equal(ace.source, automatic ? 'auto-conn' : 'manual');
    assert.equal(ace.actionId, recorded.records.find((record) => record.kind === 'action').actionId);
    assert.deepEqual(stripBattleRecordMetadata(recorded.game), plain.game);
    assert.deepEqual(recorded.messages, plain.messages);
    assert.deepEqual(recorded.events, plain.events);
  }
});

test('a veteran ace fact preserves threshold-time labels after later actual capture', () => {
  const game = enabled(fixture());
  const shot = applyPlayerAction(game, { type: 'phasers', targetId });
  const ace = aceOf(shot);
  const beforeCapture = replace(shot.game, actorId, { status: 'vacant', crew: 0 });
  const enemy = beforeCapture.ships.find((ship) => ship.faction === 'Axis' && ship.id !== targetId);
  const captured = withBattleRecords(beforeCapture, (input) => captureHull(input, enemy, getShip(input, actorId), 8));
  const after = getShip(captured.result.game, actorId);
  assert.equal(after.faction, 'Axis');
  assert.notEqual(after.captain, ace.actor.captain);
  assert.equal(ace.actor.faction, 'Federation');
  assert.equal(ace.actor.captain, getShip(game, actorId).captain);
  assert.equal(Object.isFrozen(ace.actor), true);
  assert.equal(captured.records.filter((record) => record.kind === 'ace').length, 0);
});

test('a newly captured prize can reach ace during its first engagement under its new captain', () => {
  let game = fixture();
  const original = createGame({ seed: 'phaser-hit-2', reimagined: true });
  const prizeSource = getShip(original, targetId);
  game = replace(game, targetId, { ...prizeSource, x: 16, y: 10, status: 'vacant', crew: 0, kills: ACE_KILLS - 1 });
  const enemyId = game.ships.find((ship) => ship.faction === 'Axis' && ship.id !== targetId).id;
  game = replace(game, enemyId, { ...weakened(getShip(game, enemyId)), x: 22, y: 10 });
  const boarded = applyPlayerAction(enabled(game), { type: 'transport', targetId, amount: 8, transferCommand: true });
  assert.equal(boarded.game.playerShipId, targetId);
  const prize = getShip(boarded.game, targetId);
  assert.equal(prize.kills, ACE_KILLS - 1);
  const shot = applyPlayerAction({ ...boarded.game, phase: 'player' }, { type: 'phasers', targetId: enemyId });
  const ace = aceOf(shot);
  assert.equal(ace.actorId, targetId);
  assert.equal(ace.actor.captain, prize.captain);
  assert.equal(ace.actor.faction, 'Federation');
});

test('a delayed photon records the captain used by the actual live kill counter at impact', () => {
  let game = fixture({ realtime: true });
  game = replace(game, actorId, { systems: { ...getShip(game, actorId).systems, photons: 2 } });
  const launch = applyPlayerAction(enabled(game), { type: 'photons', targetId });
  assert.equal(launch.records.filter((record) => record.kind === 'ace').length, 0);
  let next = JSON.parse(JSON.stringify(launch.game));
  next = replace(next, actorId, { captain: 'Impact captain', name: 'Renamed launcher' });
  const records = [];
  for (let step = 0; step < 7 && next.ordnance.length; step += 1) {
    const resolved = stepContinuum(next);
    next = resolved.game;
    records.push(...resolved.records);
  }
  const ace = aceOf({ records });
  assert.equal(ace.actor.captain, 'Impact captain');
  assert.equal(ace.actor.name, 'Renamed launcher');
  assert.equal(ace.ordnanceId, launch.records.find((record) => record.kind === 'ordnance-launch').ordnanceId);
  assert.equal(ace.actionId, launch.records[0].actionId);
});

test('spread and self-destruct record one threshold crossing even when multiple kills jump past it', () => {
  for (const kind of ['spread', 'self-destruct']) {
    let game = fixture();
    const enemy = game.ships.find((ship) => ship.faction === 'Axis' && ship.id !== targetId);
    game = replace(game, enemy.id, { ...weakened(enemy), x: 16, y: 10 });
    const resolve = kind === 'spread'
      ? (input) => spreadSplash(input, getShip(input, actorId), getShip(input, targetId), 1000, createRng('ace-spread'))
      : (input) => detonate(input, getShip(input, actorId));
    const plain = resolve(game);
    const recorded = withBattleRecords(enabled(game), resolve);
    const aces = recorded.records.filter((record) => record.kind === 'ace');
    assert.equal(aces.length, 1);
    assert.deepEqual(aces[0].payload, { beforeKills: ACE_KILLS - 1, kills: ACE_KILLS + 1 });
    assert.equal(aces[0].actorId, actorId);
    assert.deepEqual(stripBattleRecordMetadata(recorded.result.game), plain.game);
    assert.deepEqual(recorded.result.messages, plain.messages);
    assert.deepEqual(recorded.result.events, plain.events);
  }
});

test('misses, existing aces, and Classic kills do not emit a new Reimagined ace fact', () => {
  for (const options of [{ seed: 'phaser-hit' }, { kills: ACE_KILLS }, { reimagined: false }]) {
    let game = fixture({ reimagined: options.reimagined !== false });
    if (options.seed) game = { ...game, seed: options.seed };
    if (options.kills) game = replace(game, actorId, { kills: options.kills });
    const shot = applyPlayerAction(enabled(game), { type: 'phasers', targetId });
    assert.equal(shot.records.filter((record) => record.kind === 'ace').length, 0);
  }
});
