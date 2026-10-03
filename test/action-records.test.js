import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction, detonate, resolveCollision, spreadSplash } from '../game/actions.js';
import { createRng } from '../game/rng.js';
import { enableBattleRecords, shipConsequences, stripBattleRecordMetadata, withBattleRecords } from '../game/battle-records.js';

const staged = (seed = 'phaser-hit-2', options = {}) => {
  const game = createGame({ seed, ...options });
  return { ...game, ships: game.ships.map((ship, index) => ship.id === game.playerShipId
    ? { ...ship, x: 10, y: 10 }
    : ship.id === 'axis-flagship' ? { ...ship, x: 16, y: 10 }
      : { ...ship, x: 70 + index, y: 80 }) };
};
const enabled = (game) => enableBattleRecords(game, { battleId: 'action-test' });
const replace = (game, id, changes) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...changes } : ship) });

test('manual hit and miss each use one causal identity and the actual resolved facts', () => {
  for (const [seed, expected] of [['phaser-hit-2', 'hit'], ['phaser-hit', 'miss']]) {
    const game = enabled(staged(seed));
    const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
    const action = result.records.find((record) => record.kind === 'action');
    const shot = result.records.find((record) => record.kind === 'weapon-resolution');
    assert.equal(result.records.filter((record) => record.kind === 'action').length, 1);
    assert.equal(shot.actionId, action.actionId);
    assert.equal(shot.source, 'manual');
    assert.equal(shot.payload.result, expected);
    assert.equal(shot.actor.name, 'Argo');
    assert.equal(result.game.battleRecordState.nextAction, 2);
    if (expected === 'hit') assert.deepEqual(shot.payload.consequences, shipConsequences(getShip(game, 'axis-flagship'), getShip(result.game, 'axis-flagship')));
    else assert.equal(getShip(result.game, 'axis-flagship').shields, getShip(game, 'axis-flagship').shields);
  }
});

test('refused commands and read-only reports retain input identity and allocate nothing', () => {
  const game = enabled(staged());
  for (const action of [
    { type: 'phasers' }, { type: 'phasers', targetId: game.playerShipId },
    { type: 'move', dx: 999, dy: 0 }, { type: 'unknown' }, { type: 'computer' },
  ]) {
    const result = applyPlayerAction(game, action);
    assert.equal(result.game, game);
    assert.deepEqual(result.records, []);
    assert.equal(game.battleRecordState.nextAction, 1);
    assert.equal(game.battleRecordState.nextEvent, 1);
  }
  const cooling = { ...game, realtime: true, readyAt: { [game.playerShipId]: 100 } };
  const result = applyPlayerAction(cooling, { type: 'photons', targetId: 'axis-flagship' });
  assert.equal(result.game, cooling);
  assert.deepEqual(result.records, []);
});

test('directional shields, crew and system deltas are taken from the resolved hull', () => {
  const base = staged('phaser-hit-2', { reimagined: true });
  const target = getShip(base, 'axis-flagship');
  const game = enabled(replace(base, target.id, { shields: 2, arcs: { fore: 0, aft: 0, port: 1, starboard: 1 }, crew: 100 }));
  const result = applyPlayerAction(game, { type: 'phasers', targetId: target.id });
  const shot = result.records.find((record) => record.kind === 'weapon-resolution');
  assert.equal(shot.payload.result, 'hit');
  assert.deepEqual(shot.payload.consequences, shipConsequences(getShip(game, target.id), getShip(result.game, target.id)));
  assert.ok(shot.payload.consequences.delta.shields < 0);
  assert.ok(shot.payload.consequences.delta.crew < 0);
  assert.ok(Object.values(shot.payload.consequences.delta.arcs).some((delta) => delta < 0));
  const focused = enabled(replace(staged('phaser-hit-2', { reimagined: true, precision: true }), target.id, { shields: 0, arcs: { fore: 0, aft: 0, port: 0, starboard: 0 } }));
  const focusedResult = applyPlayerAction(focused, { type: 'phasers', targetId: target.id, focus: 'engines' });
  const focusedShot = focusedResult.records.find((record) => record.kind === 'weapon-resolution');
  assert.equal(focusedShot.payload.focus, 'engines');
  assert.equal(focusedShot.payload.consequences.delta.crew, 0);
  assert.ok(focusedShot.payload.consequences.delta.systems.engines < 0);
});

test('capture preserves issuing ownership while command transfers to the prize', () => {
  const game = enabled(replace(staged('capture', { reimagined: true }), 'axis-flagship', { status: 'vacant', crew: 0 }));
  const result = applyPlayerAction(game, { type: 'transport', targetId: 'axis-flagship', amount: 8, transferCommand: true });
  const capture = result.records.find((record) => record.kind === 'capture');
  assert.equal(capture.actorId, game.playerShipId);
  assert.equal(capture.target.faction, 'Axis');
  assert.equal(capture.payload.fromFaction, 'Axis');
  assert.equal(capture.payload.toFaction, 'Federation');
  assert.equal(result.game.playerShipId, 'axis-flagship');
  assert.equal(capture.actionId, result.records[0].actionId);
});

