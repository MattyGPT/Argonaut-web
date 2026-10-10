import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerAction, captureHull, maneuverTo } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { createGame, getShip, movementCapacity } from '../game/state.js';
import { createOperationGame, OPERATION_SEEDS, validOperationSave } from '../game/operations.js';
import { recoverDecision, recoveredPrizeDecision, updateOperationOrderReports } from '../game/operation-orders.js';
import { resolveComputerTurns } from '../game/turns.js';
import { operationPanelMarkup } from '../ui/operations.js';
import { reportFor } from '../ui/render.js';
import { appendRecords, createJournal, formatJournalEvent, restoreJournal } from '../ui/battle-journal.js';

const fresh = (seed = 'rescue-1') => createOperationGame({ seed, battleId: `recovery:${seed}` });
const edit = (game, id, patch) => ({ ...game, ships: game.ships.map((s) => s.id === id ? { ...s, ...patch } : s) });
const command = (game, action, records = []) => {
  const out = applyPlayerAction(game, action);
  assert.notEqual(out.game, game, out.messages?.join(' '));
  records.push(...out.records);
  return out.game.phase === 'computer' ? resolveComputerTurns(out.game, { onRecords: (batch) => records.push(...batch) }) : out.game;
};
const assign = (game, id = 'op-scout', type = 'recover') => command(game, { type: 'orders', shipId: id, order: { type } });
const close = () => edit(edit(fresh(), 'op-command', { x: 140, y: 74 }), 'op-scout', { x: 164, y: 74 });
const boarded = () => command(assign(close()), { type: 'pass' });
const save = (game) => ({ version: 1, game, resume: { game: null, view: {} } });
const play = (seed, captain, reload = false) => {
  let game = assign(assign(fresh(seed), captain === 'op-scout' ? 'op-escort' : 'op-scout', 'rescue'), captain);
  const records = [];
  for (let i = 0; i < 22 && !game.operation.result; i++) {
    if (reload) {
      game = JSON.parse(JSON.stringify(game));
      assert.equal(validOperationSave(save(game)), true);
    }
    const before = game;
    game = command(game, game.operation.primary === 'secured' && game.operation.extracted.some((s) => s.id === game.operation.prizeId)
      ? { type: 'move', ...maneuverTo(game, 38, 160) } : { type: 'pass' }, records);
    for (const id of [captain, game.operation.prizeId]) {
      const prior = getShip(before, id), after = getShip(game, id);
      if (prior && after && prior.status === 'active') assert.ok(Math.hypot(after.x - prior.x, after.y - prior.y) <= movementCapacity(before, prior) + 1e-7);
    }
  }
  return { game, records };
};

test('both captain assignments complete simultaneous rescue and prize recovery across six fixtures with reload parity', () => {
  for (const seed of OPERATION_SEEDS) for (const captain of ['op-scout', 'op-escort']) {
    const { game, records } = play(seed, captain);
    assert.equal(game.operation.result?.primary, 'success', `${seed}/${captain}`);
    assert.equal(game.operation.result.prizeRecovered, true, JSON.stringify(game.operation.recoveryReports));
    assert.equal(game.operation.extracted.length, 5);
    assert.equal(game.operation.recoveryReports[captain].phase, 'completed');
    assert.equal(records.filter((r) => r.kind === 'capture').length, 1);
    assert.deepEqual(play(seed, captain, true).game, game);
  }
});

test('Recover prize rejects unsupported modes, own command, objective ships and missing crew/hardware', () => {
  for (const game of [createGame({ seed: 'scope' }), createGame({ seed: 'scope', reimagined: true }), { ...fresh(), realtime: true }]) {
    const id = game.ships.find((s) => s.faction === 'Federation' && s.id !== game.playerShipId)?.id;
    assert.equal(applyPlayerAction(game, { type: 'orders', shipId: id, order: { type: 'recover' } }).game, game);
  }
  for (const id of ['op-command', 'op-sentinel']) {
    const game = fresh();
    assert.equal(applyPlayerAction(game, { type: 'orders', shipId: id, order: { type: 'recover' } }).game, game);
  }
  for (const patch of [{ crew: 1 }, { systems: { ...getShip(fresh(), 'op-scout').systems, transporter: 0 } }]) {
    const game = edit(fresh(), 'op-scout', patch);
    assert.equal(applyPlayerAction(game, { type: 'orders', shipId: 'op-scout', order: { type: 'recover' } }).game, game);
  }
});

