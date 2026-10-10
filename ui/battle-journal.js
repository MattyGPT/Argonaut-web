// Presentation-only journal. Authoritative records cross this boundary once;
// unrestricted payloads and knowledge snapshots never enter saved UI state.
export const JOURNAL_EVENT_LIMIT = 500;
export const JOURNAL_COMMAND_LIMIT = 12;
const VERSION = 1;
const groups = ['your-ship', 'battle-developments', 'fleet-traffic'];
const critical = new Set(['destruction', 'surrender', 'capture', 'vacancy', 'command-loss', 'command-transfer', 'battle-outcome', 'relay-change', 'encounter-arrival']);
const number = (value) => Number.isFinite(value) ? value : undefined;
const text = (value) => typeof value === 'string' ? value.slice(0, 400) : undefined;
const pick = (value, keys) => Object.fromEntries(keys.flatMap((key) => {
  const item = value?.[key];
  return typeof item === 'string' ? [[key, text(item)]] : typeof item === 'boolean' || Number.isFinite(item) ? [[key, item]] : [];
}));
const identity = (ship, position = false) => ship ? pick(ship, ['id', 'name', 'faction', 'className', 'captain', 'status', ...(position ? ['x', 'y'] : [])]) : null;
const numericMap = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([key, item]) => /^[a-z][a-z0-9-]{0,40}$/i.test(key) && Number.isFinite(item)));
const requestOf = (value) => ({
  ...pick(value, ['targetId', 'shipId', 'dx', 'dy', 'x', 'y', 'towardId', 'towardX', 'towardY', 'power', 'focus', 'amount', 'transferCommand', 'kind', 'sink', 'delta', 'stance', 'degrees', 'deltaDegrees', 'arc']),
  ...(typeof value?.order?.type === 'string' ? { order: { type: text(value.order.type) } } : {}),
  ...(value?.allocation ? { allocation: numericMap(value.allocation) } : {}),
});
const eventNumber = (record, battleId) => {
  const prefix = `${battleId}:e`;
  if (typeof record?.eventId !== 'string' || !record.eventId.startsWith(prefix)) return 0;
  const suffix = record.eventId.slice(prefix.length);
  return /^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(Number(suffix)) ? Number(suffix) : 0;
};
const legacyOf = (cards) => (Array.isArray(cards) ? cards : []).filter((card) => Number.isFinite(card?.turn) && typeof card.shipName === 'string' && Array.isArray(card.messages))
  .slice(-JOURNAL_COMMAND_LIMIT).map((card, i) => ({ id: `legacy-${i}`, turn: card.turn, shipName: text(card.shipName), messages: card.messages.filter((line) => typeof line === 'string').slice(0, 30).map(text) }));

export const createJournal = (battleId, legacyTextCards = []) => ({
  version: VERSION, battleId, events: [], pending: {}, truncated: 0,
  nextSequence: 1, lastEventNumber: 0, legacyCards: legacyOf(legacyTextCards), ownCommands: [],
});

const causalKey = (event) => event.actionId ?? event.ordnanceId ?? event.eventId;
const bounded = (journal) => {
  while (journal.events.length > JOURNAL_EVENT_LIMIT) {
    // Whole causal groups are removed, including split display categories.
    // Pending causes survive separately as a small, already-filtered descriptor.
    const protectedKeys = new Set(journal.ownCommands.map((command) => command.actionId));
    const key = causalKey(journal.events.find((event) => !protectedKeys.has(causalKey(event))) ?? journal.events[0]);
    const removed = journal.events.filter((event) => causalKey(event) === key).length;
    journal.events = journal.events.filter((event) => causalKey(event) !== key);
    journal.truncated += removed;
  }
  return journal;
};

