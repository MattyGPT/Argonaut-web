/** Optional Edge regression for starting a new war during live combat.
 * Start npm start; set PLAYWRIGHT_MODULE to an existing playwright-core install.
 * All fixtures and test-only app instrumentation use an isolated browser context.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { REALTIME } from '../game/constants.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__newGameSnapshot = () => ({ seed: game?.seed, realtime: Boolean(game?.realtime), reimagined: Boolean(game?.reimagined), time: game?.simTime, turn: game?.turn, paused: Boolean(view.paused), locked: playbackLocked(), open: newGameDialog.open, state: JSON.stringify(game), accumulator: simAccumulator });
      window.__newGameTestLock = locked => { presentingTerminalEvents = locked; };
    ` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const snapshot = () => page.evaluate(() => window.__newGameSnapshot());
  const fixture = async (fragile = false) => {
    await page.evaluate(async fragile => {
      const { createGame } = await import('/game/state.js');
      const game = createGame({ seed: 'new-game-race', realtime: true });
      if (fragile) {
        game.ships = game.ships.filter(s => ['fed-flagship', 'fed-cruiser-1', 'axis-flagship', 'bloc-flagship', 'cabal-flagship'].includes(s.id));
        game.ships = game.ships.map((s, i) => ({ ...s, x: 150 + i * 4, y: 150, shields: 1, crew: 5, systems: { ...s.systems, engines: 0, phasers: 5, photons: 0, tractor: 0 }, arcs: { fore: 0, starboard: 0, aft: 0, port: 0 } }));
        game.terrain = [];
      }
      localStorage.clear();
      localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
    }, fragile);
    await page.reload();
  };
  const closeSetup = async method => {
    if (method === 'Escape') await page.keyboard.press('Escape');
    else await page.click('#new-game-form button[value="cancel"]');
    await page.waitForFunction(() => !window.__newGameSnapshot().open);
  };

  // Before the fix, these fragile fleets produced a terminal animation behind
  // setup at time 1.125: Begin closed the form but retained new-game-race.
  await fixture(true);
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'classic');
  await page.fill('#new-seed', 'replacement-classic');
  const opened = await snapshot();
  await page.waitForTimeout(REALTIME.msPerStardate * 2);
  assert.equal((await snapshot()).state, opened.state, 'setup must suspend the live battle, including terminal events');
  assert.equal((await snapshot()).locked, false);
  await page.click('#new-game-form button[value="confirm"]');
  const replacement = await snapshot();
  assert.equal(replacement.open, false);
  assert.equal(replacement.seed, 'replacement-classic');
  assert.equal(replacement.reimagined, false);
  assert.equal(replacement.realtime, false);
  assert.equal(replacement.turn, 1);
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).state, replacement.state, 'old battle cannot resume over the new Classic game');

  const identity = JSON.parse(replacement.state).battleRecordState;
  assert.ok(identity.battleId);
  assert.equal(identity.nextAction, 1);
  assert.equal(identity.nextEvent, 1);
  await page.reload();
  assert.deepEqual(JSON.parse((await snapshot()).state).battleRecordState, identity, 'reload resumes the same battle identity and counters');
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'classic');
  await page.fill('#new-seed', 'replacement-classic');
  await page.click('#new-game-form button[value="confirm"]');
  const repeated = JSON.parse((await snapshot()).state);
  assert.notEqual(repeated.battleRecordState.battleId, identity.battleId, 'a repeated seed starts a distinct battle instance');
  assert.equal(repeated.battleRecordState.nextAction, 1);
  assert.equal(repeated.records, undefined, 'raw records do not enter saved battle state');

  for (const method of ['Cancel', 'Escape']) {
    await fixture();
    await page.click('#new-game');
    const before = await snapshot();
    await page.waitForTimeout(250);
    await closeSetup(method);
    const after = await snapshot();
    assert.equal(after.seed, before.seed);
    assert.equal(after.paused, false, `${method} restores running play`);
    assert.ok(after.time - before.time <= 0.125, 'no accumulated setup wall time');
    await page.waitForFunction(time => window.__newGameSnapshot().time > time, before.time);
    await page.click('#pause-button');
    await page.click('#new-game');
    const paused = await snapshot();
    await closeSetup(method);
    assert.equal((await snapshot()).paused, true, `${method} preserves an existing user pause`);
    await page.waitForTimeout(250);
    assert.equal((await snapshot()).state, paused.state);
  }

  // Defense against any future asynchronous playback path: ignored Begin must
  // keep the form open, preserve choices, and allow a successful retry.
  await page.click('#new-game');
  await page.selectOption('#ruleset', 'classic');
  await page.fill('#new-seed', 'retry-classic');
  const previous = await snapshot();
  await page.evaluate(() => window.__newGameTestLock(true));
  await page.click('#new-game-form button[value="confirm"]');
  assert.equal((await snapshot()).open, true);
  assert.equal((await snapshot()).state, previous.state);
  assert.equal(await page.inputValue('#new-seed'), 'retry-classic');
  await page.evaluate(() => window.__newGameTestLock(false));
  await page.click('#new-game-form button[value="confirm"]');
  assert.equal((await snapshot()).seed, 'retry-classic');
  assert.equal((await snapshot()).open, false);
  assert.deepEqual(errors, []);
  console.log('New-game regression passed: live combat -> Classic, frozen setup, Cancel/Escape pause preservation, blocked-submit retry, and no old-battle continuation.');
} finally { await browser.close(); }
