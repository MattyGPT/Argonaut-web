import test from 'node:test';
import assert from 'node:assert/strict';
import { ACE_KILLS, CAPTAIN_NAMES, CRIPPLE, DOCKING, GRID_SIZE, LOG_LIMIT, MISS_CHANCE, POWER, POWER_SINKS, PRIZE, RANGES, REIMAGINED_GRID_SIZE, SCENARIOS, STALEMATE_ROUNDS, TERRAIN, VENDETTA } from '../game/constants.js';
import { createRng } from '../game/rng.js';
import { scenarioOutcome, scenarioProgress } from '../game/scenarios.js';
import { abbreviateNarrative, alertLevel, appendLog, clampPowerAllocation, createGame, crewCapacity, distance, engineCapacity, getShip, inRadioContact, insideFeature, ionStormZone, isAce, nebulaHides, nebulaRevealRange, powerAllocation, powerEffect, radioIntegrity, radioStormFactor, reactorOutput, segmentCrossesFeature, sensorRange, shieldCapacity, strongestFederation, templateSystems, terrainAt, vendettaGrudge, volleyMissChance } from '../game/state.js';
import { applyPlayerAction, captureHull, damageShip, defaultTargetFor, eligibleTargets, killLines, maneuverTo, orderTargets, resolveAsteroidStrike, resolveCollision, shipCommands, tractorLock, weaponDamage } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { applySurrender, evaluateOutcome, resolveAutopilotTurn, resolveComputerTurns, resolveDisabledSurrender, resolveDocking, resolveObjectives, resolvePowerRegen, transferCommandIfNeeded } from '../game/turns.js';
import { reportFor } from '../ui/render.js';

const withShips = (game, update) => ({ ...game, ships: game.ships.map(update) });

const placedGame = (seed = 'scenario') => withShips(createGame({ seed }), (ship) => {
  if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
  if (ship.id === 'axis-flagship') return { ...ship, x: 16, y: 10 };
  return { ...ship, x: 90, y: 90 };
});

test('a game starts with an active Federation flagship', () => {
  const game = createGame({ seed: 'xanadu' });
  assert.equal(game.playerShipId, 'fed-flagship');
  assert.equal(game.phase, 'player');
});

test('the same seed creates the same initial positions', () => {
  assert.deepEqual(
    createGame({ seed: 'argo-1' }).ships,
    createGame({ seed: 'argo-1' }).ships,
  );
});

test('a new game has 21 ships including Xanadu', () => {
  assert.equal(createGame({ seed: 'argo-1' }).ships.length, 21);
  assert.ok(createGame({ seed: 'argo-1' }).ships.some((ship) => ship.id === 'xanadu'));
});

test('phasers reject targets beyond 30 units', () => {
  const base = createGame({ seed: 'range' });
  const game = withShips(base, (ship) => ship.id === 'axis-flagship'
    ? { ...ship, x: 99, y: 99 }
    : ship);
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.match(result.messages.join(' '), /out of range/i);
  assert.deepEqual(result.game, game);
});

test('movement rejects a displacement exceeding engine capacity', () => {
  const result = applyPlayerAction(createGame({ seed: 'move' }), { type: 'move', dx: 99, dy: 0 });
  assert.match(result.messages.join(' '), /engine capacity/i);
});

test('moving onto an enemy ship resolves a collision', () => {
  const game = withShips(placedGame('ram'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, x: 12, y: 10 }
    : ship);
  const result = applyPlayerAction(game, { type: 'move', dx: 2, dy: 0 });
  assert.ok(result.messages.some((line) => /Collision/.test(line)));
  const fed = getShip(result.game, 'fed-flagship');
  const axis = getShip(result.game, 'axis-flagship');
  assert.ok(fed.status === 'destroyed' || axis.status === 'destroyed');
  const destruction = result.events?.find((entry) => entry.kind === 'destruction');
  assert.equal(destruction?.cause, 'collision');
  assert.equal(destruction?.attackerId, fed.status === 'destroyed' ? 'axis-flagship' : 'fed-flagship');
});

test('phasers damage a nearby enemy without mutating the input game', () => {
  const game = placedGame('phaser-hit-2');
  const before = getShip(game, 'axis-flagship');
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(result.game.phase, 'computer');
  assert.equal(getShip(game, 'axis-flagship').shields, before.shields);
  assert.ok(getShip(result.game, 'axis-flagship').shields < before.shields);
});

test('weapon fire emits a fire event for the FX layer', () => {
  const result = applyPlayerAction(placedGame('fx-events'), { type: 'phasers', targetId: 'axis-flagship' });
  assert.ok(result.events?.length >= 1);
  assert.equal(result.events[0].kind, 'phasers');
  assert.equal(result.events[0].fromId, 'fed-flagship');
  assert.equal(result.events[0].toId, 'axis-flagship');
});

test('a lethal weapon hit records the victim, faction, shooter, and weapon', () => {
  const game = withShips(placedGame('phaser-hit-2'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, shields: 0, crew: 0, systems: Object.fromEntries(Object.keys(ship.systems).map((name) => [name, 0])) }
    : ship);
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  const event = result.events.find((entry) => entry.kind === 'destruction');
  assert.deepEqual(event, {
    kind: 'destruction', shipId: 'axis-flagship', shipName: 'Firebreather', faction: 'Axis',
    x: 16, y: 10, cause: 'phasers',
    attackerId: 'fed-flagship', attackerName: 'Argo', attackerFaction: 'Federation',
  });
});

test('a seeded miss reports Missed! and deals no damage', () => {
  const game = placedGame('phaser-hit');
  const before = getShip(game, 'axis-flagship');
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.match(result.messages.join(' '), /Missed!/);
  assert.equal(getShip(result.game, 'axis-flagship').shields, before.shields);
  assert.equal(getShip(result.game, 'fed-flagship').shotsFired, 1);
});

test('weapon commands reject friendly targets and disabled phasers', () => {
  const game = placedGame('friendly');
  const friendly = applyPlayerAction(game, { type: 'phasers', targetId: 'fed-cruiser-1' });
  assert.match(friendly.messages.join(' '), /friendly/i);
  const disabled = withShips(game, (ship) => ship.id === 'fed-flagship'
    ? { ...ship, systems: { ...ship.systems, phasers: 0 } }
    : ship);
  const result = applyPlayerAction(disabled, { type: 'phasers', targetId: 'axis-flagship' });
  assert.match(result.messages.join(' '), /phasers.*disabled/i);
});

test('a tractor lock prevents the locked ship from moving', () => {
  const game = withShips(placedGame('tractor-lock'), (ship) => ship.id === 'fed-flagship'
    ? { ...ship, tractorBy: 'axis-flagship' }
    : ship);
  const result = applyPlayerAction(game, { type: 'move', dx: 1, dy: 0 });
  assert.match(result.messages.join(' '), /tractor lock/i);
});

test('self-destruct destroys the player ship and damages ships in its blast radius', () => {
  const game = placedGame('self-destruct');
  const result = applyPlayerAction(game, { type: 'self-destruct' });
  assert.equal(getShip(result.game, 'fed-flagship').status, 'destroyed');
  assert.ok(result.events.some((entry) => entry.kind === 'destruction' && entry.shipId === 'fed-flagship' && entry.cause === 'self-destruct'));
  assert.ok(getShip(result.game, 'axis-flagship').shields < getShip(game, 'axis-flagship').shields);
});

test('self-destruct credits the detonator with each enemy hull the blast destroys', () => {
  const game = withShips(createGame({ seed: 'self-destruct-kills' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 55, y: 50 };
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 55 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 45, y: 50 };
    return { ...ship, x: 0, y: 0 };
  });
  const result = applyPlayerAction(game, { type: 'self-destruct' });
  const detonator = getShip(result.game, 'fed-flagship');
  assert.equal(detonator.status, 'destroyed');
  assert.equal(getShip(result.game, 'axis-flagship').status, 'destroyed');
  assert.equal(getShip(result.game, 'axis-cruiser-1').status, 'destroyed');
  assert.equal(getShip(result.game, 'fed-cruiser-1').status, 'destroyed', 'the blast still destroys friendlies');
  // Two enemy hulls are credited; the friendly caught in the same blast is not.
  assert.equal(detonator.kills, 2);
});

test('hyperspace relocates the ship and damages its shields', () => {
  const game = placedGame('hyperspace');
  const result = applyPlayerAction(game, { type: 'hyperspace', x: 55, y: 55 });
  const argo = getShip(result.game, 'fed-flagship');
  assert.equal(argo.x, 55);
  assert.equal(argo.y, 55);
  assert.ok(argo.shields < getShip(game, 'fed-flagship').shields);
});

test('a seeded hyperspace misjump burns the ship up', () => {
  const game = placedGame('burn-up');
  const result = applyPlayerAction(game, { type: 'hyperspace', x: 55, y: 55 });
  assert.match(result.messages.join(' '), /burnt up/i);
  assert.equal(getShip(result.game, 'fed-flagship').status, 'destroyed');
  assert.deepEqual(result.events.find((entry) => entry.kind === 'destruction'), {
    kind: 'destruction', shipId: 'fed-flagship', shipName: 'Argo', faction: 'Federation',
    x: 10, y: 10, cause: 'hyperspace',
  });
});

test('a hyperspace that names no destination emerges somewhere inside the war zone', () => {
  const game = placedGame('hyperspace-random');
  const argo = getShip(applyPlayerAction(game, { type: 'hyperspace' }).game, 'fed-flagship');
  assert.equal(argo.status, 'active', 'this seed must survive the jump for the landing to be checked');
  assert.ok(Number.isInteger(argo.x) && Number.isInteger(argo.y), `landed on ${argo.x},${argo.y}, which is not a whole coordinate`);
  assert.ok(argo.x > 0 && argo.x < GRID_SIZE && argo.y > 0 && argo.y < GRID_SIZE, `landed at ${argo.x},${argo.y}, outside the war zone`);
  assert.ok(argo.x !== 10 || argo.y !== 10, 'and it is not still sitting where it jumped from');
  assert.ok(argo.shields < getShip(game, 'fed-flagship').shields, 'an unaimed jump still costs shields');
  const again = getShip(applyPlayerAction(game, { type: 'hyperspace' }).game, 'fed-flagship');
  assert.deepEqual([again.x, again.y], [argo.x, argo.y], 'the same seed lands in the same place, so a jump stays reproducible');
});

test('the unaimed destination follows the seed rather than one fixed point', () => {
  const landings = ['jump-a', 'jump-b', 'jump-c', 'jump-d', 'jump-e', 'jump-f']
    .map((seed) => getShip(applyPlayerAction(placedGame(seed), { type: 'hyperspace' }).game, 'fed-flagship'))
    .filter((ship) => ship.status === 'active')
    .map((ship) => `${ship.x},${ship.y}`);
  assert.ok(landings.length >= 2, 'at least two of the jumps must survive to be compared');
  assert.ok(new Set(landings).size > 1, `every surviving jump landed in the same place: ${landings.join(' ')}`);
});

test('a coordinate-free misjump still burns the ship up', () => {
  const result = applyPlayerAction(placedGame('burn-up'), { type: 'hyperspace' });
  assert.match(result.messages.join(' '), /burnt up/i);
  assert.equal(getShip(result.game, 'fed-flagship').status, 'destroyed');
});

test('scanner range scales with live scanner units', () => {
  const result = applyPlayerAction(createGame({ seed: 'scan' }), { type: 'scan', targetId: 'bloc-scout' });
  assert.ok(result.report || /out of scanner range/i.test(result.messages.join(' ')));
});

test('disabled scanner refuses a scan and map reveals only local ships', () => {
  const base = placedGame('map-local');
  const disabled = withShips(base, (ship) => ship.id === 'fed-flagship'
    ? { ...ship, systems: { ...ship.systems, scanner: 0 } }
    : ship);
  const scan = applyPlayerAction(disabled, { type: 'scan', targetId: 'axis-flagship' });
  assert.match(scan.messages.join(' '), /scanner.*disabled/i);
  const map = applyPlayerAction(base, { type: 'map' });
  assert.equal(map.report.title, 'Local tactical map');
  assert.ok(map.report.lines.some((line) => /Firebreather/.test(line)));
  assert.ok(!map.report.lines.some((line) => /Pequod/.test(line)));
});

test('radio produces a report for reachable allied ships', () => {
  const game = withShips(placedGame('radio'), (ship) => ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 15, y: 10 }
    : ship);
  const result = applyPlayerAction(game, { type: 'radio' });
  assert.equal(result.report.title, 'Radio traffic');
  assert.ok(result.report.lines.some((line) => /Bonhomme/.test(line)));
});

test('transport rejects active enemy ships but reinforces a friendly crew', () => {
  const game = withShips(placedGame('transport'), (ship) => ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 15, y: 10, crew: 20 }
    : ship);
  const enemy = applyPlayerAction(game, { type: 'transport', targetId: 'axis-flagship', amount: 5 });
  assert.match(enemy.messages.join(' '), /live enemy/i);
  const friendly = applyPlayerAction(game, { type: 'transport', targetId: 'fed-cruiser-1', amount: 5 });
  assert.equal(getShip(friendly.game, 'fed-cruiser-1').crew, 25);
  assert.equal(getShip(friendly.game, 'fed-flagship').crew, getShip(game, 'fed-flagship').crew - 5,
    'and exactly the transferred crew left the flagship');
});

test('transport captures a vacant ship and can transfer player command', () => {
  const game = withShips(placedGame('capture'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, status: 'vacant', crew: 0, x: 15, y: 10 }
    : ship);
  const result = applyPlayerAction(game, {
    type: 'transport', targetId: 'axis-flagship', amount: 8, transferCommand: true,
  });
  assert.equal(getShip(result.game, 'axis-flagship').faction, 'Federation');
  assert.equal(getShip(result.game, 'axis-flagship').status, 'active');
  assert.equal(result.game.playerShipId, 'axis-flagship');
});

test('computer report includes fleet counts, nearest contacts, and Xanadu distance', () => {
  const result = applyPlayerAction(placedGame('computer'), { type: 'computer' });
  assert.equal(result.report.title, 'Ship computer');
  assert.ok(result.report.lines.some((line) => /Xanadu/i.test(line)));
  assert.ok(result.report.lines.some((line) => /nearest enemy/i.test(line)));
});

test('eligible weapon targets exclude friendly ships', () => {
  const game = placedGame('eligible');
  const ids = eligibleTargets(game, 'phasers').map((ship) => ship.id);
  assert.ok(ids.includes('axis-flagship'));
  assert.ok(!ids.includes('fed-cruiser-1'));
});

test('the ship menu lists every command that can land on a close enemy', () => {
  const game = placedGame('menu-close');
  assert.deepEqual(
    shipCommands(game, 'axis-flagship').map((entry) => entry.type),
    ['phasers', 'photons', 'tractor', 'scan'],
  );
});

test('commands out of range are absent from the ship menu', () => {
  const game = withShips(placedGame('menu-mid'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, x: 25, y: 10 }
    : ship);
  assert.deepEqual(
    shipCommands(game, 'axis-flagship').map((entry) => entry.type),
    ['phasers', 'tractor', 'scan'],
    'photons reach 10 and the target sits 15 away',
  );
});

test('a hull beyond every reach offers nothing', () => {
  const game = withShips(placedGame('menu-far'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, x: 90, y: 90 }
    : ship);
  assert.deepEqual(shipCommands(game, 'axis-flagship'), [], 'the scanner reaches 40, not 113');
});

test('a friendly hull offers scan and crew transfer, not weapons', () => {
  const game = withShips(placedGame('menu-friendly'), (ship) => ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 12, y: 10 }
    : ship);
  assert.deepEqual(
    shipCommands(game, 'fed-cruiser-1').map((entry) => entry.type),
    ['scan', 'transport'],
  );
});

test('a vacant hull offers boarding and scan only', () => {
  const game = withShips(placedGame('menu-vacant'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, status: 'vacant' }
    : ship);
  assert.deepEqual(
    shipCommands(game, 'axis-flagship').map((entry) => entry.type),
    ['scan', 'transport'],
  );
});

test('your own hull, wrecks, and strangers offer nothing', () => {
  const game = withShips(placedGame('menu-wreck'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, status: 'destroyed' }
    : ship);
  assert.deepEqual(shipCommands(game, 'fed-flagship'), []);
  assert.deepEqual(shipCommands(game, 'axis-flagship'), []);
  assert.deepEqual(shipCommands(game, 'no-such-ship'), []);
});

test('an enemy in photon range chooses photons when they are available', () => {
  const base = createGame({ seed: 'ai-photon' });
  const game = withShips(base, (ship) => {
    if (ship.id === 'axis-flagship') return { ...ship, x: 11, y: 10 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    return { ...ship, x: 99, y: 99 };
  });
  assert.equal(chooseAiAction(game, 'axis-flagship').type, 'photons');
});

test('Federation wins when every enemy is destroyed or vacant', () => {
  const game = createGame({ seed: 'win' });
  const ended = withShips(game, (ship) => ship.faction === 'Federation'
    ? ship
    : { ...ship, status: 'destroyed' });
  assert.equal(evaluateOutcome(ended).kind, 'federation-win');
});

test('a collision destroys one ship and records the computer turn deterministically', () => {
  const game = withShips(placedGame('collision'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, x: 10, y: 10, systems: { ...ship.systems, photons: 0, phasers: 0, tractor: 0 } }
    : ship);
  const result = resolveComputerTurns({ ...game, phase: 'computer' });
  assert.ok(result.log.some((line) => /collision/i.test(line)));
  assert.ok(result.ships.some((ship) => ship.status === 'destroyed'));
});

test('a ship in photon range fires instead of moving, so static fire never collides', () => {
  const game = withShips(createGame({ seed: 'no-static-collision' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 10, y: 10 };
    return ship;
  });
  assert.equal(chooseAiAction(game, 'axis-flagship').type, 'photons');
});

test('losing the flagship shifts command; losing every Federation ship leaves the war to the alliances still afloat', () => {
  const game = createGame({ seed: 'loss' });
  const flagshipDown = withShips(game, (ship) => ship.id === 'fed-flagship' ? { ...ship, status: 'destroyed' } : ship);
  assert.equal(evaluateOutcome(flagshipDown).kind, 'active');
  const transfer = transferCommandIfNeeded(flagshipDown);
  assert.notEqual(transfer.game.playerShipId, 'fed-flagship');
  assert.match(transfer.message, /continue without you/i);
  // Three alliances are still fighting, so nobody has won yet: the war plays on.
  const fedGone = withShips(game, (ship) => ship.faction === 'Federation' ? { ...ship, status: 'destroyed' } : ship);
  assert.equal(evaluateOutcome(fedGone).kind, 'active');
  const lost = transferCommandIfNeeded(fedGone);
  assert.equal(lost.game.commandLost, true);
  assert.match(lost.message, /no hull left/i);
  assert.equal(transferCommandIfNeeded(lost.game).message, null, 'the loss is announced once');
  // Down to one alliance, that alliance has won.
  const blocOnly = withShips(game, (ship) => ship.faction === 'Bloc' ? ship : { ...ship, status: 'destroyed' });
  assert.equal(evaluateOutcome(blocOnly).kind, 'alliance-win');
  assert.match(evaluateOutcome(blocOnly).message, /Bloc forces have won/);
  const draw = withShips(game, (ship) => ({ ...ship, status: 'destroyed' }));
  assert.equal(evaluateOutcome(draw).kind, 'draw');
});

test('a war the Federation has lost plays itself out instead of ending early', () => {
  const game = withShips(createGame({ seed: 'spectate' }), (ship) => ship.faction === 'Federation'
    ? { ...ship, status: 'destroyed' }
    : ship);
  const round = resolveComputerTurns({ ...game, phase: 'computer' });
  assert.equal(round.outcome, null);
  assert.equal(round.phase, 'player');
  assert.equal(round.commandLost, true);
  assert.ok(round.log.some((line) => /no hull left/.test(line)));
});

test('resigning continues the war by shifting command to another Federation ship', () => {
  const game = createGame({ seed: 'resign' });
  const result = applyPlayerAction(game, { type: 'resign' });
  assert.notEqual(result.game.playerShipId, 'fed-flagship');
  assert.equal(result.game.resigned, true);
  assert.match(result.messages.join(' '), /has resigned/);
  assert.match(result.messages.join(' '), /command shifted to/);
});

test('autopilot runs the player ship for one turn', () => {
  const auto = resolveAutopilotTurn(placedGame('autopilot-run'));
  assert.equal(auto.game.phase, 'computer');
  assert.ok(auto.messages.length > 0);
});

test('the vendetta ship hunts the player even when a nearer enemy exists', () => {
  let game = { ...createGame({ seed: 'vendetta' }), vendettaShipId: 'axis-flagship' };
  game = withShips(game, (ship) => {
    if (ship.id === 'axis-flagship') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 75, y: 50 };
    if (ship.id === 'bloc-cruiser-1') return { ...ship, x: 52, y: 50 };
    return { ...ship, x: 5, y: 5 };
  });
  const action = chooseAiAction(game, 'axis-flagship');
  assert.equal(action.type, 'phasers');
  assert.equal(action.targetId, 'fed-flagship');
});

test('a collapsing enemy alliance stands down without ending the war', () => {
  const game = withShips(createGame({ seed: 'surrender' }), (ship) => {
    if (ship.id === 'bloc-cruiser-1') return { ...ship, status: 'active', shields: 5, crew: 5 };
    if (ship.faction === 'Bloc') return { ...ship, status: 'destroyed' };
    return ship;
  });
  const result = applySurrender(game);
  assert.equal(result.game.outcome, null);
  assert.deepEqual(result.events.map((event) => [event.kind, event.shipId, event.faction, event.surrenderedTo]), [
    ['surrender', 'bloc-cruiser-1', 'Bloc', 'Federation'],
  ]);
  assert.ok(result.game.ships.some((ship) => ship.id === 'bloc-cruiser-1' && ship.status === 'surrendered'));
});