test('manual requests retain only execution parameters and movement/shield facts are final', () => {
  const game = enabled(staged());
  const move = applyPlayerAction(game, { type: 'move', dx: 2, dy: 0, uiState: { menu: 'open' }, mouseEvent: () => {} });
  const action = move.records.find((record) => record.kind === 'action');
  assert.deepEqual(action.payload.request, { dx: 2, dy: 0 });
  const movement = move.records.find((record) => record.kind === 'movement');
  assert.deepEqual(movement.payload.consequences, shipConsequences(getShip(game, game.playerShipId), getShip(move.game, game.playerShipId)));
  const damaged = enabled(replace(staged('shield-facts', { reimagined: true }), game.playerShipId, {
    shields: 10, arcs: { fore: 4, starboard: 2, aft: 2, port: 2 },
  }));
  const flush = applyPlayerAction(damaged, { type: 'shields' });
  const recovery = flush.records.find((record) => record.kind === 'shield-recovery');
  assert.deepEqual(recovery.payload.consequences, shipConsequences(getShip(damaged, game.playerShipId), getShip(flush.game, game.playerShipId)));
  assert.equal(recovery.payload.gained, recovery.payload.consequences.delta.shields);
  const live = enabled(staged('course-facts', { realtime: true }));
  const plotted = applyPlayerAction(live, { type: 'move', dx: 20, dy: 1 });
  const course = plotted.records.find((record) => record.kind === 'course-plotted');
  assert.deepEqual(course.payload.destination, { x: 30, y: 11 });
  assert.equal(course.payload.consequences.delta.x, 0, 'plotting a course does not claim the flight already happened');
});

test('manual setting results show the applied heading, clamped allocation and delivered order', () => {
  const game = enabled(staged('confirmed-settings', { reimagined: true }));
  const facing = applyPlayerAction(game, { type: 'facing', degrees: 405 });
  const facingResult = facing.records.find((record) => record.kind === 'action-resolution');
  assert.equal(facingResult.payload.after.heading, 45);
  assert.equal(facingResult.payload.after.heading, getShip(facing.game, game.playerShipId).facing);
  const allocation = { shields: 999, weapons: 999, engines: 999, sensors: 999, tractor: 999 };
  const power = applyPlayerAction(game, { type: 'power', allocation });
  const powerResult = power.records.find((record) => record.kind === 'action-resolution');
  assert.deepEqual(powerResult.payload.after.power, power.game.power[game.playerShipId]);
  assert.notDeepEqual(powerResult.payload.after.power, allocation);
  assert.deepEqual(power.records[0].payload.request.allocation, allocation);
  const orders = applyPlayerAction(game, { type: 'orders', shipId: game.playerShipId, order: { type: 'hold' } });
  const orderResult = orders.records.find((record) => record.kind === 'action-resolution');
  assert.deepEqual(orderResult.payload.after.order, orders.game.orders[game.playerShipId]);
  const refused = applyPlayerAction(game, { type: 'facing', degrees: 'invalid' });
  assert.equal(refused.game, game);
  assert.deepEqual(refused.records, []);
});

test('resignation and explicit prize command transfers report the actual successor once', () => {
  const game = enabled(staged('confirmed-transfer'));
  const resignation = applyPlayerAction(game, { type: 'resign' });
  const resolved = resignation.records.find((record) => record.kind === 'action-resolution');
  const transfers = resignation.records.filter((record) => record.kind === 'command-transfer');
  assert.equal(resolved.payload.before.playerShipId, game.playerShipId);
  assert.equal(resolved.payload.after.playerShipId, resignation.game.playerShipId);
  assert.equal(resolved.payload.after.resigned, true);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].payload.fromId, game.playerShipId);
  assert.equal(transfers[0].payload.toId, resignation.game.playerShipId);
  assert.equal(transfers[0].target.name, getShip(resignation.game, resignation.game.playerShipId).name);
  const vacant = enabled(replace(staged('confirmed-prize', { reimagined: true }), 'axis-flagship', { status: 'vacant', crew: 0 }));
  const capture = applyPlayerAction(vacant, { type: 'transport', targetId: 'axis-flagship', amount: 8, transferCommand: true });
  assert.equal(capture.records.filter((record) => record.kind === 'command-transfer').length, 1);
  assert.equal(capture.records.find((record) => record.kind === 'command-transfer').payload.toId, 'axis-flagship');
});

