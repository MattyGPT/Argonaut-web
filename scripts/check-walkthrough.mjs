/** Optional actual-app first-order checks. Start npm start; uses installed Edge.
 * PLAYWRIGHT_MODULE selects playwright-core; WALKTHROUGH_OUTPUT keeps evidence outside the repo.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.WALKTHROUGH_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const key = 'argonaut-web-save-v1';
const hintKey = 'argonaut-web-first-orders';
const setup = async (page, mode) => {
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.evaluate(async ({ key, mode }) => {
    const { createGame } = await import('/game/state.js');
    const { enableBattleRecords } = await import('/game/battle-records.js');
    const game = enableBattleRecords(createGame({ seed: 'walkthrough-check', reimagined: mode !== 'classic', realtime: mode === 'realtime' }), { battleId: 'walkthrough-browser' });
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify({ version: 1, game }));
  }, { key, mode });
  await page.reload();
  if (mode === 'realtime') await page.click('#pause-button');
};
const state = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).game, key);
const stage = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).stage, hintKey);
const waitUnlocked = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#finish-playback').disabled || !document.querySelector('[data-command="pass"]').disabled);
  if (await page.locator('#finish-playback').isEnabled()) await page.click('#finish-playback');
  await page.waitForFunction(() => !document.querySelector('[data-command="pass"]').disabled);
};
try {
  for (const mode of ['classic', 'reimagined', 'realtime']) {
    let expected;
    for (const hints of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await setup(page, mode);
      if (hints) {
        const before = await state(page);
        await page.click('#user-guide');
        await page.click('#guide-dialog [data-walkthrough-action="start"]');
        await page.waitForFunction(() => !document.querySelector('#guide-dialog').open);
        assert.deepEqual(await state(page), before, 'starting hints changes no game state');
        await page.click('#walkthrough-panel [data-walkthrough-action="locate"]');
        assert.ok(await page.locator('#ship-menu').isVisible());
        await page.click('#walkthrough-panel [data-walkthrough-action="inspect"]');
      } else await page.click('[data-command="move"]');
      await page.waitForSelector('#coordinate-dialog[open]');
      await page.locator('#coordinate-form input').nth(0).fill('9999');
      await page.locator('#coordinate-form input').nth(1).fill('0');
      await page.click('#coordinate-form button[value="confirm"]');
      if (hints) assert.equal(await stage(page), 'order', 'invalid movement cannot complete the hint');
      await page.click('[data-command="move"]');
      await page.locator('#coordinate-form input').nth(0).fill('1');
      await page.locator('#coordinate-form input').nth(1).fill('0');
      await page.click('#coordinate-form button[value="confirm"]');
      await waitUnlocked(page);
      if (hints) {
        await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).stage === 'result', hintKey);
        await page.click('#walkthrough-panel [data-walkthrough-action="inspect-result"]');
        assert.equal(await stage(page), 'complete');
        assert.equal(await page.locator('#command-log details[open]').count(), 1);
        if (output) await page.screenshot({ path: resolve(output, `${mode}-first-orders.png`), fullPage: true });
        assert.deepEqual(await state(page), expected, 'hints leave complete authoritative state and RNG identical');
        await page.click('#walkthrough-panel [data-walkthrough-action="dismiss"]');
        await page.reload();
        assert.equal(await stage(page), 'dismissed');
        assert.equal(await page.locator('#walkthrough-panel').isVisible(), false);
      } else expected = await state(page);
      assert.deepEqual(errors, []);
      await page.close();
    }
    results.push({ mode, stateParity: true, acceptedResult: true, invalidOrderRejected: true, dismissalPersists: true });
  }
  if (output) await writeFile(resolve(output, 'walkthrough.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
