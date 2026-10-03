#!/usr/bin/env node
/** Recording parity: node scripts/check-record-parity.mjs [--seeds 250]
 * [--baseline-dir PATH] [--output-dir PATH]. No runtime/browser dependency.
 * Checks individual complete-war metrics and every engine field after each
 * resolution in representative wars. Only centralized record metadata is omitted.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGame } from '../game/state.js';
import { enableBattleRecords, stripBattleRecordMetadata } from '../game/battle-records.js';
import { resolveAutopilotTurn, resolveComputerTurns, stepContinuum } from '../game/turns.js';
import { runWar, simulate } from './sim-wars.mjs';
const value = flag => { const at = process.argv.indexOf(flag); return at < 0 ? undefined : process.argv[at + 1]; };
const seeds = Number(value('--seeds') ?? 250);
assert.ok(Number.isInteger(seeds) && seeds > 0, '--seeds must be positive');
const baselineDir = value('--baseline-dir');
const outputDir = value('--output-dir');
if (outputDir) await mkdir(outputDir, { recursive: true });
const modes = ['classic', 'reimagined', 'realtime'];
const results = [];
for (const mode of modes) {
  const startedAt = performance.now();
  let records = 0;
  const kinds = {};
  // Compare whole-war metrics per seed so aggregate matches cannot conceal a
  // swapped winner or a changed tail. Retain no unbounded record collection.
  for (let index = 0; index < seeds; index += 1) {
    const unrecorded = runWar(index, { mode });
    const eventIds = new Set();
    let battleId;
    const recorded = runWar(index, { mode, recordBattles: true, onRecords: batch => {
      for (const record of batch) {
        battleId ??= record.battleId;
        assert.equal(record.battleId, battleId);
        assert.ok(!eventIds.has(record.eventId), 'duplicate emitted event: ' + record.eventId);
        eventIds.add(record.eventId);
        records += 1;
        kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
      }
    } });
    assert.deepEqual(recorded, unrecorded, mode + ' sim-' + index);
    assert.ok(eventIds.size, 'record-enabled war emitted no records');
  }
  // Full per-resolution mechanical state includes randomStep, ordnance,
  // positions, orders, outcomes, and legacy effects. Compare resumed clones too.
  let resolutions = 0;
  for (const index of [0, 3, 17]) {
    const options = { seed: 'sim-' + index, reimagined: mode !== 'classic', realtime: mode === 'realtime' };
    let ordinary = createGame(options);
    if (mode === 'realtime') ordinary = { ...ordinary, autoConn: true };
    let recorded = enableBattleRecords(ordinary);
    for (let step = 0; !ordinary.outcome && ordinary.turn < 600 && step < 5000; step += 1) {
      if (mode === 'realtime') {
        ordinary = stepContinuum(ordinary).game;
        recorded = stepContinuum(recorded).game;
      } else {
        ordinary = resolveAutopilotTurn(ordinary).game;
        recorded = resolveAutopilotTurn(recorded).game;
        assert.deepEqual(stripBattleRecordMetadata(recorded), ordinary, mode + ' player resolution');
        ordinary = resolveComputerTurns(ordinary);
        recorded = resolveComputerTurns(recorded);
      }
      assert.deepEqual(stripBattleRecordMetadata(recorded), ordinary, mode + ' full state sim-' + index + ' step-' + step);
      resolutions += 1;
      if (step === 3) {
        ordinary = JSON.parse(JSON.stringify(ordinary));
        recorded = JSON.parse(JSON.stringify(recorded));
      }
    }
  }
  // Compare to the actual previous-revision aggregate when supplied, without
  // changing precision/regional settings or the 600-stardate harness cap.
  if (baselineDir) {
    // Each recorded war already matched its ordinary counterpart above. Fold
    // ordinary wars here instead of rebuilding the same discarded records.
    const report = [simulate({ mode, seeds, json: true })];
    const baseline = JSON.parse((await readFile(resolve(baselineDir, 'baseline-' + mode + '.json'), 'utf8')).replace(/^\uFEFF/, ''));
    assert.deepEqual(report, baseline, mode + ' previous-revision baseline');
    if (outputDir) await writeFile(resolve(outputDir, 'recorded-' + mode + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const result = { mode, seeds, records, kinds, resolutions, elapsedMs: Math.round(performance.now() - startedAt) };
  results.push(result);
  console.log(JSON.stringify(result));
}
if (outputDir) await writeFile(resolve(outputDir, 'parity-summary.json'), JSON.stringify(results, null, 2) + '\n');
