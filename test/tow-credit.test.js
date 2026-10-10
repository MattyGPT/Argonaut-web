import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, isAce } from '../game/state.js';
import { applyPlayerAction, resolveCollision } from '../game/actions.js';
import { enableBattleRecords, stripBattleRecordMetadata, withBattleAction } from '../game/battle-records.js';
import { resolveAutopilotTurn, stepContinuum } from '../game/turns.js';
import { journalCardsHtml, reportFor } from '../ui/render.js';
import { appendRecords, createJournal, journalView, restoreJournal } from '../ui/battle-journal.js';

const issuerId = 'fed-flagship';
const draggedId = 'axis-flagship';
const victimIds = ['axis-cruiser-1', 'axis-cruiser-2'];
const replace = (game, id, changes) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...changes } : ship) });
const staged = (seed = 'tow-credit', options = {}, victims = 1) => {
  const game = createGame({ seed: 'tow-credit', reimagined: true, ...options });
  return { ...game, seed, terrain: [], ships: game.ships.map((ship, index) => ({
    ...ship, dest: null, tow: null,
    x: ship.id === issuerId ? 10 : ship.id === draggedId ? 20 : victimIds.slice(0, victims).includes(ship.id) ? 21 : 100 + index * 4,
    y: [issuerId, draggedId, ...victimIds.slice(0, victims)].includes(ship.id) ? 10 : 200,
  })) };
};
const enabled = (game) => enableBattleRecords(game, { battleId: 'tow-test' });
const order = { type: 'tractor', targetId: draggedId, towardX: 21, towardY: 10 };
const credits = (game) => game.battleRecordState?.towCollisionCredits ?? [];

test('each enemy destroyed in a direct tow collision credits the original beam without ace buffs', () => {
  // This seed leaves the hauled flagship alive through both impacts.
  const game = enabled(staged('tow-multi-3', {}, 2));
  const result = applyPlayerAction(game, order);
  assert.equal(result.records.filter((record) => record.kind === 'collision').length, 2);
  assert.equal(credits(result.game).length, 2);
  assert.deepEqual(credits(result.game).map((entry) => entry.target.id), victimIds);
  const action = result.records.find((record) => record.kind === 'action');
  for (const destruction of result.records.filter((record) => record.kind === 'destruction')) {
    assert.equal(destruction.actorId, issuerId);
    assert.equal(destruction.actionId, action.actionId);
    assert.equal(destruction.payload.cause, 'tractor-collision');
    assert.equal(destruction.payload.creditedKill, true);
  }
  assert.equal(getShip(result.game, draggedId).status, 'active');
  assert.equal(getShip(result.game, issuerId).kills, 0);
  assert.equal(isAce(getShip(result.game, issuerId)), false);
  const lines = reportFor(result.game, 'battle-report').lines.join('\n');
  assert.match(lines, /Top gun: .*Argo, 2 credited kills \(2 from direct tow collisions\)/);
  assert.match(lines, /Your direct tow collision kills across command ships: 2/);
  assert.match(lines, /2 enemy hulls destroyed/);
  assert.doesNotMatch(lines, /No ship scored a kill/);
  const journal = appendRecords(createJournal('tow-test'), result.records);
  const restored = restoreJournal(JSON.parse(JSON.stringify(journal)), 'tow-test');
  const card = journalView(restored).recentCommands[0];
  assert.deepEqual(card.defeats.map((entry) => entry.target.id), victimIds);
  assert.ok(card.defeats.every((entry) => entry.kind === 'destruction' && /tow collision/.test(entry.text)));
  assert.match(card.summary, /destroyed in tow collision/);
  const markup = journalCardsHtml([card], 'own');
  assert.equal((markup.match(/data-defeat-kind="destruction"/g) ?? []).length, 2);
  assert.ok(markup.indexOf('journal-defeat') < markup.indexOf('</summary>'), 'Both defeats appear without expanding the command.');
});

test('a hauled hull destroyed by impact also credits the beam while its crippled survivor does not', () => {
  const game = enabled(staged('tow-credit'));
  const result = applyPlayerAction(game, order);
  assert.equal(credits(result.game).length, 1);
  const destroyed = result.records.find((record) => record.kind === 'destruction');
  assert.equal(credits(result.game)[0].target.id, destroyed.targetId);
  const survivor = result.records.find((record) => record.kind === 'collision').payload.survivorId;
  assert.ok(!credits(result.game).some((credit) => credit.target.id === survivor));
  assert.ok(!journalView(appendRecords(createJournal('tow-test'), result.records)).recentCommands[0].defeats.some((entry) => entry.target.id === survivor));
  assert.equal(getShip(result.game, survivor).status, 'active');
  assert.ok(result.records.some((record) => record.kind === 'damage' && record.targetId === survivor && record.actorId === issuerId));
});

test('a tow without a terminal collision and an incidental collision grant no tow kill', () => {
  const game = enabled(staged('nonlethal-tow', {}, 0));
  const hauled = applyPlayerAction(game, order);
  assert.equal(credits(hauled.game).length, 0);
  assert.equal(hauled.records.filter((record) => record.kind === 'destruction').length, 0);
  let incidental = replace(hauled.game, victimIds[0], { x: 80, y: 80 });
  incidental = replace(incidental, victimIds[1], { x: 80, y: 80 });
  const resolved = withBattleAction(incidental, { actor: getShip(incidental, issuerId), source: 'manual', command: 'tractor' },
    (prepared) => resolveCollision(prepared, getShip(prepared, victimIds[0])));
  assert.equal(credits(resolved.game).length, 0);
  assert.ok(resolved.records.some((record) => record.kind === 'destruction' && record.payload.cause === 'collision'));
});

