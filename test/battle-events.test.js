import test from 'node:test';
import assert from 'node:assert/strict';
import * as battleEvents from '../ui/battle-events.js';

const { isTerminalEvent, playTerminalEvents } = battleEvents;

test('compact groups only consecutive routine members in one resolution without mutating facts', () => {
  const events = [
    { kind: 'destruction', shipName: 'Drone 1', resolutionId: 1 },
    { kind: 'surrender', shipName: 'Scout', resolutionId: 1 },
    { kind: 'destruction', shipName: 'Argo', critical: true, resolutionId: 1 },
    { kind: 'destruction', shipName: 'Drone 2', resolutionId: 1 },
    { kind: 'destruction', shipName: 'Drone 3', resolutionId: 2 },
    { kind: 'phasers', resolutionId: 2 },
    { kind: 'destruction', shipName: 'Drone 4', resolutionId: 2 },
    { kind: 'battle-outcome', message: 'Battle ended', resolutionId: 2 },
  ];
  const original = structuredClone(events);
  const groups = battleEvents.groupBattleEvents(events);
  assert.deepEqual(groups.map((group) => [group.kind, group.members.length, group.duration]), [
    ['routine', 2, 700], ['critical', 1, 2000], ['routine', 1, 700], ['routine', 1, 700],
    ['effect', 1, 0], ['routine', 1, 700], ['critical', 1, 2000],
  ]);
  assert.deepEqual(groups.flatMap((group) => group.members), events);
  assert.deepEqual(events, original);
  assert.equal(battleEvents.groupBattleEvents(events, { mode: 'full' }).length, events.length);
  assert.ok(battleEvents.groupBattleEvents(events, { mode: 'full' }).filter((group) => group.kind !== 'effect').every((group) => group.duration === 2500));
});

test('timing injection changes waits only and each invocation remains a separate resolution', async () => {
  const members = [{ kind: 'destruction' }, { kind: 'surrender' }];
  const shown = [];
  const waits = [];
  for (let i = 0; i < 2; i += 1) await playTerminalEvents(members, (group) => shown.push(group), (ms) => { waits.push(ms); }, { timing: { routine: 1, critical: 2, full: 3 } });
  assert.deepEqual(waits, [1, 1]);
  assert.deepEqual(shown.map((group) => group?.members.length ?? 0), [2, 0, 2, 0]);
});

test('finish interrupts a pending wait once, retains members, preserves pause and releases one lock', async () => {
  const timers = new Map();
  let timerId = 0;
  const session = battleEvents.createPlaybackSession((callback) => { timers.set(++timerId, callback); return timerId; }, (id) => timers.delete(id));
  const states = [];
  const shown = [];
  const view = { paused: true };
  const events = [{ kind: 'destruction', critical: true }, { kind: 'surrender' }];
  const playback = battleEvents.withPlaybackLock((state) => states.push(state), () => playTerminalEvents(events, (group) => shown.push(group), (ms) => session.wait(ms), { session }));
  assert.equal(timers.size, 1);
  session.finish();
  session.finish();
  await playback;
  assert.deepEqual(states, [true, false]);
  assert.equal(shown.length, 2);
  assert.equal(shown[1], null);
  assert.equal(timers.size, 0);
  assert.equal(view.paused, true);
  assert.equal(events.length, 2);
  await session.wait(1000);
});

test('replay finish during ordinary wait stops later effects and terminal cards without altering records', async () => {
  const session = battleEvents.createPlaybackSession();
  const calls = [];
  const events = [{ kind: 'phasers' }, { kind: 'destruction' }, { kind: 'photons' }];
  const playback = battleEvents.playReplayEvents(events, (event) => { calls.push(event.kind); return 10000; }, () => calls.push('terminal'), (ms) => session.wait(ms), { session });
  session.finish();
  await playback;
  assert.deepEqual(calls, ['phasers']);
  assert.equal(events.length, 3);
});

test('terminal rendering and replay failures clear presentation and release the shared lock', async () => {
  const states = [];
  const shown = [];
  await assert.rejects(battleEvents.withPlaybackLock((state) => states.push(state), () => playTerminalEvents([{ kind: 'destruction' }], (group) => shown.push(group), () => { throw new Error('wait failed'); }, {})), /wait failed/);
  assert.deepEqual(states, [true, false]);
  assert.equal(shown.at(-1), null);
  states.length = 0;
  await assert.rejects(battleEvents.withPlaybackLock((state) => states.push(state), () => battleEvents.playReplayEvents([{ kind: 'phasers' }], () => { throw new Error('effect failed'); }, () => {}, () => Promise.resolve(), {})), /effect failed/);
  assert.deepEqual(states, [true, false]);
});

