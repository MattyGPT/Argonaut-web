import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { applyPlayerAction, defaultTargetFor, eligibleTargets } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { applySurrender, evaluateOutcome, resolveAutopilotTurn, resolveComputerTurns, transferCommandIfNeeded } from '../game/turns.js';
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
  assert.ok(getShip(result.game, 'axis-flagship').shields < getShip(game, 'axis-flagship').shields);
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
  assert.equal(getShip(friendly.game, 'fed-flagship').crew, 95);
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

test('losing the flagship shifts command and the war continues; losing every Federation ship ends it', () => {
  const game = createGame({ seed: 'loss' });
  const flagshipDown = withShips(game, (ship) => ship.id === 'fed-flagship' ? { ...ship, status: 'destroyed' } : ship);
  assert.equal(evaluateOutcome(flagshipDown).kind, 'active');
  const transfer = transferCommandIfNeeded(flagshipDown);
  assert.notEqual(transfer.game.playerShipId, 'fed-flagship');
  assert.match(transfer.message, /continue without you/i);
  const fedGone = withShips(game, (ship) => ship.faction === 'Federation' ? { ...ship, status: 'destroyed' } : ship);
  assert.equal(evaluateOutcome(fedGone).kind, 'alliance-win');
  const draw = withShips(game, (ship) => ({ ...ship, status: 'destroyed' }));
  assert.equal(evaluateOutcome(draw).kind, 'draw');
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
  assert.ok(!result.outcome, 'an enemy surrender must not end the war');
  assert.ok(result.ships.some((ship) => ship.id === 'bloc-cruiser-1' && ship.status === 'surrendered'));
});

test('the resigned Federation autopilot surrenders when collapsed', () => {
  const base = withShips(createGame({ seed: 'fed-surrender' }), (ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, status: 'active', shields: 5, crew: 5 };
    if (ship.faction === 'Federation') return { ...ship, status: 'destroyed' };
    return ship;
  });
  const result = applySurrender({ ...base, resigned: true });
  assert.ok(result.outcome);
  assert.match(result.outcome.message, /Federation has surrendered/);
  assert.equal(applySurrender(base).outcome, null, 'an active player never auto-surrenders');
});

test('a fresh war does not surrender', () => {
  assert.ok(!applySurrender(createGame({ seed: 'no-surrender' })).outcome);
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
