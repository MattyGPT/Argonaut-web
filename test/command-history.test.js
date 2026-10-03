import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { resolveComputerTurns } from '../game/turns.js';
import { commandHistoryHtml, rememberCommand, restoreCommandHistory } from '../ui/command-history.js';

test('the player command survives a fleet phase and records the ship that issued it', () => {
  const game = createGame({ seed: 'bridge-history' });
  const outcome = applyPlayerAction(game, { type: 'pass' });
  const history = rememberCommand([], game, 'pass', outcome);
  const after = resolveComputerTurns(outcome.game);
  assert.equal(history.length, 1);
  assert.equal(history[0].turn, 1);
  assert.equal(history[0].shipName, 'Argo');
  assert.deepEqual(history[0].messages, outcome.messages);
  assert.ok(after.log.length > history.length);
  assert.match(commandHistoryHtml(history), /Stardate 1 · Argo/);
  assert.equal(game.commandHistory, undefined, 'presentation history never changes simulation state');
});

test('refused commands do not bury accepted ones and only the last 12 are kept', () => {
  const game = createGame({ seed: 'bridge-limit' });
  let history = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    const before = { ...game, turn };
    history = rememberCommand(history, before, 'pass', applyPlayerAction(before, { type: 'pass' }));
  }
  assert.equal(history.length, 12);
  assert.equal(history[0].turn, 9);
  assert.equal(history.at(-1).turn, 20);
  assert.equal(rememberCommand(history, game, 'invalid', { game, messages: ['Refused'] }), history);
});

test('save restoration isolates battles and tolerates old or malformed records', () => {
  const entries = [{ turn: 3, shipName: 'Argo', messages: ['Argo fires phasers.'] }];
  assert.deepEqual(restoreCommandHistory({ seed: 'one', entries }, 'one'), entries);
  assert.deepEqual(restoreCommandHistory({ seed: 'one', entries }, 'two'), []);
  assert.deepEqual(restoreCommandHistory(undefined, 'one'), []);
  assert.deepEqual(restoreCommandHistory({ seed: 'one', entries: [null, { turn: 3 }] }, 'one'), []);
});

test('history renders newest first with intact results and escapes saved text', () => {
  const html = commandHistoryHtml([
    { turn: 1, shipName: 'Argo', messages: ['First command'] },
    { turn: 2, shipName: '<ship>', messages: ['Full damage report', '<script>'] },
  ]);
  assert.ok(html.indexOf('Stardate 2') < html.indexOf('Stardate 1'));
  assert.match(html, /Full damage report/);
  assert.match(html, /&lt;ship&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
