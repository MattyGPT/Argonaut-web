/**
 * Which browser checks exist, and which of them are known-red.
 *
 * Kept separate from scripts/run-browser-checks.mjs so `npm test` can assert on
 * both without executing the runner: a quarantine list nobody checks rots into
 * a permanent exclusion, which is the failure mode this whole suite exists to
 * prevent.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER_IMPORT = "from './lib/browser.mjs'";

/**
 * Checks that are red for a known reason and are therefore not yet enforced.
 *
 * These are not excluded quietly: the runner prints this list on every run and
 * each entry names the failure it is quarantined for, so an unenforced guard
 * stays visible instead of silently absent.
 *
 * All five were found red on 2026-11-11, the first time the suite could be run
 * at all — each had been hand-run-only since it was written. Every one was
 * confirmed red against BOTH the system Chromium 155 and the pinned playwright
 * Chromium 158, so none is a browser-version artifact. See
 * docs/superpowers/reviews/2026-11-11-browser-check-ci.md.
 *
 * Remove an entry when its check passes. Do not add one without a dated review
 * recording the failure and the reason it is not being fixed now.
 */
export const QUARANTINE = Object.freeze({
  'check-battle-journal': "page.evaluate: Cannot read properties of null (reading 'getBoundingClientRect') — an element the check expects is no longer in the DOM",
  'check-combat-console': 'AssertionError: "reimagined: desktop page scrolls (973)" — a page-scroll expectation; suspect PR #115, which realigned the objective strip and changed page flow',
  'check-combat-feedback': 'AssertionError: "live: endpoint misses the displayed hull" — the drawn beam endpoint exceeds the 2px tolerance against the displayed sprite',
  'check-faction-identity': 'AssertionError: "focused tether ends at the true position without hover-scale overshoot" — the tether endpoint exceeds 4px on a focused hull, which styles.css:188 scales by 1.22',
  'check-target-readiness': "locator.evaluate: Cannot read properties of null (reading 'getBoundingClientRect') in the viewport loop — no enabled menu button, or #map is absent",
});

/**
 * Suite membership is discovered, not hardcoded: a script belongs if and only
 * if it imports the shared launcher. The three checks that need no browser
 * (check-guide-content, check-record-parity, check-campaign-record-parity) are
 * therefore excluded automatically, and so is capture-guide-shots, which writes
 * images into assets/guide rather than asserting anything. Adding a browser
 * check needs no edit here.
 */
export const discoverSuite = async () => {
  const names = (await readdir(scriptsDir)).filter((name) => /^check-.*\.mjs$/.test(name)).sort();
  const members = [];
  for (const name of names) {
    const source = await readFile(join(scriptsDir, name), 'utf8');
    if (source.includes(LAUNCHER_IMPORT)) members.push(name.replace(/\.mjs$/, ''));
  }
  return members;
};