test('computer turns keep surrender events for the replay', () => {
  const game = withShips(createGame({ seed: 'surrender' }), (ship) => {
    if (ship.id === 'bloc-cruiser-1') return { ...ship, status: 'active', shields: 5, crew: 5 };
    if (ship.faction === 'Bloc') return { ...ship, status: 'destroyed' };
    return ship;
  });
  const result = resolveComputerTurns({ ...game, phase: 'computer' });
  const surrendered = [['surrender', 'bloc-cruiser-1', 'Bloc', 'Federation']];
  assert.deepEqual(result.events.filter((event) => event.kind === 'surrender')
    .map((event) => [event.kind, event.shipId, event.faction, event.surrenderedTo]), surrendered);
  assert.deepEqual(result.lastRound.events.filter((event) => event.kind === 'surrender')
    .map((event) => [event.kind, event.shipId, event.faction, event.surrenderedTo]), surrendered);
});

test('a lethal computer weapon hit records truthful destruction attribution for the replay', () => {
  const disabled = { engines: 0, phasers: 0, photons: 0, tractor: 0, scanner: 0, mapper: 0, transporter: 0, radio: 0 };
  const game = withShips(createGame({ seed: 'phaser-hit-2' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10, shields: 0, crew: 0, systems: disabled };
    if (ship.id === 'axis-flagship') return { ...ship, x: 16, y: 10 };
    return { ...ship, status: 'destroyed' };
  });
  const result = resolveComputerTurns({ ...game, phase: 'computer' });
  const expected = {
    kind: 'destruction', shipId: 'fed-flagship', shipName: 'Argo', faction: 'Federation',
    x: 10, y: 10, cause: 'photons',
    attackerId: 'axis-flagship', attackerName: 'Firebreather', attackerFaction: 'Axis',
  };
  assert.deepEqual(result.events.find((event) => event.kind === 'destruction'), expected);
  assert.deepEqual(result.lastRound.events.find((event) => event.kind === 'destruction'), expected);
});

test('computer self-destruction keeps every destruction event', () => {
  const game = withShips(createGame({ seed: 'axis-suicide-events', extended: true }), (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 50, shields: 5 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 55, y: 50, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0, tractor: 0 } };
    if (ship.id === 'fed-cruiser-2') return { ...ship, x: 50, y: 55, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0, tractor: 0 } };
    if (ship.id === 'fed-cruiser-3') return { ...ship, x: 45, y: 50, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0, tractor: 0 } };
    if (ship.id === 'fed-scout') return { ...ship, x: 50, y: 45, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0, tractor: 0 } };
    if (ship.faction !== 'Federation') return { ...ship, status: 'destroyed' };
    return { ...ship, x: 95, y: 95 };
  });
  const result = resolveComputerTurns({ ...game, phase: 'computer' });
  const destructions = result.events.filter((event) => event.kind === 'destruction' && event.cause === 'self-destruct');
  assert.deepEqual(destructions, [
    {
      kind: 'destruction', shipId: 'fed-cruiser-1', shipName: 'Bonhomme', faction: 'Federation',
      x: 55, y: 50, cause: 'self-destruct',
      attackerId: 'axis-cruiser-1', attackerName: 'Grendel', attackerFaction: 'Axis',
    },
    {
      kind: 'destruction', shipId: 'fed-cruiser-2', shipName: 'Crusader', faction: 'Federation',
      x: 50, y: 55, cause: 'self-destruct',
      attackerId: 'axis-cruiser-1', attackerName: 'Grendel', attackerFaction: 'Axis',
    },
    {
      kind: 'destruction', shipId: 'fed-cruiser-3', shipName: 'Defender', faction: 'Federation',
      x: 45, y: 50, cause: 'self-destruct',
      attackerId: 'axis-cruiser-1', attackerName: 'Grendel', attackerFaction: 'Axis',
    },
    {
      kind: 'destruction', shipId: 'fed-scout', shipName: 'Empyreal', faction: 'Federation',
      x: 50, y: 45, cause: 'self-destruct',
      attackerId: 'axis-cruiser-1', attackerName: 'Grendel', attackerFaction: 'Axis',
    },
    {
      kind: 'destruction', shipId: 'axis-cruiser-1', shipName: 'Grendel', faction: 'Axis',
      x: 50, y: 50, cause: 'self-destruct',
    },
  ]);
  // Grendel took four Federation hulls with it; the autopilot detonator is credited
  // with each enemy kill exactly as the player's `=` would be.
  assert.equal(getShip(result, 'axis-cruiser-1').kills, 4);
});

test('the resigned Federation autopilot surrenders when collapsed', () => {
  const base = withShips(createGame({ seed: 'fed-surrender' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, status: 'active', shields: 5, crew: 5 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, status: 'active', shields: 5, crew: 5 };
    if (ship.faction === 'Federation') return { ...ship, status: 'destroyed' };
    return ship;
  });
  const result = applySurrender({ ...base, resigned: true });
  assert.ok(result.game.outcome);
  assert.match(result.game.outcome.message, /Federation has surrendered/);
  assert.deepEqual(result.events.map((event) => event.shipId), ['fed-flagship', 'fed-cruiser-1']);
  assert.deepEqual(result.game.ships.filter((ship) => ship.faction === 'Federation').map((ship) => ship.status), [
    'surrendered', 'surrendered', 'destroyed', 'destroyed', 'destroyed', 'destroyed',
  ]);
  assert.equal(applySurrender(base).game.outcome, null, 'an active player never auto-surrenders');
});

test('a fresh war does not surrender', () => {
  assert.ok(!applySurrender(createGame({ seed: 'no-surrender' })).game.outcome);
});

test('computer actions are deterministic and a full seeded pass remains reproducible', () => {
  const game = placedGame('ai-repeat');
  assert.deepEqual(chooseAiAction(game, 'axis-flagship'), chooseAiAction(game, 'axis-flagship'));
  const one = resolveComputerTurns(applyPlayerAction(createGame({ seed: 'replay-42' }), { type: 'pass' }).game);
  const two = resolveComputerTurns(applyPlayerAction(createGame({ seed: 'replay-42' }), { type: 'pass' }).game);
  assert.deepEqual(one, two);
});

test('fleets carry their canonical ship names', () => {
  const game = createGame({ seed: 'names' });
  const names = game.ships.map((ship) => ship.name);
  for (const expected of ['Xanadu', 'Argo', 'Bonhomme', 'Firebreather', 'Killjoy', 'Pequod', 'Queen Mab', 'Ragnarok', 'Terrorist']) {
    assert.ok(names.includes(expected), `expected ${expected} in roster`);
  }
  assert.equal(getShip(game, 'fed-flagship').name, 'Argo');
  assert.equal(getShip(game, 'xanadu').className, 'Starbase');
});

test('a phaser volley records shots for and against', () => {
  const game = placedGame('shots');
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(getShip(result.game, 'fed-flagship').shotsFired, 1);
  assert.equal(getShip(result.game, 'axis-flagship').shotsTaken, 1);
});

test('destroying an enemy credits a kill to the attacker', () => {
  const stripped = { engines: 0, phasers: 0, photons: 0, tractor: 0, scanner: 0, mapper: 0, transporter: 0, radio: 0 };
  const game = withShips(placedGame('kill-credit'), (ship) => ship.id === 'axis-flagship'
    ? { ...ship, shields: 0, crew: 1, systems: { ...stripped } }
    : ship);
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.equal(getShip(result.game, 'axis-flagship').status, 'destroyed');
  assert.equal(getShip(result.game, 'fed-flagship').kills, 1);
});

test('the war zone map lists every surviving ship with coordinates', () => {
  const game = createGame({ seed: 'fullmap' });
  const report = reportFor(game, 'fullmap');
  assert.equal(report.title, 'War zone map');
  assert.equal(report.lines.length, game.ships.filter((ship) => ship.status !== 'destroyed').length);
  assert.ok(report.lines.some((line) => /Xanadu/.test(line)));
});

test('alliance statistics aggregate shots and chances of victory', () => {
  const fired = applyPlayerAction(placedGame('stats'), { type: 'phasers', targetId: 'axis-flagship' }).game;
  const report = reportFor(fired, 'statistics');
  assert.ok(report.lines.some((line) => /Shots for\/against: 1 \/ 0/.test(line)));
  assert.ok(report.lines.some((line) => /Chances of victory/.test(line)));
});

test('shot distribution lists firing ships with a ratio', () => {
  const fired = applyPlayerAction(placedGame('shots-report'), { type: 'phasers', targetId: 'axis-flagship' }).game;
  const report = reportFor(fired, 'shots');
  assert.equal(report.title, 'Shot distribution');
  assert.ok(report.lines.some((line) => /Argo: fired 1/.test(line)));
});

test('default target is the nearest hostile inside weapon range', () => {
  const game = withShips(placedGame('default-target'), (ship) => {
    if (ship.id === 'axis-flagship') return { ...ship, x: 20, y: 10 };
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 35, y: 10 };
    return ship;
  });
  assert.equal(defaultTargetFor(game, 'phasers'), 'axis-flagship');
  assert.equal(defaultTargetFor(game, 'photons'), 'axis-flagship');
});

test('alliance statistics include a dispersion factor', () => {
  const report = reportFor(createGame({ seed: 'dispersion' }), 'statistics');
  assert.ok(report.lines.some((line) => /Dispersion factor/.test(line)));
});

test('victory outcomes carry the canonical proclamations', () => {
  const game = createGame({ seed: 'proclaim' });
  const fedWin = withShips(game, (ship) => ship.faction === 'Federation' ? ship : { ...ship, status: 'destroyed' });
  assert.match(evaluateOutcome(fedWin).message, /Federation has triumphed/);
  const draw = withShips(game, (ship) => ({ ...ship, status: 'destroyed' }));
  assert.match(evaluateOutcome(draw).message, /No one wins/);
});

// One corner per alliance, 90 units apart: further than any stranded hull can
// reach, and far enough that the four-way war has no adjacent enemies left.
const CORNERS = {
  Federation: { x: 5, y: 5 },
  Axis: { x: 95, y: 5 },
  Bloc: { x: 5, y: 95 },
  Cabal: { x: 95, y: 95 },
};

const cornered = (seed, update) => withShips(createGame({ seed }), (ship) => ({
  ...ship,
  ...CORNERS[ship.faction],
  ...(update ? update(ship) : {}),
}));

test('a frozen war ends in the hopeless draw the binary proclaims', () => {
  const game = cornered('stranded', (ship) => ({ systems: { ...ship.systems, engines: 0 } }));
  const outcome = evaluateOutcome(game);
  assert.equal(outcome.kind, 'hopeless-draw');
  assert.equal(outcome.message, 'The war has ended in a hopeless draw.  All survivors are stranded.');
});

test('a stranded hull that can still fire keeps the war going', () => {
  const game = cornered('stranded-armed', (ship) => ({
    systems: { ...ship.systems, engines: 0 },
    ...(ship.id === 'axis-flagship' ? { x: 20, y: 5 } : {}),
  }));
  assert.equal(evaluateOutcome(game).kind, 'active', 'an enemy inside phaser reach can still end the war');
});

test('working engines mean the war is never hopeless', () => {
  assert.equal(evaluateOutcome(createGame({ seed: 'fresh-war' })).kind, 'active');
  assert.equal(evaluateOutcome(cornered('spread')).kind, 'active', 'mobile fleets in opposite corners can still close');
});

test('a fleet holding station that nothing can reach is a hopeless draw', () => {
  const cornerGame = cornered('hold-stalemate', (ship) => ({
    systems: { ...ship.systems, engines: ship.faction === 'Federation' ? 5 : 0 },
  }));
  const game = {
    ...cornerGame,
    extended: true,
    orders: Object.fromEntries(cornerGame.ships
      .filter((ship) => ship.faction === 'Federation')
      .map((ship) => [ship.id, { type: 'hold', targetId: null }])),
  };
  // Without this the war runs forever: the holding ships have engines but will
  // never use them, and the stranded enemy can never reach them.
  assert.equal(evaluateOutcome(game).kind, 'hopeless-draw');
  assert.equal(evaluateOutcome({ ...game, orders: {} }).kind, 'active', 'released from hold, the Federation can still close');
});

test('a war that stops changing is called a hopeless draw', () => {
  const game = { ...cornered('stalemate-draw'), stalemateRounds: STALEMATE_ROUNDS };
  assert.equal(evaluateOutcome(game).kind, 'hopeless-draw');
  assert.equal(evaluateOutcome({ ...game, stalemateRounds: STALEMATE_ROUNDS - 1 }).kind, 'active');
});

test('a quiet round counts toward a stalemate', () => {
  const frozen = cornered('stalemate-count', (ship) => ({
    systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0, tractor: 0 },
  }));
  const first = resolveComputerTurns(frozen);
  assert.equal(first.stalemateRounds, 0, 'the first round has nothing to compare against');
  assert.equal(resolveComputerTurns(first).stalemateRounds, 1);
});

test('a round in which the fleets move resets the stalemate count', () => {
  const first = resolveComputerTurns(createGame({ seed: 'stalemate-reset' }));
  const second = resolveComputerTurns({ ...first, stalemateRounds: 7 });
  assert.equal(second.stalemateRounds, 0, 'the fleets are still closing, so the war is not stale');
});

test("roll call gives each ship's location and its distance from command", () => {
  const game = createGame({ seed: 'rollcall-columns' });
  const argo = getShip(game, 'fed-flagship');
  const line = reportFor(game, 'rollcall').lines.find((entry) => entry.startsWith('Argo'));
  assert.match(line, new RegExp(`at ${argo.x},${argo.y}, 0\\.0 away`));
  assert.match(line, /Active/);
  const enemy = getShip(game, 'axis-flagship');
  const enemyLine = reportFor(game, 'rollcall').lines.find((entry) => entry.startsWith('Firebreather'));
  assert.match(enemyLine, new RegExp(`at ${enemy.x},${enemy.y}, ${Math.hypot(enemy.x - argo.x, enemy.y - argo.y).toFixed(1)} away`));
});

test('weapon damage varies from shot to shot inside the manual band', () => {
  const argo = getShip(createGame({ seed: 'variance' }), 'fed-flagship');
  const roll = (type, step) => weaponDamage(type, argo, createRng(`variance:${type}:${step}`));
  const phasers = Array.from({ length: 60 }, (_, step) => roll('phasers', step));
  const photons = Array.from({ length: 60 }, (_, step) => roll('photons', step));
  assert.ok(new Set(phasers).size > 1, 'phasers must not always hit for the same number');
  assert.ok(new Set(photons).size > 1, 'photons must not always hit for the same number');
  // Argo: 12 + 5 phaser units x 4 = 32 nominal, rolled +/-25%.
  for (const amount of phasers) assert.ok(amount >= 24 && amount <= 40, `phaser damage ${amount} left the band`);
  // Argo: 24 + 3 photon tubes x 9 = 51 nominal, rolled +/-26.7%.
  for (const amount of photons) assert.ok(amount >= 37 && amount <= 65, `photon damage ${amount} left the band`);
});

test('the damage band keeps the tuned mean, so wars last as long as before', () => {
  const argo = getShip(createGame({ seed: 'mean' }), 'fed-flagship');
  const meanOf = (type, nominal) => {
    const rolls = Array.from({ length: 400 }, (_, step) => weaponDamage(type, argo, createRng(`mean:${type}:${step}`)));
    const mean = rolls.reduce((total, amount) => total + amount, 0) / rolls.length;
    assert.ok(Math.abs(mean - nominal) < 1, `${type} mean ${mean.toFixed(2)} drifted from ${nominal}`);
  };
  meanOf('phasers', 32);
  meanOf('photons', 51);
});

test('a hull outlasts a sustained peer bombardment, so battles are attritional', () => {
  const argo = getShip(createGame({ seed: 'attrition' }), 'fed-flagship');
  const meanVolley = (type) => {
    const rolls = Array.from({ length: 200 }, (_, step) => weaponDamage(type, argo, createRng(`attrition:${type}:${step}`)));
    return rolls.reduce((total, amount) => total + amount, 0) / rolls.length;
  };
  // Total damage a battle cruiser must absorb before it is gone: its shields, and
  // then the crew and hardware behind them. Expressed as a ratio rather than a
  // shield count, so retuning the hulls again cannot make the test pass by accident.
  const hull = shieldCapacity(argo) + crewCapacity(argo);
  const photonVolleys = hull / meanVolley('photons');
  assert.ok(photonVolleys >= 6,
    `a battle cruiser now falls to ${photonVolleys.toFixed(1)} photon volleys; it was meant to take at least six`);
});

const systemUnitsLeft = (ship) => Object.values(ship.systems).reduce((total, units) => total + units, 0);

test('a measured finish kills the crew and leaves a boardable prize, weapons intact', () => {
  const argo = getShip(createGame({ seed: 'capture-model' }), 'fed-flagship');
  // Shields down and the crew worn thin, then one measured volley: the weighted crew
  // absorbs it and dies while the overkill falls far short of tearing the frame apart,
  // so the hull survives to be boarded. This was impossible before the re-weight, when
  // the subsystems were always stripped first and a knockout was never capturable.
  const hull = { ...argo, shields: 0, crew: 30 };
  let vacant = 0;
  for (let seed = 0; seed < 400; seed++) {
    const out = damageShip(hull, 50, createRng(`capture:${seed}`));
    if (out.status === 'vacant') {
      vacant++;
      assert.equal(out.crew, 0, 'a vacant hull has no crew');
      assert.ok(systemUnitsLeft(out) > 0, 'a captured hull keeps working subsystems');
    }
  }
  assert.ok(vacant > 280, `a measured finish should usually leave a prize; got ${vacant}/400 vacant`);
});

test('a volley that overshoots the crew tears the hull apart instead of leaving a prize', () => {
  const argo = getShip(createGame({ seed: 'overkill' }), 'fed-flagship');
  // The same worn hull, but the killing blow carries far more than the frame can soak,
  // so it is destroyed rather than left vacant.
  const out = damageShip({ ...argo, shields: 0, crew: 30 }, 500, createRng('overkill'));
  assert.equal(out.status, 'destroyed');
});

test('phasers capture where photons destroy, so taking a prize is a choice of fire', () => {
  const argo = getShip(createGame({ seed: 'agency' }), 'fed-flagship');
  const captureRate = (weapon) => {
    let vacant = 0;
    const trials = 250;
    for (let seed = 0; seed < trials; seed++) {
      const rng = createRng(`agency:${weapon}:${seed}`);
      let ship = { ...argo, systems: { ...argo.systems }, status: 'active' };
      let guard = 0;
      while (ship.status === 'active' && guard++ < 1000) {
        ship = damageShip(ship, weaponDamage(weapon, argo, rng), rng);
      }
      if (ship.status === 'vacant') vacant++;
    }
    return vacant / trials;
  };
  const phasers = captureRate('phasers');
  const photons = captureRate('photons');
  assert.ok(phasers > photons,
    `precise fire should capture more often than heavy fire (phasers ${phasers.toFixed(2)}, photons ${photons.toFixed(2)})`);
  assert.ok(phasers > 0.2, `phasers should capture a meaningful share of hulls (got ${phasers.toFixed(2)})`);
});

test('the radio report gives allied condition as well as location', () => {
  const game = withShips(placedGame('radio-condition'), (ship) => ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 15, y: 10, shields: 10 }
    : ship);
  const bonhomme = applyPlayerAction(game, { type: 'radio' }).report.lines.find((line) => /Bonhomme/.test(line));
  assert.match(bonhomme, /at 5\.0/);
  assert.match(bonhomme, /condition RED/);
  assert.match(bonhomme, /shields 10/);
});

test('radio integrity tracks the surviving radio units', () => {
  const argo = getShip(createGame({ seed: 'integrity' }), 'fed-flagship');
  assert.equal(radioIntegrity(argo), 1);
  assert.equal(radioIntegrity({ ...argo, systems: { ...argo.systems, radio: 1 } }), 0.5);
  assert.equal(radioIntegrity({ ...argo, systems: { ...argo.systems, radio: 0 } }), 0);
});

test('a damaged radio abbreviates the narrative but spares your own ship', () => {
  const traffic = ['Firebreather fires phasers at Bonhomme for 32 damage.'];
  assert.deepEqual(abbreviateNarrative(traffic, 1, 'Argo'), traffic);
  assert.deepEqual(abbreviateNarrative(traffic, 0.5, 'Argo'), ['Firebreather fires phasers at …']);
  assert.deepEqual(abbreviateNarrative(traffic, 0, 'Argo'), ['Firebreather …']);
  const own = ['Argo moves to 12,14.'];
  assert.deepEqual(abbreviateNarrative(own, 0, 'Argo'), own);
});

test('alert level is proportional to shield capacity and named as the manual names it', () => {
  const game = createGame({ seed: 'alert' });
  const argo = getShip(game, 'fed-flagship');
  const xanadu = getShip(game, 'xanadu');
  assert.equal(alertLevel(argo), 'GREEN');
  assert.equal(alertLevel({ ...argo, shields: 80 }), 'YELLOW');
  assert.equal(alertLevel({ ...argo, shields: 20 }), 'RED');
  // The same 160 shields are comfortable in a battle cruiser, worrying in a starbase.
  assert.equal(alertLevel({ ...argo, shields: 160 }), 'GREEN');
  assert.equal(alertLevel({ ...xanadu, shields: 160 }), 'YELLOW');
});

test('an autopilot tractor beam drags its target toward the shooter', () => {
  const game = withShips(createGame({ seed: 'ai-tractor' }), (ship, index) => {
    if (ship.id === 'axis-flagship') return { ...ship, x: 20, y: 10, systems: { ...ship.systems, phasers: 0, photons: 0 } };
    if (ship.id === 'fed-flagship') return { ...ship, x: 40, y: 10 };
    return { ...ship, x: 90 + (index % 5), y: 90 + Math.floor(index / 5) };
  });
  const result = resolveComputerTurns({ ...game, phase: 'computer' });
  const argo = getShip(result, 'fed-flagship');
  // Firebreather has 3 tractor units, so the beam pulls 15 of the 20 units between them.
  assert.equal(argo.x, 25);
  assert.equal(argo.y, 10);
  assert.equal(argo.tractorBy, 'axis-flagship');
  assert.ok(result.log.some((line) => /Tractor beam good for 15 units pull/.test(line)));
});