/** Project event-time permissions; own launch ownership can outlive command. */
export const projectJournalRecord = (raw, pending = null) => {
  const k = raw?.knowledge;
  if (!k || typeof raw.kind !== 'string') return null;
  const all = k.spectator === true;
  const own = k.ownAction === true || pending?.own === true;
  const received = k.target?.own === true;
  const radio = Number(k.radioIntegrity) || 0;
  const radioKnown = (part) => Boolean(part?.friendly && part?.radioContact && radio > 0);
  const visible = (part) => all || Boolean(part?.own || (k.observerActive !== false && part?.visible));
  const known = (part) => visible(part) || radioKnown(part);
  const terminal = k.globalTerminal === true;
  const observable = own || received || all || known(k.actor) || known(k.target) || terminal;
  if (!observable) return null;
  const abbreviated = !all && !own && !received && !terminal && radio < 1;
  const targetVisible = visible(k.target);
  const targetReported = radioKnown(k.target) && radio >= 1;
  const outcomeKnown = all || received || targetVisible || targetReported;
  const actorKnown = own || known(k.actor) || (terminal && raw.kind === 'command-transfer' && raw.payload?.cause === 'operation-command');
  const targetKnown = terminal || known(k.target);
  const target = targetKnown ? identity(raw.target, targetVisible) : null;
  // Delayed causes carry the launcher's old identity/position. Current mapper
  // visibility does not make that launch position a fresh impact-time sighting.
  const delayed = Boolean(raw.ordnanceId && raw.kind !== 'ordnance-launch');
  const actor = actorKnown ? identity(raw.actor, !delayed && visible(k.actor)) : identity(pending?.actor, !delayed);
  const group = own || received ? 'your-ship' : critical.has(raw.kind) ? 'battle-developments' : 'fleet-traffic';
  const payload = raw.payload ?? {};
  const event = {
    battleId: raw.battleId, eventId: raw.eventId, simTime: number(raw.simTime) ?? 0,
    observedAt: number(k.observedAt) ?? number(raw.simTime) ?? 0,
    kind: raw.kind, group, own, actor, target,
    ...(text(raw.actionId) ? { actionId: raw.actionId } : {}),
    ...(text(raw.ordnanceId) ? { ordnanceId: raw.ordnanceId } : {}),
    source: text(raw.source) ?? 'system',
    ...(own && k.observer?.id ? { issuingShipId: pending?.issuingShipId ?? k.observer.id } : {}),
    detail: abbreviated ? 'abbreviated' : 'confirmed',
  };
  if (raw.kind === 'action') {
    event.command = text(payload.command) ?? 'order';
    if (own || all) event.request = requestOf(payload.request);
    event.result = 'accepted';
  } else if (raw.kind === 'ordnance-launch') {
    event.weapon = text(payload.weapon);
    event.result = 'pending';
    if (own || all) event.destination = pick(payload.destination, ['x', 'y']);
  } else if (raw.kind === 'ordnance-impact' || raw.kind === 'weapon-resolution') {
    event.weapon = text(payload.weapon);
    // An empty impact has no target; without an observation input for its point,
    // its outcome is unknown (except to spectators). Never infer it from launch.
    event.result = outcomeKnown && !abbreviated ? text(payload.result) ?? 'resolved' : 'unknown';
  } else if (terminal) {
    event.result = text(payload.status) ?? (raw.kind === 'battle-outcome' ? 'ended' : raw.kind);
    if (raw.kind === 'battle-outcome') event.outcome = pick(payload.outcome, ['winner', 'reason', 'type', 'kind', 'message', 'faction']);
    if (raw.kind === 'operation-notice') event.cause = text(payload.message);
    if (raw.kind === 'operation-resolved') event.result = text(payload.result?.primary) ?? 'resolved';
  } else if (raw.kind === 'action-resolution') {
    event.command = text(payload.command);
    event.result = own || all || outcomeKnown ? text(payload.result) ?? 'resolved' : 'unknown';
    if (own || all) event.confirmed = {
      ...pick(payload.after, ['playerShipId', 'resigned', 'autoConn', 'heading', 'stance', 'arcFocus', 'readyAt', 'refit']),
      ...(payload.after?.power ? { power: numericMap(payload.after.power) } : {}),
      ...(payload.after?.order ? { order: requestOf({ order: payload.after.order }).order } : {}),
      ...(payload.after?.pendingOrder ? { pendingOrder: pick(payload.after.pendingOrder, ['type']) } : {}),
    };
  } else event.result = abbreviated ? 'reported' : outcomeKnown || own || !raw.target ? 'resolved' : 'unknown';
  // Global broadcasts authorize only the terminal fact, never related damage.
  const detailsAllowed = !abbreviated && !terminal && outcomeKnown;
  if (detailsAllowed) {
    const internalsKnown = all || own || received || targetReported || (targetVisible && k.target?.scanned);
    Object.assign(event, pick(payload, ['damage', 'shieldDamage', 'arc', 'cause', 'fromFaction', 'toFaction', 'distressTow', ...(internalsKnown ? ['crewDamage', 'placed', 'gained'] : [])]));
    if (payload.consequences?.delta) {
      event.delta = pick(payload.consequences.delta, internalsKnown ? ['shields', 'crew'] : ['shields']);
      if (payload.consequences.delta.arcs) event.delta.arcs = numericMap(payload.consequences.delta.arcs);
      if (internalsKnown && payload.consequences.delta.systems) event.delta.systems = numericMap(payload.consequences.delta.systems);
    }
    if ((all || own || received || targetReported || (targetVisible && k.target?.scanned)) && Array.isArray(payload.systems)) event.systems = payload.systems.filter((item) => typeof item === 'string').map(text);
    if (payload.destination && (own || targetVisible)) event.destination = pick(payload.destination, ['x', 'y']);
  }
  // Do not retain hidden outcomes merely because they accompany an own cause.
  if (!outcomeKnown && !abbreviated && ['damage', 'system-disabled'].includes(raw.kind)) return null;
  if (raw.kind === 'system-disabled' && !event.systems && !abbreviated) return null;
  return event;
};

