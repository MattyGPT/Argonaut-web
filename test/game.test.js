import test from 'node:test';
import assert from 'node:assert/strict';
import { ACE_KILLS, CAPTAIN_NAMES, CRIPPLE, DOCKING, RANGES, SCENARIOS, STALEMATE_ROUNDS, VENDETTA } from '../game/constants.js';
import { createRng } from '../game/rng.js';
import { scenarioProgress } from '../game/scenarios.js';
import { abbreviateNarrative, alertLevel, createGame, distance, getShip, isAce, radioIntegrity, vendettaGrudge } from '../game/state.js';
import { applyPlayerAction, defaultTargetFor, eligibleTargets, killLines, orderTargets, resolveCollision, weaponDamage } from '../game/actions.js';
import { chooseAiAction } from '../game/ai.js';
import { applySurrender, evaluateOutcome, resolveAutopilotTurn, resolveComputerTurns, resolveDocking, transferCommandIfNeeded } from '../game/turns.js';
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
  assert.equal(alertLevel({ ...argo, shields: 40 }), 'YELLOW');
  assert.equal(alertLevel({ ...argo, shields: 10 }), 'RED');
  // The same 80 shields are comfortable in a battle cruiser, worrying in a starbase.
  assert.equal(alertLevel({ ...argo, shields: 80 }), 'GREEN');
  assert.equal(alertLevel({ ...xanadu, shields: 80 }), 'YELLOW');
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
  assert.equal(cruiser.shields, 10 + Math.ceil(70 * DOCKING.shieldRate));
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

test('the dockyard restores shields and crew but not burnt-out subsystems', () => {
  const game = extended('dock-systems', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 10, systems: { ...ship.systems, mapper: 0 } }
    : ship));
  const cruiser = getShip(resolveDocking(game).game, 'fed-cruiser-1');
  assert.equal(cruiser.systems.mapper, 0);
  assert.ok(cruiser.shields > 10);
});

test('docking stops at full shields and crew', () => {
  const game = extended('dock-full', (ship) => (ship.id === 'fed-cruiser-1'
    ? { ...ship, x: 54, y: 50, shields: 69, crew: 69 }
    : ship));
  const { game: after, messages } = resolveDocking(game);
  const cruiser = getShip(after, 'fed-cruiser-1');
  assert.equal(cruiser.shields, 70, 'shield capacity is a ceiling');
  assert.equal(cruiser.crew, 70, 'so is the crew complement');
  assert.ok(messages.some((line) => /Bonhomme docks at Xanadu: shields \+1, 1 crew transferred\./.test(line)));
});

test('docking resolves during the computer phase and reaches the narrative', () => {
  const game = extended('dock-in-round', (ship) => {
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 52, y: 50, shields: 20 };
    if (ship.faction === 'Federation') return ship;
    return { ...ship, status: 'destroyed' };
  });
  const resolved = resolveComputerTurns(game);
  assert.ok(resolved.log.some((line) => /Bonhomme docks at Xanadu: shields \+6\./.test(line)));
  assert.equal(getShip(resolved, 'fed-cruiser-1').shields, 26);
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
  assert.match(evaluateOutcome(dead).message, /died unidentified/);

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
  assert.match(lines, /Hold until stardate 20\.  Now stardate 7\./);
});
