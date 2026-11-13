/** Browser regression check for the rules-revision stamp (slice S0).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * The stamp exists so a shared replay or a resumed war can say whether it was
 * produced by the rules now in force. Two properties matter and only a browser can
 * prove them together: the warning is genuinely NON-FATAL — the old war still loads
 * and is still playable, because an old war is worth finishing — and it is
 * self-healing, because the app re-stamps the envelope the moment it saves again.
 *
 * Also pinned: the notice must not become a second live region. `#sr-status` is
 * rewritten by renderGame on every render, so a notice placed there would be
 * clobbered before it could be read; this one is a persistent role="note".
 *
 * Each read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';
import { RULES_REVISION } from '../game/constants.js';

const SAVE_KEY = 'argonaut-web-save-v1';
const OLD_REVISION = 'rules-1999-01-01a';
const url = process.env.GAME_URL || 'http://localhost:8080';

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  const settle = async () => {
    await page.waitForFunction(() => document.querySelector('#map')?.childElementCount > 0);
    return page.evaluate(() => {
      const note = document.querySelector('#rules-notice');
      const saved = JSON.parse(localStorage.getItem('argonaut-web-save-v1') ?? 'null');
      return {
        hidden: note.hidden,
        text: note.textContent,
        role: note.getAttribute('role'),
        // Not a second announcer: no ancestor may be a live region.
        inLiveRegion: note.closest('[aria-live]') !== null,
        srStatusCount: document.querySelectorAll('#sr-status').length,
        stamp: saved?.rulesRevision ?? null,
        // "Non-fatal" has to mean playable, not merely parsed.
        ships: document.querySelectorAll('#map .ship').length,
      };
    });
  };

  // Rewrite the stored stamp, then reload. `revision === null` removes the key
  // entirely, to stand in for a save written before the stamp existed. Only
  // serializable values cross into the page.
  const restamp = async (revision) => {
    await page.evaluate(([key, rev]) => {
      const saved = JSON.parse(localStorage.getItem(key));
      if (rev === null) delete saved.rulesRevision;
      else saved.rulesRevision = rev;
      localStorage.setItem(key, JSON.stringify(saved));
    }, [SAVE_KEY, revision]);
    await page.reload();
    return settle();
  };

  // A fresh war stamps itself with the revision in force and warns about nothing.
  await page.goto(url);
  const fresh = await settle();
  assert.equal(fresh.stamp, RULES_REVISION, 'a fresh save is stamped with the current rules revision');
  assert.equal(fresh.hidden, true, 'and a current save raises no warning');
  assert.equal(fresh.role, 'note', 'the notice is a note, not an announcement');
  assert.equal(fresh.inLiveRegion, false, 'it does not add a competing live region');
  assert.equal(fresh.srStatusCount, 1, 'the single #sr-status announcer is preserved');
  assert.ok(fresh.ships > 0, 'the fixture war really loaded');

  // The same envelope, stamped as though written under older rules.
  const stale = await restamp(OLD_REVISION);
  assert.equal(stale.hidden, false, 'a save from an older ruleset raises the warning');
  assert.match(stale.text, new RegExp(OLD_REVISION), 'it names the revision the save was written under');
  assert.match(stale.text, new RegExp(RULES_REVISION), 'and the revision now in force');
  assert.match(stale.text, /still plays/, 'the warning states plainly that it is not fatal');
  assert.match(stale.text, /may not reproduce/, 'and says what the actual risk is');
  assert.ok(stale.ships > 0, 'the war still loaded and rendered under the older stamp');
  assert.equal(stale.srStatusCount, 1, 'still exactly one live region while the notice is up');

  // The app saved again while loading, so the envelope is already re-stamped and the
  // next load is clean: the notice is self-healing, not permanent.
  await page.reload();
  const healed = await settle();
  assert.equal(healed.stamp, RULES_REVISION, 'loading re-stamped the envelope with the current revision');
  assert.equal(healed.hidden, true, 'so the warning clears on the next load without any user action');

  // A save that predates the stamp must stay SILENT, not warn. Every save in
  // existence was written by the rules in force now, so warning there would be a
  // false claim; and because loading re-stamps the envelope, the window closes on
  // the first load. This is also why hand-built fixtures in the other checks —
  // which stamp no revision — must not sprout a notice and shift the layout.
  const unstamped = await restamp(null);
  assert.equal(unstamped.hidden, true, 'an unstamped save does not warn');
  assert.equal(unstamped.stamp, RULES_REVISION, 'and it is stamped on the load that read it');
  assert.ok(unstamped.ships > 0, 'it is playable');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-rules-revision: every save is stamped with the rules revision in force; a save stamped under older rules still loads and plays but says so in a persistent non-live note naming both revisions; the warning clears itself once the envelope is saved again; and an unstamped pre-versioning save stays silent rather than making a claim that is not true.');
} finally {
  await browser.close();
}
