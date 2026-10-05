import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerAction } from '../game/actions.js';
import { advanceSubtick } from '../game/realtime.js';
import { createGame, getShip, reactorOutput } from '../game/state.js';
import { evaluateOutcome, resolveComputerTurns, resolveObjectives, resolveRealtimeBoundary } from '../game/turns.js';
import { PRACTICE_EXERCISES, createPracticeGame, dismissPracticeHints, isPractice, practiceProgress, restartPractice, updatePractice } from '../game/practice.js';
import { practiceChooserMarkup, practicePanelMarkup } from '../ui/practice.js';

const advance = (game) => {
  if (!game.realtime) return updatePractice(resolveComputerTurns(game), { boundary: true });
  // One genuine stardate, using the same movement and boundary functions as app.js.
  for (let index = 0; index < 8; index += 1) {
    const tick = advanceSubtick(game);
    game = updatePractice(tick.game);
    if (tick.crossed) game = updatePractice(resolveRealtimeBoundary(game), { boundary: true });
  }
  return game;
};

const command = (game, action) => {
  const result = applyPlayerAction(game, action);
  assert.notEqual(result.game, game, result.messages.join(' '));
  game = updatePractice(result.game);
  return game.realtime || game.phase === 'computer' ? advance(game) : game;
};

const tow = (x, y) => ({ type: 'tractor', targetId: 'practice-distress', towardX: x, towardY: y });
const solve = (id, realtime, alternative = false) => {
  let game = createPracticeGame(id, { realtime });
  if (id === 'rescue-repair') {
    if (alternative) game = command(game, { type: 'scan', targetId: 'practice-distress' });
    game = command(game, tow(alternative ? 156 : 154, alternative ? 163 : 160));
    game = command(game, tow(alternative ? 156 : 154, alternative ? 163 : 160));
    assert.equal(game.practice.status, 'active', 'Tractor-held hull cannot dock.');
    assert.equal(getShip(game, 'practice-distress').systems.engines, 0);
    game = command(game, { type: 'tractor' });
  } else if (id === 'tow-position') {
    game = command(game, tow(alternative ? 158 : 160, alternative ? 122 : 120));
    assert.equal(game.practice.status, 'active', 'The destination is beyond a single pull.');
    game = command(game, tow(alternative ? 158 : 160, alternative ? 122 : 120));
  } else if (id === 'disable-capture') {
    if (alternative) game = command(game, { type: 'scan', targetId: 'practice-raider' });
    for (let shot = 0; shot < 8 && getShip(game, 'practice-raider').status === 'active'; shot += 1) {
      game = command(game, { type: 'phasers', targetId: 'practice-raider', focus: 'phasers', power: alternative ? 25 : 100 });
    }
    assert.equal(getShip(game, 'practice-raider').status, 'vacant', 'Called fire must cause real disabled surrender.');
    game = command(game, { type: 'transport', targetId: 'practice-raider', amount: alternative ? 20 : 10 });
    assert.equal(getShip(game, 'practice-raider').status, 'active', 'The real dockyard keeps the disabled prize crew aboard.');
    assert.equal(getShip(game, 'practice-raider').faction, 'Federation');
    assert.equal(getShip(game, 'practice-raider').prize.byFaction, 'Federation');
  } else {
    const before = reactorOutput(getShip(game, game.playerShipId), game);
    game = command(game, { type: 'move', dx: alternative ? 20 : 14, dy: 0 });
    assert.equal(game.practice.relayBoundaries, 1);
    assert.equal(reactorOutput(getShip(game, game.playerShipId), game), before + 5);
    game = command(game, alternative ? { type: 'stance', stance: 'evasive' } : { type: 'pass' });
    // Stance is free in turn-based play; it cannot stand in for a boundary.
    if (!realtime && alternative) game = command(game, { type: 'pass' });
    assert.equal(game.practice.relayBoundaries, 2);
    game = command(game, { type: 'pass' });
  }
  assert.equal(game.practice.status, 'success', `${id} ${realtime ? 'real time' : 'turn based'} ${alternative ? 'alternative' : 'reference'}`);
  assert.equal(game.outcome, null, 'Practice completion does not invent an ordinary war victory.');
  return game;
};

