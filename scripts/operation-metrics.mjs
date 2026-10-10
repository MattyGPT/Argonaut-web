/** Observation-only operation metrics. No observer field enters game state. */
import { distance, getShip, isActive, maintainedTowPair } from '../game/state.js';
import { operationVisible } from '../game/operations.js';

const attacks = new Set(['phasers', 'photons', 'spread', 'ion', 'tractor', 'self-destruct']);
const damageTaken = (record) => {
  const delta = record.payload?.consequences?.delta;
  return delta && (delta.shields < 0 || delta.crew < 0 || Object.values(delta.systems ?? {}).some((n) => n < 0));
};

export const createOperationObserver = (initial) => {
  const excluded = new Set([initial.operation.targetId, initial.operation.prizeId]);
  const initialCombat = initial.ships.filter((s) => isActive(s) && !excluded.has(s.id));
  const cohorts = ['Federation', 'Axis'].map((faction) => initialCombat.filter((s) => s.faction === faction).map((s) => s.id));
  const seenRecords = new Set();
  let previousConcentration = null, lastBoundary = -1, quietRun = 0;
  const metrics = {
    firstCommandDetection: null, firstHostileAttempt: null, firstHostileDamage: null,
    firstFriendlyDamage: null, firstSustainedConcentration: null, largestMixedCluster: 0,
    hostileAttempts: 0, hostileHits: 0, collisions: 0, blocks: 0,
    quietUnladenTravel: 0, longestQuietUnladenTravel: 0, towConnections: 0, towingMoves: 0,
    singlePulls: 0, rescueElapsed: null, finalElapsed: null, friendlyDamage: {},
  };
  const first = (key, elapsed) => { if (metrics[key] === null) metrics[key] = elapsed; };
  const consume = (records, elapsed) => {
    for (const record of records) {
      if (seenRecords.has(record.eventId)) continue;
      seenRecords.add(record.eventId);
      if (record.kind === 'action' && record.actor?.faction === 'Axis' && attacks.has(record.payload?.command)) {
        first('firstHostileAttempt', elapsed); metrics.hostileAttempts++;
      }
      if (record.kind === 'weapon-resolution' && record.actor?.faction === 'Axis' && record.payload?.result === 'hit') metrics.hostileHits++;
      if (record.kind === 'damage' && record.target?.faction === 'Federation' && damageTaken(record)) {
        first('firstFriendlyDamage', elapsed);
        if (record.actor?.faction === 'Axis') first('firstHostileDamage', elapsed);
        const delta = record.payload.consequences.delta;
        const totals = metrics.friendlyDamage[record.target.id] ??= { shields: 0, crew: 0, systems: 0 };
        totals.shields += Math.max(0, -(delta.shields ?? 0));
        totals.crew += Math.max(0, -(delta.crew ?? 0));
        totals.systems += Object.values(delta.systems ?? {}).reduce((sum, n) => sum + Math.max(0, -n), 0);
      }
      if (record.kind === 'collision') metrics.collisions++;
      if (record.kind === 'rescue-completed') first('rescueElapsed', record.payload.elapsed ?? elapsed);
    }
  };
  const contacts = (game) => {
    const actor = getShip(game, game.playerShipId);
    return isActive(actor) ? game.ships.filter((s) => s.faction === 'Axis' && isActive(s) && operationVisible(game, actor, s)).map((s) => s.id).sort() : [];
  };
  const sample = (game, elapsed = game.operation.elapsed, boundary = false) => {
    if (contacts(game).length) first('firstCommandDetection', elapsed);
    if (!boundary || elapsed === lastBoundary) return;
    lastBoundary = elapsed;
    const active = game.ships.filter((s) => isActive(s) && !excluded.has(s.id));
    const concentrated = cohorts.every((ids, side) => ids.filter((id) => {
      const ship = getShip(game, id);
      return isActive(ship) && ship.faction === ['Federation', 'Axis'][side]
        && active.some((enemy) => enemy.faction !== ship.faction && distance(ship, enemy) <= 35);
    }).length > ids.length / 2);
    if (concentrated && previousConcentration === elapsed - 1) first('firstSustainedConcentration', elapsed - 1);
    previousConcentration = concentrated ? elapsed : null;
    // Connected components, not just the nearest pair; includes reinforcements.
    const unvisited = new Set(active.map((s) => s.id));
    while (unvisited.size) {
      const group = [], queue = [unvisited.values().next().value];
      unvisited.delete(queue[0]);
      for (let i = 0; i < queue.length; i++) {
        const ship = getShip(game, queue[i]); group.push(ship);
        for (const id of unvisited) if (distance(ship, getShip(game, id)) <= 35) { unvisited.delete(id); queue.push(id); }
      }
      if (new Set(group.map((s) => s.faction)).size > 1) metrics.largestMixedCluster = Math.max(metrics.largestMixedCluster, group.length);
    }
    metrics.finalElapsed = elapsed;
  };
  const command = (before, after, action, records, accepted) => {
    if (!accepted) { metrics.blocks++; return; }
    if (action.type === 'tow-start') metrics.towConnections++;
    if (action.type === 'tractor') metrics.singlePulls++;
    if (action.type === 'move' && maintainedTowPair(before)) metrics.towingMoves++;
    if (after.operation.elapsed === before.operation.elapsed) return;
    const quiet = action.type === 'move' && !maintainedTowPair(before)
      && contacts(before).length === 0 && contacts(after).length === 0
      && !records.some((r) => ['damage', 'collision', 'capture', 'hull-extracted', 'rescue-completed', 'rescue-delayed', 'operation-notice'].includes(r.kind)
        || (r.kind === 'action' && r.actor?.faction === 'Axis' && attacks.has(r.payload?.command)));
    quietRun = quiet ? quietRun + 1 : 0;
    if (quiet) metrics.quietUnladenTravel++;
    metrics.longestQuietUnladenTravel = Math.max(metrics.longestQuietUnladenTravel, quietRun);
  };
  sample(initial, initial.operation.elapsed, true);
  return { consume, sample, command, result: () => structuredClone(metrics) };
};
