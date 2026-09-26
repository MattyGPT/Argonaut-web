import test from 'node:test';
import assert from 'node:assert/strict';
import { REALTIME, REIMAGINED_GRID_SIZE } from '../game/constants.js';
import { createGame, engineCapacity, powerEffect } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { resolveAutopilotTurn, resolveComputerTurns, resolveRealtimeBoundary } from '../game/turns.js';
import { advanceSubtick, arrivalTick, integrateStardate, positionAt, positionsOf, simTimeOf, stepRealtime } from '../game/realtime.js';

const TICKS = REALTIME.ticksPerStardate;

/** One full stardate: the autopilot flies the conn, then the field resolves. */
const playTurn = (game) => resolveComputerTurns(resolveAutopilotTurn(game).game);

/** Drives a live real-time war sub-tick by sub-tick, resolving each boundary it crosses. */
const drive = (game, subticks) => {
  let current = game;
  for (let step = 0; step < subticks; step += 1) current = stepRealtime(current, resolveRealtimeBoundary);
  return current;
};

test('the realtime option implies Reimagined and widens the field', () => {
  const game = createGame({ seed: 'rt-flag', realtime: true });
  assert.equal(game.realtime, true);
  assert.equal(game.reimagined, true);
  assert.equal(game.extended, true);
  assert.equal(game.gridSize, REIMAGINED_GRID_SIZE);
  // The flag is the ONLY difference: same seed, same fleets, same streams.
  assert.deepEqual(game.ships, createGame({ seed: 'rt-flag', reimagined: true }).ships);
});

test('a war created without the realtime option is untouched by it', () => {
  // The standing parity scaffold pattern: an option defaulted off changes nothing.
  assert.deepEqual(createGame({ seed: 'rt-parity' }), createGame({ seed: 'rt-parity', realtime: false }));
  assert.equal(createGame({ seed: 'rt-parity' }).realtime, false);
  assert.equal(createGame({ seed: 'rt-parity', extended: true }).realtime, false);
  assert.equal(createGame({ seed: 'rt-parity', reimagined: true }).realtime, false);
});

test('boundary equivalence: a real-time war resolves identically to the turn-based Reimagined war', () => {
  let rt = createGame({ seed: 'rt-equiv', realtime: true });
  let tb = createGame({ seed: 'rt-equiv', reimagined: true });
  for (let stardate = 0; stardate < 12 && !rt.outcome; stardate += 1) {
    const before = positionsOf(rt);
    rt = playTurn(rt);
    tb = playTurn(tb);
    // The rules layer sees the same war: same hulls, same RNG consumption,
    // same log, same events, at every boundary.
    assert.deepEqual(rt.ships, tb.ships, `ships diverged on stardate ${stardate}`);
    assert.equal(rt.randomStep, tb.randomStep, `randomStep diverged on stardate ${stardate}`);
    assert.equal(rt.turn, tb.turn);
    assert.deepEqual(rt.log, tb.log, `log diverged on stardate ${stardate}`);
    assert.deepEqual(rt.events, tb.events, `events diverged on stardate ${stardate}`);
    // The trajectory starts where each hull stood at the previous boundary and
    // ends exactly where the rules put it.
    for (const ship of rt.ships) {
      const points = rt.trajectory[ship.id];
      assert.equal(points.length, TICKS + 1);
      assert.deepEqual(points[TICKS], { x: ship.x, y: ship.y }, `${ship.id} trajectory does not land on the boundary position`);
      if (before[ship.id]) assert.deepEqual(points[0], before[ship.id], `${ship.id} trajectory does not start at its previous position`);
      for (const point of points) {
        assert.ok(point.x >= 0 && point.x <= rt.gridSize && point.y >= 0 && point.y <= rt.gridSize,
          `${ship.id} flew off the field`);
      }
      // A burn never reverses or overshoots: the distance to the endpoint is monotonically falling.
      const end = points[TICKS];
      for (let i = 1; i <= TICKS; i += 1) {
        const prior = Math.hypot(points[i - 1].x - end.x, points[i - 1].y - end.y);
        const now = Math.hypot(points[i].x - end.x, points[i].y - end.y);
        assert.ok(now <= prior + 1e-9, `${ship.id} trajectory moves away from its endpoint`);
      }
    }
    assert.equal(rt.preTurn, null, 'the snapshot is consumed at the boundary');
  }
  assert.deepEqual(rt.outcome, tb.outcome);
});

test('the same seed + commands replay the same trajectories', () => {
  const run = () => {
    let game = createGame({ seed: 'rt-det', realtime: true });
    const trajectories = [];
    for (let stardate = 0; stardate < 6 && !game.outcome; stardate += 1) {
      game = playTurn(game);
      trajectories.push(game.trajectory);
    }
    return trajectories;
  };
  assert.deepEqual(run(), run());
});