test('shared spread, collision and detonation helpers emit each resolved hull once', () => {
  const game = enabled(staged('shared', { reimagined: true }));
  const actor = getShip(game, game.playerShipId);
  const target = getShip(game, 'axis-flagship');
  const splash = withBattleRecords(game, (prepared) => spreadSplash(prepared, actor, target, 15, createRng('spread-facts')));
  const damage = splash.records.filter((record) => record.kind === 'damage');
  assert.equal(damage.length, 1);
  assert.deepEqual(damage[0].payload.consequences, shipConsequences(target, getShip(splash.result.game, target.id)));
  const overlapping = replace(game, target.id, { x: actor.x, y: actor.y });
  const collision = withBattleRecords(overlapping, (prepared) => resolveCollision(prepared, getShip(prepared, actor.id)));
  assert.equal(collision.records.filter((record) => record.kind === 'collision').length, 1);
  assert.equal(collision.records.filter((record) => record.kind === 'damage').length, 2);
  const blast = withBattleRecords(game, (prepared) => detonate(prepared, actor));
  const affected = blast.records.filter((record) => record.kind === 'damage');
  assert.equal(new Set(affected.map((record) => record.targetId)).size, affected.length);
  for (const record of affected) assert.deepEqual(record.payload.consequences, shipConsequences(getShip(game, record.targetId), getShip(blast.result.game, record.targetId)));
});

test('recording preserves messages, FX, RNG and mechanical state across manual actions', () => {
  for (const [options, action] of [
    [{}, { type: 'phasers', targetId: 'axis-flagship' }],
    [{}, { type: 'move', dx: 6, dy: 0 }],
    [{}, { type: 'hyperspace', x: 50, y: 50 }],
    [{}, { type: 'self-destruct' }],
    [{ reimagined: true }, { type: 'spread', targetId: 'axis-flagship' }],
    [{ realtime: true }, { type: 'photons', targetId: 'axis-flagship' }],
  ]) {
    const game = staged('parity', options);
    const plain = applyPlayerAction(game, action);
    const recorded = applyPlayerAction(enabled(game), action);
    assert.deepEqual(stripBattleRecordMetadata(recorded.game), plain.game);
    assert.deepEqual(recorded.messages, plain.messages);
    assert.deepEqual(recorded.events, plain.events);
    assert.equal(recorded.game.randomStep, plain.game.randomStep);
    assert.equal(Object.getOwnPropertySymbols(recorded.game).length, 0);
    assert.equal(recorded.game.records, undefined);
  }
});

test('saved ordnance retains its causal issuer after death and command transfer', async () => {
  const { stepContinuum } = await import('../game/turns.js');
  const game = enabled(staged('phaser-hit-2', { realtime: true }));
  const launch = applyPlayerAction(game, { type: 'photons', targetId: 'axis-flagship' });
  const launched = launch.records.find((record) => record.kind === 'ordnance-launch');
  assert.equal(launched.payload.result, 'pending');
  let next = JSON.parse(JSON.stringify(launch.game));
  const causal = next.ordnance[0].causal;
  assert.equal(causal.actionId, launched.actionId);
  assert.equal(causal.ordnanceId, launched.ordnanceId);
  next = { ...replace(next, game.playerShipId, { status: 'destroyed', faction: 'Axis', name: 'Later owner' }), playerShipId: 'fed-cruiser-1' };
  const records = [];
  for (let step = 0; step < 20 && next.ordnance.length; step += 1) {
    const result = stepContinuum(next);
    next = result.game;
    records.push(...(result.records ?? []));
  }
  const impact = records.find((record) => record.kind === 'ordnance-impact');
  assert.ok(impact);
  assert.equal(impact.actionId, launched.actionId);
  assert.equal(impact.ordnanceId, launched.ordnanceId);
  assert.equal(impact.actor.name, 'Argo');
  assert.equal(impact.actor.faction, 'Federation');
  assert.equal(impact.source, 'manual');
  assert.equal(getShip(next, game.playerShipId).shotsFired, 1);
  assert.equal(records.filter((record) => record.kind === 'action' && record.actionId === launched.actionId).length, 0);
});

test('a delayed spread retains launch ownership when its surviving launcher changes hands', async () => {
  const { stepContinuum } = await import('../game/turns.js');
  const game = enabled(staged('phaser-hit-2', { realtime: true, reimagined: true }));
  const launch = applyPlayerAction(game, { type: 'spread', targetId: 'axis-flagship' });
  const launched = launch.records.find((record) => record.kind === 'ordnance-launch');
  let next = { ...replace(launch.game, game.playerShipId, { faction: 'Axis', name: 'Captured launcher' }), playerShipId: 'fed-cruiser-1' };
  const records = [];
  for (let step = 0; step < 20 && next.ordnance.length; step += 1) {
    const result = stepContinuum(next);
    next = result.game;
    records.push(...result.records);
  }
  const damage = records.filter((record) => record.kind === 'damage' && record.actionId === launched.actionId);
  assert.ok(damage.length > 0);
  for (const record of damage) {
    assert.equal(record.ordnanceId, launched.ordnanceId);
    assert.equal(record.actor.name, 'Argo');
    assert.equal(record.actor.faction, 'Federation');
  }
});