const pendingDescriptor = (event, action) => ({
  own: event.own, actor: event.actor, source: event.source,
  issuingShipId: action?.issuingShipId ?? event.issuingShipId,
  actionId: event.actionId, ordnanceId: event.ordnanceId,
  simTime: action?.simTime ?? event.simTime, issuedSequence: action?.sequence ?? event.sequence, weapon: event.weapon,
  command: action?.command ?? event.weapon, request: action?.request,
});

/** Consume each engine batch once at a resolution boundary, never at render. */
export const appendRecords = (journal, rawRecords = []) => {
  if (!journal?.battleId || !Array.isArray(rawRecords) || !rawRecords.length) return journal;
  let next = { ...journal, events: [...journal.events], pending: { ...journal.pending }, ownCommands: [...(journal.ownCommands ?? [])] };
  const resolved = new Set();
  const startNumber = journal.lastEventNumber;
  const batch = [...rawRecords].filter((raw) => raw?.battleId === journal.battleId)
    .sort((a, b) => eventNumber(a, journal.battleId) - eventNumber(b, journal.battleId));
  for (const raw of batch) {
    const n = eventNumber(raw, journal.battleId);
    if (!n || n <= next.lastEventNumber) continue;
    next.lastEventNumber = n;
    const pending = next.pending[raw.ordnanceId];
    const event = projectJournalRecord(raw, pending);
    if (raw.kind === 'ordnance-impact') resolved.add(raw.ordnanceId);
    if (!event) continue;
    event.sequence = next.nextSequence++;
    if (event.kind === 'action' && event.own) next.ownCommands = [...next.ownCommands, {
      actionId: event.actionId, actor: event.actor, source: event.source, command: event.command,
      simTime: event.simTime, sequence: event.sequence, request: event.request,
    }].slice(-JOURNAL_COMMAND_LIMIT);
    if (pending && !next.events.some((entry) => causalKey(entry) === causalKey(event))) {
      event.launch = { ...pending };
      event.earlierDetailDiscarded = true;
    }
    next.events.push(event);
    if (event.kind === 'ordnance-launch' && event.ordnanceId) {
      const action = next.events.find((entry) => entry.actionId === event.actionId && entry.kind === 'action');
      next.pending[event.ordnanceId] = pendingDescriptor(event, action);
    }
  }
  for (const id of resolved) delete next.pending[id];
  return next.lastEventNumber === startNumber ? journal : bounded(next);
};