test('integration is pure: it consumes no RNG and mutates nothing', () => {
  const game = createGame({ seed: 'rt-pure', realtime: true });
  const shipsBefore = structuredClone(game.ships);
  const stepBefore = game.randomStep;
  const trajectory = integrateStardate(game, positionsOf(game));
  assert.equal(game.randomStep, stepBefore);
  assert.deepEqual(game.ships, shipsBefore);
  // A snapshot equal to the current positions integrates to a hold for every hull.
  for (const ship of game.ships) {
    const points = trajectory[ship.id];
    assert.ok(points.every((point) => point.x === ship.x && point.y === ship.y));
  }
});

test('engine power buys an earlier arrival: a faster hull lands on an earlier sub-tick', () => {
  const base = createGame({ seed: 'rt-speed', realtime: true });
  const shipId = base.playerShipId;
  const ship = base.ships.find((entry) => entry.id === shipId);
  const span = 40;
  const start = { ...positionsOf(base), [shipId]: { x: Math.max(0, ship.x - span), y: ship.y } };
  const healthy = integrateStardate(base, start)[shipId];
  const gutted = integrateStardate(
    { ...base, ships: base.ships.map((entry) => (entry.id === shipId ? { ...entry, systems: { ...entry.systems, engines: 1 } } : entry)) },
    start,
  )[shipId];
  // Both land on the boundary the rules decided; the full drive gets there sooner.
  assert.deepEqual(healthy[TICKS], { x: ship.x, y: ship.y });
  assert.deepEqual(gutted[TICKS], { x: ship.x, y: ship.y });
  assert.ok(arrivalTick(healthy) < arrivalTick(gutted),
    `overcharged arrival ${arrivalTick(healthy)} should beat gutted arrival ${arrivalTick(gutted)}`);
  // The speed the core reads is exactly the reach the turn-based war reads —
  // engineCapacity with the reactor's engine effect multiplicative.
  const speed = engineCapacity(ship, base.gridSize, powerEffect(base, ship, 'engines'));
  assert.ok(speed > 0);
  const perTick = speed / TICKS;
  const expected = Math.min(TICKS, Math.max(1, Math.ceil(Math.min(span, ship.x) / perTick)));
  assert.equal(arrivalTick(healthy), expected);
});

test('a hull the snapshot does not know — spawned mid-stardate — holds at its final position', () => {
  const game = createGame({ seed: 'rt-spawn', realtime: true });
  const trajectory = integrateStardate(game, {});
  for (const ship of game.ships) {
    const points = trajectory[ship.id];
    assert.equal(points.length, TICKS + 1);
    assert.ok(points.every((point) => point.x === ship.x && point.y === ship.y));
  }
});

test('a stardate resolved with no snapshot holds every hull at its endpoint (old-save tolerance)', () => {
  let game = createGame({ seed: 'rt-nosnap', realtime: true });
  game = resolveComputerTurns({ ...game, phase: 'computer' });
  assert.ok(game.trajectory);
  for (const ship of game.ships) {
    const points = game.trajectory[ship.id];
    assert.ok(points.every((point) => point.x === ship.x && point.y === ship.y),
      `${ship.id} should hold at its endpoint without a snapshot`);
  }
});

test('positionAt interpolates the timeline: ends exact, middle between sub-ticks', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.deepEqual(positionAt(points, 0), { x: 0, y: 0 });
  assert.deepEqual(positionAt(points, 1), { x: 20, y: 0 });
  assert.deepEqual(positionAt(points, 0.5), { x: 10, y: 0 });
  assert.deepEqual(positionAt(points, 0.25), { x: 5, y: 0 });
  assert.deepEqual(positionAt(points, 2), { x: 20, y: 0 }, 'clamped past the boundary');
  assert.deepEqual(positionAt(points, -1), { x: 0, y: 0 }, 'clamped before the start');
  assert.equal(positionAt(null, 0.5), null);
  assert.equal(positionAt([], 0.5), null);
});

test('a turn-based war never grows the trajectory fields', () => {
  let game = createGame({ seed: 'rt-turnbased', reimagined: true });
  game = playTurn(game);
  assert.equal(game.trajectory, undefined);
  assert.equal(game.preTurn, undefined);
  assert.equal(game.realtime, false);
});

test('the sim clock crosses a stardate on schedule and the chain fires', () => {
  let game = createGame({ seed: 'rt-clock', realtime: true });
  assert.equal(simTimeOf(game), 0);
  assert.equal(game.turn, 1);
  game = drive(game, TICKS);
  assert.equal(game.turn, 2);
  assert.ok(Math.abs(simTimeOf(game) - 1) < 1e-9);
  // The shared boundary chain ran: the stalemate signature is stamped and the
  // captains plotted their next burns.
  assert.ok(game.warSignature);
  assert.ok(game.ships.some((ship) => ship.dest), 'captains plot destinations at the boundary');
  assert.ok(game.log.length > 0);
});

