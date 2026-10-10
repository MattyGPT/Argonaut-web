import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOperationGame } from '../game/operations.js';
import { getShip } from '../game/state.js';
import { createOperationObserver } from '../scripts/operation-metrics.mjs';
import { parseOptions, runOperation, setupOperation, summarizeOperations } from '../scripts/sim-operations.mjs';

test('operation diagnostics and mutating external callbacks cannot change full state or RNG', () => {
  const plain = runOperation({ diagnostics: false });
  const observed = runOperation({ onState: (state) => {
    assert.equal(Object.hasOwn(state, 'metrics'), false);
    state.ships.length = 0;
    state.operation.elapsed = 999;
  }, onRecords: (records) => { records.length = 0; } });
  assert.equal(observed.stateDigest, plain.stateDigest);
  assert.deepEqual(observed.outcome, plain.outcome);
  assert.equal(plain.metrics, null);
  assert.equal(observed.outcome.primary, 'success');
  assert.equal(observed.metrics.towConnections, 1);
  assert.ok(observed.metrics.towingMoves > 1);
  assert.ok(observed.metrics.friendlyDamage['op-sentinel'].shields > 0);
  assert.deepEqual(runOperation(), runOperation());
});

test('mid-haul serialization preserves the entire measured state sequence', () => {
  const uninterrupted = runOperation({ policy: 'north-maintained' });
  const reloaded = runOperation({ policy: 'north-maintained', reloadAt: 8 });
  assert.deepEqual(reloaded, uninterrupted);
});

test('attempt, hit and actual damage are distinct causal facts, consumed once', () => {
  const observer = createOperationObserver(setupOperation('rescue-1', 'reference'));
  const actor = { id: 'op-guard', faction: 'Axis' }, target = { id: 'op-command', faction: 'Federation' };
  const attempt = { eventId: 'a', kind: 'action', actor, payload: { command: 'phasers' } };
  observer.consume([attempt, { eventId: 'miss', kind: 'weapon-resolution', actor, target, payload: { result: 'miss' } }], 2);
  assert.equal(observer.result().firstHostileAttempt, 2);
  assert.equal(observer.result().firstHostileDamage, null);
  const hit = { eventId: 'hit', kind: 'weapon-resolution', actor, target, payload: { result: 'hit' } };
  observer.consume([hit], 3);
  assert.equal(observer.result().hostileHits, 1);
  assert.equal(observer.result().firstHostileDamage, null);
  const damage = { eventId: 'damage', kind: 'damage', actor, target,
    payload: { consequences: { delta: { shields: -5, crew: -2, systems: { engines: -1, shields: 1 } } } } };
  const collision = { eventId: 'collision', kind: 'collision' };
  observer.consume([damage, collision], 4);
  observer.consume([attempt, hit, damage, collision], 5);
  const metrics = observer.result();
  assert.equal(metrics.firstHostileDamage, 4);
  assert.equal(metrics.hostileAttempts, 1);
  assert.equal(metrics.collisions, 1);
  assert.deepEqual(metrics.friendlyDamage['op-command'], { shields: 5, crew: 2, systems: 1 });
  // Later regeneration does not erase damage that occurred during resolution.
  observer.consume([{ ...damage, eventId: 'repair', payload: { consequences: { delta: { shields: 5, crew: 2 } } } }], 6);
  assert.deepEqual(observer.result().friendlyDamage, metrics.friendlyDamage);
});

test('detection uses current command visibility, including a post-player sample', () => {
  const game = setupOperation('rescue-1', 'reference');
  const observer = createOperationObserver(game);
  assert.equal(observer.result().firstCommandDetection, null);
  const visible = { ...game, ships: game.ships.map((s) => s.id === 'op-guard' ? { ...s, x: 72, y: 160 } : s) };
  observer.sample(visible, 1);
  assert.equal(observer.result().firstCommandDetection, 1);
});