test('an autopilot will not reach for a tractor lock beyond 35 units', () => {
  const game = withShips(createGame({ seed: 'tractor-reach' }), (ship, index) => {
    if (ship.id === 'axis-flagship') return { ...ship, x: 10, y: 10, systems: { ...ship.systems, phasers: 0, photons: 0 } };
    if (ship.id === 'fed-flagship') return { ...ship, x: 60, y: 10 };
    return { ...ship, x: 90 + (index % 5), y: 90 + Math.floor(index / 5) };
  });
  assert.equal(RANGES.tractor, 35);
  assert.equal(chooseAiAction(game, 'axis-flagship').type, 'move');
});

test('the player tractor beam pulls by the same amount as the autopilot beam', () => {
  const game = withShips(createGame({ seed: 'player-tractor' }), (ship, index) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 20, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 40, y: 10 };
    return { ...ship, x: 90 + (index % 5), y: 90 + Math.floor(index / 5) };
  });
  const firebreather = getShip(
    applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship' }).game,
    'axis-flagship',
  );
  assert.equal(firebreather.x, 25);
  assert.equal(firebreather.tractorBy, 'fed-flagship');
});

test('a tractor beam cannot budge the Xanadu starbase', () => {
  const game = withShips(createGame({ seed: 'tow-xanadu' }), (ship, index) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 40, y: 50 };
    // Make the base a legal hostile target so the immovable guard is what refuses it.
    if (ship.id === 'xanadu') return { ...ship, faction: 'Axis' };
    return { ...ship, x: 90 + (index % 5), y: 90 + Math.floor(index / 5) };
  });
  const result = applyPlayerAction(game, { type: 'tractor', targetId: 'xanadu' });
  assert.match(result.messages.join(' '), /too massive/i);
  const xanadu = getShip(result.game, 'xanadu');
  assert.equal(xanadu.x, 50, 'the base never moves');
  assert.equal(xanadu.y, 50);
  assert.equal(xanadu.tractorBy, null, 'a starbase is never held by a tractor lock');
});

test('an autopilot will not tractor the immovable Xanadu starbase', () => {
  const game = withShips(createGame({ seed: 'ai-no-tow-base' }), (ship, index) => {
    // Park an Axis hull 33 units off Xanadu: past phaser reach (30) but inside tractor reach (35).
    if (ship.id === 'axis-flagship') return { ...ship, x: 50, y: 83 };
    if (ship.id === 'xanadu') return ship;
    return { ...ship, x: 5 + (index % 5), y: 5 + Math.floor(index / 5) };
  });
  assert.notEqual(chooseAiAction(game, 'axis-flagship').type, 'tractor');
});

test('a tractor lock dies with the ship that cast it', () => {
  const game = withShips(placedGame('stale-lock'), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, tractorBy: 'axis-flagship' };
    if (ship.id === 'axis-flagship') return { ...ship, status: 'destroyed' };
    return ship;
  });
  const result = applyPlayerAction(game, { type: 'move', dx: 1, dy: 0 });
  assert.ok(!/tractor lock/i.test(result.messages.join(' ')), 'a wreck cannot keep holding you');
  assert.equal(getShip(result.game, 'fed-flagship').x, 11);
});

test('an autopilot held by a destroyed locker starts moving again', () => {
  const game = withShips(createGame({ seed: 'stale-ai-lock' }), (ship, index) => {
    if (ship.id === 'bloc-flagship') return { ...ship, x: 20, y: 20, tractorBy: 'axis-flagship' };
    if (ship.id === 'axis-flagship') return { ...ship, status: 'destroyed' };
    if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 50 };
    return { ...ship, x: 90 + (index % 5), y: 90 + Math.floor(index / 5) };
  });
  assert.equal(chooseAiAction(game, 'bloc-flagship').type, 'move');
});

test('autopilot volleys can miss, exactly as the player\'s can', () => {
  const outcomes = new Set();
  for (let index = 0; index < 24; index += 1) {
    const game = withShips(
      { ...createGame({ seed: `ai-miss-${index}` }), randomStep: index },
      (ship, i) => {
        if (ship.id === 'axis-flagship') return { ...ship, x: 20, y: 10, systems: { ...ship.systems, photons: 0 } };
        if (ship.id === 'fed-flagship') return { ...ship, x: 30, y: 10 };
        return { ...ship, x: 90 + (i % 5), y: 90 + Math.floor(i / 5) };
      },
    );
    const log = resolveComputerTurns({ ...game, phase: 'computer' }).log.join(' ');
    if (/Missed!/.test(log)) outcomes.add('miss');
    else if (/fires phasers/.test(log)) outcomes.add('hit');
  }
  assert.ok(outcomes.has('hit'), 'autopilots must still land shots');
  assert.ok(outcomes.has('miss'), 'autopilots must be able to miss too');
});

test('boarding the vendetta ship ends the vendetta rather than arming a self-hunt', () => {
  const game = {
    ...withShips(placedGame('vendetta-capture'), (ship) => ship.id === 'axis-flagship'
      ? { ...ship, status: 'vacant', crew: 0 }
      : ship),
    vendettaShipId: 'axis-flagship',
  };
  const result = applyPlayerAction(game, {
    type: 'transport', targetId: 'axis-flagship', amount: 8, transferCommand: true,
  });
  assert.equal(result.game.vendettaShipId, null);
  assert.equal(result.game.playerShipId, 'axis-flagship');
  assert.notEqual(chooseAiAction(result.game, 'axis-flagship').targetId, 'axis-flagship');
});

test('a vendetta marker on a friendly hull cannot make it hunt its own side', () => {
  const game = withShips(
    { ...createGame({ seed: 'vendetta-friendly' }), vendettaShipId: 'fed-cruiser-1' },
    (ship) => {
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 10 };
      if (ship.id === 'fed-flagship') return { ...ship, x: 15, y: 10 };
      return ship;
    },
  );
  // Without the faction guard this returns photons aimed at the player's own flagship.
  assert.notEqual(chooseAiAction(game, 'fed-cruiser-1').targetId, 'fed-flagship');
});

test('resigning twice does not hand the successor over as well', () => {
  const once = applyPlayerAction(createGame({ seed: 'resign-twice' }), { type: 'resign' });
  assert.equal(once.game.resigned, true);
  const twice = applyPlayerAction(once.game, { type: 'resign' });
  assert.match(twice.messages.join(' '), /already resigned/i);
  assert.equal(twice.game.playerShipId, once.game.playerShipId);
});

// --- Extended war: fleet orders -------------------------------------------------

const extended = (seed, update) => withShips(createGame({ seed, extended: true }), update);

test('an extended war starts with the flag set and no orders issued', () => {
  const game = createGame({ seed: 'extended-fresh', extended: true });
  assert.equal(game.extended, true);
  assert.deepEqual(game.orders, {});
  assert.deepEqual(game.pendingOrders, {});
  assert.equal(createGame({ seed: 'extended-fresh' }).extended, false);
});

test('an extended war gives captains a survival instinct a classic war lacks', () => {
  const setup = (extended) => withShips(createGame({ seed: 'doctrine-flush', extended }), (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 10, y: 10, shields: 5 };
    if (ship.faction === 'Federation') return { ...ship, x: 90, y: 90 };
    return { ...ship, x: 95, y: 5 };
  });
  assert.equal(chooseAiAction(setup(true), 'axis-cruiser-1').type, 'shields', 'a hurt Axis captain flushes engines');
  assert.equal(chooseAiAction(setup(false), 'axis-cruiser-1').type, 'move', 'a classic autopilot only ever pursues');
});

test('a classic war takes no fleet orders', () => {
  const result = applyPlayerAction(createGame({ seed: 'classic-orders' }), {
    type: 'orders', shipId: 'fed-scout', order: { type: 'hold' },
  });
  assert.match(result.messages.join(' '), /extended war/);
  assert.deepEqual(result.game, createGame({ seed: 'classic-orders' }));
});

test('issuing an order costs no turn', () => {
  const game = createGame({ seed: 'free-order', extended: true });
  const result = applyPlayerAction(game, { type: 'orders', shipId: 'fed-scout', order: { type: 'hold' } });
  assert.equal(result.game.phase, 'player', 'the captain still has an action this stardate');
  assert.deepEqual(result.game.orders['fed-scout'], { type: 'hold', targetId: null });
});

test('orders validate the ship they name', () => {
  const game = createGame({ seed: 'order-validation', extended: true });
  const interceptFriendly = applyPlayerAction(game, {
    type: 'orders', shipId: 'fed-scout', order: { type: 'intercept' }, targetId: 'fed-cruiser-1',
  });
  assert.match(interceptFriendly.messages.join(' '), /enemy ship/);
  const escortEnemy = applyPlayerAction(game, {
    type: 'orders', shipId: 'fed-scout', order: { type: 'escort' }, targetId: 'axis-flagship',
  });
  assert.match(escortEnemy.messages.join(' '), /friendly ship/);
  const enemyHull = applyPlayerAction(game, { type: 'orders', shipId: 'axis-flagship', order: { type: 'hold' } });
  assert.match(enemyHull.messages.join(' '), /Only Federation ships/);
  const unknown = applyPlayerAction(game, { type: 'orders', shipId: 'fed-scout', order: { type: 'charge' } });
  assert.match(unknown.messages.join(' '), /Unknown order/);
});

test('order targets are friendlies to protect and enemies to intercept', () => {
  const game = createGame({ seed: 'order-targets', extended: true });
  const escort = orderTargets(game, 'fed-scout', 'escort');
  assert.ok(escort.every((ship) => ship.faction === 'Federation'));
  assert.ok(escort.some((ship) => ship.id === 'xanadu'));
  assert.ok(!escort.some((ship) => ship.id === 'fed-scout'), 'a ship cannot be its own ward');
  const intercept = orderTargets(game, 'fed-scout', 'intercept');
  assert.ok(intercept.length > 0);
  assert.ok(intercept.every((ship) => ship.faction !== 'Federation'));
});

test('Xanadu relays an order your own radio cannot reach', () => {
  const game = extended('relay', (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 5, y: 5 };
    if (ship.id === 'fed-scout') return { ...ship, x: 95, y: 95 };
    return ship;
  });
  const result = applyPlayerAction(game, { type: 'orders', shipId: 'fed-scout', order: { type: 'hold' } });
  assert.match(result.messages.join(' '), /acknowledges/);
  assert.deepEqual(result.game.orders['fed-scout'], { type: 'hold', targetId: null });
});

test('an order out of radio contact waits one stardate', () => {
  const game = extended('radio-lag', (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 5, y: 5 };
    if (ship.id === 'fed-scout') return { ...ship, x: 95, y: 95 };
    if (ship.id === 'xanadu') return { ...ship, systems: { ...ship.systems, radio: 0 } };
    return ship;
  });
  const result = applyPlayerAction(game, { type: 'orders', shipId: 'fed-scout', order: { type: 'hold' } });
  assert.match(result.messages.join(' '), /out of radio contact/);
  assert.equal(result.game.orders['fed-scout'], undefined);
  assert.deepEqual(result.game.pendingOrders['fed-scout'], { type: 'hold', targetId: null });

  const resolved = resolveComputerTurns(result.game);
  assert.deepEqual(resolved.orders['fed-scout'], { type: 'hold', targetId: null });
  assert.deepEqual(resolved.pendingOrders, {});
  assert.ok(resolved.log.some((line) => /Empyreal receives your order to hold position/.test(line)));
});

test('a ship ordered to hold stays put instead of pursuing', () => {
  const game = extended('hold', (ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.faction === 'Federation') return { ...ship, x: 10, y: 14 };
    return { ...ship, x: 90, y: 90 };
  });
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'hold', targetId: null } } };
  assert.deepEqual(chooseAiAction(ordered, 'fed-cruiser-1'), { type: 'pass' });
  assert.equal(chooseAiAction(game, 'fed-cruiser-1').type, 'move', 'unordered, the same ship pursues');
});

test('a ship ordered to hold still fires at what comes to it', () => {
  const game = extended('hold-fire', (ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 30, y: 10 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, x: 95, y: 95 };
  });
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'hold', targetId: null } } };
  const action = chooseAiAction(ordered, 'fed-cruiser-1');
  assert.equal(action.type, 'phasers');
  assert.equal(action.targetId, 'axis-flagship');
});

test('an intercept order engages the named ship over a nearer enemy', () => {
  const setup = (isExtended) => withShips(createGame({ seed: 'intercept', extended: isExtended }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 12 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 18, y: 12 };
    if (ship.id === 'cabal-flagship') return { ...ship, x: 30, y: 12 };
    return { ...ship, x: 90, y: 90 };
  });
  assert.equal(chooseAiAction(setup(false), 'fed-cruiser-1').targetId, 'axis-flagship', 'a classic autopilot shoots the near target');
  assert.notEqual(chooseAiAction(setup(true), 'fed-cruiser-1').targetId, 'cabal-flagship', 'fleet doctrine would not pick that target');

  const ordered = { ...setup(true), orders: { 'fed-cruiser-1': { type: 'intercept', targetId: 'cabal-flagship' } } };
  const action = chooseAiAction(ordered, 'fed-cruiser-1');
  assert.equal(action.type, 'phasers');
  assert.equal(action.targetId, 'cabal-flagship');
});

test('a withdraw order runs for Xanadu', () => {
  const game = extended('withdraw', (ship) => {
    if (ship.id === 'fed-scout') return { ...ship, x: 80, y: 50 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, x: 80, y: 95 }; // every enemy past tractor reach, so nothing to shoot at
  });
  const ordered = { ...game, orders: { 'fed-scout': { type: 'withdraw', targetId: null } } };
  const action = chooseAiAction(ordered, 'fed-scout');
  assert.equal(action.type, 'move');
  assert.ok(action.dx < 0, 'the scout falls back toward Xanadu at 50,50');
  assert.equal(action.dy, 0);
});

test('a withdrawing ship still shoots at what is already in range', () => {
  const game = extended('withdraw-fire', (ship) => {
    if (ship.id === 'fed-scout') return { ...ship, x: 80, y: 50 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 88, y: 50 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, x: 5, y: 95 };
  });
  const ordered = { ...game, orders: { 'fed-scout': { type: 'withdraw', targetId: null } } };
  assert.equal(chooseAiAction(ordered, 'fed-scout').type, 'photons');
});

test('a screening ship posts itself between its ward and the threat', () => {
  const game = extended('screen', (ship) => {
    if (ship.id === 'xanadu') return ship;
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 90, y: 50 };
    return { ...ship, x: 95, y: 95 };
  });
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'screen', targetId: 'xanadu' } } };
  const action = chooseAiAction(ordered, 'fed-cruiser-1');
  assert.equal(action.type, 'move');
  assert.ok(action.dx > 0 && action.dy > 0, 'the post lies off Xanadu toward the Axis flagship');
});

test('an escort closes on its ward when nothing threatens it', () => {
  const game = extended('escort', (ship) => {
    if (ship.id === 'xanadu') return ship;
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'fed-scout') return { ...ship, x: 60, y: 60 };
    return { ...ship, x: 95, y: 5 };
  });
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'escort', targetId: 'fed-scout' } } };
  const action = chooseAiAction(ordered, 'fed-cruiser-1');
  assert.equal(action.type, 'move');
  assert.ok(action.dx > 0 && action.dy > 0);
});

test('an order whose ship is gone falls back to fleet behavior', () => {
  const game = extended('stale-order', (ship) => (ship.id === 'axis-flagship'
    ? { ...ship, status: 'destroyed' }
    : ship));
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'intercept', targetId: 'axis-flagship' } } };
  assert.deepEqual(chooseAiAction(ordered, 'fed-cruiser-1'), chooseAiAction(game, 'fed-cruiser-1'));
});

test('the fleet report lists every hull with its standing orders', () => {
  const game = {
    ...createGame({ seed: 'fleet-report', extended: true }),
    orders: { 'fed-scout': { type: 'hold', targetId: null } },
  };
  const report = reportFor(game, 'fleet');
  assert.match(report.title, /Fleet orders, Stardate 1/);
  assert.ok(report.lines.some((line) => /Empyreal — hold position/.test(line)));
  assert.ok(report.lines.some((line) => /Argo — concentrate with the fleet/.test(line)));
  assert.ok(!report.lines.some((line) => /Firebreather/.test(line)), 'only your own fleet takes orders');
});

test('an extended war played out under standing orders still resolves', () => {
  let game = createGame({ seed: 'extended-full-war', extended: true });
  game = {
    ...game,
    orders: {
      'fed-cruiser-1': { type: 'hold', targetId: null },
      'fed-cruiser-2': { type: 'screen', targetId: 'xanadu' },
      'fed-cruiser-3': { type: 'escort', targetId: 'fed-flagship' },
      'fed-scout': { type: 'withdraw', targetId: null },
    },
  };
  for (let round = 0; round < 500 && !game.outcome; round += 1) {
    game = resolveComputerTurns(resolveAutopilotTurn(game).game);
  }
  assert.ok(game.outcome, 'the war must reach an outcome');
  assert.ok(game.turn > 1, 'and it must have taken more than one stardate');
});

// --- Extended war: dockyard support and the battle report ----------------------

const crippled = (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 54, y: 50, shields: 10 } : ship);

test('a damaged ship beside Xanadu repairs in an extended war', () => {
  const game = extended('dock-repair', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 10, crew: 30 }
    : ship));
  const { game: after, messages } = resolveDocking(game);
  const cruiser = getShip(after, 'fed-cruiser-1');
  assert.equal(cruiser.shields, 10 + Math.ceil(shieldCapacity(cruiser) * DOCKING.shieldRate));
  assert.equal(cruiser.crew, 30 + DOCKING.crewRate);
  assert.ok(messages.some((line) => /Bonhomme docks at Xanadu: shields \+\d+, \d+ crew transferred\./.test(line)));
});

test('a classic war has no dockyard support', () => {
  const { game, messages } = resolveDocking(withShips(createGame({ seed: 'dock-classic' }), crippled));
  assert.equal(getShip(game, 'fed-cruiser-1').shields, 10);
  assert.deepEqual(messages, []);
});

test('docking needs the ship inside the dockyard ring', () => {
  const game = extended('dock-far', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 50 + DOCKING.range + 1, y: 50, shields: 10 }
    : ship));
  assert.equal(getShip(resolveDocking(game).game, 'fed-cruiser-1').shields, 10);
});

test('a ship held by a tractor beam cannot dock', () => {
  const game = extended('dock-held', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 10, tractorBy: 'axis-flagship' }
    : ship));
  assert.equal(getShip(resolveDocking(game).game, 'fed-cruiser-1').shields, 10);
});

test('a crippled starbase cannot support the fleet', () => {
  const game = extended('dock-crippled', (ship) => {
    if (ship.id === 'xanadu') return { ...ship, shields: 10 };
    return crippled(ship);
  });
  assert.equal(getShip(resolveDocking(game).game, 'fed-cruiser-1').shields, 10);
});

test('the dockyard rebuilds one damaged subsystem per stardate, worst first', () => {
  const game = extended('dock-systems', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 10, systems: { ...ship.systems, mapper: 0, radio: 0 } }
    : ship));
  const first = getShip(resolveDocking(game).game, 'fed-cruiser-1');
  // Cruiser template is mapper 2, radio 1, so the mapper's deficit of 2 is the worst.
  assert.equal(first.systems.mapper, 1);
  assert.equal(first.systems.radio, 0);
  assert.ok(first.shields > 10, 'shields still recover alongside the hardware');

  const second = getShip(resolveDocking(resolveDocking(game).game).game, 'fed-cruiser-1');
  assert.equal(second.systems.mapper, 2, 'and it works down the list on later stardates');
  assert.equal(second.systems.radio, 0);
});

test('docking stops at full shields and crew', () => {
  const game = extended('dock-full', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 139, crew: 139 }
    : ship));
  const { game: after, messages } = resolveDocking(game);
  const cruiser = getShip(after, 'fed-cruiser-1');
  assert.equal(cruiser.shields, 140, 'shield capacity is a ceiling');
  assert.equal(cruiser.crew, 140, 'so is the crew complement');
  assert.ok(messages.some((line) => /Bonhomme docks at Xanadu: shields \+1, 1 crew transferred\./.test(line)));
});

test('a docked hull may take one refit, and only one', () => {
  const game = extended('refit-once', (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 54, y: 50 } : ship));
  const first = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'photons' });
  assert.equal(getShip(first.game, 'fed-cruiser-1').systems.photons, 3, 'the cruiser template carries 2 photon bays');
  assert.equal(first.game.refits['fed-cruiser-1'], 'photons');
  assert.match(first.messages.join(' '), /is refitted at Xanadu: photons \+1/);

  const second = applyPlayerAction(first.game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'phasers' });
  assert.match(second.messages.join(' '), /already taken its refit/);
  assert.equal(getShip(second.game, 'fed-cruiser-1').systems.phasers, 4, 'and the second refit is refused');
});

test('a refit needs the dockyard ring', () => {
  const game = extended('refit-afloat', (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 20, y: 20 } : ship));
  const result = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'engines' });
  assert.match(result.messages.join(' '), /inside the dockyard ring/);
  assert.equal(getShip(result.game, 'fed-cruiser-1').systems.engines, 4);
});

test('a refit cannot push a system past its cap', () => {
  const game = extended('refit-cap', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, systems: { ...ship.systems, photons: 4 } }
    : ship));
  const result = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'photons' });
  assert.match(result.messages.join(' '), /cannot carry more photons/);
  assert.equal(getShip(result.game, 'fed-cruiser-1').systems.photons, 4);
});

test('refits are an extended-war option', () => {
  const game = withShips(createGame({ seed: 'refit-classic' }), (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 54, y: 50 } : ship));
  const result = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'photons' });
  assert.match(result.messages.join(' '), /extended-war option/);
});

test('docking resolves during the computer phase and reaches the narrative', () => {
  const game = extended('dock-in-round', (ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 52, y: 50, shields: 20 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, status: 'destroyed' };
  });
  const resolved = resolveComputerTurns(game);
  assert.ok(resolved.log.some((line) => /Bonhomme docks at Xanadu: shields \+12\./.test(line)));
  assert.equal(getShip(resolved, 'fed-cruiser-1').shields, 32);
});

