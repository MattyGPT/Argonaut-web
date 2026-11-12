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
 * Chromium 158, so none is a browser-version artifact.
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
 * Remove an entry when its check passes. Do not add one without a dated review
 * recording the failure and the reason it is not being fixed now.
 */
export const QUARANTINE = Object.freeze({
  'check-battle-journal': 'Structural race with the app render loop: the fixture calls renderGame with a private game, which unhides #terrain-toggle, which resizes #map, which fires the ResizeObserver at app.js:1776 and re-renders the app\'s own game over it. Confirmed — the fixture yields 12 #command-log entries, then 0 within 100ms. Needs re-architecting to drive the app\'s own journal the way check-journal-lifecycle does',
  'check-combat-console': 'Two separate causes. (a) The old pageHeight<=viewport assertion contradicts the min-height:760px that #103 added deliberately, with a comment, so short viewports scroll rather than compress the isotropic field — now encoded as a scroll budget. (b) With that accounted for, a REAL overflow remains: 1114px of content at 1600x1000 that the documented minimum does not explain. That is a probable genuine layout regression from #103 and is the reason this stays quarantined',
  'check-combat-feedback': 'Hardcodes a square camera window ({minX, minY, size}) that predates the isotropic projection, so the beam is compared against the wrong geometry. Deriving it through cameraWindow(..., aspect) as renderGame does is necessary but NOT sufficient — it still fails, so a second stale geometry assumption remains to be found',
  'check-faction-identity': 'Assumes a fanned-out stack tether points at the centre of #map. #103 made #map-field a square base layer whose side is the smaller viewport dimension, so the layer centre and the map centre no longer coincide on a non-square viewport. Also the only coverage the per-hull aria-label/role surface has anywhere',
  'check-target-readiness': 'Flaky, with two distinct modes. (a) At 390x844 the deliberate #game-root minimum puts the menu below the fold, so elementFromPoint returns null for a point outside the viewport — now fixed by scrolling the control into view first. (b) Intermittently menu.querySelector("button:not(:disabled)") is null, i.e. the fixture reaches a state with no enabled command, so its cooldown setup is not deterministic. Now reported as a named assertion instead of a TypeError; (b) still needs fixing before this can be enforced',
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
