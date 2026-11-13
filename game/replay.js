/**
 * The replay driver: reconstruct a war from (seed, options, entries[]) and prove it
 * reproduces the original.
 *
 * This is deliberately NOT part of `runWar` in `scripts/sim-wars.mjs`. That harness
 * exists to fly the player's hull on the same autopilot as everyone else, and the
 * CALIBRATION baselines rest on it being exactly that. A replay driver has a
 * different job — it must reproduce one specific player's decisions — so bolting it
 * on would put the balance-measurement contract at risk for no benefit.
 *
 * Two timing models, two drivers, because they advance differently:
 *
 *  - **Turn-based** has a command phase and a resolution phase. Entries key on
 *    `game.turn`, and several can share one turn because orders, refits, stances,
 *    helm turns and shield focus are free actions. So the driver resolves computer
 *    turns until the game reaches the entry's turn AND is back in the player's
 *    hands, then applies. Keying on array position instead would fire every command
 *    on the wrong stardate.
 *  - **Real time** has no command queue at all: commands resolve synchronously
 *    against a cooldown gate. Entries key on an integer tick plus a monotonic `seq`,
 *    and the driver steps the continuum one subtick at a time. Ordering among
 *    entries that share a tick is load-bearing, so `seq` — not the tick — decides.
 *
 * Sensor sweeps are re-applied through `sensorSweep`, never through
 * `applyPlayerAction`. They are not commands, and they write authoritative
 * `game.scanned`, which the hunt-the-vendetta objective reads.
 *
 * Cross-engine exactness is out of scope and stated rather than hidden: `Math.hypot`
 * and `Math.atan2` are implementation-approximated and feed authoritative range
 * gates, and `localeCompare` is an ICU-dependent tie-breaker. The artifact therefore
 * records the engine, and a mismatch is a warning, not a failure.
 */
import { REALTIME, RULES_REVISION } from './constants.js';
import { createGame } from './state.js';
import { applyPlayerAction, sensorSweep } from './actions.js';
import { enableBattleRecords, stripBattleRecordMetadata } from './battle-records.js';
import { resolveComputerTurns, stepContinuum } from './turns.js';
import { tickOf } from './action-log.js';

export const REPLAY_VERSION = 1;

/**
 * Ceiling on driver iterations. A real war is hundreds to low thousands of steps, so
 * this is a runaway guard rather than a working limit: without it a malformed entry
 * list — one whose turn or tick the driver can never reach — would spin forever.
 */
export const REPLAY_STEP_BUDGET = 200000;

/** Recorded so a cross-engine mismatch can be reported instead of silently diverging. */
export const replayEngine = () => (typeof navigator !== 'undefined' && navigator.userAgent) || `node-${process.versions?.node ?? 'unknown'}`;

const applyEntry = (game, entry) => (entry.kind === 'sweep'
  ? sensorSweep(game, entry.targetId)
  : applyPlayerAction(game, { type: entry.type, ...(entry.request ?? {}) }).game);

const advanceSim = (cursor) => (cursor.realtime ? stepContinuum(cursor.game).game : resolveComputerTurns(cursor.game));

/**
 * The single driver, expressed as a cursor. `replayWar` and the spectator's playback
 * both walk this, deliberately: the ordering rules below are the subtle part of the
 * whole slice, and keeping one copy is what stops a rebuild and a playback from
 * disagreeing about the same war.
 *
 * A cursor is immutable — every advance returns a new one — so a spectator can hold a
 * position without the driver mutating underneath it.
 */
const openCursor = ({ seed, options = {}, entries = [], battleId = null }) => {
  const game = enableBattleRecords(createGame({ seed, ...options }), battleId ? { battleId } : {});
  return {
    game,
    // Ordered by seq, never by array position: several commands can share one tick in
    // real time, and their issue order is load-bearing.
    ordered: [...entries].sort((a, b) => a.seq - b.seq),
    index: 0,
    applied: 0,
    steps: 0,
    exhausted: false,
    realtime: Boolean(game.realtime),
  };
};

/** Whether the next entry belongs at the cursor's current position in the war. */
const entryDue = (cursor) => {
  const entry = cursor.ordered[cursor.index];
  if (!entry) return false;
  // Turn-based waits for the stardate AND the player's phase, because free actions
  // (orders, refit, stance, helm, shield focus) let several entries share one turn —
  // resolving too early would fire a command on the wrong stardate.
  return cursor.realtime
    ? tickOf(cursor.game) >= entry.tick
    : cursor.game.turn >= entry.turn && cursor.game.phase !== 'computer';
};