test('the battle report names the top gun, the losses, and your own record', () => {
  const base = createGame({ seed: 'battle-report' });
  const game = {
    ...base,
    turn: 34,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-scout') return { ...ship, status: 'destroyed' };
      if (ship.id === 'axis-flagship') return { ...ship, kills: 5 };
      if (ship.id === 'fed-flagship') return { ...ship, kills: 2, shotsFired: 9, shotsTaken: 4 };
      return ship;
    }),
  };
  const report = reportFor(game, 'battle-report');
  assert.equal(report.title, 'Battle report');
  assert.ok(report.lines.includes('Stardates elapsed: 34.'));
  assert.ok(report.lines.some((line) => /Federation losses: 1 of 6 hulls/.test(line)));
  assert.ok(report.lines.some((line) => /Top gun: Firebreather of the Axis, 5 credited kills/.test(line)));
  assert.ok(report.lines.some((line) => /Your record, Captain Jason of the Argo: 2 kills from 9 volleys fired, 4 absorbed/.test(line)));
});

test('a war with no kills still reports', () => {
  const report = reportFor(createGame({ seed: 'bloodless' }), 'battle-report');
  assert.ok(report.lines.includes('No ship scored a kill.'));
  assert.ok(!report.lines.some((line) => /Most collisions/.test(line)));
});

test('a collision is counted against both hulls', () => {
  const game = withShips(createGame({ seed: 'collision-count' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 10, y: 10 };
    return { ...ship, x: 90, y: 90 };
  });
  const { game: after } = resolveCollision(game, getShip(game, 'fed-flagship'));
  assert.equal(getShip(after, 'fed-flagship').collisions, 1);
  assert.equal(getShip(after, 'axis-flagship').collisions, 1);
  assert.equal(createGame({ seed: 'collision-count' }).ships[0].collisions, 0);
});

// --- Collisions: one destroyed, the other crippled -----------------------------

const systemTotal = (ship) => Object.values(ship.systems).reduce((total, units) => total + units, 0);

const ramGame = (seed, ids, point = { x: 10, y: 10 }) => withShips(createGame({ seed }), (ship) => (ids.includes(ship.id)
  ? { ...ship, ...point }
  : { ...ship, x: 90, y: 90 }));

test('a collision destroys one hull and cripples the other, never both', () => {
  // A scout's whole hull is 45 shields + 35 crew + 17 system units, well under the
  // flat 120 damage the survivor used to take, so both ships died.
  const game = ramGame('cripple-scout', ['fed-scout', 'axis-scout']);
  const { game: after } = resolveCollision(game, getShip(game, 'fed-scout'));
  const pair = ['fed-scout', 'axis-scout'].map((id) => getShip(after, id));
  const destroyed = pair.filter((ship) => ship.status === 'destroyed');
  const survivor = pair.find((ship) => ship.status !== 'destroyed');
  assert.equal(destroyed.length, 1, 'exactly one hull is destroyed');
  assert.equal(survivor.status, 'active', 'the other is crippled, not lost');
  assert.equal(survivor.shields, 0, 'crippled means its shields are gone');

  const before = getShip(game, survivor.id);
  const expected = Math.ceil((before.crew + systemTotal(before)) * CRIPPLE.fraction);
  const lost = (before.crew - survivor.crew) + (systemTotal(before) - systemTotal(survivor));
  assert.equal(lost, expected, 'and about half its crew and subsystems are gone');
});

test('a tractor beam that drags a hull into another resolves the collision', () => {
  const game = withShips(createGame({ seed: 'tow-ram' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 40, y: 10 };
    if (ship.id === 'bloc-flagship') return { ...ship, x: 25, y: 10 }; // in the tow path
    return { ...ship, x: 90, y: 90 };
  });
  const result = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship' });
  const text = result.messages.join(' ');
  assert.match(text, /has beamed Firebreather to 25, 10/);
  assert.match(text, /Collision/, 'the towed hull lands on top of a third ship');
  const hit = ['axis-flagship', 'bloc-flagship'].map((id) => getShip(result.game, id).status);
  assert.ok(hit.includes('destroyed'), 'one of the two is destroyed');
});

test('hyperspacing onto another hull is a collision, not an overlap', () => {
  const game = withShips(createGame({ seed: 'jump-ram' }), (ship) => (ship.id === 'axis-flagship'
    ? { ...ship, x: 70, y: 70 }
    : ship));
  const result = applyPlayerAction(game, { type: 'hyperspace', x: 70, y: 70 });
  const text = result.messages.join(' ');
  assert.ok(/burnt up/.test(text) || /Collision/.test(text), 'a jump onto a hull either misjumps or collides');
  if (!/burnt up/.test(text)) {
    const statuses = ['fed-flagship', 'axis-flagship'].map((id) => getShip(result.game, id).status);
    assert.ok(statuses.includes('destroyed'), 'one of the two hulls is gone');
  }
});

test('a ship cannot end its move overlapping another live hull', () => {
  const game = ramGame('pile-up', ['fed-flagship', 'axis-flagship', 'bloc-flagship']);
  const { game: after, messages } = resolveCollision(game, getShip(game, 'fed-flagship'));
  assert.ok(messages.length >= 1);
  const actor = getShip(after, 'fed-flagship');
  if (actor.status !== 'active') return;
  const stillOverlapping = ['axis-flagship', 'bloc-flagship'].filter((id) => {
    const other = getShip(after, id);
    return other.status === 'active' && distance(actor, other) < 1;
  });
  assert.deepEqual(stillOverlapping, [], 'every overlap the actor is party to resolves');
});

// --- Extended war: alliance doctrines ------------------------------------------

test('a gutted Axis captain takes the enemy fleet with it', () => {
  const setup = (isExtended) => withShips(createGame({ seed: 'axis-suicide', extended: isExtended }), (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 50, shields: 5 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 55, y: 50 };
    if (ship.id === 'fed-cruiser-2') return { ...ship, x: 50, y: 55 };
    if (ship.id === 'fed-cruiser-3') return { ...ship, x: 45, y: 50 };
    if (ship.id === 'fed-scout') return { ...ship, x: 50, y: 45 };
    if (ship.faction === 'Axis') return { ...ship, x: 5, y: 5 };
    return { ...ship, x: 95, y: 95 };
  });
  assert.equal(chooseAiAction(setup(true), 'axis-cruiser-1').type, 'self-destruct',
    'four enemies inside the blast and none of its own');
  assert.notEqual(chooseAiAction(setup(false), 'axis-cruiser-1').type, 'self-destruct',
    'a classic autopilot never gives up its hull');
});

test('an Axis captain will not detonate over its own fleet', () => {
  const game = extended('axis-restraint', (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 50, shields: 5 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 55, y: 50 };
    if (ship.id === 'fed-cruiser-2') return { ...ship, x: 50, y: 55 };
    if (ship.id === 'fed-cruiser-3') return { ...ship, x: 45, y: 50 };
    if (ship.id === 'fed-scout') return { ...ship, x: 50, y: 45 };
    if (ship.faction === 'Axis') return { ...ship, x: 52, y: 52 }; // four of its own inside the blast
    return { ...ship, x: 95, y: 95 };
  });
  assert.notEqual(chooseAiAction(game, 'axis-cruiser-1').type, 'self-destruct');
});

test('an Axis captain with nothing in range closes to contact', () => {
  const game = extended('axis-ram', (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 10, y: 10, systems: { ...ship.systems, phasers: 0, photons: 0, tractor: 0 } };
    if (ship.faction === 'Federation') return { ...ship, x: 60, y: 10 };
    return { ...ship, x: 90, y: 90 };
  });
  const action = chooseAiAction(game, 'axis-cruiser-1');
  assert.equal(action.type, 'move');
  assert.equal(action.dx, 40, 'a full burn at a hull 50 away: Axis fights from 5 units, not from range');
  assert.equal(action.dy, 0);
});

test('an Axis captain no longer detonates at 8% — it waits until nearly destroyed', () => {
  // ~6% shields (9 of 140) sat inside the old 8% trigger; at the 4% bar the captain
  // keeps fighting instead of ending the exchange — and often the war — on a blast.
  const game = extended('axis-no-early-blast', (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 50, shields: 9 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 55, y: 50 };
    if (ship.id === 'fed-cruiser-2') return { ...ship, x: 50, y: 55 };
    if (ship.id === 'fed-cruiser-3') return { ...ship, x: 45, y: 50 };
    if (ship.id === 'fed-scout') return { ...ship, x: 50, y: 45 };
    if (ship.faction === 'Axis') return { ...ship, x: 5, y: 5 };
    return { ...ship, x: 95, y: 95 };
  });
  assert.notEqual(chooseAiAction(game, 'axis-cruiser-1').type, 'self-destruct',
    'four enemies point-blank is no longer enough at 6% shields');
});

test("the vendetta captain never detonates, even cornered at death's door", () => {
  const game = {
    ...extended('vendetta-no-suicide', (ship) => {
      if (ship.id === 'axis-cruiser-1') return { ...ship, x: 50, y: 50, shields: 3 };
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 55, y: 50 };
      if (ship.id === 'fed-cruiser-2') return { ...ship, x: 50, y: 55 };
      if (ship.id === 'fed-cruiser-3') return { ...ship, x: 45, y: 50 };
      if (ship.id === 'fed-scout') return { ...ship, x: 50, y: 45 };
      if (ship.faction === 'Axis') return { ...ship, x: 5, y: 5 };
      return { ...ship, x: 95, y: 95 };
    }),
    vendettaShipId: 'axis-cruiser-1',
  };
  assert.notEqual(chooseAiAction(game, 'axis-cruiser-1').type, 'self-destruct',
    'the hunter keeps hunting rather than trading itself away');
});

test('a Bloc gunner backs off anything inside its minimum range', () => {
  const game = extended('bloc-kite', (ship) => {
    if (ship.id === 'bloc-cruiser-1') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 53, y: 50, shields: 1, crew: 1 };
    return { ...ship, x: 95, y: 95 };
  });
  const action = chooseAiAction(game, 'bloc-cruiser-1');
  assert.equal(action.type, 'move', 'it opens the range instead of trading photons at 3 units');
  assert.ok(action.dx < 0);
});

test('a Bloc gunner will not tow a target it cannot shoot', () => {
  const game = extended('bloc-notractor', (ship) => {
    if (ship.id === 'bloc-cruiser-1') return { ...ship, x: 10, y: 10, systems: { ...ship.systems, phasers: 0, photons: 0 } };
    if (ship.id === 'fed-scout') return { ...ship, x: 42, y: 10, shields: 1, crew: 1 };
    return { ...ship, x: 95, y: 95 };
  });
  const action = chooseAiAction(game, 'bloc-cruiser-1');
  assert.equal(action.type, 'move', 'no tractor: Bloc fights at the phaser edge and closes to it');
});

test('a Bloc gunner executes the wounded it can hit, not one across the map', () => {
  const game = extended('bloc-focus', (ship) => {
    if (ship.id === 'bloc-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 30, y: 10, shields: 40 };
    if (ship.id === 'fed-scout') return { ...ship, x: 90, y: 90, shields: 1, crew: 1 };
    if (ship.faction === 'Bloc') return ship;
    return { ...ship, x: 95, y: 5 };
  });
  const action = chooseAiAction(game, 'bloc-cruiser-1');
  assert.equal(action.type, 'phasers');
  assert.equal(action.targetId, 'fed-flagship', 'the crippled scout 113 units away is not worth the trip');
});

test('a Cabal trickster tows a target into another enemy rather than shooting it', () => {
  const game = extended('cabal-tow', (ship) => {
    if (ship.id === 'cabal-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'cabal-flagship') return { ...ship, x: 26, y: 10 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 25, y: 10 };
    if (ship.id === 'bloc-scout') return { ...ship, x: 15, y: 10 }; // where the tow lands
    if (ship.faction === 'Cabal') return ship;
    return { ...ship, x: 95, y: 95 };
  });
  const action = chooseAiAction(game, 'cabal-cruiser-1');
  assert.equal(action.type, 'tractor', 'a 10 unit tow puts the Argo on top of a Bloc scout');
  assert.equal(action.targetId, 'fed-flagship');
});

test('a Cabal trickster will not tow a target onto its own hull', () => {
  const game = extended('cabal-no-own-goal', (ship) => {
    if (ship.id === 'cabal-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'cabal-flagship') return { ...ship, x: 12, y: 10 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 15, y: 10 };
    if (ship.faction === 'Cabal') return ship;
    return { ...ship, x: 95, y: 95 };
  });
  const action = chooseAiAction(game, 'cabal-cruiser-1');
  assert.notEqual(action.type, 'tractor', 'that tow would land the Argo on the Cabal hull itself');
  assert.equal(action.type, 'photons');
});

test('a Cabal trickster shoots when a tow would hit nothing', () => {
  const game = extended('cabal-shoot', (ship) => {
    if (ship.id === 'cabal-cruiser-1') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'cabal-flagship') return { ...ship, x: 20, y: 20 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 30, y: 10 };
    if (ship.faction === 'Cabal') return ship;
    return { ...ship, x: 95, y: 95 };
  });
  assert.equal(chooseAiAction(game, 'cabal-cruiser-1').type, 'phasers',
    'a tow from 20 units lands in empty space, so the volley is not wasted on it');
});

test('a Federation captain concentrates with the fleet and refits when hurt', () => {
  const game = extended('fed-doctrine', (ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 40, y: 50, shields: 20 };
    if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'axis-scout') return { ...ship, x: 52, y: 50 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, x: 95, y: 5 };
  });
  // 20 of 70 shields is under the 35% discipline threshold, so it tops up first.
  assert.equal(chooseAiAction(game, 'fed-cruiser-1').type, 'shields');

  const healthy = withShips(game, (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, shields: 60 } : ship));
  const action = chooseAiAction(healthy, 'fed-cruiser-1');
  assert.equal(action.type, 'phasers');
  assert.equal(action.targetId, 'axis-scout', 'the fleet concentrates on the enemy nearest the flagship');
});

test('the vendetta ship neither refits nor runs', () => {
  const base = extended('vendetta-doctrine', (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-cruiser-1' || ship.id === 'axis-cruiser-2') return { ...ship, x: 60, y: 60, shields: 3 };
    return { ...ship, x: 95, y: 95 };
  });
  const hunting = { ...base, vendettaShipId: 'axis-cruiser-1' };
  assert.equal(chooseAiAction(hunting, 'axis-cruiser-1').type, 'move', 'it keeps coming for Captain Jason');
  const plain = { ...base, vendettaShipId: 'bloc-flagship' };
  assert.equal(chooseAiAction(plain, 'axis-cruiser-2').type, 'shields', 'an ordinary Axis captain refits first');
});

// --- Extended war: captains, aces, and the escalating vendetta ------------------

test('every hull has a captain, dealt from the name list without repeats', () => {
  const names = createGame({ seed: 'captains' }).ships.map((ship) => ship.captain);
  assert.equal(names.length, 21);
  assert.ok(names.every((name) => CAPTAIN_NAMES.includes(name)));
  assert.equal(new Set(names).size, names.length, 'no two hulls share a captain');
  assert.deepEqual(createGame({ seed: 'captains' }).ships.map((ship) => ship.captain), names, 'and the deal is seeded');
  assert.notDeepEqual(createGame({ seed: 'other-captains' }).ships.map((ship) => ship.captain), names);
});

test('captains are dealt on their own stream, leaving the war exactly as it was', () => {
  // The positions and the vendetta pick come from the war's RNG; captains must not
  // draw from it, or every existing seed would deal a different war.
  const game = createGame({ seed: 'captain-stream' });
  assert.equal(game.ships.filter((ship) => ship.id.endsWith('-flagship')).length, 4);
  assert.ok(game.vendettaShipId.endsWith('-flagship'));
  assert.notEqual(game.vendettaShipId, 'fed-flagship', 'the hunter is always an enemy flagship');
  assert.equal(getShip(game, 'xanadu').x, 50, 'Xanadu still sits at the centre');
});

test('two credited kills make an ace', () => {
  assert.equal(isAce({ kills: ACE_KILLS }), true);
  assert.equal(isAce({ kills: ACE_KILLS - 1 }), false);
});

test('the grudge only sharpens the vendetta hull’s volleys against your command ship', () => {
  const base = createGame({ seed: 'grudge', extended: true });
  const hunter = { ...getShip(base, base.vendettaShipId), kills: 7 };
  const jason = getShip(base, base.playerShipId);
  assert.equal(vendettaGrudge(base, hunter, jason), Math.floor(7 / VENDETTA.killsPerStep));
  assert.equal(vendettaGrudge(base, hunter, getShip(base, 'bloc-flagship')), 0, 'only against Captain Jason');
  assert.equal(vendettaGrudge(base, getShip(base, 'bloc-flagship'), jason), 0, 'only from the hull hunting you');

  const classic = createGame({ seed: 'grudge' });
  const classicHunter = { ...getShip(classic, classic.vendettaShipId), kills: 9 };
  assert.equal(vendettaGrudge(classic, classicHunter, getShip(classic, classic.playerShipId)), 0,
    'a classic war has no grudge');
});

test('a deeper grudge means a heavier volley, and none leaves the mean alone', () => {
  const ship = getShip(createGame({ seed: 'grudge-damage' }), 'fed-flagship');
  const mean = (grudge) => {
    const rng = createRng('grudge-mean');
    const rolls = Array.from({ length: 200 }, () => weaponDamage('phasers', ship, rng, grudge));
    return rolls.reduce((total, roll) => total + roll, 0) / rolls.length;
  };
  const nominal = 12 + ship.systems.phasers * 4;
  assert.ok(Math.abs(mean(0) - nominal) < 2, 'no grudge keeps the calibrated mean');
  assert.ok(mean(2) > mean(0) * 1.4, 'two steps of grudge bites at least 40% harder');
});

test('scanning records the hull and names its captain in an extended war', () => {
  const setup = (isExtended) => withShips(createGame({ seed: 'scan-captain', extended: isExtended }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 15, y: 10 };
    return ship;
  });
  const result = applyPlayerAction(setup(true), { type: 'scan', targetId: 'axis-flagship' });
  assert.equal(result.game.scanned['axis-flagship'], true);
  assert.ok(result.report.lines.some((line) => line === `Captain: ${getShip(setup(true), 'axis-flagship').captain}`));

  const classic = applyPlayerAction(setup(false), { type: 'scan', targetId: 'axis-flagship' });
  assert.ok(!classic.report.lines.some((line) => line.startsWith('Captain:')),
    'a classic scan reports only what the manual lists');
});

test('kill lines name captains only in an extended war', () => {
  const classic = createGame({ seed: 'kill-lines' });
  const shooter = getShip(classic, 'axis-flagship');
  const victim = getShip(classic, 'fed-cruiser-1');
  assert.deepEqual(killLines(classic, shooter, victim), [], 'a classic narrative is unchanged');

  const war = createGame({ seed: 'kill-lines', extended: true });
  const lines = killLines(war, getShip(war, 'axis-flagship'), victim);
  assert.equal(lines[0], 'Bonhomme is destroyed.');
  assert.equal(lines[1], `Captain ${shooter.captain} of the Firebreather is credited with 1 kill.`);
});

test('a second kill makes an ace and every third deepens the vendetta', () => {
  const game = createGame({ seed: 'kill-escalation', extended: true });
  const hunter = getShip(game, game.vendettaShipId);
  const victim = getShip(game, 'fed-cruiser-1');

  const second = killLines(game, { ...hunter, kills: ACE_KILLS - 1 }, victim);
  assert.ok(second.some((line) => /is now an ace/.test(line)));
  assert.ok(!second.some((line) => /hunts you still/.test(line)));

  const third = killLines(game, { ...hunter, kills: VENDETTA.killsPerStep - 1 }, victim);
  assert.ok(third.some((line) => /hunts you still/.test(line)), 'the third kill escalates the grudge');
});

test('a completed round is kept for replay', () => {
  const resolved = resolveComputerTurns(createGame({ seed: 'last-round' }));
  assert.ok(Array.isArray(resolved.lastRound.events));
  assert.ok(resolved.lastRound.entries.length > 0, 'the round narrative is kept beside the events');
});

// --- Extended war: scenarios ----------------------------------------------------

test('a classic war always fights to annihilation', () => {
  assert.equal(createGame({ seed: 'scenario-classic', scenario: 'defend-xanadu' }).scenario, 'annihilation',
    'a scenario is an extended-war option');
  assert.equal(createGame({ seed: 'scenario-ext', extended: true, scenario: 'defend-xanadu' }).scenario, 'defend-xanadu');
  assert.equal(createGame({ seed: 'scenario-junk', extended: true, scenario: 'nonsense' }).scenario, 'annihilation');
});

test('hold Xanadu is lost the moment the base falls', () => {
  const game = withShips(
    createGame({ seed: 'defend-lost', extended: true, scenario: 'defend-xanadu' }),
    (ship) => (ship.id === 'xanadu' ? { ...ship, status: 'destroyed' } : ship),
  );
  const outcome = evaluateOutcome(game);
  assert.equal(outcome.kind, 'scenario-loss');
  assert.match(outcome.message, /Xanadu has fallen/);
});

test('hold Xanadu is won by outlasting the target stardate', () => {
  const game = {
    ...createGame({ seed: 'defend-won', extended: true, scenario: 'defend-xanadu' }),
    turn: SCENARIOS['defend-xanadu'].stardates,
  };
  const outcome = evaluateOutcome(game);
  assert.equal(outcome.kind, 'scenario-win');
  assert.match(outcome.message, /Xanadu still stands/);
  assert.equal(evaluateOutcome({ ...game, turn: game.turn - 1 }).kind, 'active', 'one stardate short is not enough');
});

test('wiping out the enemy still wins outright under a scenario', () => {
  const game = createGame({ seed: 'defend-outright', extended: true, scenario: 'defend-xanadu' });
  const wiped = withShips(game, (ship) => (ship.faction === 'Federation' ? ship : { ...ship, status: 'destroyed' }));
  assert.equal(evaluateOutcome(wiped).kind, 'federation-win');
});

