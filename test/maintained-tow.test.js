import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, applyPlayerAction, maneuverTo } from '../game/actions.js';
import { enableBattleRecords } from '../game/battle-records.js';
import { maintainedTowMove, reconcileMaintainedTow } from '../game/maintained-tow.js';
import { createOperationGame, OPERATION_SEEDS } from '../game/operations.js';
import { SUBTICK } from '../game/realtime.js';
import { createGame, distance, getShip, maintainedTowPair, movementCapacity, powerAllocation } from '../game/state.js';
import { resolveAutopilotTurn, resolveComputerTurns, resolveDocking, resolveEncounters, stepContinuum } from '../game/turns.js';
import { appendRecords, createJournal, journalView, restoreJournal } from '../ui/battle-journal.js';
import { maintainedMovePreview } from '../ui/tow-preview.js';

const tugId = 'fed-flagship', targetId = 'fed-cruiser-1';
const edit = (game, id, patch) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...patch } : ship) });
const fixture = (options = {}) => {
  let game = createGame({ seed: 'maintained-tow', reimagined: true, ...options });
  game = { ...game, terrain: [], ships: game.ships.map((ship, i) => ({ ...ship, x: 200 + i * 2, y: 260, dest: null })) };
  game = edit(game, tugId, { x: 100, y: 100 });
  game = edit(game, targetId, { x: 100, y: 120, crew: 80 });
  return enableBattleRecords(game, { battleId: 'maintained-test' });
};
const attach = (game = fixture()) => {
  const result = applyPlayerAction(game, { type: 'tow-start', targetId });
  assert.notStrictEqual(result.game, game, result.messages.join(' '));
  assert.ok(maintainedTowPair(result.game));
  return result;
};
const ready = (game) => ({ ...game, phase: 'player', readyAt: {} });

test('establish once, move both hulls at tractor-limited speed, release using normal action budgets', () => {
  const original = fixture();
  const started = attach(original);
  assert.equal(started.game.phase, 'computer');
  assert.equal(started.game.randomStep, original.randomStep);
  assert.equal(getShip(started.game, targetId).y, 120);
  assert.equal(movementCapacity(started.game, getShip(started.game, tugId)), 15);
  let game = ready(started.game);
  for (let i = 0; i < 3; i++) {
    const result = applyPlayerAction(game, { type: 'move', dx: -10, dy: 0 });
    assert.equal(result.game.phase, 'computer');
    game = ready(result.game);
    assert.equal(getShip(game, targetId).x, getShip(game, tugId).x);
    assert.equal(getShip(game, targetId).y - getShip(game, tugId).y, 20);
    assert.ok(maintainedTowPair(game));
  }
  const released = applyPlayerAction(game, { type: 'tow-release' });
  assert.equal(released.game.phase, 'computer');
  assert.equal(released.game.maintainedTow, undefined);
  assert.equal(getShip(released.game, targetId).tractorBy, null);
  assert.ok(movementCapacity(released.game, getShip(released.game, tugId)) > 15);
});

test('rejects excess speed, known hull crossings and off-map passengers without spending a turn or RNG', () => {
  let game = ready(attach().game);
  for (const action of [{ type: 'move', dx: 16, dy: 0 }, { type: 'tractor', targetId }, { type: 'hyperspace' }, { type: 'autopilot' }]) {
    assert.strictEqual(applyPlayerAction(game, action).game, game);
    assert.equal(actionAvailability(game, action).available, false);
  }
  assert.deepEqual(resolveAutopilotTurn(game).game, game);
  game = edit(game, 'fed-cruiser-2', { x: 95, y: 120 });
  assert.match(maintainedMovePreview(game, -10, 0), /blocked/);
  assert.strictEqual(applyPlayerAction(game, { type: 'move', dx: -10, dy: 0 }).game, game);
  game = edit(game, tugId, { x: 10, y: 10 });
  game = edit(game, targetId, { x: 5, y: 30 });
  game = { ...game, maintainedTow: { ...game.maintainedTow, offsetX: -5 } };
  assert.match(maintainedTowMove(game, -10, 0).error, /outside the map/);
  assert.strictEqual(applyPlayerAction(game, { type: 'move', dx: -10, dy: 0 }).game, game);
});

test('power and engine damage constrain speed; loss of tractor power ends the link and frees the passenger', () => {
  let game = ready(attach().game);
  const tug = getShip(game, tugId);
  game = { ...game, power: { ...game.power, [tugId]: { ...powerAllocation(game, tug), tractor: 1 } } };
  assert.equal(movementCapacity(game, tug), 7.5);
  assert.ok(Math.hypot(...Object.values(maneuverTo(game, 0, 100))) <= 7.5);
  game = edit(game, tugId, { systems: { ...tug.systems, engines: 0 } });
  assert.equal(movementCapacity(game, getShip(game, tugId)), 0);
  assert.ok(maintainedTowPair(game), 'Engine loss holds the connection rather than silently abandoning the passenger.');
  game = edit(game, tugId, { systems: tug.systems });
  const lost = applyPlayerAction(game, { type: 'power', sink: 'tractor', delta: -1 });
  assert.equal(lost.game.maintainedTow, undefined);
  assert.equal(getShip(lost.game, targetId).tractorBy, null);
  assert.match(lost.game.towNotice, /power/);
  const journal = journalView(appendRecords(createJournal('maintained-test'), lost.records));
  assert.ok(journal.yourShip.some((card) => /tractor hardware or power/.test(card.summary)));
});

