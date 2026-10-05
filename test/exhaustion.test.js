import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { resolveDocking } from '../game/turns.js';
import { applyPlayerAction } from '../game/actions.js';
import { inspectExhaustion, createExhaustionDiagnostics, confirmedDrawExplanation } from '../game/exhaustion.js';
import { diagnoseField, parseFieldArgs } from '../scripts/diagnose-field.mjs';

const fixture = () => {
  const game = createGame({ seed: 'exhaustion-fixture', reimagined: true });
  return { ...game, terrain: [], held: {}, ships: ['fed-flagship', 'axis-flagship'].map((id, index) => {
    const ship = getShip(game, id);
    return { ...ship, x: 10 + index * 170, y: 10, systems: Object.fromEntries(Object.keys(ship.systems).map((name) => [name, 0])) };
  }) };
};
const hull = (snapshot, id = 'fed-flagship') => snapshot.hulls.find((ship) => ship.id === id);

test('mutually exhausted current field is observed without changing state or RNG', () => {
  const game = fixture();
  // Starbases do not undergo the existing disabled-ship surrender transition.
  game.ships = game.ships.map((ship) => ({ ...ship, className: 'Starbase' }));
  const before = JSON.stringify(game);
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'exhausted');
  assert.ok(result.reasons.includes('effective-output-exhausted'));
  assert.equal(JSON.stringify(game), before);
  assert.equal(result.simTime, game.turn - 1);
  assert.deepEqual(inspectExhaustion({ ...game, ships: [...game.ships].reverse() }).classification, result.classification);
});

test('disabled non-command crewed hull records existing surrender eligibility and remains uncertain', () => {
  const game = fixture();
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'uncertain');
  assert.equal(hull(result).disabledSurrenderEligible, false);
  assert.equal(hull(result, 'axis-flagship').disabledSurrenderEligible, true);
});

test('dead reactor supported by a held relay has effective output and remains uncertain', () => {
  const game = fixture();
  game.terrain = [{ id: 'relay', type: 'relay', x: 10, y: 10, radius: 8 }];
  game.held = { relay: game.ships[0].faction };
  const result = inspectExhaustion(game);
  assert.ok(hull(result).reactorOutput > 0);
  assert.equal(hull(result).reactorOutput, hull(result).relayOutput);
  assert.equal(result.classification, 'uncertain');
});

test('dead reactor at eligible Xanadu has real dockyard recovery; tractor-held hull does not dock', () => {
  const game = fixture();
  const base = getShip(createGame({ reimagined: true }), 'xanadu');
  game.ships.push({ ...base, x: 12, y: 10 });
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'recoverable');
  assert.equal(hull(result).dockedAt, 'xanadu');
  assert.ok(hull(result).repairPossible);
  assert.notDeepEqual(resolveDocking(game).game.ships[0].systems, game.ships[0].systems);
  game.ships[0].tractorBy = 'axis-flagship';
  assert.equal(hull(inspectExhaustion(game)).repairPossible, false);
});

test('boarding reach uses powered boarder; a still-crewed enemy cannot be boarded', () => {
  const game = fixture();
  game.ships[0].systems = { ...game.ships[0].systems, reactor: 5, transporter: 2 };
  game.ships[1] = { ...game.ships[1], x: 25, status: 'vacant', crew: 0 };
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'recoverable');
  assert.deepEqual(hull(result).boardable, ['axis-flagship']);
  assert.equal(hull(result, 'axis-flagship').reactorOutput, 0);
  game.ships[1] = { ...game.ships[1], status: 'active', crew: 2 };
  assert.deepEqual(hull(inspectExhaustion(game)).boardable, []);
  assert.equal(inspectExhaustion(game).classification, 'uncertain');
});

test('pending torpedo prevents exhausted classification even with all reactors dead', () => {
  const game = fixture();
  game.ordnance = [{ id: 'inbound', kind: 'photons', x: 25, y: 10, targetId: 'fed-flagship' }];
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'uncertain');
  assert.ok(result.reasons.includes('ordnance-pending'));
  result.pendingOrdnance[0].x = 99;
  assert.equal(game.ordnance[0].x, 25);
});

test('a zero-power phaser still has the existing one-unit damage floor beyond self-destruct reach', () => {
  const game = fixture();
  game.ships[0].systems.phasers = 1;
  game.ships[1].x = 35;
  const result = inspectExhaustion(game);
  assert.equal(result.classification, 'uncertain');
  assert.equal(hull(result).sinks.weapons, 0);
  assert.deepEqual(hull(result).blastTargets, []);
  assert.ok(result.reasons.includes('weapon-hit-remains-possible'));
  const fired = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(getShip(fired.game, 'axis-flagship').shields, game.ships[1].shields - 1);
});

