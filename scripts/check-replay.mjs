/** Browser regression check for replay verification (slice S2).
 * Runs the whole suite with npm run check:browser, which boots server.js itself;
 * or npm start and then node this file. Browser resolution, the pinned build and
 * the BROWSER_* overrides: scripts/lib/browser.mjs.
 *
 * test/replay.test.js proves the engine reproduces a war byte-for-byte in both
 * timing models. What only a browser can prove is the control a player actually
 * touches: that it refuses honestly when there is nothing to rebuild from or the war
 * is not over yet — rather than reporting a divergence that is really just "you are
 * not finished" — and that on a finished war it really does rebuild the war in the
 * page and report an exact reproduction.
 *
 * The finished war is flown in the page through the app's own modules and handed to
 * the app's own `game` and `actionLog`, so the button under test is reading real
 * state rather than a fixture shaped to suit it.
 *
 * Every read-and-measure pair happens inside a single page.evaluate, so the app's
 * ResizeObserver cannot interleave.
 */
import assert from 'node:assert/strict';
import { launchBrowser } from './lib/browser.mjs';

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
        window.__replayProbe = () => ({
          entries: actionLog.entries.length,
          dropped: actionLog.dropped,
          outcome: Boolean(game?.outcome),
          status: document.querySelector('#replay-status')?.textContent ?? null,
          inDialog: Boolean(document.querySelector('#replay-verify')?.closest('#chronicle-dialog')),
          liveRegions: document.querySelectorAll('#sr-status').length,
          statusIsLive: document.querySelector('#replay-status')?.closest('[aria-live]') !== null
            || document.querySelector('#replay-status')?.getAttribute('aria-live') !== null,
        });
        window.__replayClick = async () => {
          document.querySelector('#replay-verify').click();
          // Poll for the status to change rather than sleeping a fixed interval: the
          // rebuild is synchronous on the main thread, so a timer can only fire once
          // it has finished, and a fixed sleep would either be too short or wasteful.
          for (let i = 0; i < 1200; i += 1) {
            await new Promise((resolve) => { setTimeout(resolve, 50); });
            const text = document.querySelector('#replay-status')?.textContent ?? '';
            if (text && !text.startsWith('Rebuilding')) break;
          }
          return window.__replayProbe();
        };
        // Issue one command through the app's own seams. Has to live here rather than
        // in an inline page.evaluate: game and actionLog are module scope in app.js,
        // not globals, so only appended code can reach them.
        window.__replayIssue = (action) => {
          const outcome = applyPlayerAction(game, action);
          if (outcome.game !== game) {
            actionLog = recordAction(actionLog, game, action);
            game = outcome.game;
            refresh({ persist: false });
          }
          return window.__replayProbe();
        };
        // Fly a real war to its ending through the same seams the app uses, then hand
        // it to the app's own state so the button reads genuine data.
        window.__replayFinishWar = async (seed, realtime) => {
          const st = await import('/game/state.js');
          const rec = await import('/game/battle-records.js');
          const turns = await import('/game/turns.js');
          const act = await import('/game/actions.js');
          const AL = await import('/game/action-log.js');
          const battleId = 'replay-check-' + seed;
          let g = rec.enableBattleRecords(st.createGame({ seed, reimagined: true, realtime }), { battleId });
          let log = AL.createActionLog({ seed, battleId, realtime });
          const foe = (state) => {
            const own = st.getShip(state, state.playerShipId);
            let best = null;
            for (const ship of state.ships) {
              if (ship.faction === own.faction || ship.status === 'destroyed') continue;
              if (!best || st.distance(ship, own) < st.distance(best, own)) best = ship;
            }
            return best;
          };
          for (let i = 0; i < 40000 && !g.outcome; i += 1) {
            if (i % 17 === 0) {
              const target = foe(g);
              if (target) {
                const swept = act.sensorSweep(g, target.id);
                if (swept !== g) { log = AL.recordSweep(log, g, target.id); g = swept; }
              }
            }
            const own = st.getShip(g, g.playerShipId);
            const target = foe(g);
            const action = !target ? { type: 'facing', degrees: 90 }
              : st.distance(own, target) <= 30 ? { type: 'phasers', targetId: target.id }
                : { type: 'move', dx: Math.sign(target.x - own.x) * 12, dy: Math.sign(target.y - own.y) * 12 };
            const outcome = act.applyPlayerAction(g, action);
            if (outcome.game !== g) { log = AL.recordAction(log, g, action); g = outcome.game; }
            if (!realtime) {
              if (!g.outcome) g = turns.resolveComputerTurns(g.phase === 'computer' ? g : { ...g, phase: 'computer' });
            } else if (!g.outcome) {
              g = turns.stepContinuum(g).game;
            }
          }
          game = g;
          actionLog = log;
          refresh({ persist: false });
          return { entries: log.entries.length, sweeps: log.entries.filter((e) => e.kind === 'sweep').length, outcome: g.outcome?.kind ?? null, turn: g.turn };
        };
      `,
    });
  });

  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'reimagined');
  await page.fill('#new-seed', 'replay-check');
  await page.click('#new-game-form button[value="confirm"]');
  await page.waitForFunction(() => window.__replayProbe?.().liveRegions === 1);

  // The control lives in the chronicle dialog, is labelled, and adds no announcer.
  await page.evaluate(() => {
    const dialog = document.querySelector('#chronicle-dialog');
    if (dialog.open) dialog.close();
    document.querySelector('#chronicle-toggle').click();
  });
  const placement = await page.evaluate(() => window.__replayProbe());
  assert.equal(placement.inDialog, true, 'the verify control lives in the chronicle dialog, not the topbar');
  assert.equal(placement.liveRegions, 1, 'still exactly one screen-reader live region');
  assert.equal(placement.statusIsLive, false, 'the status line is not a competing announcer');
  assert.equal(placement.entries, 0, 'a brand-new war has issued no commands');

  // Guard 1: nothing to rebuild from.
  const empty = await page.evaluate(() => window.__replayClick());
  assert.match(empty.status, /No commands have been issued/, 'it says there is nothing to replay rather than claiming success');

  // Guard 2: commands exist but the war is unfinished. The driver flies to the ending,
  // so comparing now would report a divergence that is really just "not finished".
  const issued = await page.evaluate(() => window.__replayIssue({ type: 'facing', degrees: 45 }));
  const midWar = await page.evaluate(() => window.__replayProbe());
  assert.ok(issued.entries > 0 && midWar.entries > 0, 'the fixture issued a command');
  assert.equal(midWar.outcome, false, 'and the war is still being fought');
  const unfinished = await page.evaluate(() => window.__replayClick());
  assert.match(unfinished.status, /only be compared once it has ended/,
    'an unfinished war is refused with the reason, not reported as a divergence');

  // The real thing: fly a war to its ending and verify it rebuilds exactly.
  assert.deepEqual(errors, [], `no page errors before the rebuild: ${errors.join(' | ')}`);
  for (const realtime of [false, true]) {
    const flown = await page.evaluate((rt) => window.__replayFinishWar(`replay-finished-${rt}`, rt), realtime);
    assert.ok(flown.outcome, `the ${realtime ? 'real-time' : 'turn-based'} fixture war really ended (${flown.outcome})`);
    assert.ok(flown.entries > 5, `and the player issued commands (${flown.entries})`);
    assert.ok(flown.sweeps > 0, `including sensor sweeps (${flown.sweeps}), the one write that bypasses the action seam`);
    const verified = await page.evaluate(() => window.__replayClick());
    assert.deepEqual(errors, [], `${realtime ? 'real-time' : 'turn-based'}: no page error during the rebuild: ${errors.join(' | ')}`);
    assert.match(verified.status, /Reproduced exactly/,
      `${realtime ? 'real-time' : 'turn-based'}: the in-page rebuild matched the war that was flown — got: ${verified.status}`);
    assert.match(verified.status, new RegExp(`${flown.entries} of ${flown.entries} recorded commands`),
      'and it reports that every recorded command was re-applied');
    assert.match(verified.status, /identical state/);
    assert.match(verified.status, /encodes to \d+ characters/, 'and reports the artifact size');
    const size = Number(/encodes to (\d+) characters/.exec(verified.status)[1]);
    assert.ok(size > 0 && size < 20000, `a whole war fits in a URL fragment (${size} chars)`);
  }

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`);
  console.log('check-replay: the verify control refuses honestly when there is nothing to rebuild from and when the war is unfinished, and on a finished war it rebuilds the war in the page from seed, options and recorded commands alone — matching byte-for-byte in both timing models — and reports the artifact size that makes a URL-fragment share possible.');
} finally {
  await browser.close();
}