test('event-time projection keeps an early own loss critical before journal retention or command transfer', async () => {
  const { createJournal, appendRecords } = await import('../ui/battle-journal.js');
  const journal = createJournal('dense');
  const raw = Array.from({ length: 510 }, (_, i) => ({
    battleId: 'dense', eventId: `dense:e${i + 1}`, simTime: 0, kind: i === 0 ? 'destruction' : 'movement',
    target: { id: i === 0 ? 'old-command' : `ship-${i}`, name: i === 0 ? 'Argo' : `Ship ${i}`, faction: 'Federation' },
    knowledge: { observerActive: true, target: { own: i === 0, visible: true }, radioIntegrity: 1 }, payload: { status: 'destroyed' },
  }));
  const projected = battleEvents.projectPlaybackRecords(raw, journal);
  const trimmed = appendRecords(journal, raw);
  assert.equal(trimmed.events.length, 500);
  assert.ok(!trimmed.events.some((event) => event.target?.id === 'old-command'));
  const frozen = battleEvents.freezeResolutionEvents([{ kind: 'destruction', shipId: 'old-command', shipName: 'Argo', faction: 'Federation', x: 10, y: 20 }], projected, { playerShipId: 'new-command' });
  assert.equal(frozen[0].importance, 'Your command ship');
  assert.equal(frozen[0].critical, true);
  assert.equal(frozen[0].x, undefined, 'global identity without observed coordinates cannot authorize geometry');
});

test('frozen playback strips hidden effects and uses observation-time coordinates and milestone order', () => {
  const events = [
    { kind: 'phasers', fromId: 'a', toId: 'b', simTime: 1, x1: 10, y1: 10, x2: 30, y2: 10 },
    { kind: 'phasers', fromId: 'a', toId: 'b', simTime: 2, x1: 90, y1: 90, x2: 130, y2: 90 },
    { kind: 'phasers', fromId: 'a', toId: 'b', resolutionId: 2, x1: 10, y1: 10, x2: 30, y2: 10 },
    { kind: 'destruction', shipId: 'own', shipName: 'Argo', faction: 'Federation' },
    { kind: 'destruction', shipId: 'objective', shipName: 'Hunter', faction: 'Axis' },
    { kind: 'surrender', shipId: 'enemy', shipName: 'Enemy', faction: 'Axis', cause: 'surrender' },
  ];
  const frozen = battleEvents.freezeResolutionEvents(events, [
    { kind: 'weapon-resolution', simTime: 1, actor: { id: 'a', name: 'Argo', x: 10, y: 10 }, target: { id: 'b', name: 'Orion', x: 30, y: 10 } },
    { kind: 'command-transfer', actor: { id: 'own' }, target: null },
    { kind: 'battle-outcome', outcome: { message: 'Victory.' } },
  ], { playerShipId: 'own', objectiveShipId: 'objective' });
  assert.equal(frozen[0].historical, true);
  assert.equal(frozen[1].kind, 'unavailable-effect');
  assert.equal(frozen[1].x1, undefined);
  assert.equal(frozen[2].kind, 'unavailable-effect', 'resolution-only time cannot borrow an earlier observation');
  assert.deepEqual(frozen.filter((event) => event.critical).map((event) => event.kind), ['destruction', 'destruction', 'surrender', 'command-loss', 'battle-outcome']);
  assert.equal(frozen.at(-3).importance, 'Axis alliance surrendered');
});

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

test('a failed playback releases its lock and clears the presented terminal state', async () => {
  const states = [];
  let view = { terminalEvent: { kind: 'destruction' }, battlePaused: true };
  let refreshes = 0;
  const withPlaybackLock = battleEvents.withPlaybackLock ?? ((_setLocked, play) => play());

  await assert.rejects(
    withPlaybackLock((locked) => states.push(locked), async () => {
      throw new Error('render failed');
    }, () => {
      view = { ...view, terminalEvent: null, battlePaused: false };
      refreshes += 1;
    }),
    /render failed/,
  );

  assert.deepEqual(states, [true, false]);
  assert.deepEqual(view, { terminalEvent: null, battlePaused: false });
  assert.equal(refreshes, 1);
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
