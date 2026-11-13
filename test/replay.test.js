
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, distance, getShip, normalizeFleetSpec } from '../game/state.js';
import { applyPlayerAction, sensorSweep } from '../game/actions.js';
import { enableBattleRecords, stripBattleRecordMetadata } from '../game/battle-records.js';
import { resolveComputerTurns, stepContinuum } from '../game/turns.js';
import { createActionLog, recordAction, recordSweep } from '../game/action-log.js';
import {
  REPLAY_STEP_BUDGET, REPLAY_VERSION, createReplayArtifact, decodeReplay,
  encodeReplay, replayCompatibility, replayDivergence, replayEngine,
  replayLoadoutIsDefault, replayOptionsFromGame, replayWar,
} from '../game/replay.js';
import { RULES_REVISION } from '../game/constants.js';

/**
 * Fly a real war with a deterministic, deliberately dumb player that goes through
 * the SAME seams the app uses — `applyPlayerAction` for commands, `sensorSweep` for
 * hovers — logging into a real action log. A replay test built on hand-written
 * entries would only prove the driver can replay the entries someone thought to
 * write; this proves it can replay a war.
 */
const flyWar = (seed, realtime) => {
  const battleId = `replay-${seed}`;
  let game = enableBattleRecords(createGame({ seed, reimagined: true, realtime }), { battleId });
  let log = createActionLog({ seed, battleId, realtime });
  const nearestFoe = (state) => {
    const own = getShip(state, state.playerShipId);
    let best = null;
    for (const ship of state.ships) {
      if (ship.faction === own.faction || ship.status === 'destroyed') continue;
      if (!best || distance(ship, own) < distance(best, own)) best = ship;
    }
    return best;
  };
  for (let i = 0; i < 40000 && !game.outcome; i += 1) {
    // Hover every so often so the sweep entry kind is really exercised: it is the one
    // authoritative write that bypasses applyPlayerAction.
    if (i % 17 === 0) {
      const foe = nearestFoe(game);
      if (foe) {
        const swept = sensorSweep(game, foe.id);
        if (swept !== game) { log = recordSweep(log, game, foe.id); game = swept; }
      }
    }
    const own = getShip(game, game.playerShipId);
    const foe = nearestFoe(game);
    const action = !foe ? { type: 'facing', degrees: 90 }
      : distance(own, foe) <= 30 ? { type: 'phasers', targetId: foe.id }
        : { type: 'move', dx: Math.sign(foe.x - own.x) * 12, dy: Math.sign(foe.y - own.y) * 12 };
    const outcome = applyPlayerAction(game, action);
    if (outcome.game !== game) { log = recordAction(log, game, action); game = outcome.game; }
    if (!realtime) {
      // Advance the stardate even when the player could not act, or the live war
      // stalls on one turn while the replay correctly flies on to its ending.
      if (!game.outcome) game = resolveComputerTurns(game.phase === 'computer' ? game : { ...game, phase: 'computer' });
    } else if (!game.outcome) {
      game = stepContinuum(game).game;
    }
  }
  return { game, log, battleId, options: { reimagined: true, realtime } };
};

const replayOf = ({ game, log, battleId, options }) => replayWar({
  seed: game.seed, options, entries: log.entries, battleId,
});

for (const realtime of [false, true]) {
  const label = realtime ? 'real-time' : 'turn-based';
  test(`a ${label} war replays byte-exactly from (seed, options, entries[])`, () => {
    const flown = flyWar(`replay-exact-${realtime}`, realtime);
    assert.ok(flown.game.outcome, `the fixture war really finished (${label})`);
    assert.ok(flown.log.entries.length > 5, `and the player really issued commands (${flown.log.entries.length})`);
    assert.equal(flown.log.dropped, 0, 'within the log limit, so nothing was dropped');

    const result = replayOf(flown);
    assert.equal(result.exhausted, false, 'the driver did not run out of budget');
    assert.equal(result.applied, result.total, 'every logged entry was applied');
    assert.equal(result.game.outcome?.kind, flown.game.outcome.kind, 'same outcome');
    assert.equal(result.game.turn, flown.game.turn, 'same stardate reached');
    if (realtime) assert.equal(result.game.simTime, flown.game.simTime, 'same simulated time');

    const divergence = replayDivergence(flown.game, result.game);
    assert.equal(divergence, null, `full stripped state matches: ${JSON.stringify(divergence)?.slice(0, 400)}`);
  });
}