test('boarding uses the existing ten-person limit, preserves hull identity, and consumes a separate captain action', () => {
  const initial = assign(close()), records = [];
  const game = command(initial, { type: 'pass' }, records);
  const captain = getShip(game, 'op-scout'), prize = getShip(game, 'op-prize');
  assert.equal(captain.crew, getShip(initial, captain.id).crew - 10);
  assert.equal(prize.crew, 10);
  assert.equal(prize.id, initial.operation.prizeId);
  assert.equal(prize.name, 'Wayfarer');
  assert.equal(prize.prize.by, captain.id);
  assert.deepEqual([captain.x, captain.y], [164, 74]);
  assert.equal(game.orders[captain.id].captureTimes, prize.prize.times);
  assert.equal(game.orders[prize.id].type, 'withdraw');
  assert.equal(game.operation.extracted.some((s) => s.id === prize.id), false);
  assert.notEqual(game.operation.recoveryReports[captain.id].phase, 'completed');
  const poor = command(assign(edit(close(), captain.id, { crew: 3 })), { type: 'pass' });
  assert.equal(getShip(poor, captain.id).crew, 1);
  assert.equal(getShip(poor, prize.id).crew, 2);
});

test('queued recovery and cancellation respect delivery and keep reservations until replacement arrives', () => {
  let game = edit(fresh(), 'op-scout', { x: 300, y: 300 });
  let out = applyPlayerAction(game, { type: 'orders', shipId: 'op-scout', order: { type: 'recover' } });
  game = out.game;
  assert.equal(out.records.some((r) => r.kind === 'recovery-order'), false);
  assert.match(operationPanelMarkup(game), /Recover prize order in radio transit/);
  assert.equal(applyPlayerAction(game, { type: 'orders', shipId: 'op-escort', order: { type: 'recover' } }).game, game);
  game = command(game, { type: 'pass' });
  assert.equal(getShip(game, 'op-scout').x, 300);
  game = assign(game, 'op-scout', 'hold');
  assert.equal(game.orders['op-scout'].type, 'recover');
  assert.equal(applyPlayerAction(game, { type: 'orders', shipId: 'op-escort', order: { type: 'recover' } }).game, game);
  game = command(game, { type: 'pass' });
  assert.equal(game.orders['op-scout'].type, 'hold');
  assert.equal(game.operation.recoveryReports['op-scout'].phase, 'cancelled');
  assert.equal(assign(game, 'op-escort').orders['op-escort'].type, 'recover');
});

test('cancel captain preserves actual transferred crew and the independently issued prize withdrawal', () => {
  let game = boarded();
  const prize = getShip(game, 'op-prize');
  game = assign(game, 'op-scout', 'hold');
  assert.equal(game.operation.recoveryReports['op-scout'].phase, 'cancelled');
  assert.equal(getShip(game, prize.id).crew, prize.crew);
  assert.equal(game.orders[prize.id].type, 'withdraw');
  assert.equal(recoveredPrizeDecision(game, prize.id).action.type, 'move');
  game = assign(game, prize.id, 'hold');
  assert.equal(recoveredPrizeDecision(game, prize.id), null);
});

test('disabled prize engines, tractor holds and command transfer report actionable blockers', () => {
  const game = boarded(), prize = getShip(game, 'op-prize');
  const broken = edit(game, prize.id, { systems: { ...prize.systems, engines: 0 } });
  assert.match(recoverDecision(broken, 'op-scout').reason, /Wayfarer.*repair or tow/);
  assert.equal(recoveredPrizeDecision(broken, prize.id).action.type, 'pass');
  const held = edit(game, prize.id, { tractorBy: 'op-command' });
  assert.match(recoverDecision(held, 'op-scout').reason, /tractor/);
  assert.match(recoverDecision({ ...game, playerShipId: prize.id }, 'op-scout').reason, /You command/);
  assert.match(recoverDecision({ ...game, playerShipId: 'op-scout' }, 'op-scout').reason, /You command/);
  assert.equal(recoveredPrizeDecision(game, prize.id).action.type, 'move');
});

test('destruction, captain loss and recapture cannot fabricate a completed recovery', () => {
  const game = boarded();
  for (const patch of [{ faction: 'Axis' }, { status: 'destroyed', crew: 0 }]) {
    assert.equal(recoverDecision(edit(game, 'op-prize', patch), 'op-scout').phase, 'failed');
  }
  const lost = edit(game, 'op-scout', { status: 'destroyed', crew: 0 });
  assert.equal(recoverDecision(lost, 'op-scout').phase, 'failed');
  assert.equal(recoveredPrizeDecision(lost, 'op-prize').action.type, 'move');
  const hostile = edit(game, 'op-prize', { faction: 'Axis', status: 'vacant', crew: 0 });
  const recaptured = captureHull(hostile, getShip(hostile, 'op-command'), getShip(hostile, 'op-prize'), 10).game;
  assert.equal(recoverDecision(recaptured, 'op-scout').phase, 'failed');
  assert.equal(recoveredPrizeDecision(recaptured, 'op-prize'), null);
  const extractedLater = { ...recaptured, ships: recaptured.ships.filter((s) => !['op-scout', 'op-prize'].includes(s.id)),
    operation: { ...recaptured.operation, extracted: [getShip(recaptured, 'op-scout'), getShip(recaptured, 'op-prize')] } };
  assert.equal(recoverDecision(extractedLater, 'op-scout').phase, 'failed');
});

