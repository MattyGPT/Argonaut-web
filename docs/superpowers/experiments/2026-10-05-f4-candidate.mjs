// INACTIVE F4 prototype. The runner copies this into a disposable game directory.
import { inspectExhaustion } from './exhaustion.js';
import { isActive, isDrone, isNeutral, reactorOutput } from './state.js';
import { terminalEvent } from './actions.js';
import { emitBattleRecord, snapshotShip, shipConsequences } from './battle-records.js';
export const GRACE = 3;

export function recovery(game, ship, snapshot = inspectExhaustion(game)) {
  const hull = snapshot.hulls.find(h => h.id === ship.id);
  if (!hull || !isActive(ship)) return { state: 'unknown', reasons: ['inactive'] };
  const positive = [];
  if (hull.reactorOutput > 0) positive.push('effective-output-restored');
  if (hull.repairPossible) positive.push('dockyard-repair');
  if (snapshot.hulls.some(h => h.crewAid.includes(ship.id))) positive.push('local-crew-aid');
  if (hull.boardable.length) positive.push('boarding-agency');
  if (snapshot.hulls.some(h => h.towTargets.includes(ship.id))) positive.push('effective-tow');
  if (positive.length) return { state: 'recoverable', reasons: positive };
  const reasons = [];
  if (!game.reimagined) reasons.push('classic');
  if (game.scenario && game.scenario !== 'annihilation') reasons.push('mission');
  if (snapshot.pendingOrdnance.length) reasons.push('pending-ordnance');
  if (Object.keys(game.pendingOrders ?? {}).length) reasons.push('pending-orders');
  if (snapshot.relays.some(r => r.heldBy !== r.nextHeldBy)) reasons.push('relay-transition');
  if (hull.hyperspaceHardware) reasons.push('hyperspace-agency');
  if (hull.tractorHeld || hull.tractorLockTargets.length || hull.tow?.remaining > 0
      || snapshot.hulls.some(h => h.tow?.targetId === ship.id || h.tractorLockTargets.includes(ship.id))) reasons.push('tractor-route');
  if (Object.values(hull.weapons).some(w => w.targetsInRange.length)) reasons.push('weapon-agency');
  if (snapshot.hulls.some(h => Object.values(h.weapons).some(w => w.targetsInRange.includes(ship.id)))) reasons.push('incoming-attack');
  if (hull.blastTargets.length || hull.launchAvailable) reasons.push('other-agency');
  if (snapshot.hulls.some(h => h.blastTargets.includes(ship.id))) reasons.push('incoming-blast-uncertain');
  if (snapshot.hulls.some(h => h.status === 'active' && h.faction !== ship.faction && (h.hyperspaceHardware || h.launchAvailable))) reasons.push('mobile-opponent-or-launch-uncertain');
  if (hull.encounter || hull.neutral) reasons.push('encounter');
  // Concrete local routes above are positive. Mobile support farther away is
  // explicitly unknown: a finite neighborhood is not an impossibility proof.
  const friends = snapshot.hulls.filter(h => h.id !== ship.id && h.status === 'active' && h.faction === ship.faction);
  if (friends.some(h => h.hyperspaceHardware && (h.systems.transporter > 0 || h.systems.tractor > 0))) reasons.push('mobile-support-uncertain');
  if (snapshot.relays.length && friends.some(h => h.hyperspaceHardware)) reasons.push('reachable-relay-uncertain');
  if (hull.nearbyBases.length) reasons.push('remote-dockyard-uncertain');
  return { state: reasons.length ? 'unknown' : 'blocked', reasons: reasons.length ? reasons : ['zero-output-no-current-route'] };
}

export function fieldRecovery(game, snapshot = inspectExhaustion(game)) {
  // Disabled surrender is deliberately ignored here: the field snapshot must
  // be adjudicated before that individual transition can invent a last side.
  const reasons = snapshot.reasons.filter(r => !['disabled-surrender-conditions-met', 'effective-output-exhausted', 'no-current-recovery-route'].includes(r));
  if (snapshot.recoveries.length) return { state: 'recoverable', reasons: snapshot.recoveries.map(r => r.code) };
  if (reasons.length || !snapshot.hulls.some(h => h.status === 'active')) return { state: 'unknown', reasons };
  return { state: 'blocked', reasons: ['whole-field-zero-output-no-current-route'] };
}

export function applyCandidate(game, { settlement = false, npc = false, onDecision } = {}) {
  if (!game.reimagined || game.outcome || (game.scenario && game.scenario !== 'annihilation')) return { game, messages: [], events: [] };
  const active = game.ships.filter(s => isActive(s) && !isDrone(s) && !isNeutral(s));
  if (new Set(active.map(s => s.faction)).size < 2) return { game, messages: [], events: [] };
  if (!active.some(s => reactorOutput(s, game) === 0)) return { game: resetCounts(game), messages: [], events: [] };
  const snapshot = inspectExhaustion(game);
  const field = fieldRecovery(game, snapshot);
  if (settlement && field.state === 'blocked') {
    onDecision?.({ kind: 'settlement', seed: game.seed, turn: game.turn, field, snapshot });
    return {
    game: { ...game, outcome: { kind: 'hopeless-draw', cause: 'field-exhaustion', message: 'The field is exhausted: no current action or recovery route remains.' } }, messages: [], events: [],
    };
  }
  if (!npc) return { game, messages: [], events: [] };
  const messages = [], events = [], changed = [];
  // Suppress NPC transitions in a mutually blocked field in the NPC-only arm;
  // that arm must not smuggle settlement into its outcome or choose a winner.
  const ships = game.ships.map(ship => {
    const exempt = !isActive(ship) || ship.crew <= 0 || isDrone(ship) || isNeutral(ship)
      || ship.className === 'Starbase' || (!game.resigned && ship.id === game.playerShipId);
    const result = exempt ? { state: 'unknown' } : recovery(game, ship, snapshot);
    const count = !exempt && field.state !== 'blocked' && result.state === 'blocked' ? (ship.exhaustionBoundaries ?? 0) + 1 : 0;
    if (count === 0 && !Object.hasOwn(ship, 'exhaustionBoundaries')) return ship;
    if (count < GRACE) return { ...ship, exhaustionBoundaries: count };
    const after = { ...ship, exhaustionBoundaries: count, status: 'vacant', crew: 0, tractorBy: null };
    changed.push([ship, after]);
    onDecision?.({ kind: 'npc', seed: game.seed, turn: game.turn, shipId: ship.id, field, recovery: result, snapshot });
    messages.push(`${ship.name} strikes its colors after three boundaries without effective output or a current recovery route.`);
    events.push(terminalEvent('surrender', 'exhaustion', ship));
    return after;
  });
  let next = { ...game, ships };
  for (const [before, after] of changed) next = emitBattleRecord(next, {
    kind: 'surrender', source: 'system', actionId: null, target: snapshotShip(before),
    payload: { cause: 'exhaustion', boundaries: GRACE, consequences: shipConsequences(before, after) },
  });
  return { game: next, messages, events };
}

function resetCounts(game) {
  if (!game.ships.some(s => s.exhaustionBoundaries)) return game;
  return { ...game, ships: game.ships.map(s => s.exhaustionBoundaries ? { ...s, exhaustionBoundaries: 0 } : s) };
}
