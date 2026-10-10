/** F2 developer evidence only. These observations never select an outcome,
 * issue an order, draw RNG, or become part of saved game state. A snapshot is
 * not a tactical search: positive opportunities do not promise a future win. */
import { DOCKING, POWER_SINKS, RANGES, SHRAPNEL_EXTRA_RANGE, STALEMATE_ROUNDS } from './constants.js';
import { simTimeOf } from './realtime.js';
import {
  blastRadius, crewCapacity, distance, dockedAt, movementCapacity, hasLaunchedDrones,
  ionStormZone, isActive, isDrone, isImmovable, isNeutral, isStranded, isTractorHeld,
  powerAllocation, powerEffect, reactorOutput, sensorRange, shieldCapacity,
  systemUnits, templateSystems,
} from './state.js';

/** Safe for player-facing formatters: the detector's already confirmed text,
 * never the omniscient diagnostic classification or hidden hull information. */
export const confirmedDrawExplanation = (game) => ['draw', 'hopeless-draw'].includes(game.outcome?.kind)
  ? game.outcome.message ?? null : null;

const damagedSystems = (ship) => Object.entries(templateSystems(ship))
  .filter(([name, capacity]) => systemUnits(ship, name) < capacity).map(([name]) => name);
const point = (value) => value ? { x: value.x, y: value.y } : null;

