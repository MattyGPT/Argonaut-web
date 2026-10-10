/** Browser lifecycle + a full manual rescue through production controls.
 * npm start, then PLAYWRIGHT_MODULE=<existing playwright-core> node scripts/check-operations.mjs.
 * GAME_URL defaults to localhost:8080. OPERATION_OUTPUT optionally saves screenshots.
 * Uses an isolated browser profile and read-only app instrumentation.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const keys = ['argonaut-web-save-v1', 'argonaut-web-save-campaign-v1', 'argonaut-web-first-orders'];
const operationKey = 'argonaut-web-save-operation-v1';
const results = [];
const output = process.env.OPERATION_OUTPUT;
if (output) await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__operationSnapshot = () => ({ game, campaign, active: Boolean(operationSession), playback: playbackLocked(), help: help.active, sector: sectorMode(), journal: view.journal });` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const snapshot = () => page.evaluate(() => window.__operationSnapshot());
  const bytes = () => page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), keys);
  const idle = () => page.waitForFunction(() => !window.__operationSnapshot().playback && window.__operationSnapshot().game?.phase !== 'computer');
  const confirm = () => page.locator('#confirm-dialog button[value="confirm"]').click();
  const move = async (dx, dy) => {
    await page.locator('[data-command="move"]').click();
    await page.fill('#first-coordinate', String(dx));
    await page.fill('#second-coordinate', String(dy));
    await page.locator('#coordinate-dialog button[value="confirm"]').click();
    await idle();
  };
  const tow = async () => {
    await page.locator('#map .ship[data-ship-id="op-sentinel"]').click();
    await page.locator('[data-ship-command="tractor-direct"][data-ship-target="op-sentinel"]').click();
    assert.equal(await page.inputValue('#tow-x'), '38');
    assert.equal(await page.inputValue('#tow-y'), '160');
    assert.match(await page.locator('#tow-preview').innerText(), /This pull moves Sentinel/);
    await page.locator('#tow-dialog button[value="confirm"]').click();
    await idle();
  };
  const fixture = async (kind) => {
    await page.evaluate(async ({ kind, keys }) => {
      const { createGame } = await import('/game/state.js');
      const { enableBattleRecords } = await import('/game/battle-records.js');
      const war = enableBattleRecords(createGame({ seed: `operation-return-${kind}`, reimagined: kind !== 'classic', realtime: kind === 'realtime' }));
      localStorage.clear();
      localStorage.setItem(keys[0], JSON.stringify({ version: 1, game: war }));
      if (kind.startsWith('campaign')) {
        const { createCampaign, startNodeBattle } = await import('/game/campaign.js');
        let campaign = createCampaign({ seed: `operation-return-${kind}` });
        if (kind === 'campaign-battle') {
          const node = campaign.sector.nodes.find((node) => node.id !== campaign.currentNode && node.owner !== 'Federation');
          campaign = startNodeBattle({ ...campaign, currentNode: node.id }, node.id).campaign;
        }
        localStorage.setItem(keys[1], JSON.stringify({ version: 1, campaign }));
      }
    }, { kind, keys });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__operationSnapshot));
    if (kind === 'realtime') await page.click('#pause-button');
    await idle();
  };
  for (const kind of ['classic', 'reimagined', 'realtime', 'campaign-map', 'campaign-battle']) {
    await fixture(kind);
    const before = await snapshot();
    const saved = await bytes();
    await page.click('#operation-start');
    await idle();
    assert.equal((await snapshot()).active, true);
    assert.equal(await page.locator('#new-game').isDisabled(), true);
    assert.deepEqual(await bytes(), saved);
    await page.reload();
    await idle();
    assert.equal((await snapshot()).active, true);
    await page.click('[data-operation-action="end"]');
    await confirm();
    assert.equal((await snapshot()).game.operation.result.primary, 'failure');
    assert.equal((await snapshot()).game.operation.result.abandoned.length, 4);
    await page.click('[data-operation-action="return"]');
    const after = await snapshot();
    assert.deepEqual(after.game, before.game, `${kind} game restoration`);
    assert.deepEqual(after.campaign, before.campaign, `${kind} campaign restoration`);
    assert.deepEqual(await bytes(), saved, `${kind} saves untouched`);
    results.push({ kind, restored: true });
  }
  await fixture('reimagined');
  const saved = await bytes();
  // Reproduce the reported mistake using real movement, then cancel without
  // consuming a turn. Keyboard and ship-menu rescue entry points share guidance.
  await page.click('#operation-start');
  await move(45, -20);
  await move(33, 20);
  const beforeTow = (await snapshot()).game;
  await page.keyboard.press('5');
  await page.selectOption('#target-select', 'op-sentinel');
  await page.locator('#target-form button[value="confirm"]').click();
  assert.match(await page.locator('#tow-title').innerText(), /Tow toward extraction/);
  assert.equal(await page.inputValue('#tow-x'), '38');
  assert.equal(await page.locator('#tow-hull option[value="op-patrol"]').count(), 0, 'No hidden enemy coordinates in the destination picker.');
  await page.selectOption('#tow-hull', beforeTow.playerShipId);
  assert.match(await page.locator('#tow-preview').innerText(), /Collision warning.*Argonaut/);
  assert.equal(await page.locator('#tow-form button[value="confirm"]').isDisabled(), true);
  await page.check('#tow-risk-ack');
  assert.equal(await page.locator('#tow-form button[value="confirm"]').isEnabled(), true);
  await page.selectOption('#tow-hull', '');
  await page.fill('#tow-x', '140');
  await page.fill('#tow-y', '160');
  assert.equal(await page.locator('#tow-risk-ack').isChecked(), false, 'Changing the aim requires a fresh acknowledgment.');
  assert.equal(await page.locator('#tow-form button[value="confirm"]').isDisabled(), true);
  if (output) await page.locator('#tow-dialog').screenshot({ path: resolve(output, 'operation-tow-warning.png') });
  await page.locator('#tow-form button[value="cancel"]').click();
  assert.deepEqual((await snapshot()).game, beforeTow, 'Inspecting and canceling does not advance the operation.');
  await page.locator('#map .ship[data-ship-id="op-sentinel"]').click();
  assert.equal(await page.locator('[data-ship-command="tractor"][data-ship-target="op-sentinel"]').count(), 0);
  const rescueButton = page.locator('[data-ship-command="tractor-direct"][data-ship-target="op-sentinel"]');
  assert.equal(await rescueButton.innerText(), 'Tow toward extraction…');
  await rescueButton.click();
  assert.equal(await page.locator('#tow-risk').isVisible(), false, 'Reopening clears the previous risky destination.');
  assert.equal(await page.locator('#tow-form button[value="confirm"]').isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('#tow-dialog').evaluate((node) => node.scrollWidth <= node.clientWidth), 'Tow dialog fits a narrow screen.');
  if (output) await page.screenshot({ path: resolve(output, 'operation-tow-narrow.png') });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('#tow-form button[value="cancel"]').click();
  await page.click('[data-operation-action="return"]'); await confirm();
  assert.deepEqual(await bytes(), saved);
  results.push({ rescueTowGuidance: true, keyboardAndMenu: true, collisionAcknowledgement: true, cancelPreservesGame: true });
  await page.click('#operation-start');
  if (output) await page.screenshot({ path: resolve(output, 'operation-opening.png'), fullPage: true });
  await move(45, -20);
  for (let step = 0; step < 18; step += 1) {
    const { game } = await snapshot();
    if (game.operation.primary !== 'pending') break;
    const player = game.ships.find((ship) => ship.id === game.playerShipId);
    const target = game.ships.find((ship) => ship.id === 'op-sentinel');
    if (Math.hypot(player.x - target.x, player.y - target.y) <= 35) await tow();
    else {
      const dx = target.x - 17 - player.x, dy = target.y - 20 - player.y;
      const fraction = Math.min(1, 49 / Math.hypot(dx, dy));
      await move(Math.round(dx * fraction), Math.round(dy * fraction));
    }
    if (step === 4) { await page.reload(); await idle(); }
  }
  assert.equal((await snapshot()).game.operation.primary, 'secured');
  await page.reload();
  await idle();
  for (let step = 0; step < 10 && !(await snapshot()).game.operation.result; step += 1) {
    const { game } = await snapshot();
    const player = game.ships.find((ship) => ship.id === game.playerShipId);
    const dx = 38 - player.x, dy = 160 - player.y;
    const fraction = Math.min(1, (player.systems.engines * 10 - 1) / Math.hypot(dx, dy));
    await move(Math.round(dx * fraction), Math.round(dy * fraction));
  }
  const end = (await snapshot()).game;
  assert.equal(end.operation.result.primary, 'success');
  assert.equal(end.operation.result.returned.length, 4);
  assert.deepEqual(await bytes(), saved);
  if (output) await page.screenshot({ path: resolve(output, 'operation-debrief.png'), fullPage: true });
  await page.reload(); await idle();
  assert.deepEqual((await snapshot()).game.operation.result, end.operation.result);
  await page.selectOption('#operation-seed', 'rescue-2');
  await page.click('[data-operation-action="retry"]');
  assert.equal((await snapshot()).game.operation.seed, 'rescue-2');
  assert.equal((await snapshot()).game.operation.elapsed, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#operation-panel summary').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Prototype panel fits a narrow screen.');
  if (output) await page.screenshot({ path: resolve(output, 'operation-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.click('#theme-toggle');
  await page.click('[data-operation-action="follow"]');
  assert.equal(await page.locator('#mode-readout').innerText(), 'REIMAGINED OPERATION');
  await page.click('[data-operation-action="overview"]');
  await page.click('[data-operation-action="return"]'); await confirm();
  assert.equal((await snapshot()).active, false);
  // Invalid revision safely falls back and explains why, without deleting the rejected save.
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 100 })), operationKey);
  await page.reload(); await idle();
  assert.match(await page.locator('#operation-panel').innerText(), /incompatible/);
  assert.equal((await snapshot()).active, false);
  assert.deepEqual(errors, []);
  results.push({ manualRescue: true, elapsed: end.operation.elapsed, returned: end.operation.result.returned.map((ship) => ship.name), reloadAndRetry: true, errors });
  if (output) await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