test('zero engine power still leaves hardware-gated hyperspace; zero-power tractor does not create an effective tow', () => {
  const game = fixture();
  game.ships[0].systems.engines = 1;
  game.ships[0].systems.tractor = 1;
  game.ships[1].x = 20;
  let result = inspectExhaustion(game);
  assert.equal(hull(result).movement, 0);
  assert.ok(result.reasons.includes('hyperspace-hardware-remains'));
  assert.deepEqual(hull(result).towTargets, []);
  assert.deepEqual(hull(result).tractorLockTargets, ['axis-flagship']);
  game.ships[0].systems.reactor = 5;
  result = inspectExhaustion(game);
  assert.deepEqual(hull(result).towTargets, ['axis-flagship']);
});

test('nearby self-destruct and empty carrier bay are conservatively unresolved opportunities', () => {
  const game = fixture();
  game.ships[1].x = 15;
  assert.ok(inspectExhaustion(game).reasons.includes('self-destruct-can-affect-other-hulls'));
  game.ships[1].x = 180;
  game.ships[0].className = 'Carrier';
  assert.ok(inspectExhaustion(game).reasons.includes('drone-launch-available'));
});

test('tow facts exclude vacant and ordinary friendly hulls but include distress rescue; in-flight tow blocks exhaustion', () => {
  const game = fixture();
  game.ships[0].systems = { ...game.ships[0].systems, reactor: 5, tractor: 2 };
  game.ships[1] = { ...game.ships[1], x: 20, faction: game.ships[0].faction };
  assert.deepEqual(hull(inspectExhaustion(game)).towTargets, []);
  game.ships[1].encounter = { type: 'distress' };
  assert.deepEqual(hull(inspectExhaustion(game)).towTargets, ['axis-flagship']);
  game.ships[1].status = 'vacant';
  assert.deepEqual(hull(inspectExhaustion(game)).towTargets, []);
  const dead = fixture();
  dead.ships[0].tow = { x: 30, y: 10, rate: 1, remaining: 4 };
  assert.ok(inspectExhaustion(dead).reasons.includes('tow-in-progress'));
});

test('a relay about to change ownership blocks exhaustion before output is restored', () => {
  const game = fixture();
  game.terrain = [{ id: 'relay', type: 'relay', x: 10, y: 10, radius: 8 }];
  const result = inspectExhaustion(game);
  assert.equal(hull(result).reactorOutput, 0);
  assert.ok(result.reasons.includes('relay-control-can-change'));
});

test('a distress hull awaiting timed abandonment remains uncertain', () => {
  const game = fixture();
  game.ships[0].encounter = { type: 'distress', turn: game.turn };
  assert.equal(inspectExhaustion(game).classification, 'uncertain');
  assert.ok(inspectExhaustion(game).reasons.includes('distress-abandonment-pending'));
});

test('observation tail is bounded by stardates and retains latest substep, changes and existing signature', () => {
  const collector = createExhaustionDiagnostics({ window: 2 });
  const game = fixture();
  for (let turn = 1; turn <= 4; turn += 1) {
    collector.observe({ ...game, turn, simTime: turn + 0.2 });
    collector.observe({ ...game, turn, simTime: turn + 0.8, warSignature: `sig-${turn}`, stalemateRounds: turn,
      ships: game.ships.map((ship) => ({ ...ship, x: ship.x + turn })) });
  }
  const result = collector.finish('timeout');
  assert.deepEqual(result.tail.map((snapshot) => snapshot.turn), [3, 4]);
  assert.equal(result.tail.at(-1).simTime, 4.8);
  assert.equal(result.tail.at(-1).existingDetector.signature, 'sig-4');
  assert.equal(result.tail.at(-1).changes[0].displacement, 1);
  assert.throws(() => createExhaustionDiagnostics({ window: 65 }));
  assert.equal(collector.finish('federation-win'), null);
});

test('player explanation is only the already confirmed draw message, never hidden analysis', () => {
  const game = fixture();
  assert.equal(confirmedDrawExplanation(game), null);
  assert.equal(confirmedDrawExplanation({ ...game, outcome: { kind: 'timeout' } }), null);
  assert.equal(confirmedDrawExplanation({ ...game, outcome: { kind: 'hopeless-draw', message: 'Confirmed detector reason.' } }), 'Confirmed detector reason.');
  assert.equal(confirmedDrawExplanation({ ...game, outcome: { kind: 'draw' } }), null);
});

test('paired diagnostics preserve every state and RNG in both timing modes and expose bounded timeout evidence', () => {
  for (const mode of ['reimagined', 'realtime']) {
    const report = diagnoseField({ mode, seed: 'sim-7', maxStardates: 4, exhaustionWindow: 2 });
    assert.equal(report.summary.exactStateAndMetricsParity, true);
    assert.equal(report.wars[0].normal.outcome, 'timeout');
    assert.ok(report.wars[0].exhaustion.tail.length <= 2);
  }
  assert.equal(parseFieldArgs(['--exhaustion-window', '8']).exhaustionWindow, 8);
  assert.throws(() => parseFieldArgs(['--exhaustion-window', '0']));
});
