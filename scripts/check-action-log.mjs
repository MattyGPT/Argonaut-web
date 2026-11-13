/** Browser regression check for the retained action log (slice S1).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * The Node suite pins the log's shape, keying, bounding and restore rules. What only
 * a browser can prove is the WIRING: that commands issued through the real dispatch
 * path are recorded, that the ones the rules refuse are not, that the hover sensor
 * sweep — the one authoritative write that bypasses applyPlayerAction — is captured
 * as its own entry kind, that the log survives a reload under its own storage key
 * rather than inside a save envelope, and that starting a different war starts a
 * different log.
 *
 * The seam is appended to app.js by route interception, the way check-new-game and
 * check-journal-lifecycle do it: no production hook, and the probe only reads.
 *
 * Every read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

const LOG_KEY = 'argonaut-web-action-log-v1';
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
        window.__logProbe = () => ({
          log: JSON.parse(JSON.stringify(actionLog)),
          complete: actionLog.dropped === 0,
          seed: game?.seed ?? null,
          battleId: game?.battleRecordState?.battleId ?? null,
          realtime: Boolean(game?.realtime),
          turn: game?.turn ?? null,
          stored: localStorage.getItem('argonaut-web-action-log-v1'),
          saveEnvelope: localStorage.getItem('argonaut-web-save-v1'),
        });
        window.__logCommand = async (action) => { await dispatch(action); return window.__logProbe(); };
        window.__logSweep = (shipId) => { readHull(shipId); return window.__logProbe(); };
        // Pick a hull the rules will actually let the sweep identify. sensorSweep
        // gates on the Scan command's own eligibility — reach, nebula static, a live
        // scanner — so the first opposing hull in the array is usually out of reach
        // at the opening, and guessing would make this check flake per seed.
        window.__scannableFoe = async () => {
          const { sensorSweep } = await import('/game/actions.js');
          const own = (game?.ships ?? []).find((ship) => ship.id === game?.playerShipId);
          return (game?.ships ?? []).find((ship) => ship.status !== 'destroyed'
            && own && ship.faction !== own.faction
            && sensorSweep(game, ship.id) !== game)?.id ?? null;
        };
      `,
    });
  });

  await page.goto(process.env.GAME_URL || 'http://localhost:8080');

  // A fixed seed, so the opening disposition — and therefore which commands are in
  // range — is the same on every run.
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'action-log-check');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__logProbe?.().battleId !== null);

  const opened = await page.evaluate(() => window.__logProbe());
  assert.deepEqual(opened.log.entries, [], 'a new war starts with an empty log');
  assert.equal(opened.log.seed, opened.seed, 'the log is keyed to the war it belongs to');
  assert.equal(opened.log.battleId, opened.battleId);
  assert.equal(opened.log.realtime, opened.realtime);
  assert.equal(opened.complete, true, 'and it claims to be complete, because it is');
  assert.equal(opened.log.dropped, 0);

  // An accepted command is recorded, against the state it was issued on.
  const afterTurn = await page.evaluate(() => window.__logCommand({ type: 'facing', degrees: 45 }));
  assert.equal(afterTurn.log.entries.length, 1, 'an accepted command is logged');
  const helm = afterTurn.log.entries[0];
  assert.equal(helm.kind, 'action');
  assert.equal(helm.type, 'facing');
  assert.equal(helm.seq, 1);
  assert.equal(helm.turn, 1, 'keyed by game.turn, not by position in the array');
  assert.deepEqual(helm.request, { degrees: 45 }, 'the payload is the rules layer\'s own whitelist');
  assert.equal(helm.tick, undefined, 'a turn-based entry carries no tick');

  // Refusals are not logged: the rules returned the identical game object, so there
  // is nothing for a replay to reproduce. Two kinds of refusal, both geometry-free so
  // the fixture cannot flake on a different opening disposition.
  const afterRefusal = await page.evaluate(() => window.__logCommand({ type: 'stance', stance: 'aggressive' }));
  assert.equal(afterRefusal.log.entries.length, 1, 'an unknown stance is refused and records nothing');
  const afterUnreachable = await page.evaluate(() => window.__logCommand({ type: 'move', dx: 900, dy: 0 }));
  assert.equal(afterUnreachable.log.entries.length, 1, 'a displacement beyond engine reach is refused and records nothing');
  assert.equal(afterUnreachable.log.nextSeq, 2, 'and a refusal does not burn a sequence number');

  // The hover sweep is the one authoritative write that bypasses applyPlayerAction,
  // and it must be captured as its own kind or a replay misses game.scanned.
  const foeId = await page.evaluate(() => window.__scannableFoe());
  assert.ok(foeId, 'the fixture war has an opposing hull within scanner reach');
  const swept = await page.evaluate((id) => window.__logSweep(id), foeId);
  assert.equal(swept.log.entries.length, 2, 'a sensor sweep that changes state is logged');
  const sweep = swept.log.entries[1];
  assert.equal(sweep.kind, 'sweep', 'as a distinct kind, never folded in with actions');
  assert.equal(sweep.targetId, foeId);
  assert.equal(sweep.type, undefined, 'a sweep is not a command');
  assert.equal(sweep.seq, 2, 'and it shares one ordering with actions, so interleaving survives');
  const rescanned = await page.evaluate((id) => window.__logSweep(id), foeId);
  assert.equal(rescanned.log.entries.length, 2, 're-scanning an already-identified hull logs nothing');

  // Persistence: its own key, and provably NOT inside a save envelope. Asserted
  // structurally rather than by substring — the journal legitimately stores a
  // `nextSequence` counter, so a naive includes('nextSeq') would match it.
  const persisted = await page.evaluate(() => window.__logProbe());
  assert.ok(persisted.stored, 'the log is written to its own localStorage key');
  assert.deepEqual(JSON.parse(persisted.stored).entries, persisted.log.entries, 'and what is stored is what is in memory');
  const envelope = JSON.parse(persisted.saveEnvelope);
  assert.equal(envelope.entries, undefined, 'the war save envelope carries no log entries');
  assert.equal(envelope.nextSeq, undefined, 'nor the log sequence counter');
  assert.equal(envelope.dropped, undefined, 'nor its overflow count');
  assert.equal(envelope.rulesRevision !== undefined, true, 'the envelope still carries what it is supposed to');
  assert.equal(persisted.stored === persisted.saveEnvelope, false, 'the log is a separate record, not a copy of the save');

  // A reload restores it into the same war.
  await page.reload();
  await page.waitForFunction(() => window.__logProbe?.().battleId !== null);
  const restored = await page.evaluate(() => window.__logProbe());
  assert.deepEqual(restored.log.entries, persisted.log.entries, 'a reload restores the log exactly');
  assert.equal(restored.log.nextSeq, persisted.log.nextSeq, 'including where the sequence left off');
  assert.equal(restored.complete, true);

  // A different war is a different log: the previous commands must not follow.
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'action-log-check-other');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__logProbe?.().battleId !== null);
  const fresh = await page.evaluate(() => window.__logProbe());
  assert.deepEqual(fresh.log.entries, [], 'starting another war starts another log');
  assert.equal(fresh.log.seed, 'action-log-check-other');
  assert.notEqual(fresh.log.battleId, persisted.log.battleId, 'and it is a genuinely different battle identity');

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-action-log: accepted commands are recorded against the turn they were issued on, refusals record nothing, the hover sensor sweep is captured as its own entry kind and only when it changes state, the log persists under its own key and never inside a save envelope, and a new war starts a new log.');
} finally {
  await browser.close();
}
