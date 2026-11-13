
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { advanceSubtick } from '../game/realtime.js';
import { REALTIME } from '../game/constants.js';
import {
  ACTION_LOG_LIMIT, ACTION_LOG_VERSION, actionLogComplete, createActionLog,
  recordAction, recordSweep, restoreActionLog, tickOf,
} from '../game/action-log.js';

const logFor = (game) => createActionLog({
  seed: game.seed,
  battleId: game.battleRecordState?.battleId ?? 'test-battle',
  realtime: Boolean(game.realtime),
});

const turnBased = (seed = 'log-turn-based') => createGame({ seed, reimagined: true });
const realTime = (seed = 'log-real-time') => createGame({ seed, reimagined: true, realtime: true });

/** An enemy hull to point a command at, so the fixture does not hardcode an id. */
const foe = (game) => game.ships.find((ship) => ship.faction !== 'Federation' && ship.status !== 'destroyed');

test('a turn-based entry is keyed by game.turn, never by its position in the array', () => {
  const game = turnBased();
  let log = logFor(game);
  // Turn 1 and turn 9 both produce one entry, so array position and turn diverge:
  // the whole reason entries carry a key. A replay driver that trusted the index
  // would fire both commands on the same stardate.
  log = recordAction(log, { ...game, turn: 1 }, { type: 'phasers', targetId: foe(game).id });
  log = recordAction(log, { ...game, turn: 9 }, { type: 'photons', targetId: foe(game).id });
  assert.deepEqual(log.entries.map((entry) => entry.turn), [1, 9]);
  assert.deepEqual(log.entries.map((entry) => entry.seq), [1, 2]);
  assert.deepEqual(log.entries.map((entry) => entry.type), ['phasers', 'photons']);
  assert.equal(log.realtime, false);
  // A turn-based entry carries no tick: simTimeOf would make it a pure function of
  // turn, so storing it would be dead weight in every entry of every saved log.
  assert.equal(log.entries[0].tick, undefined);
  assert.equal(log.entries[0].kind, 'action');
});

test('a real-time entry carries an integer tick plus a monotonic seq, and order within a tick survives', () => {
  const game = realTime();
  let log = logFor(game);
  const at = (simTime) => ({ ...game, simTime });
  // Real time has no command queue: several commands can land inside one stardate.
  // Two share tick 27 (simTime 3.375) and their issue order is load-bearing, so seq
  // — not the tick — has to break the tie.
  log = recordAction(log, at(3.375), { type: 'phasers', targetId: foe(game).id });
  log = recordAction(log, at(3.375), { type: 'photons', targetId: foe(game).id });
  log = recordAction(log, at(4.0), { type: 'move', dx: 10, dy: 0 });
  assert.deepEqual(log.entries.map((entry) => entry.tick), [27, 27, 32]);
  assert.deepEqual(log.entries.map((entry) => entry.seq), [1, 2, 3], 'seq is strictly monotonic across the whole log');
  assert.deepEqual(log.entries.map((entry) => entry.type), ['phasers', 'photons', 'move']);
  for (const entry of log.entries) assert.ok(Number.isSafeInteger(entry.tick), 'the tick is always an integer');
});

test('the tick is exact because the subtick is a power of two, so it cannot drift', () => {
  assert.equal(REALTIME.ticksPerStardate, 8);
  for (let tick = 0; tick <= 4000; tick += 1) {
    const simTime = tick / REALTIME.ticksPerStardate;
    assert.equal(tickOf({ simTime }), tick, `simTime ${simTime} must round-trip to tick ${tick}`);
  }
  // And it survives real accumulation through the actual stepper, not just division.
  let game = realTime('log-tick-drift');
  for (let step = 1; step <= 2000; step += 1) {
    game = advanceSubtick(game).game;
    const scaled = game.simTime * REALTIME.ticksPerStardate;
    assert.ok(Number.isInteger(scaled), `subtick ${step} produced a non-integer tick: ${game.simTime}`);
    assert.equal(scaled, step);
  }
});

