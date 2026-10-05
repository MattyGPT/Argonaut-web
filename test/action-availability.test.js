import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, applyPlayerAction, REALTIME_COOLDOWN } from '../game/actions.js';
import { DEFAULT_CREW_TRANSFER, RANGES } from '../game/constants.js';
import { createGame, crewCapacity, getShip, sensorRange } from '../game/state.js';
import { simTimeOf } from '../game/realtime.js';

const targeted = ['phasers', 'photons', 'spread', 'ion', 'tractor', 'scan', 'transport'];
const gameFor = (options = {}) => {
  const game = createGame({ seed: 'availability-contract', ...options });
  return { ...game, terrain: [], ships: game.ships.map((ship) => ({
    ...ship, x: ship.id === game.playerShipId ? 10 : 15, y: 10,
    ...(ship.id === game.playerShipId ? { systems: { ...ship.systems, ion: 1, spread: 1 } } : {}),
  })) };
};
const changeShip = (game, id, patch) => ({ ...game, ships: game.ships.map((ship) => ship.id === id ? { ...ship, ...patch } : ship) });
const freeze = (object) => {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    Object.freeze(object);
    Object.values(object).forEach(freeze);
  }
  return object;
};
const rejected = (game, action, code) => {
  const before = structuredClone(game);
  const availability = actionAvailability(freeze(game), action);
  assert.equal(availability.available, false);
  assert.equal(availability.reasonCode, code);
  const result = applyPlayerAction(game, action);
  assert.deepEqual(result.messages, [availability.reason]);
  assert.deepEqual(result.game, before);
  assert.deepEqual(game, before);
  assert.equal(result.requiresTarget, availability.requiresTarget);
  return availability;
};

test('all target commands share hardware validation with execution', () => {
  for (const type of targeted) {
    const base = gameFor();
    const actor = getShip(base, base.playerShipId);
    const system = { scan: 'scanner', transport: 'transporter' }[type] ?? type;
    const game = changeShip(base, actor.id, { systems: { ...actor.systems, [system]: 0 } });
    rejected(game, { type, targetId: 'axis-flagship' }, 'hardware-unavailable');
  }
});

test('target reasons preserve allegiance, status, self-target and target-required checks', () => {
  for (const type of ['phasers', 'photons', 'spread', 'ion', 'tractor']) {
    const base = gameFor();
    rejected(changeShip(base, 'axis-flagship', { faction: 'Federation' }), { type, targetId: 'axis-flagship' }, 'wrong-allegiance');
    rejected(changeShip(gameFor(), 'axis-flagship', { status: 'vacant' }), { type, targetId: 'axis-flagship' }, 'wrong-status');
  }
  rejected(gameFor(), { type: 'scan', targetId: 'fed-flagship' }, 'self-target');
  rejected(gameFor(), { type: 'scan' }, 'target-required');
  rejected(gameFor(), { type: 'scan', targetId: 'missing-ship' }, 'target-unavailable');
});

test('target ranges use actual weapon and sensor ranges', () => {
  for (const type of targeted) {
    const base = gameFor({ reimagined: true });
    const actor = getShip(base, base.playerShipId);
    const range = type === 'scan' || type === 'transport'
      ? sensorRange(base, actor, type === 'scan' ? 'scanner' : 'transporter') : RANGES[type];
    const game = changeShip(base, 'axis-flagship', { x: actor.x + range + 0.01, y: actor.y });
    const availability = rejected(game, { type, targetId: 'axis-flagship' }, 'out-of-range');
    assert.equal(availability.facts.range, range);
    assert.ok(availability.facts.distance > range);
  }
});

test('transport exposes crew limits with the exact execution validation order', () => {
  const base = gameFor();
  const target = getShip(base, 'axis-flagship');
  const friendly = changeShip(base, target.id, { faction: 'Federation', crew: crewCapacity(target) - 20 });
  rejected(changeShip(friendly, base.playerShipId, { crew: DEFAULT_CREW_TRANSFER }), { type: 'transport', targetId: target.id }, 'insufficient-crew');
  rejected(friendly, { type: 'transport', targetId: target.id, amount: 0 }, 'invalid-crew-amount');
  rejected(changeShip(friendly, target.id, { crew: crewCapacity(target) }), { type: 'transport', targetId: target.id }, 'crew-capacity');
  rejected(base, { type: 'transport', targetId: target.id, amount: 0 }, 'wrong-allegiance');
  rejected(changeShip(base, target.id, { status: 'surrendered' }), { type: 'transport', targetId: target.id }, 'wrong-status');
});

test('the spent real-time cycle is shared by every cycling command and uses fractional sim time', () => {
  const base = gameFor({ realtime: true });
  const game = { ...base, simTime: 3.25, readyAt: { [base.playerShipId]: 4.1 } };
  for (const type of REALTIME_COOLDOWN) {
    const availability = rejected(game, { type, targetId: 'axis-flagship' }, 'cooldown');
    assert.deepEqual(availability.facts.readiness, { ready: false, simTime: 3.25, readyAt: 4.1, remaining: 4.1 - 3.25 });
  }
  assert.equal(actionAvailability(game, { type: 'scan', targetId: 'axis-flagship' }).available, true);
  assert.equal(actionAvailability({ ...game, simTime: 4.1 }, { type: 'phasers', targetId: 'axis-flagship' }).available, true);
  const legacy = { ...game, simTime: undefined, turn: 5 };
  assert.equal(actionAvailability(legacy, { type: 'phasers' }).facts.readiness.simTime, simTimeOf(legacy));
});

