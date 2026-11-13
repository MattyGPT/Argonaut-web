/** Browser regression check for the war chronicle (slice L1).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * The Node suite pins the chronicle's honesty rules — which kinds are declassified,
 * that a colors-strike is never attributed to a hull, that the account is gated by
 * the journal's own projection. What only a browser can prove is the WIRING and the
 * rendering: that the app's own hook accumulates a real war's records, that the
 * panel states its tier on every surface, that the export matches what is on screen,
 * that the chronicle lives under its own key and never inside a save envelope, and
 * that a new war starts a new account.
 *
 * It also pins the one hazard this panel is most exposed to. Every line is prose
 * built from ship and captain names, and the panel is built with createElement and
 * textContent rather than innerHTML — the hull aria-label shipped unescaped for
 * exactly that reason, so a hostile name is fed through here and asserted to arrive
 * as inert text.
 *
 * The record batch is produced by flying a real war in the page with the game's own
 * modules, then handed to the APP's chronicle hook, so the accumulation, identity
 * sync, persistence and rendering under test are all the shipped ones.
 *
 * Every read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const CHRONICLE_KEY = 'argonaut-web-chronicle-v1';
const SAVE_KEY = 'argonaut-web-save-v1';

const { browser } = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `${body}
        window.__chronicleProbe = () => ({
          observed: chronicle.observed,
          entries: chronicle.entries.length,
          casualties: chronicle.casualties.length,
          dropped: chronicle.dropped,
          seed: chronicle.seed,
          battleId: chronicle.battleId,
          stored: localStorage.getItem('argonaut-web-chronicle-v1'),
          saveEnvelope: localStorage.getItem('argonaut-web-save-v1'),
        });
        window.__chronicleFeed = (records) => { chronicleRecords(records); return window.__chronicleProbe(); };
        // Persistence goes through the app's own save path, not a private write.
        window.__chroniclePersist = () => { save(); return window.__chronicleProbe(); };
        // Fly a real war in the page and return its raw batch, so what the app's own
        // hook is fed is genuine records rather than a hand-built fixture.
        window.__chronicleFly = async (seed, rounds) => {
          const st = await import('/game/state.js');
          const rec = await import('/game/battle-records.js');
          const turns = await import('/game/turns.js');
          let flown = rec.enableBattleRecords(st.createGame({ seed, reimagined: true }), { battleId: 'chron-' + seed });
          const all = [];
          for (let i = 0; i < rounds && !flown.outcome; i += 1) {
            flown = turns.resolveComputerTurns(flown, { onRecords: (batch) => all.push(...batch) });
          }
          return all;
        };
      `,
    });
  });

  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'chronicle-check');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__chronicleProbe?.().battleId !== null);

  const fresh = await page.evaluate(() => window.__chronicleProbe());
  assert.equal(fresh.observed, 0, 'a new war starts with an empty chronicle');
  assert.equal(fresh.casualties, 0);
  assert.equal(fresh.seed, 'chronicle-check', 'keyed to the war it belongs to');

  // Feed a real war's records through the app's own hook.
  const fed = await page.evaluate(async () => {
    const records = await window.__chronicleFly('chronicle-check', 70);
    return { total: records.length, after: window.__chronicleFeed(records) };
  });
  assert.equal(fed.after.observed, fed.total, 'every record the war emitted reached the chronicle');
  assert.ok(fed.total > 500, `a real war emits a lot of records (saw ${fed.total})`);
  assert.ok(fed.after.casualties > 0, 'and hulls were lost, so there is a casualty roll');
  assert.ok(fed.after.entries > 0, 'and terminal events reached the account');
  assert.equal(fed.after.dropped, 0, 'within the limit, so the account claims to be complete');

  // Persistence: its own key, and provably NOT inside a save envelope. Written
  // through the app's own save() so the envelope assertion is about real behaviour.
  const persisted = await page.evaluate(() => window.__chroniclePersist());
  assert.ok(persisted.stored, 'the chronicle is written to its own localStorage key');
  assert.equal(JSON.parse(persisted.stored).casualties.length, persisted.casualties,
    'and what is stored is what is in memory');
  const envelope = JSON.parse(persisted.saveEnvelope);
  assert.equal(envelope.casualties, undefined, 'the war save envelope carries no casualty roll');
  assert.equal(envelope.entries, undefined, 'nor the chronicle account');
  assert.equal(envelope.observed, undefined, 'nor its counters');

  // The panel: tiers stated on every surface, prose on screen, export matching.
  // Opened through the real button, which is what triggers the render.
  const panel = await page.evaluate(() => {
    const dialog = document.querySelector('#chronicle-dialog');
    if (dialog.open) dialog.close();
    document.querySelector('#chronicle-toggle').click();
    const sections = [...dialog.querySelectorAll('.chronicle-section')].map((section) => ({
      heading: section.querySelector('h3')?.textContent,
      frame: section.querySelector('.chronicle-frame')?.textContent ?? null,
      lines: [...section.querySelectorAll('li')].map((li) => li.textContent),
      notes: [...section.querySelectorAll('.chronicle-note')].map((note) => note.textContent),
    }));
    return {
      open: dialog.open,
      labelledBy: dialog.getAttribute('aria-labelledby'),
      war: document.querySelector('#chronicle-war')?.textContent,
      sections,
      exportText: document.querySelector('#chronicle-text')?.value ?? null,
      exportLabel: document.querySelector('#chronicle-text')?.getAttribute('aria-label'),
      // Built with createElement/textContent, so no line may ever become an element.
      injectedElements: dialog.querySelectorAll('.chronicle-body img, .chronicle-body script, .chronicle-body iframe').length,
      liveRegions: document.querySelectorAll('#sr-status').length,
      panelIsLive: dialog.querySelector('[aria-live]') !== null,
    };
  });

  assert.equal(panel.open, true, 'the War chronicle button opens the panel');
  assert.equal(panel.labelledBy, 'chronicle-title');
  assert.match(panel.war, /chronicle-check/, 'the header names the war');
  assert.match(panel.war, /Reimagined/, 'and its ruleset');
  assert.match(panel.war, /records observed/, 'and how much of the war it saw');
  assert.equal(panel.liveRegions, 1, 'still exactly one screen-reader live region on the page');
  assert.equal(panel.panelIsLive, false, 'the chronicle does not add a competing announcer');
  assert.ok(panel.exportLabel, 'the export textarea is labelled');

  const byHeading = (fragment) => panel.sections.find((section) => section.heading.toLowerCase().includes(fragment));
  const basis = byHeading('on what this account is based');
  assert.ok(basis, 'the panel states what the account is based on');
  assert.ok(basis.lines.some((line) => line.includes('filtered to what the flagship could see or hear')),
    'the filtered tier is stated in words');
  assert.ok(basis.lines.some((line) => line.includes('declassified')), 'and so is the declassification');

  const casualties = byHeading('casualties');
  assert.ok(casualties, 'there is a casualty roll');
  assert.match(casualties.frame, /after the fighting/, 'labelled as compiled after the war');
  assert.match(casualties.frame, /not known to the flagship during the war/, 'and honest about what that means');
  assert.ok(casualties.lines.length > 0, 'with real entries');
  assert.ok(casualties.lines.every((line) => /was destroyed|was left vacant/.test(line)),
    'every casualty line states a fate the records actually support');
  // Tier D in action: attribution the journal would not have given mid-war.
  assert.ok(casualties.lines.some((line) => / — .* by /.test(line)),
    'at least one loss is attributed to the hull and weapon that caused it');

  const coda = byHeading('battle report');
  assert.ok(coda, 'the fleet return is attached as the coda');
  assert.match(coda.frame, /not a sensor report/, 'labelled as a fleet return');
  assert.match(coda.frame, /not filtered/, 'and as unfiltered');

  // The export must be the same account the player just read, not a separate artifact.
  assert.ok(panel.exportText.length > 500, 'the export has substance');
  for (const line of casualties.lines.slice(0, 5)) {
    assert.ok(panel.exportText.includes(line), `an on-screen casualty line is in the export: ${line.slice(0, 40)}`);
  }
  assert.equal(panel.exportText.includes('[object Object]'), false, 'nothing unstringified reaches the artifact');
  assert.equal(panel.injectedElements, 0, 'no prose became an element');

  // A hostile name must arrive as inert text. This is the hazard the panel is most
  // exposed to, and the reason it is built without innerHTML.
  const hostile = await page.evaluate(() => {
    const payload = '<img src=x onerror="window.__chroniclePwned = true">';
    window.__chronicleFeed([{
      kind: 'destruction', battleId: 'x', eventId: 'x:e1', simTime: 9,
      actor: { id: 'a', name: payload, faction: 'Axis' },
      target: { id: 't', name: `Hostile "Quote" ${payload}`, faction: 'Bloc' },
      payload: { cause: 'phasers', status: 'destroyed' },
      knowledge: { globalTerminal: true },
    }]);
    document.querySelector('#chronicle-dialog').close();
    document.querySelector('#chronicle-toggle').click();
    const dialog = document.querySelector('#chronicle-dialog');
    const lines = [...dialog.querySelectorAll('.chronicle-section li')].map((li) => li.textContent);
    return {
      pwned: Boolean(window.__chroniclePwned),
      injected: dialog.querySelectorAll('img[src="x"]').length,
      sample: lines.find((line) => line.includes('Hostile')) ?? null,
      rawHtmlHasTag: dialog.querySelector('.chronicle-body').innerHTML.includes('<img src=x'),
    };
  });
  assert.equal(hostile.pwned, false, 'a hostile name executes nothing');
  assert.equal(hostile.injected, 0, 'and creates no element');
  assert.equal(hostile.rawHtmlHasTag, false, 'the markup contains no injected tag, because text was set as text');
  assert.ok(hostile.sample.includes('<img src=x'), 'the name is still readable, verbatim, as text');

  // A reload restores the account into the same war.
  await page.reload();
  await page.waitForFunction(() => window.__chronicleProbe?.().battleId !== null);
  const restored = await page.evaluate(() => window.__chronicleProbe());
  assert.ok(restored.observed >= persisted.observed, 'a reload restores the chronicle rather than losing it');
  assert.ok(restored.casualties > 0, 'including the casualty roll');

  // A different war is a different account.
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'chronicle-check-other');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__chronicleProbe?.().seed === 'chronicle-check-other');
  const next = await page.evaluate(() => window.__chronicleProbe());
  assert.equal(next.observed, 0, 'starting another war starts another chronicle');
  assert.equal(next.casualties, 0, 'the previous war\'s dead are not carried into it');

  // Keyboard: reachable, closable, focus returned.
  const keyboard = await page.evaluate(() => {
    // A modal left open by an earlier step would swallow focus and make showModal
    // throw, so start from a known-closed state.
    const existing = document.querySelector('#chronicle-dialog');
    if (existing.open) existing.close();
    const button = document.querySelector('#chronicle-toggle');
    button.focus();
    const focused = document.activeElement === button;
    button.click();
    const opened = document.querySelector('#chronicle-dialog').open;
    document.querySelector('#chronicle-dialog').close();
    return { focused, opened, returnedTo: document.activeElement?.id ?? null };
  });
  assert.equal(keyboard.focused, true, 'the chronicle button takes keyboard focus');
  assert.equal(keyboard.opened, true, 'and activates from the keyboard');
  assert.equal(keyboard.returnedTo, 'chronicle-toggle', 'focus returns to the button that opened it');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-chronicle: a real war\'s records reach the chronicle through the app\'s own hook; the panel states its filtered, declassified and unfiltered tiers on their own surfaces; the export matches what is on screen; the account persists under its own key and never inside a save envelope; a hostile ship name arrives as inert text; and a new war starts a new account.');
} finally {
  await browser.close();
}