test('the hunt is lost if the hunter dies unidentified, won once you know them', () => {
  const base = createGame({ seed: 'hunt', extended: true, scenario: 'hunt-the-vendetta' });
  const hunterId = base.objectiveShipId;
  assert.equal(hunterId, base.vendettaShipId, 'the objective is the hull hunting Captain Jason');

  const dead = withShips(base, (ship) => (ship.id === hunterId ? { ...ship, status: 'destroyed' } : ship));
  assert.equal(evaluateOutcome(dead).kind, 'scenario-loss');
  assert.match(evaluateOutcome(dead).message, /never learned who commanded it/);

  const identified = { ...dead, scanned: { [hunterId]: true } };
  assert.equal(evaluateOutcome(identified).kind, 'scenario-win');
  assert.match(evaluateOutcome(identified).message, /The vendetta ends here/);
});

test('boarding the hunter wins the hunt even though the hull survives', () => {
  const base = createGame({ seed: 'hunt-boarded', extended: true, scenario: 'hunt-the-vendetta' });
  const hunterId = base.objectiveShipId;
  const boarded = {
    ...withShips(base, (ship) => (ship.id === hunterId ? { ...ship, faction: 'Federation' } : ship)),
    scanned: { [hunterId]: true },
  };
  assert.equal(evaluateOutcome(boarded).kind, 'scenario-win');
  assert.match(evaluateOutcome(boarded).message, /flies Federation colours/);
});

test('the hunt remembers its target after the vendetta is cleared', () => {
  const base = createGame({ seed: 'hunt-cleared', extended: true, scenario: 'hunt-the-vendetta' });
  const game = { ...base, vendettaShipId: null };
  assert.equal(game.objectiveShipId, base.objectiveShipId, 'boarding clears the vendetta, not the objective');
  assert.equal(evaluateOutcome(game).kind, 'active');
});

test('the mission panel names the hunter but not their hull until you scan', () => {
  const base = createGame({ seed: 'hunt-progress', extended: true, scenario: 'hunt-the-vendetta' });
  const hunter = getShip(base, base.objectiveShipId);
  const hidden = scenarioProgress(base).join(' ');
  assert.ok(hidden.includes(hunter.captain), 'the captain is named');
  assert.ok(!hidden.includes(hunter.name), 'the hull is not — that is what scanning is for');
  const revealed = scenarioProgress({ ...base, scanned: { [hunter.id]: true } }).join(' ');
  assert.ok(revealed.includes(hunter.name));
  assert.ok(!revealed.includes(`${hunter.x}, ${hunter.y}`), 'and it never gives away a position the sensors did not earn');
});

test('hold Xanadu reports its progress against the target stardate', () => {
  const game = { ...createGame({ seed: 'defend-progress', extended: true, scenario: 'defend-xanadu' }), turn: 7 };
  const lines = scenarioProgress(game).join(' ');
  assert.match(lines, /Xanadu: active at 50, 50/);
  assert.ok(lines.includes(`Hold until stardate ${SCENARIOS['defend-xanadu'].stardates}.  Now stardate 7.`), lines);
});

// --- Backlog: click to move, sensor honesty, command transfer, log growth -------

const atOrigin = (seed, x = 10, y = 10) => withShips(createGame({ seed }), (ship) => (ship.id === 'fed-flagship' ? { ...ship, x, y } : ship));

test('a click on the map becomes a legal engine maneuver', () => {
  const game = atOrigin('click-move');
  assert.deepEqual(maneuverTo(game, 40, 10), { dx: 30, dy: 0 });
  assert.deepEqual(maneuverTo(game, 10, 25), { dx: 0, dy: 15 });
});

test('a click past the engine ring is clamped to it rather than refused', () => {
  const game = atOrigin('click-clamp');
  const capacity = engineCapacity(getShip(game, 'fed-flagship'));
  const move = maneuverTo(game, 99, 10);
  assert.equal(move.dx, capacity, 'a full burn toward the clicked point');
  assert.equal(move.dy, 0);
  const result = applyPlayerAction(game, { type: 'move', ...move });
  assert.ok(!result.messages.some((line) => /engine capacity/.test(line)), 'and the move command accepts it');
});

test('rounding a diagonal click never exceeds engine capacity', () => {
  const game = atOrigin('click-diagonal');
  const capacity = engineCapacity(getShip(game, 'fed-flagship'));
  for (const [x, y] of [[99, 99], [60, 11], [11, 60], [99, 10.6], [10.4, 99], [45, 12]]) {
    const move = maneuverTo(game, x, y);
    const span = Math.hypot(move.dx, move.dy);
    assert.ok(span <= capacity, `clicking ${x},${y} produced a move of ${span} over capacity ${capacity}`);
    assert.ok(span > 0, `clicking ${x},${y} must still move the ship`);
    assert.ok(!applyPlayerAction(game, { type: 'move', ...move }).messages.some((line) => /engine capacity/.test(line)));
  }
});

test('a click cannot maneuver a ship that is engineless, held, or not yours to move', () => {
  const game = atOrigin('click-blocked');
  const withFlagship = (changes) => ({ ...game, ships: game.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, ...changes } : ship)) });
  assert.equal(maneuverTo(withFlagship({ systems: { ...getShip(game, 'fed-flagship').systems, engines: 0 } }), 40, 40), null);
  assert.equal(maneuverTo(withFlagship({ tractorBy: 'axis-flagship' }), 40, 40), null, 'a tractor lock holds you fast');
  assert.equal(maneuverTo({ ...game, phase: 'computer' }, 40, 40), null);
  assert.equal(maneuverTo({ ...game, resigned: true }, 40, 40), null);
  assert.equal(maneuverTo(game, 10, 10), null, 'clicking your own hull is not an order');
});

test('the computer report cannot see past the mapper', () => {
  const game = withShips(createGame({ seed: 'computer-fog' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 5, y: 5 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 95, y: 95 };
    return { ...ship, x: 90, y: 90 };
  });
  const lines = applyPlayerAction(game, { type: 'computer' }).report.lines.join(' ');
  assert.match(lines, /Nearest enemy: none within mapper range/, 'a standard command must not out-see the mapper');
  assert.match(lines, /Distance to Xanadu/, 'your own base bearing is not sensor-limited');
});

test('the computer report names an enemy the mapper can actually see', () => {
  const game = withShips(createGame({ seed: 'computer-sees' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 5, y: 5 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 20, y: 5 };
    return { ...ship, x: 90, y: 90 };
  });
  assert.match(applyPlayerAction(game, { type: 'computer' }).report.lines.join(' '), /Nearest enemy: Firebreather at 15\.0/);
});

test('command shifts to a hull that can move rather than to immobile Xanadu', () => {
  const game = withShips(createGame({ seed: 'transfer-mobile' }), (ship) => (ship.id === 'fed-flagship'
    ? { ...ship, status: 'destroyed' }
    : ship));
  const next = strongestFederation(game, 'fed-flagship');
  assert.notEqual(next.id, 'xanadu');
  assert.ok(next.systems.engines > 0, 'the successor can still maneuver');
});

test('command falls back to Xanadu when nothing else can move', () => {
  const game = withShips(createGame({ seed: 'transfer-xanadu' }), (ship) => (ship.faction === 'Federation' && ship.id !== 'xanadu'
    ? { ...ship, systems: { ...ship.systems, engines: 0 } }
    : ship));
  assert.equal(strongestFederation(game, 'fed-flagship').id, 'xanadu');
});

test('resigning hands over by the same rule as dying', () => {
  const game = createGame({ seed: 'resign-mobile' });
  const resigned = applyPlayerAction(game, { type: 'resign' });
  assert.equal(resigned.game.playerShipId, strongestFederation(game, 'fed-flagship').id);
  assert.notEqual(resigned.game.playerShipId, 'xanadu');
});

test('the battle narrative is bounded so a long war still saves', () => {
  const long = Array.from({ length: LOG_LIMIT + 50 }, (_, index) => `line ${index}`);
  const capped = appendLog(long, ['newest']);
  assert.equal(capped.length, LOG_LIMIT);
  assert.equal(capped[capped.length - 1], 'newest', 'the newest entries are the ones kept');
  assert.equal(capped[0], 'line 51', 'and the oldest fall off the front');
  assert.deepEqual(appendLog(null, ['first']), ['first']);
});

test('a resolved round cannot grow the narrative past the bound', () => {
  const game = { ...createGame({ seed: 'log-war' }), log: Array.from({ length: LOG_LIMIT }, (_, index) => `old ${index}`) };
  assert.ok(resolveComputerTurns(game).log.length <= LOG_LIMIT);
});

// --- Precision fire: the power dial and called shots ---------------------------

const precisionGame = (seed) => withShips(createGame({ seed, precision: true }), (ship) => {
  if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
  if (ship.id === 'axis-flagship') return { ...ship, x: 16, y: 10 };
  return { ...ship, x: 90, y: 90 };
});

const gutted = (ship) => (ship.id === 'axis-flagship'
  ? { ...ship, shields: 0, crew: 120, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0 } }
  : ship);

test('precision fire is a war option, off by default', () => {
  assert.equal(createGame({ seed: 'precision-flag' }).precision, false);
  assert.equal(createGame({ seed: 'precision-flag', precision: true }).precision, true);
});

test('the power dial scales a standard phaser volley', () => {
  const game = precisionGame('dial');
  const before = getShip(game, 'axis-flagship').shields;
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship', power: 50 });
  const dealt = before - getShip(result.game, 'axis-flagship').shields;
  // A battle cruiser's phasers roll 24-40; half of that band is 12-20.
  assert.ok(dealt >= 12 && dealt <= 20, `a half-power volley dealt ${dealt}`);
});

test('a classic war ignores the power dial and called systems', () => {
  const game = placedGame('classic-ignores');
  const plain = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  const dialed = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship', power: 50, focus: 'engines' });
  assert.deepEqual(dialed.game, plain.game);
  assert.deepEqual(dialed.messages, plain.messages);
});

test('a called volley burns only the called system and spares the crew', () => {
  const game = withShips(precisionGame('called'), (ship) => (ship.id === 'axis-flagship' ? { ...ship, shields: 0 } : ship));
  const before = getShip(game, 'axis-flagship');
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship', focus: 'engines' });
  const after = getShip(result.game, 'axis-flagship');
  assert.equal(after.crew, before.crew, 'a surgical strike takes no crew');
  assert.equal(after.systems.engines, 0, 'a full-power surgical volley burns out five engine units');
  assert.equal(after.systems.phasers, before.systems.phasers, 'untouched systems stay untouched');
  assert.equal(after.status, 'active', 'a disabled hull is not a dead hull');
  assert.match(result.messages.join(' '), /focused phaser beam/);
  assert.match(result.messages.join(' '), /engines are disabled/);
});

test('a called volley checks fire once the called system is dead', () => {
  const game = withShips(precisionGame('check-fire'), (ship) => (ship.id === 'axis-flagship'
    ? { ...ship, shields: 0, systems: { ...ship.systems, engines: 2 } }
    : ship));
  const before = getShip(game, 'axis-flagship');
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship', focus: 'engines' });
  const after = getShip(result.game, 'axis-flagship');
  assert.equal(after.systems.engines, 0);
  assert.equal(after.crew, before.crew, 'leftover damage is lost, not spent on crew');
  assert.equal(after.systems.phasers, before.systems.phasers, 'leftover damage is lost, not spent at random');
});

test('a called volley into shields spends itself on the shields', () => {
  const game = withShips(precisionGame('called-shields'), (ship) => (ship.id === 'axis-flagship' ? { ...ship, shields: 100 } : ship));
  const result = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship', focus: 'engines' });
  const after = getShip(result.game, 'axis-flagship');
  // The surgical roll is 40% of 24-40, i.e. 10-16, and shields absorb all of it.
  assert.ok(after.shields >= 84 && after.shields <= 90, `shields took the whole volley: ${after.shields}`);
  assert.equal(after.systems.engines, 5, 'nothing reaches the internals through shields');
});

test('photons scatter and can never be called', () => {
  const game = precisionGame('photons-scatter');
  const plain = applyPlayerAction(game, { type: 'photons', targetId: 'axis-flagship' });
  const called = applyPlayerAction(game, { type: 'photons', targetId: 'axis-flagship', focus: 'engines' });
  assert.deepEqual(called.game, plain.game);
});

test('a throttled finishing blow captures instead of shattering', () => {
  const argo = getShip(createGame({ seed: 'finish' }), 'fed-flagship');
  // A hull worn to a skeleton crew, finished at 40% power: the overkill left in
  // such a volley can never reach the margin that tears a frame apart, so every
  // knockout it scores is a boardable prize.
  let vacant = 0;
  for (let step = 0; step < 400; step += 1) {
    const roll = weaponDamage('phasers', argo, createRng(`finish-roll-${step}`));
    const out = damageShip({ ...argo, shields: 0, crew: 4 }, Math.round(roll * 0.4), createRng(`finish-${step}`));
    assert.notEqual(out.status, 'destroyed', 'a throttled finish never tears the frame apart');
    if (out.crew === 0) {
      assert.equal(out.status, 'vacant');
      vacant += 1;
    }
  }
  assert.ok(vacant > 150, `a throttled finish should often leave a prize; got ${vacant}/400`);
});

test('a disabled hull strikes its colors at stardate end in a precision war', () => {
  const game = withShips(createGame({ seed: 'colors', precision: true }), gutted);
  const out = resolveDisabledSurrender(game);
  const after = getShip(out.game, 'axis-flagship');
  assert.equal(after.status, 'vacant');
  assert.equal(after.crew, 0, 'the crew takes to escape pods');
  assert.equal(out.events[0]?.kind, 'surrender');
  assert.match(out.messages.join(' '), /strikes its colors/);
});

test('a disabled hull fights on in a classic war', () => {
  const game = withShips(createGame({ seed: 'colors-classic' }), gutted);
  assert.deepEqual(resolveDisabledSurrender(game).game, game);
});

test('your command ship never surrenders the conn, until you resign', () => {
  const game = withShips(createGame({ seed: 'conn', precision: true }), (ship) => (ship.id === 'fed-flagship'
    ? { ...ship, shields: 0, systems: { ...ship.systems, engines: 0, phasers: 0, photons: 0 } }
    : ship));
  assert.deepEqual(resolveDisabledSurrender(game).game, game, 'the player decides when Captain Jason is done');
  const resigned = resolveDisabledSurrender({ ...game, resigned: true });
  assert.equal(getShip(resigned.game, 'fed-flagship').status, 'vacant');
});

test('a starbase with burnt-out guns is a fortress, not a derelict', () => {
  const game = withShips(createGame({ seed: 'base-fortress', precision: true }), (ship) => (ship.id === 'xanadu'
    ? { ...ship, systems: { ...ship.systems, phasers: 0, photons: 0 } }
    : ship));
  assert.deepEqual(resolveDisabledSurrender(game).game, game);
});

test('a hull that struck its colors is a prize your transporter can board', () => {
  const out = resolveDisabledSurrender(withShips(precisionGame('prize'), gutted));
  const commands = shipCommands(out.game, 'axis-flagship');
  assert.ok(commands.some((command) => command.type === 'transport' && /Board/.test(command.label)));
});

// --- Argonaut Reimagined, Phase 0: the mode flag and the wider battlefield ---

test('Reimagined is a war option that carries the extended layer, off by default', () => {
  const classic = createGame({ seed: 'reimagined-flag' });
  assert.equal(classic.reimagined, false);
  assert.equal(classic.gridSize, GRID_SIZE, 'a classic war keeps the calibrated 100-unit field');
  const reimagined = createGame({ seed: 'reimagined-flag', reimagined: true });
  assert.equal(reimagined.reimagined, true);
  assert.equal(reimagined.extended, true, 'Reimagined builds on the extended war');
  assert.equal(reimagined.gridSize, REIMAGINED_GRID_SIZE);
});

test('a Reimagined war opens wider, every hull in bounds, Xanadu at the center', () => {
  const game = createGame({ seed: 'reimagined-field', reimagined: true });
  const grid = game.gridSize;
  assert.ok(grid > GRID_SIZE, 'the Reimagined field is wider than the classic one');
  for (const ship of game.ships) {
    assert.ok(ship.x >= 0 && ship.x <= grid && ship.y >= 0 && ship.y <= grid,
      `${ship.name} at ${ship.x},${ship.y} sits outside the ${grid}-unit field`);
  }
  const center = Math.round((grid / GRID_SIZE) * 50);
  const xanadu = getShip(game, 'xanadu');
  assert.deepEqual({ x: xanadu.x, y: xanadu.y }, { x: center, y: center },
    'Xanadu anchors the center of the wider field');
});

test('the Reimagined scaffold leaves a classic or extended war untouched', () => {
  // The flag defaults off and the field stays 100 units, so the opening disposition
  // is byte-identical to a war created without the option at all.
  assert.deepEqual(createGame({ seed: 'parity' }), createGame({ seed: 'parity', reimagined: false }));
  assert.equal(createGame({ seed: 'parity', extended: true }).gridSize, GRID_SIZE);
  assert.equal(createGame({ seed: 'parity', extended: true }).reimagined, false);
});

test('a Reimagined war maneuvers past the classic 100-unit edge, but not off the field', () => {
  const setup = (x) => withShips(createGame({ seed: 'reimagined-move', reimagined: true }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x, y: 120 };
    if (ship.id === 'xanadu') return ship;
    return { ...ship, x: 5, y: 5 };
  });
  const past = applyPlayerAction(setup(100), { type: 'move', dx: 30, dy: 0 });
  assert.equal(getShip(past.game, 'fed-flagship').x, 130, 'a coordinate a classic war would refuse lands on the wider field');
  const offEdge = applyPlayerAction(setup(200), { type: 'move', dx: 50, dy: 0 });
  assert.match(offEdge.messages.join(' '), /leave the tactical map/i, 'movement still stops at the field edge');
});

test('engine reach scales with the field, so a wide war closes at the same pace', () => {
  const flagship = getShip(createGame({ seed: 'scale-move' }), 'fed-flagship');
  assert.equal(engineCapacity(flagship), 50, 'the calibrated reach on the classic 100-unit field');
  assert.equal(engineCapacity(flagship, REIMAGINED_GRID_SIZE), 120, 'the same hull crosses the 240-unit field in the same number of turns');
});

// --- Round 22b: the directed tractor beam (Reimagined) ---

const towGame = (seed, opts = {}) => withShips(createGame({ seed, ...opts }), (ship) => {
  if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 120 };
  if (ship.id === 'axis-flagship') return { ...ship, x: 70, y: 120 };
  return { ...ship, x: 5, y: 5 };
});

test('a directed tow hauls the target toward the named point, not the caster', () => {
  const game = towGame('directed-tow', { reimagined: true });
  // A battle cruiser's beam pulls 3 tractor units x 5 = 15.
  const standard = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship' });
  assert.equal(getShip(standard.game, 'axis-flagship').x, 55, 'a standard tow reels the target in toward the caster');

  const directed = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship', towardX: 70, towardY: 200 });
  const hauled = getShip(directed.game, 'axis-flagship');
  assert.equal(hauled.x, 70, 'aiming straight down the field leaves x alone');
  assert.equal(hauled.y, 135, 'the target is hauled 15 units toward the destination, away from the caster');
});

test('a directed tow can slam the target into another hull', () => {
  const game = withShips(createGame({ seed: 'tow-ram-directed', reimagined: true }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 120 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 70, y: 120 };
    if (ship.id === 'bloc-flagship') return { ...ship, x: 80, y: 120 };
    return { ...ship, x: 5, y: 5 };
  });
  const out = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship', towardX: 80, towardY: 120 });
  const victim = getShip(out.game, 'axis-flagship');
  const wall = getShip(out.game, 'bloc-flagship');
  assert.ok(victim.status === 'destroyed' || wall.status === 'destroyed',
    'hauling a hull onto another resolves a collision');
});

test('a directed tow clamps its destination to the field', () => {
  const game = withShips(createGame({ seed: 'tow-clamp', reimagined: true }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 120, y: 120 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 140, y: 120 };
    return { ...ship, x: 5, y: 5 };
  });
  const out = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship', towardX: 9999, towardY: 120 });
  const victim = getShip(out.game, 'axis-flagship');
  assert.equal(victim.x, 155, 'hauled 15 units toward the clamped far edge');
  assert.ok(victim.x <= REIMAGINED_GRID_SIZE);
});

test('a classic war ignores a directed tow and pulls toward the caster', () => {
  const setup = () => withShips(createGame({ seed: 'tow-classic' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 30, y: 50 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 50, y: 50 };
    return { ...ship, x: 5, y: 5 };
  });
  const plain = applyPlayerAction(setup(), { type: 'tractor', targetId: 'axis-flagship' });
  const directed = applyPlayerAction(setup(), { type: 'tractor', targetId: 'axis-flagship', towardX: 50, towardY: 90 });
  assert.deepEqual(directed.game, plain.game, 'without the Reimagined flag the destination is ignored');
  assert.equal(getShip(plain.game, 'axis-flagship').x, 35, 'the target still reels in toward the caster');
});

test('the ship menu offers a directed tow only in a Reimagined war', () => {
  const setup = (opts) => withShips(createGame({ seed: 'tow-cmd', ...opts }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 50, y: 50 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 60, y: 50 };
    return ship;
  });
  const reimagined = shipCommands(setup({ reimagined: true }), 'axis-flagship');
  assert.ok(reimagined.some((command) => command.type === 'tractor-direct'), 'a Reimagined war offers the directed tow');
  const classic = shipCommands(setup({}), 'axis-flagship');
  assert.ok(!classic.some((command) => command.type === 'tractor-direct'), 'a classic war does not');
  assert.ok(classic.some((command) => command.type === 'tractor'), 'the standard tractor beam is still offered');
});

// --- Round 14a: the reactor subsystem and power allocation (Reimagined) ---

test('a Reimagined hull carries a reactor; a classic or extended one does not', () => {
  const reim = getShip(createGame({ seed: 'reactor', reimagined: true }), 'fed-flagship');
  assert.equal(reim.systems.reactor, POWER.reactor['Battle cruiser']);
  assert.equal('reactor' in getShip(createGame({ seed: 'reactor' }), 'fed-flagship').systems, false,
    'a classic hull has no reactor, so its damage lottery is unchanged');
  assert.equal('reactor' in getShip(createGame({ seed: 'reactor', extended: true }), 'fed-flagship').systems, false);
});