for (const realtime of [false, true]) {
  for (const exercise of PRACTICE_EXERCISES) {
    test(`${exercise.id}: reference and alternative solve with live ${realtime ? 'real-time' : 'turn-based'} rules`, () => {
      solve(exercise.id, realtime);
      solve(exercise.id, realtime, true);
    });
    test(`${exercise.id}: destructive commands fail and retry restores ${realtime ? 'real-time' : 'turn-based'} fixture`, () => {
      let game = createPracticeGame(exercise.id, { realtime });
      const initial = structuredClone(game);
      if (exercise.id === 'hold-relay') game = command(game, { type: 'self-destruct' });
      else {
        const target = getShip(game, game.practice.targetId);
        const player = getShip(game, game.playerShipId);
        game = command(game, { type: 'move', dx: target.x - player.x, dy: target.y - player.y - 3 });
        game = command(game, { type: 'self-destruct' });
      }
      assert.equal(game.practice.status, 'failure');
      assert.match(game.practice.message, /lost|destroyed/);
      const retry = restartPractice(game);
      assert.deepEqual(retry.ships, initial.ships);
      assert.deepEqual(retry.log, initial.log);
      assert.equal(retry.randomStep, initial.randomStep);
      assert.deepEqual(retry.readyAt, initial.readyAt);
      assert.equal(retry.turn, 1);
      assert.equal(retry.practice.status, 'active');
      assert.equal(retry.practice.hintStep, 0);
      assert.equal(retry.practice.attempt, 2);
      assert.notEqual(retry.battleRecordState.battleId, initial.battleRecordState.battleId);
      assert.equal(retry.battleRecordState.nextAction, 1);
      assert.equal(retry.battleRecordState.nextEvent, 1);
    });
  }
}

test('construction is deterministic except independent battle identity and leaves ordinary war unchanged', () => {
  const ordinary = createGame({ seed: 'ordinary-seed', reimagined: true });
  const bytes = JSON.stringify(ordinary);
  for (const exercise of PRACTICE_EXERCISES) {
    const first = createPracticeGame(exercise.id);
    const second = createPracticeGame(exercise.id);
    assert.notEqual(first.practice.battleId, second.practice.battleId);
    first.practice.battleId = second.practice.battleId;
    first.battleRecordState.battleId = second.battleRecordState.battleId;
    assert.deepEqual(first, second);
    assert.equal(first.campaign, undefined);
    assert.equal(evaluateOutcome(first).kind, 'active');
  }
  assert.equal(JSON.stringify(ordinary), bytes);
  assert.equal(updatePractice(ordinary), ordinary);
  assert.equal(restartPractice(ordinary), ordinary);
  assert.equal(practiceProgress(ordinary), null);
  assert.equal(isPractice({ ...ordinary, reimagined: false, practice: { version: 1, id: 'hold-relay' } }), false);
  assert.throws(() => createPracticeGame('unknown'), /Unknown practice exercise/);
});

test('hints advance from facts, reject unavailable boarding, and do not change gameplay or RNG', () => {
  const initial = createPracticeGame('disable-capture');
  const rejected = applyPlayerAction(initial, { type: 'transport', targetId: 'practice-raider', amount: 10 });
  assert.equal(rejected.game, initial);
  assert.deepEqual(updatePractice(rejected.game).practice, initial.practice);
  const scanned = updatePractice(applyPlayerAction(initial, { type: 'scan', targetId: 'practice-raider' }).game);
  assert.equal(scanned.practice.hintStep, 1);
  const dismissed = dismissPracticeHints(scanned);
  assert.equal(practiceProgress(dismissed).hint, null);
  assert.equal(practiceProgress(dismissPracticeHints(dismissed, false)).hint, PRACTICE_EXERCISES[2].hints[1]);
  const action = { type: 'phasers', targetId: 'practice-raider', focus: 'phasers', power: 100 };
  const shown = applyPlayerAction(scanned, action).game;
  const hidden = applyPlayerAction(dismissed, action).game;
  assert.deepEqual({ ...shown, practice: null }, { ...hidden, practice: null });
});