test('sensor sweeps are reproduced, so an objective that reads game.scanned resolves the same way', () => {
  const flown = flyWar('replay-sweeps', true);
  const sweeps = flown.log.entries.filter((entry) => entry.kind === 'sweep');
  assert.ok(sweeps.length > 0, 'the fixture really performed sensor sweeps');
  const result = replayOf(flown);
  assert.deepEqual(result.game.scanned ?? {}, flown.game.scanned ?? {},
    'the replayed war knows exactly the hulls the player identified');
  assert.equal(replayDivergence(flown.game, result.game), null);
});

test('entries are applied in seq order, not array order', () => {
  const flown = flyWar('replay-ordering', true);
  const shuffled = [...flown.log.entries].reverse();
  const result = replayWar({ seed: flown.game.seed, options: flown.options, entries: shuffled, battleId: flown.battleId });
  assert.equal(replayDivergence(flown.game, result.game), null,
    'reversing the array changes nothing, because seq — not position — decides');
});

test('the artifact is small enough for a URL fragment and survives the round trip', async () => {
  const flown = flyWar('replay-codec', false);
  const artifact = createReplayArtifact({
    seed: flown.game.seed, options: flown.options, entries: flown.log.entries,
    battleId: flown.battleId, dropped: flown.log.dropped,
  });
  assert.equal(artifact.v, REPLAY_VERSION);
  const encoded = await encodeReplay(artifact);
  // A URL fragment has to survive being pasted into a chat, so it is base64url with
  // no padding and none of the characters that get percent-encoded.
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.ok(encoded.length < 8000, `a whole war fits comfortably in a fragment (${encoded.length} chars)`);
  const decoded = await decodeReplay(encoded);
  assert.deepEqual(decoded.entries, artifact.entries, 'entries survive compression exactly');
  assert.equal(decoded.seed, artifact.seed);
  assert.equal(decoded.rev, artifact.rev);
  // And the decoded artifact really replays.
  const result = replayWar({ seed: decoded.seed, options: decoded.options, entries: decoded.entries, battleId: decoded.battleId });
  assert.equal(replayDivergence(flown.game, result.game), null, 'the decoded artifact reproduces the war');
});

test('a malformed fragment is rejected rather than half-replayed', async () => {
  const flown = flyWar('replay-reject', false);
  const artifact = createReplayArtifact({ seed: flown.game.seed, options: flown.options, entries: flown.log.entries, battleId: flown.battleId });
  const good = await encodeReplay(artifact);
  assert.equal(await decodeReplay(''), null);
  assert.equal(await decodeReplay(null), null);
  assert.equal(await decodeReplay('!!!not-base64url!!!'), null);
  assert.equal(await decodeReplay(await encodeReplay({ ...artifact, v: REPLAY_VERSION + 1 })), null, 'a future version is not guessed at');
  assert.equal(await decodeReplay(await encodeReplay({ ...artifact, entries: 'nope' })), null);
  assert.equal(await decodeReplay(await encodeReplay({ ...artifact, seed: 42 })), null);
  // The `replay=` prefix a shared URL carries is stripped, and so is a leading hash.
  assert.ok(await decodeReplay(`#replay=${good}`));
  assert.ok(await decodeReplay(`replay=${good}`));
});

test('compatibility is reported, and a rules mismatch is non-fatal but never silent', () => {
  const artifact = { v: REPLAY_VERSION, rev: RULES_REVISION, dropped: 0, engine: replayEngine(), seed: 's', entries: [] };
  const current = replayCompatibility(artifact);
  assert.equal(current.ok, true, 'an artifact from these rules is reproducible');
  assert.equal(current.complete, true);
  assert.equal(current.engineMatch, true);
  assert.equal(replayCompatibility(null).ok, false);
  assert.equal(replayCompatibility(null).reason, 'unreadable');
  const stale = replayCompatibility({ ...artifact, rev: 'rules-1999-01-01a' });
  assert.equal(stale.ok, false, 'an artifact from other rules is flagged');
  assert.equal(stale.reason, 'rules');
  assert.equal(stale.recordedRev, 'rules-1999-01-01a', 'and says which revision it was');
  assert.equal(stale.currentRev, RULES_REVISION, 'and which is in force now');
  assert.equal(replayCompatibility({ ...artifact, dropped: 12 }).complete, false,
    'a truncated log admits it cannot replay from the opening');
  assert.equal(replayCompatibility({ ...artifact, engine: 'SomeOtherBrowser/1.0' }).engineMatch, false,
    'a different engine is reported, since cross-engine exactness is out of scope');
});

