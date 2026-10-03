/**
 * Optional browser regression check. Start npm start first, then:
 *   node scripts/check-mode-selection.mjs
 * Requires playwright-core + installed Edge. PLAYWRIGHT_MODULE may name an
 * existing installation; no dependencies are downloaded. GAME_URL overrides
 * http://localhost:8080. Uses an isolated browser context and its own saves.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const SAVE = 'argonaut-web-save-v1';
const CAMPAIGN_SAVE = 'argonaut-web-save-campaign-v1';
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const open = () => page.click('#new-game');
  const submit = async (seed) => {
    await page.fill('#new-seed', seed);
    await page.click('#new-game-form button[value="confirm"]');
  };
  const savedWar = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).game, SAVE);
  const select = (ruleset) => page.selectOption('#ruleset', ruleset);
  const assertClassicChoices = async () => {
    assert.equal(await page.locator('#ruleset').inputValue(), 'classic');
    assert.equal(await page.locator('#reimagined-options').isVisible(), false);
    assert.equal(await page.locator('#loadout-section').isVisible(), false);
    assert.equal(await page.locator('#campaign').isEnabled(), false);
    assert.equal(await page.locator('#realtime').isEnabled(), false);
    assert.equal(await page.locator('#campaign').isChecked(), false);
    assert.equal(await page.locator('#realtime').isChecked(), false);
    assert.equal(await page.locator('#scenario').inputValue(), 'annihilation');
  };
  const assertWar = async ({ reimagined, realtime = false, precision = false, scenario = 'annihilation' }) => {
    const war = await savedWar();
    assert.equal(war.reimagined, reimagined);
    assert.equal(Boolean(war.realtime), realtime);
    assert.equal(Boolean(war.precision), precision);
    assert.equal(war.scenario, scenario);
    assert.equal(Object.hasOwn(war, 'extended'), false);
    assert.equal(Boolean(war.loadout), reimagined);
    assert.equal(await page.locator('[data-command="fleet"]').count(), reimagined ? 1 : 0);
    if (reimagined) assert.ok(war.ships.some((ship) => ship.captain), 'captains remain in Reimagined');
    await page.reload();
    assert.equal((await savedWar()).seed, war.seed, 'save resumes the same war');
    await open();
    assert.equal(await page.locator('#ruleset').inputValue(), reimagined ? 'reimagined' : 'classic');
    assert.equal(await page.locator('#realtime').isChecked(), realtime);
    await page.click('#new-game-form button[value="cancel"]');
  };

  await open();
  assert.deepEqual(await page.locator('#ruleset option').evaluateAll((options) => options.map((option) => option.value)), ['classic', 'reimagined']);
  assert.equal(await page.locator('#extended, #reimagined').count(), 0, 'no overlapping mode checkboxes');
  await assertClassicChoices();

  // A keyboard-only ruleset change must reveal the same available controls.
  await page.locator('#ruleset').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#ruleset').inputValue(), 'reimagined');
  assert.equal(await page.locator('#reimagined-options').isVisible(), true);
  assert.equal(await page.locator('#loadout-section').isVisible(), true);
  assert.equal(await page.locator('#scenario').isEnabled(), true);
  await page.uncheck('#loadout-xanadu');
  // Read the native option property; Playwright's enabled check evaluates the
  // parent select and does not report disabled options in the installed runtime.
  assert.equal(await page.locator('#scenario option[value="defend-xanadu"]').evaluate((option) => option.disabled), true);
  await page.check('#loadout-xanadu');

  for (const option of ['campaign', 'realtime']) {
    await page.check(`#${option}`);
    await page.selectOption('#scenario', 'hunt-the-vendetta');
    await select('classic');
    await assertClassicChoices();
    await select('reimagined');
    assert.equal(await page.locator(`#${option}`).isChecked(), false, 'returning to Reimagined does not resurrect a hidden choice');
  }
  await page.check('#campaign');
  await page.check('#realtime');
  assert.equal(await page.locator('#campaign').isChecked(), false);
  await page.check('#campaign');
  assert.equal(await page.locator('#realtime').isChecked(), false);
  await select('classic');
  await page.check('#precision');
  // Bypass change listeners to prove submission also normalizes stale values.
  await page.evaluate(() => {
    document.querySelector('#campaign').checked = true;
    document.querySelector('#realtime').checked = true;
    document.querySelector('#scenario').value = 'defend-xanadu';
  });
  await submit('mode-classic-precision');
  await assertWar({ reimagined: false, precision: true });

  await open();
  await page.uncheck('#precision');
  await submit('mode-classic');
  await assertWar({ reimagined: false });

  await open();
  await select('reimagined');
  await page.selectOption('#scenario', 'hunt-the-vendetta');
  await submit('mode-reimagined');
  await assertWar({ reimagined: true, scenario: 'hunt-the-vendetta' });

  await open();
  await page.selectOption('#scenario', 'annihilation');
  await page.check('#realtime');
  await submit('mode-realtime');
  await assertWar({ reimagined: true, realtime: true });

  await open();
  await page.check('#campaign');
  await submit('mode-campaign');
  const campaign = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).campaign, CAMPAIGN_SAVE);
  assert.equal(campaign.seed, 'mode-campaign');
  assert.ok(campaign.fleet.some((ship) => ship.captain), 'campaign retains Reimagined captains');
  assert.equal(await page.locator('#sector-root').isVisible(), true);
  await page.reload();
  assert.equal(await page.locator('#sector-root').isVisible(), true, 'campaign resumes its sector');
  await open();
  assert.equal(await page.locator('#ruleset').inputValue(), 'reimagined');
  assert.equal(await page.locator('#campaign').isChecked(), true);
  await select('classic');
  await assertClassicChoices();
  await submit('mode-after-campaign');
  await assertWar({ reimagined: false });
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_SAVE), null);
  assert.deepEqual(errors, [], 'no browser errors during mode changes or save/resume');
  console.log('Mode selection passed: Classic, Precision Classic, Reimagined, real-time, campaign, keyboard selection, stale-option normalization, and save/resume.');
} finally {
  await browser.close();
}
