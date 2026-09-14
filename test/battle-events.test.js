import test from 'node:test';
import assert from 'node:assert/strict';
import { isTerminalEvent, playTerminalEvents } from '../ui/battle-events.js';

test('plays terminal events in order and clears the current event', async () => {
  const first = { kind: 'destruction', shipName: 'Bonhomme' };
  const second = { kind: 'surrender', shipName: 'Pequod' };
  const shown = [];

  await playTerminalEvents(
    [first, { kind: 'phasers' }, second],
    (event) => shown.push(event),
    () => Promise.resolve(),
  );

  assert.equal(isTerminalEvent(first), true);
  assert.equal(isTerminalEvent({ kind: 'photons' }), false);
  assert.deepEqual(shown, [first, second, null]);
});
