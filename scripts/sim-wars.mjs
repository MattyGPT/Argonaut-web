#!/usr/bin/env node
/**
 * The whole-war simulation harness (BACKLOG item, committed for the play-test
 * balance pass). Plays headless wars — the player's hull on the same autopilot
 * as everyone else, no orders, exactly the methodology the CALIBRATION.md
 * figures cite — across a range of seeds, and reports the aggregates balance
 * decisions are made from: war length, winner spread, volleys per kill,
 * self-destruct last stands and their blast sizes, and (Reimagined) prizes.
 *
 * Usage:
 *   npm run sim                                  # all three modes, 250 seeds
 *   npm run sim -- --mode reimagined --seeds 60  # one mode, fewer seeds
 *   npm run sim -- --mode extended --precision --json
 *
 * Flags: --mode classic|extended|reimagined|all (default all), --seeds N
 * (default 250, named sim-0..sim-N-1 so runs are comparable across commits),
 * --precision, --regional, --max-stardates N (default 600), --json.
 *
 * Determinism: the game core is seeded, so a run is reproducible; comparisons
 * across balance changes are made by re-running the same seeds on each commit.
 */
import { pathToFileURL } from 'node:url';
import { appendLog, createGame } from '../game/state.js';
import { resolveAutopilotTurn, resolveComputerTurns } from '../game/turns.js';

export const DEFAULTS = Object.freeze({ mode: 'all', seeds: 250, precision: false, regional: false, maxStardates: 600 });

/**
 * Plays one war to its outcome (or the stardate cap) and returns its metrics.
 * The player's hull flies the same autopilot the enemy captains do; a war the
 * Federation loses plays on spectated until the field decides it, exactly as
 * the shipped game does.
 */
