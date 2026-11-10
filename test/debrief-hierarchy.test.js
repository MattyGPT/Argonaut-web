import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationGame, finishOperation, resolveOperationBoundary } from '../game/operations.js';
import { operationPanelMarkup } from '../ui/operations.js';

const fresh = (options) => createOperationGame({ battleId: 'debrief-test', ...options });
const edit = (game, id, patch) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...patch } : ship) });

/** A completed rescue: Sentinel and the command ship leave through the beacon together. */
const rescued = () => {
  let game = fresh();
  game = edit(game, 'op-sentinel', { x: 38, y: 160 });
  game = edit(game, 'op-command', { x: 42, y: 160 });
  game = resolveOperationBoundary(game);
  return game.operation.result ? game : finishOperation(game);
};

const at = (markup, needle) => {
  const index = markup.indexOf(needle);
  assert.notEqual(index, -1, `expected the debrief to contain ${needle}`);
  return index;
};

test('the debrief leads with outcome and hulls, and keeps flat statistics collapsed', () => {
  const game = rescued();
  assert.equal(game.operation.result.primary, 'success');
  const markup = operationPanelMarkup(game);
  const outcome = at(markup, 'Sentinel recovered');
  const hulls = at(markup, 'Returned: Argonaut, Sentinel. Left behind: Swift, Bulwark. Lost: None.');
  const recovery = at(markup, 'Optional prize: not recovered');
  const attention = at(markup, 'Damage needing attention');
  const disclosure = at(markup, '<summary>Condition and towing detail</summary>');
  const towing = at(markup, 'Confirmed towing:');
  assert.ok(outcome < hulls, 'outcome precedes the hull disposition');
  assert.ok(hulls < recovery, 'hull disposition precedes optional recovery');
  assert.ok(recovery < attention, 'recovery precedes the damage layer');
  assert.ok(attention < disclosure, 'damage needing attention is never inside the disclosure');
  assert.ok(disclosure < towing, 'towing statistics stay collapsed behind the disclosure');
  assert.equal(markup.split('class="operation-debrief"').length, 2, 'exactly one debrief block');
});

test('damage needing attention names the actual disabled system read from live state', () => {
  const markup = operationPanelMarkup(rescued());
  // Sentinel is authored with burnt engines; that is the real condition, not a guess.
  assert.match(markup, /<strong>Sentinel<\/strong> — disabled engines \(shields 100, crew 100\)/);
  assert.doesNotMatch(markup, /<strong>Argonaut<\/strong> — disabled/, 'an undamaged hull is not reported as needing attention');
  assert.match(markup, /Returned needing no attention: Argonaut \(shields 200, crew 200\)/);
});

test('lost shield power and a disabled system are both surfaced as needing attention', () => {
  const game = rescued();
  const extracted = game.operation.extracted.map((ship) => ship.id === 'op-command'
    ? { ...ship, shields: 0, systems: { ...ship.systems, mapper: 0 } } : ship);
  const markup = operationPanelMarkup({ ...game, operation: { ...game.operation, extracted } });
  assert.match(markup, /<strong>Argonaut<\/strong> — disabled mapper; no shield power \(shields 0, crew 200\)/);
});

test('a finished operation that returned no hull claims neither damage nor a clean fleet', () => {
  const markup = operationPanelMarkup(finishOperation(fresh()));
  assert.match(markup, /Rescue unsuccessful/);
  assert.match(markup, /Returned: None\./);
  assert.doesNotMatch(markup, /Damage needing attention/);
  assert.doesNotMatch(markup, /No returned hull has a disabled system/, 'nothing returned, so there is nothing to clear');
  assert.match(markup, /Confirmed towing: None/);
});

test('no field repair is offered or implied, because the operation has no dockyard', () => {
  const game = rescued();
  const markup = operationPanelMarkup(game);
  assert.match(markup, /No repair is available in the field: the beacon supplies none, and this operation fields no dockyard\./);
  assert.doesNotMatch(markup, /data-operation-action="repair"/);
  assert.ok(!game.ships.some((ship) => ship.className === 'Starbase'), 'the fixture fields no repair facility');
});

test('a returned hull missing from live state reports no condition instead of a reconstructed one', () => {
  const game = rescued();
  const pruned = {
    ...game,
    ships: game.ships.filter((ship) => ship.id !== 'op-sentinel'),
    operation: { ...game.operation, extracted: game.operation.extracted.filter((ship) => ship.id !== 'op-sentinel') },
  };
  const markup = operationPanelMarkup(pruned);
  assert.doesNotMatch(markup, /undefined/, 'no placeholder number is invented');
  assert.doesNotMatch(markup, /Sentinel \(shields/, 'condition is not claimed for a hull that is gone');
  assert.match(markup, /Returned: Argonaut, Sentinel/, 'the recorded identity still reports it returned');
});

test('a fully intact returned fleet reports that plainly and still collapses its numbers', () => {
  let game = rescued();
  const extracted = game.operation.extracted.map((ship) => ship.id === 'op-sentinel'
    ? { ...ship, systems: { ...ship.systems, engines: 2 } } : ship);
  game = { ...game, operation: { ...game.operation, extracted } };
  const markup = operationPanelMarkup(game);
  assert.match(markup, /No returned hull has a disabled system or lost shield power\./);
  assert.doesNotMatch(markup, /Damage needing attention/);
  assert.ok(markup.indexOf('<summary>Condition and towing detail</summary>') < markup.indexOf('Confirmed towing:'));
});

test('an unfinished operation shows no debrief at all', () => {
  const markup = operationPanelMarkup(fresh());
  assert.doesNotMatch(markup, /operation-debrief/);
  assert.doesNotMatch(markup, /Damage needing attention/);
  assert.match(markup, /Briefing and prototype rules/, 'the briefing disclosure is still present');
});

test('the briefing stays the first disclosure so the positional restore in app.js still targets it', () => {
  const markup = operationPanelMarkup(rescued());
  assert.ok(markup.indexOf('<details><summary>Briefing and prototype rules</summary>') < markup.indexOf('id="operation-debrief-detail"'),
    'the debrief disclosure must not precede the briefing');
  assert.equal(markup.split('<details').length, 3, 'exactly two disclosures: briefing and debrief detail');
});

test('debrief presentation is read-only, repeatable and consumes no randomness', () => {
  const game = rescued();
  const before = JSON.stringify(game);
  const once = operationPanelMarkup(game);
  assert.equal(operationPanelMarkup(game), once, 'a repeated render is identical');
  assert.equal(JSON.stringify(game), before, 'rendering writes no simulation, report or save state');
  assert.equal(operationPanelMarkup(JSON.parse(before)), once, 'a reloaded save debriefs identically');
});

test('debrief markup escapes hull names rather than injecting them', () => {
  let game = rescued();
  const extracted = game.operation.extracted.map((ship) => ship.id === 'op-sentinel'
    ? { ...ship, name: '<img src=x onerror=alert(1)>', systems: { ...ship.systems, engines: 0 } } : ship);
  game = { ...game, operation: { ...game.operation, extracted, result: { ...game.operation.result, returned: game.operation.result.returned.map((snapshot) => snapshot.id === 'op-sentinel' ? { ...snapshot, name: '<img src=x onerror=alert(1)>' } : snapshot) } } };
  const markup = operationPanelMarkup(game);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
