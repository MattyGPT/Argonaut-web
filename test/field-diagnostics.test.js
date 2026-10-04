import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, powerEffect } from '../game/state.js';
import { applyPlayerAction, resolveCollision, tractorLock } from '../game/actions.js';
import { resolveComputerTurns, stepContinuum } from '../game/turns.js';
import { createFieldDiagnostics, withFieldDiagnostics } from '../game/field-diagnostics.js';
import { runWar } from '../scripts/sim-wars.mjs';
import { diagnoseField, parseFieldArgs } from '../scripts/diagnose-field.mjs';

const pairGame = () => {
  const base = createGame({ seed: 'field-pair', reimagined: true });
  return { ...base, terrain: [], ships: base.ships.filter((ship) => ['fed-flagship', 'axis-flagship'].includes(ship.id)).map((ship) => ({ ...ship, x: 10, y: 10 })) };
};

test('one actual pair emits one diagnostic despite two hull counter updates, with exact damage and no saved diagnostics', () => {
  const game = pairGame();
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record) });
  const run = (input) => resolveCollision(input, getShip(input, input.playerShipId));
  const enabled = withFieldDiagnostics(game, collector, run);
  const disabled = run(game);
  assert.deepEqual(enabled, disabled);
  assert.equal(records.length, 1);
  assert.equal(enabled.game.ships.reduce((sum, ship) => sum + ship.collisions, 0), 2);
  assert.equal(records[0].losses.filter((loss) => loss.status === 'destroyed').length, 1);
  for (const hull of records[0].hulls) {
    const before = getShip(game, hull.id);
    const after = getShip(enabled.game, hull.id);
    assert.equal(hull.damage.shields, before.shields - after.shields);
    assert.equal(hull.damage.crew, before.crew - after.crew);
    assert.deepEqual(hull.damage.systems, Object.fromEntries(Object.keys(before.systems).map((key) => [key, before.systems[key] - after.systems[key]])));
  }
  assert.deepEqual(records[0].tags, ['opposing', 'unknown-intent']);
  assert.equal(Object.getOwnPropertySymbols(enabled.game).length, 0);
  assert.equal(JSON.stringify(enabled).includes('unknown-intent'), false);
});

test('repeated observations of a revived pair remain separate actual resolutions', () => {
  const game = pairGame();
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record) });
  const run = (input) => resolveCollision(input, getShip(input, input.playerShipId));
  const first = withFieldDiagnostics(game, collector, run);
  const revived = { ...first.game, ships: game.ships };
  const second = withFieldDiagnostics(revived, collector, run);
  assert.deepEqual(records.map((record) => record.occurrence), [1, 2]);
  assert.deepEqual(records.map((record) => record.sequence), [1, 2]);
  assert.equal(second.game.randomStep, game.randomStep + 2);
});

test('three-hull sweep reports the actual third-hull pair rather than relabelling its candidate', () => {
  const base = createGame({ seed: 'field-three', realtime: true });
  const template = getShip(base, base.playerShipId);
  const game = { ...base, terrain: [], playerShipId: 'a', simTime: 0.125, ships: [
    { ...template, id: 'c', faction: 'Axis', x: 4, y: 20 },
    { ...template, id: 'a', x: 0, y: 20, dest: { x: 100, y: 20 }, noAvoid: true },
    { ...template, id: 'b', faction: 'Bloc', x: 4, y: 20 },
  ] };
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record), trajectoryWindow: 2 });
  const result = withFieldDiagnostics(game, collector, stepContinuum);
  assert.deepEqual(result, stepContinuum(game));
  const actual = records.find((record) => record.pair.join(',') === 'a,c');
  assert.ok(actual);
  assert.deepEqual(actual.sweep.candidateIds, ['a', 'b']);
  assert.equal(actual.path, 'swept');
  assert.equal(actual.simTime, 0.25);
  assert.ok(actual.trajectory.length <= 2);
  assert.ok(actual.hulls.find((hull) => hull.id === 'a').velocity.x > 0);
  assert.ok(actual.tags.includes('stationary'));
});

test('a manual directed tow records explicit ram intent and the towed pair', () => {
  const base = createGame({ seed: 'field-tow', reimagined: true });
  const ids = [base.playerShipId, 'axis-flagship', 'axis-cruiser-1'];
  const game = { ...base, terrain: [], ships: base.ships.filter((ship) => ids.includes(ship.id)).map((ship) => ({ ...ship, x: ship.id === base.playerShipId ? 10 : ship.id === 'axis-flagship' ? 16 : 12, y: 10 })) };
  const action = { type: 'tractor', targetId: 'axis-flagship', towardX: 12, towardY: 10 };
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record) });
  const result = withFieldDiagnostics(game, collector, (input) => applyPlayerAction(input, action));
  assert.deepEqual(result, applyPlayerAction(game, action));
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].pair, ['axis-cruiser-1', 'axis-flagship']);
  assert.ok(records[0].tags.includes('tow'));
  assert.ok(records[0].tags.includes('manual-ram'));
  assert.ok(records[0].tags.includes('friendly'));
  assert.equal(records[0].hulls.find((hull) => hull.id === action.targetId).tractorBy, game.playerShipId);
});

