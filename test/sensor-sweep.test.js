import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, applyPlayerAction, sensorContact, sensorSweep } from '../game/actions.js';
import { scenarioProgress } from '../game/scenarios.js';
import { createGame, getShip, powerAllocation, sensorRange } from '../game/state.js';

/** Parks two hulls at a known separation on an empty field, so reach never depends on the seed. */
const staged = (game, actorId, actor, targetId, target) => ({
  ...game,
  terrain: [],
  ships: game.ships.map((ship) => {
    if (ship.id === actorId) return { ...ship, ...actor };
    if (ship.id === targetId) return { ...ship, ...target };
    return { ...ship, x: 300, y: 300 };
  }),
});

const changeShip = (game, id, patch) => ({
  ...game,
  ships: game.ships.map((ship) => (ship.id === id ? { ...ship, ...patch } : ship)),
});

/** The classic pair: the command ship at 10,10 with a hostile five units off its bow. */
const classic = (seed, options = {}) => staged(createGame({ seed, ...options }),
  'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 15, y: 10 });

/**
 * A hostile 20 units off the bow inside a nebula: past the eight-unit sensor
 * reveal, well inside scanner reach, so static is the only thing hiding it.
 */
const cloaked = (seed, options = {}) => ({
  ...staged(createGame({ seed, ...options }), 'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 30, y: 10 }),
  terrain: [{ id: 'cover', type: 'nebula', x: 30, y: 10, radius: 8 }],
});

const withoutScanned = ({ scanned, ...rest }) => rest;

test('the resting sweep writes exactly what the free scan command writes, and nothing else', () => {
  for (const options of [{}, { reimagined: true }, { reimagined: true, realtime: true }]) {
    const game = classic(`sweep-parity-${options.reimagined ? 'reimagined' : 'classic'}-${options.realtime ? 'rt' : 'tb'}`, options);
    const swept = sensorSweep(game, 'axis-flagship');
    const commanded = applyPlayerAction(game, { type: 'scan', targetId: 'axis-flagship' }).game;
    assert.equal(swept.scanned['axis-flagship'], true, 'the sweep identifies the hull');
    assert.deepEqual(swept.scanned, commanded.scanned, 'and records exactly what the command records');
    assert.deepEqual(withoutScanned(swept), withoutScanned(game),
      'no log line, no stardate, no phase change, no RNG step, and no journal record rides along');
    assert.deepEqual(withoutScanned(commanded), withoutScanned(game), 'the command itself is equally quiet apart from its report');
  }
});

test('the sweep never lands where the scan command would have been refused', () => {
  const base = classic('sweep-refusals');
  const actor = getShip(base, 'fed-flagship');
  const reach = sensorRange(base, actor, 'scanner');
  const cases = {
    'a wreck is not a target': changeShip(base, 'axis-flagship', { status: 'destroyed' }),
    'your own hull': base,
    'beyond scanner reach': changeShip(base, 'axis-flagship', { x: actor.x + reach + 0.5, y: actor.y }),
    'behind nebula static': cloaked('sweep-refusals-nebula'),
    'a dead scanner': changeShip(base, 'fed-flagship', { systems: { ...actor.systems, scanner: 0 } }),
    'the computer phase': { ...base, phase: 'computer' },
    'a finished war': { ...base, outcome: { kind: 'won', message: 'The war is over.' } },
    'a hull that is not there': { ...base, ships: base.ships.filter((ship) => ship.id !== 'axis-flagship') },
  };
  for (const [label, game] of Object.entries(cases)) {
    const targetId = label === 'your own hull' ? 'fed-flagship' : 'axis-flagship';
    assert.equal(actionAvailability(game, { type: 'scan', targetId }).available, false, `${label}: the command refuses`);
    assert.equal(sensorSweep(game, targetId), game, `${label}: the sweep returns the identical game`);
    assert.equal(sensorSweep(game, targetId)?.scanned?.[targetId], undefined, `${label}: nothing is learned`);
  }
  assert.equal(sensorSweep(base, 'no-such-hull'), base, 'an unknown id is a no-op');
  assert.equal(sensorSweep(base, null), base, 'no id at all is a no-op');
  assert.equal(sensorSweep(null, 'axis-flagship'), null, 'no war is a no-op');
});

test('an already identified hull sweeps to the identical game, so a per-frame caller can compare by identity', () => {
  const once = sensorSweep(classic('sweep-once'), 'axis-flagship');
  assert.equal(sensorSweep(once, 'axis-flagship'), once);
  assert.equal(actionAvailability(once, { type: 'scan', targetId: 'axis-flagship' }).available, true,
    'the command stays repeatable; only the sweep has nothing left to learn');
});

test('the sweep and the reading leave the war they were handed untouched', () => {
  const game = classic('sweep-purity', { reimagined: true });
  const before = JSON.stringify(game);
  sensorSweep(game, 'axis-flagship');
  sensorContact(game, 'axis-flagship');
  assert.equal(JSON.stringify(game), before);
});

test('sensors read a wreck and the command ship that the sweep refuses, and stay quiet beyond their reach', () => {
  const base = classic('contact-reach', { reimagined: true });
  const actor = getShip(base, 'fed-flagship');
  const reach = sensorRange(base, actor, 'scanner');

  const contact = sensorContact(base, 'axis-flagship');
  assert.equal(Number(contact.distance.toFixed(1)), 5);
  assert.equal(contact.range, reach);

  const wreck = changeShip(base, 'axis-flagship', { status: 'destroyed' });
  assert.ok(sensorContact(wreck, 'axis-flagship'), 'a hulk still reads on the sensors');
  assert.equal(sensorSweep(wreck, 'axis-flagship'), wreck, 'but it can never be scanned');

  assert.ok(sensorContact(base, 'fed-flagship'), 'your own hull reads on your own instruments');
  assert.equal(sensorSweep(base, 'fed-flagship'), base, 'and is never a sweep target');

  // A mapper-only contact keeps the plain tooltip: the card is a scanner reading.
  const mapperReach = sensorRange(base, actor, 'mapper');
  const distant = changeShip(base, 'axis-flagship', { x: actor.x + Math.max(reach, mapperReach) + 1, y: actor.y });
  assert.equal(sensorContact(distant, 'axis-flagship'), null);
  assert.equal(sensorContact(changeShip(base, 'fed-flagship', { systems: { ...actor.systems, scanner: 0 } }), 'axis-flagship'), null,
    'a dead scanner resolves nothing');
  const hidden = cloaked('contact-nebula', { reimagined: true });
  assert.equal(sensorContact(hidden, 'axis-flagship'), null, 'nebula static blanks the reading');
  assert.equal(sensorSweep(hidden, 'axis-flagship'), hidden, 'and so does the sweep');
  assert.equal(sensorContact(base, 'no-such-hull'), null);
});

test('a starving sensors sink shortens the reading exactly as it shortens the scan', () => {
  const game = classic('contact-power', { reimagined: true });
  const actor = getShip(game, 'fed-flagship');
  const allocation = { ...powerAllocation(game, actor), sensors: 0 };
  const starved = { ...game, power: { ...(game.power ?? {}), [actor.id]: allocation } };
  const shortReach = sensorRange(starved, getShip(starved, 'fed-flagship'), 'scanner');
  assert.ok(shortReach < sensorRange(game, actor, 'scanner'), 'the sink buys the reach it is documented to buy');
  assert.ok(sensorContact(game, 'axis-flagship'), 'the staged pair is inside reach at full sensors');
  const beyond = changeShip(starved, 'axis-flagship', { x: actor.x + shortReach + 1, y: actor.y });
  assert.equal(sensorContact(beyond, 'axis-flagship'), null, 'the card disappears with the reach it is gated on');
  assert.equal(sensorSweep(beyond, 'axis-flagship'), beyond, 'and so does the sweep');
});

test('resting on the vendetta hunter identifies it, which is the whole point of the scenario', () => {
  const base = createGame({ seed: 'sweep-vendetta', reimagined: true, scenario: 'hunt-the-vendetta' });
  const hunter = getShip(base, base.objectiveShipId);
  assert.ok(hunter, 'the hunt stages a named objective hull');
  const game = staged(base, 'fed-flagship', { x: hunter.x - 5, y: hunter.y }, hunter.id, { x: hunter.x, y: hunter.y });
  assert.match(scenarioProgress(game).join(' '), /not yet identified/);
  const swept = sensorSweep(game, hunter.id);
  assert.equal(swept.scanned[hunter.id], true);
  assert.match(scenarioProgress(swept).join(' '), new RegExp(`Your hunter: Captain ${hunter.captain} of the ${hunter.name}`));
});
