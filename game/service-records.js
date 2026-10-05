/** Campaign history is observational metadata. It consumes no gameplay RNG. */
import { ACE_KILLS, FACTIONS } from './constants.js';

export const SERVICE_RETENTION = Object.freeze({ engagements: 50, milestones: 24 });
const copy = (value) => structuredClone(value);
export const fleetSnapshot = (ships) => ships.map((ship) => Object.fromEntries(
  ['campaignShipId', 'id', 'name', 'faction', 'className', 'captain', 'status', 'shields', 'crew', 'systems', 'kills', 'shotsFired', 'prize', 'dronesLaunched']
    .filter((key) => ship[key] !== undefined).map((key) => [key, copy(ship[key])]),
));
const historicalLabel = (ship) => ({ name: ship.name, captain: ship.captain ?? null, faction: ship.faction ?? FACTIONS.FEDERATION });
const emptyHistory = () => ({ version: 1, nextShipId: 1, roster: {}, engagements: [], olderEngagements: 0, aggregates: { engagements: 0 } });

/** Legacy saves get identities and an honest gap, never reconstructed exploits. */
export const ensureCampaignServiceRecords = (campaign, { fresh = false } = {}) => {
  const history = copy(campaign.serviceRecords ?? emptyHistory());
  const fleet = campaign.fleet.map((ship) => {
    const campaignShipId = ship.campaignShipId ?? `hull-${history.nextShipId++}`;
    if (!history.roster[campaignShipId]) history.roster[campaignShipId] = {
      campaignShipId, ...historicalLabel(ship), className: ship.className, status: 'serving',
      historyAvailable: fresh, engagements: 0, survived: 0, olderMilestones: 0, counts: {}, milestones: [],
    };
    return { ...ship, campaignShipId };
  });
  return { ...campaign, fleet, serviceRecords: history };
};

const appendMilestone = (record, milestone) => {
  record.counts[milestone.kind] = (record.counts[milestone.kind] ?? 0) + 1;
  record.milestones.push(copy(milestone));
  if (milestone.kind === 'loss') record.finalLoss = copy(milestone);
  const overflow = record.milestones.length - SERVICE_RETENTION.milestones;
  if (overflow > 0) { record.milestones.splice(0, overflow); record.olderMilestones += overflow; }
};
const milestone = (kind, ship, context, facts = {}) => ({ kind, ...historicalLabel(ship), ...context, ...facts });

export const recordFleetJoining = (campaign, ids, reason = 'muster') => {
  const next = ensureCampaignServiceRecords(campaign, { fresh: true });
  for (const ship of next.fleet.filter((entry) => ids.includes(entry.id))) {
    const record = next.serviceRecords.roster[ship.campaignShipId];
    record.historyAvailable = true;
    appendMilestone(record, milestone('joined', ship, { turn: next.turn, nodeId: next.currentNode }, { reason }));
  }
  return next;
};

/** Give fresh tactical garrisons identities without mistaking recurring slots for veterans. */
export const prepareCampaignBattle = (campaign, game, battleId) => {
  const next = ensureCampaignServiceRecords(campaign);
  const history = next.serviceRecords;
  const veterans = new Map(next.fleet.map((ship) => [ship.id, ship.campaignShipId]));
  const ships = game.ships.map((ship) => ({ ...ship, campaignShipId: veterans.get(ship.id) ?? `hull-${history.nextShipId++}` }));
  const entryFleet = fleetSnapshot(ships.filter((ship) => veterans.has(ship.id)));
  return { campaign: next, game: { ...game, ships, serviceRecordState: {
    battleId, nodeId: campaign.currentNode, turn: campaign.turn + 1, entryFleet,
    identities: Object.fromEntries(ships.map((ship) => [ship.id, ship.campaignShipId])),
    facts: {}, lastEvent: 0, nextShipId: history.nextShipId, detailAvailable: Boolean(game.battleRecordState),
  } } };
};