// Restore only this schema, rejecting mismatched battle instances. No raw
// engine record (payload/knowledge/before/after) can hitchhike through a save.
const restoreEvent = (event, battleId) => {
  if (!eventNumber(event, battleId) || !groups.includes(event.group) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) return null;
  const clean = {
    ...pick(event, ['battleId', 'eventId', 'simTime', 'observedAt', 'kind', 'group', 'own', 'actionId', 'ordnanceId', 'source', 'issuingShipId', 'detail', 'command', 'result', 'weapon', 'sequence', 'earlierDetailDiscarded', 'damage', 'shieldDamage', 'crewDamage', 'arc', 'placed', 'gained', 'cause', 'fromFaction', 'toFaction', 'distressTow']),
    actor: identity(event.actor, true), target: identity(event.target, true),
  };
  if (event.request) clean.request = requestOf(event.request);
  if (event.destination) clean.destination = pick(event.destination, ['x', 'y']);
  if (event.delta) clean.delta = { ...pick(event.delta, ['shields', 'crew']), ...(event.delta.arcs ? { arcs: numericMap(event.delta.arcs) } : {}), ...(event.delta.systems ? { systems: numericMap(event.delta.systems) } : {}) };
  if (Array.isArray(event.systems)) clean.systems = event.systems.filter((s) => typeof s === 'string').map(text);
  if (event.outcome) clean.outcome = pick(event.outcome, ['winner', 'reason', 'type', 'kind', 'message', 'faction']);
  if (event.confirmed) clean.confirmed = { ...pick(event.confirmed, ['playerShipId', 'resigned', 'autoConn', 'heading', 'stance', 'arcFocus', 'readyAt', 'refit']), ...(event.confirmed.power ? { power: numericMap(event.confirmed.power) } : {}), ...(event.confirmed.order ? { order: pick(event.confirmed.order, ['type']) } : {}), ...(event.confirmed.pendingOrder ? { pendingOrder: pick(event.confirmed.pendingOrder, ['type']) } : {}) };
  if (event.launch) clean.launch = restorePending(event.launch);
  return clean;
};
const restorePending = (item) => ({ ...pick(item, ['own', 'source', 'issuingShipId', 'actionId', 'ordnanceId', 'simTime', 'issuedSequence', 'weapon', 'command']), actor: identity(item.actor, true), ...(item.request ? { request: requestOf(item.request) } : {}) });
export const restoreJournal = (saved, battleId, legacyTextCards = []) => {
  if (!saved || saved.version !== VERSION || saved.battleId !== battleId || !Array.isArray(saved.events)) return createJournal(battleId, legacyTextCards);
  const journal = createJournal(battleId, saved.legacyCards);
  const seen = new Set();
  journal.events = saved.events.map((event) => restoreEvent(event, battleId)).filter((event) => {
    if (!event || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  }).sort((a, b) => a.sequence - b.sequence);
  journal.pending = Object.fromEntries(Object.entries(saved.pending ?? {}).filter(([id, item]) => item && typeof item === 'object' && item.ordnanceId === id).map(([id, item]) => [id, restorePending(item)]));
  journal.ownCommands = (Array.isArray(saved.ownCommands) ? saved.ownCommands : []).filter((item) => typeof item?.actionId === 'string').slice(-JOURNAL_COMMAND_LIMIT).map((item) => ({ ...pick(item, ['actionId', 'source', 'command', 'simTime', 'sequence']), actor: identity(item.actor, true), request: requestOf(item.request) }));
  journal.truncated = Math.max(0, Number.isSafeInteger(saved.truncated) ? saved.truncated : 0);
  journal.lastEventNumber = Math.max(0, Number.isSafeInteger(saved.lastEventNumber) ? saved.lastEventNumber : 0, ...journal.events.map((event) => eventNumber(event, battleId)));
  journal.nextSequence = Math.max(1, Number.isSafeInteger(saved.nextSequence) ? saved.nextSequence : 1, ...journal.events.map((event) => event.sequence + 1));
  return bounded(journal);
};

const label = (value) => String(value ?? '').replaceAll('-', ' ');
const clock = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(2);
const deltaText = (delta) => {
  if (!delta) return '';
  const details = [];
  for (const key of ['shields', 'crew']) if (delta[key]) details.push(`${Math.abs(delta[key])} ${key} ${delta[key] < 0 ? 'lost' : 'restored'}`);
  for (const [name, value] of Object.entries(delta.arcs ?? {})) if (value) details.push(`${label(name)} arc ${Math.abs(value)} ${value < 0 ? 'damage' : 'restored'}`);
  for (const [name, value] of Object.entries(delta.systems ?? {})) if (value) details.push(`${label(name)} ${value > 0 ? '+' : ''}${value}`);
  return details.length ? ` — ${details.join(', ')}` : '';
};
const requestText = (request) => {
  if (!request) return '';
  const parts = [];
  if (Number.isFinite(request.x) && Number.isFinite(request.y)) parts.push(`to ${request.x}, ${request.y}`);
  if (Number.isFinite(request.dx) || Number.isFinite(request.dy)) parts.push(`vector ${request.dx ?? 0}, ${request.dy ?? 0}`);
  for (const key of ['stance', 'focus', 'arc', 'degrees', 'amount', 'power', 'sink', 'delta', 'kind']) if (request[key] !== undefined) parts.push(`${label(key)} ${request[key]}`);
  if (request.order?.type) parts.push(`order ${label(request.order.type)}`);
  if (request.allocation) parts.push(Object.entries(request.allocation).map(([key, value]) => `${key} ${value}`).join(', '));
  return parts.length ? ` (${parts.join('; ')})` : '';
};
const confirmedText = (event) => {
  const state = event.confirmed;
  if (!state) return '';
  if (event.command === 'facing' && Number.isFinite(state.heading)) return ` — heading ${state.heading}°`;
  if (event.command === 'stance' && state.stance) return ` — ${label(state.stance)} stance`;
  if (event.command === 'arcFocus' && state.arcFocus) return ` — ${label(state.arcFocus)} shield focus`;
  if (event.command === 'power' && state.power) return ` — ${Object.entries(state.power).map(([key, value]) => `${key} ${value}`).join(', ')}`;
  if (event.command === 'refit' && state.refit) return ` — ${label(state.refit)} refit`;
  if (event.command === 'orders' && state.pendingOrder) return ` — ${label(state.pendingOrder.type)} order awaiting delivery`;
  if (event.command === 'orders' && state.order) return ` — ${label(state.order.type)} order delivered`;
  if (event.command === 'autopilot') return state.autoConn ? ' — automatic conn engaged' : ' — manual conn';
  return '';
};

/** Plain text only; renderers escape it for their output context. */
export const formatJournalEvent = (event) => {
  const actor = event.actor?.name ?? 'Unidentified ship';
  const target = event.target?.name ?? 'unobserved target';
  const suffix = event.detail === 'abbreviated' ? ' — radio report abbreviated' : '';
  switch (event.kind) {
    case 'action': return `${actor}: ${label(event.command)} accepted${event.target ? ` at ${target}` : ''}${['phasers', 'photons', 'ion', 'spread', 'pass'].includes(event.command) ? '' : requestText(event.request)}${suffix}.`;
    case 'ordnance-launch': return `${actor} launched ${label(event.weapon)}${event.target ? ` at ${target}` : ''}${suffix}.`;
    case 'ordnance-impact': return `${label(event.weapon)} impact: ${event.result === 'unknown' ? 'outcome unknown' : `${label(event.result)}${event.target ? ` at ${target}` : ''}`}${deltaText(event.delta)}${suffix}.`;
    case 'weapon-resolution': return `${actor}: ${label(event.weapon)} ${event.result === 'unknown' ? 'outcome unknown' : `${label(event.result)} at ${target}`}${deltaText(event.delta)}${suffix}.`;
    case 'damage': return `${target}: damage confirmed${deltaText(event.delta)}${suffix}.`;
    case 'system-disabled': return `${target}: ${event.systems?.map(label).join(', ') ?? 'system'} disabled${suffix}.`;
    case 'action-resolution': return `${actor}: ${label(event.command)} ${label(event.result)}${confirmedText(event)}${deltaText(event.delta)}${suffix}.`;
    case 'destruction': return `${target} destroyed.`;
    case 'surrender': return `${target} surrendered.`;
    case 'vacancy': return `${target} left vacant${suffix}.`;
    case 'capture': return `${actor} captured ${target}${event.toFaction ? ` for ${event.toFaction}` : ''}${suffix}.`;
    case 'command-transfer': return `Command transferred from ${actor} to ${target}${suffix}.`;
    case 'hull-extracted': return `${target} extracted from the operation.`;
    case 'rescue-completed': return `${target} recovered. Bring the remaining fleet home.`;
    case 'rescue-lost': return 'Sentinel is lost. Withdraw the surviving fleet.';
    case 'rescue-expired': return 'The Sentinel rescue window has closed. Withdraw the surviving fleet.';
    case 'operation-notice': return event.cause ?? 'Operation notice received.';
    case 'operation-resolved': return `Operation concluded: rescue ${event.result}.`;
    case 'command-loss': return `Command lost${event.target ? ` aboard ${target}` : ''}.`;
    case 'battle-outcome': return event.outcome?.message ?? `Battle ended${event.outcome?.winner ? `: ${event.outcome.winner}` : ''}${event.outcome?.reason ? ` — ${event.outcome.reason}` : ''}.`;
    default: return `${event.target?.name ?? actor}: ${label(event.kind)}${event.result === 'unknown' ? ' — outcome unknown' : ''}${deltaText(event.delta)}${suffix}.`;
  }
};

export const journalView = (journal) => {
  const byKey = new Map();
  for (const event of journal?.events ?? []) {
    const id = `${event.group}:${causalKey(event)}`;
    if (!byKey.has(id)) byKey.set(id, { id, group: event.group, events: [] });
    byKey.get(id).events.push(event);
  }
  const cards = [...byKey.values()].map((card) => {
    const first = card.events[0];
    const action = card.events.find((event) => event.kind === 'action');
    const launch = first.launch;
    const causal = causalKey(first);
    const pending = Object.values(journal.pending ?? {}).some((item) => (item.actionId ?? item.ordnanceId) === causal);
    const unknown = card.events.some((event) => event.result === 'unknown');
    const namedTarget = action?.request?.targetId ? card.events.find((event) => event.target?.id === action.request.targetId)?.target : action?.target;
    const weaponResult = card.events.find((event) => event.kind === 'weapon-resolution');
    const launchEvent = card.events.find((event) => event.kind === 'ordnance-launch');
    const impact = card.events.findLast((event) => event.kind === 'ordnance-impact');
    let summary = action ? formatJournalEvent({ ...action, target: namedTarget }) : launch ? `${launch.actor?.name ?? 'Your ship'}: ${label(launch.command)} launched at stardate ${clock(launch.simTime + 1)}.` : formatJournalEvent(first);
    if (action && weaponResult) summary = `${action.actor?.name ?? 'Your ship'} fired ${label(weaponResult.weapon)}${namedTarget ? ` at ${namedTarget.name}` : ''} — ${weaponResult.result === 'unknown' ? 'outcome unknown' : label(weaponResult.result)}${deltaText(weaponResult.delta)}.`;
    else if (action && launchEvent) summary = `${action.actor?.name ?? 'Your ship'} launched ${label(launchEvent.weapon)}${namedTarget ? ` at ${namedTarget.name}` : ''} — ${pending ? 'awaiting impact' : unknown ? 'outcome unknown' : label(impact?.result ?? 'resolved')}${deltaText(impact?.delta)}.`;
    else if (action) {
      const resolution = card.events.findLast((event) => event.kind === 'action-resolution');
      if (resolution) summary = `${action.actor?.name ?? 'Your ship'}: ${label(action.command)} ${label(resolution.result)}${confirmedText(resolution) || requestText(action.request)}${deltaText(resolution.delta)}.`;
    }
    return {
      ...card, sequence: Math.max(...card.events.map((event) => event.sequence)), simTime: action?.simTime ?? launch?.simTime ?? first.simTime,
      isOwnCommand: first.group === 'your-ship' && Boolean(action ? action.own !== false : launch?.own),
      commandSequence: action?.sequence ?? launch?.issuedSequence ?? first.sequence,
      actor: action?.actor ?? launch?.actor ?? first.actor, source: action?.source ?? launch?.source ?? first.source,
      command: action?.command ?? launch?.command, status: pending ? 'pending' : unknown ? 'unknown' : 'resolved',
      summary, lines: card.events.filter((event) => event !== action).map((event) => `Stardate ${clock(event.simTime + 1)} · ${formatJournalEvent(event)}`),
      earlierDetailDiscarded: Boolean(first.earlierDetailDiscarded),
    };
  }).sort((a, b) => b.sequence - a.sequence);
  for (const command of journal?.ownCommands ?? []) {
    if (cards.some((card) => card.events.some((event) => event.actionId === command.actionId))) continue;
    const pending = Object.values(journal.pending ?? {}).some((item) => item.actionId === command.actionId);
    cards.push({ ...command, id: `your-ship:${command.actionId}`, group: 'your-ship', events: [],
      isOwnCommand: true, commandSequence: command.sequence,
      status: pending ? 'pending' : 'unknown', earlierDetailDiscarded: true,
      summary: formatJournalEvent({ ...command, kind: 'action' }), lines: ['Earlier result detail discarded.'],
    });
  }
  cards.sort((a, b) => b.sequence - a.sequence);
  const legacy = (journal?.legacyCards ?? []).map((card, i) => ({
    id: card.id, group: 'your-ship', sequence: -i - 1, simTime: card.turn,
    actor: { name: card.shipName }, source: 'legacy', command: 'legacy', status: 'resolved', events: [],
    isOwnCommand: true, commandSequence: -((journal?.legacyCards?.length ?? 0) - i),
    summary: `${card.shipName} · legacy command record`, lines: [...card.messages], legacy: true,
  })).reverse();
  const yourShip = [...cards.filter((card) => card.group === 'your-ship'), ...legacy];
  return {
    yourShip, battleDevelopments: cards.filter((card) => card.group === 'battle-developments'),
    fleetTraffic: cards.filter((card) => card.group === 'fleet-traffic'),
    recentCommands: yourShip.filter((card) => card.isOwnCommand).sort((a, b) => b.commandSequence - a.commandSequence).slice(0, JOURNAL_COMMAND_LIMIT),
    latestSequence: (journal?.nextSequence ?? 1) - 1, truncated: journal?.truncated ?? 0,
  };
};