test('disabled diagnostics preserve original resolver input identity and emit nothing', () => {
  const game = pairGame();
  let observed;
  const result = withFieldDiagnostics(game, null, (input) => { observed = input; return input; });
  assert.equal(observed, game);
  assert.equal(result, game);
  const collector = createFieldDiagnostics();
  assert.equal(withFieldDiagnostics(game, collector, (input) => input), game);
  const rejected = withFieldDiagnostics(game, collector, (input) => applyPlayerAction(input, { type: 'move', dx: 900, dy: 0 }));
  assert.equal(rejected.game, game, 'enabled diagnostics preserve rejection identity');
});

test('a completed directed tow does not label a later unrelated contact as a manual ram', () => {
  const game = pairGame();
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record) });
  collector.decisions.set(game.playerShipId, { source: 'manual', action: { type: 'tractor', targetId: 'axis-flagship' }, ramTargetIds: ['axis-flagship'], simTime: -10 });
  const measured = withFieldDiagnostics(game, collector, (input) => resolveCollision(input, getShip(input, input.playerShipId)));
  assert.deepEqual(measured, resolveCollision(game, getShip(game, game.playerShipId)));
  assert.ok(records[0].tags.includes('unknown-intent'));
  assert.ok(!records[0].tags.includes('manual-ram'));
});

test('departed merchants explain legacy final-counter undercount without losing pair evidence', () => {
  const report = diagnoseField({ mode: 'realtime', seed: 'sim-235' });
  assert.equal(report.summary.exactStateAndMetricsParity, true);
  assert.deepEqual(report.summary.finalHullCounterDiscrepancies, [{ seed: 'sim-235', observedInvolvements: 14, finalHullCounters: 13 }]);
  assert.ok(report.wars[0].pairs.some((pair) => pair.pair.includes('enc-13-merchant')));
});

test('doctrine tow-ram classification comes from the deliberate AI branch', () => {
  const base = createGame({ seed: 'field-doctrine', reimagined: true });
  const actor = { ...getShip(base, 'cabal-flagship'), x: 10, y: 10 };
  const target = { ...getShip(base, base.playerShipId), x: 35, y: 10 };
  const landing = tractorLock(actor, target, base.gridSize, null, powerEffect(base, actor, 'tractor')).position;
  const blocker = { ...getShip(base, 'axis-flagship'), ...landing };
  const game = { ...base, terrain: [], phase: 'computer', vendettaShipId: actor.id, ships: [actor, target, blocker] };
  const records = [];
  const collector = createFieldDiagnostics({ onCollision: (record) => records.push(record) });
  const observed = withFieldDiagnostics(game, collector, resolveComputerTurns);
  assert.deepEqual(observed, resolveComputerTurns(game));
  assert.ok(records.some((record) => record.tags.includes('doctrine-tow-ram')));
  assert.ok(records.some((record) => record.hulls.some((hull) => hull.decision?.reason === 'doctrine-tow-ram')));
});

test('field CLI selects modes, exact seeds, output and bounded outlier traces', () => {
  assert.deepEqual(parseFieldArgs(['--mode', 'realtime', '--seed', 'sim-42', '--output', 'field.json', '--trajectory-window', '16']), {
    mode: 'realtime', seed: 'sim-42', output: 'field.json', seeds: 250, maxStardates: 600, trajectoryWindow: 16,
  });
  assert.throws(() => parseFieldArgs(['--trajectory-window', '65']));
  assert.throws(() => parseFieldArgs(['--trajectory-window', '16']), /require --seed/);
  assert.throws(() => parseFieldArgs(['--seeds', '0']));
});

test('whole-war observations preserve every authoritative state and RNG for both timing modes', () => {
  for (const mode of ['reimagined', 'realtime']) {
    const states = [];
    const baseline = runWar(7, { mode, maxStardates: 20, onState: (game) => states.push(JSON.stringify(game)) });
    let index = 0;
    const collector = createFieldDiagnostics({ trajectoryWindow: 3 });
    const measured = runWar(7, { mode, maxStardates: 20, fieldDiagnostics: collector, onState: (game) => {
      assert.equal(Object.getOwnPropertySymbols(game).length, 0);
      assert.equal(JSON.stringify(game), states[index++]);
      assert.ok(collector.history.length <= 3);
    } });
    assert.deepEqual(measured, baseline);
    assert.equal(index, states.length);
  }
});