/** Feed complete C2 batches before any journal truncation; repeated batches are harmless. */
export const ingestBattleServiceRecords = (game, records = []) => {
  if (!game?.serviceRecordState) return game;
  if (!records.length && game.ships.every((ship) => game.serviceRecordState.identities[ship.id])) return game;
  const state = copy(game.serviceRecordState);
  const ships = game.ships.map((ship) => {
    state.identities[ship.id] ??= `hull-${state.nextShipId++}`;
    return ship.campaignShipId === state.identities[ship.id] ? ship : { ...ship, campaignShipId: state.identities[ship.id] };
  });
  for (const event of records) {
    if (event.battleId !== state.battleId) continue;
    const serial = Number(event.eventId?.split(':e').at(-1));
    if (!Number.isInteger(serial) || serial <= state.lastEvent) continue;
    state.lastEvent = serial;
    const towActorId = state.identities[event.actorId];
    if (event.kind === 'destruction' && event.payload?.cause === 'tractor-collision' && event.payload?.creditedKill === true
      && towActorId && event.actor?.faction === FACTIONS.FEDERATION) {
      const pending = state.facts[towActorId] ?? { counts: {}, milestones: [], olderMilestones: 0 };
      pending.directTowKills = (pending.directTowKills ?? 0) + 1;
      state.facts[towActorId] = pending;
    }
    const actorCounters = event.payload?.actorConsequences ?? (event.kind === 'action-resolution' ? event.payload?.consequences : null);
    const beforeKills = event.kind === 'ace' ? event.payload?.beforeKills : actorCounters?.before?.kills;
    const kills = event.kind === 'ace' ? event.payload?.kills : actorCounters?.after?.kills;
    const actorId = state.identities[event.actorId];
    if (actorId && event.actor?.faction === FACTIONS.FEDERATION && Number.isFinite(beforeKills) && beforeKills < ACE_KILLS && kills >= ACE_KILLS) {
      const pending = state.facts[actorId] ?? { counts: {}, milestones: [], olderMilestones: 0 };
      if (!pending.counts.ace) appendMilestone(pending, milestone('ace', event.actor,
        { battleId: state.battleId, eventId: event.eventId, nodeId: state.nodeId, turn: state.turn, simTime: event.simTime }, { kills }));
      state.facts[actorId] = pending;
    }
    if (['destruction', 'vacancy'].includes(event.kind)) {
      const id = state.identities[event.targetId];
      if (id && (state.entryFleet.some((ship) => ship.campaignShipId === id) || state.facts[id]?.origin)) {
        const pending = state.facts[id] ?? { counts: {}, milestones: [], olderMilestones: 0 };
        pending.terminal = { eventId: event.eventId, cause: event.payload?.cause ?? 'unknown', actor: event.actor ? historicalLabel(event.actor) : null, hullStatus: event.kind === 'destruction' ? 'destroyed' : 'vacant' };
        state.facts[id] = pending;
      }
      continue;
    }
    let id;
    let fact;
    if (event.kind === 'capture' && event.payload?.toFaction === FACTIONS.FEDERATION) {
      if (['Merchant', 'Drone', 'Starbase'].includes(event.target?.className)) continue;
      id = state.identities[event.targetId];
      const known = state.entryFleet.some((ship) => ship.campaignShipId === id) || Boolean(state.facts[id]?.origin);
      fact = milestone(known ? 'recaptured' : 'captured', event.payload.after ?? event.target,
        { battleId: state.battleId, eventId: event.eventId, nodeId: state.nodeId, turn: state.turn, simTime: event.simTime },
        { fromFaction: event.payload.fromFaction });
    } else if (event.kind === 'rescue' && event.payload?.qualifying === true && event.actor?.faction === FACTIONS.FEDERATION) {
      id = state.identities[event.actorId];
      fact = milestone('rescue', event.actor, { battleId: state.battleId, eventId: event.eventId, nodeId: state.nodeId, turn: state.turn, simTime: event.simTime }, { rescued: historicalLabel(event.target ?? {}), qualifying: true });
    }
    if (!id || !fact) continue;
    const pending = state.facts[id] ?? { counts: {}, milestones: [], olderMilestones: 0 };
    appendMilestone(pending, fact);
    if (fact.kind === 'captured' && !pending.origin) pending.origin = copy(fact);
    state.facts[id] = pending;
  }
  return { ...game, ships, serviceRecordState: state };
};

