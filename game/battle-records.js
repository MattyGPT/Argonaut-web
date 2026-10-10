/** Authoritative, ephemeral causal records. Only identity/counters and pending
 * ordnance causes belong in saves; consumers must filter before retaining facts.
 * Resolution collectors are explicitly scoped, never global, and are removed at
 * the outer boundary. Their Symbols survive immutable engine spreads, not JSON.
 */
import { distance, getShip, inRadioContact, isActive, isSpectator, nebulaHides, radioIntegrity, sensorRange } from './state.js';
import { ACE_KILLS } from './constants.js';

const COLLECTOR = Symbol('battle resolution collector');
const ACTION = Symbol('battle action context');
const copy = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const timeOf = (game) => game.simTime ?? (game.turn ?? 1) - 1;

/** Called at battle entry, outside createGame and every gameplay RNG stream. */
export const allocateBattleId = () => `battle-${globalThis.crypto.randomUUID()}`;

export const enableBattleRecords = (game, { battleId } = {}) => {
  if (game.battleRecordState) return game;
  const id = battleId ?? allocateBattleId();
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('A battle ID must be a nonempty string.');
  return { ...game, battleRecordState: { battleId: id, nextAction: 1, nextEvent: 1 } };
};

/** Frozen historical identity, accepting either a hull or an existing snapshot. */
export const snapshotShip = (ship) => ship ? freeze(copy(Object.fromEntries(
  ['id', 'name', 'faction', 'className', 'captain', 'status', 'x', 'y'].filter((key) => ship[key] !== undefined).map((key) => [key, ship[key]]),
))) : null;

const condition = (ship) => ship ? Object.fromEntries(
  ['shields', 'crew', 'systems', 'arcs', 'status', 'faction', 'x', 'y', 'tractorBy', 'kills', 'shotsFired', 'shotsTaken', 'dest', 'tow'].filter((key) => ship[key] !== undefined).map((key) => [key,
    key === 'tow' && ship.tow ? copy(Object.fromEntries(Object.entries(ship.tow).filter(([name]) => name !== 'causal'))) : copy(ship[key])]),
) : null;

/** Actual before/after facts; signed deltas mean after minus before. No rolls. */
export const shipConsequences = (before, after) => {
  const from = condition(before);
  const to = condition(after);
  const delta = {};
  for (const key of ['shields', 'crew', 'x', 'y', 'kills', 'shotsFired', 'shotsTaken']) {
    if (Number.isFinite(from?.[key]) && Number.isFinite(to?.[key])) delta[key] = to[key] - from[key];
  }
  for (const key of ['systems', 'arcs']) {
    if (from?.[key] || to?.[key]) delta[key] = Object.fromEntries([...new Set([...Object.keys(from?.[key] ?? {}), ...Object.keys(to?.[key] ?? {})])]
      .map((name) => [name, (to?.[key]?.[name] ?? 0) - (from?.[key]?.[name] ?? 0)]));
  }
  return freeze({ before: from, after: to, delta });
};

/** Event-time policy inputs, not a permission to persist the unrestricted record.
 * Own action, mapper visibility, scanning, radio contact/integrity and terminal
 * broadcast are separate facts so C3 can project only the authorized details.
 */
export const snapshotKnowledge = (game, { actor, target, kind } = {}) => {
  const observer = getShip(game, game.playerShipId);
  const active = isActive(observer);
  const shipKnowledge = (ship) => {
    if (!ship) return null;
    // Attribution may be a saved launch snapshot. Observation must use this
    // event's actual hull position/allegiance, never that historical snapshot.
    const current = getShip(game, ship.id);
    return {
      id: ship.id,
      own: Boolean(current && current.id === game.playerShipId),
      friendly: Boolean(current && observer && current.faction === observer.faction),
      // Match the mapper's unrestricted view when no active command remains.
      // A hull absent from this battlefield has no inferred current sighting.
      visible: Boolean(current && (!active || current.id === observer.id || (distance(observer, current) <= sensorRange(game, observer, 'mapper') && !nebulaHides(game, observer, current)))),
      scanned: Boolean(game.scanned?.[ship.id]),
      radioContact: Boolean(current && active && inRadioContact(game, observer, current)),
    };
  };
  return freeze({
    observedAt: timeOf(game), observer: snapshotShip(observer), observerActive: active, spectator: isSpectator(game),
    radioIntegrity: observer ? radioIntegrity(observer) : 0,
    ownAction: actor?.id === game.playerShipId,
    actor: shipKnowledge(actor), target: shipKnowledge(target),
    globalTerminal: ['destruction', 'surrender', 'battle-outcome', 'command-loss'].includes(kind)
      || Boolean(game.operation && ['hull-extracted', 'rescue-completed', 'rescue-lost', 'rescue-delayed', 'rescue-expired', 'operation-notice', 'operation-resolved', 'rescue-order', 'recovery-order', 'command-transfer'].includes(kind)),
  });
};

export const beginBattleResolution = (game) => {
  const existing = game[COLLECTOR];
  const records = existing ?? [];
  const owned = !existing;
  return { game: game.battleRecordState && owned ? { ...game, [COLLECTOR]: records } : game, records, owned, start: records.length };
};

export const finishBattleResolution = (scope, game) => {
  let clean = game;
  if (scope.owned && (game[COLLECTOR] || game[ACTION])) {
    clean = { ...game };
    delete clean[COLLECTOR];
    delete clean[ACTION];
  }
  return { game: clean, records: scope.records.slice(scope.start) };
};

/** Capture a complete synchronous resolution without changing its return shape. */
export const withBattleRecords = (game, resolve) => {
  const scope = beginBattleResolution(game);
  const result = resolve(scope.game);
  const wrapped = Boolean(result && Object.hasOwn(result, 'game'));
  const finished = finishBattleResolution(scope, wrapped ? result.game : result);
  return { result: wrapped ? { ...result, game: finished.game } : finished.game, records: finished.records };
};

