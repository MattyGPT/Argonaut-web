#!/usr/bin/env node
/**
 * Run the browser regression checks against a temporary instance of server.js.
 *
 *   npm run check:browser                 # every enforced browser check
 *   npm run check:browser -- --list       # show the suite and the quarantine
 *   npm run check:browser -- --only check-mode-selection,check-new-game
 *   npm run check:browser -- --exclude check-operations
 *   npm run check:browser -- --jobs 4     # run four checks at a time
 *   npm run check:browser -- --include-quarantined
 *
 * Suite membership and the known-red quarantine live in
 * scripts/lib/browser-suite.mjs, so `npm test` can assert on both without
 * executing this runner.
 *
 * A missing browser is a hard failure, never a skip: a green run that executed
 * nothing is the exact failure this suite exists to prevent.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/browser.mjs';
import { QUARANTINE, discoverSuite } from './lib/browser-suite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const flagValue = (name) => {
  const inline = args.find((entry) => entry.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const list = (name) => (flagValue(name) ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

const freePort = () => new Promise((accept, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => accept(port));
  });
});

const startServer = async (port) => {
  const child = spawn(process.execPath, [join(root, 'server.js')], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('server.js did not start within 10s')), 10_000);
    child.stdout.once('data', () => { clearTimeout(timer); accept(); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server.js exited early with code ${code}`)); });
  });
  return child;
};

const runOne = async (name, gameUrl) => {
  const started = Date.now();
  return new Promise((accept) => {
    const child = spawn(process.execPath, [join(here, `${name}.mjs`)], {
      cwd: root, env: { ...process.env, GAME_URL: gameUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code, signal) => accept({
      name, code, signal, ms: Date.now() - started,
      output: output.trim(),
    }));
  });
};

const suite = await discoverSuite();
const quarantined = suite.filter((name) => QUARANTINE[name]);
if (args.includes('--list')) {
  console.log(`Browser check suite (${suite.length}):`);
  for (const name of suite) console.log(`  ${name}${QUARANTINE[name] ? '  [quarantined]' : ''}`);
  if (quarantined.length) console.log(`\n${quarantined.length} quarantined — see scripts/lib/browser-suite.mjs and the 2026-11-11 browser-check-ci review.`);
  process.exit(0);
}

const only = list('only');
const excluded = list('exclude');
const exclude = new Set(excluded);
for (const name of [...only, ...excluded]) {
  if (!suite.includes(name)) {
    console.error(`Not in the browser suite: ${name}\nRun with --list to see the suite.`);
    process.exit(2);
  }
}
// An explicit --only overrides the quarantine, so a quarantined check stays
// runnable while it is being fixed; --include-quarantined runs the whole suite.
const includeQuarantined = args.includes('--include-quarantined');
const selected = suite.filter((name) => (!only.length || only.includes(name))
  && !exclude.has(name) && (includeQuarantined || only.includes(name) || !QUARANTINE[name]));
if (!selected.length) {
  console.error('No browser checks selected. Run with --list to see the suite.');
  process.exit(2);
}
const skipped = quarantined.filter((name) => !selected.includes(name));
if (skipped.length) {
  console.log(`Quarantined, not enforced (${skipped.length}) — pass --include-quarantined to run them:`);
  for (const name of skipped) console.log(`  ${name}: ${QUARANTINE[name]}`);
  console.log('');
}

// Prove a browser exists before booting anything, so the failure names the
// browser rather than looking like eighteen unrelated check failures.
const { browser, via } = await launchBrowser();
await browser.close();
console.log(`Browser: ${via}`);

const port = await freePort();
const gameUrl = `http://127.0.0.1:${port}`;
const server = await startServer(port);
console.log(`Server:  ${gameUrl}\n`);

const jobs = Math.max(1, Number(flagValue('jobs') ?? 1));
const results = [];
const queue = [...selected];
const worker = async () => {
  while (queue.length) {
    const result = await runOne(queue.shift(), gameUrl);
    results.push(result);
    const status = result.code === 0 ? 'pass' : 'FAIL';
    console.log(`${status}  ${result.name} (${(result.ms / 1000).toFixed(1)}s)`);
    if (result.code !== 0) {
      const tail = result.output.split('\n').slice(-25).join('\n');
      console.log(tail.replace(/^/gm, '        '));
    }
  }
};
try {
  await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, worker));
} finally {
  server.kill('SIGTERM');
}

const failed = results.filter((result) => result.code !== 0);
const seconds = (results.reduce((total, result) => total + result.ms, 0) / 1000).toFixed(1);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed (${seconds}s cumulative).`);
if (skipped.length) console.log(`Not enforced: ${skipped.length} quarantined check(s) did not run.`);
if (failed.length) {
  console.error(`Failed: ${failed.map((result) => result.name).join(', ')}`);
  process.exit(1);
}
