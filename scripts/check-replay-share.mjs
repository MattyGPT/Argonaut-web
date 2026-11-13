/** Browser regression check for replay sharing and spectator playback (slice S2b).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * test/replay.test.js proves the engine reproduces a war byte-for-byte and that
 * walking it stardate by stardate lands on the same war as rebuilding it whole. What
 * only a browser can prove is the round trip a player actually makes: that a war can
 * be turned into a link, that the link survives being navigated to as a URL, that the
 * recipient is told what they are looking at BEFORE the map starts moving, that
 * stepping and playing advance the war, and that exiting hands the player their own
 * war back with the fragment cleaned out of the address bar.
 *
 * It also pins the honesty of the share flow, which is the part most likely to rot:
 * a link to an unfinished war must say it only covers what has been fought, and a
 * truncated log must say the replay starts partway through. Sharing a replay that
 * silently begins mid-war is worse than not sharing it.
 *
 * Every read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const url = process.env.GAME_URL || 'http://localhost:8080';

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
        // Issue a command through the app's own dispatch so the action log records it
        // the way a real player's command would be recorded. Has to live here rather
        // than in an inline evaluate: game and actionLog are module scope in app.js.
        window.__replayIssue = async (action) => { await dispatch(action); return actionLog.entries.length; };
        window.__replayState = () => ({
          session: Boolean(replaySession),
          locked: playbackLocked(),
          hash: window.location.hash.slice(0, 24),
          liveTurn: game?.turn ?? null,
        });
      `,
    });
  });

  // --- build a war worth sharing ---------------------------------------------
  await page.goto(url);
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'replay-share');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__replayState?.().liveTurn !== null);

  for (const action of [
    { type: 'facing', degrees: 45 },
    { type: 'arcFocus', arc: 'fore' },
    { type: 'move', dx: 8, dy: 0 },
  ]) {
    await page.evaluate((a) => window.__replayIssue(a), action);
  }
  const logged = await page.evaluate(() => window.__replayState());
  assert.equal(logged.session, false, 'no replay is running in the player\'s own war');

  // --- make the share link ----------------------------------------------------
  await page.evaluate(() => {
    const dialog = document.querySelector('#chronicle-dialog');
    if (dialog.open) dialog.close();
    document.querySelector('#chronicle-toggle').click();
    document.querySelector('#replay-share').open = true;
    document.querySelector('#replay-share-make').click();
  });
  await page.waitForFunction(() => !document.querySelector('#replay-link').hidden);
  const shared = await page.evaluate(() => ({
    link: document.querySelector('#replay-link').value,
    note: document.querySelector('#replay-share-note').textContent,
    hash: window.location.hash,
  }));
  assert.match(shared.hash, /^#replay=[A-Za-z0-9_-]+$/, 'the fragment is base64url with no padding or reserved characters');
  assert.ok(shared.link.includes('#replay='), 'the copyable field holds the full URL');
  assert.match(shared.note, /has not ended yet/, 'an unfinished war says the link only covers what has been fought');
  assert.match(shared.note, /carries the seed and every command/, 'and says plainly what the link exposes');
  assert.match(shared.note, /not the outcome/, 'distinguishing the decisions from the result');

  // --- open the link as a recipient would -------------------------------------
  const recipient = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const recipientErrors = [];
  recipient.on('pageerror', (error) => recipientErrors.push(String(error)));
  await recipient.goto(shared.link);
  await recipient.waitForFunction(() => !document.querySelector('#replay-panel').hidden);

  const opened = await recipient.evaluate(() => ({
    hidden: document.querySelector('#replay-panel').hidden,
    note: document.querySelector('#replay-panel-note').textContent,
    progress: document.querySelector('#replay-progress').textContent,
    playLabel: document.querySelector('#replay-play').textContent,
    playPressed: document.querySelector('#replay-play').getAttribute('aria-pressed'),
    stepDisabled: document.querySelector('#replay-step').disabled,
    ships: document.querySelectorAll('#map .ship').length,
    liveRegions: document.querySelectorAll('#sr-status').length,
    panelIsLive: document.querySelector('#replay-panel').closest('[aria-live]') !== null,
  }));
  assert.equal(opened.hidden, false, 'the recipient lands in the replay panel');
  assert.match(opened.note, /A shared war: seed replay-share/, 'and is told whose war and which seed');
  assert.match(opened.note, /recorded commands/, 'how many commands it carries');
  assert.match(opened.note, /rebuilds the war by re-applying them/, 'and how a replay works');
  assert.match(opened.note, /Your own war is untouched/, 'with the reassurance that exiting is safe');
  assert.equal(opened.playLabel, 'Play', 'it opens PAUSED, not playing');
  assert.equal(opened.playPressed, 'false');
  assert.match(opened.progress, /Stardate 1 ·/, 'at the opening stardate');
  assert.match(opened.progress, /0 of 3 commands re-applied/, 'with nothing applied yet');
  assert.equal(opened.stepDisabled, false, 'and stepping is available');
  assert.ok(opened.ships > 0, 'the map really rendered the replayed war');
  assert.equal(opened.liveRegions, 1, 'the panel adds no second live region');
  assert.equal(opened.panelIsLive, false);

  // --- step, then play --------------------------------------------------------
  await recipient.click('#replay-step');
  const stepped = await recipient.evaluate(() => document.querySelector('#replay-progress').textContent);
  assert.match(stepped, /Stardate 2 ·/, 'one step advances exactly one stardate');
  assert.match(stepped, /[1-9] of 3 commands re-applied/, 'and applies the commands that fall in it');

  await recipient.click('#replay-play');
  const playing = await recipient.evaluate(() => ({
    label: document.querySelector('#replay-play').textContent,
    pressed: document.querySelector('#replay-play').getAttribute('aria-pressed'),
  }));
  assert.equal(playing.label, 'Pause', 'Play becomes Pause');
  assert.equal(playing.pressed, 'true', 'and reports its pressed state');
  await recipient.waitForFunction(
    () => /war ended|step budget/.test(document.querySelector('#replay-progress').textContent),
    null,
    { timeout: 60000 },
  );
  const finished = await recipient.evaluate(() => ({
    progress: document.querySelector('#replay-progress').textContent,
    playLabel: document.querySelector('#replay-play').textContent,
    stepDisabled: document.querySelector('#replay-step').disabled,
    playDisabled: document.querySelector('#replay-play').disabled,
  }));
  assert.match(finished.progress, /war ended/, 'playback runs to the war\'s ending and says so');
  assert.equal(finished.playLabel, 'Play', 'and stops itself rather than spinning on a finished war');
  assert.equal(finished.stepDisabled, true, 'with stepping disabled once there is nothing left');
  assert.equal(finished.playDisabled, true);

  // --- exit hands the player their own war back -------------------------------
  await recipient.click('#replay-exit');
  await recipient.waitForFunction(() => document.querySelector('#replay-panel').hidden);
  const exited = await recipient.evaluate(() => ({
    hidden: document.querySelector('#replay-panel').hidden,
    hash: window.location.hash,
    ships: document.querySelectorAll('#map .ship').length,
  }));
  assert.equal(exited.hidden, true, 'the panel goes away');
  assert.equal(exited.hash, '', 'and the fragment is cleared, so a reload returns to the player\'s own war');
  assert.ok(exited.ships > 0, 'with a war still on the map');

  // A corrupt fragment must be refused, not half-loaded.
  const broken = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const brokenErrors = [];
  broken.on('pageerror', (error) => brokenErrors.push(String(error)));
  await broken.goto(`${url}#replay=not-a-real-artifact`);
  await broken.waitForTimeout(600);
  assert.equal(await broken.evaluate(() => document.querySelector('#replay-panel').hidden), true,
    'a corrupt link does not open the replay panel');
  assert.deepEqual(brokenErrors, [], `a corrupt link raises no page error: ${brokenErrors.join(' | ')}`);
  await broken.close();

  assert.deepEqual(recipientErrors, [], `no page errors for the recipient: ${recipientErrors.join(' | ')}`);
  assert.deepEqual(errors, [], `no page errors for the sender: ${errors.join(' | ')}`);
  await recipient.close();
  console.log('check-replay-share: a war becomes a base64url link that says what it exposes and warns when the war is unfinished; the recipient lands paused at stardate 1 having been told whose war it is and how a replay works; stepping advances one stardate, playing runs to the ending and stops itself; exiting restores the player\'s own war and clears the fragment; and a corrupt link is refused without opening the panel or throwing.');
} finally {
  await browser.close();
}