const differences = (before, after) => ({
  shields: (after.shields ?? 0) - (before.shields ?? 0), crew: (after.crew ?? 0) - (before.crew ?? 0),
  systems: Object.fromEntries([...new Set([...Object.keys(before.systems ?? {}), ...Object.keys(after.systems ?? {})])].map((key) => [key, (after.systems?.[key] ?? 0) - (before.systems?.[key] ?? 0)])),
  kills: (after.kills ?? 0) - (before.kills ?? 0), shotsFired: (after.shotsFired ?? 0) - (before.shotsFired ?? 0),
  droneBaySpent: !before.dronesLaunched && Boolean(after.dronesLaunched),
});

/** Finalize once after the existing economy/disposition logic has run. */
export const finalizeCampaignServiceRecords = (before, after, result, game, { scope = 'fleet' } = {}) => {
  const state = game.serviceRecordState;
  const battleId = result.battleId ?? state?.battleId;
  const normalized = ensureCampaignServiceRecords(after);
  const history = normalized.serviceRecords;
  history.nextShipId = Math.max(history.nextShipId, state?.nextShipId ?? 1);
  if (history.engagements.some((entry) => entry.battleId === battleId)) return normalized;
  const context = { battleId, nodeId: result.nodeId, turn: result.turn };
  const entryFleet = state?.entryFleet ?? [];
  const current = new Map(normalized.fleet.map((ship) => [ship.campaignShipId, ship]));
  const finalShips = new Map(game.ships.map((ship) => [ship.campaignShipId, ship]));
  const milestones = [];
  const affected = new Set([...entryFleet.map((ship) => ship.campaignShipId), ...Object.keys(state?.facts ?? {}), ...(scope === 'fleet' ? current.keys() : [])]);
  for (const id of affected) {
    const ship = current.get(id) ?? finalShips.get(id) ?? entryFleet.find((entry) => entry.campaignShipId === id);
    if (!ship) continue;
    const pending = state?.facts?.[id];
    let record = history.roster[id];
    if (!record && !pending?.origin && !current.has(id)) continue;
    record ??= { campaignShipId: id, ...historicalLabel(ship), className: ship.className, historyAvailable: true, engagements: 0, survived: 0, olderMilestones: 0, counts: {}, milestones: [] };
    history.roster[id] = record;
    if (pending) {
      record.directTowKills = (record.directTowKills ?? 0) + (pending.directTowKills ?? 0);
      for (const [kind, count] of Object.entries(pending.counts)) record.counts[kind] = (record.counts[kind] ?? 0) + count;
      record.milestones.push(...copy(pending.milestones)); record.olderMilestones += pending.olderMilestones;
      if (!record.origin && pending.origin) record.origin = copy(pending.origin);
      milestones.push(...pending.milestones.map((fact) => ({ campaignShipId: id, ...copy(fact) })));
    }
    const entered = entryFleet.find((entry) => entry.campaignShipId === id);
    const add = (kind, facts) => { const fact = milestone(kind, ship, context, facts); appendMilestone(record, fact); milestones.push({ campaignShipId: id, ...fact }); };
    if (!before.serviceRecords?.roster?.[id] && state && current.has(id)) {
      record.historyAvailable = true;
      add('joined', { reason: 'prize' });
    }
    // Prize metadata is independently authoritative when an older/disabled stream has no capture batch.
    if (current.has(id) && ship.prize && !pending?.counts.captured && !pending?.counts.recaptured
      && (!entered?.prize || (ship.prize.times ?? 1) > (entered.prize.times ?? 1))) {
      add(entered ? 'recaptured' : 'captured', { fromFaction: ship.prize.from });
      if (!record.origin) record.origin = copy(record.milestones.at(-1));
    }
    if (entered && (entered.kills ?? 0) < ACE_KILLS && (ship.kills ?? 0) >= ACE_KILLS && !pending?.counts.ace) record.aceDetailUnavailable = true;
    if ((entered || pending?.origin) && !current.has(id)) add('loss', { hullStatus: ship.status ?? 'unavailable', reason: ship.status === 'destroyed' ? 'destroyed' : ship.status === 'vacant' ? 'vacant' : ship.faction !== FACTIONS.FEDERATION ? 'captured' : 'not-carried', captainFate: 'unknown', ...(pending?.terminal?.hullStatus === ship.status ? { evidence: copy(pending.terminal) } : {}) });
    record.engagements += 1;
    if (current.has(id)) record.survived += 1;
    Object.assign(record, historicalLabel(ship), { status: current.has(id) ? 'serving' : 'lost', current: fleetSnapshot([ship])[0] });
    const overflow = record.milestones.length - SERVICE_RETENTION.milestones;
    if (overflow > 0) { record.milestones.splice(0, overflow); record.olderMilestones += overflow; }
  }
  const afterFleet = scope === 'fleet' ? fleetSnapshot(normalized.fleet) : [];
  const summary = {
    ...copy(result), battleId, scope, detailAvailable: Boolean(state?.detailAvailable), entryAvailable: Boolean(state),
    beforeFleet: entryFleet, afterFleet,
    survivors: afterFleet.filter((ship) => entryFleet.some((entry) => entry.campaignShipId === ship.campaignShipId)).map((ship) => ship.campaignShipId),
    losses: entryFleet.filter((ship) => !current.has(ship.campaignShipId)).map((ship) => ship.campaignShipId),
    prizes: afterFleet.filter((ship) => !entryFleet.some((entry) => entry.campaignShipId === ship.campaignShipId)).map((ship) => ship.campaignShipId),
    deltas: entryFleet.filter((ship) => finalShips.has(ship.campaignShipId)).map((ship) => ({ campaignShipId: ship.campaignShipId, ...differences(ship, finalShips.get(ship.campaignShipId)) })),
    milestones, disposition: { beforeOwner: before.sector.nodes.find((node) => node.id === result.nodeId)?.owner ?? null, afterOwner: after.sector.nodes.find((node) => node.id === result.nodeId)?.owner ?? null },
    credits: { before: before.credits, after: after.credits, delta: after.credits - before.credits, bounty: result.bounty ?? 0, reward: after.credits - before.credits - (result.bounty ?? 0), earned: (after.earned ?? 0) - (before.earned ?? 0), spent: (after.spent ?? 0) - (before.spent ?? 0) },
  };
  history.engagements.push(summary); history.aggregates.engagements += 1;
  const overflow = history.engagements.length - SERVICE_RETENTION.engagements;
  if (overflow > 0) { history.engagements.splice(0, overflow); history.olderEngagements += overflow; }
  return normalized;
};

export const recordDockyardService = (before, after, offer) => {
  let next = ensureCampaignServiceRecords(after);
  if (offer.kind === 'buy') return recordFleetJoining(next, [next.fleet.at(-1).id], 'commission');
  const ship = next.fleet.find((entry) => entry.id === offer.recordId);
  const old = before.fleet.find((entry) => entry.id === offer.recordId);
  next.serviceRecords.roster[ship.campaignShipId].current = fleetSnapshot([ship])[0];
  appendMilestone(next.serviceRecords.roster[ship.campaignShipId], milestone('repair', ship, { turn: next.turn, nodeId: next.currentNode }, { service: offer.kind, cost: before.credits - after.credits, before: fleetSnapshot([old])[0], after: fleetSnapshot([ship])[0], delta: differences(old, ship) }));
  return next;
};

export const serviceRecordFor = (campaign, id) => campaign?.serviceRecords?.roster?.[id] ?? null;
export const campaignMemorial = (campaign) => Object.values(campaign?.serviceRecords?.roster ?? {}).filter((record) => record.status === 'lost');
export const latestEngagement = (campaign, { scope } = {}) => campaign?.serviceRecords?.engagements?.findLast((entry) => !scope || entry.scope === scope) ?? null;
