/**
 * The retained authoritative action log: everything a player actually did to a war,
 * in order, in a form that can be handed back to the rules layer and re-applied.
 *
 * This is the substrate slice S2 replays from, so its two hard requirements are
 * exactness and honesty. Exactness: an entry carries the command type plus the
 * `commandRequest` whitelist the rules already use, so re-applying an entry means
 * calling `applyPlayerAction` with the same payload — no second notion of what a
 * command is, and nothing that could drift from it. Honesty: when the log overflows
 * it says so, because a truncated log cannot replay a war from its opening and S2
 * must not pretend otherwise.
 *
 * Nothing here touches authoritative state or consumes gameplay randomness. Entries
 * are derived from the game an action was issued against, the log is a separate
 * object, and no rule reads it.
 *
 * Keying is the subtle part, and the reason entries carry a key at all rather than
 * relying on their position in the array:
 *
 *  - Turn-based keys on `game.turn`. Many player turns produce no accepted action at
 *    all — refusals, reports, free commands the rules reject — so array position and
 *    turn number diverge immediately, and only the turn tells a replay driver where
 *    an action belongs.
 *  - Real time has no command queue. Commands resolve synchronously against a
 *    cooldown gate, so several can land inside one stardate and several stardates can
 *    pass between two commands. Entries therefore carry an INTEGER tick count plus a
 *    monotonic `seq`. The tick is exact because `SUBTICK` is `1 / 8`, a power of two,
 *    so `simTime * ticksPerStardate` never accumulates float error — measured over
 *    4000 subticks. `seq` breaks ties among actions sharing one tick, and that
 *    ordering is load-bearing: two commands in the same tick resolve in the order
 *    they were issued, and a replay that reordered them would diverge.
 *
 * The hover sensor sweep is logged as a DISTINCT entry kind, never folded in with
 * actions. It bypasses `applyPlayerAction` entirely — `readHull` assigns
 * `game = sensorSweep(game, id)` — yet it writes authoritative `game.scanned`, which
 * the hunt-the-vendetta objective reads to decide whether the hunter is identified.
 * A replay reconstructed from actions alone would silently miss it and could finish
 * the objective differently.
 */
import { REALTIME } from './constants.js';
import { simTimeOf } from './realtime.js';
import { commandRequest } from './actions.js';

export const ACTION_LOG_VERSION = 1;

/**
 * Entry ceiling, chosen from measured scale rather than guessed. A 56-stardate war
 * encodes to roughly 0.5 KB turn-based and 1.4 KB real-time after deflate, which is
 * on the order of tens to a hundred entries; an entry serialises to ~95 bytes, so
 * even a 600-stardate war micro-managed in real time stays near 1,100 entries and
 * ~105 KB. 6,000 leaves several times that headroom while keeping the worst case
 * well under a localStorage quota shared with four save envelopes.
 *
 * Overflow drops the OLDEST entries and counts them in `dropped`, so the log stays
 * bounded without ever silently pretending to be complete.
 */
export const ACTION_LOG_LIMIT = 6000;

const ENTRY_KINDS = Object.freeze(['action', 'sweep']);

/**
 * The integer tick for a game. Exact in real time because `SUBTICK` is a power of
 * two; in turn-based play `simTimeOf` falls back to `turn - 1`, so the tick would be
 * a deterministic function of the turn and is omitted to keep entries small.
 */
export const tickOf = (game) => Math.round(simTimeOf(game) * REALTIME.ticksPerStardate);

export const createActionLog = ({ seed = null, battleId = null, realtime = false } = {}) => ({
  version: ACTION_LOG_VERSION,
  seed,
  battleId,
  realtime: Boolean(realtime),
  entries: [],
  nextSeq: 1,
  dropped: 0,
});

/** True when the log still reaches back to the opening of the war. */
export const actionLogComplete = (log) => Boolean(log) && log.dropped === 0;

const keyOf = (log, game) => (log.realtime ? { turn: game?.turn ?? 1, tick: tickOf(game) } : { turn: game?.turn ?? 1 });