test('the dockyard complement includes the reactor only for a Reimagined hull', () => {
  assert.equal(templateSystems(getShip(createGame({ seed: 'tmpl', reimagined: true }), 'fed-flagship')).reactor,
    POWER.reactor['Battle cruiser']);
  assert.equal('reactor' in templateSystems(getShip(createGame({ seed: 'tmpl' }), 'fed-flagship')), false);
});

test('reactor output shrinks as the reactor takes damage', () => {
  const ship = getShip(createGame({ seed: 'reactor-out', reimagined: true }), 'fed-flagship');
  assert.equal(reactorOutput(ship), ship.systems.reactor * POWER.perUnit);
  assert.equal(reactorOutput({ ...ship, systems: { ...ship.systems, reactor: 1 } }), POWER.perUnit);
  assert.equal(reactorOutput({ ...ship, systems: { ...ship.systems, reactor: 0 } }), 0);
});

test('the default allocation runs every sink at calibrated 1.0x', () => {
  const game = createGame({ seed: 'power-default', reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  for (const sink of POWER_SINKS) {
    assert.equal(powerEffect(game, ship, sink), 1, `${sink} runs at 1.0x by default`);
  }
});

test('power effect is always 1 outside a Reimagined war', () => {
  const game = createGame({ seed: 'power-classic' });
  const ship = getShip(game, 'fed-flagship');
  assert.equal(powerEffect(game, ship, 'weapons'), 1);
  assert.equal(powerEffect(game, ship, 'shields'), 1);
});

test('overcharging one sink starves another', () => {
  const game = createGame({ seed: 'power-trade', reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  const alloc = clampPowerAllocation({ weapons: 99 }, ship);
  const armed = { ...game, power: { ...game.power, [ship.id]: alloc } };
  assert.ok(powerEffect(armed, ship, 'weapons') > 1, 'weapons overcharge past 1.0x');
  assert.ok(powerEffect(armed, ship, 'weapons') <= POWER.overcharge, 'but saturate at the overcharge cap');
  assert.equal(powerEffect(armed, ship, 'engines'), 0, 'engines are starved to nothing');
});

test('clampPowerAllocation never exceeds the reactor budget', () => {
  const ship = getShip(createGame({ seed: 'power-clamp', reimagined: true }), 'fed-flagship');
  const alloc = clampPowerAllocation({ shields: 50, weapons: 50, engines: 50, sensors: 50, tractor: 50 }, ship);
  const total = POWER_SINKS.reduce((sum, sink) => sum + alloc[sink], 0);
  assert.equal(total, reactorOutput(ship));
});

test('setting power is free, persists, and is Reimagined-only', () => {
  const game = createGame({ seed: 'set-power', reimagined: true });
  const out = applyPlayerAction(game, { type: 'power', allocation: { shields: 2, weapons: 9, engines: 4, sensors: 4, tractor: 2 } });
  assert.equal(out.game.turn, game.turn, 'setting power costs no stardate');
  assert.equal(out.game.phase, 'player', 'and does not end the turn');
  assert.equal(powerAllocation(out.game, getShip(out.game, 'fed-flagship')).weapons, 9);
  assert.match(out.messages.join(' '), /sets power/);

  const classic = applyPlayerAction(createGame({ seed: 'set-power-classic' }), { type: 'power', allocation: { weapons: 9 } });
  assert.match(classic.messages.join(' '), /Reimagined/i);
  assert.deepEqual(classic.game, createGame({ seed: 'set-power-classic' }), 'a classic war ignores it');
});

test('the reactor regenerates shields each stardate, scaled by the shield sink', () => {
  const game = withShips(createGame({ seed: 'regen', reimagined: true }), (ship) => (ship.id === 'fed-flagship' ? { ...ship, shields: 100 } : ship));
  const out = resolvePowerRegen(game);
  // Capacity 200, rate 0.02, default shields effectiveness 1.0 -> floor(200 * 0.02) = 4.
  assert.equal(getShip(out.game, 'fed-flagship').shields, 104);
  assert.match(out.messages.join(' '), /restores 4 shield power/);
});

test('a starved shield sink or a dead reactor regenerates nothing', () => {
  const base = withShips(createGame({ seed: 'regen-off', reimagined: true }), (ship) => (ship.id === 'fed-flagship' ? { ...ship, shields: 100 } : ship));
  const starved = { ...base, power: { ...base.power, 'fed-flagship': { shields: 0, weapons: 6, engines: 4, sensors: 4, tractor: 2 } } };
  assert.equal(getShip(resolvePowerRegen(starved).game, 'fed-flagship').shields, 100);
  const dead = withShips(base, (ship) => (ship.id === 'fed-flagship' ? { ...ship, systems: { ...ship.systems, reactor: 0 } } : ship));
  assert.equal(getShip(resolvePowerRegen(dead).game, 'fed-flagship').shields, 100);
});

test('power regeneration is inert in a classic war', () => {
  const game = withShips(createGame({ seed: 'regen-classic' }), (ship) => (ship.id === 'fed-flagship' ? { ...ship, shields: 50 } : ship));
  assert.deepEqual(resolvePowerRegen(game).game, game);
});

// --- Round 14b: the weapons / engines / sensors / tractor sinks (Reimagined) ---

/** A Reimagined game with the flagship's power set to a given allocation. */
const powered = (seed, allocation) => {
  const game = createGame({ seed, reimagined: true });
  return { ...game, power: { ...game.power, 'fed-flagship': allocation } };
};

test('routing power into the guns hardens a volley', () => {
  const ship = getShip(createGame({ seed: 'sink-weapons', reimagined: true }), 'fed-flagship');
  const plain = createGame({ seed: 'sink-weapons', reimagined: true });
  const baseline = weaponDamage('phasers', ship, createRng('w'), 0, powerEffect(plain, ship, 'weapons'));
  const armed = powered('sink-weapons', { shields: 0, weapons: 9, engines: 0, sensors: 0, tractor: 0 });
  const boosted = weaponDamage('phasers', ship, createRng('w'), 0, powerEffect(armed, ship, 'weapons'));
  assert.ok(boosted > baseline, `overcharged guns roll more (${boosted} > ${baseline})`);
  assert.ok(powerEffect(armed, ship, 'weapons') <= POWER.overcharge, 'and saturate at the overcharge cap');
});

test('starving the guns softens a volley', () => {
  const ship = getShip(createGame({ seed: 'sink-weapons-low', reimagined: true }), 'fed-flagship');
  const plain = createGame({ seed: 'sink-weapons-low', reimagined: true });
  const baseline = weaponDamage('phasers', ship, createRng('w'), 0, powerEffect(plain, ship, 'weapons'));
  const starved = powered('sink-weapons-low', { shields: 6, weapons: 2, engines: 4, sensors: 4, tractor: 2 });
  const weakened = weaponDamage('phasers', ship, createRng('w'), 0, powerEffect(starved, ship, 'weapons'));
  assert.ok(weakened < baseline, `a starved gun rolls less (${weakened} < ${baseline})`);
});

test('routing power into engines extends reach; starving it shrinks reach', () => {
  const game = createGame({ seed: 'sink-engines', reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  const baseline = engineCapacity(ship, game.gridSize, powerEffect(game, ship, 'engines'));
  const armed = powered('sink-engines', { shields: 0, weapons: 0, engines: 12, sensors: 0, tractor: 0 });
  const boosted = engineCapacity(ship, armed.gridSize, powerEffect(armed, ship, 'engines'));
  const starved = powered('sink-engines', { shields: 6, weapons: 6, engines: 1, sensors: 4, tractor: 2 });
  const weakened = engineCapacity(ship, starved.gridSize, powerEffect(starved, ship, 'engines'));
  assert.ok(boosted > baseline, 'overcharged engines reach farther');
  assert.ok(weakened < baseline, 'starved engines reach less');
});

test('routing power into sensors extends scanner reach', () => {
  const game = createGame({ seed: 'sink-sensors', reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  const baseline = sensorRange(game, ship, 'scanner');
  const armed = powered('sink-sensors', { shields: 0, weapons: 0, engines: 0, sensors: 6, tractor: 0 });
  assert.ok(sensorRange(armed, ship, 'scanner') > baseline, 'more sensor power sees farther');
  assert.equal(baseline, 40, 'a battle cruiser scanner (4 units x 10) at the default 1.0x');
});

test('routing power into the tractor beam pulls harder', () => {
  const game = createGame({ seed: 'sink-tractor', reimagined: true });
  const ship = getShip(game, 'fed-flagship');
  const target = { ...getShip(game, 'axis-flagship'), x: ship.x + 20, y: ship.y };
  const baseline = tractorLock(ship, target, game.gridSize).pull;
  const armed = powered('sink-tractor', { shields: 0, weapons: 0, engines: 0, sensors: 0, tractor: 3 });
  const boosted = tractorLock(ship, target, armed.gridSize, null, powerEffect(armed, ship, 'tractor')).pull;
  assert.ok(boosted > baseline, `overcharged beam pulls harder (${boosted} > ${baseline})`);
});

test('the power sinks never change a classic war', () => {
  const game = createGame({ seed: 'sink-classic' });
  const ship = getShip(game, 'fed-flagship');
  assert.equal(sensorRange(game, ship, 'scanner'), 40, 'scanner reach is the calibrated 4 x 10');
  assert.equal(engineCapacity(ship, game.gridSize, powerEffect(game, ship, 'engines')), 50, 'engine reach is the calibrated 5 x 10');
  assert.equal(weaponDamage('phasers', ship, createRng('w'), 0, powerEffect(game, ship, 'weapons')),
    weaponDamage('phasers', ship, createRng('w')), 'a classic volley is untouched by the weapons sink');
});

// --- Round 14c: the console power bar's sink nudges ---

test('a power nudge adjusts one sink without touching the others, for free', () => {
  const game = createGame({ seed: 'nudge', reimagined: true });
  const out = applyPlayerAction(game, { type: 'power', sink: 'weapons', delta: 1 });
  const alloc = powerAllocation(out.game, getShip(out.game, 'fed-flagship'));
  assert.equal(alloc.weapons, POWER.need.weapons + 1, 'weapons goes up by one');
  assert.equal(alloc.shields, POWER.need.shields, 'the other sinks are untouched');
  assert.equal(out.game.turn, game.turn, 'a nudge costs no stardate');
  assert.equal(out.game.phase, 'player');
});

test('a power nudge down never goes below zero', () => {
  const game = createGame({ seed: 'nudge-down', reimagined: true });
  const drained = applyPlayerAction(game, { type: 'power', allocation: { shields: 4, weapons: 6, engines: 4, sensors: 4, tractor: 0 } });
  const out = applyPlayerAction(drained.game, { type: 'power', sink: 'tractor', delta: -1 });
  assert.equal(powerAllocation(out.game, getShip(out.game, 'fed-flagship')).tractor, 0);
});

test('a nudge past the reactor budget is refused, not stolen from another sink', () => {
  // A scout's reactor is 4 units x 5 = 20 budget; the default profile spends exactly 20.
  const game = { ...createGame({ seed: 'nudge-cap', reimagined: true }), playerShipId: 'fed-scout' };
  const out = applyPlayerAction(game, { type: 'power', sink: 'weapons', delta: 1 });
  assert.match(out.messages.join(' '), /cannot spare the power/i);
  assert.deepEqual(out.game, game, 'a refused nudge changes nothing');
});

test('an unknown sink is refused', () => {
  const game = createGame({ seed: 'nudge-bad', reimagined: true });
  const out = applyPlayerAction(game, { type: 'power', sink: 'warp', delta: 1 });
  assert.match(out.messages.join(' '), /specify a power allocation/i);
  assert.deepEqual(out.game, game);
});

// --- Round 14d: AI doctrine power profiles, reactor refit, dockyard reactor repair ---

test('an AI hull runs its alliance doctrine power profile (Reimagined)', () => {
  const game = createGame({ seed: 'ai-power', reimagined: true });
  const axis = getShip(game, 'axis-flagship');
  assert.ok(powerEffect(game, axis, 'weapons') > 1, 'Axis overcharges its guns');
  assert.ok(powerEffect(game, axis, 'shields') < 1, 'and starves its shields to do it');
  assert.ok(powerEffect(game, getShip(game, 'cabal-flagship'), 'tractor') > 1, 'Cabal overcharges the tractor beam');
  assert.equal(powerEffect(game, getShip(game, 'bloc-flagship'), 'tractor'), 0, 'Bloc never tractors');
});

test("the player's command ship runs the flat default, not a doctrine profile", () => {
  const game = createGame({ seed: 'cmd-power', reimagined: true });
  for (const sink of POWER_SINKS) assert.equal(powerEffect(game, getShip(game, game.playerShipId), sink), 1);
  // A Federation hull the player does not command runs the Federation profile, which leans on shields.
  assert.ok(powerEffect(game, getShip(game, 'fed-cruiser-1'), 'shields') > 1);
});

test('doctrine power profiles never touch a classic or extended war', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = createGame({ seed: 'profile-parity', ...opts });
    assert.equal(powerEffect(game, getShip(game, 'axis-flagship'), 'weapons'), 1,
      'a non-Reimagined enemy runs at calibrated 1.0x');
  }
});

test('a docked hull may take a reactor upgrade in a Reimagined war', () => {
  const game = withShips(createGame({ seed: 'reactor-refit', reimagined: true }), (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 124, y: 120 } : ship));
  const before = getShip(game, 'fed-cruiser-1').systems.reactor;
  const out = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'reactor' });
  assert.equal(getShip(out.game, 'fed-cruiser-1').systems.reactor, before + 1, 'the upgrade adds a reactor unit');
  assert.match(out.messages.join(' '), /refitted/);
});

test('a reactor upgrade is refused outside a Reimagined war', () => {
  const game = withShips(createGame({ seed: 'reactor-refit-ext', extended: true }), (ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 54, y: 50 } : ship));
  const out = applyPlayerAction(game, { type: 'refit', shipId: 'fed-cruiser-1', kind: 'reactor' });
  assert.match(out.messages.join(' '), /Reimagined/i);
  assert.deepEqual(out.game, game);
});

test('the dockyard repairs a damaged reactor (Reimagined)', () => {
  const game = withShips(createGame({ seed: 'reactor-repair', reimagined: true }), (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 124, y: 120, systems: { ...ship.systems, reactor: 1 } }
    : ship));
  const repaired = getShip(resolveDocking(game).game, 'fed-cruiser-1');
  assert.equal(repaired.systems.reactor, 2, 'the most-damaged subsystem — the reactor — gains a unit');
});

// --- Round 15a: the terrain data layer (Reimagined) ---

const TERRAIN_SEEDS = ['terrain-a', 'terrain-b', 'xanadu', 'reimagined-field'];

test('a Reimagined war seeds six hazards and two relay nodes', () => {
  for (const seed of TERRAIN_SEEDS) {
    const terrain = createGame({ seed, reimagined: true }).terrain;
    assert.equal(terrain.length, 6 + TERRAIN.relayCount, `seed ${seed} places every feature`);
    for (const [type, count] of Object.entries(TERRAIN.counts)) {
      assert.equal(terrain.filter((feature) => feature.type === type).length, count, `seed ${seed} places ${count} ${type}`);
    }
    assert.equal(terrain.filter((feature) => feature.type === 'relay').length, TERRAIN.relayCount,
      `seed ${seed} places the ${TERRAIN.relayCount} capturable relay nodes`);
    const ids = new Set(terrain.map((feature) => feature.id));
    assert.equal(ids.size, terrain.length, 'every feature has a unique id');
  }
});

test('terrain placement is deterministic on its own seeded stream', () => {
  for (const seed of TERRAIN_SEEDS) {
    const first = createGame({ seed, reimagined: true });
    const second = createGame({ seed, reimagined: true });
    assert.deepEqual(first.terrain, second.terrain, 'the same seed charts the same battlefield');
    assert.notDeepEqual(first.terrain, createGame({ seed: `${seed}-other`, reimagined: true }).terrain,
      'a different seed charts a different one');
  }
  // The terrain stream is separate from the war's RNG: an option that changes how
  // many draws the fleets consume leaves the charted battlefield untouched.
  const plain = createGame({ seed: 'terrain-stream', reimagined: true });
  const regional = createGame({ seed: 'terrain-stream', reimagined: true, regional: true });
  assert.deepEqual(plain.terrain, regional.terrain, 'terrain never reads the war stream');
  assert.notDeepEqual(plain.ships, regional.ships, 'while fleet placement does');
});

test('every feature is in bounds, sized in its range, and clear of Xanadu', () => {
  for (const seed of TERRAIN_SEEDS) {
    const game = createGame({ seed, reimagined: true });
    const grid = game.gridSize;
    const xanadu = getShip(game, 'xanadu');
    for (const feature of game.terrain) {
      if (feature.type === 'relay') {
        assert.equal(feature.radius, TERRAIN.relayRadius, `${feature.id} is a fixed-size node`);
      } else {
        const [minRadius, maxRadius] = TERRAIN.radius[feature.type];
        assert.ok(feature.radius >= minRadius && feature.radius <= maxRadius,
          `${feature.id} radius ${feature.radius} sits in [${minRadius}, ${maxRadius}]`);
      }
      assert.ok(feature.x >= TERRAIN.edgeMargin && feature.x <= grid - TERRAIN.edgeMargin,
        `${feature.id} center x is inside the edge margin`);
      assert.ok(feature.y >= TERRAIN.edgeMargin && feature.y <= grid - TERRAIN.edgeMargin,
        `${feature.id} center y is inside the edge margin`);
      assert.ok(distance(feature, xanadu) >= feature.radius + TERRAIN.xanaduClearance,
        `${feature.id} keeps its edge clear of the dockyard`);
      assert.ok(!insideFeature(game, xanadu), 'Xanadu is never buried in a hazard');
    }
    for (const [i, a] of game.terrain.entries()) {
      for (const b of game.terrain.slice(i + 1)) {
        assert.ok(distance(a, b) >= TERRAIN.minSeparation,
          `${a.id} and ${b.id} keep the minimum center separation`);
      }
    }
  }
});

test('a classic or extended war carries no terrain, and the parity scaffold holds', () => {
  assert.deepEqual(createGame({ seed: 'terrain-classic' }).terrain, []);
  assert.deepEqual(createGame({ seed: 'terrain-extended', extended: true }).terrain, []);
  // The standing parity guard: the terrain layer changes nothing a classic war reads.
  assert.deepEqual(createGame({ seed: 'terrain-parity' }), createGame({ seed: 'terrain-parity', reimagined: false }));
});

test('insideFeature and terrainAt answer the point-in-feature test', () => {
  const game = {
    ...createGame({ seed: 'terrain-helpers', reimagined: true }),
    terrain: [
      { id: 'nebula-1', type: 'nebula', x: 80, y: 80, radius: 30 },
      { id: 'ion-storm-1', type: 'ion-storm', x: 160, y: 160, radius: 20 },
    ],
  };
  assert.equal(insideFeature(game, { x: 80, y: 80 }), true, 'the center is inside');
  assert.equal(insideFeature(game, { x: 100, y: 80 }), true, 'so is a point within the radius');
  assert.equal(insideFeature(game, { x: 111, y: 80 }), false, 'and a point beyond it is outside');
  assert.equal(insideFeature(game, { x: 100, y: 80 }, 'nebula'), true, 'the type filter matches');
  assert.equal(insideFeature(game, { x: 100, y: 80 }, 'ion-storm'), false, 'and rejects the wrong type');
  assert.equal(terrainAt(game, { x: 160, y: 175 })?.id, 'ion-storm-1');
  assert.equal(terrainAt(game, { x: 10, y: 10 }), null, 'open space belongs to no feature');
});

test('terrain helpers tolerate a classic war and an old save with no terrain field', () => {
  const classic = createGame({ seed: 'terrain-helpers-classic' });
  assert.equal(insideFeature(classic, { x: 50, y: 50 }), false);
  assert.equal(terrainAt(classic, { x: 50, y: 50 }), null);
  const oldSave = { ...createGame({ seed: 'terrain-old-save', reimagined: true }) };
  delete oldSave.terrain;
  assert.equal(insideFeature(oldSave, { x: 50, y: 50 }), false, 'a save predating terrain reads as empty');
  assert.equal(terrainAt(oldSave, { x: 50, y: 50 }), null);
});

// --- Round 15b: nebula sensor denial (Reimagined) ---

/**
 * A Reimagined war with one hand-placed nebula at the field center. The Axis
 * flagship lurks at its heart; the Federation flagship watches from 40 away —
 * well inside its 60-unit mapper, so only the nebula rule can hide the lurker.
 * Every other hull (Xanadu included) is parked far away so no report, and no
 * Xanadu radio relay, interferes with the assertions.
 */
const nebulaGame = (seed = 'nebula') => {
  const base = createGame({ seed, reimagined: true });
  return {
    ...base,
    terrain: [{ id: 'nebula-1', type: 'nebula', x: 120, y: 120, radius: 30 }],
    ships: base.ships.map((ship) => {
      if (ship.id === 'axis-flagship') return { ...ship, x: 120, y: 120 };
      if (ship.id === 'fed-flagship') return { ...ship, x: 80, y: 120 };
      return { ...ship, x: 230, y: 20 };
    }),
  };
};

test('a hull inside a nebula is hidden from an outside observer the mapper would otherwise reach', () => {
  const game = nebulaGame('nebula-hidden');
  const actor = getShip(game, 'fed-flagship');
  const lurker = getShip(game, 'axis-flagship');
  assert.ok(distance(actor, lurker) <= sensorRange(game, actor, 'mapper'), 'plain fog of war would see it');
  assert.equal(nebulaHides(game, actor, lurker), true);
  const out = applyPlayerAction(game, { type: 'scan', targetId: 'axis-flagship' });
  assert.match(out.messages.join(' '), /lost in the static of a nebula/);
  assert.equal(out.game.scanned?.['axis-flagship'], undefined, 'a refused scan reveals no captain');
});

test('hulls sharing a nebula see each other normally', () => {
  const base = nebulaGame('nebula-inside');
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 110, y: 110 } : ship)) };
  const actor = getShip(game, 'fed-flagship');
  assert.equal(nebulaHides(game, actor, getShip(game, 'axis-flagship')), false, 'inside the same nebula, nothing is hidden');
  const out = applyPlayerAction(game, { type: 'scan', targetId: 'axis-flagship' });
  assert.match(out.messages.join(' '), /Scan of Firebreather complete/);
  assert.equal(out.game.scanned?.['axis-flagship'], true);
});