test('hostiles, vacant/immovable hulls, close spacing and contested locks cannot enter maintained tow', () => {
  const game = fixture();
  for (const patch of [{ faction: 'Axis' }, { status: 'vacant' }, { crew: 0 }, { className: 'Starbase' }, { y: 102 }, { y: 150 }, { tractorBy: 'axis-flagship' }]) {
    const changed = edit(game, targetId, patch);
    assert.strictEqual(applyPlayerAction(changed, { type: 'tow-start', targetId }).game, changed, JSON.stringify(patch));
  }
});

test('breaks safely on command transfer, capture, destruction, loss of hardware and link disruption', () => {
  const game = attach().game;
  for (const changed of [
    { ...game, playerShipId: 'fed-cruiser-2' }, edit(game, targetId, { faction: 'Axis' }),
    edit(game, tugId, { status: 'destroyed', crew: 0 }), edit(game, targetId, { status: 'destroyed', crew: 0 }),
    edit(game, tugId, { systems: { ...getShip(game, tugId).systems, tractor: 0 } }),
    edit(game, targetId, { tractorBy: 'axis-flagship' }), edit(game, targetId, { x: 190 }),
  ]) {
    const fixed = reconcileMaintainedTow(changed);
    assert.equal(fixed.maintainedTow, undefined);
    assert.ok(fixed.towNotice);
    assert.strictEqual(reconcileMaintainedTow(fixed), fixed);
    if (getShip(changed, targetId).tractorBy === 'axis-flagship') assert.equal(getShip(fixed, targetId).tractorBy, 'axis-flagship');
  }
});

test('hidden hulls are not named or used to refuse a course; actual endpoint collisions still resolve', () => {
  let game = ready(attach().game);
  game = edit(game, targetId, { y: 130 });
  game = { ...game, maintainedTow: { ...game.maintainedTow, offsetY: 30 }, terrain: [{ type: 'nebula', x: 90, y: 130, radius: 6 }] };
  game = edit(game, 'axis-flagship', { x: 90, y: 130 });
  assert.equal(maintainedTowMove(game, -10, 0).error, undefined);
  assert.doesNotMatch(maintainedMovePreview(game, -10, 0), new RegExp(getShip(game, 'axis-flagship').name));
  const result = applyPlayerAction(game, { type: 'move', dx: -10, dy: 0 });
  assert.ok(result.game.ships.some((ship) => [targetId, 'axis-flagship'].includes(ship.id) && ship.status === 'destroyed'));
});

test('real-time courses carry both hulls, charge connection/release cooldown, stop together and resume identically after reload', () => {
  let game = fixture({ realtime: true });
  game = edit(game, tugId, { dest: { x: 200, y: 100 } });
  game = edit(game, targetId, { dest: { x: 200, y: 200 } });
  game = attach(game).game;
  assert.equal(getShip(game, tugId).dest, null);
  assert.equal(getShip(game, targetId).dest, null);
  assert.equal(actionAvailability(game, { type: 'tow-release' }).reasonCode, 'cooldown');
  game = applyPlayerAction(game, { type: 'move', dx: -12, dy: 0 }).game;
  for (let i = 0; i < 3; i++) game = stepContinuum(game).game;
  const resumed = JSON.parse(JSON.stringify(game));
  const run = (start) => {
    for (let i = 0; i < 10; i++) {
      start = stepContinuum(start).game;
      assert.ok(maintainedTowPair(start));
      assert.ok(Math.abs(getShip(start, targetId).y - getShip(start, tugId).y - 20) < 1e-6);
    }
    return JSON.parse(JSON.stringify(start));
  };
  const end = run(game);
  assert.deepEqual(run(resumed), end);
  assert.equal(getShip(end, tugId).x, 88);
  assert.equal(getShip(end, targetId).x, 88);
  assert.equal(getShip(end, tugId).dest, null);
  assert.equal(actionAvailability(end, { type: 'tow-release' }).available, true);
});

test('a new visible real-time obstruction cancels the course once, retaining the tow', () => {
  let game = attach(fixture({ realtime: true })).game;
  game = applyPlayerAction(game, { type: 'move', dx: -60, dy: 0 }).game;
  game = stepContinuum(game).game;
  const passenger = getShip(game, targetId);
  game = edit(game, 'fed-cruiser-2', { x: passenger.x - 15 * SUBTICK, y: passenger.y });
  const stopped = stepContinuum(game);
  assert.equal(getShip(stopped.game, tugId).dest, null);
  assert.equal(getShip(stopped.game, targetId).x, passenger.x);
  assert.ok(maintainedTowPair(stopped.game));
  assert.equal(stopped.records.filter((record) => record.kind === 'maintained-tow-blocked').length, 1);
  assert.equal(stepContinuum(stopped.game).records.filter((record) => record.kind === 'maintained-tow-blocked').length, 0);
});