test('replacement prize orders suspend recovery; restoring Withdraw resumes the same capture route', () => {
  let game = boarded();
  game = assign(game, 'op-prize', 'hold');
  assert.match(recoverDecision(game, 'op-scout').reason, /different orders/);
  assert.equal(recoveredPrizeDecision(game, 'op-prize'), null);
  game = assign(game, 'op-prize', 'withdraw');
  assert.equal(recoveredPrizeDecision(game, 'op-prize').action.type, 'move');
  assert.equal(recoverDecision(game, 'op-scout').phase, 'withdrawing');
});

test('captured recovery captains do not obey old player orders; hidden target changes do not guide approach', () => {
  const game = assign(fresh());
  const changed = edit(game, 'op-scout', { faction: 'Axis' });
  assert.deepEqual(chooseAiAction(changed, 'op-scout'), chooseAiAction({ ...changed, orders: {} }, 'op-scout'));
  const far = edit(game, 'op-prize', { x: 300, y: 300 });
  const farther = edit(far, 'op-prize', { x: 290, y: 290, status: 'destroyed' });
  assert.deepEqual(chooseAiAction(far, 'op-scout'), chooseAiAction(farther, 'op-scout'));
  assert.match(recoverDecision(far, 'op-scout').reason, /initial salvage report/);
});

test('recovery navigation escapes initial crowding without moving closer and reports an enclosing obstruction', () => {
  let game = boarded();
  game = edit(game, 'op-scout', { x: 170.505, y: 74 });
  game = edit(game, 'op-prize', { x: 169.495, y: 74 });
  const action = recoveredPrizeDecision(game, 'op-prize').action;
  assert.equal(action.type, 'move');
  assert.ok(action.dx < 0);
  const prize = getShip(game, 'op-prize');
  const obstacles = Array.from({ length: 16 }, (_, i) => ({ ...getShip(game, 'op-command'), id: `obstacle-${i}`,
    x: prize.x + Math.cos(i * Math.PI / 8) * 3, y: prize.y + Math.sin(i * Math.PI / 8) * 3 }));
  const blocked = { ...game, ships: [...game.ships, ...obstacles] };
  assert.match(recoveredPrizeDecision(blocked, prize.id).reason, /No clear step/);
  assert.equal(recoveredPrizeDecision(blocked, prize.id).action.type, 'pass');
});

test('report and withdrawal ownership survive saves; malformed recovery fields are rejected', () => {
  const game = boarded();
  assert.equal(validOperationSave(save(fresh())), true);
  assert.equal(validOperationSave(save(JSON.parse(JSON.stringify(game)))), true);
  for (const mutate of [
    (g) => { g.operation.recoveryReports = []; },
    (g) => { g.operation.recoveryReports['op-scout'].targetId = 'op-sentinel'; },
    (g) => { g.orders['op-scout'].captureTimes = -1; },
    (g) => { g.orders['op-prize'].recovery.captainId = 'missing'; },
    (g) => { g.orders['op-prize'].recovery.captureTimes = null; },
  ]) {
    const corrupt = structuredClone(game); mutate(corrupt);
    assert.equal(validOperationSave(save(corrupt)), false);
  }
});

test('journal preserves recovery progress after captain extraction and does not repeat unchanged blockers', () => {
  const { game, records } = play('rescue-1', 'op-scout');
  const journal = restoreJournal(JSON.parse(JSON.stringify(appendRecords(createJournal(game.battleRecordState.battleId), records))), game.battleRecordState.battleId);
  const text = journal.events.filter((e) => e.kind === 'recovery-order').map(formatJournalEvent).join('\n');
  assert.match(text, /Swift.*completed/);
  assert.match(text, /waiting for Wayfarer/);
  assert.match(operationPanelMarkup(game), /Target: Wayfarer/);
  assert.ok(reportFor(game, 'battle-report').lines.includes('Prizes: 1 taken, 0 lost.'));
  assert.ok(reportFor(game, 'battle-report').lines.includes('Federation losses: 0 of 5 hulls.'));
  assert.deepEqual(updateOperationOrderReports(game), game);
});
