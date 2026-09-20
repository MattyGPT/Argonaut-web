import test from 'node:test';
import assert from 'node:assert/strict';
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

test('the harness plays a Reimagined war and reports prize metrics', () => {
  const war = runWar(0, { mode: 'reimagined' });
  assert.notEqual(war.outcome, 'timeout');
  assert.equal(war.hulls, 33, 'eight hulls per alliance plus Xanadu');
  assert.ok(war.prizesTaken >= 0);
  assert.ok(war.selfDestructs >= 0);
});

test('the harness is deterministic: the same seed replays the same war', () => {
  const first = runWar(3, { mode: 'extended' });
  const second = runWar(3, { mode: 'extended' });
  assert.deepEqual(first, second);
});

test('simulate folds a short run into an aggregate report', () => {
  const report = simulate({ mode: 'classic', seeds: 3 });
  assert.equal(report.wars, 3);
  assert.ok(report.stardates.mean > 0);
  assert.ok(report.stardates.max >= report.stardates.median);
  const outcomes = Object.values(report.outcomes).reduce((a, b) => a + b, 0);
  assert.equal(outcomes, 3, 'every war is counted exactly once');
});
