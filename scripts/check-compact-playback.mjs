/** Actual app lifecycle check. Uses installed Edge + playwright-core, no downloads.
 * Start npm start; PLAYWRIGHT_MODULE selects an existing installation.
 * PLAYBACK_OUTPUT optionally saves screenshots and JSON outside the repository.
 */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.PLAYBACK_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const url = process.env.GAME_URL || 'http://localhost:8080';
const saveKey = 'argonaut-web-save-v1';
const fixture = async (page, mode = 'compact', replay = false) => {
  await page.goto(url);
  await page.evaluate(async ({ mode, replay, saveKey }) => {
    const { createGame } = await import('/game/state.js');
    const { enableBattleRecords } = await import('/game/battle-records.js');
    const { createJournal } = await import('/ui/battle-journal.js');
    const game = enableBattleRecords(createGame({ seed: 'compact-playback-parity', reimagined: true, realtime: true }), { battleId: 'playback-browser' });
    for (const [i, ship] of game.ships.entries()) { ship.x = 180 + i % 8 * 12; ship.y = 180 + Math.floor(i / 8) * 14; }
    Object.assign(game.ships.find((ship) => ship.id === 'fed-flagship'), { x: 40, y: 40 });
    const victims = [game.ships.find((ship) => ship.faction === 'Federation' && ship.id !== 'fed-flagship' && ship.id !== 'xanadu'), game.ships.find((ship) => ship.faction === 'Axis' && ship.id !== 'axis-flagship')];
    for (const [i, ship] of victims.entries()) Object.assign(ship, { x: 41 + i, y: 40, className: 'Drone' });
    const journal = createJournal(game.battleRecordState.battleId);
    const saved = { version: 1, game, journal };
    if (replay) {
      const shot = { kind: 'phasers', fromId: 'fed-flagship', toId: 'axis-flagship', x1: 40, y1: 40, x2: 70, y2: 40, hit: true, historical: true, actorName: 'Argo', targetName: 'Firebreather', simTime: 0, resolutionId: 0 };
      const terminal = { kind: 'destruction', shipId: 'axis-cruiser', shipName: 'Recorded drone', faction: 'Axis', cause: 'phasers', resolutionId: 0 };
      game.lastRound = { events: [shot, terminal], entries: ['Recorded round.'] };
      saved.roundPlayback = { battleId: journal.battleId, events: [shot, terminal] };
    }
    localStorage.clear();
    localStorage.setItem(saveKey, JSON.stringify(saved));
    localStorage.setItem('argonaut-web-playback', mode);
  }, { mode, replay, saveKey });
  await page.reload();
  await page.click('#pause-button');
  await page.waitForFunction(() => document.querySelector('#time-pause-status').textContent === 'Paused');
};
const state = (page) => page.evaluate((key) => {
  const data = JSON.parse(localStorage.getItem(key));
  const mechanics = data.game;
  return { mechanics, journalCount: data.journal.events.length, paused: document.querySelector('#time-pause-status').textContent, modeInGame: 'playbackMode' in data.game };
}, saveKey);
try {
  let expected;
  for (const [mode, skip, speed] of [['compact', false, 1], ['full', false, 1], ['compact', true, 1], ['full', true, 4], ['compact', false, 2]]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page, mode);
    if (speed === 2) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click(`#speed-${speed}`);
    await page.locator('[data-console-key="systems"] > summary').click();
    await page.click('[data-command="self-destruct"]');
    await page.locator('#confirm-dialog button[value="confirm"]').click();
    await page.waitForFunction(() => !document.querySelector('#finish-playback').disabled);
    const start = await state(page);
    assert.equal(start.mechanics.simTime, 0, 'identical input simulation time');
    assert.equal(start.paused, 'Paused');
    assert.equal(start.modeInGame, false);
    assert.match(await page.locator('#terminal-current').innerText(), /Your command ship/);
    assert.equal(await page.locator('#terminal-members-list > li').count(), 3);
    await page.locator('#terminal-members > summary').click();
    assert.ok(await page.locator('#command-log > li').first().evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight), 'own command stays within viewport during active critical and expanded terminal details');
    if (output && mode === 'compact' && !skip && speed === 1) await page.screenshot({ path: resolve(output, 'compact-active-critical.png'), fullPage: true });
    await page.click('#new-game');
    assert.equal(await page.locator('#new-game-dialog').evaluate((dialog) => dialog.open), false, 'new game is blocked during playback');
    if (skip) {
      await page.locator('#finish-playback').evaluate((button) => { button.click(); button.click(); });
    } else if (mode === 'compact') {
      await page.waitForFunction(() => /2 routine losses/.test(document.querySelector('#terminal-current').textContent));
      if (output && speed === 1) await page.screenshot({ path: resolve(output, 'compact-active-routine.png'), fullPage: true });
    }
    await page.waitForFunction(() => document.querySelector('#finish-playback').disabled, { timeout: 12000 });
    const final = await state(page);
    assert.deepEqual(final.mechanics, start.mechanics, 'presentation advances no simulation');
    assert.equal(final.journalCount, start.journalCount, 'finish retains journal');
    assert.equal(final.paused, 'Paused');
    if (!expected) expected = final.mechanics;
    else assert.deepEqual(final.mechanics, expected, 'mode/skip/speed parity for identical commands at simTime 0');
    assert.equal(await page.locator('#terminal-members-list > li').count(), 3);
    await page.click('#new-game');
    assert.equal(await page.locator('#new-game-dialog').evaluate((dialog) => dialog.open), true, 'lock released after playback');
    await page.locator('#new-game-dialog button[value="cancel"]').click();
    assert.equal(errors.length, 0, errors.join('\n'));
    results.push({ mode, skip, speed, journalCount: final.journalCount, parity: true });
    if (output && mode === 'compact' && !skip && speed === 1) {
      await page.screenshot({ path: resolve(output, 'compact-1366.png'), fullPage: true });
      for (const [width, height, name] of [[1600, 1000, 'desktop'], [390, 844, 'narrow'], [800, 500, 'enlarged']]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.locator('#playback-mode').evaluate((el) => el.getBoundingClientRect().right <= innerWidth));
        await page.screenshot({ path: resolve(output, `compact-${name}.png`), fullPage: true });
      }
    }
    await page.reload();
    assert.equal(await page.locator('#playback-mode').inputValue(), mode);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.click('#new-game');
    await page.fill('#new-seed', 'compact-playback-parity');
    await page.locator('#new-game-dialog button[value="confirm"]').click();
    await page.waitForFunction(() => !document.querySelector('#new-game-dialog').open);
    assert.equal(await page.locator('#terminal-playback').isVisible(), false, 'new battle clears old terminal detail');
    assert.equal(await page.locator('#finish-playback').isEnabled(), false);
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).roundPlayback == null, saveKey), true, 'new battle clears replay snapshot');
    assert.notEqual((await state(page)).mechanics.battleRecordState.battleId, 'playback-browser', 'same-seed new battle gets a distinct identity');
    await page.close();
  }

  // Replay uses frozen available geometry with explicitly labelled historical
  // positions, even when current hulls have moved. Finish cancels effect waits.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await fixture(page, 'compact', true);
  const before = await state(page);
  await page.click('#replay-round');
  await page.waitForSelector('.fx-historical-position');
  const geometry = await page.evaluate(() => {
    const line = document.querySelector('.fx-phaser');
    const points = [...document.querySelectorAll('.fx-historical-position')].map((el) => [Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))]);
    return { from: [Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))], to: [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))], points, labels: [...document.querySelectorAll('.fx-historical-label')].map((el) => el.textContent), labelHeights: [...document.querySelectorAll('.fx-historical-label')].map((el) => el.getBoundingClientRect().height), strokes: [...document.querySelectorAll('.fx-historical-position')].map((el) => getComputedStyle(el).stroke) };
  });
  assert.deepEqual(geometry.from, geometry.points[0]);
  assert.deepEqual(geometry.to, geometry.points[1]);
  assert.match(geometry.labels[0], /Argo.*recorded origin/);
  assert.match(geometry.labels[1], /Firebreather.*recorded target/);
  assert.ok(geometry.labelHeights.every((height) => height >= 11 && height <= 20), 'historical labels remain readable in rectangular maps');
  assert.ok(geometry.strokes.every((stroke) => stroke !== 'none' && stroke !== 'rgba(0, 0, 0, 0)'), 'historical positions have visible strokes');
  if (output) await page.screenshot({ path: resolve(output, 'historical-replay.png') });
  await page.click('#finish-playback');
  await page.waitForFunction(() => document.querySelector('#finish-playback').disabled);
  await page.waitForTimeout(650);
  assert.equal(await page.locator('svg.fx-layer > *').count(), 0, 'no later ghost effects after finish');
  assert.deepEqual(await state(page), before, 'replay and finish preserve state, pause, and records');
  await page.click('#replay-round');
  await page.waitForFunction(() => /Historical/.test(document.querySelector('#journal-history-status').textContent) && !document.querySelector('#journal-history-status').hidden);
  await page.click('#finish-playback');
  await page.waitForFunction(() => document.querySelector('#finish-playback').disabled);
  results.push({ replay: 'cancel/repeat', frozenGeometry: geometry, parity: true });
  await page.close();

  // Inject presentation failures through served modules, exercising app cleanup.
  for (const kind of ['terminal', 'replay']) {
    const context = await browser.newContext();
    const module = kind === 'terminal' ? 'ui/battle-events.js' : 'ui/fx.js';
    let body = await readFile(new URL(`../${module}`, import.meta.url), 'utf8');
    body = kind === 'terminal'
      ? body.replace('show(options ? group : group.members[0]);', "throw new Error('injected-terminal-failure');")
      : body.replace('if (!map || !events?.length) return 0;', "throw new Error('injected-replay-failure');");
    await context.route(`**/${module}`, (route) => route.fulfill({ body, contentType: 'text/javascript' }));
    const page = await context.newPage();
    await fixture(page, 'compact', kind === 'replay');
    if (kind === 'terminal') {
      await page.locator('[data-console-key="systems"] > summary').click();
      await page.click('[data-command="self-destruct"]');
      await page.locator('#confirm-dialog button[value="confirm"]').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game.ships.find((ship) => ship.id === 'fed-flagship').status === 'destroyed');
    } else await page.click('#replay-round');
    await page.waitForFunction(() => document.querySelector('#finish-playback').disabled);
    assert.equal((await state(page)).paused, 'Paused');
    await page.click('#new-game');
    assert.equal(await page.locator('#new-game-dialog').evaluate((dialog) => dialog.open), true, `${kind} failure releases lock`);
    results.push({ failure: kind, unlocked: true, paused: true });
    await context.close();
  }
  if (output) await writeFile(resolve(output, 'compact-playback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