export const inspectExhaustion = (game) => {
  const active = game.ships.filter(isActive);
  const hulls = game.ships.filter((ship) => isActive(ship) || ship.status === 'vacant').map((ship) => {
    const live = isActive(ship);
    const output = reactorOutput(ship, game);
    const sinks = Object.fromEntries(POWER_SINKS.map((sink) => [sink, powerEffect(game, ship, sink)]));
    const transporterRange = sensorRange(game, ship, 'transporter');
    const transportReady = live && systemUnits(ship, 'transporter') > 0 && ship.crew > 1;
    const inTransportRange = (other) => other.id !== ship.id && distance(ship, other) <= transporterRange;
    const boardable = transportReady ? game.ships.filter((other) => inTransportRange(other)
      && !isDrone(other) && (other.status === 'vacant' || (isActive(other) && isNeutral(other)))).map((other) => other.id) : [];
    const crewAid = transportReady ? active.filter((other) => inTransportRange(other)
      && other.faction === ship.faction && other.crew < crewCapacity(other)).map((other) => other.id) : [];
    const base = dockedAt(game, ship);
    const damaged = damagedSystems(ship);
    const repair = base && (damaged.length || ship.shields < shieldCapacity(ship) || ship.crew < crewCapacity(ship));
    const held = isTractorHeld(game, ship);
    const movement = live && !isImmovable(ship) && !held ? movementCapacity(game, ship) : 0;
    const tractorLockTargets = live && systemUnits(ship, 'tractor') > 0
      ? game.ships.filter((other) => other.id !== ship.id && isActive(other)
        && (other.faction !== ship.faction || other.encounter?.type === 'distress')
        && !isImmovable(other) && distance(ship, other) <= RANGES.tractor).map((other) => other.id) : [];
    const towTargets = sinks.tractor > 0 ? tractorLockTargets : [];
    const weapons = Object.fromEntries(['phasers', 'photons', 'ion', 'spread'].map((weapon) => [weapon, {
      units: systemUnits(ship, weapon), effectiveness: sinks.weapons,
      // The live damage roller floors a hit at one even at zero weapons power.
      minimumDamageRoll: systemUnits(ship, weapon) > 0 ? 1 : 0,
      targetsInRange: live && systemUnits(ship, weapon) > 0 && ionStormZone(game, ship) !== 'core'
        ? active.filter((other) => other.faction !== ship.faction
          && distance(ship, other) <= RANGES[weapon]).map((other) => other.id) : [],
    }]));
    const nearbyBases = active.filter((other) => other.className === 'Starbase' && other.faction === ship.faction
      && other.shields >= shieldCapacity(other) * DOCKING.minBaseCondition).map((other) => ({ id: other.id, distance: distance(ship, other), withinDockingRange: distance(ship, other) <= DOCKING.range }));
    return {
      id: ship.id, faction: ship.faction, className: ship.className, status: ship.status, neutral: isNeutral(ship),
      encounter: ship.encounter ? { ...ship.encounter } : null,
      position: point(ship), destination: point(ship.dest), crew: ship.crew, shields: ship.shields,
      shotsFired: ship.shotsFired ?? 0, shotsTaken: ship.shotsTaken ?? 0,
      systems: { ...ship.systems }, reactorOutput: output, relayOutput: output - reactorOutput(ship),
      allocation: powerAllocation(game, ship), sinks, weapons, movement,
      // The existing hyperspace action requires hardware, not engine power.
      hyperspaceHardware: live && systemUnits(ship, 'engines') > 0,
      tractorBy: ship.tractorBy ?? null, tractorHeld: held, tractorLockTargets, towTargets,
      tow: ship.tow ? { ...ship.tow } : null,
      transporterRange, boardable, crewAid, dockedAt: base?.id ?? null,
      repairPossible: Boolean(repair), damagedSystems: damaged, nearbyBases,
      disabledSurrenderEligible: Boolean((game.reimagined || game.precision) && live && ship.crew > 0
        && ship.className !== 'Starbase' && !isNeutral(ship) && (game.resigned || ship.id !== game.playerShipId)
        && !['engines', 'phasers', 'photons'].some((system) => systemUnits(ship, system) > 0)),
      launchAvailable: live && ship.className === 'Carrier' && !hasLaunchedDrones(game, ship),
      blastTargets: live ? active.filter((other) => other.id !== ship.id && !isNeutral(other)
        && distance(ship, other) <= blastRadius(ship, game) + SHRAPNEL_EXTRA_RANGE).map((other) => other.id) : [],
    };
  });
  const relays = (game.terrain ?? []).filter((feature) => feature.type === 'relay').map((relay) => {
    const occupants = active.filter((ship) => !isDrone(ship) && !isNeutral(ship) && !isTractorHeld(game, ship)
      && distance(ship, relay) <= relay.radius);
    const factions = [...new Set(occupants.map((ship) => ship.faction))];
    return { id: relay.id, heldBy: game.held?.[relay.id] ?? null, occupants: occupants.map((ship) => ship.id),
      nextHeldBy: factions.length === 1 ? factions[0] : null };
  });
  const pendingOrdnance = (game.ordnance ?? []).map((ordnance) => structuredClone(ordnance));
  const reasons = [];
  const recoveries = [];
  for (const hull of hulls) {
    if (hull.repairPossible) recoveries.push({ code: 'dockyard-repair-possible', shipId: hull.id, baseId: hull.dockedAt });
    if (hull.boardable.length) recoveries.push({ code: 'boarding-available', shipId: hull.id, targetIds: hull.boardable });
    if (hull.crewAid.length) recoveries.push({ code: 'crew-aid-available', shipId: hull.id, targetIds: hull.crewAid });
  }
  if (pendingOrdnance.length) reasons.push('ordnance-pending');
  if (relays.some((relay) => relay.heldBy !== relay.nextHeldBy)) reasons.push('relay-control-can-change');
  const liveHulls = hulls.filter((hull) => hull.status === 'active');
  if (liveHulls.some((hull) => hull.reactorOutput > 0)) reasons.push('effective-output-remains');
  if (liveHulls.some((hull) => Object.values(hull.weapons).some((weapon) => weapon.targetsInRange.length))) reasons.push('weapon-hit-remains-possible');
  if (liveHulls.some((hull) => hull.hyperspaceHardware)) reasons.push('hyperspace-hardware-remains');
  if (liveHulls.some((hull) => hull.towTargets.length)) reasons.push('effective-tow-available');
  if (liveHulls.some((hull) => hull.tractorLockTargets.length)) reasons.push('tractor-lock-available');
  if (liveHulls.some((hull) => hull.tow?.remaining > 0)) reasons.push('tow-in-progress');
  if (liveHulls.some((hull) => hull.blastTargets.length)) reasons.push('self-destruct-can-affect-other-hulls');
  if (liveHulls.some((hull) => hull.launchAvailable)) reasons.push('drone-launch-available');
  if (liveHulls.some((hull) => hull.disabledSurrenderEligible)) reasons.push('disabled-surrender-conditions-met');
  if (game.scenario && game.scenario !== 'annihilation') reasons.push('scenario-not-analyzed');
  if (!game.reimagined) reasons.push('classic-not-analyzed');
  if (liveHulls.some((hull) => hull.neutral)) reasons.push('civilian-recovery-uncertain');
  if (liveHulls.some((hull) => hull.encounter?.type === 'distress' && hull.systems.engines <= 0)) reasons.push('distress-abandonment-pending');
  if (Object.keys(game.pendingOrders ?? {}).length) reasons.push('orders-pending');
  // Positive recovery is a concrete local opportunity, never a prediction.
  // Exhausted is deliberately a small CURRENT-FIELD subset: no output, engine
  // hardware, local repair/transport/tow/relay/ordnance/launch/blast route.
  // It does not prove an infinite future or authorize an outcome/surrender.
  const classification = recoveries.length ? 'recoverable' : reasons.length || !liveHulls.length ? 'uncertain' : 'exhausted';
  if (classification === 'exhausted') reasons.push('effective-output-exhausted', 'no-current-recovery-route');
  if (!liveHulls.length) reasons.push('no-active-hulls');
  return {
    turn: game.turn, simTime: simTimeOf(game), outcome: game.outcome?.kind ?? null,
    classification, reasons, recoveries, hulls, relays, pendingOrdnance,
    existingDetector: { stranded: isStranded(game), signature: game.warSignature ?? null,
      unchangedRounds: game.stalemateRounds ?? 0, threshold: STALEMATE_ROUNDS },
  };
};