test('concentration requires initial-cohort majorities on two distinct consecutive boundaries', () => {
  const game = setupOperation('rescue-1', 'reference');
  const observer = createOperationObserver(game);
  const fleet = { ...game, terrain: [], ships: game.ships.map((s) => ({ ...s, x: 100, y: 100 })) };
  observer.sample(fleet, 1, true);
  observer.sample(fleet, 1, true);
  assert.equal(observer.result().firstSustainedConcentration, null);
  // The objective and prize do not inflate the five-hull combat cluster.
  assert.equal(observer.result().largestMixedCluster, 5);
  observer.sample(fleet, 2, true);
  assert.equal(observer.result().firstSustainedConcentration, 1);
  const depleted = { ...fleet, ships: fleet.ships.map((s) => ['op-scout', 'op-escort'].includes(s.id) ? { ...s, status: 'destroyed' } : s) };
  const other = createOperationObserver(game);
  other.sample(depleted, 1, true); other.sample(depleted, 2, true);
  assert.equal(other.result().firstSustainedConcentration, null);
});

test('quiet travel excludes damage and notices; refusals remain explicit', () => {
  const game = setupOperation('rescue-1', 'reference');
  const observer = createOperationObserver(game);
  const after = { ...game, operation: { ...game.operation, elapsed: 1 } };
  observer.command(game, after, { type: 'move' }, [], true);
  assert.equal(observer.result().quietUnladenTravel, 1);
  observer.command(game, after, { type: 'move' }, [{ kind: 'damage' }], true);
  observer.command(game, after, { type: 'move' }, [], false);
  observer.command(game, after, { type: 'move' }, [{ kind: 'operation-notice' }], true);
  assert.equal(observer.result().quietUnladenTravel, 1);
  assert.equal(observer.result().blocks, 1);
  assert.equal(observer.result().longestQuietUnladenTravel, 1);
});

test('experiment profiles preserve the factory and isolate speed, bounds or initial patrol waypoints', () => {
  const reference = setupOperation('rescue-1', 'reference');
  assert.deepEqual(reference, createOperationGame({ seed: 'rescue-1', battleId: 'pacing:rescue-1' }));
  const legacy = setupOperation('rescue-1', 'legacy-speed');
  assert.equal(legacy.operation.movementScale, 3.2);
  legacy.operation.movementScale = 1;
  assert.deepEqual(legacy, reference);
  assert.throws(() => createOperationGame({ movementScale: 3.2 }), /profile/);
  const wide = setupOperation('rescue-1', 'wide-fixed');
  wide.gridSize = 320;
  assert.deepEqual(wide, reference);
  const stationary = setupOperation('rescue-1', 'stationary-patrol');
  for (const a of Object.values(stationary.operation.assignments)) assert.deepEqual(a.points, [a.home]);
  stationary.operation.assignments = reference.operation.assignments;
  assert.deepEqual(stationary, reference);
  assert.equal(getShip(reference, 'op-command').x, 62);
});

test('bounded runs stay unresolved, and absent events are null rather than zero', () => {
  const capped = runOperation({ maxTurns: 1 });
  assert.equal(capped.capped, true);
  assert.equal(capped.outcome, null);
  assert.equal(capped.metrics.rescueElapsed, null);
  const summary = summarizeOperations([capped])[0];
  assert.equal(summary.rescued, 0);
  assert.equal(summary.capped, 1);
  assert.equal(summary.rescueElapsed, null);
  assert.equal(summary.firstHostileAttempt, null);
});

test('CLI validates bounded matrix arguments and deduplicates requested profiles', () => {
  const options = parseOptions(['--seeds', '6', '--profiles', 'reference,slow,reference', '--policies', 'all', '--json']);
  assert.equal(options.seeds, 6);
  assert.deepEqual(options.profiles, ['reference', 'slow']);
  assert.equal(options.policies.length, 8);
  assert.equal(options.json, true);
  for (const args of [['--seeds', '0'], ['--max-turns', '101'], ['--profiles', 'typo'], ['--policies', ''], ['--output'], ['--typo']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.throws(() => runOperation({ maxTurns: NaN }), /maxTurns/);
});

test('both CLI entry points complete in fresh processes and agree on the traced run', () => {
  const invoke = (script, args) => execFileSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}.mjs`, import.meta.url)), ...args], { encoding: 'utf8' });
  const traced = JSON.parse(invoke('diagnose-operations', ['--start', '2']));
  const batch = JSON.parse(invoke('sim-operations', ['--start', '2', '--seeds', '1', '--json']));
  assert.equal(traced.stateDigest, batch.runs[0].stateDigest);
  assert.ok(traced.actions.length > 0);
  assert.equal(traced.outcome.primary, 'success');
  assert.match(invoke('diagnose-operations', ['--help']), /--max-turns/);
});
