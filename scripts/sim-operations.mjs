#!/usr/bin/env node
/** Bounded, legal scripted captain policies. Diagnostic setup changes never ship. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createOperationGame } from '../game/operations.js';
import { actionAvailability, applyPlayerAction, maneuverTo } from '../game/actions.js';
import { resolveComputerTurns } from '../game/turns.js';
import { distance, getShip, isActive, maintainedTowPair } from '../game/state.js';
import { createOperationObserver } from './operation-metrics.mjs';

export const PROFILES = Object.freeze({
  reference: { movementScale: 1, gridSize: 320 },
  slow: { movementScale: .75, gridSize: 320 },
  fast: { movementScale: 1.5, gridSize: 320 },
  'legacy-speed': { movementScale: 3.2, gridSize: 320 },
  'wide-fixed': { movementScale: 1, gridSize: 480 },
  'stationary-patrol': { movementScale: 1, gridSize: 320, stationary: true },
});
export const POLICIES = Object.freeze(['direct-maintained', 'north-maintained', 'prize-maintained', 'direct-pulls', 'north-pulls', 'prize-pulls', 'overcharged-maintained', 'early-withdraw']);
export const USAGE = `Operation pacing diagnostics (elapsed stardates, prototype revision 2)
node scripts/sim-operations.mjs --seeds 30 --profiles all --policies all --output report.json
node scripts/diagnose-operations.mjs --start 26 --profiles slow --policies prize-maintained
--start N         First rescue-N seed (default 1)
--seeds N         Batch size (default 30); diagnose traces exactly one seed
--profiles LIST   Comma-separated profiles or all (default reference)
--policies LIST   Comma-separated policies or all (default direct-maintained)
--max-turns N     Stop after N elapsed stardates (default 22, maximum 100)
--output PATH    Write JSON; parent directory must already exist
--json           Batch: print full JSON instead of summary; diagnose always prints full JSON
Profiles: ${Object.keys(PROFILES).join(', ')}
Policies: ${POLICIES.join(', ')}
These scripts do not change game settings or browser saves.`;

export const setupOperation = (seed, profile) => {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile: ${profile}`);
  const spec = PROFILES[profile];
  // Factory validation remains strict. Legacy speed is a headless-only ablation;
  // all other fixture coordinates, hardware, power, rules and RNG are unchanged.
  let game = createOperationGame({ seed, movementScale: spec.movementScale === 3.2 ? 1 : spec.movementScale, gridSize: spec.gridSize, battleId: `pacing:${seed}` });
  if (spec.movementScale === 3.2) game = { ...game, operation: { ...game.operation, movementScale: spec.movementScale } };
  if (spec.stationary) game = { ...game, operation: { ...game.operation, assignments: Object.fromEntries(Object.entries(game.operation.assignments)
    .map(([id, a]) => [id, { ...a, points: [{ ...a.home }] }])) } };
  return game;
};

const captainPolicy = (policy) => {
  if (!POLICIES.includes(policy)) throw new Error(`Unknown policy: ${policy}`);
  const prizeFirst = policy.startsWith('prize-');
  const pulls = policy.endsWith('-pulls');
  const waypoints = prizeFirst ? [{ x: 105, y: 65 }, { x: 158, y: 92 }]
    : policy.startsWith('north-') ? [{ x: 80, y: 65 }, { x: 145, y: 55 }]
      : [{ x: 107, y: 140 }];
  const power = policy === 'overcharged-maintained' ? [
    { type: 'power', sink: 'weapons', delta: -1 }, { type: 'power', sink: 'engines', delta: 1 },
    { type: 'power', sink: 'weapons', delta: -1 }, { type: 'power', sink: 'engines', delta: 1 },
  ] : [];
  let waypoint = 0, boardingAttempted = false;
  return (game) => {
    const actor = getShip(game, game.playerShipId), op = game.operation;
    const move = (point) => ({ type: 'move', ...maneuverTo(game, point.x, point.y) });
    if (power.length) return { action: power.shift(), phase: 'engine-overcharge' };
    if (policy === 'early-withdraw') return { action: move(op.exit), phase: 'early-withdrawal' };
    if (op.primary !== 'pending') {
      const remaining = game.ships.filter((s) => isActive(s) && s.faction === 'Federation' && ![op.targetId, op.prizeId].includes(s.id));
      const prize = getShip(game, op.prizeId);
      if (prizeFirst && remaining.length === 1 && isActive(prize) && prize.faction === 'Federation'
        && op.elapsed < op.withdrawalDeadline - 1) return { action: { type: 'pass' }, phase: 'wait-for-prize' };
      return { action: move(op.exit), phase: 'fleet-withdrawal' };
    }
    while (waypoint < waypoints.length && distance(actor, waypoints[waypoint]) <= 1) waypoint++;
    if (waypoint < waypoints.length) return { action: move(waypoints[waypoint]), phase: 'approach' };
    if (prizeFirst && !boardingAttempted) {
      boardingAttempted = true;
      return { action: { type: 'transport', targetId: op.prizeId, amount: 20 }, phase: 'board-prize' };
    }
    const target = getShip(game, op.targetId);
    if (!isActive(target) || target.faction !== actor.faction) return { action: move(op.exit), phase: 'target-lost' };
    if (maintainedTowPair(game)) return { action: move(op.exit), phase: 'haul' };
    if (distance(actor, target) <= 35 && distance(actor, target) >= 5) return { action: pulls
      ? { type: 'tractor', targetId: target.id, towardX: op.exit.x, towardY: op.exit.y }
      : { type: 'tow-start', targetId: target.id }, phase: pulls ? 'pull' : 'connect' };
    return { action: move({ x: target.x - 17, y: target.y - 20 }), phase: 'close-for-tow' };
  };
};

export const runOperation = ({ seed = 'rescue-1', profile = 'reference', policy = 'direct-maintained', maxTurns = 22, diagnostics = true, trace = false, reloadAt, onState, onRecords } = {}) => {
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new Error('maxTurns must be an integer from 1 to 100.');
  let game = setupOperation(seed, profile);
  const decide = captainPolicy(policy);
  const observer = diagnostics ? createOperationObserver(game) : null;
  const hash = createHash('sha256'), actions = [];
  let accepted = 0, refused = 0, reloaded = false;
  const snapshot = (phase) => {
    hash.update(phase); hash.update(JSON.stringify(game));
    // Callers receive isolated copies. Observers cannot alter the next decision.
    onState?.(structuredClone(game), phase);
  };
  snapshot('initial');
  const issue = (action, phase) => {
    const before = game, issuer = game.playerShipId;
    const availability = actionAvailability(game, action);
    const response = applyPlayerAction(game, action);
    const changed = response.game !== before;
    const records = [...(response.records ?? [])];
    game = response.game;
    const boundary = before.operation.elapsed + (game.phase === 'computer' ? 1 : 0);
    observer?.sample(game, boundary);
    snapshot('player');
    if (game.phase === 'computer') game = resolveComputerTurns(game, { onRecords: (batch) => records.push(...batch) });
    observer?.consume(records, game.operation.elapsed);
    observer?.sample(game, game.operation.elapsed, true);
    observer?.command(before, game, action, records, changed);
    onRecords?.(structuredClone(records));
    snapshot('boundary');
    changed ? accepted++ : refused++;
    if (trace) actions.push({ elapsed: game.operation.elapsed, issuer, phase, action, accepted: changed,
      ...(!changed ? { reason: availability.reason ?? response.messages.join(' ') } : {}),
      primary: game.operation.primary, command: game.playerShipId,
      target: getShip(game, game.operation.targetId) ? { x: getShip(game, game.operation.targetId).x, y: getShip(game, game.operation.targetId).y } : null });
    return changed;
  };
  for (let guard = 0; guard < 128 && !game.operation.result && game.operation.elapsed < maxTurns; guard++) {
    const { action, phase } = decide(game);
    if (!issue(action, phase) && !issue({ type: 'pass' }, 'blocked-wait')) break;
    if (!reloaded && reloadAt !== undefined && game.operation.elapsed >= reloadAt) {
      game = JSON.parse(JSON.stringify(game)); reloaded = true;
    }
  }
  const result = game.operation.result;
  const recordHull = (s) => ({ id: s.id, name: s.name, status: s.status, faction: s.faction, shields: s.shields, crew: s.crew });
  return { seed, profile, policy, revision: game.operation.revision, configuration: PROFILES[profile],
    stateDigest: hash.digest('hex'), accepted, refused, capped: !result,
    outcome: result ? { primary: result.primary, reason: result.reason, rescueTiming: result.rescueTiming, elapsed: result.elapsed,
      prizeRecovered: result.prizeRecovered, returned: game.operation.extracted.map(recordHull),
      abandoned: result.abandoned.map((s) => s.id), lost: result.lost.map((s) => s.id) } : null,
    metrics: observer?.result() ?? null, ...(trace ? { actions } : {}) };
};

export const parseOptions = (args) => {
  const options = { seeds: 30, start: 1, profiles: ['reference'], policies: ['direct-maintained'], maxTurns: 22, json: false, output: null };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--json') { options.json = true; continue; }
    const key = ({ '--seeds': 'seeds', '--start': 'start', '--profiles': 'profiles', '--policies': 'policies', '--max-turns': 'maxTurns', '--output': 'output' })[flag];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete flag: ${flag}`);
    const value = args[++i];
    if (['seeds', 'start', 'maxTurns'].includes(key)) {
      const n = Number(value), limit = key === 'seeds' ? 1000 : key === 'start' ? 100000 : 100;
      if (!Number.isInteger(n) || n < 1 || n > limit) throw new Error(`${flag} must be an integer from 1 to ${limit}.`);
      options[key] = n;
    } else if (key === 'profiles' || key === 'policies') {
      const allowed = key === 'profiles' ? Object.keys(PROFILES) : POLICIES;
      options[key] = value === 'all' ? [...allowed] : [...new Set(value.split(','))];
      if (options[key].some((v) => !allowed.includes(v))) throw new Error(`Unknown ${key}: ${value}`);
    } else options[key] = value;
  }
  return options;
};

export const summarizeOperations = (runs) => {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.profile}/${run.policy}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  const range = (values) => { const valid = values.filter((n) => Number.isFinite(n)); return valid.length ? { min: Math.min(...valid), max: Math.max(...valid), observed: valid.length } : null; };
  return [...groups].map(([group, rows]) => ({ group, runs: rows.length,
    rescued: rows.filter((r) => r.outcome?.primary === 'success').length,
    late: rows.filter((r) => r.outcome?.rescueTiming === 'late').length,
    prizes: rows.filter((r) => r.outcome?.prizeRecovered).length,
    capped: rows.filter((r) => r.capped).length, blockedCommands: rows.reduce((n, r) => n + r.refused, 0),
    lostHulls: rows.reduce((n, r) => n + (r.outcome?.lost.length ?? 0), 0),
    abandonedHulls: rows.reduce((n, r) => n + (r.outcome?.abandoned.length ?? 0), 0),
    rescueElapsed: range(rows.map((r) => r.metrics?.rescueElapsed)),
    finalElapsed: range(rows.map((r) => r.outcome?.elapsed)),
    firstDetection: range(rows.map((r) => r.metrics?.firstCommandDetection)),
    firstHostileAttempt: range(rows.map((r) => r.metrics?.firstHostileAttempt)),
    firstHostileDamage: range(rows.map((r) => r.metrics?.firstHostileDamage)),
    hostileAttempts: range(rows.map((r) => r.metrics?.hostileAttempts)),
    largestMixedCluster: range(rows.map((r) => r.metrics?.largestMixedCluster)),
    sustainedConcentration: range(rows.map((r) => r.metrics?.firstSustainedConcentration)),
    longestQuietUnladenTravel: range(rows.map((r) => r.metrics?.longestQuietUnladenTravel)),
    collisions: rows.reduce((n, r) => n + (r.metrics?.collisions ?? 0), 0),
  }));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
  } else {
    const options = parseOptions(process.argv.slice(2));
    const runs = options.profiles.flatMap((profile) => options.policies.flatMap((policy) => Array.from({ length: options.seeds }, (_, i) => runOperation({ seed: `rescue-${options.start + i}`, profile, policy, maxTurns: options.maxTurns }))));
    const report = { schema: 1, definition: 'rescue-at-the-belt', revision: 2, options, summary: summarizeOperations(runs), runs };
    const serialized = JSON.stringify(report, null, 2);
    if (options.output) await writeFile(options.output, serialized + '\n');
    console.log(options.json ? serialized : JSON.stringify({ summary: report.summary, output: options.output }, null, 2));
  }
}