test('an entry the war can never reach does not hang the driver', () => {
  const game = createGame({ seed: 'replay-runaway', reimagined: true });
  // A turn number no war reaches. The driver must terminate on the war's ending
  // rather than spin: the step budget is the backstop behind that, and here the
  // outcome arrives first — which is the normal, correct way out.
  const result = replayWar({
    seed: game.seed,
    options: { reimagined: true },
    entries: [{ kind: 'action', seq: 1, turn: Number.MAX_SAFE_INTEGER, type: 'facing', request: { degrees: 90 } }],
    battleId: 'b',
  });
  assert.equal(result.applied, 0, 'the unreachable entry was never applied');
  assert.ok(result.game.outcome, 'the war still flew to its ending instead of hanging');
  assert.equal(result.exhausted, false, 'the outcome arrived before the budget did');
  assert.ok(result.steps <= REPLAY_STEP_BUDGET, 'and it stayed inside the budget');
  assert.ok(REPLAY_STEP_BUDGET >= 100000, 'the budget is large enough for a real war');
});

test('a default-fleet war is recognised as faithfully reproducible, and a custom fleet is not', () => {
  const plain = createGame({ seed: 'replay-loadout', reimagined: true });
  assert.equal(replayLoadoutIsDefault(plain), true, 'a war flown with the default fleet can be rebuilt without carrying a loadout');
  assert.equal(replayOptionsFromGame(plain).loadout, undefined, 'so no loadout is carried');

  // normalizeFleetSpec is NOT idempotent, which is why the normalized loadout on game
  // state cannot simply be fed back into createGame. Pin that, because the whole
  // reason replayOptionsFromGame omits the loadout depends on it: if normalization
  // ever became idempotent, carrying it would be safe and this test should say so.
  const renormalized = normalizeFleetSpec(plain.loadout);
  assert.notDeepEqual(renormalized, plain.loadout,
    're-normalizing a normalized loadout changes it, so it cannot round-trip through createGame');

  const custom = createGame({ seed: 'replay-loadout', reimagined: true, loadout: { xanadu: false } });
  assert.equal(replayLoadoutIsDefault(custom), false, 'a custom fleet is reported as not faithfully reproducible');
  assert.equal(createReplayArtifact({ seed: 's', entries: [], loadoutFaithful: false }).loadoutFaithful, false);
  assert.equal(replayCompatibility({ v: REPLAY_VERSION, rev: RULES_REVISION, dropped: 0, loadoutFaithful: false, engine: replayEngine(), seed: 's', entries: [] }).faithful, false,
    'and compatibility reports it rather than letting a replay silently rebuild the wrong fleet');
});

test('the artifact carries the options that change the war, and not the ones that do not', () => {
  const game = createGame({ seed: 'replay-options', reimagined: true, realtime: true, regional: true, scenario: 'hunt-the-vendetta', sound: true, precision: true });
  const options = replayOptionsFromGame(game);
  assert.equal(options.reimagined, true);
  assert.equal(options.realtime, true);
  assert.equal(options.regional, true, 'regional moves the starting placement, so it must travel');
  assert.equal(options.scenario, 'hunt-the-vendetta', 'and so must the scenario — it is the one that reads game.scanned');
  assert.equal(options.sound, undefined, 'presentation settings do not travel');
  assert.equal(options.precision, undefined);
});

test('the driver is a separate module and does not touch the balance harness or authoritative state', () => {
  const flown = flyWar('replay-purity', false);
  const before = JSON.stringify(stripBattleRecordMetadata(flown.game));
  replayOf(flown);
  assert.equal(JSON.stringify(stripBattleRecordMetadata(flown.game)), before,
    'replaying does not mutate the war it was compared against');
});
