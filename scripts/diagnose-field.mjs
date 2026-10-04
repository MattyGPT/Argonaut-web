#!/usr/bin/env node
/** F1: paired, opt-in collision observations. Raw evidence belongs outside the
 * deployed tree. Example: --mode realtime --seeds 250 --output /tmp/field.json
 * Replay an outlier: --mode realtime --seed sim-41 --trajectory-window 16. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createFieldDiagnostics } from '../game/field-diagnostics.js';
import { REALTIME } from '../game/constants.js';
import { runWar } from './sim-wars.mjs';

const distribution = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return { mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    median: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), p99: quantile(0.99), max: sorted.at(-1) ?? 0 };
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const counts = (values) => values.reduce((totals, key) => ({ ...totals, [key]: (totals[key] ?? 0) + 1 }), {});

export const summarizeField = (wars, mode) => {
  const pairs = wars.flatMap((war) => war.pairs);
  const damage = pairs.map((pair) => sum(pair.hulls.map((hull) => hull.damage.shields + hull.damage.crew + sum(Object.values(hull.damage.systems)))));
  const perStardate = wars.flatMap((war) => Object.values(counts(war.pairs.map((pair) => Math.floor(pair.simTime)))));
  const normal = wars.map((war) => war.normal);
  return {
    wars: wars.length, exactStateAndMetricsParity: wars.every((war) => war.parity),
    pairEvents: { total: pairs.length, perWar: distribution(wars.map((war) => war.pairs.length)), perContactStardate: distribution(perStardate) },
    hullInvolvements: { total: pairs.length * 2, perWar: distribution(wars.map((war) => war.pairs.length * 2)) },
    finalHullCounterDiscrepancies: wars.filter((war) => war.normal.collisions !== war.pairs.length * 2).map((war) => ({ seed: war.seed, observedInvolvements: war.pairs.length * 2, finalHullCounters: war.normal.collisions })),
    tags: counts(pairs.flatMap((pair) => pair.tags)),
    paths: counts(pairs.map((pair) => pair.path)),
    differentActualAndSweepPair: pairs.filter((pair) => pair.sweep && [...pair.sweep.candidateIds].sort().join('|') !== pair.pair.join('|')).length,
    repeatedPairEvents: pairs.filter((pair) => pair.occurrence > 1).length,
    damage: { totalUnits: sum(damage), perPair: distribution(damage),
      shieldUnits: sum(pairs.flatMap((pair) => pair.hulls.map((hull) => hull.damage.shields))),
      crew: sum(pairs.flatMap((pair) => pair.hulls.map((hull) => hull.damage.crew))),
      subsystemUnits: sum(pairs.flatMap((pair) => pair.hulls.map((hull) => sum(Object.values(hull.damage.systems))))),
    },
    losses: counts(pairs.flatMap((pair) => pair.losses.map((loss) => loss.status))),
    arrivalHolds: mode === 'realtime' ? {
      hullTicks: sum(wars.map((war) => war.arrivalHolds.ticks)), episodes: sum(wars.map((war) => war.arrivalHolds.episodes)),
      maxConsecutiveTicks: Math.max(0, ...wars.map((war) => war.arrivalHolds.maxConsecutiveTicks)),
      maxConsecutiveStardates: Math.max(0, ...wars.map((war) => war.arrivalHolds.maxConsecutiveTicks)) / REALTIME.ticksPerStardate,
      episodesPerWar: distribution(wars.map((war) => war.arrivalHolds.episodes)),
    } : null,
    normal: { stardates: distribution(normal.map((war) => war.turns)), outcomes: counts(normal.map((war) => war.outcome)), winners: counts(normal.map((war) => war.winner)),
      perWar: Object.fromEntries(['destroyed', 'surrendered', 'vacantAtEnd', 'shots', 'kills', 'collisions', 'selfDestructs', 'prizesTaken', 'prizesHeldAtEnd'].map((key) => [key, distribution(normal.map((war) => war[key])).mean])),
    },
    outliers: [...wars].sort((a, b) => b.pairs.length - a.pairs.length).slice(0, 5).map((war) => ({ seed: war.seed, pairEvents: war.pairs.length, stardates: war.normal.turns,
      damageUnits: sum(war.pairs.flatMap((pair) => pair.hulls.map((hull) => hull.damage.shields + hull.damage.crew + sum(Object.values(hull.damage.systems))))), arrivalHoldEpisodes: war.arrivalHolds.episodes })),
  };
};

export const diagnoseField = ({ mode = 'reimagined', seeds = 250, seed, maxStardates = 600, trajectoryWindow = 0, progress } = {}) => {
  const wars = [];
  for (let index = 0; index < (seed ? 1 : seeds); index += 1) {
    const selectedSeed = seed ?? `sim-${index}`;
    const pairs = [];
    const collector = createFieldDiagnostics({ onCollision: (pair) => pairs.push(pair), trajectoryWindow });
    const hash = () => {
      const digest = createHash('sha256');
      return { update: (game) => digest.update(`${JSON.stringify(game)}\n`), finish: () => digest.digest('hex') };
    };
    const baselineHash = hash();
    const measuredHash = hash();
    const options = { mode, seed: selectedSeed, precision: false, regional: false, maxStardates };
    const baseline = runWar(index, { ...options, onState: baselineHash.update });
    const normal = runWar(index, { ...options, fieldDiagnostics: collector, onState: measuredHash.update });
    const before = baselineHash.finish();
    const after = measuredHash.finish();
    const parity = isDeepStrictEqual(baseline, normal) && before === after;
    if (!parity) throw new Error(`Diagnostics changed authoritative state or metrics: ${mode}/${selectedSeed}`);
    wars.push({ seed: selectedSeed, parity, stateDigest: after, normal, pairs, arrivalHolds: { ...collector.stalls }, ...(trajectoryWindow ? { tailTrajectory: collector.history } : {}) });
    progress?.(index + 1, seed ? 1 : seeds);
  }
  return { mode, settings: { seed: seed ?? 'sim-0..sim-N-1', seeds: wars.length, precision: false, regional: false, maxStardates, trajectoryWindow }, summary: summarizeField(wars, mode), wars };
};

export const parseFieldArgs = (argv) => {
  const options = { mode: 'all', seeds: 250, maxStardates: 600, trajectoryWindow: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--mode') {
      if (!['all', 'reimagined', 'realtime'].includes(value)) throw new Error(`Unsupported mode: ${value}`);
      options.mode = value;
    } else if (flag === '--seed') options.seed = value;
    else if (flag === '--output') options.output = value;
    else if (['--seeds', '--max-stardates', '--trajectory-window'].includes(flag)) {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < (flag === '--trajectory-window' ? 0 : 1) || (flag === '--trajectory-window' && numeric > 64)) throw new Error(`Invalid ${flag}: ${value}`);
      options[flag === '--seeds' ? 'seeds' : flag === '--max-stardates' ? 'maxStardates' : 'trajectoryWindow'] = numeric;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.trajectoryWindow && !options.seed) throw new Error('Trajectory windows require --seed to select an outlier.');
  return options;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseFieldArgs(process.argv.slice(2));
  const modes = options.mode === 'all' ? ['reimagined', 'realtime'] : [options.mode];
  const reports = modes.map((mode) => diagnoseField({ ...options, mode, progress: (count, total) => {
    if (count % 25 === 0 || count === total) process.stderr.write(`${mode}: paired ${count}/${total}\n`);
  } }));
  const output = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(), reports };
  if (options.output) {
    const path = resolve(options.output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(reports.map(({ mode, summary }) => ({ mode, summary })), null, 2)}\nSaved ${path}\n`);
  } else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
