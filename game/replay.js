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

/**
 * Rebuild a war. Returns the final state plus enough accounting to tell an exact
 * reproduction from a partial one: `applied` versus `entries.length`, and whether the
 * driver stopped because the war ended or because it ran out of budget.
 */
export const replayWar = ({ seed, options = {}, entries = [], battleId = null }) => {
  let game = enableBattleRecords(createGame({ seed, ...options }), battleId ? { battleId } : {});
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  const realtime = Boolean(game.realtime);
  const applied = [];
  let steps = 0;
  let exhausted = false;
  const step = () => {
    steps += 1;
    if (steps > REPLAY_STEP_BUDGET) { exhausted = true; return false; }
    return true;
  };

  let index = 0;
  while (index < ordered.length && !game.outcome && !exhausted) {
    const entry = ordered[index];
    if (realtime) {
      if (tickOf(game) < entry.tick) {
        if (!step()) break;
        game = stepContinuum(game).game;
        continue;
      }
    } else if (game.turn < entry.turn || game.phase === 'computer') {
      if (!step()) break;
      game = resolveComputerTurns(game);
      continue;
    }
    game = applyEntry(game, entry);
    applied.push(entry);
    index += 1;
  }

  // Fly the war out to its ending, so the final state is comparable with a live war
  // that was played to completion rather than abandoned mid-fight.
  while (!game.outcome && !exhausted) {
    if (!step()) break;
    game = realtime ? stepContinuum(game).game : resolveComputerTurns(game);
  }

  return { game, applied: applied.length, total: ordered.length, steps, exhausted };
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