test('overcharged sensors pierce further into a nebula', () => {
  const base = nebulaGame('nebula-pierce');
  const game = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'axis-flagship') return { ...ship, x: 145, y: 120 }; // near the nebula's edge
      if (ship.id === 'fed-flagship') return { ...ship, x: 156, y: 120 }; // outside it, 11 away
      return ship;
    }),
  };
  assert.equal(nebulaRevealRange(game, getShip(game, 'fed-flagship')), TERRAIN.nebulaRevealRange, 'the base reveal at 1.0x sensors');
  assert.equal(nebulaHides(game, getShip(game, 'fed-flagship'), getShip(game, 'axis-flagship')), true,
    '11 units is beyond the base reveal of 8');
  // A battle cruiser's reactor budget is 25; this allocation spends 22 of it and
  // drives the sensors sink to its 1.5x saturation, revealing 12 units deep.
  const hot = { ...game, power: { ...game.power, 'fed-flagship': { shields: 4, weapons: 6, engines: 4, sensors: 6, tractor: 2 } } };
  assert.equal(powerEffect(hot, getShip(hot, 'fed-flagship'), 'sensors'), 1.5);
  assert.equal(nebulaRevealRange(hot, getShip(hot, 'fed-flagship')), TERRAIN.nebulaRevealRange * 1.5);
  assert.equal(nebulaHides(hot, getShip(hot, 'fed-flagship'), getShip(hot, 'axis-flagship')), false,
    'the overcharged sensors reach the lurker');
});

test('the computer, map, and radio reports all honor the nebula', () => {
  const game = nebulaGame('nebula-reports');
  const computer = applyPlayerAction(game, { type: 'computer' });
  assert.ok(!computer.report.lines.join(' ').includes('Firebreather'), 'the lurker is not on the mapper');
  assert.match(computer.report.lines.join(' '), /Nearest enemy: none within mapper range/);
  const map = applyPlayerAction(game, { type: 'map' });
  assert.ok(!map.report.lines.some((line) => /Firebreather/.test(line)), 'the local map stays silent too');
  // An allied hull camping in the same nebula does not answer the radio either.
  const camper = {
    ...game,
    ships: game.ships.map((ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 118, y: 120 } : ship)),
  };
  assert.equal(inRadioContact(camper, getShip(camper, 'fed-flagship'), getShip(camper, 'fed-cruiser-1')), false,
    'radio into a nebula degrades to the reveal range');
  const radio = applyPlayerAction(camper, { type: 'radio' });
  assert.match(radio.report.lines.join(' '), /No allied stations answer within radio range/);
});

test('radio reaches a nebula-docked hull from just outside, within the reveal range', () => {
  const base = nebulaGame('nebula-radio-edge');
  const game = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 146, y: 120 }; // inside, near the edge
      if (ship.id === 'fed-flagship') return { ...ship, x: 153, y: 120 };  // outside, 7 away
      return ship;
    }),
  };
  assert.equal(inRadioContact(game, getShip(game, 'fed-flagship'), getShip(game, 'fed-cruiser-1')), true,
    '7 units is inside the base reveal of 8');
});

test('the nebula rule never touches a classic or extended war', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = createGame({ seed: 'nebula-parity', ...opts });
    assert.deepEqual(game.terrain, []);
    const actor = getShip(game, 'fed-flagship');
    assert.equal(nebulaHides(game, actor, getShip(game, 'axis-flagship')), false, 'no terrain, nothing hidden');
    assert.equal(nebulaRevealRange(game, actor), TERRAIN.nebulaRevealRange, 'reveal stays at the 1.0x base without power management');
  }
});

// --- Round 15c: asteroid cover + collision (Reimagined) ---

/**
 * A Reimagined war with one hand-placed asteroid field at (90,120), radius 20.
 * The Federation flagship sits at (60,120) and the Axis flagship at (120,120), so
 * the straight shot line between them runs through the rocks. Every other hull is
 * parked far away.
 */
const fieldGame = (seed = 'asteroids') => {
  const base = createGame({ seed, reimagined: true });
  return {
    ...base,
    terrain: [{ id: 'asteroids-1', type: 'asteroids', x: 90, y: 120, radius: 20 }],
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 60, y: 120 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 120, y: 120 };
      return { ...ship, x: 230, y: 20 };
    }),
  };
};

test('segmentCrossesFeature sees a shot line through a field, and not one around it', () => {
  const game = fieldGame('asteroid-segment');
  assert.equal(segmentCrossesFeature(game, { x: 60, y: 120 }, { x: 120, y: 120 }, 'asteroids'), true,
    'the straight line runs through the rocks');
  assert.equal(segmentCrossesFeature(game, { x: 10, y: 10 }, { x: 200, y: 10 }, 'asteroids'), false,
    'a wide line passes outside the field');
  assert.equal(segmentCrossesFeature(game, { x: 90, y: 120 }, { x: 200, y: 200 }, 'asteroids'), true,
    'an endpoint inside the field counts as crossing it');
  assert.equal(segmentCrossesFeature(game, { x: 60, y: 120 }, { x: 120, y: 120 }, 'nebula'), false,
    'the type filter rejects the wrong feature');
  const classic = createGame({ seed: 'asteroid-segment-classic' });
  assert.equal(segmentCrossesFeature(classic, { x: 60, y: 120 }, { x: 120, y: 120 }, 'asteroids'), false,
    'a classic war has no terrain to cross');
});

test('a volley fired through asteroids misses far more often, and says so', () => {
  const base = fieldGame('asteroid-cover');
  // Park the gunnery pair exactly at phaser range (30) with the rocks between them.
  const covered = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 75, y: 120 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 105, y: 120 };
      return ship;
    }),
  };
  const open = { ...covered, terrain: [] };
  const missCount = (game, samples = 400) => {
    let misses = 0;
    for (let step = 0; step < samples; step += 1) {
      const out = applyPlayerAction({ ...game, randomStep: step }, { type: 'phasers', targetId: 'axis-flagship' });
      if (/Missed!/.test(out.messages.join(' '))) misses += 1;
    }
    return misses;
  };
  const openMisses = missCount(open);
  const coveredMisses = missCount(covered);
  assert.ok(coveredMisses > openMisses * 1.8,
    `cover roughly triples the miss rate (open ${openMisses}/400, covered ${coveredMisses}/400)`);
  // The first covered miss carries the splash flavor.
  for (let step = 0; step < 400; step += 1) {
    const out = applyPlayerAction({ ...covered, randomStep: step }, { type: 'phasers', targetId: 'axis-flagship' });
    const text = out.messages.join(' ');
    if (/Missed!/.test(text)) {
      assert.match(text, /splashes into asteroids/);
      break;
    }
  }
});

test('ending a move inside an asteroid field rolls a seeded rock strike, in band', () => {
  const game = fieldGame('asteroid-strike');
  let strikes = 0;
  let minDamage = Infinity;
  let maxDamage = 0;
  for (let step = 0; step < 200; step += 1) {
    // Park at the field's heart: (60,120) + 30 → (90,120).
    const out = applyPlayerAction({ ...game, randomStep: step }, { type: 'move', dx: 30, dy: 0 });
    assert.equal(getShip(out.game, 'fed-flagship').x, 90);
    const line = out.messages.find((message) => /Asteroid strike/.test(message));
    if (line) {
      strikes += 1;
      const damage = 200 - getShip(out.game, 'fed-flagship').shields;
      minDamage = Math.min(minDamage, damage);
      maxDamage = Math.max(maxDamage, damage);
    }
  }
  assert.ok(strikes > 0 && strikes < 200, 'the strike is a seeded chance, not a certainty');
  assert.ok(strikes / 200 > 0.2 && strikes / 200 < 0.5, `about 35% of parking moves strike (got ${strikes}/200)`);
  assert.ok(minDamage >= TERRAIN.asteroidStrike.min, `the lightest strike is at least ${TERRAIN.asteroidStrike.min} (got ${minDamage})`);
  assert.ok(maxDamage <= TERRAIN.asteroidStrike.max, `the heaviest strike is at most ${TERRAIN.asteroidStrike.max} (got ${maxDamage})`);
});

test('a move that merely crosses the field is safe — only ending inside strikes', () => {
  const base = fieldGame('asteroid-passthrough');
  // Move the Axis flagship out of the landing spot so the move resolves cleanly.
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'axis-flagship' ? { ...ship, x: 200, y: 120 } : ship)) };
  for (let step = 0; step < 100; step += 1) {
    // (60,120) + 60 → (120,120): the path runs through the field, the endpoint does not.
    const out = applyPlayerAction({ ...game, randomStep: step }, { type: 'move', dx: 60, dy: 0 });
    assert.ok(!out.messages.some((message) => /Asteroid strike/.test(message)),
      'passing through at speed never draws a strike');
  }
});

test('a directed tow dumps the victim into the rocks, and the strike does the work', () => {
  const base = fieldGame('asteroid-tow');
  // Victim just outside the field's near edge; the flagship tows it toward the heart.
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'axis-flagship' ? { ...ship, x: 65, y: 120 } : ship)) };
  let strikes = 0;
  for (let step = 0; step < 200; step += 1) {
    const out = applyPlayerAction({ ...game, randomStep: step }, { type: 'tractor', targetId: 'axis-flagship', towardX: 90, towardY: 120 });
    const victim = getShip(out.game, 'axis-flagship');
    assert.equal(victim.x, 80, 'a 15-unit pull from (65,120) toward (90,120) lands inside the field');
    if (out.messages.some((message) => /Asteroid strike: rocks rake Firebreather/.test(message))) {
      strikes += 1;
      assert.ok(victim.shields < 200, 'the strike burns shield power');
      assert.ok(victim.shields >= 200 - TERRAIN.asteroidStrike.max, 'and never exceeds the band');
    }
  }
  assert.ok(strikes > 35 && strikes < 115, `about a third of the dumps strike (got ${strikes}/200)`);
});

test('the rock strike reads the hull as it stands after the tow resolves', () => {
  const game = fieldGame('asteroid-strike-direct');
  const inside = { ...game, ships: game.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 90, y: 120 } : ship)) };
  const hull = getShip(inside, 'fed-flagship');
  const out = resolveAsteroidStrike(inside, hull);
  assert.ok(out.messages.length <= 1);
  if (out.messages.length === 1) {
    assert.match(out.messages[0], /Asteroid strike/);
    assert.equal(out.events[0].kind, 'explosion', 'the strike draws as an impact burst');
    assert.equal(out.events[0].x2, 90);
  }
  // A hull outside the field is untouched — and consumes no seeded roll.
  const outside = resolveAsteroidStrike(inside, getShip(inside, 'axis-flagship'));
  assert.equal(outside.game, inside, 'the game is returned as-is');
  assert.deepEqual(outside.messages, []);
  assert.deepEqual(outside.events, []);
});

test('rock strikes never touch a classic or extended war, nor its seeded sequence', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = createGame({ seed: 'asteroid-parity', ...opts });
    const out = resolveAsteroidStrike(game, getShip(game, 'fed-flagship'));
    assert.equal(out.game, game, 'no terrain, no strike, no state change');
    assert.deepEqual(out.messages, []);
    // A classic move consumes no extra random step, so the war's seeded sequence
    // — and every calibrated figure downstream of it — is unchanged.
    const moved = applyPlayerAction(game, { type: 'move', dx: 1, dy: 0 });
    assert.equal(moved.game.randomStep, game.randomStep, 'the strike check consumed no roll');
  }
});

// --- Round 15d: the ion-storm jam (Reimagined) ---

/**
 * A Reimagined war with one hand-placed ion storm at (120,120), radius 30 — a
 * full-jam core out to 18 units and a degraded ring from there to 30. The Axis
 * flagship sits at the storm's heart; the Federation flagship watches from
 * (80,120), clear of the weather. Every other hull — Xanadu included, so no radio
 * relay interferes — is parked far away.
 */
const stormGame = (seed = 'ion-storm') => {
  const base = createGame({ seed, reimagined: true });
  return {
    ...base,
    terrain: [{ id: 'ion-storm-1', type: 'ion-storm', x: 120, y: 120, radius: 30 }],
    ships: base.ships.map((ship) => {
      if (ship.id === 'axis-flagship') return { ...ship, x: 120, y: 120 };
      if (ship.id === 'fed-flagship') return { ...ship, x: 80, y: 120 };
      return { ...ship, x: 230, y: 20 };
    }),
  };
};

test('the storm has a full-jam core and a degraded ring', () => {
  const game = stormGame('storm-zones');
  assert.equal(ionStormZone(game, { x: 120, y: 120 }), 'core');
  assert.equal(ionStormZone(game, { x: 135, y: 120 }), 'core', '15 units is inside the 0.6 x 30 core');
  assert.equal(ionStormZone(game, { x: 145, y: 120 }), 'ring', '25 units is past the core but inside the storm');
  assert.equal(ionStormZone(game, { x: 160, y: 120 }), null, '40 units is open space');
  const classic = createGame({ seed: 'storm-zones-classic' });
  assert.equal(ionStormZone(classic, { x: 50, y: 50 }), null, 'a classic war has no weather');
});

test('weapons and radio are offline in the storm core, and the menu says so by omission', () => {
  const base = stormGame('storm-core');
  // Park the command ship in the storm's heart, an enemy 5 away — well inside phaser range.
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 120, y: 125 } : ship)) };
  const guns = applyPlayerAction(game, { type: 'phasers', targetId: 'axis-flagship' });
  assert.match(guns.messages.join(' '), /weapons are offline in the ion storm/);
  assert.equal(guns.game.phase, 'player', 'the refusal does not spend the stardate');
  assert.equal(getShip(guns.game, 'fed-flagship').shotsFired, 0, 'and no volley is loosed');
  const radio = applyPlayerAction(game, { type: 'radio' });
  assert.match(radio.messages.join(' '), /radio is offline in the ion storm/);
  const commands = shipCommands(game, 'axis-flagship');
  assert.ok(!commands.some((command) => ['phasers', 'photons'].includes(command.type)),
    'a jammed command ship is never offered a volley it cannot fire');
  assert.ok(commands.some((command) => command.type === 'tractor'), 'the tractor works throughout the storm');
});

test('a jammed autopilot never picks a volley, though the same captain shoots in open space', () => {
  const base = stormGame('storm-ai');
  // Both flagships inside the core, 10 apart: photon range for the Axis guns.
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 110, y: 120 } : ship)) };
  const jammed = chooseAiAction(game, 'axis-flagship');
  assert.ok(!['phasers', 'photons'].includes(jammed.type), 'the core takes the guns offline');
  const clear = chooseAiAction({ ...game, terrain: [] }, 'axis-flagship');
  assert.ok(['phasers', 'photons'].includes(clear.type), 'in open space the same captain opens fire');
});

test('shots fired from the storm ring miss more often', () => {
  const base = stormGame('storm-ring');
  // A gunnery pair at phaser range: the shooter in the ring, the target in open space.
  const ringed = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 145, y: 120 }; // 25 out: the ring
      if (ship.id === 'axis-flagship') return { ...ship, x: 170, y: 120 }; // 50 out: clear
      return ship;
    }),
  };
  const actor = getShip(ringed, 'fed-flagship');
  const target = getShip(ringed, 'axis-flagship');
  assert.equal(ionStormZone(ringed, actor), 'ring');
  assert.equal(volleyMissChance(ringed, actor, target), MISS_CHANCE + TERRAIN.ionStormRingMiss);
  const open = { ...ringed, terrain: [] };
  const missCount = (game, samples = 400) => {
    let misses = 0;
    for (let step = 0; step < samples; step += 1) {
      const out = applyPlayerAction({ ...game, randomStep: step }, { type: 'phasers', targetId: 'axis-flagship' });
      if (/Missed!/.test(out.messages.join(' '))) misses += 1;
    }
    return misses;
  };
  const openMisses = missCount(open);
  const ringMisses = missCount(ringed);
  assert.ok(ringMisses > openMisses * 1.5,
    `the ring static more than doubles the miss rate (open ${openMisses}/400, ring ${ringMisses}/400)`);
});

test('asteroid cover and the ring jam stack on one roll', () => {
  const base = stormGame('storm-stack');
  const game = {
    ...base,
    terrain: [
      { id: 'ion-storm-1', type: 'ion-storm', x: 120, y: 120, radius: 30 },
      { id: 'asteroids-1', type: 'asteroids', x: 157, y: 120, radius: 5 },
    ],
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 145, y: 120 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 170, y: 120 };
      return ship;
    }),
  };
  assert.equal(
    volleyMissChance(game, getShip(game, 'fed-flagship'), getShip(game, 'axis-flagship')),
    MISS_CHANCE + TERRAIN.asteroidCoverMiss + TERRAIN.ionStormRingMiss,
    'a ring-bound shot line through a field carries both penalties',
  );
});

test('the storm core silences radio, and the ring halves its reach', () => {
  const base = stormGame('storm-radio');
  // An allied hull in the storm's heart is unreachable from anywhere outside.
  const cored = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 120, y: 120 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 200, y: 200 };
      return ship;
    }),
  };
  assert.equal(inRadioContact(cored, getShip(cored, 'fed-flagship'), getShip(cored, 'fed-cruiser-1')), false,
    'a hull in the core neither sends nor hears');
  const radio = applyPlayerAction(cored, { type: 'radio' });
  assert.match(radio.report.lines.join(' '), /No allied stations answer within radio range/);
  // A hull in the ring hears at half reach: 40 units is past 50 x 0.5.
  const ringed = {
    ...base,
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 145, y: 120 };
      if (ship.id === 'fed-flagship') return { ...ship, x: 185, y: 120 };
      if (ship.id === 'axis-flagship') return { ...ship, x: 200, y: 20 };
      return ship;
    }),
  };
  const from = getShip(ringed, 'fed-flagship');
  const to = getShip(ringed, 'fed-cruiser-1');
  assert.equal(radioStormFactor(ringed, to), TERRAIN.ionStormRingRadio);
  assert.equal(inRadioContact(ringed, from, to), false, 'the ring halves the reach: 40 units is past 25');
  assert.equal(inRadioContact({ ...ringed, terrain: [] }, from, to), true, 'in open space the same call gets through');
});

test('engines, sensors, and tractor work throughout the storm', () => {
  const base = stormGame('storm-works');
  const game = { ...base, ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 120, y: 128 } : ship)) };
  const scan = applyPlayerAction(game, { type: 'scan', targetId: 'axis-flagship' });
  assert.match(scan.messages.join(' '), /Scan of Firebreather complete/, 'the scanner sees through the weather');
  const tow = applyPlayerAction(game, { type: 'tractor', targetId: 'axis-flagship' });
  assert.match(tow.messages.join(' '), /locks a tractor beam/, 'the beam still bites in the core');
  const move = applyPlayerAction(game, { type: 'move', dx: 0, dy: 30 });
  assert.equal(getShip(move.game, 'fed-flagship').y, 158, 'and the engines still run');
});

test('the ion storm never touches a classic or extended war', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = createGame({ seed: 'storm-parity', ...opts });
    const actor = getShip(game, 'fed-flagship');
    const target = getShip(game, 'axis-flagship');
    assert.equal(ionStormZone(game, actor), null);
    assert.equal(radioStormFactor(game, actor), 1);
    assert.equal(volleyMissChance(game, actor, target), MISS_CHANCE, 'the calibrated miss rate stands');
  }
});

// --- Round 16: capturable relay objectives (Reimagined) ---

test('the two relay nodes are mirrored symmetrically off Xanadu', () => {
  for (const seed of TERRAIN_SEEDS) {
    const game = createGame({ seed, reimagined: true });
    const relays = game.terrain.filter((feature) => feature.type === 'relay');
    assert.equal(relays.length, 2);
    const xanadu = getShip(game, 'xanadu');
    assert.equal(relays[0].x + relays[1].x, 2 * xanadu.x, 'the pair mirrors through the starbase');
    assert.equal(relays[0].y + relays[1].y, 2 * xanadu.y);
    assert.equal(distance(relays[0], xanadu).toFixed(6), distance(relays[1], xanadu).toFixed(6),
      'so both sit equidistant from it — and from every alliance\'s corner');
    assert.ok(distance(relays[0], xanadu) > 0, 'and neither stacks on the dockyard');
  }
});

/**
 * A Reimagined war with one hand-placed relay node at (160,160). Bonhomme sits on
 * it; everyone else — Xanadu included, so no dockyard or relay interferes — is
 * parked far away.
 */
const relayGame = (seed = 'relay') => {
  const base = createGame({ seed, reimagined: true });
  return {
    ...base,
    terrain: [{ id: 'relay-1', type: 'relay', x: 160, y: 160, radius: TERRAIN.relayRadius }],
    ships: base.ships.map((ship) => {
      if (ship.id === 'fed-cruiser-1') return { ...ship, x: 160, y: 160 };
      return { ...ship, x: 230, y: 20 };
    }),
  };
};

test('ending a stardate on a node holds it for the alliance, and only changes narrate', () => {
  const game = relayGame('relay-hold');
  assert.deepEqual(game.held, {}, 'a fresh war holds nothing');
  const out = resolveObjectives(game);
  assert.equal(out.game.held['relay-1'], 'Federation');
  assert.match(out.messages.join(' '), /The Federation holds the relay node/);
  const again = resolveObjectives(out.game);
  assert.equal(again.game.held['relay-1'], 'Federation');
  assert.deepEqual(again.messages, [], 'an unchanged hold is not re-narrated every stardate');
});

