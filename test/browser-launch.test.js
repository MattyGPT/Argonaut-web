import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_CHANNELS, KNOWN_EXECUTABLES, describeAttempt, launchAttempts } from '../scripts/lib/browser.mjs';
import { QUARANTINE, discoverSuite, scriptsDir } from '../scripts/lib/browser-suite.mjs';

test('a managed, executable or channel request is honored exactly, with no silent substitute', () => {
  // Naming a browser means "this one": falling back to something else would hide
  // a typo or a missing binary behind a different browser's success.
  assert.deepEqual(launchAttempts({ BROWSER_MANAGED: '1' }), [{ headless: true }]);
  assert.deepEqual(launchAttempts({ BROWSER_EXECUTABLE: '/opt/x/browser' }), [{ executablePath: '/opt/x/browser', headless: true }]);
  assert.deepEqual(launchAttempts({ BROWSER_CHANNEL: 'chrome' }), [{ channel: 'chrome', headless: true }]);
  assert.deepEqual(launchAttempts({ BROWSER_MANAGED: '1', BROWSER_EXECUTABLE: '/opt/x/browser' }), [{ headless: true }],
    'BROWSER_MANAGED outranks a named executable so CI pins the revision');
});

test('discovery prefers an installed browser, then channels, then the managed build', () => {
  const exists = (path) => path === '/usr/bin/chromium';
  const attempts = launchAttempts({}, exists);
  assert.deepEqual(attempts[0], { executablePath: '/usr/bin/chromium', headless: true }, 'a browser on disk is tried first');
  assert.deepEqual(attempts[attempts.length - 1], { headless: true }, 'the managed build is the last resort');
  const middle = attempts.slice(1, -1);
  assert.deepEqual(middle, KNOWN_CHANNELS.map((channel) => ({ channel, headless: true })));
  assert.equal(attempts.length, 1 + KNOWN_CHANNELS.length + 1);
  // A machine with nothing installed still gets every channel and the managed
  // build, so the error names what was actually attempted.
  assert.equal(launchAttempts({}, () => false).length, KNOWN_CHANNELS.length + 1);
  assert.ok(KNOWN_EXECUTABLES.length > KNOWN_CHANNELS.length, 'edge, chrome and chromium paths are all known');
});

test('headful debugging is opt-in and never the default', () => {
  assert.equal(launchAttempts({})[0].headless, true);
  assert.equal(launchAttempts({ BROWSER_HEADFUL: '1' })[0].headless, false);
  assert.equal(launchAttempts({ BROWSER_HEADFUL: '0' })[0].headless, true, 'only 1 opens a window');
});

test('each attempt describes itself so a launch failure names the browser', () => {
  assert.equal(describeAttempt({ executablePath: '/usr/bin/chromium' }), 'executablePath /usr/bin/chromium');
  assert.equal(describeAttempt({ channel: 'msedge' }), 'channel msedge');
  assert.equal(describeAttempt({ headless: true }), 'playwright-managed browser');
});

test('the suite is discovered from the shared launcher, so non-browser scripts cannot join it', async () => {
  const suite = await discoverSuite();
  // The three checks that need no browser, and the guide capture tool that
  // writes images instead of asserting, must stay out of the enforced suite.
  for (const excluded of ['check-guide-content', 'check-record-parity', 'check-campaign-record-parity', 'capture-guide-shots']) {
    assert.equal(suite.includes(excluded), false, `${excluded} is not a browser check`);
  }
  assert.ok(suite.length >= 17, `expected the browser checks, found ${suite.length}`);
  for (const name of suite) {
    const source = readFileSync(join(scriptsDir, `${name}.mjs`), 'utf8');
    assert.ok(source.includes("from './lib/browser.mjs'"), `${name} imports the shared launcher`);
  }
});

test('no check hardcodes a browser channel again', async () => {
  // This is the duplication that made the whole suite unrunnable anywhere but
  // one machine: eighteen copies of `channel: 'msedge'`.
  for (const name of readdirSync(scriptsDir).filter((entry) => /^(check-.*|capture-guide-shots)\.mjs$/.test(entry))) {
    const source = readFileSync(join(scriptsDir, name), 'utf8');
    assert.equal(/chromium\.launch\(/.test(source), false, `${name} launches through scripts/lib/browser.mjs`);
    assert.equal(source.includes("channel: 'msedge'"), false, `${name} does not pin a vendor channel`);
  }
});

test('the quarantine names only real checks, so it cannot rot into a permanent exclusion', async () => {
  const suite = await discoverSuite();
  const entries = Object.entries(QUARANTINE);
  assert.ok(entries.length > 0, 'the 2026-11-11 triage quarantined five checks');
  for (const [name, reason] of entries) {
    assert.ok(suite.includes(name), `${name} is a real browser check, not a stale or misspelled entry`);
    assert.ok(typeof reason === 'string' && reason.length > 20, `${name} records the failure it is quarantined for`);
  }
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, 'no duplicate quarantine entries');
});

test('the browser dependency is declared so npm ci reproduces the suite', () => {
  const manifest = JSON.parse(readFileSync(join(scriptsDir, '..', 'package.json'), 'utf8'));
  // playwright-core alone cannot download a browser, and these checks assert
  // geometry and :focus-visible behavior that vary by browser version, so the
  // pinned revision playwright installs is what CI must run against.
  assert.ok(manifest.devDependencies.playwright, 'playwright is declared for its pinned browser');
  assert.ok(manifest.devDependencies['playwright-core'], 'playwright-core is declared for the checks that require it directly');
  assert.equal(manifest.scripts['check:browser'], 'node scripts/run-browser-checks.mjs');
  const workflow = readFileSync(join(scriptsDir, '..', '.github', 'workflows', 'test.yml'), 'utf8');
  assert.ok(workflow.includes('playwright install'), 'CI installs a browser');
  assert.ok(workflow.includes('BROWSER_MANAGED'), 'CI pins the browser revision');
  assert.ok(workflow.includes('check:browser'), 'CI runs the browser suite');
});