/** Advance exactly one driver step: apply the due entry, or move the sim forward. */
const cursorAdvance = (cursor) => {
  if (cursor.exhausted || cursor.game.outcome) return cursor;
  if (cursor.steps >= REPLAY_STEP_BUDGET) return { ...cursor, exhausted: true };
  if (entryDue(cursor)) {
    return {
      ...cursor,
      game: applyEntry(cursor.game, cursor.ordered[cursor.index]),
      index: cursor.index + 1,
      applied: cursor.applied + 1,
      steps: cursor.steps + 1,
    };
  }
  return { ...cursor, game: advanceSim(cursor), steps: cursor.steps + 1 };
};

/** A replay is finished when the war ended or the runaway budget was hit. */
export const replayDone = (cursor) => Boolean(cursor?.game?.outcome) || Boolean(cursor?.exhausted);

export const replayProgress = (cursor) => ({
  stardate: cursor?.game?.turn ?? null,
  tick: cursor?.realtime ? tickOf(cursor.game) : null,
  applied: cursor?.applied ?? 0,
  total: cursor?.ordered?.length ?? 0,
  steps: cursor?.steps ?? 0,
  done: replayDone(cursor),
  exhausted: Boolean(cursor?.exhausted),
  outcome: cursor?.game?.outcome?.kind ?? null,
});

/**
 * Rebuild a war to its ending. Returns the final state plus enough accounting to tell
 * an exact reproduction from a partial one: `applied` versus `total`, and whether the
 * driver stopped because the war ended or because it ran out of budget.
 */
export const replayWar = ({ seed, options = {}, entries = [], battleId = null }) => {
  let cursor = openCursor({ seed, options, entries, battleId });
  while (!replayDone(cursor)) cursor = cursorAdvance(cursor);
  return {
    game: cursor.game,
    applied: cursor.applied,
    total: cursor.ordered.length,
    steps: cursor.steps,
    exhausted: cursor.exhausted,
  };
};

/** Open a replay at the start of the war, ready to be watched. */
export const openReplay = openCursor;

/**
 * Advance one STARDATE, applying every command that falls in between. The stardate is
 * the unit the game already renders on — `renderGame` runs per stardate boundary, not
 * per frame — so it is also the natural unit for a spectator: one step is one beat of
 * the war rather than one eighth-of-a-stardate subtick.
 */
export const advanceReplay = (cursor) => {
  if (!cursor || replayDone(cursor)) return cursor;
  const startTurn = cursor.game.turn;
  const startTick = tickOf(cursor.game);
  let next = cursor;
  do {
    next = cursorAdvance(next);
  } while (!replayDone(next) && (next.realtime
    ? tickOf(next.game) - startTick < REALTIME.ticksPerStardate
    : next.game.turn === startTurn));
  return next;
};

/**
 * Jump to a stardate by replaying forward to it. There is no seeking backwards through
 * stored states — a replay is the decisions, not the history — so rewinding means
 * re-opening the war and walking forward again. That is cheap enough to do on demand
 * and keeps memory flat however long the war ran.
 */
export const seekReplay = (cursor, stardate) => {
  if (!cursor) return cursor;
  let next = openReplay({
    seed: cursor.game.seed,
    options: replayOptionsFromGame(cursor.game),
    entries: cursor.ordered,
    battleId: cursor.game.battleRecordState?.battleId ?? null,
  });
  while (!replayDone(next) && next.game.turn < stardate) next = advanceReplay(next);
  return next;
};

/**
 * Compare a replayed war with the live one. Metadata is stripped first, because
 * record bookkeeping (counters, the collector) is not part of the war's state and
 * `battleId` is derived but still not a rule output.
 */
export const replayDivergence = (liveGame, replayedGame) => {
  const a = JSON.stringify(stripBattleRecordMetadata(liveGame));
  const b = JSON.stringify(stripBattleRecordMetadata(replayedGame));
  if (a === b) return null;
  // Point at the first differing field rather than dumping two large blobs, so a
  // divergence is diagnosable instead of merely reported.
  const left = JSON.parse(a);
  const right = JSON.parse(b);
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return { field: key, live: left[key], replayed: right[key] };
  }
  return { field: '(ordering)', live: null, replayed: null };
};

const toBytes = (text) => new TextEncoder().encode(text);

const base64urlFrom = (bytes) => {
  let text = '';
  // Chunked: a spread of a multi-hundred-KB array blows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const bytesFromBase64url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
};