test('contesting darkens the node and driving the holder off frees it', () => {
  const fedHeld = resolveObjectives(relayGame('relay-contest')).game;
  // An Axis hull arrives while Bonhomme still sits there: contested, nobody holds.
  const contested = {
    ...fedHeld,
    ships: fedHeld.ships.map((ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, x: 162, y: 160 } : ship)),
  };
  const dark = resolveObjectives(contested);
  assert.equal(dark.game.held['relay-1'], undefined, 'a contested node goes dark');
  assert.match(dark.messages.join(' '), /contested — the Federation has lost it/);
  // The Federation hull leaves and the Axis one stays: the node flips.
  const flipped = resolveObjectives({
    ...dark.game,
    ships: dark.game.ships.map((ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, x: 40, y: 200 } : ship)),
  });
  assert.equal(flipped.game.held['relay-1'], 'Axis');
  assert.match(flipped.messages.join(' '), /The Axis has wrested the relay node .* from the Federation|The Axis holds the relay node/);
  // And driving the holder off frees it again.
  const freed = resolveObjectives({
    ...flipped.game,
    ships: flipped.game.ships.map((ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, x: 40, y: 200 } : ship)),
  });
  assert.equal(freed.game.held['relay-1'], undefined);
  assert.match(freed.messages.join(' '), /The Axis has lost the relay node/);
});

test('a tractor-held hull holds no node, and a wreck holds none', () => {
  const base = relayGame('relay-towed');
  const towed = resolveObjectives({
    ...base,
    ships: base.ships.map((ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, tractorBy: 'fed-flagship' } : ship)),
  });
  assert.equal(towed.game.held['relay-1'], undefined, 'a hull dragged onto the node holds nothing');
  assert.deepEqual(towed.messages, []);
  const wrecked = resolveObjectives({
    ...base,
    ships: base.ships.map((ship) => (ship.id === 'fed-cruiser-1' ? { ...ship, status: 'destroyed' } : ship)),
  });
  assert.equal(wrecked.game.held['relay-1'], undefined, 'a wreck on the node holds nothing');
});

test('holding a node raises the whole alliance reactor budget, and only its own', () => {
  const held = resolveObjectives(relayGame('relay-power')).game;
  const cruiser = getShip(held, 'fed-cruiser-1');
  assert.equal(reactorOutput(cruiser), 20, 'a cruiser runs a 20-point reactor');
  assert.equal(reactorOutput(cruiser, held), 20 + TERRAIN.relayPowerBonus, 'the held node raises every Federation hull');
  assert.equal(reactorOutput(getShip(held, 'fed-flagship'), held), 25 + TERRAIN.relayPowerBonus, 'flagship included');
  const axis = getShip(held, 'axis-flagship');
  assert.equal(reactorOutput(axis, held), reactorOutput(axis), 'the enemy gains nothing');
  // The raised budget lets an allocation through that the bare reactor refuses:
  // the first four sinks spend 18, so a 20-point reactor leaves the tractor 2.
  const over = { shields: 4, weapons: 6, engines: 4, sensors: 4, tractor: 6 };
  assert.equal(clampPowerAllocation(over, cruiser).tractor, 2, 'clamped to the bare 20-point budget');
  assert.equal(clampPowerAllocation(over, cruiser, held).tractor, 6, 'the bonus budget buys the overcharge');
});

test('the console pips spend the relay bonus', () => {
  const game = { ...relayGame('relay-pips'), playerShipId: 'fed-cruiser-1' };
  // Bonhomme's default profile spends exactly its 20-point budget, so without the
  // node a nudge up is refused...
  const refused = applyPlayerAction(game, { type: 'power', sink: 'tractor', delta: 1 });
  assert.match(refused.messages.join(' '), /cannot spare the power/i);
  // ...and with the node held, the same nudge lands.
  const held = resolveObjectives(game).game;
  const allowed = applyPlayerAction(held, { type: 'power', sink: 'tractor', delta: 1 });
  assert.equal(powerAllocation(allowed.game, getShip(allowed.game, 'fed-cruiser-1')).tractor, POWER.need.tractor + 1);
});

test('the relay resolves in the computer phase, like the dockyard', () => {
  const base = relayGame('relay-round');
  // Hold position so the computer phase does not sail Bonhomme off its node.
  const game = { ...base, orders: { 'fed-cruiser-1': { type: 'hold', targetId: null } } };
  const out = resolveComputerTurns({ ...game, phase: 'computer' });
  assert.equal(out.held['relay-1'], 'Federation', 'the node is captured by stardate end');
  assert.ok(out.log.some((entry) => /holds the relay node/.test(entry)), 'and the narrative says so');
});

test('relay objectives never touch a classic or extended war, and tolerate old saves', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = createGame({ seed: 'relay-parity', ...opts });
    assert.deepEqual(game.held, {}, 'the field exists and is empty, like orders and power');
    const out = resolveObjectives(game);
    assert.equal(out.game, game, 'no nodes, no state change');
    assert.deepEqual(out.messages, []);
  }
  // A Reimagined save from before round 16 has terrain but no `held` field.
  const oldSave = relayGame('relay-old-save');
  delete oldSave.held;
  const out = resolveObjectives(oldSave);
  assert.equal(out.game.held['relay-1'], 'Federation', 'the objective still resolves and records the hold');
});

// --- Argonaut Reimagined, Phase 3 round 17: the prize fleet ---

/**
 * A Reimagined war staged for capture tests: the command ship and a Federation
 * cruiser mid-field beside Grendel, an Axis cruiser left vacant, everyone else at
 * their seeded corners. Xanadu sits at (120, 120), inside whose 40-unit
 * transporter reach the derelict also lies — but the ship order puts
 * fed-cruiser-1 (second to act) long ahead of the starbase (last).
 */
const prizeWar = (seed) => withShips(createGame({ seed, reimagined: true }), (ship) => {
  if (ship.id === 'fed-flagship') return { ...ship, x: 100, y: 100 };
  if (ship.id === 'fed-cruiser-1') return { ...ship, x: 95, y: 100 };
  if (ship.id === 'axis-cruiser-1') return { ...ship, status: 'vacant', crew: 0, x: 104, y: 100 };
  return ship;
});

/**
 * A Reimagined war for AI prize-taking: an Axis cruiser alone mid-field beside a
 * vacant Federation scout, and every other hull parked by hand in a far corner
 * (spread out, since ships seed randomly across the field and doctrine movement
 * toward a shared target could otherwise stack them into collisions). No enemy
 * sits inside any gun's reach of the pair, whatever the seed.
 */
const AI_PRIZE_PARKING = {
  'fed-flagship': [10, 230], 'fed-cruiser-1': [14, 234], 'fed-cruiser-2': [18, 226], 'fed-cruiser-3': [12, 222],
  'axis-flagship': [10, 10], 'axis-cruiser-2': [14, 14], 'axis-cruiser-3': [16, 8], 'axis-scout': [20, 12],
  'bloc-flagship': [230, 10], 'bloc-cruiser-1': [226, 14], 'bloc-cruiser-2': [222, 8], 'bloc-cruiser-3': [228, 16], 'bloc-scout': [224, 20],
  'cabal-flagship': [225, 225], 'cabal-cruiser-1': [230, 230], 'cabal-cruiser-2': [220, 232], 'cabal-cruiser-3': [228, 222], 'cabal-scout': [232, 226],
};

const aiPrizeWar = (seed) => withShips(createGame({ seed, reimagined: true }), (ship) => {
  if (ship.id === 'axis-cruiser-1') return { ...ship, x: 220, y: 120 };
  if (ship.id === 'fed-scout') return { ...ship, status: 'vacant', crew: 0, x: 226, y: 120 };
  return AI_PRIZE_PARKING[ship.id] ? { ...ship, x: AI_PRIZE_PARKING[ship.id][0], y: AI_PRIZE_PARKING[ship.id][1] } : ship;
});

test('boarding a derelict in a Reimagined war stamps the prize record', () => {
  const game = prizeWar('prize-capture');
  const out = applyPlayerAction(game, { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  const prize = getShip(out.game, 'axis-cruiser-1');
  assert.equal(prize.faction, 'Federation');
  assert.equal(prize.status, 'active');
  assert.equal(prize.crew, 10);
  assert.deepEqual(
    { ...prize.prize, captain: prize.prize.captain },
    { from: 'Axis', by: 'fed-flagship', byFaction: 'Federation', turn: 1, captain: getShip(game, 'axis-cruiser-1').captain, times: 1 },
    'the record names the origin, the boarder, the stardate, and the captain it serves no more',
  );
  assert.ok(CAPTAIN_NAMES.includes(prize.captain), 'the prize is dealt a new captain');
  assert.equal(out.game.prizeDraws, 1, 'the prize sub-stream advanced');
  assert.deepEqual(out.game.orders['axis-cruiser-1'], { type: 'withdraw', targetId: null }, 'a fresh prize withdraws rearward');
  assert.deepEqual(out.messages[0], 'Grendel is occupied by 10 crew.');
  assert.match(out.messages.join(' '), /taken as a prize of the Federation — Captain \w+ commands her now, and she withdraws toward Xanadu\./);
  // Deterministic: the same state and the same action draw the same prize captain.
  const again = applyPlayerAction(game, { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  assert.deepEqual(again.game, out.game);
});

test('a prize takes standing orders and reads as a prize in the reports', () => {
  const captured = applyPlayerAction(prizeWar('prize-orders'), { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  const held = applyPlayerAction({ ...captured.game, phase: 'player' }, { type: 'orders', shipId: 'axis-cruiser-1', order: { type: 'hold' } });
  assert.match(held.messages.join(' '), /acknowledges: hold position/, 'the prize is orderable like any Federation hull');
  assert.equal(held.game.phase, 'player', 'orders stay free');
  const line = reportFor(held.game, 'fleet').lines.find((entry) => entry.startsWith('Grendel'));
  assert.match(line, /Grendel — prize of war from the Axis, stardate 1, prize crew 10\/140, under-manned — hold position/);
  assert.ok(reportFor(held.game, 'battle-report').lines.includes('Prizes: 1 taken, 0 lost.'));
});

test('an under-manned prize runs its engines and guns at half until crewed up', () => {
  const out = applyPlayerAction(prizeWar('prize-manning'), { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  const prize = getShip(out.game, 'axis-cruiser-1');
  assert.ok(prize.crew < crewCapacity(prize) * PRIZE.manningFloor, '10 hands is a skeleton crew for a cruiser');
  assert.equal(powerEffect(out.game, prize, 'engines'), PRIZE.manningPenalty);
  assert.equal(powerEffect(out.game, prize, 'weapons'), PRIZE.manningPenalty);
  assert.equal(powerEffect(out.game, prize, 'sensors'), 1, 'a prize crew can still see');
  assert.equal(engineCapacity(prize, out.game.gridSize, powerEffect(out.game, prize, 'engines')), 48, 'half the calibrated reach');
  const crewed = withShips(out.game, (ship) => (ship.id === 'axis-cruiser-1'
    ? { ...ship, crew: Math.ceil(crewCapacity(ship) * PRIZE.manningFloor) }
    : ship));
  assert.equal(powerEffect(crewed, getShip(crewed, 'axis-cruiser-1'), 'engines'), 1, 'transporter runs bring it back to full');
});

test('a board order sends a Federation hull to take the derelict', () => {
  const game = prizeWar('prize-board-order');
  const ordered = applyPlayerAction(game, { type: 'orders', shipId: 'fed-cruiser-1', order: { type: 'board' }, targetId: 'axis-cruiser-1' });
  assert.equal(ordered.game.phase, 'player', 'issuing the order is free');
  assert.deepEqual(ordered.game.orders['fed-cruiser-1'], { type: 'board', targetId: 'axis-cruiser-1' });
  assert.match(ordered.messages.join(' '), /acknowledges: board Grendel/);
  const out = resolveComputerTurns({ ...ordered.game, phase: 'computer' });
  const prize = getShip(out, 'axis-cruiser-1');
  assert.equal(prize.faction, 'Federation', 'the ordered hull beams a prize crew over on its own');
  assert.equal(prize.status, 'active');
  assert.equal(prize.prize?.by, 'fed-cruiser-1');
  assert.equal(getShip(out, 'fed-cruiser-1').crew, 130, 'ten hands went across');
  assert.deepEqual(out.orders['axis-cruiser-1'], { type: 'withdraw', targetId: null }, 'the capture replaces the board order with the withdraw');
  assert.ok(out.log.some((line) => /Bonhomme beams a prize crew across to Grendel/.test(line)));
});

test('a board order sails toward a derelict out of reach, and goes stale once it is taken', () => {
  const game = prizeWar('prize-board-stale');
  const ordered = { ...game, orders: { 'fed-cruiser-1': { type: 'board', targetId: 'axis-cruiser-1' } } };
  assert.deepEqual(chooseAiAction(ordered, 'fed-cruiser-1'), { type: 'board', targetId: 'axis-cruiser-1' }, 'in reach, it boards at once');
  const far = withShips(ordered, (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, x: 160, y: 100 } : ship));
  const sailing = chooseAiAction(far, 'fed-cruiser-1');
  assert.equal(sailing.type, 'move', 'out of reach, it closes the distance');
  assert.ok(sailing.dx > 0);
  const taken = withShips(ordered, (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, status: 'active', crew: 10 } : ship));
  assert.notEqual(chooseAiAction(taken, 'fed-cruiser-1').type, 'board', 'someone else got there first: the order is stale');
});

test('a captain with no shot to take boards the nearest derelict, and spends no roll', () => {
  const game = aiPrizeWar('ai-prize');
  assert.deepEqual(chooseAiAction(game, 'axis-cruiser-1'), { type: 'board', targetId: 'fed-scout' });
  const out = captureHull(game, getShip(game, 'axis-cruiser-1'), getShip(game, 'fed-scout'), PRIZE.aiParty);
  assert.equal(out.game.randomStep, game.randomStep, 'boarding consumes no RNG');
  const prize = getShip(out.game, 'fed-scout');
  assert.equal(prize.faction, 'Axis', 'prizes are symmetric');
  assert.equal(prize.crew, PRIZE.aiParty);
  assert.equal(getShip(out.game, 'axis-cruiser-1').crew, 130);
  assert.equal(out.game.orders['fed-scout'].type, 'withdraw');
  assert.ok(out.messages.some((line) => /prize of the Axis/.test(line)));
});

test('an AI captain boards through the computer phase', () => {
  const out = resolveComputerTurns({ ...aiPrizeWar('ai-prize-round'), phase: 'computer' });
  assert.equal(getShip(out, 'fed-scout').faction, 'Axis');
  assert.ok(out.log.some((line) => /beams a prize crew across to Empyreal/.test(line)));
});

test('a live fight outranks a prize, and the vendetta captain never boards', () => {
  const base = aiPrizeWar('prize-priorities');
  const gunsBear = withShips(base, (ship) => (ship.id === 'fed-cruiser-2' ? { ...ship, x: 200, y: 120 } : ship));
  assert.notEqual(chooseAiAction(gunsBear, 'axis-cruiser-1').type, 'board', 'a captain with a shot takes the shot');
  const hunting = { ...base, vendettaShipId: 'axis-cruiser-1' };
  assert.equal(chooseAiAction(hunting, 'axis-cruiser-1').type, 'move', 'the vendetta captain keeps hunting');
});

test('AI captains never board the starbase', () => {
  const game = withShips(createGame({ seed: 'prize-xanadu', reimagined: true }), (ship) => {
    if (ship.id === 'axis-cruiser-1') return { ...ship, x: 118, y: 120 };
    if (ship.id === 'xanadu') return { ...ship, status: 'vacant', crew: 0 };
    if (ship.faction === 'Federation') return { ...ship, x: 20, y: 20 };
    return ship;
  });
  assert.notEqual(chooseAiAction(game, 'axis-cruiser-1').type, 'board', 'Xanadu is garrisoned and immense');
});

test('a recaptured prize overwrites its record and counts as lost', () => {
  const first = applyPlayerAction(prizeWar('prize-retaken'), { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  const dark = withShips(first.game, (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, status: 'vacant', crew: 0 } : ship));
  const out = captureHull(dark, getShip(dark, 'axis-cruiser-2'), getShip(dark, 'axis-cruiser-1'), PRIZE.aiParty);
  const prize = getShip(out.game, 'axis-cruiser-1');
  assert.equal(prize.faction, 'Axis', 'its original alliance can take it back');
  assert.equal(prize.prize.from, 'Federation');
  assert.equal(prize.prize.byFaction, 'Axis');
  assert.equal(prize.prize.times, 2);
  assert.ok(out.messages.some((line) => /changed hands 2 times/.test(line)));
  assert.ok(reportFor(out.game, 'battle-report').lines.includes('Prizes: 1 taken, 1 lost.'));
});

test('any allegiance flip ends the vendetta, and re-manning a friendly wreck is no capture', () => {
  const base = { ...prizeWar('prize-vendetta-flip'), vendettaShipId: 'axis-cruiser-1' };
  const taken = applyPlayerAction(base, { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  assert.equal(taken.game.vendettaShipId, null, 'the player boarding ends it, as always');
  const dark = withShips(base, (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, status: 'vacant', crew: 0 } : ship));
  const turned = captureHull(dark, getShip(dark, 'bloc-cruiser-1'), getShip(dark, 'axis-cruiser-1'), PRIZE.aiParty);
  assert.equal(turned.game.vendettaShipId, null, 'a third alliance taking the hull ends it too');
  const remanned = captureHull(dark, getShip(dark, 'axis-cruiser-2'), getShip(dark, 'axis-cruiser-1'), PRIZE.aiParty);
  assert.equal(remanned.game.vendettaShipId, 'axis-cruiser-1', 'no flip, no end');
  assert.equal(getShip(remanned.game, 'axis-cruiser-1').prize, undefined, 're-manning a friendly derelict stamps no record');
  assert.deepEqual(remanned.messages, ['A party from Hellhound brings Grendel back into the fight.']);
});

test('a hunter taken by a third alliance ends the hunt', () => {
  const base = createGame({ seed: 'hunt-turned', reimagined: true, scenario: 'hunt-the-vendetta' });
  const hunterId = base.objectiveShipId;
  const hunter = getShip(base, hunterId);
  const third = ['Axis', 'Bloc', 'Cabal'].find((faction) => faction !== hunter.faction);
  const dark = withShips(base, (ship) => (ship.id === hunterId ? { ...ship, status: 'vacant', crew: 0 } : ship));
  const out = captureHull(dark, getShip(dark, `${third.toLowerCase()}-cruiser-1`), getShip(dark, hunterId), PRIZE.aiParty);
  assert.equal(scenarioOutcome(out.game).kind, 'scenario-loss', 'taken before you ever scanned it — you never learned who was coming');
  const win = scenarioOutcome({ ...out.game, scanned: { [hunterId]: true } });
  assert.equal(win.kind, 'scenario-win');
  assert.ok(win.message.includes(hunter.captain), 'the resolution still names the captain who hunted you');
  assert.match(win.message, new RegExp(`flies ${third} colours`));
});

test('the prize layer never touches a classic or extended war', () => {
  for (const opts of [{}, { extended: true }]) {
    const game = withShips(createGame({ seed: 'prize-parity', ...opts }), (ship) => {
      if (ship.id === 'fed-flagship') return { ...ship, x: 10, y: 10 };
      if (ship.id === 'axis-cruiser-1') return { ...ship, status: 'vacant', crew: 0, x: 12, y: 10 };
      if (ship.id === 'axis-cruiser-2') return { ...ship, x: 14, y: 10 };
      return ship;
    });
    // AI captains never board: the derelict stays a derelict.
    assert.notEqual(chooseAiAction(game, 'axis-cruiser-2').type, 'board');
    // A board order is refused — fleet orders themselves are refused in a classic war.
    const refused = applyPlayerAction(game, { type: 'orders', shipId: 'fed-cruiser-1', order: { type: 'board' }, targetId: 'axis-cruiser-1' });
    assert.match(refused.messages.join(' '), opts.extended ? /Reimagined/ : /extended war/);
    // Player capture stays the calibrated occupation, message for message.
    const captured = applyPlayerAction(game, { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
    const hull = getShip(captured.game, 'axis-cruiser-1');
    assert.equal(hull.faction, 'Federation');
    assert.equal(hull.prize, undefined);
    assert.equal(hull.captain, getShip(game, 'axis-cruiser-1').captain, 'the hull keeps the captain it launched with');
    assert.equal(captured.game.orders?.['axis-cruiser-1'], undefined, 'no order is auto-issued');
    assert.equal(captured.game.prizeDraws, 0);
    assert.deepEqual(captured.game.prizesTaken, {}, 'no ledger entry outside a Reimagined war');
    assert.deepEqual(captured.messages, ['Grendel is occupied by 10 crew.']);
  }
});

test('an extended war with a derelict adrift plays out without a single prize', () => {
  let war = withShips(createGame({ seed: 'prize-parity-war', extended: true }), (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, status: 'vacant', crew: 0 } : ship));
  for (let round = 0; round < 30 && !war.outcome; round += 1) {
    war = resolveComputerTurns({ ...war, phase: 'computer' });
  }
  assert.ok(war.ships.every((ship) => ship.prize === undefined));
  assert.ok(!(war.log ?? []).some((line) => /prize/i.test(line)));
});

test('old saves tolerate the absent prize fields', () => {
  const captured = applyPlayerAction(prizeWar('prize-old-save'), { type: 'transport', targetId: 'axis-cruiser-1', amount: 10 });
  // A Reimagined save from before round 17: no prizeDraws or prizesTaken on the
  // game, no record on hulls.
  const old = withShips({ ...captured.game, prizeDraws: undefined, prizesTaken: undefined }, (ship) => {
    if (ship.id !== 'axis-cruiser-1') return ship;
    const { prize, ...rest } = ship;
    return rest;
  });
  const hull = getShip(old, 'axis-cruiser-1');
  assert.equal(powerEffect(old, hull, 'engines'), 1, 'no record, no manning penalty');
  assert.ok(reportFor(old, 'fleet').lines.every((line) => !/prize of war/.test(line)));
  assert.ok(!reportFor(old, 'battle-report').lines.some((line) => /Prizes:/.test(line)), 'no ledger, no prizes line');
  const dark = withShips(old, (ship) => (ship.id === 'axis-cruiser-1' ? { ...ship, status: 'vacant', crew: 0 } : ship));
  const retaken = captureHull(dark, getShip(dark, 'bloc-cruiser-1'), getShip(dark, 'axis-cruiser-1'), PRIZE.aiParty);
  assert.equal(retaken.game.prizeDraws, 1, 'a fresh capture starts the count');
  assert.deepEqual(retaken.game.prizesTaken, { Bloc: 1 }, 'and the ledger');
  assert.equal(getShip(retaken.game, 'axis-cruiser-1').prize.times, 1);
});