test('the sensor sweep is a distinct entry kind and is never folded in with actions', () => {
  const game = turnBased();
  let log = logFor(game);
  log = recordSweep(log, game, 'axis-flagship');
  log = recordAction(log, game, { type: 'phasers', targetId: foe(game).id });
  assert.deepEqual(log.entries.map((entry) => entry.kind), ['sweep', 'action']);
  assert.equal(log.entries[0].targetId, 'axis-flagship');
  assert.equal(log.entries[0].type, undefined, 'a sweep carries no command type');
  assert.equal(log.entries[1].targetId, undefined, 'and an action carries no sweep target');
  assert.deepEqual(log.entries.map((entry) => entry.seq), [1, 2], 'both kinds share one ordering, so interleaving is preserved');
  // Guards against logging a no-op: sensorSweep returns the same object once a hull
  // is already scanned, and callers only record on a real change.
  assert.equal(recordSweep(log, game, ''), log, 'an empty target records nothing');
  assert.equal(recordSweep(log, game, null), log);
});

test('the re-appliable payload is the rules layer\'s own whitelist, not a second copy of it', () => {
  const game = turnBased();
  const log = logFor(game);
  const action = {
    type: 'phasers',
    targetId: foe(game).id,
    // Menu state, DOM nodes and presentation data must not enter the log: the
    // whitelist drops them, so a replay cannot depend on anything the rules ignore.
    sourceElement: { nodeName: 'BUTTON' },
    mouseEvent: { clientX: 12 },
    label: 'Fire phasers',
    notANumber: NaN,
    fn: () => {},
  };
  const entry = recordAction(log, game, action).entries[0];
  assert.deepEqual(entry.request, { targetId: action.targetId });
  assert.equal(entry.type, 'phasers');
  assert.equal(JSON.stringify(entry).includes('sourceElement'), false);
  assert.equal(recordAction(log, game, {}), log, 'an action with no type records nothing');
  assert.equal(recordAction(log, game, null), log);
});

test('an allocation and a nested order survive, because the rules re-apply them', () => {
  const game = turnBased();
  const log = logFor(game);
  const entry = recordAction(log, game, {
    type: 'power',
    allocation: { shields: 6, weapons: 6, engines: 4, sensors: 4, tractor: 2, bogus: 'x' },
  }).entries[0];
  assert.deepEqual(entry.request.allocation, { shields: 6, weapons: 6, engines: 4, sensors: 4, tractor: 2 },
    'only the five real sinks are carried, so a stale key cannot be replayed');
  const ordered = recordAction(log, game, { type: 'orders', targetId: 'fed-cruiser-1', order: { type: 'escort', ignored: {} } }).entries[0];
  assert.deepEqual(ordered.request.order, { type: 'escort' });
});

test('growth is bounded, and overflow is reported rather than hidden', () => {
  const game = turnBased('log-bounded');
  let log = logFor(game);
  for (let i = 0; i < ACTION_LOG_LIMIT + 250; i += 1) {
    log = recordSweep(log, game, `hull-${i}`);
  }
  assert.equal(log.entries.length, ACTION_LOG_LIMIT, 'the log stops growing at its ceiling');
  assert.equal(log.dropped, 250, 'and counts exactly what it had to let go');
  assert.equal(actionLogComplete(log), false, 'so a truncated log never claims to reach the opening');
  assert.equal(log.entries[0].targetId, 'hull-250', 'the OLDEST entries are the ones dropped');
  assert.equal(log.entries[log.entries.length - 1].targetId, `hull-${ACTION_LOG_LIMIT + 249}`);
  assert.equal(log.nextSeq, ACTION_LOG_LIMIT + 251, 'seq keeps climbing so ordering stays unambiguous after a drop');
  assert.equal(actionLogComplete(createActionLog({ seed: 'x' })), true);
});