/** Retain one latest observation per stardate; no growing whole-war trace. */
export const createExhaustionDiagnostics = ({ window = 16 } = {}) => {
  if (!Number.isInteger(window) || window < 1 || window > 64) throw new Error('Exhaustion window must be 1..64 stardates.');
  const tail = [];
  let pending = null;
  let pendingTurn = null;
  const flush = () => {
    if (!pending) return;
    const snapshot = inspectExhaustion(pending);
    const previous = tail.at(-1);
    snapshot.changes = previous ? snapshot.hulls.flatMap((hull) => {
      const before = previous.hulls.find((old) => old.id === hull.id);
      if (!before) return [{ shipId: hull.id, appeared: true }];
      const moved = distance(before.position, hull.position);
      const systemDelta = Object.fromEntries(Object.keys(hull.systems).map((name) => [name, hull.systems[name] - (before.systems[name] ?? 0)]).filter(([, delta]) => delta));
      const changed = moved || hull.status !== before.status || hull.faction !== before.faction || hull.crew !== before.crew
        || hull.shields !== before.shields || Object.keys(systemDelta).length || hull.shotsFired !== before.shotsFired;
      return changed ? [{ shipId: hull.id, displacement: moved, shields: hull.shields - before.shields,
        crew: hull.crew - before.crew, systemDelta, shotsFired: hull.shotsFired - before.shotsFired,
        status: { before: before.status, after: hull.status }, faction: { before: before.faction, after: hull.faction } }] : [];
    }) : [];
    if (previous) for (const before of previous.hulls) {
      if (snapshot.hulls.some((hull) => hull.id === before.id)) continue;
      const after = pending.ships.find((ship) => ship.id === before.id);
      snapshot.changes.push({ shipId: before.id, status: { before: before.status, after: after?.status ?? 'departed' } });
    }
    snapshot.relayChanges = previous ? snapshot.relays.filter((relay) => previous.relays.find((old) => old.id === relay.id)?.heldBy !== relay.heldBy)
      .map((relay) => ({ id: relay.id, before: previous.relays.find((old) => old.id === relay.id)?.heldBy ?? null, after: relay.heldBy })) : [];
    tail.push(snapshot);
    if (tail.length > window) tail.shift();
    pending = null;
  };
  return {
    observe(game) {
      if (game.turn !== pendingTurn) flush();
      pendingTurn = game.turn;
      pending = game;
    },
    finish(outcome) {
      flush();
      if (!['draw', 'hopeless-draw', 'timeout'].includes(outcome)) return null;
      return { classification: tail.at(-1)?.classification ?? 'uncertain', tail };
    },
  };
};