const through = async (bytes, Ctor, format) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new Ctor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * The creation options a replay must carry, read back off the game.
 *
 * `regional` and `scenario` genuinely change the war — `regional` moves the starting
 * placement and `scenario` changes the objective (hunt-the-vendetta is the one that
 * reads `game.scanned`) — so both are carried. `sound` and `precision` are
 * deliberately absent: they are presentation.
 *
 * **`loadout` is deliberately NOT carried, and that is a real limitation rather than
 * an oversight.** `game.loadout` holds the *normalized* spec, and `normalizeFleetSpec`
 * is not idempotent: feeding a normalized spec back through `createGame` produces a
 * different shape entirely (measured — `{budgets, fleets, factions, xanadu}` comes
 * back as `{battle-cruiser: 1, ...}`, because the normalizer reads it as a raw
 * per-class map). So a replay that passed `game.loadout` would silently rebuild a
 * DIFFERENT war from the same seed and the same commands — precisely the failure this
 * slice exists to prevent. The raw spec the player chose is not retained on game
 * state, so it cannot be recovered here.
 *
 * Wars flown with the default fleet therefore replay exactly, and
 * `replayLoadoutIsDefault` says so. A war with a custom loadout is reported as not
 * faithfully reproducible rather than being replayed into a confident wrong answer;
 * carrying the raw spec is recorded as the follow-up that would close it.
 */
export const replayOptionsFromGame = (game) => ({
  reimagined: Boolean(game?.reimagined),
  realtime: Boolean(game?.realtime),
  ...(game?.regional ? { regional: true } : {}),
  ...(typeof game?.scenario === 'string' ? { scenario: game.scenario } : {}),
});

/**
 * Whether this war used the default fleet composition, and so can be rebuilt without
 * carrying a loadout. Compared against a freshly created game on the same seed and
 * options rather than against a hardcoded default, so a future change to the default
 * fleets cannot make this quietly wrong.
 */
export const replayLoadoutIsDefault = (game) => {
  if (!game) return true;
  const probe = createGame({
    seed: game.seed,
    reimagined: Boolean(game.reimagined),
    realtime: Boolean(game.realtime),
    regional: Boolean(game.regional),
    ...(typeof game.scenario === 'string' ? { scenario: game.scenario } : {}),
  });
  return JSON.stringify(probe.loadout ?? null) === JSON.stringify(game.loadout ?? null);
};

/**
 * The shareable artifact. Compact on purpose: it carries the seed, the options, the
 * rules revision and the entries — never the state — so a whole war fits in a URL
 * fragment. A measured war encodes to a few hundred bytes turn-based and under a
 * kilobyte in real time.
 */
export const createReplayArtifact = ({ seed, options = {}, entries = [], battleId = null, dropped = 0, loadoutFaithful = true }) => ({
  v: REPLAY_VERSION,
  rev: RULES_REVISION,
  seed,
  options,
  battleId,
  dropped,
  // False when the war used a custom fleet composition, which cannot be carried (see
  // replayOptionsFromGame). Recorded rather than guessed at, so a replay of such a
  // war is reported as approximate instead of silently rebuilding a different fleet.
  loadoutFaithful: Boolean(loadoutFaithful),
  engine: replayEngine(),
  // Only keys with real values: JSON.stringify drops `undefined`, so carrying empty
  // keys here would make the artifact compare unequal to its own round trip.
  entries: entries.map((entry) => ({
    kind: entry.kind,
    seq: entry.seq,
    turn: entry.turn,
    ...(entry.tick === undefined ? {} : { tick: entry.tick }),
    ...(entry.type === undefined ? {} : { type: entry.type }),
    ...(entry.request === undefined ? {} : { request: entry.request }),
    ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
  })),
});

export const encodeReplay = async (artifact) => base64urlFrom(await through(toBytes(JSON.stringify(artifact)), CompressionStream, 'deflate-raw'));

/**
 * Decode a shared fragment. A URL fragment is untrusted external input — anyone can
 * paste anything — so every failure mode returns null rather than throwing: bad
 * base64url, truncated deflate, non-JSON, or a shape that is not a replay.
 */
export const decodeReplay = async (fragment) => {
  try {
    const raw = String(fragment ?? '').replace(/^#?replay=/, '').trim();
    if (!raw) return null;
    const parsed = JSON.parse(new TextDecoder().decode(await through(bytesFromBase64url(raw), DecompressionStream, 'deflate-raw')));
    if (!parsed || parsed.v !== REPLAY_VERSION || typeof parsed.seed !== 'string' || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Whether an artifact can be trusted to reproduce. A rules-revision mismatch is
 * NON-FATAL by design — an old war is still worth watching — but it must be surfaced,
 * because the rules that resolve the commands may no longer be the rules that were
 * issued under.
 */
export const replayCompatibility = (artifact) => {
  if (!artifact) return { ok: false, reason: 'unreadable' };
  const complete = artifact.dropped === 0;
  // An artifact from before this field existed is assumed faithful rather than
  // rejected: refusing to load an older link is worse than noting the uncertainty.
  const faithful = artifact.loadoutFaithful !== false;
  if (artifact.rev === RULES_REVISION) {
    return { ok: true, complete, faithful, engineMatch: artifact.engine === replayEngine() };
  }
  return { ok: false, reason: 'rules', complete, faithful, recordedRev: artifact.rev, currentRev: RULES_REVISION };
};

export const REALTIME_TICKS = REALTIME.ticksPerStardate;
