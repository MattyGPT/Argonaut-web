import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWar, simulate } from '../scripts/sim-wars.mjs';

// Smoke coverage for the whole-war harness itself (scripts/sim-wars.mjs). The
// harness is the measurement tool for balance decisions, so the guarantee that
// matters is that it plays real wars to real outcomes, deterministically, in
// every mode — the tuning figures live in CALIBRATION.md, not in tests.

test('the harness plays a classic war to a terminal outcome', () => {
  const war = runWar(0, { mode: 'classic' });
  assert.notEqual(war.outcome, 'timeout', 'a classic war terminates inside the cap');
  assert.ok(war.turns > 1);
  assert.equal(war.hulls, 21);
  assert.notEqual(war.winner, undefined);
});

test('an omitted runWar mode uses Classic', () => {
  assert.deepEqual(runWar(0), runWar(0, { mode: 'classic' }));
});

test('the CLI all mode contains exactly Classic and Reimagined', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/sim-wars.mjs', import.meta.url)), '--mode', 'all', '--seeds', '1', '--max-stardates', '4', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map((report) => report.mode), ['classic', 'reimagined']);
});

test('the retired harness mode is rejected by both API and CLI', () => {
  assert.throws(() => runWar(0, { mode: 'extended' }), /Unsupported mode: extended/);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/sim-wars.mjs', import.meta.url)), '--mode', 'extended', '--seeds', '1', '--json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported mode: extended\. Choose classic, reimagined, realtime, or all\./);
  assert.equal(result.stdout, '');
});

test('the harness plays a Reimagined war and reports prize metrics', () => {
  const war = runWar(0, { mode: 'reimagined' });
  assert.notEqual(war.outcome, 'timeout');
  // Composed fleets vary inside the loadout bounds (5..33 crewed hulls), and
  // carriers launch drone complements at runtime (round 20): the ceiling is the
  // 33-hull default war plus four alliances of seven carriers × three drones.
  assert.ok(war.hulls >= 5 && war.hulls <= 33 + 4 * 7 * 3, 'composed fleets vary inside the loadout bounds');
  assert.ok(war.prizesTaken >= 0);
  assert.ok(war.selfDestructs >= 0);
});

test('the harness is deterministic: the same seed replays the same war', () => {
  const first = runWar(3, { mode: 'reimagined' });
  const second = runWar(3, { mode: 'reimagined' });
  assert.deepEqual(first, second);
});

test('the harness plays a real-time war on the continuous core (round 32)', () => {
  const war = runWar(0, { mode: 'realtime', maxStardates: 40 });
  assert.ok(war.turns > 1, 'the continuum advanced the stardates');
  assert.ok(war.shots >= 0);
  assert.ok(war.collisions >= 0);
  const again = runWar(0, { mode: 'realtime', maxStardates: 40 });
  assert.deepEqual(war, again, 'the real-time harness is deterministic');
});

test('simulate folds a short run into an aggregate report', () => {
  const report = simulate({ mode: 'classic', seeds: 3 });
  assert.equal(report.wars, 3);
  assert.ok(report.stardates.mean > 0);
  assert.ok(report.stardates.max >= report.stardates.median);
  const outcomes = Object.values(report.outcomes).reduce((a, b) => a + b, 0);
  assert.equal(outcomes, 3, 'every war is counted exactly once');
});