export const runWar = (index, { mode = 'extended', precision = false, regional = false, maxStardates = DEFAULTS.maxStardates } = {}) => {
  const reimagined = mode === 'reimagined';
  const extended = mode === 'extended' || reimagined;
  let game = createGame({ seed: `sim-${index}`, extended, reimagined, precision, regional });

  // Self-destruct tracking off the terminal events: a detonation's own card has
  // no attacker; every hull its blast or shrapnel finishes carries attackerId =
  // the detonator, so grouping by attacker sizes each last stand.
  const blastsByDetonator = new Map();
  const blasts = [];
  let selfDestructs = 0;
  const selfDestructsByFaction = {};
  const tally = (events) => {
    const list = events ?? [];
    for (const event of list) {
      if (event.kind !== 'destruction' || event.cause !== 'self-destruct' || event.attackerId) continue;
      const blast = { faction: event.faction, victims: 0 };
      blastsByDetonator.set(event.shipId, blast);
      blasts.push(blast);
      selfDestructs += 1;
      selfDestructsByFaction[event.faction] = (selfDestructsByFaction[event.faction] ?? 0) + 1;
    }
    for (const event of list) {
      if (event.kind !== 'destruction' || event.cause !== 'self-destruct' || !event.attackerId) continue;
      const blast = blastsByDetonator.get(event.attackerId);
      if (blast) blast.victims += 1;
    }
  };

  while (!game.outcome && game.turn < maxStardates) {
    const auto = resolveAutopilotTurn(game);
    tally(auto.events);
    game = resolveComputerTurns(auto.game);
    tally(game.events);
  }

  const count = (status) => game.ships.filter((ship) => ship.status === status).length;
  const activeFactions = [...new Set(game.ships.filter((ship) => ship.status === 'active').map((ship) => ship.faction))];
  const outcome = game.outcome?.kind ?? 'timeout';
  return {
    mode,
    seed: game.seed,
    turns: game.turn,
    outcome,
    winner: outcome === 'federation-win' ? 'Federation' : outcome === 'alliance-win' ? (activeFactions[0] ?? '-') : '-',
    hulls: game.ships.length,
    destroyed: count('destroyed'),
    surrendered: count('surrendered'),
    vacantAtEnd: count('vacant'),
    shots: game.ships.reduce((total, ship) => total + (ship.shotsFired ?? 0), 0),
    kills: game.ships.reduce((total, ship) => total + (ship.kills ?? 0), 0),
    collisions: game.ships.reduce((total, ship) => total + (ship.collisions ?? 0), 0),
    selfDestructs,
    selfDestructsByFaction,
    worstBlast: blasts.reduce((max, blast) => Math.max(max, blast.victims), 0),
    wipeoutBlasts: blasts.filter((blast) => blast.victims >= 4).length,
    prizesTaken: Object.values(game.prizesTaken ?? {}).reduce((total, taken) => total + taken, 0),
    prizesHeldAtEnd: game.ships.filter((ship) => ship.prize && ship.status === 'active' && ship.faction === ship.prize.byFaction).length,
    survivorsByFaction: activeFactions.reduce((totals, faction) => {
      totals[faction] = game.ships.filter((ship) => ship.status === 'active' && ship.faction === faction).length;
      return totals;
    }, {}),
  };
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

/** Runs `seeds` wars in one mode and folds them into an aggregate report. */
export const simulate = (options = {}) => {
  const opts = { ...DEFAULTS, ...options };
  const wars = Array.from({ length: opts.seeds }, (_, index) => runWar(index, opts));
  const turns = wars.map((war) => war.turns).sort((a, b) => a - b);
  const outcomes = {};
  const winners = {};
  const selfDestructFactions = {};
  for (const war of wars) {
    outcomes[war.outcome] = (outcomes[war.outcome] ?? 0) + 1;
    if (war.winner !== '-') winners[war.winner] = (winners[war.winner] ?? 0) + 1;
    for (const [faction, count] of Object.entries(war.selfDestructsByFaction)) {
      selfDestructFactions[faction] = (selfDestructFactions[faction] ?? 0) + count;
    }
  }
  const shots = mean(wars.map((war) => war.shots));
  const kills = mean(wars.map((war) => war.kills));
  return {
    ...opts,
    wars: opts.seeds,
    stardates: {
      mean: Number(mean(turns).toFixed(1)),
      median: quantile(turns, 0.5),
      p10: quantile(turns, 0.1),
      p90: quantile(turns, 0.9),
      max: turns[turns.length - 1] ?? 0,
    },
    hulls: wars[0]?.hulls ?? 0,
    perWar: {
      destroyed: Number(mean(wars.map((war) => war.destroyed)).toFixed(1)),
      surrendered: Number(mean(wars.map((war) => war.surrendered)).toFixed(1)),
      vacantAtEnd: Number(mean(wars.map((war) => war.vacantAtEnd)).toFixed(1)),
      shots: Math.round(shots),
      kills: Number(mean(wars.map((war) => war.kills)).toFixed(1)),
      volleysPerKill: kills > 0 ? Number((shots / kills).toFixed(1)) : 0,
      collisions: Number(mean(wars.map((war) => war.collisions)).toFixed(2)),
      selfDestructs: Number(mean(wars.map((war) => war.selfDestructs)).toFixed(2)),
      wipeoutBlastRate: Number((wars.filter((war) => war.wipeoutBlasts > 0).length / wars.length).toFixed(3)),
      worstBlast: wars.reduce((max, war) => Math.max(max, war.worstBlast), 0),
      prizesTaken: Number(mean(wars.map((war) => war.prizesTaken)).toFixed(2)),
      prizesHeldAtEnd: Number(mean(wars.map((war) => war.prizesHeldAtEnd)).toFixed(2)),
    },
    selfDestructsByFaction: selfDestructFactions,
    outcomes,
    winnerShare: Object.fromEntries(Object.entries(winners)
      .sort((a, b) => b[1] - a[1])
      .map(([faction, count]) => [faction, Number(((count / wars.length) * 100).toFixed(1))])),
  };
};

const pct = (count, total) => `${count} (${Math.round((count / total) * 100)}%)`;

const printReport = (report) => {
  const label = [report.mode, report.precision ? 'precision' : null, report.regional ? 'regional' : null].filter(Boolean).join('/');
  console.log(`--- ${label}, ${report.wars} seeds ---`);
  const s = report.stardates;
  console.log(`stardates: mean ${s.mean}  median ${s.median}  p10 ${s.p10}  p90 ${s.p90}  max ${s.max}`);
  const w = report.perWar;
  console.log(`hulls destroyed per war: ${w.destroyed} of ${report.hulls}   surrendered: ${w.surrendered}   vacant at end: ${w.vacantAtEnd}`);
  console.log(`volleys per war: ${w.shots}   kills: ${w.kills}   volleys per kill: ${w.volleysPerKill}   collisions: ${w.collisions}`);
  const factions = Object.entries(report.selfDestructsByFaction).map(([name, count]) => `${name} ${count}`).join(', ');
  console.log(`self-destructs per war: ${w.selfDestructs}${factions ? ` (${factions})` : ''}   worst blast: ${w.worstBlast} hulls   wars with a 4+ hull blast: ${(w.wipeoutBlastRate * 100).toFixed(1)}%`);
  if (report.mode === 'reimagined') {
    console.log(`prizes taken per war: ${w.prizesTaken}   still held at the end: ${w.prizesHeldAtEnd}`);
  }
  console.log(`outcomes: ${Object.entries(report.outcomes).map(([kind, count]) => `${kind} ${pct(count, report.wars)}`).join(', ')}`);
  console.log(`winners: ${Object.entries(report.winnerShare).map(([name, share]) => `${name} ${share}%`).join(', ')}`);
  console.log('');
};

const MODES = ['classic', 'extended', 'reimagined'];

const parseArgs = (argv) => {
  const args = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--mode' && (MODES.includes(next) || next === 'all')) { args.mode = next; index += 1; } else if (flag === '--seeds' && Number.isFinite(Number(next))) { args.seeds = Number(next); index += 1; } else if (flag === '--max-stardates' && Number.isFinite(Number(next))) { args.maxStardates = Number(next); index += 1; } else if (flag === '--precision') args.precision = true;
    else if (flag === '--regional') args.regional = true;
    else if (flag === '--json') args.json = true;
  }
  return args;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const modes = args.mode === 'all' ? MODES : [args.mode];
  const reports = modes.map((mode) => simulate({ ...args, mode }));
  if (args.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  for (const report of reports) printReport(report);
};

// Importable (the smoke test drives runWar directly) without executing the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