test('real-time tow hints wait for actual movement, not just an accepted lock', () => {
  const initial = createPracticeGame('tow-position', { realtime: true });
  const locked = updatePractice(applyPlayerAction(initial, tow(160, 120)).game);
  assert.equal(locked.practice.hintStep, 1);
  assert.equal(locked.practice.status, 'active');
  assert.equal(getShip(locked, 'practice-distress').x, 130);
  assert.equal(updatePractice(advanceSubtick(locked).game).practice.hintStep, 2);
});

test('relay boundaries are counted once and absence of control resets the streak', () => {
  let game = command(createPracticeGame('hold-relay'), { type: 'move', dx: 14, dy: 0 });
  assert.equal(game.practice.relayBoundaries, 1);
  for (let read = 0; read < 10; read += 1) game = updatePractice(game, { boundary: true });
  assert.equal(game.practice.relayBoundaries, 1);
  game = command(game, { type: 'move', dx: -14, dy: 0 });
  assert.equal(game.practice.relayBoundaries, 0);
  game = command(game, { type: 'move', dx: 14, dy: 0 });
  assert.equal(game.practice.relayBoundaries, 1);
  game = command(game, { type: 'pass' });
  game = command(game, { type: 'pass' });
  assert.equal(game.practice.status, 'success');
});

test('contested and tractor-held occupation uses actual relay rules', () => {
  let game = createPracticeGame('hold-relay');
  const altered = (changes) => ({ ...game, ships: game.ships.map((ship) => ({ ...ship, ...(changes[ship.id] ?? {}) })) });
  let contested = resolveObjectives(altered({ 'fed-flagship': { x: 160 }, 'practice-opponent': { x: 165 } })).game;
  assert.equal(contested.held['practice-relay'], undefined);
  let held = resolveObjectives(altered({ 'fed-flagship': { x: 160, tractorBy: 'practice-opponent' } })).game;
  assert.equal(held.held['practice-relay'], undefined);
  const skipped = updatePractice({ ...game, turn: 4, held: { 'practice-relay': 'Federation' } }, { boundary: true });
  assert.equal(skipped.practice.relayBoundaries, 1, 'Unobserved boundaries cannot be invented.');
});

test('save and reload retains hint and relay state while retry starts a fresh attempt', () => {
  let game = command(createPracticeGame('hold-relay'), { type: 'move', dx: 14, dy: 0 });
  game = dismissPracticeHints(game);
  game = JSON.parse(JSON.stringify(game));
  game = command(game, { type: 'pass' });
  game = command(game, { type: 'pass' });
  assert.equal(game.practice.status, 'success');
  assert.equal(game.practice.hintsDismissed, true);
  const retry = restartPractice(game);
  assert.equal(retry.practice.relayBoundaries, 0);
  assert.equal(retry.practice.hintsDismissed, false);
});

test('practice markup exposes objectives, disclosed setup, and lifecycle controls', () => {
  const chooser = practiceChooserMarkup();
  for (const exercise of PRACTICE_EXERCISES) assert.match(chooser, new RegExp(`data-practice-start="${exercise.id}"`));
  const initial = createPracticeGame('hold-relay');
  const markup = practicePanelMarkup(initial);
  assert.match(markup, /Consecutive boundaries/);
  assert.match(markup, /Briefing and staged setup/);
  for (const action of ['hints', 'retry', 'return']) assert.match(markup, new RegExp(`data-practice-action="${action}"`));
  assert.doesNotMatch(markup, /data-practice-action="next"/);
  const complete = practicePanelMarkup(solve('rescue-repair', false));
  assert.match(complete, /data-practice-action="next"/);
  assert.equal(practicePanelMarkup(createGame()), '');
  const untrusted = { ...initial, practice: { ...initial.practice, message: '<script>bad</script>' } };
  assert.doesNotMatch(practicePanelMarkup(untrusted), /<script>/);
});
