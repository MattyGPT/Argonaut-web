#!/usr/bin/env node
// Inactive experiment: reads a pinned git revision, writes only under TEMP.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const revision = '9961eddae655e11347457cfebcda6184646e3beb';
const root = join(tmpdir(), 'argonaut-playback-exhaustion');
const option = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const arm = option('--arm', 'setup');
if (arm === 'setup') {
  const repo = resolve(here, '../../..');
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', revision], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  for (const name of ['f4-baseline', 'f4-settlement', 'f4-npc']) {
    const target = join(root, name); mkdirSync(target, { recursive: true });
    for (const file of files) { const dest = join(target, file); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, execFileSync('git', ['show', `${revision}:${file}`], { cwd: repo, maxBuffer: 10 * 1024 * 1024 })); }
    if (name === 'f4-baseline') continue;
    copyFileSync(join(here, '2026-10-05-f4-candidate.mjs'), join(target, 'game/exhaustion-candidate.js'));
    copyFileSync(join(here, '2026-10-05-f4-fixtures.mjs'), join(target, 'test/exhaustion-candidate.test.js'));
    const source = join(target, 'game/turns.js');
    let text = readFileSync(source, 'utf8');
    text = `import { applyCandidate } from './exhaustion-candidate.js';\nimport { appendFileSync } from 'node:fs';\n` + text;
    const anchor = '  const colors = resolveDisabledSurrender(game);';
    if (!text.includes(anchor)) throw Error('Boundary insertion anchor missing');
    text = text.replace(anchor, `  const exhaustion = applyCandidate(game, { ${name === 'f4-settlement' ? 'settlement' : 'npc'}: true, onDecision: entry => { if (process.env.F4_AUDIT) appendFileSync(process.env.F4_AUDIT, JSON.stringify(entry) + '\\n'); } });\n  game = exhaustion.game;\n  log.push(...exhaustion.messages);\n  events.push(...exhaustion.events);\n` + anchor);
    writeFileSync(source, text);
  }
  console.log(JSON.stringify({ root, revision }));
} else if (arm === 'summary') {
  const reports = [];
  const normal = row => { const { exact, mechanical, counterStates, ...metrics } = row; return metrics; };
  for (const mode of ['reimagined', 'realtime', 'classic', 'classic-precision']) {
    const baseline = JSON.parse(readFileSync(join(root, `baseline-${mode}-250.json`))).rows;
    for (const name of ['baseline', 'settlement', 'npc']) {
      const rows = JSON.parse(readFileSync(join(root, `${name}-${mode}-250.json`))).rows;
      const turns = rows.map(r => r.turns).sort((a, b) => a - b);
      const sum = key => rows.reduce((n, r) => n + r[key], 0);
      const tally = key => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {});
      const decisionText = readFileSync(join(root, `${name}-${mode}-250-decisions.jsonl`), 'utf8').trim();
      reports.push({ arm: name, mode, wars: rows.length, outcomes: tally('outcome'), winners: tally('winner'),
        meanTurns: sum('turns') / rows.length, p90: turns[Math.floor(rows.length * .9)], max: turns.at(-1),
        prizesTaken: sum('prizesTaken'), prizesHeld: sum('prizesHeldAtEnd'), vacantAtEnd: sum('vacantAtEnd'),
        decisions: decisionText ? decisionText.split('\n').length : 0,
        counterWars: rows.filter(r => r.counterStates > 0).length,
        changedMetrics: rows.filter((r, i) => JSON.stringify(normal(r)) !== JSON.stringify(normal(baseline[i]))).map(r => r.seed),
        changedExact: rows.filter((r, i) => r.exact !== baseline[i].exact).map(r => r.seed),
        changedMechanical: rows.filter((r, i) => r.mechanical !== baseline[i].mechanical).map(r => r.seed),
      });
    }
  }
  writeFileSync(join(root, 'f4-summary.json'), JSON.stringify({ revision, reports }, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} else {
  if (!['baseline', 'settlement', 'npc'].includes(arm)) throw Error('Unknown arm');
  const mode = option('--mode', 'reimagined');
  const seeds = Number(option('--seeds', '250'));
  const precision = process.argv.includes('--precision');
  const target = join(root, `f4-${arm}`);
  const label = `${arm}-${mode}${precision ? '-precision' : ''}-${seeds}`;
  process.env.F4_AUDIT = join(root, `${label}-decisions.jsonl`);
  writeFileSync(process.env.F4_AUDIT, '');
  const { runWar } = await import(pathToFileURL(join(target, 'scripts/sim-wars.mjs')));
  const rows = [];
  for (let index = 0; index < seeds; index++) {
    const exact = createHash('sha256'), mechanical = createHash('sha256');
    let counterBoundaries = 0;
    const metrics = runWar(index, { mode, precision, onState(game) {
      const text = JSON.stringify(game); exact.update(text).update('\n');
      mechanical.update(JSON.stringify(game, (key, value) => key === 'exhaustionBoundaries' ? undefined : value)).update('\n');
      if (game.ships.some(s => s.exhaustionBoundaries > 0)) counterBoundaries++;
    } });
    rows.push({ ...metrics, exact: exact.digest('hex'), mechanical: mechanical.digest('hex'), counterStates: counterBoundaries });
    if ((index + 1) % 25 === 0) console.log(`${label}: ${index + 1}/${seeds}`);
  }
  writeFileSync(join(root, `${label}.json`), JSON.stringify({ revision, arm, mode, precision, seeds, rows }, null, 2));
  console.log(`Saved ${label}.json`);
}