test('Classic rejects maintained commands and ignores forged maintained state', () => {
  let game = fixture({ reimagined: false });
  const baseSpeed = movementCapacity(game, getShip(game, tugId));
  game = { ...game, maintainedTow: { tugId, targetId, offsetX: 0, offsetY: 20 } };
  for (const type of ['tow-start', 'tow-release']) assert.strictEqual(applyPlayerAction(game, { type, targetId }).game, game);
  assert.equal(movementCapacity(game, getShip(game, tugId)), baseSpeed);
  assert.strictEqual(reconcileMaintainedTow(game), game);
});

for (const seed of OPERATION_SEEDS) test(`${seed}: one maintained connection completes rescue with normal movement and extraction`, () => {
  let game = createOperationGame({ seed, battleId: 'rescue-maintained' });
  const issue = (action) => {
    const result = applyPlayerAction(game, action);
    assert.notStrictEqual(result.game, game, result.messages.join(' '));
    game = result.game.phase === 'computer' ? resolveComputerTurns(result.game) : result.game;
  };
  issue({ type: 'move', dx: 45, dy: -20 });
  const target = getShip(game, 'op-sentinel'), tug = getShip(game, game.playerShipId);
  issue({ type: 'move', dx: target.x - 17 - tug.x, dy: target.y - 20 - tug.y });
  issue({ type: 'tow-start', targetId: 'op-sentinel' });
  let moves = 0;
  for (; moves < 15 && game.operation.primary === 'pending'; moves++) {
    const pair = maintainedTowPair(game);
    assert.ok(pair, `connection lost at elapsed ${game.operation.elapsed}`);
    const move = maneuverTo(game, game.operation.exit.x - pair.link.offsetX, game.operation.exit.y - pair.link.offsetY);
    issue({ type: 'move', ...move });
    if (moves === 2) game = JSON.parse(JSON.stringify(game));
  }
  assert.equal(game.operation.primary, 'secured');
  assert.equal(game.maintainedTow, undefined);
  assert.ok(game.operation.assists['op-command'] >= 90);
  for (let i = 0; i < 10 && !game.operation.result; i++) issue({ type: 'move', ...maneuverTo(game, 38, 160) });
  assert.equal(game.operation.result.primary, 'success');
  assert.equal(game.operation.result.returned.length, 4);
  assert.ok(game.operation.result.elapsed <= 16);
});

test('maintained command facts survive journal reload without inventing passenger locations', () => {
  const result = attach();
  const saved = appendRecords(createJournal('maintained-test'), result.records);
  const card = journalView(restoreJournal(JSON.parse(JSON.stringify(saved)), 'maintained-test')).recentCommands[0];
  assert.match(card.summary, /established a maintained tow/);
});

test('ordinary distress rescue survives its deadline under tow, then releases for dockyard repair', () => {
  let game = fixture();
  game = edit(game, targetId, { systems: { ...getShip(game, targetId).systems, engines: 0 }, encounter: { type: 'distress', turn: 1 } });
  game = attach(game).game;
  game = { ...game, turn: 25 };
  assert.equal(getShip(resolveEncounters(game).game, targetId).status, 'active');
  const base = game.ships.find((ship) => ship.faction === getShip(game, targetId).faction && ship.className === 'Starbase');
  game = edit(game, base.id, { x: 105, y: 120 });
  assert.equal(getShip(resolveDocking(game).game, targetId).systems.engines, 0);
  game = applyPlayerAction(ready(game), { type: 'tow-release' }).game;
  game = resolveEncounters(game).game;
  assert.equal(getShip(game, targetId).status, 'active', 'Release grants a fresh distress window, including time to dock.');
  assert.ok(getShip(resolveDocking(game).game, targetId).systems.engines > 0);
  assert.equal(getShip(resolveEncounters({ ...game, turn: 46 }).game, targetId).status, 'vacant', 'A released and unrepaired ship can still be abandoned.');
});

test('both towed hulls remain exposed to normal asteroid checks', () => {
  let game = ready(attach().game);
  game = { ...game, terrain: [{ type: 'asteroids', x: 90, y: 110, radius: 15 }] };
  assert.equal(maintainedTowMove(game, -10, 0).rocks, true);
  const moved = applyPlayerAction(game, { type: 'move', dx: -10, dy: 0 });
  assert.equal(moved.game.randomStep, game.randomStep + 2);
  assert.ok(maintainedTowPair(moved.game));
});

test('real-time tractor power loss stops the tug course and releases the passenger', () => {
  let game = ready(attach(fixture({ realtime: true })).game);
  game = applyPlayerAction(game, { type: 'move', dx: -60, dy: 0 }).game;
  const units = powerAllocation(game, getShip(game, tugId)).tractor;
  for (let i = 0; i < units; i++) game = applyPlayerAction(game, { type: 'power', sink: 'tractor', delta: -1 }).game;
  assert.equal(game.maintainedTow, undefined);
  assert.equal(getShip(game, tugId).dest, null);
  assert.equal(getShip(game, targetId).tractorBy, null);
});