test('one accepted volley blocks another weapon through the actual shared cycle', () => {
  const game = gameFor({ realtime: true });
  const action = { type: 'photons', targetId: 'axis-flagship' };
  assert.equal(actionAvailability(game, action).available, true);
  const fired = applyPlayerAction(game, action).game;
  assert.ok(fired.readyAt[game.playerShipId] > simTimeOf(fired));
  rejected(fired, { type: 'ion', targetId: 'axis-flagship' }, 'cooldown');
});

test('reading successful previews leaves all state, causal counters and RNG unchanged', () => {
  for (const options of [{}, { reimagined: true }, { realtime: true }]) {
    let game = gameFor(options);
    game = changeShip(game, 'axis-flagship', { status: 'vacant' });
    const before = structuredClone(game);
    const transport = { type: 'transport', targetId: 'axis-flagship' };
    const expected = applyPlayerAction(game, transport);
    for (let index = 0; index < 10; index += 1) {
      assert.equal(actionAvailability(freeze(game), transport).available, true);
      assert.equal(actionAvailability(game, { type: 'scan', targetId: 'axis-flagship' }).available, true);
    }
    assert.deepEqual(game, before);
    assert.deepEqual(applyPlayerAction(game, transport), expected);
    assert.equal(expected.game.phase, options.realtime ? 'player' : 'computer');
  }
});

test('revalidation rejects a moved or destroyed explicit target without substituting another hull', () => {
  const game = gameFor();
  const action = { type: 'phasers', targetId: 'axis-flagship' };
  assert.equal(actionAvailability(game, action).available, true);
  rejected(changeShip(game, action.targetId, { x: 99, y: 99 }), action, 'out-of-range');
  rejected(changeShip(game, action.targetId, { status: 'destroyed' }), action, 'target-unavailable');
  const alternative = game.ships.find((ship) => ship.faction === 'Axis' && ship.id !== action.targetId);
  assert.equal(actionAvailability(game, { ...action, targetId: alternative.id }).available, true);
});

test('unknown geometry reveals no target values or target-dependent reason', () => {
  const base = gameFor();
  const action = { type: 'phasers', targetId: 'axis-flagship' };
  const hidden = actionAvailability(base, action, { targetKnown: false });
  assert.equal(hidden.reasonCode, 'target-unknown');
  assert.equal(hidden.facts.distance, null);
  assert.deepEqual(hidden, actionAvailability(changeShip(base, action.targetId, { x: 100, y: 100, status: 'destroyed', shields: 99999, faction: 'Federation' }), action, { targetKnown: false }));
  assert.deepEqual(Object.keys(hidden.facts).sort(), ['distance', 'range', 'readiness']);
  assert.equal(JSON.stringify(hidden).includes('Firebreather'), false);
});

test('tractor release and friendly distress tow retain their existing exceptions', () => {
  const base = gameFor({ reimagined: true });
  const game = changeShip(base, 'axis-flagship', { faction: 'Federation', encounter: { type: 'distress' } });
  for (const action of [{ type: 'tractor' }, { type: 'tractor', targetId: 'axis-flagship' }]) {
    assert.equal(actionAvailability(game, action).available, true);
    assert.notDeepEqual(applyPlayerAction(game, action).game, game);
  }
});

test('terrain denials share the original ion-storm and nebula rules', () => {
  const base = gameFor({ reimagined: true });
  const storm = { ...base, terrain: [{ id: 'storm', type: 'ion-storm', x: 10, y: 10, radius: 20 }] };
  for (const type of ['phasers', 'photons', 'spread', 'ion', 'radio']) rejected(storm, { type, targetId: 'axis-flagship' }, 'ion-storm');
  const nebula = changeShip(changeShip({ ...base, terrain: [{ id: 'nebula', type: 'nebula', x: 120, y: 120, radius: 30 }] }, base.playerShipId, { x: 80, y: 120 }), 'axis-flagship', { x: 120, y: 120 });
  rejected(nebula, { type: 'scan', targetId: 'axis-flagship' }, 'nebula-obscured');
});

test('own command readiness and global gates use execution reasons', () => {
  rejected(gameFor(), { type: 'shields' }, 'shields-full');
  rejected(gameFor(), { type: 'launch' }, 'mode-unavailable');
  rejected(gameFor({ reimagined: true }), { type: 'launch' }, 'hardware-unavailable');
  rejected({ ...gameFor(), phase: 'computer' }, { type: 'phasers', targetId: 'axis-flagship' }, 'not-player-turn');
  rejected({ ...gameFor(), phase: 'ended' }, { type: 'scan' }, 'battle-ended');
  const inactive = changeShip(gameFor(), 'fed-flagship', { status: 'destroyed' });
  rejected(inactive, { type: 'scan' }, 'actor-unavailable');
});
