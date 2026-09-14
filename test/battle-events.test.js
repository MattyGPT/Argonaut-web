import test from 'node:test';
import assert from 'node:assert/strict';
import * as battleEvents from '../ui/battle-events.js';

const { isTerminalEvent, playTerminalEvents } = battleEvents;

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

test('ordinary effect batches exclude terminal events', () => {
  const phasers = { kind: 'phasers' };
  const destruction = { kind: 'destruction' };
  const photons = { kind: 'photons' };
  const ordinaryBattleEvents = battleEvents.ordinaryBattleEvents ?? ((events) => events);

  assert.deepEqual(ordinaryBattleEvents([phasers, destruction, photons]), [phasers, photons]);
});

test('replay awaits each effect duration and terminal presentation in event order', async () => {
  const phasers = { kind: 'phasers' };
  const destruction = { kind: 'destruction', shipName: 'Bonhomme' };
  const photons = { kind: 'photons' };
  const timeline = [];
  const waits = [];
  const terminals = [];
  const playReplayEvents = battleEvents.playReplayEvents ?? (() => Promise.resolve());

  const playback = playReplayEvents(
    [phasers, destruction, photons],
    (event) => {
      timeline.push(`effect:${event.kind}`);
      return event.kind === 'phasers' ? 420 : 560;
    },
    (event) => new Promise((resolve) => {
      timeline.push(`terminal:${event.shipName}`);
      terminals.push(resolve);
    }),
    (duration) => new Promise((resolve) => {
      timeline.push(`wait:${duration}`);
      waits.push(resolve);
    }),
  );

  await Promise.resolve();
  assert.deepEqual(timeline, ['effect:phasers', 'wait:420']);

  waits.shift()();
  await Promise.resolve();
  assert.deepEqual(timeline, ['effect:phasers', 'wait:420', 'terminal:Bonhomme']);

  terminals.shift()();
  await Promise.resolve();
  assert.deepEqual(timeline, [
    'effect:phasers',
    'wait:420',
    'terminal:Bonhomme',
    'effect:photons',
    'wait:560',
  ]);

  waits.shift()();
  await playback;
});

test('a playback lock is always released when playback fails', async () => {
  const states = [];
  const withPlaybackLock = battleEvents.withPlaybackLock ?? ((_setLocked, play) => play());

  await assert.rejects(
    withPlaybackLock((locked) => states.push(locked), async () => {
      throw new Error('render failed');
    }),
    /render failed/,
  );

  assert.deepEqual(states, [true, false]);
});

test('direct input handlers do nothing while playback is locked', () => {
  let calls = 0;
  let locked = true;
  const whenPlaybackUnlocked = battleEvents.whenPlaybackUnlocked ?? ((_isLocked, action) => action);
  const handler = whenPlaybackUnlocked(() => locked, () => { calls += 1; });

  handler();
  assert.equal(calls, 0);

  locked = false;
  handler();
  assert.equal(calls, 1);
});