test('a restored log round-trips, and anything that is not the same war is rejected outright', () => {
  const game = turnBased('log-restore');
  let log = logFor(game);
  log = recordAction(log, game, { type: 'phasers', targetId: foe(game).id });
  log = recordSweep(log, game, 'axis-flagship');
  const stored = JSON.parse(JSON.stringify(log));
  const identity = { seed: log.seed, battleId: log.battleId, realtime: false };

  const restored = restoreActionLog(stored, identity);
  assert.deepEqual(restored.entries, log.entries, 'entries survive a JSON round-trip exactly');
  assert.equal(restored.nextSeq, log.nextSeq);
  assert.equal(restored.dropped, 0);

  // Rejected whole, never merged or partially repaired: replaying a log against the
  // wrong war would produce a confidently wrong result.
  assert.equal(restoreActionLog(stored, { ...identity, seed: 'a-different-war' }).entries.length, 0);
  assert.equal(restoreActionLog(stored, { ...identity, battleId: 'another-battle' }).entries.length, 0);
  assert.equal(restoreActionLog(stored, { ...identity, realtime: true }).entries.length, 0, 'the timing model must match too');
  assert.equal(restoreActionLog({ ...stored, version: ACTION_LOG_VERSION + 1 }, identity).entries.length, 0);
  assert.equal(restoreActionLog(null, identity).entries.length, 0);
  assert.equal(restoreActionLog('nonsense', identity).entries.length, 0);
  assert.equal(restoreActionLog({ ...stored, entries: 'not-an-array' }, identity).entries.length, 0);
  // One malformed entry rejects the whole log rather than silently dropping it.
  const tampered = { ...stored, entries: [stored.entries[0], { kind: 'action', seq: 2, turn: 1, type: 42, request: {} }] };
  assert.equal(restoreActionLog(tampered, identity).entries.length, 0, 'a non-string command type is rejected');
  const noRequest = { ...stored, entries: [stored.entries[0], { kind: 'action', seq: 2, turn: 1, type: 'phasers', request: null }] };
  assert.equal(restoreActionLog(noRequest, identity).entries.length, 0, 'a missing payload is rejected');
  const badTurn = { ...stored, entries: [stored.entries[0], { ...stored.entries[1], turn: 0 }] };
  assert.equal(restoreActionLog(badTurn, identity).entries.length, 0, 'turns are one-based');
  const invented = { ...stored, entries: [...stored.entries, { kind: 'rescue', seq: 9, turn: 1 }] };
  assert.equal(restoreActionLog(invented, identity).entries.length, 0, 'an unknown entry kind is not smuggled through');
});

test('a real-time log rejects turn-based entries and vice versa', () => {
  const rt = realTime('log-mode-mismatch');
  let rtLog = logFor(rt);
  rtLog = recordAction(rtLog, { ...rt, simTime: 2 }, { type: 'move', dx: 5, dy: 0 });
  assert.ok(Number.isSafeInteger(rtLog.entries[0].tick));
  const stored = JSON.parse(JSON.stringify(rtLog));
  assert.equal(restoreActionLog(stored, { seed: rt.seed, battleId: rtLog.battleId, realtime: true }).entries.length, 1);
  // Stripping the tick makes it a turn-shaped entry, which a real-time log must not accept.
  const stripped = { ...stored, entries: stored.entries.map(({ tick, ...rest }) => rest) };
  assert.equal(restoreActionLog(stripped, { seed: rt.seed, battleId: rtLog.battleId, realtime: true }).entries.length, 0);
});

test('recording changes no authoritative state and consumes no gameplay randomness', () => {
  const game = turnBased('log-no-side-effects');
  const before = JSON.stringify(game);
  const stepBefore = game.randomStep;
  let log = logFor(game);
  for (let i = 0; i < 50; i += 1) {
    log = recordAction(log, game, { type: 'phasers', targetId: foe(game).id });
    log = recordSweep(log, game, `hull-${i}`);
  }
  assert.equal(game.randomStep, stepBefore, 'the seeded counter did not move');
  assert.equal(JSON.stringify(game), before, 'no authoritative field was written');
  assert.equal(log.entries.length, 100);
});

test('only actions the rules accepted are worth logging, and the seam can tell', () => {
  // `applyPlayerAction` returns the identical game object for a refusal, which is the
  // signal app.js uses. Pin that contract here so the log's "accepted only" rule has
  // something real to stand on.
  const game = turnBased('log-acceptance');
  const refused = applyPlayerAction(game, { type: 'not-a-real-command' });
  assert.equal(refused.game, game, 'a refusal returns the same object, so nothing is logged');
  const target = foe(game);
  const accepted = applyPlayerAction(game, { type: 'orders', targetId: 'fed-cruiser-1', order: { type: 'escort' } });
  if (accepted.game !== game) {
    const log = recordAction(logFor(game), game, { type: 'orders', targetId: 'fed-cruiser-1', order: { type: 'escort' } });
    assert.equal(log.entries.length, 1, 'an accepted command is logged');
    assert.equal(log.entries[0].request.order.type, 'escort');
  }
  assert.ok(getShip(game, game.playerShipId), 'the fixture really has a command ship');
  assert.ok(target, 'and a foe to aim at');
});