test('batching equals stepping: pause and speed are presentation only', () => {
  const straight = drive(createGame({ seed: 'rt-batch', realtime: true }), 40);
  let paused = createGame({ seed: 'rt-batch', realtime: true });
  // A pause is simply not stepping; a speed step is stepping in bigger real-time
  // chunks. The core only ever moves in whole sub-ticks, so both match exactly.
  paused = drive(paused, 10);
  paused = drive(paused, 7);
  paused = drive(paused, 23);
  assert.deepEqual(paused, straight);
});

test('a plotted burn arrives early and holds at its destination', () => {
  let game = createGame({ seed: 'rt-arrive', realtime: true });
  game = {
    ...game,
    ships: game.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10, dest: { x: 15, y: 10 } };
      if (ship.id === 'xanadu') return ship;
      return { ...ship, x: 300, y: 300, dest: null };
    }),
  };
  game = drive(game, TICKS);
  const arrived = game.ships.find((ship) => ship.id === 'fed-flagship');
  assert.equal(arrived.dest ?? null, null, 'the burn ends at the destination');
  assert.equal(arrived.x, 15);
  assert.equal(arrived.y, 10);
});

test('arrivals collide: two hulls plotted onto one point meet at the boundary', () => {
  let game = createGame({ seed: 'rt-collide', realtime: true });
  game = {
    ...game,
    ships: game.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 150, y: 150, dest: { x: 160, y: 160 } };
      if (ship.id === 'axis-flagship') return { ...ship, x: 170, y: 170, dest: { x: 160, y: 160 } };
      return { ...ship, x: 10, y: 10, dest: null };
    }),
  };
  game = drive(game, TICKS);
  assert.match((game.lastRound?.entries ?? []).join(' '), /Collision:/,
    'the boundary resolves what the arrivals flew into');
});

test('volleys cycle on the sim-time cooldown, one per stardate', () => {
  let game = createGame({ seed: 'rt-cooldown', realtime: true });
  game = {
    ...game,
    ships: game.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 70, y: 60 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 60, y: 60 };
      return ship;
    }),
  };
  const first = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.notEqual(first.game, game);
  assert.equal(first.game.readyAt?.['fed-flagship'], simTimeOf(game) + REALTIME.volleyInterval);
  const second = applyPlayerAction(first.game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(second.game, first.game, 'the guns are still cycling');
  assert.match(second.messages.join(' '), /still cycling/i);
  const cycled = drive(first.game, TICKS);
  const third = applyPlayerAction(cycled, { type: 'phasers', targetId: 'axis-flagship' });
  assert.notEqual(third.game, cycled, 'a stardate later the guns are ready');
});

test('re-destination is free and instant; pass holds position', () => {
  const game = createGame({ seed: 'rt-free', realtime: true });
  const start = game.ships.find((ship) => ship.id === game.playerShipId);
  const dx = start.x > 160 ? -20 : 20;
  const one = applyPlayerAction(game, { type: 'move', dx, dy: 0 });
  assert.notEqual(one.game, game);
  assert.deepEqual(one.game.ships.find((ship) => ship.id === game.playerShipId).dest, { x: start.x + dx, y: start.y });
  const two = applyPlayerAction(one.game, { type: 'move', dx: -dx / 2, dy: 5 });
  assert.notEqual(two.game, one.game, 'a second burn plots without waiting on any cooldown');
  const held = applyPlayerAction(two.game, { type: 'pass' });
  assert.equal(held.game.ships.find((ship) => ship.id === game.playerShipId).dest ?? null, null);
});

test('the autopilot conn flies the command ship until a manual command takes it back', () => {
  const game = createGame({ seed: 'rt-conn', realtime: true });
  const toggled = applyPlayerAction(game, { type: 'autopilot' });
  assert.equal(toggled.game.autoConn, true);
  const flown = drive(toggled.game, TICKS * 2);
  const before = game.ships.find((ship) => ship.id === game.playerShipId);
  const after = flown.ships.find((ship) => ship.id === flown.playerShipId);
  assert.ok(after.x !== before.x || after.y !== before.y || after.dest,
    'the autopilot flew or plotted the command ship across two boundaries');
  const dx = after.x > 160 ? -5 : 5;
  const manual = applyPlayerAction(flown, { type: 'move', dx, dy: 0 });
  assert.equal(manual.game.autoConn, false, 'a manual burn takes the conn back');
});

test('a mid-flight save resumes into exactly the same war', () => {
  const live = drive(createGame({ seed: 'rt-save', realtime: true }), 20);
  const resumed = drive(JSON.parse(JSON.stringify(live)), 20);
  const straight = drive(live, 20);
  assert.deepEqual(resumed, straight);
});

test('a round-30 real-time save without a sim clock resumes at the stardate start', () => {
  const legacy = { ...createGame({ seed: 'rt-legacy', realtime: true }), simTime: undefined, turn: 5 };
  assert.equal(simTimeOf(legacy), 4);
  const stepped = advanceSubtick(legacy);
  assert.ok(Math.abs(simTimeOf(stepped.game) - 4.125) < 1e-9);
});