test('realtime endpoint collision resumes saved tow cause after player command transfer', () => {
  const game = enabled(staged('tow-credit', { realtime: true }));
  const lock = applyPlayerAction(game, order);
  let resumed = JSON.parse(JSON.stringify(lock.game));
  resumed = { ...resumed, playerShipId: 'fed-cruiser-1' };
  const next = stepContinuum(resumed);
  const destruction = next.records.find((record) => record.kind === 'destruction');
  assert.ok(destruction);
  assert.equal(destruction.actorId, issuerId);
  assert.equal(destruction.actor.name, 'Argo');
  assert.equal(destruction.actionId, lock.records[0].actionId);
  assert.equal(destruction.source, 'manual');
  assert.equal(destruction.payload.issuingShipId, issuerId);
  assert.equal(credits(next.game).length, 1);
  assert.equal(credits(next.game)[0].actor.id, issuerId);
  assert.match(reportFor(next.game, 'battle-report').lines.join('\n'), /Your direct tow collision kills across command ships: 1/);
  assert.equal(next.records.filter((record) => record.kind === 'action').length, 0);
  assert.equal(credits(stepContinuum(next.game).game).length, 1);
  assert.equal(Object.getOwnPropertySymbols(next.game).length, 0);
});

test('release, loss of caster or tractor hardware, and a completed old lock remove causal credit', () => {
  for (const scenario of ['release', 'caster-destroyed', 'tractor-disabled', 'old-lock']) {
    const game = enabled(staged('tow-credit', { realtime: true }));
    const lock = applyPlayerAction(game, order);
    let changed = lock.game;
    if (scenario === 'release') changed = applyPlayerAction({ ...changed, readyAt: {} }, { type: 'tractor' }).game;
    if (scenario === 'caster-destroyed') changed = replace(changed, issuerId, { status: 'destroyed' });
    if (scenario === 'tractor-disabled') changed = replace(changed, issuerId, { systems: { ...getShip(changed, issuerId).systems, tractor: 0 } });
    if (scenario === 'old-lock') {
      changed = replace(changed, draggedId, { x: 20, tow: null });
      changed = replace(changed, victimIds[0], { x: 20, tow: { x: 20.5, y: 10, rate: 1, remaining: 1 }, tractorBy: null });
    }
    const next = stepContinuum(changed);
    assert.ok(next.records.some((record) => record.kind === 'collision'), scenario);
    assert.equal(credits(next.game).length, 0, scenario);
    assert.ok(next.records.filter((record) => record.kind === 'destruction').every((record) => record.payload.cause === 'collision'), scenario);
  }
});

test('automatic conn credits the actual beam issuer and keeps historical report identity after capture', () => {
  let game = staged('tow-multi-3');
  const actor = getShip(game, issuerId);
  game = replace(game, issuerId, { systems: { ...actor.systems, tractor: 1, phasers: 0, photons: 0, spread: 0, ion: 0 } });
  game = replace(game, draggedId, { x: 22 });
  game = replace(game, victimIds[0], { x: 17 });
  game = { ...game, orders: { [issuerId]: { type: 'intercept', targetId: draggedId } } };
  const result = resolveAutopilotTurn(enabled(game));
  assert.equal(credits(result.game).length, 1);
  assert.equal(credits(result.game)[0].source, 'auto-conn');
  assert.equal(credits(result.game)[0].actor.id, issuerId);
  const captured = replace(result.game, issuerId, { captain: 'Enemy captain', name: 'Captured hull', faction: 'Axis' });
  const lines = reportFor(captured, 'battle-report').lines.join('\n');
  assert.ok(lines.includes(`Top gun: Captain ${actor.captain} of the Argo, 1 credited kills`));
  assert.ok(lines.includes(`Direct tow collision credit: Captain ${actor.captain} of the Argo`));
  assert.doesNotMatch(lines, /Enemy captain.*credited kills/);
});

test('friendly collision losses are reported as damage without enemy kill credit', () => {
  let game = staged('tow-multi-3');
  game = replace(game, victimIds[0], { faction: 'Federation' });
  const result = applyPlayerAction(enabled(game), order);
  const destroyed = result.records.find((record) => record.kind === 'destruction');
  assert.equal(destroyed.target.faction, 'Federation');
  assert.equal(destroyed.actorId, issuerId);
  assert.equal(destroyed.payload.creditedKill, false);
  assert.equal(credits(result.game).length, 0);
});

test('direct tow record credit preserves mechanics, damage, RNG, messages, FX and Classic reports', () => {
  for (const options of [{}, { realtime: true }, { reimagined: false }]) {
    const game = staged('tow-credit', options);
    const plain = applyPlayerAction(game, order);
    const recorded = applyPlayerAction(enabled(game), order);
    assert.deepEqual(stripBattleRecordMetadata(recorded.game), plain.game);
    assert.deepEqual(recorded.messages, plain.messages);
    assert.deepEqual(recorded.events, plain.events);
    assert.equal(recorded.game.randomStep, plain.game.randomStep);
    if (options.realtime) {
      const plainStep = stepContinuum(plain.game);
      const recordedStep = stepContinuum(recorded.game);
      assert.deepEqual(stripBattleRecordMetadata(recordedStep.game), plainStep.game);
      assert.deepEqual(recordedStep.events, plainStep.events);
      assert.equal(recordedStep.game.randomStep, plainStep.game.randomStep);
    }
    if (options.reimagined === false) {
      assert.deepEqual(reportFor(recorded.game, 'battle-report'), reportFor(plain.game, 'battle-report'));
      assert.equal(credits(recorded.game).length, 0);
    }
  }
});
