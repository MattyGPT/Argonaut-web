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
 * All five original entries were found red on 2026-11-11, the first time the
 * suite could be run at all — each had been hand-run-only since it was written.
 * Every one was confirmed red against BOTH the system Chromium 155 and the
 * pinned playwright Chromium 158, so none is a browser-version artifact.
 *
 * **All five were bisected to one commit: `d613faa` (PR #103, 2026-10-10,
 * "Add Reimagined terrain presentation pilot and isotropic map projection").**
 * All five pass at its parent `d3294ac` (#102) and at the commit that introduced
 * each check, so none is an environment artifact and none predates #103. That PR
 * updated the Node tests but could not update these, because they could not be
 * run. The per-check causes below are established, not guessed; the earlier
 * suspects named here (PRs #115 and #117) were disproved by the bisect.
 * See docs/superpowers/reviews/2026-11-11-browser-check-ci.md.
 *
 * `check-combat-console` left this list on 2026-11-12: its overflow was a real
 * layout regression — the Objective strip every Reimagined war shows pushed the
 * whole console below the fold — fixed in the stylesheet, not in the assertion.
 * See docs/superpowers/reviews/2026-11-12-combat-console-overflow.md.
 *
 * `check-target-readiness` left the same day. It was not a layout bug but a race:
 * resizing the viewport fires the app's ResizeObserver, whose redraw replaced the
 * fixture's menu with the app's own all-disabled one between two round-trips.
 * Rendering and measuring now happen inside a single task, where an observer
 * callback cannot interleave. 8/8 runs green afterwards, against 3/5 before.
 * See docs/superpowers/reviews/2026-11-12-p0b-quarantine-bisect.md.
 *
 * Remove an entry when its check passes. Do not add one without a dated review
 * recording the failure and the reason it is not being fixed now.
 */
export const QUARANTINE = Object.freeze({
  'check-battle-journal': 'Structural race with the app render loop: the fixture calls renderGame with a private game, which unhides #terrain-toggle, which resizes #map, which fires the ResizeObserver at app.js:1776 and re-renders the app\'s own game over it. Confirmed — the fixture yields 12 #command-log entries, then 0 within 100ms. Needs re-architecting to drive the app\'s own journal the way check-journal-lifecycle does. The single-task render-and-measure fix that un-quarantined check-target-readiness is necessary here but not sufficient, because this check also clicks and scrolls between renders',
  'check-combat-feedback': 'Hardcodes a square camera window ({minX, minY, size}) that predates the isotropic projection, so the beam is compared against the wrong geometry. Deriving it through cameraWindow(..., aspect) as renderGame does is necessary but NOT sufficient — it still fails, so a second stale geometry assumption remains to be found',
  // 'check-faction-identity' left the quarantine on 2026-11-12. Both of its open
  // causes are settled and fixed: the selected-threat outline assertion recorded a
  // CSS source-order accident as a contract (it is now split by contact density, and
  // the compact case pins the red corner flag alongside the white outline so the
  // threat affordance stays covered), and the classic-rules block now renders and
  // measures inside a single page.evaluate, which is the ResizeObserver race that
  // first turned it red at d613faa. Full evidence and the measurement tables are in
  // docs/superpowers/reviews/2026-11-12-faction-identity-outline-investigation.md.
  // It is also no longer the only coverage of the per-hull accessible name — see
  // test/ship-a11y.test.js.
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