const append = (log, entry) => {
  const entries = [...log.entries, entry];
  const overflow = entries.length - ACTION_LOG_LIMIT;
  return overflow > 0
    ? { ...log, entries: entries.slice(overflow), nextSeq: log.nextSeq + 1, dropped: log.dropped + overflow }
    : { ...log, entries, nextSeq: log.nextSeq + 1 };
};

/**
 * Record one accepted player action. `action` is the raw dispatched command; the
 * re-appliable payload comes from the rules layer's own `commandRequest`, so the log
 * cannot carry a field the rules would ignore or omit one they need.
 *
 * Callers record only actions that changed state (`outcome.game !== game`). A refusal
 * is a no-op by definition and re-applying it during a replay would simply be refused
 * again, so logging it would add volume without adding information.
 */
export const recordAction = (log, game, action) => {
  if (!log || !game || typeof action?.type !== 'string') return log;
  return append(log, {
    kind: 'action',
    seq: log.nextSeq,
    ...keyOf(log, game),
    type: action.type,
    request: commandRequest(action),
  });
};

/**
 * Record a hover sensor sweep: a distinct kind, because it is not an action and must
 * never be re-applied through `applyPlayerAction`. Callers record only when
 * `sensorSweep` actually returned a new game, so an already-scanned hull — which the
 * rules return unchanged — produces no entry.
 */
export const recordSweep = (log, game, targetId) => {
  if (!log || !game || typeof targetId !== 'string' || !targetId) return log;
  return append(log, { kind: 'sweep', seq: log.nextSeq, ...keyOf(log, game), targetId });
};

const isPlainRequest = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every((entry) => entry === null
    || ['string', 'boolean', 'number'].includes(typeof entry)
    || (entry && typeof entry === 'object' && Object.values(entry).every((inner) => typeof inner === 'string' || Number.isFinite(inner))));

const validEntry = (entry, realtime) => {
  if (!entry || typeof entry !== 'object') return false;
  if (!ENTRY_KINDS.includes(entry.kind)) return false;
  if (!Number.isSafeInteger(entry.seq) || entry.seq < 1) return false;
  if (!Number.isSafeInteger(entry.turn) || entry.turn < 1) return false;
  // A turn-based log must not carry ticks and a real-time log must carry them, so a
  // log restored against the wrong timing model is rejected rather than half-read.
  if (realtime ? !Number.isSafeInteger(entry.tick) : entry.tick !== undefined) return false;
  if (entry.kind === 'action') return typeof entry.type === 'string' && isPlainRequest(entry.request);
  return typeof entry.targetId === 'string' && entry.targetId.length > 0;
};

/**
 * Restore a stored log, or start a fresh one. A log belongs to one specific war, so
 * it is rejected — not merged, not repaired — unless the version, seed, battle
 * identity and timing model all match. That is deliberately strict: replaying a log
 * against the wrong war would produce a confidently wrong result, which is worse than
 * no result at all.
 */
export const restoreActionLog = (saved, { seed = null, battleId = null, realtime = false } = {}) => {
  const fresh = createActionLog({ seed, battleId, realtime });
  if (!saved || typeof saved !== 'object') return fresh;
  if (saved.version !== ACTION_LOG_VERSION) return fresh;
  if (saved.seed !== seed || saved.battleId !== battleId || Boolean(saved.realtime) !== Boolean(realtime)) return fresh;
  if (!Array.isArray(saved.entries)) return fresh;
  if (!saved.entries.every((entry) => validEntry(entry, Boolean(realtime)))) return fresh;
  const dropped = Number.isSafeInteger(saved.dropped) && saved.dropped > 0 ? saved.dropped : 0;
  const nextSeq = Number.isSafeInteger(saved.nextSeq) && saved.nextSeq > 0
    ? saved.nextSeq
    : saved.entries.length + dropped + 1;
  return { ...fresh, entries: saved.entries.slice(), nextSeq, dropped };
};