export const allocateAction = (game, { actor, source = 'manual', command } = {}) => {
  if (!game.battleRecordState) return { game, action: null };
  const state = game.battleRecordState;
  const action = freeze({ actionId: `${state.battleId}:a${state.nextAction}`, actor: snapshotShip(actor), source, command: copy(command), issuedAt: timeOf(game), issuingShipId: game.playerShipId });
  return { game: { ...game, battleRecordState: { ...state, nextAction: state.nextAction + 1 } }, action };
};

export const battleActionOf = (game) => game?.[ACTION] ?? null;

/** Observe the existing counter increment while the credited captain's identity
 * is still present. A later capture must not rewrite this threshold crossing.
 */
export const recordAceCrossing = (game, before, after) => {
  const beforeKills = before?.kills ?? 0;
  const kills = after?.kills ?? 0;
  if (!game.reimagined || before?.id !== after?.id || beforeKills >= ACE_KILLS || kills < ACE_KILLS) return game;
  return emitBattleRecord(game, { kind: 'ace', actor: after, payload: { beforeKills, kills } });
};

/** A tow is causal only while its original caster still owns an active beam.
 * Callers must additionally prove this hull moved by that tow this resolution.
 */
export const activeTowCause = (game, ship, cause = ship?.tow?.causal) => {
  const caster = getShip(game, ship?.tractorBy);
  return game.reimagined && cause?.actor?.id === ship?.tractorBy && isActive(caster)
    && caster.faction === cause.actor.faction && caster.systems?.tractor > 0 ? cause : null;
};

/** Report credit is separate from ship.kills, which controls ace/vendetta buffs.
 * Keep one bounded terminal fact per destroyed hull, including launch identity.
 */
export const creditTowCollision = (game, cause, victim) => {
  if (!game.battleRecordState || !cause || victim.status !== 'destroyed' || victim.faction === cause.actor.faction) return game;
  const credits = game.battleRecordState.towCollisionCredits ?? [];
  if (credits.some((entry) => entry.target.id === victim.id)) return game;
  const credit = freeze(copy({ actor: snapshotShip(cause.actor), target: snapshotShip(victim),
    actionId: cause.actionId, source: cause.source, issuingShipId: cause.issuingShipId }));
  return { ...game, battleRecordState: { ...game.battleRecordState, towCollisionCredits: [...credits, credit] } };
};

/** Resume a saved launch cause without allocating another accepted action. */
export const withBattleCause = (game, cause, resolve) => {
  if (!game.battleRecordState || !cause) return resolve(game);
  const scope = beginBattleResolution(game);
  const result = resolve({ ...scope.game, [ACTION]: cause });
  const resolved = { ...result.game };
  if (game[ACTION]) resolved[ACTION] = game[ACTION];
  else delete resolved[ACTION];
  return { ...result, ...finishBattleResolution(scope, resolved) };
};

export const emitBattleRecord = (game, details) => {
  if (!game.battleRecordState || !game[COLLECTOR]) return game;
  const state = game.battleRecordState;
  const action = battleActionOf(game);
  const actor = details.actor === undefined ? action?.actor ?? null : details.actor;
  const target = details.target ?? null;
  const record = freeze(copy({
    ...details,
    battleId: state.battleId, eventId: `${state.battleId}:e${state.nextEvent}`, simTime: details.simTime ?? timeOf(game),
    ...(action ? { actionId: action.actionId, source: action.source, ...(action.ordnanceId ? { ordnanceId: action.ordnanceId } : {}) } : {}),
    ...(details.actionId !== undefined ? { actionId: details.actionId } : {}),
    actor: snapshotShip(actor), target: snapshotShip(target), actorId: actor?.id ?? null, targetId: target?.id ?? null,
    payload: details.payload ?? {}, knowledge: details.knowledge ?? snapshotKnowledge(game, { actor, target, kind: details.kind }),
  }));
  game[COLLECTOR].push(record);
  return { ...game, battleRecordState: { ...state, nextEvent: state.nextEvent + 1 } };
};

/** One provisional action context, committed only when the resolver accepts it.
 * Validation compares to exactly the prepared input. Rejection discards both
 * provisional identities and emitted records and restores the original game.
 */
export const withBattleAction = (game, options, resolve) => {
  if (!game?.battleRecordState) return resolve(game, null);
  const scope = beginBattleResolution(game);
  const allocated = allocateAction(scope.game, options);
  let prepared = { ...allocated.game, [ACTION]: allocated.action };
  prepared = emitBattleRecord(prepared, { kind: 'action', payload: { command: copy(options.command), ...(options.request ? { request: copy(options.request) } : {}) } });
  const outcome = resolve(prepared, allocated.action);
  const accepted = typeof options.accepted === 'function' ? options.accepted(outcome, prepared)
    : options.accepted ?? outcome.game !== prepared;
  if (!accepted) {
    scope.records.length = scope.start;
    return { ...outcome, game, records: [] };
  }
  let resolved = { ...outcome.game };
  if (game[ACTION]) resolved[ACTION] = game[ACTION];
  else delete resolved[ACTION];
  return { ...outcome, ...finishBattleResolution(scope, resolved) };
};

/** Central parity projection for games/campaigns; leaves all mechanics intact. */
export const stripBattleRecordMetadata = (value) => {
  if (Array.isArray(value)) return value.map(stripBattleRecordMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['battleRecordState', 'battleId', 'causal', 'campaignShipId', 'serviceRecords', 'serviceRecordState'].includes(key))
    .map(([key, entry]) => [key, stripBattleRecordMetadata(entry)]));
};
