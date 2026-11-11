import test from 'node:test';
import assert from 'node:assert/strict';
import { avoidStackedArrival, chooseAiAction } from '../game/ai.js';
import { FORMATION } from '../game/constants.js';
import { createGame, getShip, spawnDrone } from '../game/state.js';

const park = (ship) => ({ ...ship, x: 300, y: 300 });
// The AI loadout draw varies per seed, so fixtures take their enemy ids from
// the roster actually fielded rather than naming hulls that may not exist.
const enemyIds = (game, count) => game.ships.filter((ship) => ship.faction === 'Axis').map((ship) => ship.id).slice(0, count);

test('autopilot arrivals keep formation spacing from allied line hulls', () => {
  const base = createGame({ seed: 'formation-spacing', reimagined: true });
  const stage = (ships) => ({ ...base, strategies: null, terrain: [], ships });
  const placed = base.ships.map((ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'fed-cruiser-2') return { ...ship, x: 100, y: 100 };
    return park(ship);
  });
  const actor = getShip(stage(placed), 'fed-cruiser-1');
  const adjusted = avoidStackedArrival(stage(placed), actor, 50, 50);
  const arrival = { x: actor.x + adjusted.dx, y: actor.y + adjusted.dy };
  assert.ok(Math.hypot(arrival.x - 100, arrival.y - 100) >= FORMATION.allySpacing, 'the arrival keeps formation spacing');
  assert.ok(Math.hypot(adjusted.dx, adjusted.dy) <= 128 + 1e-9, 'the nudge stays inside engine capacity');

  // A drone wing escorts inside spacing: drones keep the round-35 one-unit
  // floor rather than the formation floor, and keep arrival avoidance itself.
  const carrier = getShip(stage(placed), 'fed-carrier');
  const drone = spawnDrone(carrier, 1, 50, 50);
  const withDrone = stage([...placed, drone]);
  const droneAdj = avoidStackedArrival(withDrone, drone, 50, 50);
  assert.notDeepEqual(droneAdj, { dx: 50, dy: 50 }, 'a drone still deconflicts a stacked landing');
  const droneArrival = { x: drone.x + droneAdj.dx, y: drone.y + droneAdj.dy };
  const droneGap = Math.hypot(droneArrival.x - 100, droneArrival.y - 100);
  assert.ok(droneGap >= 1 && droneGap < FORMATION.allySpacing, 'at the one-unit floor, not the formation floor');

  // A tractor-held wingmate is a tow in progress, not a formation reference.
  const caster = enemyIds(base, 1)[0];
  const held = placed.map((ship) => (ship.id === 'fed-cruiser-2' ? { ...ship, tractorBy: caster } : ship));
  assert.deepEqual(avoidStackedArrival(stage(held), actor, 50, 50), { dx: 50, dy: 50 }, 'a towed hull holds no spacing floor');
});

test('concentration shares the doctrine front, and stationed hulls wait their turn', () => {
  const base = createGame({ seed: 'formation-pairs', reimagined: true });
  const [front, second, third] = enemyIds(base, 3);
  const at = {
    'fed-flagship': [60, 25], 'fed-cruiser-1': [60, 27], 'fed-cruiser-2': [60, 29],
    'fed-cruiser-3': [60, 31], 'fed-interceptor': [60, 33], 'fed-scout': [60, 35],
    'fed-artillery': [300, 300], 'fed-carrier': [300, 300],
    [front]: [85, 28], [second]: [87, 30], [third]: [89, 32],
  };
  const keep = new Set([...Object.keys(at), 'xanadu']);
  const game = {
    ...base,
    strategies: null,
    terrain: [],
    vendettaShipId: base.ships.find((ship) => ship.faction === 'Axis' && !keep.has(ship.id))?.id ?? front,
    ships: base.ships.filter((ship) => keep.has(ship.id))
      .map((ship) => (at[ship.id] ? { ...ship, x: at[ship.id][0], y: at[ship.id][1] } : ship)),
  };
  // Paired target assignment measured as a Bloc snowball and was rejected
  // (see the slice-2 review): the wing concentrates on the doctrine front —
  // the enemy nearest its flagship — and formation spacing, not target
  // spread, is what keeps the wing readable. Slice 3 wraps the shot in a
  // maneuver-and-volley composite, so read the volley's target.
  const targetOf = (id) => {
    const action = chooseAiAction(game, id);
    return (action.volley ?? action).targetId;
  };
  for (const id of ['fed-cruiser-1', 'fed-cruiser-2', 'fed-cruiser-3', 'fed-flagship', 'fed-interceptor', 'fed-scout']) {
    assert.equal(targetOf(id), front, `${id} concentrates on the doctrine front`);
  }
});

test('support hulls hold their class edge', () => {
  const base = createGame({ seed: 'formation-edge', reimagined: true });
  const enemy = enemyIds(base, 1)[0];
  const stage = (artilleryX, enemyX) => ({
    ...base,
    strategies: null,
    terrain: [],
    vendettaShipId: enemy,
    ships: base.ships.filter((ship) => ['fed-artillery', enemy, 'xanadu'].includes(ship.id))
      .map((ship) => {
        if (ship.id === 'fed-artillery') return { ...ship, x: artilleryX, y: 30 };
        if (ship.id === enemy) return { ...ship, x: enemyX, y: 30, shields: ship.shields };
        return { ...ship, x: 300, y: 300 };
      }),
  });
  const inside = chooseAiAction(stage(60, 70), 'fed-artillery');
  assert.ok(['phasers', 'photons'].includes(inside.type), 'inside its stop range the artillery stands and fights');
  const beyond = chooseAiAction(stage(60, 100), 'fed-artillery');
  assert.equal(beyond.type, 'move', 'out of phaser reach it closes');
  assert.equal(beyond.dx, 14, 'but only to its stop range, not into the swarm');
  const closing = chooseAiAction(stage(60, 88), 'fed-artillery');
  assert.ok(['phasers', 'photons'].includes(closing.type), 'inside phaser reach it fights, closing or not');
});
