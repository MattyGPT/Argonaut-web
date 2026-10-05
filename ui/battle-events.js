import { projectJournalRecord } from './battle-journal.js';

const milestones = new Set(['command-loss', 'battle-outcome', 'alliance-defeat']);
export const isTerminalEvent = (event) => event?.kind === 'destruction' || event?.kind === 'surrender' || milestones.has(event?.kind);
export const PLAYBACK_TIMING = Object.freeze({ routine: 700, critical: 2000, full: 2500 });

/** Ordered consecutive groups from ONE resolution; ordinary effects split groups. */
export const groupBattleEvents = (events = [], { mode = 'compact', timing = PLAYBACK_TIMING } = {}) => {
  const groups = [];
  for (const event of events) {
    const terminal = isTerminalEvent(event);
    const critical = Boolean(event.critical) || milestones.has(event.kind);
    const previous = groups.at(-1);
    if (mode === 'compact' && terminal && !critical && previous?.kind === 'routine' && previous.resolutionId === event.resolutionId) previous.members.push(event);
    else groups.push({ kind: terminal ? critical ? 'critical' : 'routine' : 'effect', members: [event], resolutionId: event.resolutionId,
      duration: terminal ? mode === 'full' ? timing.full : critical ? timing.critical : timing.routine : 0 });
  }
  return groups;
};

/** One session owns all waits, including replay effects. Finishing is idempotent. */
export const createPlaybackSession = (schedule = setTimeout, cancel = clearTimeout) => {
  let finished = false;
  let release = null;
  return {
    get finished() { return finished; },
    finish() { if (finished) return; finished = true; release?.(); },
    wait(duration) {
      if (finished) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { cancel(timer); release = null; resolve(); };
        const timer = schedule(done, duration);
        release = done;
      });
    },
  };
};

export const ordinaryBattleEvents = (events) => (events ?? []).filter((event) => !isTerminalEvent(event));

export const playTerminalEvents = async (events, show, wait, options = null) => {
  try {
    const groups = options ? groupBattleEvents(events, options).filter((group) => group.kind !== 'effect')
      : (events ?? []).filter(isTerminalEvent).map((event) => ({ members: [event] }));
    for (const group of groups) {
      if (options?.session?.finished) break;
      show(options ? group : group.members[0]);
      await wait(options ? group.duration : group.members[0]);
    }
  } finally { show(null); }
};

export const playReplayEvents = async (events, playEffect, presentTerminalEvent, wait, options = null) => {
  const groups = options ? groupBattleEvents(events, options) : (events ?? []).map((event) => ({ members: [event] }));
  for (const group of groups) {
    if (options?.session?.finished) break;
    const event = group.members[0];
    if (isTerminalEvent(event)) {
      await presentTerminalEvent(options ? group : event);
      continue;
    }
    const duration = playEffect(event);
    if (duration > 0) await wait(duration);
  }
};

export const withPlaybackLock = async (setLocked, play, onFailure = () => {}) => {
  setLocked(true);
  try {
    return await play();
  } catch (error) {
    onFailure();
    throw error;
  } finally {
    setLocked(false);
  }
};

export const whenPlaybackUnlocked = (isLocked, action) => (...args) => {
  if (isLocked()) return undefined;
  return action(...args);
};
/** Project the complete incoming resolution before journal retention trims it. */
export const projectPlaybackRecords = (records, journal) => (records ?? []).filter((raw) => raw.battleId === journal?.battleId
  && Number(raw.eventId?.split(':e').at(-1)) > journal.lastEventNumber).map((raw) => {
  const event = projectJournalRecord(raw, journal.pending?.[raw.ordnanceId]);
  return event ? { ...event, ownLoss: raw.knowledge?.target?.own === true } : null;
}).filter(Boolean);

/** Event-time knowledge is the only authority for historical geometry. */
export const freezeResolutionEvents = (events, records, { playerShipId, objectiveShipId } = {}) => {
  const frozen = (events ?? []).map((event) => {
    if (!['destruction', 'surrender'].includes(event.kind)) {
      const eventTime = event.simTime ?? event.resolutionId;
      const record = records.find((item) => item.actor?.id === event.fromId && item.target?.id === event.toId && (eventTime == null || item.simTime === eventTime) && ['weapon-resolution', 'ordnance-impact'].includes(item.kind));
      return Number.isFinite(record?.actor?.x) && Number.isFinite(record?.target?.x)
        && record.actor.x === event.x1 && record.actor.y === event.y1 && record.target.x === event.x2 && record.target.y === event.y2
        ? { ...event, historical: true, actorName: record.actor.name, targetName: record.target.name } : { kind: 'unavailable-effect', resolutionId: event.resolutionId };
    }
    const record = records.find((item) => item.kind === event.kind && item.target?.id === event.shipId);
    const own = record?.ownLoss || event.shipId === playerShipId;
    const objective = event.shipId === 'xanadu' || event.shipId === objectiveShipId;
    const { x, y, attackerName, attackerFaction, attackerId, ...publicEvent } = event;
    return { ...publicEvent, ...(Number.isFinite(record?.target?.x) ? { x, y } : {}),
      ...(record?.actor ? { attackerName: record.actor.name, attackerFaction: record.actor.faction, attackerId: record.actor.id } : {}),
      critical: Boolean(own || objective), importance: own ? 'Your command ship' : objective ? 'Mission objective' : null };
  });
  for (const record of records.filter((item) => item.kind === 'battle-outcome' || item.kind === 'command-loss' || (item.kind === 'command-transfer' && !item.target))) {
    const milestone = { kind: record.kind === 'command-transfer' ? 'command-loss' : record.kind, critical: true, message: record.kind === 'battle-outcome' ? record.outcome?.message ?? 'Battle completed.' : 'Federation command lost.', resolutionId: record.simTime };
    frozen.push(milestone);
  }
  // Capitulation is an explicit public broadcast, not an inferred survivor count.
  for (let i = 0; i < frozen.length; i += 1) {
    const event = frozen[i];
    if (event.kind === 'surrender' && event.cause === 'surrender' && !frozen.slice(i + 1).some((next) => next.kind === 'surrender' && next.faction === event.faction)) {
      frozen[i] = { ...event, critical: true, importance: `${event.faction} alliance surrendered` };
    }
  }
  return frozen;
};
